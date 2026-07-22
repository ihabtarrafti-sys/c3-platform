/**
 * commsReceipts.test.ts (api) — the Battle-#1 receipts mechanism over HTTP:
 * the monotonic self-scoped cursor, the DERIVED disclosure with the
 * receipts_enabled_since watermark (the privacy contract end-to-end), the
 * three-way prefs CAS, and lapse survival (own record, own privacy).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

const tokens = {} as { ops: string; owner: string; visitor: string };
const uids = {} as { ops: string; owner: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function uidOf(email: string): Promise<string> {
  const rows = await db.adminQuery<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [email]);
  return rows[0]!.id;
}

async function createMissionWithMessages(n: number): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Receipts Cup', startsOn: '2026-09-01' } });
  expect(res.statusCode, res.body).toBe(201);
  const missionId = res.json().mission.missionId as string;
  for (let i = 0; i < n; i++) {
    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: `message ${i + 1}`, clientMutationId: randomUUID() },
    });
    expect(post.statusCode, post.body).toBe(201);
  }
  return missionId;
}

const read = (token: string, missionId: string, seq: number) =>
  app.inject({ method: 'POST', url: `/api/v1/comms/missions/${missionId}/read`, headers: auth(token), payload: { seq } });
const receiptsOf = async (token: string, missionId: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/receipts`, headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().receipts as Array<{ userId: string; lastReadSeq: number; readAt: string }>;
};
const setPrefs = (token: string, receiptsEnabled: boolean, expectedVersion: number | null) =>
  app.inject({ method: 'POST', url: '/api/v1/comms/prefs', headers: auth(token), payload: { receiptsEnabled, presenceEnabled: true, expectedVersion } });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-receipts-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: 'alpha' });
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  uids.ops = await uidOf('ops@alpha.com');
  uids.owner = await uidOf('owner@alpha.com');
  uids.visitor = await uidOf('visitor@alpha.com');
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
});

describe('receipts — the cursor + watermark derive (Battle #1)', () => {
  it('the cursor is monotonic and SELF-scoped; out-of-range seq refuses; myLastReadSeq surfaces', async () => {
    const missionId = await createMissionWithMessages(2);
    expect((await read(tokens.visitor, missionId, 1)).json()).toMatchObject({ lastReadSeq: 1 });
    expect((await read(tokens.visitor, missionId, 2)).json()).toMatchObject({ lastReadSeq: 2 });
    // A regressive read is ELIDED — the cursor never moves backward.
    expect((await read(tokens.visitor, missionId, 1)).json()).toMatchObject({ lastReadSeq: 2 });
    // Beyond the thread refuses.
    expect((await read(tokens.visitor, missionId, 99)).statusCode).toBe(400);
    // SELF-scoped: the visitor's reads never touched anyone else's cursor.
    const receipts = await receiptsOf(tokens.owner, missionId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ userId: uids.visitor, lastReadSeq: 2 });
    // The caller's own position rides the thread view.
    const thread = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.visitor) });
    expect(thread.json().myLastReadSeq).toBe(2);
  });

  it('THE PRIVACY CONTRACT end-to-end: disable hides, OFF-period reads stay hidden after re-enable, a fresh read re-discloses', async () => {
    const missionId = await createMissionWithMessages(3);
    await read(tokens.visitor, missionId, 1);
    expect((await receiptsOf(tokens.owner, missionId)).map((r) => r.userId)).toContain(uids.visitor);

    // Disable receipts (first prefs row: expectedVersion null).
    expect((await setPrefs(tokens.visitor, false, null)).statusCode).toBe(200);
    expect((await receiptsOf(tokens.owner, missionId)).map((r) => r.userId)).not.toContain(uids.visitor);

    // Reading while OFF: the OWN cursor still advances (unread keeps working)…
    await read(tokens.visitor, missionId, 2);
    const own = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.visitor) });
    expect(own.json().myLastReadSeq).toBe(2);
    // …and stays undisclosed.
    expect((await receiptsOf(tokens.owner, missionId)).map((r) => r.userId)).not.toContain(uids.visitor);

    // Re-enable: the watermark stamps NOW — the OFF-period read (read_at < since)
    // is NEVER retroactively disclosed. (A fresh row is version 0.)
    expect((await setPrefs(tokens.visitor, true, 0)).statusCode).toBe(200);
    expect((await receiptsOf(tokens.owner, missionId)).map((r) => r.userId)).not.toContain(uids.visitor);

    // A FRESH read (at/after the watermark) re-discloses.
    await read(tokens.visitor, missionId, 3);
    const after = await receiptsOf(tokens.owner, missionId);
    expect(after.find((r) => r.userId === uids.visitor)).toMatchObject({ lastReadSeq: 3 });
  });

  it('prefs: the three-way CAS (row+null → 409; stale → 409; no row remains the defaults)', async () => {
    const prefs = await app.inject({ method: 'GET', url: '/api/v1/comms/prefs', headers: auth(tokens.visitor) });
    expect(prefs.json()).toEqual({ receiptsEnabled: true, presenceEnabled: true, version: null });
    expect((await setPrefs(tokens.visitor, false, null)).statusCode).toBe(200);
    expect((await setPrefs(tokens.visitor, true, null)).statusCode).toBe(409); // row exists, null claimed
    expect((await setPrefs(tokens.visitor, true, 99)).statusCode).toBe(409); // stale version
    expect((await setPrefs(tokens.visitor, true, 0)).statusCode).toBe(200); // a fresh row is version 0
  });

  it('lapse: cursor advance, receipts reads, and the privacy disable ALL survive; never-entitled 404s', async () => {
    const missionId = await createMissionWithMessages(1);
    await db.adminQuery(`UPDATE tenant_module_entitlement SET state = 'lapsed'`);
    expect((await read(tokens.visitor, missionId, 1)).statusCode).toBe(200); // own record
    expect((await receiptsOf(tokens.owner, missionId)).length).toBe(1); // reads flow
    expect((await setPrefs(tokens.visitor, false, null)).statusCode).toBe(200); // own privacy
    await db.adminQuery(`DELETE FROM tenant_module_entitlement`);
    expect((await read(tokens.visitor, missionId, 1)).statusCode).toBe(404); // never-entitled conceals
    expect((await app.inject({ method: 'GET', url: '/api/v1/comms/prefs', headers: auth(tokens.visitor) })).statusCode).toBe(404);
  });
});
