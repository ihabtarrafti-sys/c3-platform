/**
 * runner.ts — the backup orchestration (pure of real I/O; all effects are
 * injected). This is the fully unit-tested core. The 16-step sequence and the
 * exit-code contract live here; the real pg_dump/age/S3 adapters are thin and
 * certified by the hosted backup+restore drill.
 */
import type { BackupEnv } from './env';
import { assertBackupOnlyDatabaseUrl } from './env';
import { objectKey, manifestKey, classesFor, STATUS_LATEST_SUCCESS_KEY, type BackupClass } from './naming';
import {
  serializeManifest,
  serializeLatestSuccess,
  recipientFingerprint,
  type BlobInventory,
  type BlobArchive,
  type BlobArchiveEntry,
  type LatestSuccess,
} from './manifest';
import { signManifestBytes, signatureKeyFor, verifyManifestBytes, publicKeyPemFromPrivate } from './signing';

export interface BackupDeps {
  now(): Date;
  serverVersion(): Promise<string>;
  migrations(): Promise<string[]>;
  pgDumpVersion(): Promise<string>;
  /**
   * R3-N06: ONE coherent read — pg_dump to `dumpPath` AND the DB blob census enumerated
   * from the IDENTICAL MVCC snapshot (pg_export_snapshot + pg_dump --snapshot). The dump
   * rows and the returned blob list are the same point in time, so no between-reads
   * delete/insert can produce a signed-but-incoherent image. Returns the dump size and
   * the authoritative blob index (used for the archive, coverage, and the manifest).
   */
  coherentDumpAndCensus(dumpPath: string): Promise<{ bytes: number; blobs: BlobArchiveEntry[] }>;
  /**
   * H-08 (Option A): capture EXACTLY the census `blobs` into a single plaintext archive
   * at `destPath` (downloaded from the live store, sha-verified at capture). Fail-closed:
   * a census key missing from the store REFUSES the backup. Returns the captured index.
   */
  snapshotBlobs(destPath: string, blobs: BlobArchiveEntry[]): Promise<{ entries: BlobArchiveEntry[] }>;
  /** Single-run guard via a DB advisory lock. false => another run holds it. */
  acquireLock(): Promise<boolean>;
  releaseLock(): Promise<void>;
  makeTempDir(): Promise<string>;
  cleanupTempDir(dir: string): Promise<void>;
  sha256File(path: string): Promise<string>;
  fileSize(path: string): Promise<number>;
  /** age encrypt inPath -> outPath for recipient. */
  encrypt(inPath: string, outPath: string, recipient: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  uploadFile(key: string, path: string, contentType: string): Promise<void>;
  uploadBytes(key: string, body: string, contentType: string): Promise<void>;
  /** Download the object and verify its sha256+size match. Throws on mismatch. */
  verifyObject(key: string, expectedSha256: string, expectedBytes: number): Promise<void>;
  /** R2-N07: read an uploaded object's bytes back as a UTF-8 string (manifest /
   *  signature sidecar readback). Throws if the key is missing. */
  readBytes(key: string): Promise<string>;
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface BackupResult {
  readonly primaryKey: string;
  readonly classes: BackupClass[];
  readonly encryptedSha256: string;
  readonly encryptedBytes: number;
  readonly plaintextBytes: number;
  readonly durationMs: number;
}

/** Derive the manifest's inventory summary (counts + one sample/class) from the coherent census. */
function inventoryOf(blobs: BlobArchiveEntry[]): BlobInventory {
  const mk = (cls: BlobArchiveEntry['cls']): BlobInventory['document'] => {
    const of = blobs.filter((b) => b.cls === cls);
    return of.length === 0 ? { count: 0, sample: null } : { count: of.length, sample: { storageKey: of[0]!.storageKey, sha256: of[0]!.sha256 } };
  };
  return { document: mk('document'), photo: mk('photo'), intake: mk('intake') };
}

/**
 * R3-N06: the archive must cover EVERY census key — count AND key, not one-per-class.
 * A missing (or extra) key refuses the backup; with the fail-closed capture and the
 * synchronized snapshot, a signed archive is provably complete, not merely non-empty.
 */
function assertCoverage(census: BlobArchiveEntry[], captured: BlobArchiveEntry[]): void {
  const want = new Set(census.map((b) => b.storageKey));
  const got = new Set(captured.map((e) => e.storageKey));
  if (got.size !== want.size) {
    throw new Error(`Blob archive coverage mismatch: census has ${want.size} object(s), archive captured ${got.size} — refusing an incomplete backup.`);
  }
  for (const k of want) {
    if (!got.has(k)) throw new Error(`Blob archive is MISSING census key '${k}' — refusing an incomplete backup.`);
  }
}

/**
 * H-08 (Option A): build the INDEPENDENT encrypted blob archive from the COHERENT census
 * and upload it. Returns its descriptor, or null when there are no blobs.
 */
async function buildBlobArchive(
  env: BackupEnv,
  deps: BackupDeps,
  tempDir: string,
  primaryKey: string,
  census: BlobArchiveEntry[],
): Promise<BlobArchive | null> {
  if (census.length === 0) return null;
  const plainPath = `${tempDir}/blobs.tar`;
  const encPath = `${tempDir}/blobs.tar.age`;
  const snap = await deps.snapshotBlobs(plainPath, census);
  assertCoverage(census, snap.entries); // count + key, no silent skip

  await deps.encrypt(plainPath, encPath, env.ageRecipient);
  await deps.removeFile(plainPath); // drop plaintext blobs immediately
  const sha256 = await deps.sha256File(encPath);
  const bytes = await deps.fileSize(encPath);
  if (bytes <= 0) throw new Error('Blob archive encryption produced an empty artifact.');
  const key = `${primaryKey}.blobs.age`;
  await deps.uploadFile(key, encPath, 'application/octet-stream');
  await deps.verifyObject(key, sha256, bytes);
  deps.log('backup.blob_archive', { key, entries: snap.entries.length, bytes });
  return { key, sha256, bytes, entryCount: snap.entries.length, entries: snap.entries };
}

/**
 * Execute one backup. Resolves on FULL success; rejects on ANY partial
 * failure (main maps a rejection to a non-zero exit). `latest-success.json` is
 * written ONLY after the encrypted object + manifest are uploaded and verified.
 */
export async function runBackup(env: BackupEnv, deps: BackupDeps): Promise<BackupResult> {
  // Step 1–2: env already validated by loadEnv; re-assert the DB role guard.
  assertBackupOnlyDatabaseUrl(env.databaseUrl);

  const started = deps.now();

  // Overlap prevention (in addition to Railway's single-cron behavior).
  const locked = await deps.acquireLock();
  if (!locked) {
    deps.log('backup.skipped', { reason: 'another run holds the advisory lock' });
    throw new Error('Backup already running (advisory lock held).');
  }

  let tempDir: string | undefined;
  try {
    const [serverVersion, migrations, pgDumpVersion] = await Promise.all([
      deps.serverVersion(),
      deps.migrations(),
      deps.pgDumpVersion(),
    ]);

    // Step 3: secure temp dir.
    tempDir = await deps.makeTempDir();
    const dumpPath = `${tempDir}/dump.pgc`;
    const encPath = `${tempDir}/dump.pgc.age`;

    // Step 4–5: R3-N06 ONE coherent image — pg_dump AND the blob census from the identical
    // MVCC snapshot. Reject an empty dump.
    const { bytes: dumpBytes, blobs } = await deps.coherentDumpAndCensus(dumpPath);
    if (dumpBytes <= 0) throw new Error('pg_dump produced an empty dump.');
    const blobInventory = inventoryOf(blobs);
    deps.log('backup.dumped', { bytes: dumpBytes });
    deps.log('backup.blob_inventory', { document: blobInventory.document.count, photo: blobInventory.photo.count, intake: blobInventory.intake.count });

    // Step 6: plaintext metadata.
    const plaintextSha256 = await deps.sha256File(dumpPath);

    // Step 7: encrypt locally.
    await deps.encrypt(dumpPath, encPath, env.ageRecipient);
    const encryptedBytes = await deps.fileSize(encPath);
    if (encryptedBytes <= 0) throw new Error('Encryption produced an empty artifact.');

    // Step 8: remove the plaintext dump immediately.
    await deps.removeFile(dumpPath);
    deps.log('backup.encrypted', { encryptedBytes });

    const encryptedSha256 = await deps.sha256File(encPath);

    const classes = classesFor(env.mode, started);
    const spec = { when: started, mode: env.mode, environmentLabel: env.environmentLabel, shortSha: env.sourceCommit };
    const keys = classes.map((cls) => ({ cls, key: objectKey(cls, spec) }));
    const primaryKey = keys[0]!.key;

    // M-14: a signing key is REQUIRED — an unsigned backup may proceed ONLY under
    // the explicit legacy flag, and then it must NOT write latest-success (the
    // status tile must never go green on an unverifiable artifact).
    if (!env.signingKeyPem && !env.allowUnsigned) {
      throw new Error(
        'Refusing to run UNSIGNED: set BACKUP_SIGNING_KEY (producer authenticity), or BACKUP_ALLOW_UNSIGNED=yes to run a legacy unsigned backup (which will NOT update the status marker).',
      );
    }

    // H-08 (Option A): the independent encrypted blob snapshot (built + uploaded
    // once, referenced by every retention copy's manifest).
    const blobArchive = await buildBlobArchive(env, deps, tempDir, primaryKey, blobs);

    const manifestFor = (key: string): string =>
      serializeManifest({
        schema: 'c3-backup-manifest/1',
        environment: env.environmentLabel,
        createdAtUtc: started.toISOString(),
        mode: env.mode,
        classes,
        // H-09: EACH copy's manifest names ITS OWN object — the weekly retention
        // copy is self-consistent and verifiable on its own, not tied to the
        // daily object's manifest.
        objectKey: key,
        sourceCommit: env.sourceCommit,
        serverVersion,
        migrations,
        encryptedSha256,
        encryptedBytes,
        plaintextSha256,
        plaintextBytes: dumpBytes,
        pgDumpVersion,
        ageRecipientFingerprint: recipientFingerprint(env.ageRecipient),
        blobInventory,
        blobArchive,
      });

    // Step 9–11: upload the object, a per-key signed manifest, and VERIFY EACH copy.
    const verifyPubPem = env.signingKeyPem ? publicKeyPemFromPrivate(env.signingKeyPem) : null;
    for (const { cls, key } of keys) {
      const body = manifestFor(key); // throws if any secret leaks
      const mKey = manifestKey(key);
      const signature = env.signingKeyPem ? signManifestBytes(body, env.signingKeyPem) : null;
      await deps.uploadFile(key, encPath, 'application/octet-stream');
      await deps.uploadBytes(mKey, body, 'application/json');
      if (signature) await deps.uploadBytes(signatureKeyFor(mKey), signature, 'text/plain');
      await deps.verifyObject(key, encryptedSha256, encryptedBytes);

      // R2-N07: read the auth sidecars BACK from the store and verify them HERE —
      // a missing/corrupt manifest or signature must fail this run, not surface
      // later at restore (after the tile already went green). For a signed run the
      // Ed25519 signature must verify over the read-back manifest bytes (which,
      // by Ed25519 non-malleability, proves they are exactly what we signed), and
      // the manifest must name THIS object (key/object binding). A missing sidecar
      // makes readBytes throw.
      if (signature && verifyPubPem) {
        const backManifest = await deps.readBytes(mKey);
        const backSig = await deps.readBytes(signatureKeyFor(mKey));
        if (!verifyManifestBytes(backManifest, backSig, verifyPubPem)) {
          throw new Error(`Manifest signature failed readback verification for ${mKey} — sidecar missing or corrupt.`);
        }
        const boundKey = (JSON.parse(backManifest) as { objectKey?: string }).objectKey;
        if (boundKey !== key) throw new Error(`Manifest object binding mismatch on readback: expected ${key}, got ${boundKey}.`);
      }
      deps.log('backup.uploaded', { cls, key, signed: signature !== null });
    }

    // Step 12: write latest-success ONLY after complete success AND only for a
    // SIGNED backup — an unsigned (legacy-flag) run leaves the status tile stale
    // so the gap is noticed, not silently masked green (M-14).
    if (env.signingKeyPem) {
      const latest: LatestSuccess = {
        schema: 'c3-backup-latest-success/1',
        lastSuccessUtc: deps.now().toISOString(),
        objectKey: primaryKey,
        manifestKey: manifestKey(primaryKey),
        environment: env.environmentLabel,
        mode: env.mode,
        encryptedSha256,
        encryptedBytes,
      };
      await deps.uploadBytes(STATUS_LATEST_SUCCESS_KEY, serializeLatestSuccess(latest), 'application/json');
      deps.log('backup.latest_success_written', { key: STATUS_LATEST_SUCCESS_KEY });
    } else {
      deps.log('backup.latest_success_skipped', { reason: 'unsigned backup (BACKUP_ALLOW_UNSIGNED) does not update the status marker' });
    }

    const durationMs = deps.now().getTime() - started.getTime();
    return { primaryKey, classes, encryptedSha256, encryptedBytes, plaintextBytes: dumpBytes, durationMs };
  } finally {
    // Steps 13–14: always close resources + delete all temporary artifacts.
    if (tempDir) await deps.cleanupTempDir(tempDir).catch(() => {});
    await deps.releaseLock().catch(() => {});
  }
}
