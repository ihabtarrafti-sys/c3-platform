/**
 * members.test.ts — Sprint 35 M3 evidence over HTTP (real embedded PG, real
 * signed dev-IdP auth). Covers: role gating of the member directory, the full
 * governed member chain (ops submits over HTTP → owner reviews/approves →
 * owner executes → member live), self-targeting refusal, guard failure
 * surfacing as a structured error + truthful ExecutionFailed, tenant scoping,
 * and /me carrying the new capabilities.
 */
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

const tokens = {} as { ops: string; owner: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function provisionPayload(email: string, role = 'management', oid = `oid-${email}`) {
  return {
    operationType: 'ProvisionMember',
    input: { email, displayName: email, role, identity: { provider: 'dev', issuerTenantId: 'dev', subject: oid } },
  };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'members-test-secret-0123456789',
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
  await db.seedTenant({ slug: 'bravo' });
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('member directory gating', () => {
  it('owner and operations may list members; visitor is refused', async () => {
    const owner = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(tokens.owner) });
    expect(owner.statusCode).toBe(200);
    const emails = owner.json().members.map((m: { email: string }) => m.email);
    expect(emails).toContain('owner@alpha.com');
    expect(emails).not.toContain('owner@bravo.com'); // tenant-scoped

    expect((await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(tokens.ops) })).statusCode).toBe(200);
    const denied = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(tokens.visitor) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');
  });

  it('/me carries the member capabilities', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(tokens.ops) });
    expect(me.json().capabilities).toMatchObject({ canReadMembers: true, canSubmitMemberChange: true });
    const vis = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(tokens.visitor) });
    expect(vis.json().capabilities).toMatchObject({ canReadMembers: false, canSubmitMemberChange: false });
  });
});

describe('governed member chain over HTTP', () => {
  it('ops submits ProvisionMember → owner reviews/approves/executes → member live', async () => {
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/members/changes',
      headers: auth(tokens.ops),
      payload: { payload: provisionPayload('new.lead@alpha.com'), reason: 'Onboarding' },
    });
    expect(submit.statusCode, submit.body).toBe(201);
    const a = submit.json().approval;
    expect(a).toMatchObject({ operationType: 'ProvisionMember', status: 'Submitted', targetPersonId: 'N/A-MEMBER' });

    const begin = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    expect(begin.statusCode).toBe(200);
    const approve = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: begin.json().approval.version } });
    expect(approve.statusCode).toBe(200);

    const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: approve.json().approval.version } });
    expect(exec.statusCode, exec.body).toBe(200);
    expect(exec.json()).toMatchObject({ person: null, idempotent: false });
    expect(exec.json().approval.status).toBe('Executed');

    const members = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(tokens.owner) });
    const created = members.json().members.find((m: { email: string }) => m.email === 'new.lead@alpha.com');
    expect(created).toMatchObject({ role: 'management', isActive: true });

    // The provisioned identity can sign in and sees the org.
    const newToken = await login('new.lead@alpha.com', 'management', 'alpha');
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(newToken) });
    expect(me.json()).toMatchObject({ identity: 'new.lead@alpha.com', role: 'management', tenantSlug: 'alpha' });
  });

  it('the requester may not target their own account (403 at submit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/members/changes',
      headers: auth(tokens.ops),
      payload: {
        payload: { operationType: 'DeactivateMember', input: { targetUserId: '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', email: 'ops@alpha.com' } },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SELF_ADMINISTRATION_BLOCKED');
  });

  it('a visitor may not submit member changes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/members/changes',
      headers: auth(tokens.visitor),
      payload: { payload: provisionPayload('x@alpha.com') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a guard violation at execute yields a structured error and a truthful ExecutionFailed', async () => {
    // ops requests deactivation of the sole active owner; owner approves;
    // execution must hit the SQL guards (self-target + last owner) and fail.
    const members = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(tokens.owner) });
    const owner = members.json().members.find((m: { email: string }) => m.email === 'owner@alpha.com');

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/members/changes',
      headers: auth(tokens.ops),
      payload: { payload: { operationType: 'DeactivateMember', input: { targetUserId: owner.userId, email: 'owner@alpha.com' } } },
    });
    expect(submit.statusCode).toBe(201);
    const a = submit.json().approval;

    const begin = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    const approve = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: begin.json().approval.version } });
    const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: approve.json().approval.version } });
    expect(exec.statusCode).toBeGreaterThanOrEqual(400);
    expect(['SELF_ADMINISTRATION_BLOCKED', 'LAST_OWNER_PROTECTED']).toContain(exec.json().error.code);

    const after = await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.approvalId}`, headers: auth(tokens.owner) });
    expect(after.json().approval.status).toBe('ExecutionFailed');
    // No partial change — the owner is still an active member.
    const stillThere = await app.inject({ method: 'GET', url: '/api/v1/members', headers: auth(tokens.owner) });
    expect(stillThere.json().members.find((m: { email: string }) => m.email === 'owner@alpha.com').isActive).toBe(true);
  });

  it('a malformed member payload is rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/members/changes',
      headers: auth(tokens.ops),
      payload: { payload: { operationType: 'ChangeRole', input: { targetUserId: 'not-a-uuid', email: 'x@alpha.com', toRole: 'boss' } } },
    });
    expect(res.statusCode).toBe(400);
  });
});
