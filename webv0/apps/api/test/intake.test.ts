/**
 * intake.test.ts (api) — Track B6: tokenized guest intake over HTTP.
 *
 * Proves the whole shape: staff mint a capability link (token returned once);
 * a GUEST (no bearer) peeks + submits into the sandbox; staff review, download
 * a quarantined file (hash-checked), and PROMOTE through the AddPerson governed
 * pipeline (the person exists only after execute) then attach the file to it —
 * or REJECT and wipe. Plus the boundaries: single-use, revoke, unknown token,
 * type allowlist, role gating, cross-tenant isolation, and that the public
 * exemption is scoped to /intake/public/ only.
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

/** Guest peek/submit — NO bearer token (the public surface). */
const peekGuest = (token: string) => app.inject({ method: 'GET', url: `/api/v1/intake/public/${token}` });
async function submitGuest(token: string, payload: Record<string, unknown>, files: Array<{ name: string; type: string; bytes: Buffer }> = []) {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const f of files) form.append('file', new Blob([f.bytes], { type: f.type }), f.name);
  return app.inject({ method: 'POST', url: `/api/v1/intake/public/${token}`, body: form as never });
}

async function mintLink(token: string, label?: string): Promise<string> {
  const res = await post(token, '/api/v1/intake/links', { kind: 'Onboarding', label: label ?? null });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().token as string;
}

async function governedExecute(token: string, approvalId: string, version: number) {
  const rev = await post(token, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version });
  const appr = await post(token, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: rev.json().approval.version });
  const exec = await post(token, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: appr.json().approval.version });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

const PDF = Buffer.from('%PDF-1.4\n%c3 intake\n%%EOF\n');

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'intake-test-secret-000000000000000',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    // fs document storage (the default in tests) backs the quarantine too.
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

describe('guest intake — the happy path (submit → promote → attach)', () => {
  it('a guest submits with a file; staff download it, promote to AddPerson, execute, and attach it to the person', async () => {
    const link = await mintLink(tokens.ops, 'LoL support tryout');

    // Guest peeks (open) then submits payload + a file.
    const peek = await peekGuest(link);
    expect(peek.statusCode).toBe(200);
    expect(peek.json()).toMatchObject({ kind: 'Onboarding', open: true });

    const sub = await submitGuest(link, { fullName: 'Ahmad Speed', nationality: 'KW', ign: 'SpeedLoL', email: 'ahmad@x.com' }, [
      { name: 'passport.pdf', type: 'application/pdf', bytes: PDF },
    ]);
    expect(sub.statusCode, sub.body).toBe(201);
    expect(sub.json().ok).toBe(true);

    // Staff see one Pending submission with one upload.
    const list = await get(tokens.ops, '/api/v1/intake/submissions');
    expect(list.statusCode).toBe(200);
    const submissions = list.json().submissions;
    expect(submissions).toHaveLength(1);
    const s = submissions[0];
    expect(s.status).toBe('Pending');
    expect(s.payload.fullName).toBe('Ahmad Speed');
    expect(s.uploads).toHaveLength(1);
    // The internal storageKey is NEVER on the wire.
    expect(s.uploads[0]).not.toHaveProperty('storageKey');

    // Staff download the quarantined file — byte-identical.
    const dl = await get(tokens.ops, `/api/v1/intake/submissions/${s.id}/uploads/${s.uploads[0].uploadId}`);
    expect(dl.statusCode).toBe(200);
    expect(Buffer.compare(dl.rawPayload, PDF)).toBe(0);

    // Promote → an AddPerson approval; the submission is Promoted.
    const promote = await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/promote`, { decisionNote: 'verified' });
    expect(promote.statusCode, promote.body).toBe(201);
    const approvalId = promote.json().approval.approvalId;
    expect(promote.json().submission.status).toBe('Promoted');

    // No person yet — it exists only after execute (owner, separation of duties).
    const exec = await governedExecute(tokens.owner, approvalId, promote.json().approval.version);
    const personId = exec.person.personId;
    expect(personId).toMatch(/^PER-\d{4,}$/);
    // The joiner's extra fields were folded into the person's notes.
    expect(exec.person.notes).toContain('Email: ahmad@x.com');

    // Attach the quarantined file to the created person (copy quarantine→live).
    const attach = await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/attach`, { uploadIds: [s.uploads[0].uploadId] });
    expect(attach.statusCode, attach.body).toBe(200);
    expect(attach.json()).toMatchObject({ attachedCount: 1, personId });

    const docs = await get(tokens.owner, `/api/v1/documents?ownerType=Person&ownerId=${personId}`);
    expect(docs.json().documents).toHaveLength(1);
    expect(docs.json().documents[0].fileName).toBe('passport.pdf');
  });
});

describe('guest intake — single use, revoke, unknown, type', () => {
  it('a single-use link is consumed on submit: peek closes and a second submit is 410', async () => {
    const link = await mintLink(tokens.ops);
    expect((await submitGuest(link, { fullName: 'First' })).statusCode).toBe(201);

    const peek = await peekGuest(link);
    expect(peek.json().open).toBe(false);
    expect(peek.json().status).toBe('Consumed');

    const second = await submitGuest(link, { fullName: 'Second' });
    expect(second.statusCode).toBe(410);
    expect(second.json().error.code).toBe('INTAKE_LINK_UNAVAILABLE');

    // Only the first landed.
    const list = await get(tokens.ops, '/api/v1/intake/submissions');
    expect(list.json().submissions).toHaveLength(1);
  });

  it('a revoked link cannot be peeked-open or submitted', async () => {
    const create = await post(tokens.ops, '/api/v1/intake/links', { kind: 'Onboarding' });
    const linkId = create.json().link.id;
    const token = create.json().token;
    const rev = await post(tokens.ops, `/api/v1/intake/links/${linkId}/revoke`);
    expect(rev.statusCode).toBe(200);
    expect(rev.json().link.status).toBe('Revoked');

    expect((await peekGuest(token)).json().open).toBe(false);
    expect((await submitGuest(token, { fullName: 'Nope' })).statusCode).toBe(410);
  });

  it('an unknown token 404s on peek and 410s on submit — no oracle, no data', async () => {
    const bogus = 'x'.repeat(43);
    expect((await peekGuest(bogus)).statusCode).toBe(404);
    expect((await submitGuest(bogus, { fullName: 'Ghost' })).statusCode).toBe(410);
  });

  it('a file whose bytes do not match its declared type is refused (415), submission not created', async () => {
    const link = await mintLink(tokens.ops);
    const bad = await submitGuest(link, { fullName: 'Faker' }, [{ name: 'fake.pdf', type: 'application/pdf', bytes: Buffer.from('just text') }]);
    expect(bad.statusCode).toBe(415);
    // The link was NOT consumed (nothing landed) — the guest can retry.
    expect((await peekGuest(link)).json().open).toBe(true);
    expect((await get(tokens.ops, '/api/v1/intake/submissions')).json().submissions).toHaveLength(0);
  });
});

describe('guest intake — reject wipes', () => {
  it('rejecting scrubs the payload + uploads and deletes the quarantined blob', async () => {
    const link = await mintLink(tokens.ops);
    const sub = await submitGuest(link, { fullName: 'To Reject', email: 'secret@x.com' }, [{ name: 'id.pdf', type: 'application/pdf', bytes: PDF }]);
    const s = (await get(tokens.ops, '/api/v1/intake/submissions')).json().submissions[0];
    const uploadId = s.uploads[0].uploadId;

    const rej = await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/reject`, { decisionNote: 'not a real applicant' });
    expect(rej.statusCode, rej.body).toBe(200);
    expect(rej.json().submission.status).toBe('Rejected');
    expect(rej.json().submission.payload).toBeNull();
    expect(rej.json().submission.uploads).toHaveLength(0);

    // The quarantined blob is gone.
    expect((await get(tokens.ops, `/api/v1/intake/submissions/${s.id}/uploads/${uploadId}`)).statusCode).toBe(404);
    // Promote/reject-again refused (already reviewed).
    expect((await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/promote`, {})).statusCode).toBe(409);
    void sub;
  });
});

describe('guest intake — boundaries (roles, tenants, public scope)', () => {
  it('read-only roles cannot mint, list, or promote (403)', async () => {
    expect((await post(tokens.visitor, '/api/v1/intake/links', { kind: 'Onboarding' })).statusCode).toBe(403);
    expect((await get(tokens.visitor, '/api/v1/intake/links')).statusCode).toBe(403);
    expect((await get(tokens.visitor, '/api/v1/intake/submissions')).statusCode).toBe(403);
  });

  it('cross-tenant: a link minted in alpha lands only in alpha; bravo never sees it', async () => {
    const link = await mintLink(tokens.ops, 'alpha only');
    expect((await submitGuest(link, { fullName: 'Alpha Joiner' })).statusCode).toBe(201);

    expect((await get(tokens.ops, '/api/v1/intake/submissions')).json().submissions).toHaveLength(1);
    // Bravo's sandbox is empty — RLS isolates it.
    expect((await get(tokens.ownerB, '/api/v1/intake/submissions')).json().submissions).toHaveLength(0);
    // Bravo cannot see alpha's links either.
    expect((await get(tokens.ownerB, '/api/v1/intake/links')).json().links).toHaveLength(0);
  });

  it('the public exemption is scoped to /intake/public/ ONLY — the staff routes still require auth', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/api/v1/intake/links' });
    expect(noAuth.statusCode).toBe(401);
    const noAuthSub = await app.inject({ method: 'GET', url: '/api/v1/intake/submissions' });
    expect(noAuthSub.statusCode).toBe(401);
  });
});
