/**
 * journeys.test.ts — Sprint 37 J2 evidence against a REAL PostgreSQL.
 * Covers: the governed InitiateJourney chain (born Active, dates
 * byte-for-byte, same-tx audit), execute idempotency, every DIRECT-audited
 * transition (suspend → resume → complete with endedOn stamped; cancel with a
 * mandatory audited reason), illegal-transition and stale-version refusals
 * with zero change, the DB-level terminal/ended coherence constraint,
 * role gating, and RLS isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Actor, AddPersonInput } from '@c3web/domain';
import {
  submitInitiateJourney,
  transitionJourney,
  submitAddPerson,
  beginReview,
  approveApproval,
  executeApproval,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let bravoId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let bravoOwner: Actor;
let alphaVisitor: Actor;

async function chain(executing: Actor, approvalId: string, version: number) {
  const inReview = await beginReview(p, executing, approvalId, version);
  const approved = await approveApproval(p, executing, inReview.approvalId, inReview.version);
  return executeApproval(p, executing, approved.approvalId, approved.version);
}

async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const res = await chain(alphaOwner, a.approvalId, a.version);
  return res.person!.personId;
}

/** Governed initiate → executed journey (born Active). */
async function initiate(personId: string, journeyType = 'Pro Contract Onboarding') {
  const a = await submitInitiateJourney(p, alphaOps, { input: { personId, journeyType, startedOn: '2026-07-01' } });
  const res = await chain(alphaOwner, a.approvalId, a.version);
  return res.journey!;
}

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  const alpha = await db.seedTenant({
    slug: 'alpha',
    users: [
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' },
      { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' },
      { key: 'visitor', email: 'visitor@a.com', displayName: 'Visitor A', role: 'visitor' },
    ],
  });
  const bravo = await db.seedTenant({
    slug: 'bravo',
    users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }],
  });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravoId, 'owner@b.com', 'owner');
});

describe('governed InitiateJourney chain', () => {
  it('creates the journey Active on execute, dates byte-for-byte, audited same-tx', async () => {
    const personId = await addPerson('Jordan Reyes');
    const journey = await initiate(personId);
    expect(journey).toMatchObject({
      journeyId: 'JRN-0001',
      personId,
      status: 'Active',
      startedOn: '2026-07-01',
      endedOn: null,
    });
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Journey', 'JRN-0001');
    expect(audit.some((e) => e.action === 'JourneyInitiated' && e.after?.startedOn === '2026-07-01')).toBe(true);
    expect(await p.reads.forActor(alphaOwner).listJourneysForPerson(personId)).toHaveLength(1);
  });

  it('re-execution is idempotent (one journey, same result)', async () => {
    const personId = await addPerson('Solo');
    const a = await submitInitiateJourney(p, alphaOps, { input: { personId, journeyType: 'J', startedOn: '2026-07-01' } });
    const res = await chain(alphaOwner, a.approvalId, a.version);
    const again = await executeApproval(p, alphaOwner, a.approvalId, res.approval.version);
    expect(again.idempotent).toBe(true);
    expect(again.journey?.journeyId).toBe(res.journey?.journeyId);
    expect(await p.reads.forActor(alphaOwner).listJourneys()).toHaveLength(1);
  });

  it('submit refuses an unknown person', async () => {
    await expect(
      submitInitiateJourney(p, alphaOps, { input: { personId: 'PER-9999', journeyType: 'J', startedOn: '2026-07-01' } }),
    ).rejects.toThrow(/Person not found/i);
  });
});

describe('direct-audited transitions', () => {
  it('suspend → resume → complete: statuses flow, endedOn stamps, every step audited', async () => {
    const personId = await addPerson('Lifecycle Person');
    const j = await initiate(personId);

    const suspended = await transitionJourney(p, alphaOps, j.journeyId, 'suspend', j.version);
    expect(suspended.status).toBe('Suspended');
    const resumed = await transitionJourney(p, alphaOwner, j.journeyId, 'resume', suspended.version);
    expect(resumed.status).toBe('Active');
    const completed = await transitionJourney(p, alphaOps, j.journeyId, 'complete', resumed.version);
    expect(completed.status).toBe('Completed');
    expect(completed.endedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Journey', j.journeyId);
    const actions = audit.map((e) => e.action);
    for (const a of ['JourneyInitiated', 'JourneySuspended', 'JourneyResumed', 'JourneyCompleted']) {
      expect(actions).toContain(a);
    }
    // Actor truthfulness: the resume was the owner, the suspend was ops.
    expect(audit.find((e) => e.action === 'JourneySuspended')?.actor).toBe('ops@a.com');
    expect(audit.find((e) => e.action === 'JourneyResumed')?.actor).toBe('owner@a.com');
  });

  it('cancel requires a reason and records it in the audit trail', async () => {
    const personId = await addPerson('Cancel Target');
    const j = await initiate(personId);
    await expect(transitionJourney(p, alphaOps, j.journeyId, 'cancel', j.version)).rejects.toThrow(/requires a reason/i);
    const cancelled = await transitionJourney(p, alphaOps, j.journeyId, 'cancel', j.version, 'Contract terminated early');
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.endedOn).not.toBeNull();
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Journey', j.journeyId);
    expect(audit.find((e) => e.action === 'JourneyCancelled')?.after?.reason).toBe('Contract terminated early');
  });

  it('illegal transitions and terminal states refuse with zero change', async () => {
    const personId = await addPerson('Illegal Target');
    const j = await initiate(personId);
    // resume while Active = illegal.
    await expect(transitionJourney(p, alphaOps, j.journeyId, 'resume', j.version)).rejects.toThrow(/Illegal .*transition/i);
    // complete it, then EVERYTHING refuses (terminal absorbs).
    const completed = await transitionJourney(p, alphaOps, j.journeyId, 'complete', j.version);
    for (const action of ['suspend', 'resume', 'complete', 'cancel'] as const) {
      await expect(
        transitionJourney(p, alphaOps, j.journeyId, action, completed.version, 'x'),
      ).rejects.toThrow(/Illegal .*transition/i);
    }
    const still = await p.reads.forActor(alphaOwner).getJourneyById(j.journeyId);
    expect(still?.status).toBe('Completed');
    expect(still?.version).toBe(completed.version); // no mutation attempts landed
  });

  it('a stale version refuses with ConcurrencyError and changes nothing', async () => {
    const personId = await addPerson('Stale Target');
    const j = await initiate(personId);
    const suspended = await transitionJourney(p, alphaOps, j.journeyId, 'suspend', j.version);
    // Retry with the OLD version.
    await expect(transitionJourney(p, alphaOps, j.journeyId, 'resume', j.version)).rejects.toThrow(/modified concurrently/i);
    const still = await p.reads.forActor(alphaOwner).getJourneyById(j.journeyId);
    expect(still?.status).toBe('Suspended');
    expect(still?.version).toBe(suspended.version);
  });

  it('read-only roles may not transition; unknown journey 404s', async () => {
    const personId = await addPerson('Role Target');
    const j = await initiate(personId);
    await expect(transitionJourney(p, alphaVisitor, j.journeyId, 'suspend', j.version)).rejects.toThrow(/may not operate/i);
    await expect(transitionJourney(p, alphaOps, 'JRN-9999', 'suspend', 0)).rejects.toThrow(/Journey not found/i);
  });
});

describe('database-level constraints and isolation', () => {
  it('the DB refuses an open journey with an end date (coherence CHECK), even bypassing the app', async () => {
    const personId = await addPerson('Constraint Target');
    const j = await initiate(personId);
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query('BEGIN');
      await admin.query("SELECT set_config('app.tenant_id', $1, true)", [alphaId]);
      await expect(
        admin.query(`UPDATE journey SET ended_on='2026-08-01' WHERE journey_id=$1`, [j.journeyId]),
      ).rejects.toThrow(/journey_terminal_ended_coherent/);
      await admin.query('ROLLBACK');
    } finally {
      await admin.end();
    }
  });

  it('journeys are tenant-isolated (RLS): bravo sees nothing of alpha', async () => {
    const personId = await addPerson('Isolated');
    await initiate(personId);
    expect(await p.reads.forActor(bravoOwner).listJourneys()).toHaveLength(0);
    expect(await p.reads.forActor(bravoOwner).getJourneyById('JRN-0001')).toBeNull();
    expect(await p.reads.forActor(alphaOwner).listJourneys()).toHaveLength(1);
  });
});
