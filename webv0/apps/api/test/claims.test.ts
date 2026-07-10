/**
 * claims.test.ts (api) — S9 over HTTP: the lifecycle (Submitted → InReview →
 * Approved → Paid / Rejected+reason), the separation law (submitter never
 * decides their own), per-actor reads (own vs finance-all), the label law on
 * pay, receipts behind the record-scoped gate, the ClaimsAwaitingReview
 * signal, and the read-only denial.
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

const tokens = {} as { ops: string; owner: string; hr: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function post(token: string, url: string, payload: Record<string, unknown>, expected = 201) {
  const res = await app.inject({ method: 'POST', url, headers: auth(token), payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(expected);
  return res.json();
}

async function get(token: string, url: string, expected = 200) {
  const res = await app.inject({ method: 'GET', url, headers: auth(token) });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(expected);
  return res.json();
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'claims-test-secret-0123456789xyz',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-clm-')),
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
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('claims over HTTP (S9)', () => {
  it('lifecycle + separation law + per-actor reads + label law + receipts gate + signal', async () => {
    // ── hr submits an expense; visitors cannot ────────────────────────────────
    const claim = (
      await post(tokens.hr, '/api/v1/claims', {
        category: 'Travel',
        description: 'Taxi to the venue',
        amountMinor: 12_500,
        currency: 'USD',
        expenseOn: '2026-07-01',
      })
    ).claim;
    expect(claim.claimId).toBe('CLM-0001');
    expect(claim).toMatchObject({ status: 'Submitted', submittedBy: 'hr@alpha.com' });
    await post(tokens.visitor, '/api/v1/claims', { category: 'Travel', description: 'x', amountMinor: 1, currency: 'USD', expenseOn: '2026-07-01' }, 403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: auth(tokens.visitor) })).statusCode).toBe(403);

    // ── per-actor reads: hr sees their own; ops (finance standing) sees all ──
    const ownClaim = (
      await post(tokens.ops, '/api/v1/claims', { category: 'Logistics', description: 'Crate shipping', amountMinor: 40_000, currency: 'USD', expenseOn: '2026-07-02' })
    ).claim; // ops' OWN claim — for the separation-law probe
    expect((await get(tokens.hr, '/api/v1/claims')).claims.map((c: { claimId: string }) => c.claimId)).toEqual(['CLM-0001']);
    expect((await get(tokens.ops, '/api/v1/claims')).claims).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: `/api/v1/claims/${ownClaim.claimId}`, headers: auth(tokens.hr) })).statusCode).toBe(403);

    // ── the separation law: ops may not decide their OWN claim ───────────────
    await post(tokens.ops, `/api/v1/claims/${ownClaim.claimId}/decide`, { expectedVersion: ownClaim.version, decision: 'beginReview' }, 403);
    // …but MAY decide hr's; hr may decide nothing (no finance standing).
    await post(tokens.hr, `/api/v1/claims/${claim.claimId}/decide`, { expectedVersion: claim.version, decision: 'beginReview' }, 403);

    // ── receipts: the submitter uploads and reads their own; strangers cannot ─
    const form = new FormData();
    form.append('ownerType', 'Claim');
    form.append('ownerId', claim.claimId);
    form.append('file', new Blob(['%PDF-1.4 receipt'], { type: 'application/pdf' }), 'receipt.pdf');
    const up = await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(tokens.ops), body: form as never });
    expect(up.statusCode, up.body).toBe(201); // ops attaches (owner/ops attach documents)
    const docId = up.json().document.documentId as string;
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.hr) })).statusCode).toBe(200); // the submitter
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.visitor) })).statusCode).toBe(403);

    // ── the lifecycle: review → approve → pay (label mandatory) ──────────────
    let cur = (await post(tokens.ops, `/api/v1/claims/${claim.claimId}/decide`, { expectedVersion: claim.version, decision: 'beginReview' }, 200)).claim;
    expect(cur.status).toBe('InReview');
    // Reject demands a reason; approve from InReview is legal.
    await post(tokens.ops, `/api/v1/claims/${claim.claimId}/decide`, { expectedVersion: cur.version, decision: 'reject' }, 400);
    cur = (await post(tokens.ops, `/api/v1/claims/${claim.claimId}/decide`, { expectedVersion: cur.version, decision: 'approve' }, 200)).claim;
    expect(cur.status).toBe('Approved');
    // Paying without a label is refused; with a label it lands.
    const payNoLabel = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claim.claimId}/pay`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: cur.version, paymentSourceLabel: '' },
    });
    expect([400, 422]).toContain(payNoLabel.statusCode);
    cur = (await post(tokens.ops, `/api/v1/claims/${claim.claimId}/pay`, { expectedVersion: cur.version, paymentSourceLabel: 'ESA', refNo: 'FT2607CLM' }, 200)).claim;
    expect(cur).toMatchObject({ status: 'Paid', paymentSourceLabel: 'ESA', refNo: 'FT2607CLM' });
    expect(cur.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Terminal: no further transitions.
    await post(tokens.ops, `/api/v1/claims/${claim.claimId}/decide`, { expectedVersion: cur.version, decision: 'beginReview' }, 409);

    // ── a rejected claim carries its reason ──────────────────────────────────
    let rej = (await post(tokens.hr, '/api/v1/claims', { category: 'Other', description: 'Mystery expense', amountMinor: 999, currency: 'USD', expenseOn: '2026-07-03' })).claim;
    rej = (await post(tokens.owner, `/api/v1/claims/${rej.claimId}/decide`, { expectedVersion: rej.version, decision: 'beginReview' }, 200)).claim;
    rej = (await post(tokens.owner, `/api/v1/claims/${rej.claimId}/decide`, { expectedVersion: rej.version, decision: 'reject', reason: 'No receipt for a mystery' }, 200)).claim;
    expect(rej).toMatchObject({ status: 'Rejected', rejectionReason: 'No receipt for a mystery' });

    // ── the audit trail tells each story ─────────────────────────────────────
    const audit = await get(tokens.owner, `/api/v1/claims/${claim.claimId}/audit`);
    const actions = audit.events.map((e: { action: string }) => e.action);
    for (const a of ['ClaimSubmitted', 'ClaimReviewStarted', 'ClaimApproved', 'ClaimPaid']) expect(actions).toContain(a);

    // ── the signal: FRESH claims stay quiet (it fires at ≥3 days, engine-tested) ─
    const situation = await get(tokens.owner, '/api/v1/situation');
    expect(situation.signals.filter((sg: { kind: string }) => sg.kind === 'ClaimsAwaitingReview')).toHaveLength(0);
  });
});
