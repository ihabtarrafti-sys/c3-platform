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
  type LatestSuccess,
} from './manifest';
import { signManifestBytes, signatureKeyFor } from './signing';

export interface BackupDeps {
  now(): Date;
  serverVersion(): Promise<string>;
  migrations(): Promise<string[]>;
  pgDumpVersion(): Promise<string>;
  /** H-08: census the object store (documents + photos + intake) from the DB. */
  blobInventory(): Promise<BlobInventory>;
  /** Single-run guard via a DB advisory lock. false => another run holds it. */
  acquireLock(): Promise<boolean>;
  releaseLock(): Promise<void>;
  makeTempDir(): Promise<string>;
  cleanupTempDir(dir: string): Promise<void>;
  /** pg_dump -Fc -Z <n> to outPath. Returns byte size. */
  dump(outPath: string): Promise<{ bytes: number }>;
  sha256File(path: string): Promise<string>;
  fileSize(path: string): Promise<number>;
  /** age encrypt inPath -> outPath for recipient. */
  encrypt(inPath: string, outPath: string, recipient: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  uploadFile(key: string, path: string, contentType: string): Promise<void>;
  uploadBytes(key: string, body: string, contentType: string): Promise<void>;
  /** Download the object and verify its sha256+size match. Throws on mismatch. */
  verifyObject(key: string, expectedSha256: string, expectedBytes: number): Promise<void>;
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
    const [serverVersion, migrations, pgDumpVersion, blobInventory] = await Promise.all([
      deps.serverVersion(),
      deps.migrations(),
      deps.pgDumpVersion(),
      deps.blobInventory(),
    ]);
    deps.log('backup.blob_inventory', {
      document: blobInventory.document.count,
      photo: blobInventory.photo.count,
      intake: blobInventory.intake.count,
    });

    // Step 3: secure temp dir.
    tempDir = await deps.makeTempDir();
    const dumpPath = `${tempDir}/dump.pgc`;
    const encPath = `${tempDir}/dump.pgc.age`;

    // Step 4–5: pg_dump; reject an empty dump.
    const { bytes: dumpBytes } = await deps.dump(dumpPath);
    if (dumpBytes <= 0) throw new Error('pg_dump produced an empty dump.');
    deps.log('backup.dumped', { bytes: dumpBytes });

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
      });

    // Step 9–11: upload the object, a per-key signed manifest, and VERIFY EACH copy.
    for (const { cls, key } of keys) {
      const body = manifestFor(key); // throws if any secret leaks
      const signature = env.signingKeyPem ? signManifestBytes(body, env.signingKeyPem) : null;
      await deps.uploadFile(key, encPath, 'application/octet-stream');
      await deps.uploadBytes(manifestKey(key), body, 'application/json');
      if (signature) await deps.uploadBytes(signatureKeyFor(manifestKey(key)), signature, 'text/plain');
      await deps.verifyObject(key, encryptedSha256, encryptedBytes);
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
