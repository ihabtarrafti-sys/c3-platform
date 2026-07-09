/**
 * search.test.ts (api) — S3 global search over HTTP. The role boundary IS the
 * feature: a domain the actor may not read is simply ABSENT from results (the
 * registers' truthful-absence rule applied to search). Identity fields only —
 * financial values are never searchable or returned.
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

const tokens = {} as { ops: string; owner: string; legal: string; visitor: string; ownerB: string };

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

async function search(token: string, q: string) {
  const res = await app.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}`, headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().results as Array<{ kind: string; id: string; title: string; subtitle: string | null }>;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'search-test-secret-0123456789xyz',
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
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('global search over HTTP (S3)', () => {
  it('finds by id and by name across domains; the role boundary shapes the results; tenants are isolated', async () => {
    // Seed: a person (governed), a coded mission, an entity, an agreement (governed).
    const personSub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Jordan Reyes', ign: 'JREY' } } });
    const personId = (await governedExecute(personSub.json().approval.approvalId, personSub.json().approval.version)).person.personId as string;

    const mission = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      headers: auth(tokens.ops),
      payload: { name: 'Saudi Throwdown', code: 'SATR/2026/0001', organizer: 'Saudi Esports Federation', city: 'Riyadh', startsOn: '2026-08-01' },
    });
    expect(mission.statusCode, mission.body).toBe(201);

    const entity = await app.inject({
      method: 'POST',
      url: '/api/v1/entities',
      headers: auth(tokens.ops),
      payload: { name: 'Geekay UAE', code: 'GKA', jurisdiction: 'UAE', localCurrency: 'AED' },
    });
    expect(entity.statusCode, entity.body).toBe(201);

    const agrSub = await app.inject({
      method: 'POST',
      url: '/api/v1/agreements/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, agreementType: 'Player Contract', agreementCode: 'GKE-PL-2026-001', startsOn: '2026-08-01', endsOn: '2027-07-31', valueUsdCents: 25_000_000 } },
    });
    expect(agrSub.statusCode, agrSub.body).toBe(201);
    await governedExecute(agrSub.json().approval.approvalId, agrSub.json().approval.version);

    // By NAME — the owner sees everything.
    let hits = await search(tokens.owner, 'Jordan');
    expect(hits.some((h) => h.kind === 'person' && h.id === personId)).toBe(true);
    // By IGN.
    hits = await search(tokens.owner, 'jrey');
    expect(hits.some((h) => h.kind === 'person')).toBe(true);
    // By tournament CODE and by mission id.
    hits = await search(tokens.owner, 'SATR');
    expect(hits.some((h) => h.kind === 'mission' && h.id === 'MSN-0001')).toBe(true);
    hits = await search(tokens.owner, 'msn-0001');
    expect(hits.some((h) => h.kind === 'mission')).toBe(true);
    // Entity by code.
    hits = await search(tokens.owner, 'GKA');
    expect(hits.some((h) => h.kind === 'entity' && h.id === 'ENT-0001')).toBe(true);
    // Agreement by its code — and the hit carries NO financial data anywhere.
    hits = await search(tokens.owner, 'GKE-PL');
    const agrHit = hits.find((h) => h.kind === 'agreement')!;
    expect(agrHit).toBeTruthy();
    expect(JSON.stringify(hits)).not.toContain('25000000'); // value never leaks through search
    // Approvals are searchable for owner/ops.
    hits = await search(tokens.owner, 'APR-000');
    expect(hits.some((h) => h.kind === 'approval')).toBe(true);

    // The VISITOR's world: person + mission visible; agreements/approvals ABSENT.
    hits = await search(tokens.visitor, 'GKE-PL');
    expect(hits.some((h) => h.kind === 'agreement')).toBe(false);
    hits = await search(tokens.visitor, 'APR-000');
    expect(hits.some((h) => h.kind === 'approval')).toBe(false);
    hits = await search(tokens.visitor, 'Jordan');
    expect(hits.some((h) => h.kind === 'person')).toBe(true);

    // LEGAL reads agreements (identity fields) but not the approvals queue.
    hits = await search(tokens.legal, 'GKE-PL');
    expect(hits.some((h) => h.kind === 'agreement')).toBe(true);
    hits = await search(tokens.legal, 'APR-000');
    expect(hits.some((h) => h.kind === 'approval')).toBe(false);

    // Another tenant sees NOTHING of alpha.
    hits = await search(tokens.ownerB, 'Jordan');
    expect(hits).toHaveLength(0);

    // Sub-minimum queries return empty (never a full-table dump).
    expect(await search(tokens.owner, 'J')).toHaveLength(0);
    expect(await search(tokens.owner, '  ')).toHaveLength(0);
  });
});
