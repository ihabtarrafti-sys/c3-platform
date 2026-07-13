/**
 * blobBundle.ts — HARDEN-2 M-07/H-03 follow-up: DOCUMENT BYTES in the tenant
 * export, and object deletion in the tenant exit.
 *
 * A tenant's evidence is not just rows — the export bundle must carry the
 * blobs (verified against their stored SHA-256: a corrupted object FAILS the
 * export loudly rather than shipping a lie), and the exit ceremony must erase
 * the objects, not only the metadata (keys are `${tenantId}/${uuid}`, so the
 * tenant prefix enumerates everything — including any orphan a crashed
 * compensation left behind).
 *
 * The reader is env-driven and mirrors the API's storage drivers exactly:
 * R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_DOCUMENTS (all
 * four) → S3/R2; DOCUMENTS_DIR → local filesystem (dev/test). Used ONLY by
 * the owner-run export/exit CLIs — never by the API runtime.
 */
import { readFile, readdir, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { tenantBlobPrefixes, type BlobClass, type BlobDescriptor, type Queryable } from './blobUniverse';

export type { BlobClass, BlobDescriptor } from './blobUniverse';

export interface DocumentBlobRow {
  readonly documentId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Parse export-shaped document.jsonl (snake_case DB columns) into blob rows. */
export function parseDocumentRows(jsonl: string): DocumentBlobRow[] {
  if (jsonl.trim() === '') return [];
  return jsonl
    .trim()
    .split('\n')
    .map((line) => {
      const r = JSON.parse(line) as Record<string, unknown>;
      const row: DocumentBlobRow = {
        documentId: String(r.document_id ?? ''),
        storageKey: String(r.storage_key ?? ''),
        fileName: String(r.file_name ?? 'file'),
        sha256: String(r.sha256 ?? ''),
        sizeBytes: Number(r.size_bytes ?? 0),
      };
      if (!row.documentId || !row.storageKey || !/^[a-f0-9]{64}$/.test(row.sha256)) {
        throw new Error(`document.jsonl row is not blob-enumerable: ${line.slice(0, 120)}`);
      }
      return row;
    });
}

/** The on-disk bundle name: DOC-XXXX__<safe original name>. */
export function bundleFileName(row: DocumentBlobRow): string {
  const safe = row.fileName.replace(/[^\w. -]/g, '_').slice(0, 140) || 'file';
  return `${row.documentId}__${safe}`;
}

export interface BlobReader {
  readonly driver: 'r2' | 'fs';
  get(key: string): Promise<Buffer | null>;
  /** Every key under a prefix (the tenant's object universe). */
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
  close(): void;
}

export interface BlobEnv {
  R2_ENDPOINT?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_DOCUMENTS?: string;
  DOCUMENTS_DIR?: string;
}

/** null when NO storage configuration is present (the caller decides how loud to be). */
export function createBlobReader(env: BlobEnv): BlobReader | null {
  const r2 = [env.R2_ENDPOINT, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET_DOCUMENTS];
  if (r2.every((v) => typeof v === 'string' && v.length > 0)) {
    const bucket = env.R2_BUCKET_DOCUMENTS!;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT!,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
      forcePathStyle: true,
    });
    return {
      driver: 'r2',
      async get(key) {
        try {
          const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const b = await res.Body?.transformToByteArray();
          return b ? Buffer.from(b) : null;
        } catch (err) {
          if ((err as { name?: string }).name === 'NoSuchKey') return null;
          throw err;
        }
      },
      async listKeys(prefix) {
        const keys: string[] = [];
        let token: string | undefined;
        do {
          const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
          for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
          token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        return keys;
      },
      async deleteKey(key) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      },
      close() {
        s3.destroy();
      },
    };
  }
  if (env.DOCUMENTS_DIR) {
    const root = env.DOCUMENTS_DIR;
    return {
      driver: 'fs',
      async get(key) {
        try {
          return await readFile(join(root, key));
        } catch (err) {
          if ((err as { code?: string }).code === 'ENOENT') return null;
          throw err;
        }
      },
      async listKeys(prefix) {
        // RECURSIVE: intake quarantine keys nest (intake/<tenant>/<sub>/<upload>),
        // so a one-level readdir would miss them. Walk the tree and return every
        // FILE key (forward-slash separated, relative to root) — mirrors the R2
        // prefix listing, which is recursive by nature.
        const out: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch (err) {
            if ((err as { code?: string }).code === 'ENOENT') return;
            throw err;
          }
          for (const e of entries) {
            const abs = join(dir, e.name);
            if (e.isDirectory()) await walk(abs);
            else out.push(relative(root, abs).split(sep).join('/'));
          }
        };
        await walk(join(root, prefix));
        return out;
      },
      async deleteKey(key) {
        await rm(join(root, key), { force: true });
      },
      close() {},
    };
  }
  return null;
}

export interface BlobBundleResult {
  readonly count: number;
  readonly totalBytes: number;
}

/**
 * Fetch every document's bytes, verify each against its stored SHA-256, and
 * hand the verified buffer to `write`. A missing object or a hash mismatch
 * FAILS the bundle — an export that cannot return the evidence intact refuses
 * rather than shipping silently-partial truth.
 */
export async function downloadTenantBlobs(
  reader: BlobReader,
  rows: readonly DocumentBlobRow[],
  write: (name: string, bytes: Buffer) => Promise<void> | void,
): Promise<BlobBundleResult> {
  let totalBytes = 0;
  for (const row of rows) {
    const bytes = await reader.get(row.storageKey);
    if (!bytes) throw new Error(`Blob missing for ${row.documentId} (key ${row.storageKey}) — export refused.`);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== row.sha256) {
      throw new Error(`Blob hash mismatch for ${row.documentId}: stored ${row.sha256}, actual ${sha} — export refused.`);
    }
    await write(bundleFileName(row), bytes);
    totalBytes += bytes.length;
  }
  return { count: rows.length, totalBytes };
}

/** Erase every object under the tenant's prefix; returns the deleted keys. */
export async function deleteTenantBlobs(reader: BlobReader, tenantId: string): Promise<string[]> {
  const keys = await reader.listKeys(`${tenantId}/`);
  for (const key of keys) await reader.deleteKey(key);
  return keys;
}

export interface TombstoneSweepResult {
  /** Every object key actually removed from storage (both prefixes, incl. orphans). */
  readonly deletedObjects: string[];
  /** Exit tombstones whose object was verified gone and marked deleted. */
  readonly verifiedTombstones: number;
  /** Exit tombstones whose object still resolved after the sweep — left pending (retryable). */
  readonly pendingTombstones: number;
  /** Both tenant prefixes list empty afterwards (zero tenant bytes). */
  readonly prefixesEmpty: boolean;
}

/**
 * HARDEN-3 (H-07) Phase 2 — the post-commit erasure sweep. Runs AFTER the exit
 * transaction has committed (tenant identity gone; the `blob_tombstone` ledger
 * is the only remaining handle). It:
 *   1. deletes EVERY object under both tenant prefixes — `${tenantId}/`
 *      (documents/photos/intake-live) and `intake/${tenantId}/` (quarantine) —
 *      including ORPHANS no database row named (e.g. a crashed compensation);
 *   2. VERIFIES each recorded exit tombstone's object is actually gone before
 *      marking it deleted; an object that still resolves keeps its tombstone
 *      PENDING with the error recorded, so a re-run retries it;
 *   3. re-lists both prefixes to confirm zero residual tenant bytes.
 * The tombstone ledger makes this idempotent and resumable: a failed pass
 * leaves a durable, retryable record rather than a silently-stranded object.
 */
export async function sweepTenantBlobErasure(db: Queryable, reader: BlobReader, tenantId: string): Promise<TombstoneSweepResult> {
  const prefixes = tenantBlobPrefixes(tenantId);

  const deletedObjects: string[] = [];
  for (const prefix of prefixes) {
    for (const key of await reader.listKeys(prefix)) {
      await reader.deleteKey(key);
      deletedObjects.push(key);
    }
  }

  // M-02: exit resolves EVERY pending tombstone for the tenant, not just the
  // exit-reason ones — a rejected-intake wipe left pending by an earlier storage
  // failure must be finished by the exit ceremony too, or private bytes could
  // survive an erasure that reports itself complete.
  const pending = await db.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM blob_tombstone WHERE tenant_ref = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  let verified = 0;
  let stillPending = 0;
  for (const row of pending.rows) {
    if ((await reader.get(row.storage_key)) === null) {
      await db.query(`UPDATE blob_tombstone SET deleted_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
      verified += 1;
    } else {
      await db.query(`UPDATE blob_tombstone SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [
        row.id,
        'object still present after erasure sweep',
      ]);
      stillPending += 1;
    }
  }

  const remaining = await Promise.all(prefixes.map((p) => reader.listKeys(p)));
  return {
    deletedObjects: deletedObjects.sort(),
    verifiedTombstones: verified,
    pendingTombstones: stillPending,
    prefixesEmpty: remaining.every((keys) => keys.length === 0),
  };
}

export interface BlobUniverseResult {
  readonly count: number;
  readonly totalBytes: number;
  readonly byClass: Record<BlobClass, number>;
}

/**
 * HARDEN-3 (H-07): fetch, VERIFY, and write every blob in the tenant universe
 * (documents + photos + intake quarantine), each hand to `write` under its
 * collision-free bundle path. Same fail-closed contract as the document bundle:
 * a missing object or a hash mismatch REFUSES the whole export — an export that
 * cannot return the evidence intact is not shipped silently partial.
 */
export async function downloadBlobUniverse(
  reader: BlobReader,
  descriptors: readonly BlobDescriptor[],
  write: (bundleName: string, bytes: Buffer) => Promise<void> | void,
): Promise<BlobUniverseResult> {
  let totalBytes = 0;
  const byClass: Record<BlobClass, number> = { document: 0, photo: 0, intake: 0 };
  for (const d of descriptors) {
    const bytes = await reader.get(d.storageKey);
    if (!bytes) throw new Error(`Blob missing for ${d.ownerRef} (key ${d.storageKey}) — export refused.`);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== d.sha256) {
      throw new Error(`Blob hash mismatch for ${d.ownerRef}: stored ${d.sha256}, actual ${sha} — export refused.`);
    }
    await write(d.bundleName, bytes);
    totalBytes += bytes.length;
    byClass[d.blobClass] += 1;
  }
  return { count: descriptors.length, totalBytes, byClass };
}

export interface OrphanCaptureResult {
  /** Objects captured that no DB row named — keys, sorted. */
  readonly capturedKeys: string[];
  readonly totalBytes: number;
}

/**
 * HARDEN-3.1 (H-07): capture PREFIX-DISCOVERED objects the DB universe did NOT
 * name, so the RETURN BUNDLE is byte-complete — nothing is swept-and-destroyed at
 * exit without first being handed back. Two sources produce such objects:
 *   - a PROMOTED intake submission whose quarantine copy survived the best-effort
 *     post-attach delete (the universe enumerates only PENDING intake), and
 *   - an ORPHAN a crashed compensation left behind (no row ever named it).
 * Both are erased by `sweepTenantBlobErasure`'s prefix listing; this is the
 * symmetric READ that puts them in the export first. Bytes are written under an
 * `orphans/` path (verifiable only by size — no stored sha256 exists off-DB), and
 * `knownKeys` (the enumerated universe's storage keys) is skipped so nothing is
 * downloaded twice. Read-only: it never deletes.
 */
export async function downloadOrphanBlobs(
  reader: BlobReader,
  tenantId: string,
  knownKeys: Iterable<string>,
  write: (bundleName: string, bytes: Buffer) => Promise<void> | void,
): Promise<OrphanCaptureResult> {
  const known = new Set(knownKeys);
  const capturedKeys: string[] = [];
  let totalBytes = 0;
  for (const prefix of tenantBlobPrefixes(tenantId)) {
    for (const key of await reader.listKeys(prefix)) {
      if (known.has(key)) continue; // already in the enumerated bundle
      const bytes = await reader.get(key);
      if (!bytes) continue; // vanished between list and get — nothing to return
      await write(`orphans/${key.replace(/[^\w./ -]/g, '_')}`, bytes);
      capturedKeys.push(key);
      totalBytes += bytes.length;
    }
  }
  return { capturedKeys: capturedKeys.sort(), totalBytes };
}
