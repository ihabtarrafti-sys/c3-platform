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
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { BlobClass, BlobDescriptor } from './blobUniverse';

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
        const dir = join(root, prefix);
        try {
          const names = await readdir(dir);
          return names.map((n) => `${prefix}${n}`);
        } catch (err) {
          if ((err as { code?: string }).code === 'ENOENT') return [];
          throw err;
        }
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
