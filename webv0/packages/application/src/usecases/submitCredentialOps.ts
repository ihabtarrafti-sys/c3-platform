/**
 * submitCredentialOps — governed submission of the Credentials operations
 * (Sprint 36). Owner/Operations may submit (the same capability family as
 * AddPerson). Submission creates an immutable approval; NOTHING about the
 * credential changes until an owner (≠ requester) approves and executes.
 *
 * Submit-time guards are friendly and light; execution re-enforces
 * authoritatively (composite FK for the person; active-state check for
 * deactivation) inside the transaction.
 */
import {
  type Actor,
  type AddCredentialInput,
  type Approval,
  type DeactivateCredentialInput,
  type ReactivateCredentialInput,
  addCredentialInputSchema,
  deactivateCredentialInputSchema,
  reactivateCredentialInputSchema,
  ConflictError,
  formatApprovalId,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';
import { assertNoOpenOpOnTarget, CREDENTIAL_TARGET_OPS } from './submitCredentialV2Ops';

export async function submitAddCredential(
  p: Persistence,
  actor: Actor,
  command: { input: AddCredentialInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = addCredentialInputSchema.parse(command.input);

  // Friendly early check: the owning person must exist in this tenant.
  const person = await p.reads.forActor(actor).getPersonById(input.personId);
  if (!person) throw new NotFoundError('Person', input.personId);

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'AddCredential',
      targetPersonId: input.personId, // the owning person IS the target
      targetId: null, // the CRED id does not exist until execution
      reason,
      payload: { operationType: 'AddCredential', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `AddCredential request submitted for ${input.personId}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'AddCredential', personId: input.personId, credentialType: input.credentialType },
    });
    return approval;
  });
}

export async function submitDeactivateCredential(
  p: Persistence,
  actor: Actor,
  command: { input: DeactivateCredentialInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = deactivateCredentialInputSchema.parse(command.input);

  // Friendly early checks: credential exists, belongs to the stated person,
  // and is currently active. Execution re-checks authoritatively.
  const credential = await p.reads.forActor(actor).getCredentialById(input.credentialId);
  if (!credential) throw new NotFoundError('Credential', input.credentialId);
  if (credential.personId !== input.personId) {
    throw new ValidationError('The credential does not belong to the stated person.', {
      credentialId: input.credentialId,
      statedPersonId: input.personId,
    });
  }
  if (!credential.isActive) throw new ConflictError('The credential is already inactive.');
  // M-07: reciprocal exclusion — no open facts/deactivate/reactivate on this credential.
  await assertNoOpenOpOnTarget(p, actor, CREDENTIAL_TARGET_OPS, input.credentialId);

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'DeactivateCredential',
      targetPersonId: input.personId,
      targetId: input.credentialId,
      reason,
      payload: { operationType: 'DeactivateCredential', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `DeactivateCredential request submitted for ${input.credentialId}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'DeactivateCredential', credentialId: input.credentialId },
    });
    return approval;
  });
}

/**
 * ReactivateCredential (HARDEN-3 recycle door) — GOVERNED, symmetric with
 * Deactivate: restoring a soft-removed credential submits an approval; the owning
 * person is derived from the credential (the target). Execution re-checks the
 * inactive state authoritatively.
 */
export async function submitReactivateCredential(
  p: Persistence,
  actor: Actor,
  command: { input: ReactivateCredentialInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = reactivateCredentialInputSchema.parse(command.input);

  const credential = await p.reads.forActor(actor).getCredentialById(input.credentialId);
  if (!credential) throw new NotFoundError('Credential', input.credentialId);
  if (credential.isActive) throw new ConflictError('The credential is already active.');
  // M-07: reciprocal exclusion — no open facts/deactivate/reactivate on this credential.
  await assertNoOpenOpOnTarget(p, actor, CREDENTIAL_TARGET_OPS, input.credentialId);

  const reason = command.reason?.trim() ? command.reason.trim() : input.reason;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'ReactivateCredential',
      targetPersonId: credential.personId,
      targetId: input.credentialId,
      reason,
      payload: { operationType: 'ReactivateCredential', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `ReactivateCredential request submitted for ${input.credentialId}: ${input.reason}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'ReactivateCredential', credentialId: input.credentialId },
    });
    return approval;
  });
}
