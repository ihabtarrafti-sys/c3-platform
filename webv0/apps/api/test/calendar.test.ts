/**
 * calendar.test.ts (api) — Track B: the ops calendar / timeline over HTTP.
 * Proves the operational gate (owner/ops; read-only roles 403), that a real
 * dated record (a credential expiry) flows onto the horizon and respects the
 * horizon ceiling, and cross-tenant isolation.
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
const tokens = {} as { owner: string; ops: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });

async function governedExecute(approvalId: string, version: number) {
  const rev = await post(tokens.owner, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version });
  const appr = await post(tokens.owner, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: rev.json().approval.version });
  const exec = await post(tokens.owner, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: appr.json().approval.version });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}
async function addPerson(fullName: string): Promise<string> {
  const submit = await post(tokens.ops, '/api/v1/approvals', { input: { fullName } });
  const res = await governedExecute(submit.json().approval.approvalId, submit.json().approval.version);
  return res.person.personId as string;
}
async function addCredential(personId: string, expiresOn: string): Promise<void> {
  const submit = await post(tokens.ops, '/api/v1/credentials/requests', { input: { personId, credentialType: 'Passport', issuedOn: '2025-01-01', expiresOn } });
  await governedExecute(submit.json().approval.approvalId, submit.json().approval.version);
}
const inDays = (n: number): string => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'calendar-test-secret-0000000000000',
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
  await db.seedTenant({ slug: 'alpha', users: [
    { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' },
    { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' },
    { key: 'visitor', email: 'vis@a.com', displayName: 'Vis A', role: 'visitor' },
  ] });
  await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  tokens.owner = await login('owner@a.com', 'owner', 'alpha');
  tokens.ops = await login('ops@a.com', 'operations', 'alpha');
  tokens.visitor = await login('vis@a.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@b.com', 'owner', 'bravo');
});

describe('ops calendar', () => {
  it('is owner/ops only — a read-only role is refused', async () => {
    expect((await get(tokens.owner, '/api/v1/calendar')).statusCode).toBe(200);
    expect((await get(tokens.ops, '/api/v1/calendar')).statusCode).toBe(200);
    expect((await get(tokens.visitor, '/api/v1/calendar')).statusCode).toBe(403);
  });

  it('a fresh tenant has a clear horizon', async () => {
    const res = await get(tokens.owner, '/api/v1/calendar?horizon=90');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(res.json().horizonDays).toBe(90);
  });

  it('a credential expiry lands on the horizon and respects the ceiling + isolation', async () => {
    const personId = await addPerson('Sam Horizon');
    await addCredential(personId, inDays(30));

    const wide = await get(tokens.owner, '/api/v1/calendar?horizon=90');
    const cred = wide.json().items.find((i: { kind: string }) => i.kind === 'CredentialExpiry');
    expect(cred, wide.body).toBeTruthy();
    expect(cred.title).toContain('Passport');
    expect(cred.subtitle).toBe('Sam Horizon');
    expect(cred.route).toBe(`/people/${personId}`);
    expect(cred.daysUntil).toBeGreaterThan(0);

    // Beyond a 7-day horizon it drops off.
    const narrow = await get(tokens.owner, '/api/v1/calendar?horizon=7');
    expect(narrow.json().items.find((i: { kind: string }) => i.kind === 'CredentialExpiry')).toBeUndefined();

    // Another tenant never sees it.
    expect((await get(tokens.ownerB, '/api/v1/calendar?horizon=90')).json().items).toEqual([]);
  });

  it('clamps a silly horizon (schema bounds 7..365)', async () => {
    expect((await get(tokens.owner, '/api/v1/calendar?horizon=99999')).statusCode).toBe(400);
    expect((await get(tokens.owner, '/api/v1/calendar?horizon=1')).statusCode).toBe(400);
  });
});
