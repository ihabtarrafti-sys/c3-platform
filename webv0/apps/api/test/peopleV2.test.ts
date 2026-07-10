/**
 * peopleV2.test.ts (api) — S11 over HTTP: the PII tier (structural omission —
 * keys ABSENT, not null, for roles without standing), the governed identity
 * change (pipeline end to end, separation of duties), the direct-audited
 * operational edit (version-guarded), governed deactivate/reactivate with
 * mandatory reasons, the one-open-request-per-person law, and role denials.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

const tokens = {} as { ops: string; owner: string; hr: string; finance: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function call(method: 'GET' | 'POST' | 'PATCH', token: string, url: string, payload?: Record<string, unknown>, expected = 200) {
  const res = await app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(expected);
  return res.json();
}

/** Governed AddPerson end to end: ops submits, owner reviews/approves/executes. */
async function createPerson(fullName: string): Promise<string> {
  const a = (await call('POST', tokens.ops, '/api/v1/approvals', { input: { fullName } }, 201)).approval;
  const r1 = (await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version })).approval;
  const r2 = (await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/approve`, { expectedVersion: r1.version })).approval;
  const ex = await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/execute`, { expectedVersion: r2.version });
  return ex.person.personId as string;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'people-v2-test-secret-0123456789ab',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-pv2-')),
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
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
  tokens.finance = await login('finance@alpha.com', 'finance', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('people v2 over HTTP (S11)', () => {
  it('PII tier: owner/ops/hr get the block; finance/visitor get STRUCTURAL omission (absent, not null)', async () => {
    const personId = await createPerson('Nadia Petrova');
    // ops fills contacts via the direct operational edit
    await call('PATCH', tokens.ops, `/api/v1/people/${personId}`, {
      expectedVersion: 0,
      patch: { phone: '+971500000001', email: 'nadia@example.com', addressLine1: '1 Marina Walk', addressCity: 'Dubai', addressCountry: 'UAE' },
    });

    for (const t of [tokens.owner, tokens.ops, tokens.hr]) {
      const p = (await call('GET', t, `/api/v1/people/${personId}`)).person;
      expect(p.phone).toBe('+971500000001');
      expect(p.email).toBe('nadia@example.com');
      expect(p.addressCity).toBe('Dubai');
    }
    for (const t of [tokens.finance, tokens.visitor]) {
      const p = (await call('GET', t, `/api/v1/people/${personId}`)).person;
      expect('phone' in p, 'phone key must be ABSENT').toBe(false);
      expect('email' in p).toBe(false);
      expect('dateOfBirth' in p).toBe(false);
      expect('addressLine1' in p).toBe(false);
      // non-PII v2 fields stay visible to everyone
      expect('firstName' in p).toBe(true);
      expect(Array.isArray(p.otherNationalities)).toBe(true);
    }
    // the list surface obeys the same law
    const listP = (await call('GET', tokens.visitor, '/api/v1/people')).people[0];
    expect('phone' in listP).toBe(false);
  });

  it('operational edit: direct, audited before→after, version-guarded; hr/visitor denied', async () => {
    const personId = await createPerson('Omar Haddad');
    const updated = (
      await call('PATCH', tokens.ops, `/api/v1/people/${personId}`, {
        expectedVersion: 0,
        patch: { position: 'Team Manager', dateOfJoining: '2025-03-01' },
      })
    ).person;
    expect(updated.position).toBe('Team Manager');
    expect(updated.version).toBe(1);

    // stale version → 409, nothing changes
    await call('PATCH', tokens.ops, `/api/v1/people/${personId}`, { expectedVersion: 0, patch: { position: 'X' } }, 409);
    // audit carries the before/after
    const events = (await call('GET', tokens.owner, `/api/v1/people/${personId}/audit`)).events;
    const op = events.find((e: { action: string }) => e.action === 'PersonOperationalUpdated');
    expect(op, JSON.stringify(events.map((e: { action: string }) => e.action))).toBeTruthy();
    expect(op.before.position).toBeNull();
    expect(op.after.position).toBe('Team Manager');
    // role law: hr and visitor cannot use the operational edit
    await call('PATCH', tokens.hr, `/api/v1/people/${personId}`, { expectedVersion: 1, patch: { position: 'Y' } }, 403);
    await call('PATCH', tokens.visitor, `/api/v1/people/${personId}`, { expectedVersion: 1, patch: { position: 'Y' } }, 403);
  });

  it('governed identity change: pipeline end to end; requester cannot decide; one open request per person', async () => {
    const personId = await createPerson('Lena Fischer');
    const a = (
      await call('POST', tokens.ops, `/api/v1/people/${personId}/identity-request`, {
        patch: { firstName: 'Lena', lastName: 'Fischer', dateOfBirth: '2001-04-12', otherNationalities: ['Austrian'] },
        reason: 'PIF capture',
      }, 201)
    ).approval;
    expect(a.operationType).toBe('UpdatePersonIdentity');
    expect(a.targetPersonId).toBe(personId);

    // nothing changed yet — the pipeline is not decoration
    let p = (await call('GET', tokens.owner, `/api/v1/people/${personId}`)).person;
    expect(p.firstName).toBeNull();

    // one open person request per person
    await call('POST', tokens.ops, `/api/v1/people/${personId}/identity-request`, { patch: { firstName: 'X' } }, 409);
    await call('POST', tokens.ops, `/api/v1/people/${personId}/deactivate-request`, { reason: 'dup probe' }, 409);

    // the requester cannot decide their own request
    await call('POST', tokens.ops, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version }, 403);

    const r1 = (await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version })).approval;
    const r2 = (await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/approve`, { expectedVersion: r1.version })).approval;
    const ex = await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/execute`, { expectedVersion: r2.version });
    expect(ex.approval.status).toBe('Executed');
    expect(ex.person.firstName).toBe('Lena');

    p = (await call('GET', tokens.hr, `/api/v1/people/${personId}`)).person;
    expect(p.firstName).toBe('Lena');
    expect(p.dateOfBirth).toBe('2001-04-12');
    expect(p.otherNationalities).toEqual(['Austrian']);

    const events = (await call('GET', tokens.owner, `/api/v1/people/${personId}/audit`)).events;
    const idu = events.find((e: { action: string }) => e.action === 'PersonIdentityUpdated');
    expect(idu.before.firstName).toBeNull();
    expect(idu.after.firstName).toBe('Lena');
  });

  it('governed lifecycle: deactivate with reason → inactive; reactivate mirrors; moot requests refuse', async () => {
    const personId = await createPerson('Marco Silva');
    // reason is mandatory at the schema
    await call('POST', tokens.ops, `/api/v1/people/${personId}/deactivate-request`, { reason: '' }, 400);

    const a = (await call('POST', tokens.ops, `/api/v1/people/${personId}/deactivate-request`, { reason: 'Left the org' }, 201)).approval;
    const r1 = (await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version })).approval;
    const r2 = (await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/approve`, { expectedVersion: r1.version })).approval;
    await call('POST', tokens.owner, `/api/v1/approvals/${a.approvalId}/execute`, { expectedVersion: r2.version });

    let p = (await call('GET', tokens.ops, `/api/v1/people/${personId}`)).person;
    expect(p.isActive).toBe(false);
    // a second deactivate request is refused as moot
    await call('POST', tokens.ops, `/api/v1/people/${personId}/deactivate-request`, { reason: 'again' }, 409);

    const b = (await call('POST', tokens.ops, `/api/v1/people/${personId}/reactivate-request`, { reason: 'Back for the season' }, 201)).approval;
    const b1 = (await call('POST', tokens.owner, `/api/v1/approvals/${b.approvalId}/begin-review`, { expectedVersion: b.version })).approval;
    const b2 = (await call('POST', tokens.owner, `/api/v1/approvals/${b.approvalId}/approve`, { expectedVersion: b1.version })).approval;
    await call('POST', tokens.owner, `/api/v1/approvals/${b.approvalId}/execute`, { expectedVersion: b2.version });

    p = (await call('GET', tokens.ops, `/api/v1/people/${personId}`)).person;
    expect(p.isActive).toBe(true);
    const events = (await call('GET', tokens.owner, `/api/v1/people/${personId}/audit`)).events;
    expect(events.some((e: { action: string }) => e.action === 'PersonDeactivated')).toBe(true);
    expect(events.some((e: { action: string }) => e.action === 'PersonReactivated')).toBe(true);
  });

  it('identity requests need submit standing; the patch must not be empty', async () => {
    const personId = await createPerson('Empty Patch');
    await call('POST', tokens.visitor, `/api/v1/people/${personId}/identity-request`, { patch: { firstName: 'X' } }, 403);
    await call('POST', tokens.hr, `/api/v1/people/${personId}/identity-request`, { patch: { firstName: 'X' } }, 403);
    await call('POST', tokens.ops, `/api/v1/people/${personId}/identity-request`, { patch: {} }, 400);
    await call('POST', tokens.ops, '/api/v1/people/PER-9999/identity-request', { patch: { firstName: 'X' } }, 404);
  });
});
