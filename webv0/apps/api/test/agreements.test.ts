/**
 * agreements.test.ts (api) — Sprint 41 C3 evidence over HTTP. Covers: the
 * governed material lifecycle end-to-end (add with value → renew → terminate)
 * with the guards visible at the wire (non-extending renewal 409,
 * duplicate-pending 409), the role-differentiated reads (hr/visitor 403;
 * legal receives NO financial field; finance receives it), the addendum
 * linkage, the direct non-material patch (stale 409, self-link 400), and
 * tenant scoping.
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

const tokens = {} as { ops: string; owner: string; legal: string; finance: string; hr: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function governedExecute(approvalId: string, version: number) {
  const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: version } });
  expect(rev.statusCode, rev.body).toBe(200);
  const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: rev.json().approval.version } });
  expect(appr.statusCode, appr.body).toBe(200);
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: appr.json().approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

async function addPerson(fullName: string): Promise<string> {
  const sub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName } } });
  expect(sub.statusCode, sub.body).toBe(201);
  const exec = await governedExecute(sub.json().approval.approvalId, sub.json().approval.version);
  return exec.person.personId as string;
}

async function addAgreement(personId: string, extras: Record<string, unknown> = {}) {
  const sub = await app.inject({
    method: 'POST',
    url: '/api/v1/agreements/requests',
    headers: auth(tokens.ops),
    payload: { input: { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31', ...extras } },
  });
  expect(sub.statusCode, sub.body).toBe(201);
  return governedExecute(sub.json().approval.approvalId, sub.json().approval.version);
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'agreements-test-secret-012345678',
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
  tokens.legal = await login('legal@alpha.com', 'legal', 'alpha');
  tokens.finance = await login('finance@alpha.com', 'finance', 'alpha');
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('the governed material lifecycle over HTTP', () => {
  it('add (with value) → renew → terminate, guards visible at the wire', async () => {
    const personId = await addPerson('Star Player');
    const created = await addAgreement(personId, { agreementCode: 'GKE-PL-2026-001', valueUsdCents: 25_000_000 });
    expect(created.agreement).toMatchObject({ agreementId: 'AGR-0001', agreementCode: 'GKE-PL-2026-001', valueUsdCents: 25_000_000, status: 'Active' });

    // Non-extending renewal is a 409 at submit.
    const flat = await app.inject({ method: 'POST', url: '/api/v1/agreements/renewals', headers: auth(tokens.ops), payload: { input: { agreementId: 'AGR-0001', newEndsOn: '2027-07-31' } } });
    expect(flat.statusCode).toBe(409);

    const renewSub = await app.inject({ method: 'POST', url: '/api/v1/agreements/renewals', headers: auth(tokens.ops), payload: { input: { agreementId: 'AGR-0001', newEndsOn: '2028-07-31' } } });
    expect(renewSub.statusCode, renewSub.body).toBe(201);

    // The open renewal blocks a termination (duplicate-pending per agreement).
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/agreements/terminations', headers: auth(tokens.ops), payload: { input: { agreementId: 'AGR-0001', reason: 'Nope' } } });
    expect(blocked.statusCode).toBe(409);

    const renewed = await governedExecute(renewSub.json().approval.approvalId, renewSub.json().approval.version);
    expect(renewed.agreement).toMatchObject({ endsOn: '2028-07-31', version: 1 });

    const termSub = await app.inject({ method: 'POST', url: '/api/v1/agreements/terminations', headers: auth(tokens.ops), payload: { input: { agreementId: 'AGR-0001', reason: 'Mutual exit' } } });
    const terminated = await governedExecute(termSub.json().approval.approvalId, termSub.json().approval.version);
    expect(terminated.agreement.status).toBe('Terminated');
  });

  it('an NDA addendum links to its parent and shows on the person read', async () => {
    const personId = await addPerson('Linked Player');
    await addAgreement(personId, { agreementCode: 'PARENT-1' });
    const nda = await addAgreement(personId, { agreementType: 'NDA Addendum', linkedAgreementId: 'AGR-0001' });
    expect(nda.agreement.linkedAgreementId).toBe('AGR-0001');

    const forPerson = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/agreements`, headers: auth(tokens.owner) });
    expect(forPerson.json().agreements).toHaveLength(2);
  });
});

describe('role-differentiated reads (the Set-E boundary at the wire)', () => {
  it('finance receives the value FIELD; legal does not have it AT ALL; hr and visitor are 403', async () => {
    const personId = await addPerson('Money Player');
    await addAgreement(personId, { valueUsdCents: 999_900 });

    const finance = await app.inject({ method: 'GET', url: '/api/v1/agreements', headers: auth(tokens.finance) });
    expect(finance.statusCode).toBe(200);
    expect(finance.json().agreements[0].valueUsdCents).toBe(999_900);

    const legal = await app.inject({ method: 'GET', url: '/api/v1/agreements', headers: auth(tokens.legal) });
    expect(legal.statusCode).toBe(200);
    expect('valueUsdCents' in legal.json().agreements[0]).toBe(false); // absent, not null

    for (const t of [tokens.hr, tokens.visitor]) {
      const denied = await app.inject({ method: 'GET', url: '/api/v1/agreements', headers: auth(t) });
      expect(denied.statusCode).toBe(403);
      const detail = await app.inject({ method: 'GET', url: '/api/v1/agreements/AGR-0001', headers: auth(t) });
      expect(detail.statusCode).toBe(403);
    }
  });
});

describe('the direct NON-MATERIAL patch over HTTP', () => {
  it('versioned patch lands; stale is 409 zero-change; self-link is 400; material keys are 400', async () => {
    const personId = await addPerson('Patched Player');
    await addAgreement(personId);

    const upd = await app.inject({ method: 'POST', url: '/api/v1/agreements/AGR-0001', headers: auth(tokens.ops), payload: { expectedVersion: 0, notes: 'Countersigned' } });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().agreement.version).toBe(1);

    const stale = await app.inject({ method: 'POST', url: '/api/v1/agreements/AGR-0001', headers: auth(tokens.ops), payload: { expectedVersion: 0, notes: 'Stale' } });
    expect(stale.statusCode).toBe(409);

    const selfLink = await app.inject({ method: 'POST', url: '/api/v1/agreements/AGR-0001', headers: auth(tokens.ops), payload: { expectedVersion: 1, linkedAgreementId: 'AGR-0001' } });
    expect(selfLink.statusCode).toBe(400);

    const material = await app.inject({ method: 'POST', url: '/api/v1/agreements/AGR-0001', headers: auth(tokens.ops), payload: { expectedVersion: 1, endsOn: '2030-01-01' } });
    expect(material.statusCode).toBe(400); // strict schema: material terms unrepresentable
  });
});

describe('tenant scoping', () => {
  it('bravo sees nothing of alpha (404-invisible)', async () => {
    const personId = await addPerson('Alpha Player');
    await addAgreement(personId);
    const list = await app.inject({ method: 'GET', url: '/api/v1/agreements', headers: auth(tokens.ownerB) });
    expect(list.json().agreements).toHaveLength(0);
    const detail = await app.inject({ method: 'GET', url: '/api/v1/agreements/AGR-0001', headers: auth(tokens.ownerB) });
    expect(detail.statusCode).toBe(404);
  });
});
