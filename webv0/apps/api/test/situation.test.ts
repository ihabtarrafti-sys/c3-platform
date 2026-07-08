/**
 * situation.test.ts (api) — Sprint 43 Q2 evidence over HTTP: the cockpit
 * read. The honest all-clear enumerates its checks; the flagship
 * cross-domain story composes from live records with printed reasoning;
 * a pending fix demotes to in-motion; the surface is operational-only.
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

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

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
    DEV_AUTH_SECRET: 'situation-test-secret-0123456789',
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

describe('GET /api/v1/situation', () => {
  it('the honest all-clear: zero signals, checks enumerated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.owner) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().signals).toEqual([]);
    expect(res.json().checks.length).toBeGreaterThanOrEqual(7);
    expect(res.json().checks.join(' ')).toMatch(/wedge/i);
  });

  it('the flagship story composes from live records; a pending fix demotes it to in-motion', async () => {
    // Person -> mission (starts +12d) -> roster -> credential expiring +9d.
    const personSub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Story Player' } } });
    const personId = (await governedExecute(personSub.json().approval.approvalId, personSub.json().approval.version)).person.personId as string;

    const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Story Mission', startsOn: isoPlus(12), endsOn: isoPlus(20) } });
    const missionId = mission.json().mission.missionId as string;
    const part = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId, personId, role: 'Player' } } });
    await governedExecute(part.json().approval.approvalId, part.json().approval.version);

    const cred = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, credentialType: 'Coaching License', issuedOn: isoPlus(-30), expiresOn: isoPlus(9) } },
    });
    await governedExecute(cred.json().approval.approvalId, cred.json().approval.version);

    const res = await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.owner) });
    expect(res.statusCode, res.body).toBe(200);
    const signals = res.json().signals as Array<{ kind: string; headline: string; reasons: string[]; band: string; actions: Array<{ kind: string }> }>;

    const readiness = signals.find((s) => s.kind === 'MissionReadiness')!;
    expect(readiness.headline).toContain('Story Mission');
    expect(readiness.headline).toMatch(/not ready/);
    expect(readiness.reasons.join(' ')).toMatch(/Coaching License expires in 9 days, before the mission ends/);

    const credential = signals.find((s) => s.kind === 'CredentialExpiry')!;
    expect(credential.reasons).toContain(`Story Player is on the active roster of ${missionId} "Story Mission"`);
    expect(credential.band).toBe('immediate');
    expect(credential.actions[0]).toMatchObject({ kind: 'AddCredential' });

    // A pending replacement credential demotes the signal to in-motion.
    await app.inject({
      method: 'POST',
      url: '/api/v1/credentials/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, credentialType: 'Coaching License (renewed)', issuedOn: isoPlus(0), expiresOn: isoPlus(365) } },
    });
    const after = await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.owner) });
    const demoted = (after.json().signals as Array<{ kind: string; band: string; reasons: string[] }>).find((s) => s.kind === 'CredentialExpiry')!;
    expect(demoted.band).toBe('inMotion');
    expect(demoted.reasons).toContain('A replacement credential request is already pending');
  });

  it('the cockpit is an operational surface: read-only roles are refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.visitor) });
    expect(res.statusCode).toBe(403);
  });
});
