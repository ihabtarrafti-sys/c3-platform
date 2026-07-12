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
import { Client } from 'pg';
import type { Actor } from '@c3web/domain';
import { wipeRejectedIntakeBlobs } from '@c3web/application';
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

async function adminQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: db.adminUrl });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

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
    // H-02: the joiner's email is PII — it rides its own gated column, NEVER
    // notes (notes is emitted to every canReadPeople role). The owner has PII
    // standing so sees it in the field; notes carries no PII label.
    expect(exec.person.email).toBe('ahmad@x.com');
    expect(exec.person.notes ?? '').not.toContain('Email:');

    // Attach the quarantined file to the created person (copy quarantine→live).
    const attach = await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/attach`, { uploadIds: [s.uploads[0].uploadId] });
    expect(attach.statusCode, attach.body).toBe(200);
    expect(attach.json()).toMatchObject({ attachedCount: 1, personId });

    const docs = await get(tokens.owner, `/api/v1/documents?ownerType=Person&ownerId=${personId}`);
    expect(docs.json().documents).toHaveLength(1);
    expect(docs.json().documents[0].fileName).toBe('passport.pdf');
  });

  it('H-02: intake PII lands in the gated columns, never notes — structurally absent for a non-PII reader', async () => {
    const link = await mintLink(tokens.ops, 'PII routing');
    const sub = await submitGuest(link, {
      fullName: 'Priya Vasquez',
      dateOfBirth: '1998-05-01',
      email: 'priya@x.com',
      phone: '+971500000000',
      addressLine1: '12 Marina Walk',
      addressCity: 'Dubai',
      addressCountry: 'AE',
      apparelSize: 'M', // non-PII → legitimately stays in notes
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const s = (await get(tokens.ops, '/api/v1/intake/submissions')).json().submissions[0];
    const promote = await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/promote`, { decisionNote: 'ok' });
    const personId = (await governedExecute(tokens.owner, promote.json().approval.approvalId, promote.json().approval.version)).person.personId;

    // The owner (PII standing) sees the PII in its gated columns — NOT in notes.
    const asOwner = (await get(tokens.owner, `/api/v1/people/${personId}`)).json().person;
    expect(asOwner.dateOfBirth).toBe('1998-05-01');
    expect(asOwner.email).toBe('priya@x.com');
    expect(asOwner.phone).toBe('+971500000000');
    expect(asOwner.addressLine1).toBe('12 Marina Walk');
    const ownerNotes = asOwner.notes ?? '';
    for (const label of ['Date of birth', 'Email', 'Phone', 'Address']) expect(ownerNotes).not.toContain(`${label}:`);
    expect(ownerNotes).toContain('Apparel size: M'); // non-PII context preserved

    // A read-only role (visitor): canReadPeople but NOT canViewPersonPII → the
    // PII fields are structurally ABSENT, and notes leaks none of it either.
    const asVisitor = (await get(tokens.visitor, `/api/v1/people/${personId}`)).json().person;
    for (const f of ['dateOfBirth', 'email', 'phone', 'addressLine1', 'addressCity', 'addressCountry']) {
      expect(asVisitor[f]).toBeUndefined();
    }
    const visitorBlob = JSON.stringify(asVisitor);
    for (const leak of ['priya@x.com', '1998-05-01', '971500000000', 'Marina Walk']) expect(visitorBlob).not.toContain(leak);
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
    // M-02: the wipe rode a durable tombstone (reason='intake_reject') that the
    // route's drain resolved after verifying the object is gone.
    const ts = await adminQuery<{ deleted_at: string | null }>(`SELECT deleted_at FROM blob_tombstone WHERE reason='intake_reject'`);
    expect(ts).toHaveLength(1);
    expect(ts[0]!.deleted_at).not.toBeNull();
    // Promote/reject-again refused (already reviewed).
    expect((await post(tokens.ops, `/api/v1/intake/submissions/${s.id}/promote`, {})).statusCode).toBe(409);
    void sub;
  });

  it('M-02: a delete failure leaves a retryable tombstone (not an orphan); a later drain resolves it', async () => {
    const [tenant] = await adminQuery<{ id: string }>(`SELECT id FROM tenant WHERE slug='alpha'`);
    const alphaId = tenant!.id;
    const actor: Actor = { identity: 'ops@a.com', displayName: 'Ops A', role: 'operations', tenantId: alphaId };
    const key = `intake/${alphaId}/subX/upX`;
    await adminQuery(`INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason) VALUES ($1, $2, 'intake', 'intake_reject')`, [alphaId, key]);

    // Storage whose delete THROWS: the tombstone stays pending, error recorded, attempts bumped.
    const failing = { get: async (_k: string) => null, delete: async (_k: string) => { throw new Error('storage down'); } };
    expect(await wipeRejectedIntakeBlobs(deps.persistence, failing, actor)).toMatchObject({ attempted: 1, wiped: 0, stillPending: 1 });
    const [t1] = await adminQuery<{ deleted_at: string | null; attempts: number; last_error: string | null }>(
      `SELECT deleted_at, attempts, last_error FROM blob_tombstone WHERE storage_key=$1`, [key],
    );
    expect(t1!.deleted_at).toBeNull(); // NOT orphaned — retryable
    expect(t1!.attempts).toBe(1);
    expect(t1!.last_error).toMatch(/storage down/);

    // A later drain with working storage (object verified gone) resolves it.
    const working = { get: async (_k: string) => null, delete: async (_k: string) => {} };
    expect(await wipeRejectedIntakeBlobs(deps.persistence, working, actor)).toMatchObject({ attempted: 1, wiped: 1, stillPending: 0 });
    const [t2] = await adminQuery<{ deleted_at: string | null }>(`SELECT deleted_at FROM blob_tombstone WHERE storage_key=$1`, [key]);
    expect(t2!.deleted_at).not.toBeNull();
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
