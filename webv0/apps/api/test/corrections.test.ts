/**
 * corrections.test.ts (api) — Track B1: request corrections over HTTP.
 *
 * "Polish freely until review starts — every change on the record; after
 * that, frozen; corrections are new requests." Proves: edit-before-review
 * (submitter-only, Submitted-only, target-locked, on the record); the freeze
 * at the beginReview boundary; and revise-and-resubmit (withdraw-if-open +
 * fresh linked request via the op's real submit, with the status gate).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
const tokens = {} as { ops: string; ops2: string; owner: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });

/** Submit an AddPerson request; returns its {approvalId, version}. */
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
    DEV_AUTH_SECRET: 'corrections-test-secret-00000000',
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
});

describe('Track B1 — edit before review', () => {
  it('the submitter polishes their own Submitted request in place; every edit is on the record', async () => {
    const a = await submitPerson(tokens.ops, 'Jordn Reyas'); // a typo to fix

    const edit = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/edit`, { expectedVersion: a.version, input: { fullName: 'Jordan Reyes' } });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json().approval).toMatchObject({ status: 'Submitted', editCount: 1 });
    // same APR id — an edit is not a new request
    expect(edit.json().approval.approvalId).toBe(a.approvalId);

    // the event names WHICH field changed (never the value — H-01)
    const events = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}/events`);
    const editEvent = events.json().events.find((e: { note: string | null }) => e.note?.includes('Request edited'));
    expect(editEvent.note).toContain('fullName');
    expect(editEvent.note).not.toContain('Jordan Reyes');

    // a second identical edit is refused (nothing changed)
    const noop = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/edit`, { expectedVersion: edit.json().approval.version, input: { fullName: 'Jordan Reyes' } });
    expect(noop.statusCode).toBe(409);
  });

  it('only the submitter may edit — a colleague is refused', async () => {
    const a = await submitPerson(tokens.ops, 'Someone');
    const other = await post(tokens.ops2, `/api/v1/approvals/${a.approvalId}/edit`, { expectedVersion: a.version, input: { fullName: 'Hijacked' } });
    expect(other.statusCode).toBe(403);
  });

  it('an edit may not change the TARGET (the one-open-per-target guard would be dodged)', async () => {
    // AddCredential targets a person: submit for a real one first.
    const p = await submitPerson(tokens.ops, 'Cred Owner');
    const rev = await post(tokens.owner, `/api/v1/approvals/${p.approvalId}/begin-review`, { expectedVersion: p.version });
    const appr = await post(tokens.owner, `/api/v1/approvals/${p.approvalId}/approve`, { expectedVersion: rev.json().approval.version });
    const exec = await post(tokens.owner, `/api/v1/approvals/${p.approvalId}/execute`, { expectedVersion: appr.json().approval.version });
    const personId = exec.json().person.personId as string;

    const credSub = await post(tokens.ops, '/api/v1/credentials/requests', { input: { personId, credentialType: 'Passport', kind: 'Passport', issuedOn: '2026-01-01' } });
    expect(credSub.statusCode, credSub.body).toBe(201);
    const cred = credSub.json().approval;

    // editing a non-target field is fine…
    const ok = await post(tokens.ops, `/api/v1/approvals/${cred.approvalId}/edit`, { expectedVersion: cred.version, input: { personId, credentialType: 'National ID Card', kind: 'NationalID', issuedOn: '2026-01-01' } });
    expect(ok.statusCode, ok.body).toBe(200);
    // …retargeting personId is refused
    const retarget = await post(tokens.ops, `/api/v1/approvals/${cred.approvalId}/edit`, { expectedVersion: ok.json().approval.version, input: { personId: 'PER-9999', credentialType: 'National ID Card', kind: 'NationalID', issuedOn: '2026-01-01' } });
    expect(retarget.statusCode).toBe(409);
  });

  it('the freeze sits at begin-review: editing an InReview request is refused', async () => {
    const a = await submitPerson(tokens.ops, 'Freeze Me');
    const rev = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    expect(rev.statusCode).toBe(200);
    const edit = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/edit`, { expectedVersion: rev.json().approval.version, input: { fullName: 'Too Late' } });
    expect(edit.statusCode).toBe(409);
  });
});

describe('Track B1 — revise & resubmit', () => {
  it('a rejected request is revised into a fresh linked request; both rows carry the tie', async () => {
    const a = await submitPerson(tokens.ops, 'Rejected One');
    const rev = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    const rej = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/reject`, { expectedVersion: rev.json().approval.version, reason: 'wrong name' });
    expect(rej.statusCode, rej.body).toBe(200);

    const revise = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: rej.json().approval.version, input: { fullName: 'Corrected One' } });
    expect(revise.statusCode, revise.body).toBe(201);
    const fresh = revise.json().approval;
    expect(fresh.approvalId).not.toBe(a.approvalId);
    expect(fresh).toMatchObject({ status: 'Submitted', revisionOf: a.approvalId });
    expect(revise.json().superseded).toBe(a.approvalId);

    // the old row now points forward; it stays Rejected (linking never reopens it)
    const old = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
    expect(old.json().approval).toMatchObject({ status: 'Rejected', supersededBy: fresh.approvalId });
  });

  it('M-06: a source already revised cannot be revised again — the chain never forks', async () => {
    const a = await submitPerson(tokens.ops, 'Fork Me');
    const rev = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    const rej = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/reject`, { expectedVersion: rev.json().approval.version, reason: 'redo' });

    // the first revision supersedes the source
    const first = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: rej.json().approval.version, input: { fullName: 'First Fix' } });
    expect(first.statusCode, first.body).toBe(201);
    const firstId = first.json().approval.approvalId as string;

    // a SECOND revise of the same (still-Rejected, now-superseded) source is refused…
    const second = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: rej.json().approval.version, input: { fullName: 'Second Fix' } });
    expect(second.statusCode, second.body).toBe(409);

    // …and the source still points ONLY at the first revision, symmetrically.
    const old = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
    expect(old.json().approval.supersededBy).toBe(firstId);
    const kept = await get(tokens.owner, `/api/v1/approvals/${firstId}`);
    expect(kept.json().approval.revisionOf).toBe(a.approvalId);
  });

  it('M-06: two concurrent revisions of one source — exactly one wins, links stay symmetric', async () => {
    const a = await submitPerson(tokens.ops, 'Race Me');
    const rev = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    const rej = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/reject`, { expectedVersion: rev.json().approval.version, reason: 'redo' });
    const v = rej.json().approval.version as number;

    // fire both revisions at the same version, concurrently.
    const [r1, r2] = await Promise.all([
      post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: v, input: { fullName: 'Racer A' } }),
      post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: v, input: { fullName: 'Racer B' } }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([201, 409]); // exactly one revision, not two
    const winner = (r1.statusCode === 201 ? r1 : r2).json().approval.approvalId as string;

    // the source points at the winner, and the winner points back — no asymmetry.
    const old = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
    expect(old.json().approval.supersededBy).toBe(winner);
    const w = await get(tokens.owner, `/api/v1/approvals/${winner}`);
    expect(w.json().approval).toMatchObject({ status: 'Submitted', revisionOf: a.approvalId });
  });

  it('revising a still-open request withdraws the old one first', async () => {
    const a = await submitPerson(tokens.ops, 'Open One');
    const revise = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: a.version, input: { fullName: 'Open One Fixed' } });
    expect(revise.statusCode, revise.body).toBe(201);
    const old = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
    expect(old.json().approval.status).toBe('Withdrawn');
    expect(old.json().approval.supersededBy).toBe(revise.json().approval.approvalId);
  });

  it('an Approved request cannot be revised — it belongs to the reviewers', async () => {
    const a = await submitPerson(tokens.ops, 'Approved One');
    const rev = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    const appr = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/approve`, { expectedVersion: rev.json().approval.version });
    expect(appr.statusCode).toBe(200);
    const revise = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: appr.json().approval.version, input: { fullName: 'Nope' } });
    expect(revise.statusCode).toBe(409);
  });

  it('a schema-invalid revision refuses WITHOUT touching the old request', async () => {
    const a = await submitPerson(tokens.ops, 'Keep Me');
    const bad = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, { expectedVersion: a.version, input: { fullName: '' } });
    expect(bad.statusCode).toBe(400);
    // the old request is untouched — still Submitted, not withdrawn
    const still = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
    expect(still.json().approval.status).toBe('Submitted');
    expect(still.json().approval.supersededBy).toBeNull();
  });

  it('M-06: a crash after tx-1 (source withdrawn + Pending intent, no successor) is recovered by the drain, idempotently', async () => {
    const a = await submitPerson(tokens.ops, 'Crashed Src');
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const tid = (await admin.query(`SELECT id FROM tenant WHERE slug='alpha'`)).rows[0].id as string;
      // Simulate tx-1 committing, then the process crashing before tx-2: the source is
      // Withdrawn and a durable Pending intent exists, but no successor was submitted.
      await admin.query(`UPDATE approval SET status='Withdrawn' WHERE approval_id=$1 AND tenant_id=$2`, [a.approvalId, tid]);
      await admin.query(
        `INSERT INTO approval_revision (tenant_id, source_approval_id, operation_type, payload, submitted_by, status)
         VALUES ($1,$2,'AddPerson',$3::jsonb,'ops@alpha.com','Pending')`,
        [tid, a.approvalId, JSON.stringify({ operationType: 'AddPerson', input: { fullName: 'Crashed Fix' } })],
      );

      // The drain finishes it: submit + link, exactly once.
      const drain1 = await post(tokens.owner, '/api/v1/approvals/drain-revisions');
      expect(drain1.statusCode, drain1.body).toBe(200);
      expect(drain1.json()).toMatchObject({ attempted: 1, completed: 1, abandoned: 0 });

      // the source now points forward; exactly one successor exists, linked both ways.
      const old = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
      const successorId = old.json().approval.supersededBy as string;
      expect(successorId).toBeTruthy();
      const succ = await get(tokens.owner, `/api/v1/approvals/${successorId}`);
      expect(succ.json().approval).toMatchObject({ status: 'Submitted', revisionOf: a.approvalId });

      // the intent is Completed; a re-drain is a no-op (never a second successor).
      const intent = await admin.query(`SELECT status, submitted_approval_id FROM approval_revision WHERE source_approval_id=$1`, [a.approvalId]);
      expect(intent.rows[0]).toMatchObject({ status: 'Completed', submitted_approval_id: successorId });
      const drain2 = await post(tokens.owner, '/api/v1/approvals/drain-revisions');
      expect(drain2.json()).toMatchObject({ attempted: 0, completed: 0 });
      const succCount = await admin.query(`SELECT count(*)::int AS n FROM approval WHERE revision_of=$1 AND status<>'Withdrawn'`, [a.approvalId]);
      expect(succCount.rows[0].n).toBe(1);
    } finally {
      await admin.end();
    }
  });

  it('M-06: a DETERMINISTIC submit refusal abandons the intent + surfaces the truthful error — a durable record, not a silent orphan', async () => {
    const a = await submitPerson(tokens.ops, 'Abandon Src');
    const rev = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version });
    const rej = await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/reject`, { expectedVersion: rev.json().approval.version, reason: 'redo' });

    // Revise into an AddPerson naming a non-existent entity: schema-valid, so it reaches
    // tx-2, where submitAddPerson refuses deterministically (Entity not found).
    const revise = await post(tokens.ops, `/api/v1/approvals/${a.approvalId}/revise`, {
      expectedVersion: rej.json().approval.version,
      input: { fullName: 'Abandon Fix', entityId: 'ENT-9999' },
    });
    expect(revise.statusCode).toBe(404); // the truthful NotFoundError is surfaced

    // The Rejected source is untouched (no successor); the intent is durably Abandoned.
    const old = await get(tokens.owner, `/api/v1/approvals/${a.approvalId}`);
    expect(old.json().approval).toMatchObject({ status: 'Rejected', supersededBy: null });

    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const intent = await admin.query(`SELECT status, last_error FROM approval_revision WHERE source_approval_id=$1`, [a.approvalId]);
      expect(intent.rows[0].status).toBe('Abandoned');
      expect(intent.rows[0].last_error).toBeTruthy();
      const succ = await admin.query(`SELECT count(*)::int AS n FROM approval WHERE revision_of=$1`, [a.approvalId]);
      expect(succ.rows[0].n).toBe(0);
      // a drain does not resurrect an Abandoned intent.
      const drain = await post(tokens.owner, '/api/v1/approvals/drain-revisions');
      expect(drain.json()).toMatchObject({ attempted: 0 });
    } finally {
      await admin.end();
    }
  });
});
