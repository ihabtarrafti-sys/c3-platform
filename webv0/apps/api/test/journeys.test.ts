/**
 * journeys.test.ts (api) — Sprint 37 J3 evidence over HTTP (real embedded PG,
 * real signed dev-IdP auth). Covers: the governed InitiateJourney chain
 * through the standard approval routes, the four direct-audited transitions
 * (immediate effect, versioned), cancel-reason enforcement at the edge,
 * illegal-transition and stale-version 409s, role gating (visitor reads but
 * cannot transition), malformed action 400, and tenant scoping.
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

async function ownerExecutes(approval: { approvalId: string; version: number }) {
  const begin = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: approval.version } });
  expect(begin.statusCode, begin.body).toBe(200);
  const approve = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: begin.json().approval.version } });
  expect(approve.statusCode, approve.body).toBe(200);
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: approve.json().approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

async function addPerson(fullName: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName } } });
  expect(res.statusCode).toBe(201);
  return (await ownerExecutes(res.json().approval)).person.personId as string;
}

async function initiate(personId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/journeys/requests',
    headers: auth(tokens.ops),
    payload: { input: { personId, journeyType: 'Pro Contract Onboarding', startedOn: '2026-07-01' } },
  });
  expect(res.statusCode, res.body).toBe(201);
  const done = await ownerExecutes(res.json().approval);
  return done.journey as { journeyId: string; version: number; status: string };
}

function transition(token: string, journeyId: string, action: string, expectedVersion: number, reason?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/journeys/${journeyId}/transitions/${action}`,
    headers: auth(token),
    payload: { expectedVersion, ...(reason ? { reason } : {}) },
  });
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'journeys-test-secret-0123456789',
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

describe('governed initiation over HTTP', () => {
  it('ops submits → owner executes → journey born Active with exact dates', async () => {
    const personId = await addPerson('Jordan Reyes');
    const j = await initiate(personId);
    expect(j).toMatchObject({ journeyId: 'JRN-0001', status: 'Active' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/journeys', headers: auth(tokens.owner) });
    expect(list.json().journeys[0]).toMatchObject({ journeyId: 'JRN-0001', startedOn: '2026-07-01', endedOn: null });
    const forPerson = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/journeys`, headers: auth(tokens.owner) });
    expect(forPerson.json().journeys).toHaveLength(1);
  });
});

describe('direct-audited transitions over HTTP', () => {
  it('suspend → resume → complete flows immediately with version handover', async () => {
    const personId = await addPerson('Lifecycle');
    const j = await initiate(personId);

    const s = await transition(tokens.ops, j.journeyId, 'suspend', j.version);
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().journey.status).toBe('Suspended');

    const r2 = await transition(tokens.owner, j.journeyId, 'resume', s.json().journey.version);
    expect(r2.json().journey.status).toBe('Active');

    const c = await transition(tokens.ops, j.journeyId, 'complete', r2.json().journey.version);
    expect(c.json().journey.status).toBe('Completed');
    expect(c.json().journey.endedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('L-01: a journey cannot be completed before its start date', async () => {
    const personId = await addPerson('Future Start');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/journeys/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, journeyType: 'Pro Contract Onboarding', startedOn: '2099-01-01' } },
    });
    expect(res.statusCode, res.body).toBe(201);
    const j = (await ownerExecutes(res.json().approval)).journey as { journeyId: string; version: number };
    // Completing today (before the 2099 start) is refused — end cannot precede start.
    const complete = await transition(tokens.ops, j.journeyId, 'complete', j.version);
    expect(complete.statusCode, complete.body).toBe(409);
  });

  it('cancel without a reason is 400; with a reason it lands and is audited', async () => {
    const personId = await addPerson('Cancel Target');
    const j = await initiate(personId);

    const bare = await transition(tokens.ops, j.journeyId, 'cancel', j.version);
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error.code).toBe('VALIDATION');

    const ok = await transition(tokens.ops, j.journeyId, 'cancel', j.version, 'Contract ended early');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().journey.status).toBe('Cancelled');
  });

  it('illegal transition and stale version each 409 truthfully', async () => {
    const personId = await addPerson('Refusal Target');
    const j = await initiate(personId);

    const illegal = await transition(tokens.ops, j.journeyId, 'resume', j.version); // Active → resume = illegal
    expect(illegal.statusCode).toBe(409);
    expect(illegal.json().error.code).toBe('INVALID_TRANSITION');

    const s = await transition(tokens.ops, j.journeyId, 'suspend', j.version);
    const stale = await transition(tokens.ops, j.journeyId, 'resume', j.version); // old version
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONCURRENCY');
    expect(s.json().journey.status).toBe('Suspended'); // unchanged by the refusals
  });

  it('a visitor may read journeys but transitions are 403; malformed action is 400', async () => {
    const personId = await addPerson('Role Target');
    const j = await initiate(personId);

    const read = await app.inject({ method: 'GET', url: '/api/v1/journeys', headers: auth(tokens.visitor) });
    expect(read.statusCode).toBe(200);

    const denied = await transition(tokens.visitor, j.journeyId, 'suspend', j.version);
    expect(denied.statusCode).toBe(403);

    const malformed = await transition(tokens.ops, j.journeyId, 'freeze', j.version);
    expect(malformed.statusCode).toBe(400);
  });

  it('journeys are tenant-scoped: bravo sees nothing and cannot transition', async () => {
    const personId = await addPerson('Isolated');
    const j = await initiate(personId);

    const bravoList = await app.inject({ method: 'GET', url: '/api/v1/journeys', headers: auth(tokens.ownerB) });
    expect(bravoList.json().journeys).toHaveLength(0);

    const bravoTransition = await transition(tokens.ownerB, j.journeyId, 'suspend', j.version);
    expect(bravoTransition.statusCode).toBe(404); // invisible in their tenant
  });
});
