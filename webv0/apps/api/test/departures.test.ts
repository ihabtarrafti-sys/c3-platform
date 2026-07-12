/**
 * departures.test.ts (api) — Track B: departure workflow over HTTP. Proves the
 * operational gate, initiate (one-open-per-person), the derived readiness
 * checklist, complete (with the governed deactivation capstone) / cancel, the
 * Situation-Room "departure incomplete" signal, and cross-tenant isolation.
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
  return (await governedExecute(submit.json().approval.approvalId, submit.json().approval.version)).person.personId as string;
}
async function addCredential(personId: string): Promise<void> {
  const submit = await post(tokens.ops, '/api/v1/credentials/requests', { input: { personId, credentialType: 'Passport', issuedOn: '2025-01-01', expiresOn: '2030-01-01' } });
  await governedExecute(submit.json().approval.approvalId, submit.json().approval.version);
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test', AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'departures-test-secret-000000000000',
    DATABASE_URL: db.appUrl, DATABASE_ADMIN_URL: db.adminUrl,
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

describe('departure workflow', () => {
  it('is owner/ops only', async () => {
    expect((await get(tokens.visitor, '/api/v1/departures')).statusCode).toBe(403);
    expect((await get(tokens.owner, '/api/v1/departures')).statusCode).toBe(200);
  });

  it('initiates once per person, derives the readiness checklist, and completes with the governed deactivation', async () => {
    const personId = await addPerson('Leaving Larry');
    await addCredential(personId);

    const init = await post(tokens.ops, '/api/v1/departures', { personId, reason: 'End of contract' });
    expect(init.statusCode, init.body).toBe(201);
    const dep = init.json().departure;
    expect(dep.departureId).toMatch(/^DEP-\d{4,}$/);
    // one open per person
    expect((await post(tokens.ops, '/api/v1/departures', { personId, reason: 'again' })).statusCode).toBe(409);

    // readiness: the active credential is an open item
    const list = await get(tokens.owner, '/api/v1/departures');
    const row = list.json().departures.find((d: { departure: { personId: string } }) => d.departure.personId === personId);
    expect(row.personName).toBe('Leaving Larry');
    expect(row.openItems.some((i: { kind: string }) => i.kind === 'Credential')).toBe(true);

    // the cockpit sees the incomplete departure
    const sit = await get(tokens.owner, '/api/v1/situation');
    expect(sit.json().signals.some((s: { kind: string }) => s.kind === 'DepartureIncomplete')).toBe(true);

    // complete + hand to the governed DeactivatePerson
    const done = await post(tokens.ops, `/api/v1/departures/${dep.departureId}/complete`, { expectedVersion: dep.version, deactivatePerson: true, note: 'final day done' });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().departure.status).toBe('Completed');
    expect(done.json().deactivationApprovalId).toMatch(/^APR-\d{4,}$/);

    // the slot is freed — a fresh departure could start again
    expect((await post(tokens.ops, '/api/v1/departures', { personId, reason: 'reopened' })).statusCode).toBe(201);
  });

  it('M-03: completing is idempotent — a retry re-issues the SAME deactivation, never a duplicate', async () => {
    const personId = await addPerson('Retry Rita');
    const dep = (await post(tokens.ops, '/api/v1/departures', { personId, reason: 'End of contract' })).json().departure;

    // first completion hands the person off to the governed DeactivatePerson.
    const first = await post(tokens.ops, `/api/v1/departures/${dep.departureId}/complete`, { expectedVersion: dep.version, deactivatePerson: true });
    expect(first.statusCode, first.body).toBe(200);
    const approvalId = first.json().deactivationApprovalId as string;
    expect(approvalId).toMatch(/^APR-/);

    // a retry of the SAME request (as if the client never saw the response, or
    // the hand-off had failed and is being re-driven) returns the SAME approval —
    // no second submit, no "already closed" 409.
    const retry = await post(tokens.ops, `/api/v1/departures/${dep.departureId}/complete`, { expectedVersion: dep.version, deactivatePerson: true });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().departure.status).toBe('Completed');
    expect(retry.json().deactivationApprovalId).toBe(approvalId);

    // exactly ONE open DeactivatePerson approval exists for the person.
    const approvals = (await get(tokens.owner, '/api/v1/approvals')).json().approvals as Array<{ approvalId: string; operationType: string; targetPersonId: string | null; status: string }>;
    const open = approvals.filter(
      (a) => a.operationType === 'DeactivatePerson' && a.targetPersonId === personId && ['Submitted', 'InReview', 'Approved', 'ExecutionFailed'].includes(a.status),
    );
    expect(open.length).toBe(1);
    expect(open[0]!.approvalId).toBe(approvalId);
  });

  it('cancels an in-progress departure and refuses re-close', async () => {
    const personId = await addPerson('Staying Sam');
    const dep = (await post(tokens.ops, '/api/v1/departures', { personId, reason: 'maybe' })).json().departure;
    const cancelled = await post(tokens.ops, `/api/v1/departures/${dep.departureId}/cancel`, { expectedVersion: dep.version });
    expect(cancelled.json().departure.status).toBe('Cancelled');
    expect((await post(tokens.ops, `/api/v1/departures/${dep.departureId}/complete`, { expectedVersion: cancelled.json().departure.version })).statusCode).toBe(409);
  });

  it('refuses a departure for a non-existent person and is tenant-isolated', async () => {
    expect((await post(tokens.ops, '/api/v1/departures', { personId: 'PER-9999', reason: 'ghost' })).statusCode).toBe(404);
    const personId = await addPerson('Alpha Only');
    await post(tokens.ops, '/api/v1/departures', { personId, reason: 'x' });
    expect((await get(tokens.ownerB, '/api/v1/departures')).json().departures).toEqual([]);
  });
});
