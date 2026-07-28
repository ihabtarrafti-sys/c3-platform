/**
 * disclosure.test.ts (api) — the DISCLOSURE CHAPTER's wire-level proofs
 * (C3-DISCLOSURE-CHAPTER-SCOPE.md, Block 1). Each fix lands with its RED-proven
 * assertion here: the test states what the WIRE must not say, and was run
 * against the pre-fix tree to prove it failed there.
 *
 * F12 — the withdraw denial must not name the submitter. A 403 is an answer
 * to the DENIED caller; forwarding `submittedBy` in its details told any
 * authenticated actor who submitted any approval they could name — an
 * identity disclosure through an error envelope.
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
const tokens = {} as { ops: string; ops2: string; owner: string; hr: string; hr2: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });

async function submitPerson(token: string, fullName: string): Promise<{ approvalId: string; version: number }> {
  const res = await post(token, '/api/v1/approvals', { input: { fullName } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approval;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'disclosure-test-secret-00000000',
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
  tokens.ops2 = await login('ops2@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
  tokens.hr2 = await login('hr2@alpha.com', 'hr', 'alpha');
});

/** Owner walks the ceremony: begin-review -> approve -> execute. */
async function governedExecute(approvalId: string, version: number) {
  const rev = await post(tokens.owner, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version });
  expect(rev.statusCode, rev.body).toBe(200);
  const appr = await post(tokens.owner, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: rev.json().approval.version });
  expect(appr.statusCode, appr.body).toBe(200);
  const exec = await post(tokens.owner, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: appr.json().approval.version });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

async function uploadDoc(token: string, ownerType: string, ownerId: string): Promise<string> {
  const form = new FormData();
  form.append('ownerType', ownerType);
  form.append('ownerId', ownerId);
  form.append('file', new Blob([Buffer.from('%PDF-1.4 disclosure probe')], { type: 'application/pdf' }), 'probe.pdf');
  const res = await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(token), body: form as never });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document.documentId as string;
}

/** The strong-form comparator: two responses must be INDISTINGUISHABLE once the
 *  caller-supplied id is normalized out (it is the caller's own input). */
function indistinguishable(a: { statusCode: number; body: string }, b: { statusCode: number; body: string }, ids: string[]) {
  expect(a.statusCode, `status split: ${a.body} vs ${b.body}`).toBe(b.statusCode);
  const norm = (body: string) => {
    let out = body.replace(/"correlationId":"[^"]+"/g, '"correlationId":"X"');
    for (const id of ids) out = out.split(id).join('ID');
    return out;
  };
  expect(norm(a.body), 'denied and absent must be byte-identical in shape').toBe(norm(b.body));
}

describe('F12 — the withdraw denial does not name the submitter', () => {
  it("a non-submitter's withdraw is refused WITHOUT disclosing who submitted", async () => {
    const a = await submitPerson(tokens.ops, 'Withdraw Disclosure Probe');

    // ops2 (authenticated, same tenant, NOT the submitter) probes the withdraw.
    // F11 (landed after F12's original 403 assertion): the mismatch now
    // CONCEALS as the row's own 404 -- a non-submitter is not entitled to the
    // row's existence through this route, so denied == absent by construction.
    const res = await post(tokens.ops2, `/api/v1/approvals/${a.approvalId}/withdraw`, { expectedVersion: a.version });
    expect(res.statusCode, res.body).toBe(404);

    // The denial itself is correct; the BODY must not carry the submitter.
    const body = res.body;
    expect(body, 'the 403 body must not contain the submitter identity').not.toContain('ops@alpha.com');
    const details = res.json().error?.details ?? {};
    expect(details, 'the 403 details must not carry submittedBy').not.toHaveProperty('submittedBy');

    // POSITIVE CONTROL on the same instruments: the submitter's own e-mail IS
    // on the wire where it belongs — the approval DTO for an entitled reader —
    // so a clean body above is a real absence, not a blind assertion.
    const dto = await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.approvalId}`, headers: auth(tokens.owner) });
    expect(dto.statusCode).toBe(200);
    expect(dto.body).toContain('ops@alpha.com');
  });
});

describe('F11 - authorization resolves BEFORE lookup on the approval action routes', () => {
  it('review family: a role-less caller cannot distinguish an existing approval from an absent one', async () => {
    const a = await submitPerson(tokens.ops, 'Oracle Probe One');
    // hr: no review standing, no delegation. Existing vs absent must read the same.
    const existing = await post(tokens.hr, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    const absent = await post(tokens.hr, '/api/v1/approvals/APR-9999/begin-review', { expectedVersion: 1 });
    indistinguishable(existing, absent, [a.approvalId, 'APR-9999']);

    const existingExec = await post(tokens.hr, `/api/v1/approvals/${a.approvalId}/execute`, { expectedVersion: a.version });
    const absentExec = await post(tokens.hr, '/api/v1/approvals/APR-9999/execute', { expectedVersion: 1 });
    indistinguishable(existingExec, absentExec, [a.approvalId, 'APR-9999']);

    // POSITIVE CONTROL: an entitled reviewer still reaches the row (the reorder
    // did not over-close), and an absent id still 404s for them.
    const ok = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await post(tokens.owner, '/api/v1/approvals/APR-9999/begin-review', { expectedVersion: 1 })).statusCode).toBe(404);
  });

  it('withdraw: a non-submitter cannot distinguish an existing approval from an absent one', async () => {
    const a = await submitPerson(tokens.ops, 'Oracle Probe Two');
    const existing = await post(tokens.ops2, `/api/v1/approvals/${a.approvalId}/withdraw`, { expectedVersion: a.version });
    const absent = await post(tokens.ops2, '/api/v1/approvals/APR-9999/withdraw', { expectedVersion: 1 });
    indistinguishable(existing, absent, [a.approvalId, 'APR-9999']);
    // POSITIVE CONTROL: the submitter still withdraws.
    expect((await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/withdraw`, { expectedVersion: a.version })).statusCode).toBe(200);
  });
});

describe('NEO-DOC-01 - the Document byte route conceals denial as the document own 404', () => {
  it('assertReadOwner arm (Agreement): denied and absent are indistinguishable', async () => {
    // ops ceremonies a person then an agreement, then attaches a document.
    const p = await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Doc Oracle Person' } });
    expect(p.statusCode, p.body).toBe(201);
    const personId = (await governedExecute(p.json().approval.approvalId, p.json().approval.version)).person.personId as string;
    const ag = await post(tokens.ops, '/api/v1/agreements/requests', { input: { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31' } });
    expect(ag.statusCode, ag.body).toBe(201);
    await governedExecute(ag.json().approval.approvalId, ag.json().approval.version);
    const docId = await uploadDoc(tokens.ops, 'Agreement', 'AGR-0001');

    // hr holds no canReadAgreements: existing-but-denied vs nonexistent.
    const denied = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.hr) });
    const absent = await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-9999/content', headers: auth(tokens.hr) });
    indistinguishable(denied, absent, [docId, 'DOC-9999']);
    // POSITIVE CONTROL: an entitled reader still gets the bytes.
    const ok = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.ops) });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('claimReadGuard arm (Claim): another staff member cannot learn a claim document exists', async () => {
    const c = await post(tokens.hr, '/api/v1/claims', { category: 'Travel', description: 'Taxi', amountMinor: 5000, currency: 'USD', expenseOn: '2026-07-01' });
    expect(c.statusCode, c.body).toBe(201);
    const claimId = c.json().claim.claimId as string;
    // ops attaches (owner/ops attach documents — the claims.test.ts pattern).
    const docId = await uploadDoc(tokens.ops, 'Claim', claimId);

    // hr2: same role, different person -- claimReadGuard denies cross-staff.
    const denied = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.hr2) });
    const absent = await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-9999/content', headers: auth(tokens.hr2) });
    indistinguishable(denied, absent, [docId, 'DOC-9999']);
    // POSITIVE CONTROL: the claim owner still downloads their own receipt.
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.hr) })).statusCode).toBe(200);
  });
});

describe('F13 - the mention fan-out validates its recipients', () => {
  it('a mention notifies ONLY active members whose own standing can read the subject', async () => {
    const visitor = await login('guest.visitor@alpha.com', 'visitor', 'alpha');
    const a = await submitPerson(tokens.ops, 'Mention Fanout Probe');

    // ops comments on the APPROVAL, mentioning a read-only visitor (no
    // approvals standing, no delegation) and the owner (full standing).
    const c = await post(tokens.ops, '/api/v1/comments', {
      subjectType: 'Approval',
      subjectId: a.approvalId,
      body: 'disclosure probe',
      mentions: ['guest.visitor@alpha.com', 'owner@alpha.com'],
    });
    expect(c.statusCode, c.body).toBe(201);
    // the comment ROW keeps the full mention list - the register is unchanged
    expect(c.json().comment.mentions).toEqual(['guest.visitor@alpha.com', 'owner@alpha.com']);

    // The visitor's bell must NOT name an approval their role cannot read:
    // the notification IS a disclosure ("... mentioned you on Approval APR-x").
    const vBell = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth(visitor) });
    expect(vBell.statusCode, vBell.body).toBe(200);
    expect(vBell.body, 'a subject-naming notification reached a reader with no subject access').not.toContain(a.approvalId);

    // POSITIVE CONTROL on the same instrument: the owner's bell HAS the row.
    const oBell = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth(tokens.owner) });
    expect(oBell.body).toContain(a.approvalId);
  });
});
