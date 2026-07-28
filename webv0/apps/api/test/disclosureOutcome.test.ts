/**
 * disclosureOutcome.test.ts (api) — F16 + THE FIVE-OBJECT OUTCOME ASSERTION
 * (C3-DISCLOSURE-CHAPTER-SCOPE.md Block 2; dossiers: C3-NEO F16 challenge +
 * Prism ATLAS disposition, both re-verified 2026-07-28).
 *
 * THE SEAL: the five execute side objects × EVERY role in the matrix,
 * asserting the DISCLOSURE OUTCOME per cell — what a role actually RECEIVES,
 * not what a gate returns. Two completeness laws make it structural:
 *   - the intent table must cover every member of C3_ROLES — a new role fails
 *     this file until someone STATES its outcome;
 *   - the execute response must carry exactly the declared key set — a new
 *     side object fails this file until someone STATES its outcome.
 *
 * The probing lever is the already-Executed idempotent branch: each approval
 * executes ONCE (owner), then every role re-hits the same route and receives
 * the side object under ITS OWN disclosure — the exact surface Neo flagged as
 * the historical-locator channel, proven per-role here. One first-execute
 * cell (hr executes an agreement approval first-hand) proves the fix is not
 * idempotent-branch-only.
 *
 * RED (F16): pre-fix, the two ruled cells — agreement × hr and × visitor —
 * failed exactly ("CURRENT ROLE MATRIX SAFE" held everywhere else); the fix
 * gates the agreement side object on canReadAgreements at the route boundary.
 * THE FOURTH AXIS STAYS DEFERRED: no domain axis was added to
 * PayloadDisclosure — that redesign is ruled owner-visible work.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { C3_ROLES } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

type RoleName = (typeof C3_ROLES)[number];
const tokens = {} as Record<RoleName | 'ops2', string>;

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });

async function governedExecute(approvalId: string, version: number) {
  const rev = await post(tokens.owner, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version });
  expect(rev.statusCode, rev.body).toBe(200);
  const appr = await post(tokens.owner, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: rev.json().approval.version });
  expect(appr.statusCode, appr.body).toBe(200);
  const exec = await post(tokens.owner, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: appr.json().approval.version });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

async function submit(url: string, input: Record<string, unknown>): Promise<{ approvalId: string; version: number }> {
  // ops2 is the sole submitter, so every OTHER role clears self-review.
  const res = await post(tokens.ops2, url, { input });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approval;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'disclosure-outcome-secret-000000',
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
  for (const role of C3_ROLES) tokens[role] = await login(`${role}@alpha.com`, role, 'alpha');
  tokens.ops2 = await login('ops2@alpha.com', 'operations', 'alpha');
});

/** The five side-object keys the execute response declares. A NEW side object
 *  must be added HERE with a stated outcome per role, or the key-set law fails. */
const SIDE_OBJECTS = ['person', 'credential', 'journey', 'participant', 'agreement'] as const;
type SideObject = (typeof SIDE_OBJECTS)[number];
const RESPONSE_KEYS = ['approval', ...SIDE_OBJECTS, 'idempotent'].sort();

/**
 * THE INTENT TABLE — the stated disclosure outcome per role × produced object.
 * 'received' = the role gets the object (its FIELD facets are the projector
 * tests' jurisdiction); 'null' = the object is withheld whole (absence, not
 * masking). Every entry is a STATEMENT; a new role has no row until someone
 * writes one. Basis: person/credential/journey/participant ride the universal
 * people-read (CURRENT ROLE MATRIX SAFE per both sweeps); agreement rides
 * canReadAgreements, which hr and visitor do not hold — F16's ruled boundary.
 */
const ROLE_OUTCOMES: Record<RoleName, Record<SideObject, 'received' | 'null'>> = {
  owner: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'received' },
  operations: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'received' },
  legal: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'received' },
  finance: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'received' },
  hr: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'null' },
  management: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'received' },
  visitor: { person: 'received', credential: 'received', journey: 'received', participant: 'received', agreement: 'null' },
};

describe('F16 + the five-object role × domain outcome assertion', () => {
  it('every role × every execute side object receives EXACTLY the stated outcome (no sampling)', async () => {
    // COMPLETENESS LAW 1: the table covers every role, and nothing else.
    expect(Object.keys(ROLE_OUTCOMES).sort()).toEqual([...C3_ROLES].sort());

    // ── fixtures: one approval per side object, submitted by ops2, executed by owner ──
    const person = await submit('/api/v1/approvals', { fullName: 'Outcome Matrix Person' });
    const personId = (await governedExecute(person.approvalId, person.version)).person.personId as string;

    const credential = await submit('/api/v1/credentials/requests', { personId, credentialType: 'Coaching License A', issuer: 'Federation', issuedOn: '2026-01-02', expiresOn: '2031-12-30' });
    await governedExecute(credential.approvalId, credential.version);

    const journey = await submit('/api/v1/journeys/requests', { personId, journeyType: 'Pro Contract Onboarding', startedOn: '2026-07-01' });
    await governedExecute(journey.approvalId, journey.version);

    const missionRes = await post(tokens.ops2, '/api/v1/missions', { name: 'Outcome Matrix Cup', startsOn: '2026-08-01' });
    expect(missionRes.statusCode, missionRes.body).toBe(201);
    const missionId = missionRes.json().mission.missionId as string;
    const participant = await submit('/api/v1/missions/participants/requests', { missionId, personId, role: 'Player' });
    await governedExecute(participant.approvalId, participant.version);

    const agreement = await submit('/api/v1/agreements/requests', { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31' });
    await governedExecute(agreement.approvalId, agreement.version);

    const FIXTURES: Record<SideObject, string> = {
      person: person.approvalId,
      credential: credential.approvalId,
      journey: journey.approvalId,
      participant: participant.approvalId,
      agreement: agreement.approvalId,
    };

    // ── delegations: every non-owner role gains execute standing as one unit ──
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
    for (const role of C3_ROLES) {
      if (role === 'owner') continue;
      const dlg = await post(tokens.owner, '/api/v1/delegations', { granteeIdentity: `${role}@alpha.com`, startsOn: today, endsOn: end, reason: 'outcome matrix' });
      expect(dlg.statusCode, dlg.body).toBe(201);
    }

    // ── THE MATRIX: every role probes every executed approval idempotently ──
    for (const role of C3_ROLES) {
      for (const object of SIDE_OBJECTS) {
        const res = await post(tokens[role], `/api/v1/approvals/${FIXTURES[object]}/execute`, { expectedVersion: 1 });
        expect(res.statusCode, `${role} × ${object}: ${res.body}`).toBe(200);
        const body = res.json();
        expect(body.idempotent, `${role} × ${object} must ride the idempotent branch`).toBe(true);

        // COMPLETENESS LAW 2: the response carries exactly the declared keys —
        // a new side object fails HERE until its outcome is stated above.
        expect(Object.keys(body).sort(), `${role} × ${object}: the response key set moved`).toEqual(RESPONSE_KEYS);

        // THE CELL: the produced object arrives per the STATED outcome; the
        // four unproduced slots are null by production, role-independent.
        for (const slot of SIDE_OBJECTS) {
          if (slot !== object) {
            expect(body[slot], `${role} × ${object}: unproduced slot ${slot}`).toBeNull();
          } else if (ROLE_OUTCOMES[role][object] === 'received') {
            expect(body[slot], `${role} × ${object}: stated RECEIVED, got null`).not.toBeNull();
          } else {
            expect(body[slot], `${role} × ${object}: stated NULL (domain-unread role), got content`).toBeNull();
          }
        }
      }
    }

    // ── BLOCK 7 UN-SCOPED THIS ASSERTION (the owner-authorized acceptance):
    //    Block 2 had to scope it to "outside the approval envelope" because
    //    the payload channel had no agreements axis to strip with — and that
    //    scoping PROVED the residual live, which is what authorized the axis.
    //    Now the WHOLE hr response must carry no agreement content anywhere.
    const hrProbe = await post(tokens.hr, `/api/v1/approvals/${FIXTURES.agreement}/execute`, { expectedVersion: 1 });
    expect(hrProbe.body, 'no agreement content ANYWHERE in a domain-unread response').not.toContain('Player Contract');
  });

  it('the fix covers the FIRST execute too, not only the idempotent branch', async () => {
    // A fresh agreement approval, approved by owner, EXECUTED first-hand by a
    // delegated hr — the delegation law grants the standing to DECIDE; what
    // changes is what they SEE.
    const pr = await submit('/api/v1/approvals', { fullName: 'First Execute Person' });
    const personId = (await governedExecute(pr.approvalId, pr.version)).person.personId as string;
    const ag = await submit('/api/v1/agreements/requests', { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31' });

    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
    const dlg = await post(tokens.owner, '/api/v1/delegations', { granteeIdentity: 'hr@alpha.com', startsOn: today, endsOn: end, reason: 'first-execute proof' });
    expect(dlg.statusCode, dlg.body).toBe(201);

    const rev = await post(tokens.owner, `/api/v1/approvals/${ag.approvalId}/begin-review`, { expectedVersion: ag.version });
    expect(rev.statusCode, rev.body).toBe(200);
    const appr = await post(tokens.owner, `/api/v1/approvals/${ag.approvalId}/approve`, { expectedVersion: rev.json().approval.version });
    expect(appr.statusCode, appr.body).toBe(200);

    const exec = await post(tokens.hr, `/api/v1/approvals/${ag.approvalId}/execute`, { expectedVersion: appr.json().approval.version });
    expect(exec.statusCode, exec.body).toBe(200);
    expect(exec.json().approval.status).toBe('Executed'); // the DECISION stood
    expect(exec.json().agreement, 'hr executed it and still does not SEE it').toBeNull();
    // Block 7 un-scoped: the WHOLE first-execute response, envelope included.
    expect(exec.body).not.toContain('Player Contract');

    // POSITIVE CONTROL on the same route: an agreement-reading executor (the
    // owner — base standing, no delegation needed in this test) gets the
    // object back from the idempotent branch.
    const ownerProbe = await post(tokens.owner, `/api/v1/approvals/${ag.approvalId}/execute`, { expectedVersion: 1 });
    expect(ownerProbe.statusCode, ownerProbe.body).toBe(200);
    expect(ownerProbe.json().agreement).not.toBeNull();
  });
});
