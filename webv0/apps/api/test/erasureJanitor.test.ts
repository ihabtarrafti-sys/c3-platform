/**
 * HARDEN-3.7 J\u2032 — permanent authority and all three API scheduler entry points.
 *
 * The composed killer uses the real finalize transaction, least-privileged app
 * pool, production filesystem storage driver, scheduler, and authenticated route.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { exitTenant, finalizeTenantExit } from '../../../packages/persistence/src/exitTenant';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import { createDocumentStorage, type DocumentStorage } from '../src/storage';
import {
  createErasureJanitorScheduler,
  createErasureJanitorService,
  runErasureJanitorPass,
} from '../src/erasureJanitor';

const INTERVAL_MS = 200;
const BYTE = Buffer.from('jprime-erased-byte');
const LIVE_BYTE = Buffer.from('jprime-live-byte');

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let documentsDir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().token as string;
}

async function waitUntilMissing(storage: DocumentStorage, key: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await storage.get(key)) === null) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(await storage.get(key), `${key} survived the bounded wait`).toBeNull();
}

beforeAll(async () => {
  db = await startTestDatabase();
  documentsDir = mkdtempSync(join(tmpdir(), 'c3-jprime-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'jprime-test-secret-0000000000',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: documentsDir,
    ERASURE_JANITOR_INTERVAL_MS: String(INTERVAL_MS),
  } as NodeJS.ProcessEnv);
  const logger = createLogger(env);
  warnSpy = vi.spyOn(logger, 'warn');
  deps = buildDeps(env, logger);
  app = buildApp(deps);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
  await db?.stop();
  if (documentsDir) rmSync(documentsDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.truncateAll();
  warnSpy.mockClear();
});

describe('HARDEN-3.7 J\u2032 — composed permanent erasure janitor', () => {
  it('kills real day-8 bytes via owner, boot, and interval while preserving live bytes and permanent authority', async () => {
    const dead = await db.seedTenant({
      slug: 'jprime-dead',
      users: [{ key: 'owner', email: 'gone@jprime.test', displayName: 'Gone', role: 'owner' }],
    });
    const live = await db.seedTenant({
      slug: 'jprime-live',
      users: [
        { key: 'owner', email: 'owner@jprime.test', displayName: 'Owner', role: 'owner' },
        { key: 'ops', email: 'ops@jprime.test', displayName: 'Ops', role: 'operations' },
      ],
    });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `UPDATE app_user SET is_active=false
          WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`,
        [dead.tenantId],
      );
      await exitTenant(admin, {
        tenantSlug: dead.slug, execute: true,
        confirmSlug: dead.slug, secondConfirm: dead.slug,
      });
      await finalizeTenantExit(admin, dead.tenantId, deps.documentStorage);
      expect((await admin.query(`SELECT count(*)::int AS n FROM tenant WHERE id=$1`, [dead.tenantId])).rows[0].n).toBe(0);
      const armed = await admin.query<{ doc_prefix: string; intake_prefix: string }>(
        `SELECT doc_prefix, intake_prefix FROM erased_tenant_prefix WHERE tenant_ref=$1`,
        [dead.tenantId],
      );
      expect(armed.rows).toEqual([{
        doc_prefix: `${dead.tenantId}/`,
        intake_prefix: `intake/${dead.tenantId}/`,
      }]);
      // Simulate a clean day-7 observation, then publication on day 8. This is
      // the exact schedule that the superseded finite window could not cover.
      await admin.query(
        `UPDATE erased_tenant_prefix
            SET finalized_at=now()-interval '8 days',
                last_swept_at=now()-interval '1 day',
                last_result='{"status":"clean","trigger":"interval"}'
          WHERE tenant_ref=$1`,
        [dead.tenantId],
      );
    } finally {
      await admin.end();
    }

    const ownerToken = await login('owner@jprime.test', 'owner', live.slug);
    const opsToken = await login('ops@jprime.test', 'operations', live.slug);
    const endpointKey = `${dead.tenantId}/day8-owner`;
    await deps.documentStorage.put(endpointKey, BYTE, 'application/octet-stream');
    expect((await app.inject({ method: 'POST', url: '/api/v1/settings/erasure-janitor/run' })).statusCode).toBe(401);
    const denied = await app.inject({
      method: 'POST', url: '/api/v1/settings/erasure-janitor/run', headers: auth(opsToken),
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(await deps.documentStorage.get(endpointKey)).toEqual(BYTE);
    const invoked = await app.inject({
      method: 'POST', url: '/api/v1/settings/erasure-janitor/run', headers: auth(ownerToken),
    });
    expect(invoked.statusCode, invoked.body).toBe(200);
    expect(Object.keys(invoked.json()).sort()).toEqual([
      'failures', 'recordsSeen', 'recordsSkipped', 'recordsSwept', 'stragglersDestroyed',
    ]);
    expect(JSON.stringify(invoked.json())).not.toContain(dead.tenantId);
    expect(JSON.stringify(invoked.json())).not.toContain('intake/');
    expect(await deps.documentStorage.get(endpointKey)).toBeNull();

    const deadBootDoc = `${dead.tenantId}/day8-doc`;
    const deadBootIntake = `intake/${dead.tenantId}/day8-intake`;
    const liveDoc = `${live.tenantId}/day8-doc`;
    const liveIntake = `intake/${live.tenantId}/day8-intake`;
    await Promise.all([
      deps.documentStorage.put(deadBootDoc, BYTE, 'application/octet-stream'),
      deps.documentStorage.put(deadBootIntake, BYTE, 'application/octet-stream'),
      deps.documentStorage.put(liveDoc, LIVE_BYTE, 'application/octet-stream'),
      deps.documentStorage.put(liveIntake, LIVE_BYTE, 'application/octet-stream'),
    ]);

    const scheduler = createErasureJanitorScheduler(deps.erasureJanitor, deps.logger);
    let schedulerClosed = false;
    try {
      // start() is the production server's blocking boot catch-up.
      await scheduler.start();
      expect(await deps.documentStorage.get(deadBootDoc)).toBeNull();
      expect(await deps.documentStorage.get(deadBootIntake)).toBeNull();
      expect(await deps.documentStorage.get(liveDoc)).toEqual(LIVE_BYTE);
      expect(await deps.documentStorage.get(liveIntake)).toEqual(LIVE_BYTE);

      let row = (await db.adminQuery<{
        finalized_at: Date; last_swept_at: Date | null; last_result: string; straggler_count: string;
      }>(
        `SELECT finalized_at, last_swept_at, last_result, straggler_count::text
           FROM erased_tenant_prefix WHERE tenant_ref=$1`,
        [dead.tenantId],
      ))[0]!;
      expect(row.finalized_at.getTime()).toBeLessThan(Date.now() - 7 * 86_400_000);
      expect(row.last_swept_at).toBeInstanceOf(Date);
      expect(Number(row.straggler_count)).toBe(3);
      expect(JSON.parse(row.last_result)).toMatchObject({ status: 'stragglers_destroyed', trigger: 'boot', stragglersCaught: 2 });

      const intervalKey = `intake/${dead.tenantId}/day8-interval`;
      await deps.documentStorage.put(intervalKey, BYTE, 'application/octet-stream');
      await waitUntilMissing(deps.documentStorage, intervalKey);
      row = (await db.adminQuery<{
        finalized_at: Date; last_swept_at: Date | null; last_result: string; straggler_count: string;
      }>(
        `SELECT finalized_at, last_swept_at, last_result, straggler_count::text
           FROM erased_tenant_prefix WHERE tenant_ref=$1`,
        [dead.tenantId],
      ))[0]!;
      expect(Number(row.straggler_count)).toBe(4);
      expect(JSON.parse(row.last_result)).toMatchObject({ status: 'stragglers_destroyed', trigger: 'interval' });

      await scheduler.close();
      schedulerClosed = true;
      const stoppedKey = `${dead.tenantId}/after-close`;
      await deps.documentStorage.put(stoppedKey, BYTE, 'application/octet-stream');
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 2 + 50));
      expect(await deps.documentStorage.get(stoppedKey)).toEqual(BYTE);
    } finally {
      if (!schedulerClosed) await scheduler.close();
    }

    const caughtEvents = warnSpy.mock.calls
      .map((call) => call[0] as { event?: string; stragglersCaught?: number })
      .filter((entry) => entry?.event === 'post_finalize_erasure_straggler_caught');
    expect(caughtEvents.reduce((sum, entry) => sum + (entry.stragglersCaught ?? 0), 0)).toBe(4);
    expect((await db.adminQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead.tenantId],
    ))[0]!.n).toBe(1);
  }, 30_000);

  it('queues an owner pass after an active interval already visited the newly dirty row', async () => {
    const first = '00000000-0000-4000-8000-000000000081';
    const second = '00000000-0000-4000-8000-000000000082';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix,finalized_at) VALUES
       ($1,$2,$3,now()-interval '2 days'),($4,$5,$6,now()-interval '1 day')`,
      [first, `${first}/`, `intake/${first}/`, second, `${second}/`, `intake/${second}/`],
    );
    const objects = new Map<string, Buffer>();
    let releaseSecond!: () => void;
    let markBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { markBlocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let shouldBlock = true;
    const storage: DocumentStorage = {
      driver: 'fs',
      async put(key, body) { objects.set(key, Buffer.from(body)); },
      async get(key) { return objects.get(key) ?? null; },
      async listKeys(prefix) {
        if (prefix === `${second}/` && shouldBlock) {
          shouldBlock = false;
          markBlocked();
          await release;
        }
        return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      },
      async delete(key) { objects.delete(key); },
    };
    const service = createErasureJanitorService({ pool: deps.persistence.pool, storage, logger: deps.logger, intervalMs: INTERVAL_MS });
    const intervalRun = service.run('interval');
    await blocked;
    const lateKey = `${first}/after-first-row`;
    objects.set(lateKey, BYTE);
    const ownerRun = service.run('owner');
    releaseSecond();
    expect((await intervalRun).stragglersDestroyed).toBe(0);
    expect((await ownerRun).stragglersDestroyed).toBe(1);
    expect(objects.has(lateKey)).toBe(false);
  });

  it('records every discovered catch even when a later deletion fails and leaves authority retryable', async () => {
    const dead = '00000000-0000-4000-8000-000000000083';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, `${dead}/`, `intake/${dead}/`],
    );
    const first = `${dead}/a`;
    const second = `${dead}/b`;
    const objects = new Map<string, Buffer>([[first, BYTE], [second, BYTE]]);
    const storage: DocumentStorage = {
      driver: 'fs',
      async put(key, body) { objects.set(key, Buffer.from(body)); },
      async get(key) { return objects.get(key) ?? null; },
      async listKeys(prefix) { return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(); },
      async delete(key) {
        if (key === second) throw new Error('injected second delete failure');
        objects.delete(key);
      },
    };
    const result = await runErasureJanitorPass(deps.persistence.pool, storage, deps.logger, 'owner');
    expect(result).toMatchObject({ recordsSwept: 0, failures: 1, stragglersDestroyed: 1 });
    const row = (await db.adminQuery<{ last_swept_at: Date | null; last_result: string; straggler_count: string }>(
      `SELECT last_swept_at,last_result,straggler_count::text FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead],
    ))[0]!;
    expect(row.last_swept_at).toBeNull();
    expect(JSON.parse(row.last_result)).toEqual({ status: 'failed', trigger: 'owner' });
    expect(Number(row.straggler_count)).toBe(2);
    expect(objects.has(first)).toBe(false);
    expect(objects.has(second)).toBe(true);
    expect(warnSpy.mock.calls.some((call) =>
      (call[0] as { event?: string; stragglersCaught?: number }).event === 'post_finalize_erasure_straggler_caught'
      && (call[0] as { stragglersCaught?: number }).stragglersCaught === 2,
    )).toBe(true);
  });

  it('converges when another straggler appears during the same list-delete-relist pass', async () => {
    const dead = '00000000-0000-4000-8000-000000000084';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, `${dead}/`, `intake/${dead}/`],
    );
    const first = `${dead}/first`;
    const second = `${dead}/published-during-pass`;
    const objects = new Map<string, Buffer>([[first, BYTE]]);
    let docLists = 0;
    const storage: DocumentStorage = {
      driver: 'fs',
      async put(key, body) { objects.set(key, Buffer.from(body)); },
      async get(key) { return objects.get(key) ?? null; },
      async listKeys(prefix) {
        if (prefix === `${dead}/` && ++docLists === 2) objects.set(second, BYTE);
        return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      },
      async delete(key) { objects.delete(key); },
    };
    const result = await runErasureJanitorPass(deps.persistence.pool, storage, deps.logger, 'boot');
    expect(result).toMatchObject({ recordsSwept: 1, failures: 0, stragglersDestroyed: 2 });
    expect(objects.size).toBe(0);
    expect((await db.adminQuery<{ n: number }>(
      `SELECT straggler_count::int AS n FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead],
    ))[0]!.n).toBe(2);
  });

  it('uses the permanent-row lock so concurrent API instances delete and count once', async () => {
    const dead = '00000000-0000-4000-8000-000000000086';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, `${dead}/`, `intake/${dead}/`],
    );
    const key = `${dead}/one-owner`;
    const objects = new Map<string, Buffer>([[key, BYTE]]);
    let markLocked!: () => void;
    let releaseLocked!: () => void;
    const locked = new Promise<void>((resolve) => { markLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLocked = resolve; });
    let blockFirstList = true;
    const storage: DocumentStorage = {
      driver: 'fs',
      async put(storageKey, body) { objects.set(storageKey, Buffer.from(body)); },
      async get(storageKey) { return objects.get(storageKey) ?? null; },
      async listKeys(prefix) {
        if (blockFirstList) {
          blockFirstList = false;
          markLocked();
          await release;
        }
        return [...objects.keys()].filter((storageKey) => storageKey.startsWith(prefix)).sort();
      },
      async delete(storageKey) { objects.delete(storageKey); },
    };
    const first = runErasureJanitorPass(deps.persistence.pool, storage, deps.logger, 'interval');
    await locked;
    let second;
    try {
      second = await runErasureJanitorPass(deps.persistence.pool, storage, deps.logger, 'interval');
    } finally {
      // Release the owning pass even when a RED mutation makes the assertion
      // below fail; the discriminator must never strand a pool client.
      releaseLocked();
    }
    expect(second).toMatchObject({ recordsSeen: 1, recordsSwept: 0, recordsSkipped: 1, stragglersDestroyed: 0 });
    expect(await first).toMatchObject({ recordsSeen: 1, recordsSwept: 1, recordsSkipped: 0, stragglersDestroyed: 1 });
    expect(objects.size).toBe(0);
    expect((await db.adminQuery<{ n: number }>(
      `SELECT straggler_count::int AS n FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead],
    ))[0]!.n).toBe(1);
  });

  it('contains no application retirement path for permanent authority', () => {
    const productionPaths = [
      '../src/erasureJanitor.ts', '../src/app.ts', '../src/deps.ts', '../src/server.ts',
      '../../../packages/persistence/src/exitTenant.ts',
    ];
    const productionSources = productionPaths
      .map((relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')).join('\n');
    expect(productionSources).not.toMatch(/DELETE\s+FROM\s+erased_tenant_prefix/i);
    expect(productionSources).not.toMatch(/\bsweep_until\b/i);
    const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const bootAt = serverSource.indexOf("await janitorScheduler.start()");
    const listenAt = serverSource.indexOf('await app.listen');
    expect(bootAt, 'production server must invoke the boot pass').toBeGreaterThan(-1);
    expect(listenAt, 'production server must listen').toBeGreaterThan(bootAt);
    expect(serverSource).toContain('await janitorScheduler.close()');
    const migrationWithoutComments = readFileSync(
      new URL('../../../packages/persistence/migrations/0078_erased_tenant_prefix.sql', import.meta.url), 'utf8',
    ).replace(/^\s*--.*$/gm, '');
    expect(migrationWithoutComments).not.toMatch(/\bsweep_until\b|DELETE\s+FROM\s+erased_tenant_prefix/i);
  });

  it('uses real paginated R2 listing and DeleteObject for the production driver', async () => {
    const prefix = '00000000-0000-4000-8000-000000000085/';
    const deleted: string[] = [];
    const listTokens: Array<string | null> = [];
    const peer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const token = url.searchParams.get('continuation-token');
        listTokens.push(token);
        const key = token ? `${prefix}second` : `${prefix}first`;
        const truncated = token ? 'false' : 'true';
        const next = token ? '' : '<NextContinuationToken>page-2</NextContinuationToken>';
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>documents</Name><Prefix>${prefix}</Prefix><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>` +
          `<IsTruncated>${truncated}</IsTruncated>${next}` +
          `<Contents><Key>${key}</Key><LastModified>2026-07-15T00:00:00.000Z</LastModified>` +
          `<ETag>&quot;etag&quot;</ETag><Size>1</Size><StorageClass>STANDARD</StorageClass></Contents>` +
          `</ListBucketResult>`,
        );
        return;
      }
      if (req.method === 'DELETE') {
        deleted.push(decodeURIComponent(url.pathname.replace(/^\/documents\//, '')));
        req.resume();
        res.writeHead(204).end();
        return;
      }
      req.resume();
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      peer.once('error', reject);
      peer.listen(0, '127.0.0.1', resolve);
    });
    try {
      const port = (peer.address() as { port: number }).port;
      const storage = createDocumentStorage({
        driver: 'r2', endpoint: `http://127.0.0.1:${port}`,
        accessKeyId: 'jprime-access', secretAccessKey: 'jprime-secret', bucket: 'documents',
      });
      const keys = await storage.listKeys(prefix);
      expect(keys).toEqual([`${prefix}first`, `${prefix}second`]);
      expect(listTokens).toEqual([null, 'page-2']);
      await Promise.all(keys.map((key) => storage.delete(key)));
      expect(deleted.sort()).toEqual(keys);
    } finally {
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  });
});
