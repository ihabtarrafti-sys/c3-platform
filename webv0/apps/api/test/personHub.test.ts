/**
 * personHub.test.ts (api) — Sprint 42 W2 evidence over HTTP: the person-scoped
 * hub reads. Mission memberships arrive joined with the mission's identity;
 * approvals are scoped by the target person; role gates hold (approvals reads
 * are for approval-viewing roles; membership reads are people-adjacent).
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

const tokens = {} as { ops: string; owner: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function governedExecute(approvalId: string, version: number) {
  const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: version } });
  const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: rev.json().approval.version } });
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: appr.json().approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'personhub-test-secret-0123456789',
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
});

describe('the person hub reads', () => {
  it('missions arrive joined with the mission identity; approvals are person-scoped and role-gated', async () => {
    // Person + mission + governed membership.
    const personSub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Hub Person' } } });
    const personExec = await governedExecute(personSub.json().approval.approvalId, personSub.json().approval.version);
    const personId = personExec.person.personId as string;

    const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Hub Mission', startsOn: '2026-08-01' } });
    const missionId = mission.json().mission.missionId as string;
    const partSub = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId, personId, role: 'Player' } } });
    await governedExecute(partSub.json().approval.approvalId, partSub.json().approval.version);

    // Membership read: joined with the mission name (people-adjacent — the visitor may read it).
    const missions = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/missions`, headers: auth(tokens.visitor) });
    expect(missions.statusCode, missions.body).toBe(200);
    expect(missions.json().missions).toEqual([
      { missionId, missionName: 'Hub Mission', missionIsActive: true, role: 'Player', isActive: true },
    ]);

    // Approvals read: exactly this person's approvals (AddPerson executed first
    // carries the backfilled PER id; the participant op targets the person too).
    const approvals = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/approvals`, headers: auth(tokens.owner) });
    expect(approvals.statusCode).toBe(200);
    const ops = approvals.json().approvals.map((a: { operationType: string }) => a.operationType).sort();
    expect(ops).toEqual(['AddMissionParticipant', 'AddPerson']);

    // The approvals read is for approval-viewing roles only.
    const denied = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/approvals`, headers: auth(tokens.visitor) });
    expect(denied.statusCode).toBe(403);
  });
});
