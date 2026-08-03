/**
 * crossTenantSeating.test.ts — SLICE 1, class-B defect: a caller-supplied
 * userId is seated with no check that it belongs to the caller's tenant.
 *
 * ⚖️ WHY THIS WAS INVISIBLE. `openDirectThread` validates exactly one thing
 * about its target — that it is not the caller (commsSpaceOps.ts:171) — and
 * `inviteToRoom` validates the ROOM's admin standing, never the invitee. With
 * one tenant that is safe **by accident**: every userId in existence is a
 * co-tenant, so "any user" and "a user of mine" are the same set. The moment a
 * second tenant exists they are different sets, and nothing in the code notices.
 *
 * This is the shape D-008 is about: a rule that was correct under an assumption
 * nobody restated. The assumption was "there is one tenant".
 *
 * THE GUARD IS THE DIRECTORY. B8 already defines who a tenant may address —
 * `listCommsAddressable()`, tenant-scoped and active-only. **A user you may seat
 * is a user you may address**, so the check is the existing directory rather
 * than a new notion of membership invented here.
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

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

async function userIdOf(email: string): Promise<string> {
  const rows = await db.adminQuery<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [email]);
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'cross-tenant-seating-secret-0123456789',
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

let alphaOps = '';
let betaUserId = '';
let alphaPeerId = '';

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: 'alpha' });
  await db.seedTenant({ slug: 'beta' });
  // Comms entitled in BOTH tenants — the defect must not be masked by an
  // entitlement refusal that happens to fire first.
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
  alphaOps = await login('ops@alpha.com', 'operations', 'alpha');
  await login('peer@alpha.com', 'operations', 'alpha');
  await login('outsider@beta.com', 'operations', 'beta');
  alphaPeerId = await userIdOf('peer@alpha.com');
  betaUserId = await userIdOf('outsider@beta.com');
});

describe('class-B: a caller-supplied userId must belong to the caller tenant', () => {
  it('POSITIVE CONTROL: the two users really are in different tenants', async () => {
    const rows = await db.adminQuery<{ email: string; slug: string }>(
      `SELECT u.email, t.slug
         FROM app_user u
         JOIN tenant_membership tm ON tm.user_id = u.id
         JOIN tenant t ON t.id = tm.tenant_id
        WHERE u.email IN ('peer@alpha.com','outsider@beta.com')
        ORDER BY u.email`,
    );
    expect(rows.map((r) => `${r.email}:${r.slug}`)).toEqual([
      'outsider@beta.com:beta',
      'peer@alpha.com:alpha',
    ]);
  });

  it('a DIRECT thread with a co-tenant still works — the guard must not break the feature', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/comms/direct',
      headers: auth(alphaOps),
      payload: { otherUserId: alphaPeerId },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('⛔ a DIRECT thread with a FOREIGN-TENANT user is refused', async () => {
    // RED before the fix: this returned 200 and seated a beta userId as a
    // participant of an alpha thread.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/comms/direct',
      headers: auth(alphaOps),
      payload: { otherUserId: betaUserId },
    });
    // ⛔ CR-008. This accepted `[400, 404]`, and those are NOT equivalent
    // refusals: 404 CONCEALS — it is the answer a non-existent user would get —
    // while 400 says "that identifier is real, and rejected", disclosing that a
    // user exists in another tenant. The case was named for concealment and
    // admitted the disclosing answer.
    expect(res.statusCode, `concealment requires the absent-user answer: ${res.body}`).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    // ⛳ NOT asserted: that the body omits the userId. I wrote that assertion, it
    // failed, and it was MINE that was wrong — the id is one the caller supplied
    // in this very request, so echoing it discloses nothing they did not already
    // hold. The same distinction Neural drew on CR-004. What must never appear is
    // something only the OTHER tenant knows — a name, an email, a tenant id — and
    // `NOT_FOUND` carries none of those.

    // …and nothing was seated. This is the assertion that matters: a refused
    // status with a written row would still be a cross-tenant reference.
    const seated = await db.adminQuery<{ n: string }>(
      'SELECT count(*)::text AS n FROM comms_thread_participant WHERE user_id = $1',
      [betaUserId],
    );
    expect(seated[0]!.n, 'a foreign user must not appear as a participant anywhere').toBe('0');
  });

  it('⛔ a ROOM INVITE of a FOREIGN-TENANT user is refused, and seats nothing', async () => {
    const room = await app.inject({
      method: 'POST',
      url: '/api/v1/comms/rooms',
      headers: auth(alphaOps),
      payload: { title: 'Alpha Room', clientMutationId: randomUUID() },
    });
    expect(room.statusCode, room.body).toBe(201);
    const threadId = room.json().thread.threadId as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/threads/${threadId}/participants`,
      headers: auth(alphaOps),
      payload: { userId: betaUserId, role: 'member' },
    });
    // ⛔ CR-008. This accepted `[400, 404]`, and those are NOT equivalent
    // refusals: 404 CONCEALS — it is the answer a non-existent user would get —
    // while 400 says "that identifier is real, and rejected", disclosing that a
    // user exists in another tenant. The case was named for concealment and
    // admitted the disclosing answer.
    expect(res.statusCode, `concealment requires the absent-user answer: ${res.body}`).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    // ⛳ NOT asserted: that the body omits the userId. I wrote that assertion, it
    // failed, and it was MINE that was wrong — the id is one the caller supplied
    // in this very request, so echoing it discloses nothing they did not already
    // hold. The same distinction Neural drew on CR-004. What must never appear is
    // something only the OTHER tenant knows — a name, an email, a tenant id — and
    // `NOT_FOUND` carries none of those.

    const seated = await db.adminQuery<{ n: string }>(
      'SELECT count(*)::text AS n FROM comms_thread_participant WHERE user_id = $1',
      [betaUserId],
    );
    expect(seated[0]!.n).toBe('0');
  });
});
