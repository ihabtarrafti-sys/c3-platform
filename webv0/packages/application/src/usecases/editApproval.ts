/**
 * editApproval — Track B1: request corrections.
 *
 * "Polish freely until review starts — every change on the record; after
 * that, frozen; corrections are new requests." (owner design, 2026-07-10)
 *
 * EDIT-BEFORE-REVIEW: the SUBMITTER replaces the payload INPUT of their own
 * Submitted request in place (same APR id). The new input is revalidated
 * through the op's own payload schema; the TARGET may not change (the
 * one-open-request-per-target guards ran at submission — a retargeting edit
 * would dodge them); the write is version- AND Submitted-guarded in the
 * predicate with the 0038 trigger as backstop; the record shows WHICH fields
 * changed (names only — values reach a reader only through the role-projected
 * DTO, per H-01) and the "Edited ×N" badge counts every polish.
 *
 * REVISE & RESUBMIT: for Submitted/InReview/Rejected/Withdrawn — validate the
 * new input FIRST, withdraw the old request when it is still open (the S42
 * submitter-only withdraw), then run the op's REAL submit (every duplicate
 * and business guard applies), then link both rows (revisionOf on the new,
 * write-once supersededBy on the old). Withdraw and submit are separate
 * transactions by construction (each submit owns its tx) — the validate-first
 * ordering shrinks the failure window to a business-guard refusal, in which
 * case the old request is withdrawn and the caller retries from the
 * still-prefilled form (documented, not papered over). Approved is refused
 * (it belongs to the reviewers), ExecutionFailed is the owner's re-execute
 * lane, Executed is done.
 */
import {
  type Actor,
  type Approval,
  type ApprovalPayload,
  CORRECTIONS_EXCLUDED_OPS,
  ConcurrencyError,
  ConflictError,
  EDIT_TARGET_KEYS,
  type EditApprovalInput,
  ForbiddenError,
  NotFoundError,
  REVISABLE_STATUSES,
  type ReviseApprovalInput,
  approvalPayloadSchema,
  changedInputFields,
  editApprovalInputSchema,
  reviseApprovalInputSchema,
} from '@c3web/domain';
import { assertTenantMatch } from '@c3web/authz';
import type { Persistence } from '../ports';
import { withdrawApproval } from './reviewApproval';
import { submitAddPerson } from './submitAddPerson';
import { submitMemberChange } from './submitMemberChange';
import { submitAddCredential, submitDeactivateCredential, submitReactivateCredential } from './submitCredentialOps';
import { submitInitiateJourney } from './journeyOps';
import { submitAddMissionParticipant, submitRemoveMissionParticipant } from './submitMissionParticipantOps';
import { submitAddAgreement, submitRenewAgreement, submitTerminateAgreement } from './submitAgreementOps';
import { submitAddAgreementTerm, submitRemoveAgreementTerm, submitUpdateAgreementTerm } from './submitAgreementTermOps';
import { submitDeactivatePerson, submitReactivatePerson, submitUpdatePersonIdentity } from './submitPersonOps';
import { submitAddBeneficiary, submitRetireBeneficiary, submitUpdateBeneficiary, submitUpdateCredentialFacts } from './submitCredentialV2Ops';

function assertCorrectionsAllowed(operationType: Approval['operationType']): void {
  if ((CORRECTIONS_EXCLUDED_OPS as readonly string[]).includes(operationType)) {
    throw new ConflictError('A staged import is corrected by re-staging the file — corrections lanes do not apply.', {
      operationType,
    });
  }
}

function assertOwnRequest(actor: Actor, approval: Approval): void {
  const submitter = approval.submittedBy?.trim().toLowerCase();
  const requester = actor.identity?.trim().toLowerCase();
  if (!submitter || !requester || submitter !== requester) {
    throw new ForbiddenError('Only the submitter may correct their own request.', {
      approvalId: approval.approvalId,
      submittedBy: approval.submittedBy,
    });
  }
}

/** Revalidate a candidate input under the request's op; refuse target changes. */
function validatedPayloadForEdit(current: Approval, candidateInput: unknown): { payload: ApprovalPayload; changed: string[] } {
  const payload = approvalPayloadSchema.parse({ operationType: current.operationType, input: candidateInput });
  const targetKeys = EDIT_TARGET_KEYS[current.operationType as keyof typeof EDIT_TARGET_KEYS] ?? [];
  const before = current.payload.input as Record<string, unknown>;
  const after = payload.input as Record<string, unknown>;
  for (const key of targetKeys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      throw new ConflictError('An edit may not change the request\'s TARGET — withdraw it or use Revise & resubmit.', {
        approvalId: current.approvalId,
        field: key,
      });
    }
  }
  const changed = changedInputFields(before, after);
  if (changed.length === 0) {
    throw new ConflictError('Nothing changed — the request already says exactly this.', { approvalId: current.approvalId });
  }
  return { payload, changed };
}

export async function editApprovalPayload(p: Persistence, actor: Actor, inputRaw: EditApprovalInput): Promise<Approval> {
  const { approvalId, expectedVersion, input } = editApprovalInputSchema.parse(inputRaw);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.lockApproval(approvalId);
    if (!current) throw new NotFoundError('Approval', approvalId);
    assertTenantMatch(actor.tenantId, current.tenantId);
    assertOwnRequest(actor, current);
    assertCorrectionsAllowed(current.operationType);
    if (current.status !== 'Submitted') {
      throw new ConflictError('Editing is only possible before review starts — use Revise & resubmit.', {
        approvalId,
        status: current.status,
      });
    }
    if (current.version !== expectedVersion) throw new ConcurrencyError('Approval', approvalId);

    const { payload, changed } = validatedPayloadForEdit(current, input);

    const updated = await tx.updateApprovalPayload(approvalId, expectedVersion, payload);
    if (!updated) throw new ConcurrencyError('Approval', approvalId);

    // The record: WHICH fields changed, never their values (H-01 boundary).
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: 'Submitted',
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `Request edited (×${updated.editCount}) — ${changed.join(', ')}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalEdited',
      actor: actor.identity,
      before: { editCount: current.editCount },
      after: { editCount: updated.editCount, changedFields: changed },
    });
    return updated;
  });
}

/** Dispatch to the op's REAL submit — every duplicate/business guard applies. */
async function dispatchSubmit(p: Persistence, actor: Actor, payload: ApprovalPayload, reason: string | null): Promise<Approval> {
  const command = { input: payload.input as never, reason };
  switch (payload.operationType) {
    case 'AddPerson':
      return submitAddPerson(p, actor, { input: payload.input, reason });
    case 'ProvisionMember':
    case 'ChangeRole':
    case 'DeactivateMember':
    case 'ReactivateMember':
      return submitMemberChange(p, actor, { payload, reason });
    case 'AddCredential':
      return submitAddCredential(p, actor, command);
    case 'DeactivateCredential':
      return submitDeactivateCredential(p, actor, command);
    case 'ReactivateCredential':
      return submitReactivateCredential(p, actor, command);
    case 'InitiateJourney':
      return submitInitiateJourney(p, actor, command);
    case 'AddMissionParticipant':
      return submitAddMissionParticipant(p, actor, command);
    case 'RemoveMissionParticipant':
      return submitRemoveMissionParticipant(p, actor, command);
    case 'AddAgreement':
      return submitAddAgreement(p, actor, command);
    case 'RenewAgreement':
      return submitRenewAgreement(p, actor, command);
    case 'TerminateAgreement':
      return submitTerminateAgreement(p, actor, command);
    case 'AddAgreementTerm':
      return submitAddAgreementTerm(p, actor, command);
    case 'UpdateAgreementTerm':
      return submitUpdateAgreementTerm(p, actor, command);
    case 'RemoveAgreementTerm':
      return submitRemoveAgreementTerm(p, actor, command);
    case 'UpdatePersonIdentity':
      return submitUpdatePersonIdentity(p, actor, command);
    case 'DeactivatePerson':
      return submitDeactivatePerson(p, actor, command);
    case 'ReactivatePerson':
      return submitReactivatePerson(p, actor, command);
    case 'UpdateCredentialFacts':
      return submitUpdateCredentialFacts(p, actor, command);
    case 'AddBeneficiary':
      return submitAddBeneficiary(p, actor, command);
    case 'UpdateBeneficiary':
      return submitUpdateBeneficiary(p, actor, command);
    case 'RetireBeneficiary':
      return submitRetireBeneficiary(p, actor, command);
    case 'ImportBatch':
      // unreachable — assertCorrectionsAllowed refused earlier; fail closed anyway.
      throw new ConflictError('ImportBatch requests are corrected by re-staging the file.');
  }
}

export interface ReviseResult {
  readonly revised: Approval;
  readonly superseded: Approval['approvalId'];
}

export async function reviseApproval(p: Persistence, actor: Actor, inputRaw: ReviseApprovalInput): Promise<ReviseResult> {
  const { approvalId, expectedVersion, input, reason } = reviseApprovalInputSchema.parse(inputRaw);

  // Read + gate OUTSIDE any write tx (the real submit owns its own).
  const reads = p.reads.forActor(actor);
  const current = await reads.getApprovalById(approvalId);
  if (!current) throw new NotFoundError('Approval', approvalId);
  assertTenantMatch(actor.tenantId, current.tenantId);
  assertOwnRequest(actor, current);
  assertCorrectionsAllowed(current.operationType);
  if (!REVISABLE_STATUSES.includes(current.status)) {
    const why =
      current.status === 'Approved'
        ? 'an Approved request belongs to the reviewers (execute or reject are their tools)'
        : current.status === 'ExecutionFailed'
          ? 'an ExecutionFailed request is recovered by the owner re-executing it'
          : 'this request is already done';
    throw new ConflictError(`Cannot revise a ${current.status} request — ${why}.`, { approvalId, status: current.status });
  }

  // Validate FIRST: a schema-invalid revision must never cost the old request.
  const payload = approvalPayloadSchema.parse({ operationType: current.operationType, input });

  // Withdraw while still open (Submitted/InReview); terminal rows are already closed.
  if (current.status === 'Submitted' || current.status === 'InReview') {
    await withdrawApproval(p, actor, approvalId, expectedVersion);
  } else if (current.version !== expectedVersion) {
    throw new ConcurrencyError('Approval', approvalId);
  }

  // The op's REAL submit — duplicate-pending and business guards all apply.
  const revised = await dispatchSubmit(p, actor, payload, reason ?? current.reason);

  // Link both rows (write-once both directions; a failure here leaves two
  // truthful, unlinked requests — cosmetic, and the audit records the tie).
  await p.writes.transaction(actor, async (tx) => {
    await tx.setSupersededBy(approvalId, revised.approvalId);
    await tx.setRevisionOf(revised.approvalId, approvalId);
    await tx.appendApprovalEvent({
      approvalId: revised.approvalId,
      fromStatus: 'Submitted',
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `Revision of ${approvalId} (supersedes it)`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSuperseded',
      actor: actor.identity,
      before: { status: current.status },
      after: { supersededBy: revised.approvalId },
    });
  });

  return { revised: { ...revised, revisionOf: approvalId }, superseded: approvalId };
}
