/**
 * submitMemberChange — governed submission of a member operation (Sprint 35,
 * A-8 Phase 2). Owner/Operations may submit. Creates the immutable approval in
 * one transaction with the Submitted event + audit trail; NOTHING about the
 * member changes until an owner (≠ requester) approves and executes.
 *
 * Submit-time guards (execute re-enforces authoritatively in the SQL gateway):
 *   - role capability (canSubmitMemberChange);
 *   - self-administration: the requester may not target their own account.
 */
import {
  type Actor,
  type Approval,
  type ApprovalPayload,
  approvalPayloadSchema,
  formatApprovalId,
  MEMBER_OP_TARGET,
  SelfAdministrationError,
  ValidationError,
} from '@c3web/domain';
import { assertSubmitMemberChange } from '@c3web/authz';
import type { Persistence } from '../ports';

export type MemberChangePayload = Exclude<ApprovalPayload, { operationType: 'AddPerson' }>;

export interface SubmitMemberChangeCommand {
  readonly payload: MemberChangePayload;
  readonly reason?: string | null;
}

export async function submitMemberChange(
  p: Persistence,
  actor: Actor,
  command: SubmitMemberChangeCommand,
): Promise<Approval> {
  assertSubmitMemberChange(actor);

  // Validate/normalise defensively even though the API validates the wire.
  const payload = approvalPayloadSchema.parse(command.payload);
  if (payload.operationType === 'AddPerson') {
    throw new ValidationError('AddPerson is submitted through its own flow.');
  }

  // Self-administration fails closed at the door (identity = canonical email).
  if (payload.input.email === actor.identity.toLowerCase()) {
    throw new SelfAdministrationError(payload.operationType);
  }

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  const targetId = 'targetUserId' in payload.input ? payload.input.targetUserId : null;

  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: payload.operationType,
      targetPersonId: MEMBER_OP_TARGET,
      targetId,
      reason,
      payload,
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `${payload.operationType} request submitted`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: payload.operationType, member: payload.input.email },
    });
    return approval;
  });
}
