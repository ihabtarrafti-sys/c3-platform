/**
 * storage.ts — the document BLOB store behind the API (S4). Metadata lives in
 * Postgres (RLS); bytes live here under a tenant-scoped, server-generated key
 * that is never user input. Two drivers behind one port:
 *
 *   - r2: private Cloudflare R2 via the S3 API (the backup app's pattern:
 *     region auto, path-style, endpoint = the account's R2 endpoint).
 *     PRODUCTION REQUIRES THIS (env validation fails closed).
 *   - fs: a local directory for dev/test — keys map to sub-paths after a
 *     strict character check (keys are server-generated UUID paths, but the
 *     check makes traversal structurally impossible anyway).
 *
 * `delete` exists ONLY for the attach compensation path (blob stored, metadata
 * registration failed) — the API never exposes deletion; removal is the soft
 * metadata flip.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Env } from './env';

export const R2_HTTP_HANDLER_OPTIONS = {
  connectionTimeout: 10_000,
  requestTimeout: 120_000,
  throwOnRequestTimeout: true,
} as const;

export interface DocumentStorage {
  readonly driver: 'r2' | 'fs';
  /**
   * HARDEN-3.5 A / HARDEN-3.6 T2: `opts.signal` is the request deadline and aborts the local
   * operation. A-2 uses SINGLE-SHOT PutObject (no multipart), but local rejection is not proof
   * of remote non-publication after R2 received a full body; R2 publishes no maximum for that
   * indeterminate completion window.
   */
  put(key: string, body: Buffer, contentType: string, opts?: { signal?: AbortSignal }): Promise<void>;
  get(key: string, opts?: { signal?: AbortSignal }): Promise<Buffer | null>;
  /** Compensation only (failed registration) — never a user-facing operation. */
  delete(key: string, opts?: { signal?: AbortSignal }): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_-]+$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Unsafe storage key.');
}

function createR2Storage(cfg: Extract<Env['documents'], { driver: 'r2' }>): DocumentStorage {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
    // HARDEN-3.5 A (belt): even a signal-less call cannot hang a socket forever — the handler
    // itself bounds connection establishment and per-request socket lifetime.
    requestHandler: R2_HTTP_HANDLER_OPTIONS,
  });
  return {
    driver: 'r2',
    async put(key, body, contentType, opts) {
      assertSafeKey(key);
      // A-2: single-shot PutObject (never lib-storage multipart). The signal aborts the local
      // operation. The retained failure lease bounds local exit parking, not R2 publication.
      await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }), { abortSignal: opts?.signal });
    },
    async get(key, opts) {
      assertSafeKey(key);
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { abortSignal: opts?.signal });
        const bytes = await res.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async delete(key, opts) {
      assertSafeKey(key);
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }), { abortSignal: opts?.signal });
    },
  };
}

function createFsStorage(dir: string): DocumentStorage {
  return {
    driver: 'fs',
    async put(key, body, _contentType, opts) {
      assertSafeKey(key);
      // The deadline signal aborts the write exactly like the R2 driver (node:fs supports it).
      if (opts?.signal?.aborted) throw (opts.signal.reason as Error) ?? new Error('aborted');
      const path = join(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body, { signal: opts?.signal });
    },
    async get(key, opts) {
      assertSafeKey(key);
      try {
        return await readFile(join(dir, key), { signal: opts?.signal });
      } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT') return null;
        throw err;
      }
    },
    async delete(key, _opts) {
      assertSafeKey(key);
      await rm(join(dir, key), { force: true });
    },
  };
}

export function createDocumentStorage(cfg: Env['documents']): DocumentStorage {
  return cfg.driver === 'r2' ? createR2Storage(cfg) : createFsStorage(cfg.dir);
}
