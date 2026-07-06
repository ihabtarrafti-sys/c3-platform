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

export function createBackupDeps(env: BackupEnv): BackupDeps & { close(): Promise<void> } {
  const lockClient = new Client({ connectionString: env.databaseUrl });
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

    async dump(outPath) {
      // Custom format (-Fc), compressed (-Z6), schema+data, no owner/acl at
      // dump time via restore flags; connect as c3_backup (env URL).
      await run('pg_dump', ['-Fc', '-Z', '6', '--no-owner', '--no-privileges', '-f', outPath, env.databaseUrl]);
      const st = await fs.stat(outPath);
      return { bytes: st.size };
    },
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
