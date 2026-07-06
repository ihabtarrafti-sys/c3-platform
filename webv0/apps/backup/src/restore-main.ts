/**
 * restore-main.ts — RESTORE CERTIFICATION DRILL (hosted, one-shot).
 *
 * Restores the newest encrypted backup into a UNIQUELY NAMED DISPOSABLE
 * database, verifies schema/migrations/fixtures/counts, proves the live DB was
 * untouched, then DROPS the disposable database and removes all key + temp
 * material. Never restores over the live staging database.
 *
 * Introduced ONLY for this bounded operation (never on the cron service):
 *   - AGE_IDENTITY        (private decryption key)
 *   - RESTORE_ADMIN_URL   (privileged: CREATE/DROP DATABASE + pg_restore)
 *   - DATABASE_URL        (c3_backup read-only, to read live counts)
 *   - R2_* read access
 * The identity + admin URL are used in-process only and never persisted.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { disposableDbName, assertDisposableDbName, REQUIRED_FIXTURES } from './restore';

const log = (event: string, fields?: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: 'info', event, ...fields }));

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], env: env ?? process.env });
    let e = '';
    child.stderr.on('data', (d) => (e += d.toString()));
    child.on('error', reject);
    child.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}: ${e.slice(0, 400)}`))));
  });
}
async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((res, rej) => createReadStream(p).on('data', (c) => h.update(c)).on('end', res).on('error', rej));
  return h.digest('hex');
}

function req(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env: ${k}`);
  return v;
}

async function liveCounts(url: string): Promise<Record<string, number>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const q = async (t: string) => Number((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
    return {
      tenant: await q('tenant'),
      app_user: await q('app_user'),
      external_identity: await q('external_identity'),
      person: await q('person'),
      approval: await q('approval'),
    };
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  const bucket = req('R2_BUCKET');
  const identity = req('AGE_IDENTITY'); // private — in-memory only
  const adminUrl = req('RESTORE_ADMIN_URL');
  const liveReadUrl = req('DATABASE_URL'); // c3_backup

  const s3 = new S3Client({
    region: 'auto',
    endpoint: req('R2_ENDPOINT'),
    credentials: { accessKeyId: req('R2_ACCESS_KEY_ID'), secretAccessKey: req('R2_SECRET_ACCESS_KEY') },
    forcePathStyle: true,
  });

  const tempDir = await fs.mkdtemp(join(tmpdir(), 'c3restore-'));
  const idPath = join(tempDir, 'age.key');
  const encPath = join(tempDir, 'backup.dump.age');
  const dumpPath = join(tempDir, 'backup.dump');
  const dbName = disposableDbName(new Date(), process.pid.toString(36));
  assertDisposableDbName(dbName);

  const admin = new Client({ connectionString: adminUrl });
  let created = false;
  try {
    // Locate newest successful backup.
    const latestRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'status/latest-success.json' }));
    const latest = JSON.parse(Buffer.from(await latestRes.Body!.transformToByteArray()).toString('utf8'));
    log('restore.target', { key: latest.objectKey, manifestKey: latest.manifestKey });

    const manRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: latest.manifestKey }));
    const manifest = JSON.parse(Buffer.from(await manRes.Body!.transformToByteArray()).toString('utf8'));

    // Download + verify encrypted artifact.
    const encRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: latest.objectKey }));
    await fs.writeFile(encPath, Buffer.from(await encRes.Body!.transformToByteArray()));
    const encSha = await sha256File(encPath);
    if (encSha !== manifest.encryptedSha256) throw new Error('Encrypted artifact sha256 mismatch.');
    log('restore.downloaded_verified', { encryptedBytes: (await fs.stat(encPath)).size });

    // Decrypt locally (identity introduced only here).
    await fs.writeFile(idPath, identity.endsWith('\n') ? identity : identity + '\n', { mode: 0o600 });
    await run('age', ['-d', '-i', idPath, '-o', dumpPath, encPath]);
    await fs.rm(idPath, { force: true }); // remove key material asap
    const plainSha = await sha256File(dumpPath);
    if (plainSha !== manifest.plaintextSha256) throw new Error('Decrypted dump sha256 mismatch.');
    log('restore.decrypted_verified', {});

    // Snapshot live counts BEFORE restore (to prove live is untouched).
    const liveBefore = await liveCounts(liveReadUrl);

    // Create disposable DB and restore with no owner / no acl.
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName} WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    created = true;
    const restoreUrl = new URL(adminUrl);
    restoreUrl.pathname = '/' + dbName;
    await run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '-d', restoreUrl.toString(), dumpPath]);
    log('restore.restored', { db: dbName });

    // Verify inside the disposable DB.
    const dc = new Client({ connectionString: restoreUrl.toString() });
    await dc.connect();
    let evidence: Record<string, unknown> = {};
    try {
      const migs = (await dc.query('SELECT id FROM _migrations ORDER BY id')).rows.map((r) => r.id);
      const tenants = (await dc.query('SELECT slug FROM tenant ORDER BY slug')).rows.map((r) => r.slug);
      const persons = (await dc.query('SELECT person_id FROM person ORDER BY person_id')).rows.map((r) => r.person_id);
      const approvals = (await dc.query('SELECT approval_id, status FROM approval ORDER BY approval_id')).rows;
      const identities = Number((await dc.query("SELECT count(*)::int AS n FROM external_identity WHERE provider='entra'")).rows[0].n);
      for (const p of REQUIRED_FIXTURES.persons) if (!persons.includes(p)) throw new Error(`Fixture person ${p} missing in restore.`);
      for (const a of REQUIRED_FIXTURES.approvals) if (!approvals.find((r) => r.approval_id === a)) throw new Error(`Fixture approval ${a} missing in restore.`);
      const restoredCounts = {
        tenant: tenants.length,
        person: persons.length,
        approval: approvals.length,
        external_identity: identities,
      };
      evidence = { migrations: migs, tenants, persons, approvals, restoredCounts };
      log('restore.fixtures_verified', evidence);
    } finally {
      await dc.end();
    }

    // Prove live unchanged.
    const liveAfter = await liveCounts(liveReadUrl);
    const liveUnchanged = JSON.stringify(liveBefore) === JSON.stringify(liveAfter);
    if (!liveUnchanged) throw new Error('Live database counts changed during the restore drill!');
    log('restore.live_unchanged', { liveBefore, liveAfter });

    log('restore.success', { db: dbName, ...evidence });
  } finally {
    // Drop disposable DB + remove all temp/key material.
    if (created) {
      assertDisposableDbName(dbName);
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(async () => {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
      });
      log('restore.disposable_dropped', { db: dbName });
    }
    await admin.end().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true });
    s3.destroy();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({ level: 'error', event: 'restore.failed', message: (err as Error).message }));
    process.exit(1);
  },
);
