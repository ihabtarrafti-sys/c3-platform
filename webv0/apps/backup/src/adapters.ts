/**
 * adapters.ts — the real effect implementations (pg_dump, age, sha256, R2,
 * advisory lock). Thin by design: all decision logic lives in runner.ts. These
 * are exercised by the hosted backup + restore drill, not the local unit gate.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { BackupDeps } from './runner';
import type { BackupEnv } from './env';
import type { BlobArchiveEntry } from './manifest';
import { coherentDumpAndCensusFlow, pgDumpArgs, runWithLockWaitRetry, resolveCensusPause, type CoherentIo } from './coherentFlow';

const ADVISORY_LOCK_KEY = 928_340_014; // arbitrary fixed key for the backup lock

/** Spawn a command, fail on non-zero. Never logs args (may carry a URL). */
function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], env: opts.env ?? process.env });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`))));
  });
}

function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * R3-N06: the census transaction MUST be REPEATABLE READ so its snapshot is pinned at
 * `pg_export_snapshot()` and shared with `pg_dump --snapshot` — under READ COMMITTED every
 * statement takes a fresh snapshot and the census silently diverges from the dump. Exported
 * (and used below) so the real-DB census test can prove exactly this isolation level.
 */
export const CENSUS_TX_BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

/**
 * H-08 (Option A) / R3-N06: every blob object across all tenants, DB-authoritative.
 * Runs on a CALLER-SUPPLIED connection so all three class queries share ONE snapshot
 * (sequential in the caller's transaction — NOT Promise.all, which would be three
 * implicit txns). Deterministic order for stable coverage diffs. Exported for the
 * real-DB same-snapshot census test.
 */
export async function enumerateBlobsInTx(c: Client): Promise<BlobArchiveEntry[]> {
  const q = async (sql: string, cls: BlobArchiveEntry['cls']): Promise<BlobArchiveEntry[]> =>
    (await c.query(sql)).rows.map((r: { key: string; sha: string }) => ({ storageKey: r.key, sha256: r.sha, cls }));
  const docs = await q(`SELECT storage_key AS key, sha256 AS sha FROM document WHERE sha256 ~ '^[a-f0-9]{64}$' ORDER BY storage_key`, 'document');
  const photos = await q(`SELECT photo_storage_key AS key, photo_sha256 AS sha FROM person WHERE photo_storage_key IS NOT NULL AND photo_sha256 ~ '^[a-f0-9]{64}$' ORDER BY photo_storage_key`, 'photo');
  const intake = await q(
    `SELECT u->>'storageKey' AS key, u->>'sha256' AS sha FROM intake_submission s, jsonb_array_elements(s.uploads) u
      WHERE s.status = 'Pending' AND u->>'storageKey' IS NOT NULL AND u->>'sha256' ~ '^[a-f0-9]{64}$' ORDER BY u->>'storageKey'`,
    'intake',
  );
  return [...docs, ...photos, ...intake];
}

export function createBackupDeps(env: BackupEnv): BackupDeps & { close(): Promise<void> } {
  const lockClient = new Client({ connectionString: env.databaseUrl, application_name: 'c3-backup-exporter' });
  const s3 = new S3Client({
    region: 'auto',
    endpoint: env.r2Endpoint,
    credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey },
    forcePathStyle: true,
  });
  let lockConnected = false;

  async function queryScalar(sql: string): Promise<string> {
    const c = new Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      const r = await c.query(sql);
      return String(Object.values(r.rows[0] ?? { v: '' })[0]);
    } finally {
      await c.end();
    }
  }

  return {
    now: () => new Date(),
    serverVersion: () => queryScalar('SHOW server_version'),
    async migrations() {
      const c = new Client({ connectionString: env.databaseUrl });
      await c.connect();
      try {
        const r = await c.query('SELECT id FROM _migrations ORDER BY id');
        return r.rows.map((x) => x.id as string);
      } finally {
        await c.end();
      }
    },
    pgDumpVersion: () => capture('pg_dump', ['--version']),

    // H-08: census the object store from the DB (c3_backup reads every tenant).
    // Per class: a count + a representative {storageKey, sha256} the restore
    // drill fetches + hash-checks. Only rows with a verifiable sha256 count.
    async coherentDumpAndCensus(dumpPath: string): Promise<{ bytes: number; blobs: BlobArchiveEntry[] }> {
      // R3-N06: ONE coherent image — the blob census and pg_dump read the IDENTICAL MVCC
      // snapshot, so no between-reads delete/insert can make them incoherent. The ordering
      // and snapshot-threading are in coherentDumpAndCensusFlow (unit-tested); here we supply
      // the real pg / pg_dump effects. READ ONLY + REPEATABLE READ takes no DML-blocking locks.
      // HARDEN-3.7 U5: this is the actual snapshot/census session observed by the R4-N09
      // runbook. Naming only the advisory-lock client leaves the blocking session invisible.
      const c = new Client({ connectionString: env.databaseUrl, application_name: 'c3-backup-exporter' });
      await c.connect();
      // R4-N09 ceremony: null unless BACKUP_PAUSE_AFTER_CENSUS is explicitly set (inert default).
      const censusPause = resolveCensusPause(process.env);
      const io: CoherentIo = {
        ...(censusPause ? { pauseBeforeDump: censusPause } : {}),
        begin: async () => { await c.query(CENSUS_TX_BEGIN); },
        exportSnapshot: async () => String((await c.query('SELECT pg_export_snapshot() AS id')).rows[0].id),
        enumerate: () => enumerateBlobsInTx(c),
        // R4-N09: pg_dump with --lock-wait-timeout (via pgDumpArgs) + a bounded retry, so a
        // lock-queue cycle fails fast and retries rather than hanging the exporter indefinitely.
        runDump: (snapshotId) =>
          runWithLockWaitRetry(() => run('pg_dump', pgDumpArgs(dumpPath, env.databaseUrl, snapshotId)), {
            onRetry: (attempt) => console.warn(JSON.stringify({ event: 'backup.pg_dump_lock_retry', attempt })),
          }),
        commit: async () => { await c.query('COMMIT'); },
        rollback: async () => { await c.query('ROLLBACK'); },
        dumpBytes: async () => (await fs.stat(dumpPath)).size,
      };
      try {
        return await coherentDumpAndCensusFlow(io);
      } finally {
        await c.end();
      }
    },

    // H-08 (Option A): capture every blob's BYTES into a plaintext tar, downloaded
    // from the live documents bucket and sha-verified against the DB at capture.
    // Uses a dedicated documents READ credential when configured so the backup's
    // write key is not widened; the runner then encrypts + uploads this archive.
    async snapshotBlobs(destPath: string, blobs: BlobArchiveEntry[]): Promise<{ entries: BlobArchiveEntry[] }> {
      if (blobs.length === 0) return { entries: [] };
      const docsBucket = process.env.R2_BUCKET_DOCUMENTS;
      if (!docsBucket) {
        throw new Error(`Cannot snapshot ${blobs.length} blob object(s): R2_BUCKET_DOCUMENTS is not set (needed to read live objects for the independent archive).`);
      }
      const docsS3 = process.env.R2_DOCUMENTS_ACCESS_KEY_ID
        ? new S3Client({
            region: 'auto',
            endpoint: env.r2Endpoint,
            credentials: { accessKeyId: process.env.R2_DOCUMENTS_ACCESS_KEY_ID, secretAccessKey: process.env.R2_DOCUMENTS_SECRET_ACCESS_KEY! },
            forcePathStyle: true,
          })
        : s3;
      const stagingDir = await fs.mkdtemp(join(tmpdir(), 'c3blobs-'));
      try {
        for (const e of blobs) {
          if (e.storageKey.includes('..')) throw new Error(`Unsafe storage key in snapshot: ${e.storageKey}`);
          // R3-N06 fail-closed: a key in the census but MISSING from R2 (a concurrent
          // tenant-exit deleted it) REFUSES the backup — never a silent skip.
          let res;
          try {
            res = await docsS3.send(new GetObjectCommand({ Bucket: docsBucket, Key: e.storageKey }));
          } catch (err) {
            throw new Error(`Blob '${e.storageKey}' is in the DB census but missing from the store — refusing to sign an incomplete archive (${(err as Error).message}).`);
          }
          const buf = Buffer.from(await res.Body!.transformToByteArray());
          const sha = createHash('sha256').update(buf).digest('hex');
          if (sha !== e.sha256) throw new Error(`Blob '${e.storageKey}' hash mismatch at capture (db ${e.sha256}, live ${sha}).`);
          const outPath = join(stagingDir, e.storageKey);
          await fs.mkdir(join(outPath, '..'), { recursive: true });
          await fs.writeFile(outPath, buf);
        }
        // tar the staging dir; member paths ARE the storage keys (extract reads by key).
        await run('tar', ['-cf', destPath, '-C', stagingDir, '.']);
        return { entries: blobs };
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    },

    async acquireLock() {
      await lockClient.connect();
      lockConnected = true;
      const r = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
      return r.rows[0].ok === true;
    },
    async releaseLock() {
      if (lockConnected) {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
        await lockClient.end().catch(() => {});
        lockConnected = false;
      }
    },

    makeTempDir: () => fs.mkdtemp(join(tmpdir(), 'c3bkp-')),
    cleanupTempDir: (dir) => fs.rm(dir, { recursive: true, force: true }),

    sha256File,
    fileSize: async (p) => (await fs.stat(p)).size,

    async encrypt(inPath, outPath, recipient) {
      await run('age', ['-r', recipient, '-o', outPath, inPath]);
    },
    removeFile: (p) => fs.rm(p, { force: true }),

    async uploadFile(key, path, contentType) {
      const body = await fs.readFile(path);
      await s3.send(new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async uploadBytes(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async verifyObject(key, expectedSha256, expectedBytes) {
      const res = await s3.send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }));
      const buf = Buffer.from(await res.Body!.transformToByteArray());
      if (buf.byteLength !== expectedBytes) {
        throw new Error(`Verify failed: size ${buf.byteLength} != ${expectedBytes}`);
      }
      const sha = createHash('sha256').update(buf).digest('hex');
      if (sha !== expectedSha256) throw new Error('Verify failed: sha256 mismatch on uploaded object.');
    },
    async readBytes(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray()).toString('utf8');
    },

    log(event, fields) {
      // Structured, redacted: only whitelisted non-secret fields are emitted.
      console.log(JSON.stringify({ level: 'info', event, ...fields }));
    },

    async close() {
      await this.releaseLock();
      s3.destroy();
    },
  };
}
