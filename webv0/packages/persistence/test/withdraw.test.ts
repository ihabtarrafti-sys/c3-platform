/**
 * withdraw.test.ts — Sprint 42 W1 evidence against a REAL PostgreSQL: the
 * submitter-only withdrawal (the S41 single-owner-wedge remedy).
 *   - the submitter withdraws their own Submitted request (terminal, audited,
 *     version-guarded, DB CHECK accepts the new status);
 *   - anyone else — including an owner reviewer — is refused (the inverse of
 *     the self-review guard);
 *   - Approved is too late (reject is the reviewers' tool);
 *   - THE WEDGE-UNBLOCK PROOF: a pending renewal blocks further material ops
 *     on an agreement; withdrawing it unblocks them — no second owner needed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput, Approval } from '@c3web/domain';
import {
  withdrawApproval,
  submitAddAgreement,
  submitRenewAgreement,
  submitAddPerson,
  beginReview,
  approveApproval,
  executeApproval,
  type ExecuteResult,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let alphaOwner: Actor;
let alphaOps: Actor;

async function governedExecute(a: Approval): Promise<ExecuteResult> {
  const inReview = await beginReview(p, alphaOwner, a.approvalId, a.version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  return executeApproval(p, alphaOwner, approved.approvalId, approved.version);
}

async function addPersonAndAgreement(): Promise<string> {
  const person = await governedExecute(await submitAddPerson(p, alphaOps, { input: { fullName: 'Withdraw Target' } as AddPersonInput }));
  const agr = await governedExecute(
    await submitAddAgreement(p, alphaOps, {
      input: { personId: person.person!.personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31' },
    }),
  );
  return agr.agreement!.agreementId;
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
    ],
  });
  alphaId = alpha.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
});

describe('withdrawApproval (submitter-only, before a decision)', () => {
  it('the submitter withdraws their own Submitted request: terminal, audited, no side effects', async () => {
    const a = await submitAddPerson(p, alphaOps, { input: { fullName: 'Never Created' } as AddPersonInput });
    const withdrawn = await withdrawApproval(p, alphaOps, a.approvalId, a.version);
    expect(withdrawn.status).toBe('Withdrawn');
    expect(withdrawn.version).toBe(a.version + 1);

    // No side effects: the person was never created.
    expect(await p.reads.forActor(alphaOwner).listPeople()).toHaveLength(0);

    const events = await p.reads.forActor(alphaOwner).listApprovalEvents(a.approvalId);
    expect(events.map((e) => e.toStatus)).toEqual(['Submitted', 'Withdrawn']);
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Approval', a.approvalId);
    expect(audit.map((e) => e.action)).toContain('ApprovalWithdrawn');

    // Terminal: nothing further applies.
    await expect(beginReview(p, alphaOwner, a.approvalId, withdrawn.version)).rejects.toThrow(/Illegal approval transition/i);
    await expect(withdrawApproval(p, alphaOps, a.approvalId, withdrawn.version)).rejects.toThrow(/Illegal approval transition/i);
  });

  it('anyone else is refused — including an owner; and Approved is too late even for the submitter', async () => {
    const a = await submitAddPerson(p, alphaOps, { input: { fullName: 'Guarded' } as AddPersonInput });
    await expect(withdrawApproval(p, alphaOwner, a.approvalId, a.version)).rejects.toThrow(/Only the submitter/i);

    const inReview = await beginReview(p, alphaOwner, a.approvalId, a.version);
    // Still withdrawable while InReview — by the submitter only.
    await expect(withdrawApproval(p, alphaOwner, a.approvalId, inReview.version)).rejects.toThrow(/Only the submitter/i);
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
    await expect(withdrawApproval(p, alphaOps, a.approvalId, approved.version)).rejects.toThrow(/Illegal approval transition/i);
  });

  it('THE WEDGE-UNBLOCK PROOF: withdrawing a pending renewal releases the agreement, no second owner needed', async () => {
    const agreementId = await addPersonAndAgreement();

    // OPS wedges the agreement exactly like S41's owner did (any submitter can).
    const stuck = await submitRenewAgreement(p, alphaOps, { input: { agreementId, newEndsOn: '2028-07-31' } });
    await expect(
      submitRenewAgreement(p, alphaOps, { input: { agreementId, newEndsOn: '2029-07-31' } }),
    ).rejects.toThrow(/open approval already exists/i);

    // The submitter withdraws — the duplicate-pending guard now sees a CLOSED
    // record and the material lifecycle is free again.
    await withdrawApproval(p, alphaOps, stuck.approvalId, stuck.version);
    const fresh = await submitRenewAgreement(p, alphaOps, { input: { agreementId, newEndsOn: '2029-07-31' } });
    expect(fresh.status).toBe('Submitted');

    // And the withdrawn request never touched the term.
    const res = await governedExecute(fresh);
    expect(res.agreement!.endsOn).toBe('2029-07-31');
  });
});
