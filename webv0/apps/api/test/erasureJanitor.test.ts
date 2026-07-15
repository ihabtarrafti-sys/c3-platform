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
import { Client, type Pool } from 'pg';
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
  it('HARDEN-3.8 H1 refuses privileged canonical authority for a live tenant at COMMIT', async () => {
    const live = await db.seedTenant({ slug: 'h38-live-authority' });
    const liveKey = `${live.tenantId}/must-survive`;
    await deps.documentStorage.put(liveKey, LIVE_BYTE, 'application/octet-stream');
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    let commitRefused = false;
    try {
      await admin.query('BEGIN');
      await admin.query(
        `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix)
         VALUES ($1,$2,$3)`,
        [live.tenantId, `${live.tenantId}/`, `intake/${live.tenantId}/`],
      );
      try {
        await admin.query('COMMIT');
      } catch (error) {
        commitRefused = true;
        expect(String((error as Error).message)).toMatch(/ERASED_PREFIX_LIVE_TENANT|dead-only/i);
        await admin.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      await admin.end();
    }

    // The real janitor completes the named confused-deputy schedule. RED: remove
    // only the 0079 constraint trigger and this becomes
    // { commitRefused:false, authorityRows:1, stragglersDestroyed:1,
    //   liveObjectPresent:false }.
    const janitor = await runErasureJanitorPass(deps.persistence.pool, deps.documentStorage, deps.logger, 'owner');
    const authorityRows = (await db.adminQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM erased_tenant_prefix WHERE tenant_ref=$1`,
      [live.tenantId],
    ))[0]!.n;
    expect({
      commitRefused,
      authorityRows,
      stragglersDestroyed: janitor.stragglersDestroyed,
      liveObjectPresent: (await deps.documentStorage.get(liveKey)) !== null,
    }).toEqual({
      commitRefused: true,
      authorityRows: 0,
      stragglersDestroyed: 0,
      liveObjectPresent: true,
    });
  });

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
      'failures', 'incomplete', 'recordsSeen', 'recordsSkipped', 'recordsSwept', 'stragglersDestroyed',
    ]);
    expect(invoked.json().incomplete).toBe(false);
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
      // Production starts the boot safety pass before readiness and waits up to
      // its budget. This small real pass completes within that budget.
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

  it('returns an explicit rerun signal instead of coalescing with an already-active owner pass', async () => {
    const dead = '00000000-0000-4000-8000-000000000088';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, `${dead}/`, `intake/${dead}/`],
    );
    let markBlocked!: () => void;
    let releaseBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { markBlocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseBlocked = resolve; });
    let blockOnce = true;
    const storage: DocumentStorage = {
      driver: 'fs',
      async put() {},
      async get() { return null; },
      async listKeys() {
        if (blockOnce) {
          blockOnce = false;
          markBlocked();
          await release;
        }
        return [];
      },
      async delete() {},
    };
    const service = createErasureJanitorService({
      pool: deps.persistence.pool, storage, logger: deps.logger, intervalMs: INTERVAL_MS,
    });
    const first = service.run('owner');
    await blocked;
    const second = service.run('owner');
    const bounded = await Promise.race([
      second.then((result) => ({ kind: 'result' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 150)),
    ]);
    try {
      expect(bounded).toMatchObject({ kind: 'result', result: { incomplete: true } });
    } finally {
      releaseBlocked();
      await Promise.all([first, second]);
    }
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
    expect(result).toMatchObject({ recordsSwept: 0, failures: 1, stragglersDestroyed: 1, incomplete: true });
    const row = (await db.adminQuery<{ last_swept_at: Date | null; last_result: string; straggler_count: string }>(
      `SELECT last_swept_at,last_result,straggler_count::text FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead],
    ))[0]!;
    expect(row.last_swept_at).toBeNull();
    expect(JSON.parse(row.last_result)).toEqual({ status: 'failed', trigger: 'owner' });
    expect(Number(row.straggler_count)).toBe(2);
    const audit = await db.adminQuery<{
      tenant_id: string | null; entity_type: string; entity_id: string;
      action: string; actor: string; before: unknown; after: Record<string, unknown>;
    }>(
      `SELECT tenant_id,entity_type,entity_id,action,actor,before,after
         FROM audit_event
        WHERE action='post_finalize_erasure_straggler_caught'`,
    );
    expect(audit).toEqual([{
      tenant_id: null,
      entity_type: 'platform',
      entity_id: dead,
      action: 'post_finalize_erasure_straggler_caught',
      actor: 'c3-erasure-janitor',
      before: null,
      after: { trigger: 'owner', stragglersCaught: 2 },
    }]);
    expect(objects.has(first)).toBe(false);
    expect(objects.has(second)).toBe(true);
    expect(warnSpy.mock.calls.some((call) =>
      (call[0] as { event?: string; stragglersCaught?: number }).event === 'post_finalize_erasure_straggler_caught'
      && (call[0] as { stragglersCaught?: number }).stragglersCaught === 2,
    )).toBe(true);
  });

  it('rolls catch telemetry back and retains the object when durable audit insertion fails', async () => {
    const dead = '00000000-0000-4000-8000-000000000092';
    const key = `${dead}/audit-must-commit-first`;
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, `${dead}/`, `intake/${dead}/`],
    );
    await deps.documentStorage.put(key, BYTE, 'application/octet-stream');
    await db.adminQuery(`
      CREATE FUNCTION public.h38_reject_erasure_audit() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'injected durable audit failure';
      END
      $fn$;
      CREATE TRIGGER h38_reject_erasure_audit
      BEFORE INSERT ON audit_event
      FOR EACH ROW
      WHEN (NEW.action = 'post_finalize_erasure_straggler_caught')
      EXECUTE FUNCTION public.h38_reject_erasure_audit();
    `);
    try {
      const result = await runErasureJanitorPass(
        deps.persistence.pool, deps.documentStorage, deps.logger, 'owner', { progressTimeoutMs: 1_000 },
      );
      expect(result).toMatchObject({ recordsSwept: 0, failures: 1, incomplete: true });
      expect(await deps.documentStorage.get(key)).toEqual(BYTE);
      const state = (await db.adminQuery<{ authority: number; count: number; audits: number }>(
        `SELECT
           (SELECT count(*)::int FROM erased_tenant_prefix WHERE tenant_ref=$1) AS authority,
           (SELECT straggler_count::int FROM erased_tenant_prefix WHERE tenant_ref=$1) AS count,
           (SELECT count(*)::int FROM audit_event
             WHERE action='post_finalize_erasure_straggler_caught' AND entity_id=$1::text) AS audits`,
        [dead],
      ))[0]!;
      expect(state).toEqual({ authority: 1, count: 0, audits: 0 });
    } finally {
      await db.adminQuery(`
        DROP TRIGGER IF EXISTS h38_reject_erasure_audit ON audit_event;
        DROP FUNCTION IF EXISTS public.h38_reject_erasure_audit();
      `);
    }
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
      second = await runErasureJanitorPass(deps.persistence.pool, storage, deps.logger, 'owner');
    } finally {
      // Release the owning pass even when a RED mutation makes the assertion
      // below fail; the discriminator must never strand a pool client.
      releaseLocked();
    }
    expect(second).toMatchObject({
      recordsSeen: 1, recordsSwept: 0, recordsSkipped: 1, stragglersDestroyed: 0, incomplete: true,
    });
    expect(await first).toMatchObject({
      recordsSeen: 1, recordsSwept: 1, recordsSkipped: 0, stragglersDestroyed: 1, incomplete: false,
    });
    expect(objects.size).toBe(0);
    expect((await db.adminQuery<{ n: number }>(
      `SELECT straggler_count::int AS n FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead],
    ))[0]!.n).toBe(1);
  });

  it('bounds a non-cooperative storage call and releases the row for a later pass', async () => {
    const dead = '00000000-0000-4000-8000-000000000089';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, `${dead}/`, `intake/${dead}/`],
    );
    const key = `${dead}/stuck-list`;
    const objects = new Map<string, Buffer>([[key, BYTE]]);
    let markLocked!: () => void;
    let releaseStuck!: () => void;
    const locked = new Promise<void>((resolve) => { markLocked = resolve; });
    const stuck = new Promise<void>((resolve) => { releaseStuck = resolve; });
    let blockOnce = true;
    const storage: DocumentStorage = {
      driver: 'fs',
      async put(storageKey, body) { objects.set(storageKey, Buffer.from(body)); },
      async get(storageKey) { return objects.get(storageKey) ?? null; },
      async listKeys(prefix) {
        if (blockOnce) {
          blockOnce = false;
          markLocked();
          await stuck; // deliberately ignores AbortSignal
        }
        return [...objects.keys()].filter((storageKey) => storageKey.startsWith(prefix)).sort();
      },
      async delete(storageKey) { objects.delete(storageKey); },
    };
    const first = runErasureJanitorPass(
      deps.persistence.pool, storage, deps.logger, 'interval', { progressTimeoutMs: 50 },
    );
    await locked;
    const whileLocked = await runErasureJanitorPass(
      deps.persistence.pool, storage, deps.logger, 'owner', { progressTimeoutMs: 50 },
    );
    const bounded = await Promise.race([
      first.then((result) => ({ kind: 'result' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 250)),
    ]);
    releaseStuck();
    try {
      expect(whileLocked).toMatchObject({ recordsSkipped: 1, incomplete: true });
      expect(bounded).toMatchObject({ kind: 'result', result: { failures: 1, incomplete: true } });
      const retry = await runErasureJanitorPass(
        deps.persistence.pool, storage, deps.logger, 'owner', { progressTimeoutMs: 50 },
      );
      expect(retry).toMatchObject({ recordsSwept: 1, stragglersDestroyed: 1, incomplete: false });
      expect(objects.size).toBe(0);
    } finally {
      releaseStuck();
      await first.catch(() => undefined);
    }
  });

  it('fails a real cyclic R2 pass closed and releases its authority row for retry', async () => {
    const dead = '00000000-0000-4000-8000-000000000093';
    const prefix = `${dead}/`;
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix) VALUES ($1,$2,$3)`,
      [dead, prefix, `intake/${dead}/`],
    );
    const repeatedToken = 'opaque-composed-cycle';
    let cyclic = true;
    let cyclicRequests = 0;
    const peer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.searchParams.get('list-type') !== '2') {
        req.resume();
        res.writeHead(404).end();
        return;
      }
      if (!cyclic) {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>documents</Name><Prefix>${url.searchParams.get('prefix') ?? ''}</Prefix>` +
          `<KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>` +
          `</ListBucketResult>`,
        );
        return;
      }
      cyclicRequests += 1;
      // RED cleanup: an absent cycle guard reaches this bounded stall after
      // several advancing callbacks; the janitor deadline then aborts it.
      if (cyclicRequests > 8) return;
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
        `<Name>documents</Name><Prefix>${prefix}</Prefix><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>` +
        `<IsTruncated>true</IsTruncated><NextContinuationToken>${repeatedToken}</NextContinuationToken>` +
        `<Contents><Key>${prefix}straggler</Key><LastModified>2026-07-15T00:00:00.000Z</LastModified>` +
        `<ETag>&quot;etag&quot;</ETag><Size>1</Size><StorageClass>STANDARD</StorageClass></Contents>` +
        `</ListBucketResult>`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      peer.once('error', reject);
      peer.listen(0, '127.0.0.1', resolve);
    });
    try {
      const port = (peer.address() as { port: number }).port;
      const storage = createDocumentStorage({
        driver: 'r2', endpoint: `http://127.0.0.1:${port}`,
        accessKeyId: 'h2-composed-access', secretAccessKey: 'h2-composed-secret', bucket: 'documents',
      });
      const failed = await runErasureJanitorPass(
        deps.persistence.pool, storage, deps.logger, 'owner', { progressTimeoutMs: 80 },
      );
      expect(failed).toMatchObject({ recordsSwept: 0, failures: 1, incomplete: true });
      expect(cyclicRequests).toBe(2);
      expect((await db.adminQuery<{ swept: boolean }>(
        `SELECT last_swept_at IS NOT NULL AS swept FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead],
      ))[0]!.swept).toBe(false);

      cyclic = false;
      const retry = await runErasureJanitorPass(
        deps.persistence.pool, storage, deps.logger, 'owner', { progressTimeoutMs: 500 },
      );
      expect(retry).toMatchObject({ recordsSwept: 1, failures: 0, incomplete: false });
    } finally {
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  }, 10_000);

  it('counts a pool checkout failure per candidate and continues the pass', async () => {
    const first = '00000000-0000-4000-8000-000000000090';
    const second = '00000000-0000-4000-8000-000000000091';
    await db.adminQuery(
      `INSERT INTO erased_tenant_prefix (tenant_ref,doc_prefix,intake_prefix,finalized_at) VALUES
       ($1,$2,$3,now()-interval '2 days'),($4,$5,$6,now()-interval '1 day')`,
      [first, `${first}/`, `intake/${first}/`, second, `${second}/`, `intake/${second}/`],
    );
    let checkoutCalls = 0;
    const realPool = deps.persistence.pool;
    const checkoutFaultPool = {
      query: realPool.query.bind(realPool),
      async connect() {
        checkoutCalls += 1;
        if (checkoutCalls === 1) throw new Error('injected checkout failure');
        return realPool.connect();
      },
    } as unknown as Pool;
    const result = await runErasureJanitorPass(
      checkoutFaultPool, deps.documentStorage, deps.logger, 'boot', { progressTimeoutMs: 1_000 },
    );
    expect(result).toMatchObject({
      recordsSeen: 2, recordsSwept: 1, recordsSkipped: 0, failures: 1, incomplete: true,
    });
    const rows = await db.adminQuery<{ tenant_ref: string; swept: boolean }>(
      `SELECT tenant_ref, last_swept_at IS NOT NULL AS swept
         FROM erased_tenant_prefix ORDER BY finalized_at, tenant_ref`,
    );
    expect(rows).toEqual([
      { tenant_ref: first, swept: false },
      { tenant_ref: second, swept: true },
    ]);
  });

  it('starts boot before readiness but releases startup at the documented budget', async () => {
    let releaseBoot!: (result: Awaited<ReturnType<typeof runErasureJanitorPass>>) => void;
    const boot = new Promise<Awaited<ReturnType<typeof runErasureJanitorPass>>>((resolve) => {
      releaseBoot = resolve;
    });
    const empty = {
      recordsSeen: 0, recordsSwept: 0, recordsSkipped: 0,
      stragglersDestroyed: 0, failures: 0, incomplete: false,
    };
    const run = vi.fn((trigger: 'boot' | 'interval' | 'owner') =>
      trigger === 'boot' ? boot : Promise.resolve(empty));
    const scheduler = createErasureJanitorScheduler(
      { intervalMs: 10_000, run },
      deps.logger,
      { bootReadinessBudgetMs: 40 },
    );
    const start = scheduler.start();
    const bounded = await Promise.race([
      start.then(() => 'ready' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ]);
    try {
      expect(run).toHaveBeenCalledWith('boot');
      expect(bounded).toBe('ready');
      expect(warnSpy.mock.calls.some((call) =>
        (call[0] as { event?: string; bootReadinessBudgetMs?: number }).event
          === 'post_finalize_erasure_janitor_boot_readiness_budget_exhausted'
        && (call[0] as { bootReadinessBudgetMs?: number }).bootReadinessBudgetMs === 40,
      )).toBe(true);
    } finally {
      releaseBoot(empty);
      await start;
      await scheduler.close();
    }
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
