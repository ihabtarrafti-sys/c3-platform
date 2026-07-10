/**
 * reviewApproval — the owner-only review family (begin review / approve /
 * reject). Each action independently enforces role + separation-of-duties
 * (fail-closed self-review), legal lifecycle transition, and optimistic
 * concurrency, then appends the governance event + audit trail. No execution
 * happens here (that is a separate phase).
 */
import {
  type Actor,
  type Approval,
  type ApprovalStatus,
  canApply,
  ConcurrencyError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  type AuditAction,
  checkSelfReview,
  SelfReviewError,
} from '@c3web/domain';
import { assertReviewApproval, assertTenantMatch, canReviewApproval, type ReviewAction } from '@c3web/authz';
import type { Persistence, WriteTx } from '../ports';

const AUDIT_FOR: Record<ReviewAction, AuditAction> = {
  beginReview: 'ApprovalReviewStarted',
  approve: 'ApprovalApproved',
  reject: 'ApprovalRejected',
};

const LIFECYCLE_FOR: Record<ReviewAction, 'beginReview' | 'approve' | 'reject'> = {
  beginReview: 'beginReview',
  approve: 'approve',
  reject: 'reject',
};

async function transition(
  p: Persistence,
  actor: Actor,
  action: ReviewAction,
  approvalId: string,
  expectedVersion: number,
  extra: { rejectionReason?: string } = {},
): Promise<Approval> {
  return p.writes.transaction(actor, async (tx: WriteTx) => {
    const approval = await tx.lockApproval(approvalId);
    if (!approval) throw new NotFoundError('Approval', approvalId);

    // Role + separation of duties (fail closed on indeterminate identity).
    // Tier 0.5: an ACTIVE delegation substitutes for the ROLE half only —
    // the self-review separation is NOT delegable and runs on every path.
    if (canReviewApproval(actor.role)) {
      assertReviewApproval(actor, approval.submittedBy, action);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const delegated = await tx.hasActiveDelegation(actor.identity.toLowerCase(), today);
      if (!delegated) {
        throw new ForbiddenError('Your role may not review approvals.', { role: actor.role, action });
      }
      const check = checkSelfReview(actor.identity, approval.submittedBy);
      if (check.blocked) throw new SelfReviewError(check.reason);
    }
    assertTenantMatch(actor.tenantId, approval.tenantId);

    const lifecycleAction = LIFECYCLE_FOR[action];
    if (!canApply(lifecycleAction, approval.status)) {
      throw new InvalidTransitionError(approval.status, lifecycleAction);
    }
    if (approval.version !== expectedVersion) throw new ConcurrencyError('Approval', approvalId);

    const nowIso = new Date().toISOString();
    const targetStatus: ApprovalStatus =
      action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'InReview';

    const updated = await tx.updateApprovalStatus(approvalId, expectedVersion, {
      status: targetStatus,
      reviewedBy: actor.identity,
      reviewedAt: nowIso,
      ...(action === 'reject' ? { rejectionReason: extra.rejectionReason ?? null } : {}),
    });
    if (!updated) throw new ConcurrencyError('Approval', approvalId);

    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: approval.status,
      toStatus: targetStatus,
      actor: actor.identity,
      note: action === 'reject' ? `Rejected: ${extra.rejectionReason}` : null,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: AUDIT_FOR[action],
      actor: actor.identity,
      before: { status: approval.status },
      after: { status: targetStatus },
    });
    return updated;
  });
}

export function beginReview(p: Persistence, actor: Actor, approvalId: string, expectedVersion: number): Promise<Approval> {
  return transition(p, actor, 'beginReview', approvalId, expectedVersion);
}

export function approveApproval(p: Persistence, actor: Actor, approvalId: string, expectedVersion: number): Promise<Approval> {
  return transition(p, actor, 'approve', approvalId, expectedVersion);
}

export async function rejectApproval(
  p: Persistence,
  actor: Actor,
  approvalId: string,
  expectedVersion: number,
  rejectionReason: string,
): Promise<Approval> {
  const reason = rejectionReason?.trim();
  if (!reason) throw new ValidationError('A rejection reason is mandatory.', { field: 'rejectionReason' });
  return transition(p, actor, 'reject', approvalId, expectedVersion, { rejectionReason: reason });
}

/**
 * withdrawApproval (Sprint 42, the S41 single-owner-wedge remedy) — the
 * SUBMITTER cancels their own request before a decision. The exact inverse
 * of the self-review guard: only the submitter's identity qualifies, fail
 * closed on any indeterminacy. Legal only from Submitted/InReview (an
 * Approved request belongs to the reviewers — reject is their tool). No
 * side effects: the operation never ran; the flip + events are the whole
 * transaction. Duplicate-pending guards treat Withdrawn as closed, which is
 * exactly how a wedged record unblocks.
 */
export async function withdrawApproval(
  p: Persistence,
  actor: Actor,
  approvalId: string,
  expectedVersion: number,
): Promise<Approval> {
  return p.writes.transaction(actor, async (tx: WriteTx) => {
    const approval = await tx.lockApproval(approvalId);
    if (!approval) throw new NotFoundError('Approval', approvalId);
    assertTenantMatch(actor.tenantId, approval.tenantId);

    const submitter = approval.submittedBy?.trim().toLowerCase();
    const requester = actor.identity?.trim().toLowerCase();
    if (!submitter || !requester || submitter !== requester) {
      throw new ForbiddenError('Only the submitter may withdraw their own request.', {
        approvalId,
        submittedBy: approval.submittedBy,
      });
    }

    if (!canApply('withdraw', approval.status)) {
      throw new InvalidTransitionError(approval.status, 'withdraw');
    }
    if (approval.version !== expectedVersion) throw new ConcurrencyError('Approval', approvalId);

    const updated = await tx.updateApprovalStatus(approvalId, expectedVersion, { status: 'Withdrawn' });
    if (!updated) throw new ConcurrencyError('Approval', approvalId);

    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: approval.status,
      toStatus: 'Withdrawn',
      actor: actor.identity,
      note: 'Withdrawn by the submitter',
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalWithdrawn',
      actor: actor.identity,
      before: { status: approval.status },
      after: { status: 'Withdrawn' },
    });
    return updated;
  });
}
