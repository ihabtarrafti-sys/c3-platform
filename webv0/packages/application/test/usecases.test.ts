import { describe, it, expect, beforeEach } from 'vitest';
import {
  type Actor,
  addPersonInputSchema,
  ApprovalNotApprovedError,
  ConcurrencyError,
  ForbiddenError,
  InvalidTransitionError,
  SelfReviewError,
  ValidationError,
} from '@c3web/domain';
import {
  submitAddPerson,
  beginReview,
  approveApproval,
  rejectApproval,
  executeApproval,
  listApprovals,
  listPeople,
} from '../src/index';
import { FakePersistence } from './fakePersistence';

const TENANT = '00000000-0000-0000-0000-000000000001';
const owner: Actor = { userId: '11111111-1111-1111-1111-111111111101', identity: 'owner@a.com', displayName: 'Owner', role: 'owner', tenantId: TENANT };
const owner2: Actor = { userId: '11111111-1111-1111-1111-111111111102', identity: 'owner2@a.com', displayName: 'Owner2', role: 'owner', tenantId: TENANT };
const ops: Actor = { userId: '22222222-2222-2222-2222-222222222201', identity: 'ops@a.com', displayName: 'Ops', role: 'operations', tenantId: TENANT };
const visitor: Actor = { userId: '33333333-3333-3333-3333-333333333301', identity: 'vis@a.com', displayName: 'Vis', role: 'visitor', tenantId: TENANT };

let p: FakePersistence;
beforeEach(() => {
  p = new FakePersistence();
});

async function submitByOps() {
  return submitAddPerson(p, ops, { input: addPersonInputSchema.parse({ fullName: 'Jordan Reyes' }) });
}

describe('fake batch semantics (Neural F1)', () => {
  it('a mid-batch write is INVISIBLE inside the batch — the fake mirrors the real RR snapshot', async () => {
    await submitByOps();
    await p.reads.forActor(ops).batch(async (r) => {
      const before = await r.listApprovals();
      // A WRITE lands mid-batch (a second governed submit)…
      await submitAddPerson(p, ops, { input: addPersonInputSchema.parse({ fullName: 'Mid Batch' }) });
      // …and stays invisible inside the batch's snapshot, exactly as the SQL
      // side's torn-read probe certifies for the real REPEATABLE READ tx.
      const after = await r.listApprovals();
      expect(after.length).toBe(before.length);
      return null;
    });
    // A fresh read outside the batch sees both submissions.
    expect((await p.reads.forActor(ops).listApprovals()).length).toBe(2);
  });
});

describe('submitAddPerson', () => {
  it('operations submits a Submitted approval with a canonical APR id and pending target', async () => {
    const a = await submitByOps();
    expect(a.approvalId).toBe('APR-0001');
    expect(a.status).toBe('Submitted');
    expect(a.targetPersonId).toBe('PENDING-ADDPERSON');
    expect(a.submittedBy).toBe('ops@a.com');
    expect((await listPeople(p, owner))).toHaveLength(0); // no person yet
  });

  it('read-only roles may not submit', async () => {
    await expect(submitAddPerson(p, visitor, { input: addPersonInputSchema.parse({ fullName: 'x' }) })).rejects.toThrow(ForbiddenError);
  });
});

describe('review family', () => {
  it('owner begins review then approves; person still does not exist', async () => {
    const a = await submitByOps();
    const r = await beginReview(p, owner, a.approvalId, a.version);
    expect(r.status).toBe('InReview');
    const approved = await approveApproval(p, owner, r.approvalId, r.version);
    expect(approved.status).toBe('Approved');
    expect(approved.reviewedBy).toBe('owner@a.com');
    expect(await listPeople(p, owner)).toHaveLength(0);
  });

  it('operations may not review', async () => {
    const a = await submitByOps();
    await expect(beginReview(p, ops, a.approvalId, a.version)).rejects.toThrow(ForbiddenError);
  });

  it('the submitter (even if owner) may not review their own request', async () => {
    const a = await submitAddPerson(p, owner, { input: addPersonInputSchema.parse({ fullName: 'Self' }) });
    await expect(beginReview(p, owner, a.approvalId, a.version)).rejects.toThrow(SelfReviewError);
  });

  it('approve requires InReview (illegal from Submitted)', async () => {
    const a = await submitByOps();
    await expect(approveApproval(p, owner, a.approvalId, a.version)).rejects.toThrow(InvalidTransitionError);
  });

  it('reject requires a reason and records it', async () => {
    const a = await submitByOps();
    const r = await beginReview(p, owner, a.approvalId, a.version);
    await expect(rejectApproval(p, owner, r.approvalId, r.version, '   ')).rejects.toThrow(ValidationError);
    const rejected = await rejectApproval(p, owner, r.approvalId, r.version, 'Duplicate person');
    expect(rejected.status).toBe('Rejected');
    expect(rejected.rejectionReason).toBe('Duplicate person');
  });

  it('a stale version is rejected with a concurrency error', async () => {
    const a = await submitByOps();
    await beginReview(p, owner, a.approvalId, a.version); // version -> 1
    await expect(approveApproval(p, owner, a.approvalId, 0)).rejects.toThrow(ConcurrencyError);
  });
});

describe('executeApproval', () => {
  async function approvedApproval() {
    const a = await submitByOps();
    const r = await beginReview(p, owner, a.approvalId, a.version);
    return approveApproval(p, owner, r.approvalId, r.version);
  }

  it('creates exactly one person and stamps Executed truth', async () => {
    const approved = await approvedApproval();
    const res = await executeApproval(p, owner, approved.approvalId, approved.version);
    expect(res.idempotent).toBe(false);
    expect(res.person?.personId).toBe('PER-0001');
    expect(res.approval.status).toBe('Executed');
    expect(res.approval.targetPersonId).toBe('PER-0001');
    expect(res.approval.executedAt).toBeTruthy();
    expect(await listPeople(p, owner)).toHaveLength(1);
  });

  it('is idempotent: a second execute returns the same person, no duplicate', async () => {
    const approved = await approvedApproval();
    const first = await executeApproval(p, owner, approved.approvalId, approved.version);
    const second = await executeApproval(p, owner, approved.approvalId, first.approval.version);
    expect(second.idempotent).toBe(true);
    expect(second.person?.personId).toBe('PER-0001');
    expect(await listPeople(p, owner)).toHaveLength(1);
  });

  it('the submitter may not execute their own request', async () => {
    const a = await submitAddPerson(p, owner, { input: addPersonInputSchema.parse({ fullName: 'Self' }) });
    const r = await beginReview(p, owner2, a.approvalId, a.version);
    const approved = await approveApproval(p, owner2, r.approvalId, r.version);
    await expect(executeApproval(p, owner, approved.approvalId, approved.version)).rejects.toThrow(SelfReviewError);
  });

  it('execution before approval is rejected (not-approved)', async () => {
    const a = await submitByOps();
    await expect(executeApproval(p, owner, a.approvalId, a.version)).rejects.toThrow(ApprovalNotApprovedError);
  });

  it('a genuine execution fault records ExecutionFailed truthfully and creates no person', async () => {
    const approved = await approvedApproval();
    p.failNextPersonInsert = true;
    await expect(executeApproval(p, owner, approved.approvalId, approved.version)).rejects.toThrow('simulated execution fault');
    const [after] = await listApprovals(p, owner);
    expect(after?.status).toBe('ExecutionFailed');
    expect(after?.executionError).toContain('simulated');
    expect(await listPeople(p, owner)).toHaveLength(0);
  });

  it('a retry after ExecutionFailed can still succeed and create exactly one person', async () => {
    const approved = await approvedApproval();
    p.failNextPersonInsert = true;
    await expect(executeApproval(p, owner, approved.approvalId, approved.version)).rejects.toThrow();
    const [failed] = await listApprovals(p, owner);
    const retry = await executeApproval(p, owner, failed!.approvalId, failed!.version);
    expect(retry.approval.status).toBe('Executed');
    expect(await listPeople(p, owner)).toHaveLength(1);
  });
});
