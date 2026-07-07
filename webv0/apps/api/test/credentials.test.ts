/**
 * credentials.test.ts (api) — Sprint 36 C3 evidence over HTTP (real embedded
 * PG, real signed dev-IdP auth). Covers: the full governed AddCredential chain
 * through the standard approval routes (dates byte-for-byte on the wire), the
 * per-person credentials read, DeactivateCredential end-to-end, role gating,
 * malformed-date rejection at the wire, and tenant scoping.
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

/** Run an approval through begin-review → approve → execute as the owner. */
async function ownerExecutes(approval: { approvalId: string; version: number }) {
  const begin = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: approval.version } });
  expect(begin.statusCode, begin.body).toBe(200);
  const approve = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: begin.json().approval.version } });
  expect(approve.statusCode, approve.body).toBe(200);
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: approve.json().approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

/** Governed AddPerson so credentials have an owner. */
async function addPerson(fullName: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName } } });
  expect(res.statusCode).toBe(201);
  const done = await ownerExecutes(res.json().approval);
  return done.person.personId as string;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'credentials-test-secret-0123456789',
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

describe('governed credential chain over HTTP', () => {
  it('ops submits AddCredential → owner executes → dates byte-for-byte on the wire', async () => {
    const personId = await addPerson('Jordan Reyes');

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, credentialType: 'Coaching License A', issuer: 'Federation', issuedOn: '2026-01-02', expiresOn: '2031-12-30' } },
    });
    expect(submit.statusCode, submit.body).toBe(201);
    const a = submit.json().approval;
    expect(a).toMatchObject({ operationType: 'AddCredential', status: 'Submitted', targetPersonId: personId });

    const done = await ownerExecutes(a);
    expect(done.person).toBeNull();
    expect(done.credential).toMatchObject({
      credentialId: 'CRED-0001',
      personId,
      issuedOn: '2026-01-02',
      expiresOn: '2031-12-30',
      isActive: true,
    });

    // Register + per-person reads.
    const list = await app.inject({ method: 'GET', url: '/api/v1/credentials', headers: auth(tokens.owner) });
    expect(list.json().credentials).toHaveLength(1);
    expect(list.json().credentials[0].issuedOn).toBe('2026-01-02');
    const forPerson = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/credentials`, headers: auth(tokens.owner) });
    expect(forPerson.json().credentials).toHaveLength(1);
  });

  it('deactivation is governed end-to-end; repeat submission refused', async () => {
    const personId = await addPerson('Cred Holder');
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, credentialType: 'License', issuedOn: '2026-01-01' } },
    });
    const created = await ownerExecutes(submit.json().approval);
    const credId = created.credential.credentialId;

    const deact = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/deactivations',
      headers: auth(tokens.ops),
      payload: { input: { credentialId: credId, personId } },
    });
    expect(deact.statusCode, deact.body).toBe(201);
    const done = await ownerExecutes(deact.json().approval);
    expect(done.credential).toMatchObject({ credentialId: credId, isActive: false });

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/deactivations',
      headers: auth(tokens.ops),
      payload: { input: { credentialId: credId, personId } },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');
  });

  it('wire validation rejects malformed and impossible dates with 400', async () => {
    const personId = await addPerson('Date Target');
    for (const bad of [
      { personId, credentialType: 'X', issuedOn: '02/01/2026' },
      { personId, credentialType: 'X', issuedOn: '2026-02-30' },
      { personId, credentialType: 'X', issuedOn: '2026-01-02', expiresOn: '2026-01-02' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/credentials/requests', headers: auth(tokens.ops), payload: { input: bad } });
      expect(res.statusCode, res.body).toBe(400);
    }
  });

  it('a visitor may read credentials but may not submit; unknown person 404s', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/v1/credentials', headers: auth(tokens.visitor) });
    expect(read.statusCode).toBe(200); // people-adjacent read, all roles

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.visitor),
      payload: { input: { personId: 'PER-0001', credentialType: 'X', issuedOn: '2026-01-01' } },
    });
    expect(submit.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId: 'PER-9999', credentialType: 'X', issuedOn: '2026-01-01' } },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('credentials are tenant-scoped: bravo sees nothing of alpha', async () => {
    const personId = await addPerson('Isolated');
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, credentialType: 'License', issuedOn: '2026-01-01' } },
    });
    await ownerExecutes(submit.json().approval);

    const bravo = await app.inject({ method: 'GET', url: '/api/v1/credentials', headers: auth(tokens.ownerB) });
    expect(bravo.json().credentials).toHaveLength(0);
  });
});
