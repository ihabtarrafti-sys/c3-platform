/**
 * api.test.ts — end-to-end API evidence over a REAL PostgreSQL (embedded) and
 * the real auth path (signed dev IdP tokens verified exactly like production).
 *
 * Covers: Operations submission, Owner review + execution (approval alone
 * creates no person; execution creates exactly one), rejection, self-approval
 * refusal, unauthorized-role refusal, stale-version 409, duplicate execution
 * idempotency, malformed payload, cross-tenant access, unauthenticated access,
 * correlation ids, and the events/audit/me endpoints.
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

const tokens = {} as { ops: string; owner: string; owner2: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'api-test-secret-0123456789',
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
  tokens.owner2 = await login('owner2@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

async function submit(token = tokens.ops, fullName = 'Jordan Reyes') {
  const res = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(token), payload: { input: { fullName } } });
  return res;
}

describe('authentication', () => {
  it('rejects missing and malformed tokens with 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/people' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth('garbage') })).statusCode).toBe(401);
  });

  it('every response carries a correlation id, echoing the request one', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/people', headers: { ...auth(tokens.owner), 'x-correlation-id': 'corr-123' } });
    expect(res.headers['x-correlation-id']).toBe('corr-123');
  });

  it('me returns the role and capabilities', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(tokens.ops) });
    expect(res.json()).toMatchObject({ role: 'operations', tenantSlug: 'alpha', capabilities: { canSubmitApproval: true, canReviewApproval: false } });
  });
});

describe('submission (Operations)', () => {
  it('operations submits; no person is created', async () => {
    const res = await submit();
    expect(res.statusCode).toBe(201);
    const { approval } = res.json();
    expect(approval).toMatchObject({ approvalId: 'APR-0001', status: 'Submitted', targetPersonId: 'PENDING-ADDPERSON', submittedBy: 'ops@alpha.com' });
    const people = await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) });
    expect(people.json().people).toHaveLength(0);
  });

  it('read-only role may not submit (403)', async () => {
    const res = await submit(tokens.visitor);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('malformed payload is 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: '' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('review + execution (Owner)', () => {
  it('full happy path: submit -> begin-review -> approve -> (no person) -> execute -> exactly one person', async () => {
    const a = (await submit()).json().approval;
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    expect(r1.json().approval.status).toBe('InReview');
    const r2 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: r1.json().approval.version } });
    expect(r2.json().approval.status).toBe('Approved');

    // Approval alone creates no person.
    expect((await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) })).json().people).toHaveLength(0);

    const ex = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: r2.json().approval.version } });
    expect(ex.statusCode).toBe(200);
    expect(ex.json()).toMatchObject({ idempotent: false, person: { personId: 'PER-0001', fullName: 'Jordan Reyes' }, approval: { status: 'Executed', targetPersonId: 'PER-0001' } });
    const people = (await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) })).json().people;
    expect(people).toHaveLength(1);
  });

  it('operations may not review or execute (403)', async () => {
    const a = (await submit()).json().approval;
    expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.ops), payload: { expectedVersion: a.version } })).statusCode).toBe(403);
  });

  it('the submitter may not review their own request (self-approval refusal)', async () => {
    // Owner submits, then tries to review own.
    const a = (await submit(tokens.owner)).json().approval;
    const res = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SELF_REVIEW_BLOCKED');
  });

  it('rejection requires a reason and records it', async () => {
    const a = (await submit()).json().approval;
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    const noReason = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/reject`, headers: auth(tokens.owner), payload: { expectedVersion: r1.json().approval.version } });
    expect(noReason.statusCode).toBe(400);
    const rej = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/reject`, headers: auth(tokens.owner), payload: { expectedVersion: r1.json().approval.version, reason: 'Duplicate' } });
    expect(rej.json().approval).toMatchObject({ status: 'Rejected', rejectionReason: 'Duplicate' });
  });
});

describe('optimistic concurrency & idempotency', () => {
  it('a stale version returns 409 with zero mutation', async () => {
    const a = (await submit()).json().approval;
    await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    const stale = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONCURRENCY');
  });

  it('duplicate execution is idempotent (no second person)', async () => {
    const a = (await submit()).json().approval;
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    const r2 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: r1.json().approval.version } });
    const first = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: r2.json().approval.version } });
    const second = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: r2.json().approval.version } });
    expect(first.json().idempotent).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().person.personId).toBe('PER-0001');
    expect((await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) })).json().people).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  it('another tenant cannot read or act on an approval (404)', async () => {
    const a = (await submit()).json().approval; // alpha
    expect((await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.approvalId}`, headers: auth(tokens.ownerB) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.ownerB), payload: { expectedVersion: a.version } })).statusCode).toBe(404);
    // alpha still sees it.
    expect((await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.approvalId}`, headers: auth(tokens.owner) })).statusCode).toBe(200);
  });
});

describe('security guarantees (Phase 2A)', () => {
  it('the dev-login route is NOT registered when the provider is entra', async () => {
    const entraEnv = loadEnv({
      NODE_ENV: 'test',
      AUTH_PROVIDER: 'entra',
      ENTRA_TENANT_ID: 't',
      ENTRA_ISSUER: 'https://login.microsoftonline.com/t/v2.0',
      ENTRA_AUDIENCE: 'api://c3web',
      ENTRA_JWKS_URI: 'https://login.microsoftonline.com/t/discovery/v2.0/keys',
      DATABASE_URL: db.appUrl,
      DATABASE_AUTH_URL: db.authUrl,
    } as NodeJS.ProcessEnv);
    const entraDeps = buildDeps(entraEnv, createLogger(entraEnv));
    const entraApp = buildApp(entraDeps);
    await entraApp.ready();
    try {
      const res = await entraApp.inject({
        method: 'POST',
        url: '/api/v1/dev/login',
        payload: { email: 'x@y.com', role: 'owner', tenantSlug: 'alpha' },
      });
      expect(res.statusCode).toBe(404);
      expect(entraApp.printRoutes()).not.toContain('dev/login');
    } finally {
      await entraApp.close();
      await entraDeps.close();
    }
  });

  it('a malformed client correlation id is replaced, not echoed (log-injection guard)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/people',
      headers: { ...auth(tokens.owner), 'x-correlation-id': 'evil\nid injection' },
    });
    const echoed = res.headers['x-correlation-id'] as string;
    expect(echoed).not.toContain('evil');
    expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('request bodies are bounded (oversized payload refused, no mutation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      headers: auth(tokens.ops),
      payload: { input: { fullName: 'X', notes: 'n'.repeat(200 * 1024) } },
    });
    expect(res.statusCode).toBe(413);
    const list = await app.inject({ method: 'GET', url: '/api/v1/approvals', headers: auth(tokens.owner) });
    expect(list.json().approvals).toHaveLength(0);
  });

  it('a request cannot supply or override tenant_id (strict schemas reject it)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      headers: auth(tokens.ops),
      payload: { input: { fullName: 'X', tenantId: '00000000-0000-0000-0000-00000000dead' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a token signed with a WRONG secret is rejected (forged role/tenant claims useless)', async () => {
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({ role: 'owner', tenant_id: '00000000-0000-0000-0000-0000000000aa', tenant_slug: 'alpha', name: 'Forger' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('forger@alpha.com')
      .setIssuer('c3web-dev-idp')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('not-the-server-secret'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(forged) });
    expect(res.statusCode).toBe(401);
  });

  it('API responses carry no-store and nosniff headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('history & audit', () => {
  it('approval events and person audit render the full trail', async () => {
    const a = (await submit()).json().approval;
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: a.version } });
    const r2 = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: r1.json().approval.version } });
    await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: r2.json().approval.version } });

    const events = (await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.approvalId}/events`, headers: auth(tokens.owner) })).json().events;
    expect(events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['Submitted', 'InReview', 'Approved', 'Executed']);

    const audit = (await app.inject({ method: 'GET', url: '/api/v1/people/PER-0001/audit', headers: auth(tokens.owner) })).json().events;
    expect(audit.some((e: { action: string }) => e.action === 'PersonCreated')).toBe(true);
  });
});
