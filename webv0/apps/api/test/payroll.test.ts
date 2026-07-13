/**
 * payroll.test.ts (api) — Track B: payroll export. Approved/paid claims →
 * a payroll-columns CSV, finance-gated, export-only. Submitted (undecided)
 * claims are excluded; a read-only-non-finance role is refused.
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
const tokens = {} as { owner: string; ops: string; finance: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test', AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'payroll-test-secret-0000000000000',
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
    { key: 'finance', email: 'fin@a.com', displayName: 'Fin A', role: 'finance' },
    { key: 'visitor', email: 'vis@a.com', displayName: 'Vis A', role: 'visitor' },
  ] });
  tokens.owner = await login('owner@a.com', 'owner', 'alpha');
  tokens.ops = await login('ops@a.com', 'operations', 'alpha');
  tokens.finance = await login('fin@a.com', 'finance', 'alpha');
  tokens.visitor = await login('vis@a.com', 'visitor', 'alpha');
});

async function submitClaim(desc: string): Promise<{ claimId: string; version: number }> {
  const res = await post(tokens.ops, '/api/v1/claims', { category: 'Travel', description: desc, amountMinor: 12500, currency: 'USD', expenseOn: '2026-06-01' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().claim;
}
async function approve(claimId: string, version: number): Promise<void> {
  const rev = await post(tokens.owner, `/api/v1/claims/${claimId}/decide`, { expectedVersion: version, decision: 'beginReview' });
  await post(tokens.owner, `/api/v1/claims/${claimId}/decide`, { expectedVersion: rev.json().claim.version, decision: 'approve' });
}

describe('payroll export', () => {
  it('is finance-gated; a read-only non-finance role is refused', async () => {
    expect((await get(tokens.owner, '/api/v1/claims/payroll-export')).statusCode).toBe(200);
    expect((await get(tokens.finance, '/api/v1/claims/payroll-export')).statusCode).toBe(200);
    expect((await get(tokens.visitor, '/api/v1/claims/payroll-export')).statusCode).toBe(403);
  });

  it('exports approved claims as a CSV and excludes undecided ones', async () => {
    const approved = await submitClaim('Flight to EWC');
    await approve(approved.claimId, approved.version);
    await submitClaim('Pending hotel'); // stays Submitted

    const res = await get(tokens.owner, '/api/v1/claims/payroll-export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('payroll-export-');
    const csv = res.body;
    expect(csv.split('\r\n')[0]).toBe('Claim ID,Payee,Concerns Person,Category,Description,Amount,Currency,Expense Date,Status,Payment Source,Ref No,Reviewed By');
    expect(csv).toContain(`${approved.claimId},ops@a.com,,Travel,Flight to EWC,125.00,USD,2026-06-01,Approved,`);
    // the still-Submitted claim is NOT in payroll
    expect(csv).not.toContain('Pending hotel');
  });

  it('honest-numbers: the amount is the claim\'s own minor units, its own currency — never FX-converted', async () => {
    // a non-USD claim with an odd minor amount prints verbatim (amountMinor/100), no rate applied.
    const res = await post(tokens.ops, '/api/v1/claims', { category: 'Travel', description: 'Souq run', amountMinor: 4567, currency: 'AED', expenseOn: '2026-06-02' });
    expect(res.statusCode, res.body).toBe(201);
    const c = res.json().claim;
    await approve(c.claimId, c.version);
    const csv = (await get(tokens.finance, '/api/v1/claims/payroll-export')).body;
    // 45.67 AED, not a USD-converted figure and not coerced to 0.
    expect(csv).toContain(`${c.claimId},ops@a.com,,Travel,Souq run,45.67,AED,2026-06-02,Approved,`);
  });

  it('quotes a description containing a comma (RFC-4180)', async () => {
    const c = await submitClaim('Taxi, tolls, and parking');
    await approve(c.claimId, c.version);
    const csv = (await get(tokens.owner, '/api/v1/claims/payroll-export')).body;
    expect(csv).toContain('"Taxi, tolls, and parking"');
  });

  it('neutralizes a formula-injection description (M-08): a leading = exports inert', async () => {
    const c = await submitClaim('=HYPERLINK("http://evil","click")');
    await approve(c.claimId, c.version);
    const csv = (await get(tokens.owner, '/api/v1/claims/payroll-export')).body;
    // the cell is prefixed with an apostrophe (then RFC-quoted for its comma/quotes),
    // so a spreadsheet renders it as literal text — the raw formula never leads a cell.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/); // no cell begins with a bare =
  });
});
