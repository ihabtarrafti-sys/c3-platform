/**
 * submitAgreementOps — governed submission of the three MATERIAL agreement
 * operations (Sprint 41): AddAgreement / RenewAgreement / TerminateAgreement.
 *
 * SUBMIT-TIME GUARDS (friendly, fail-early — the authoritative re-check runs
 * inside the execution transaction):
 *   - AddAgreement: person exists; the linked (parent) agreement exists when
 *     given; a stated agreementCode must not already be taken (the partial
 *     unique index is the last line at execute).
 *   - Renew/Terminate: the agreement exists and is Active; a renewal's new
 *     end date must beat the stored one.
 *   - duplicate-PENDING per agreement: an OPEN approval (Submitted / InReview
 *     / Approved) targeting the same agreement blocks a second material
 *     request — no interleaving ambiguity (the missions guard pattern, keyed
 *     on targetId). ExecutionFailed does NOT block: resubmission is the
 *     certified recovery path.
 *
 * Approval columns: targetPersonId = the owning person; targetId = the AGR id
 * (null for AddAgreement until execution allocates it).
 */
import {
  type Actor,
  type AddAgreementInput,
  type Approval,
  type RenewAgreementInput,
  type TerminateAgreementInput,
  addAgreementInputSchema,
  renewAgreementInputSchema,
  terminateAgreementInputSchema,
  ConflictError,
  ENTITY_AGREEMENT_TARGET,
  formatApprovalId,
  NotFoundError,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

const OPEN_STATUSES = ['Submitted', 'InReview', 'Approved'] as const;
const AGREEMENT_OPS = ['RenewAgreement', 'TerminateAgreement'] as const;

/** Any open material approval for this agreement blocks a new one. */
async function assertNoOpenApprovalForAgreement(p: Persistence, actor: Actor, agreementId: string): Promise<void> {
  const open = await p.reads.forActor(actor).listApprovals({ statuses: [...OPEN_STATUSES] });
  const clash = open.some(
    (a) => (AGREEMENT_OPS as readonly string[]).includes(a.operationType) && a.targetId === agreementId,
  );
  if (clash) {
    throw new ConflictError('An open approval already exists for this agreement. Resolve it before submitting another.', {
      agreementId,
    });
  }
}

export async function submitAddAgreement(
  p: Persistence,
  actor: Actor,
  command: { input: AddAgreementInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = addAgreementInputSchema.parse(command.input);
  const reads = p.reads.forActor(actor);

  // The anchor rule is schema-enforced; here each GIVEN anchor must exist.
  if (input.personId) {
    const person = await reads.getPersonById(input.personId);
    if (!person) throw new NotFoundError('Person', input.personId);
  }

  if (input.entityId) {
    const entity = await reads.getEntityById(input.entityId);
    if (!entity) throw new NotFoundError('Entity', input.entityId);
  }

  if (input.linkedAgreementId) {
    const parent = await reads.getAgreementById(input.linkedAgreementId);
    if (!parent) throw new NotFoundError('Linked agreement', input.linkedAgreementId);
  }

  if (input.agreementCode) {
    const taken = (await reads.listAgreements()).some((a) => a.agreementCode === input.agreementCode);
    if (taken) {
      throw new ConflictError('That agreement code is already in use.', { agreementCode: input.agreementCode });
    }
  }

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'AddAgreement',
      // Entity-level agreements have no owning person: the sentinel keeps the
      // column truthful and person-scoped approval reads never match it.
      targetPersonId: input.personId ?? ENTITY_AGREEMENT_TARGET,
      targetId: null, // the AGR id does not exist until execution
      reason,
      payload: { operationType: 'AddAgreement', input },
      submittedBy: actor.identity,
      revisionOf: command.revisionOf ?? null,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `AddAgreement request submitted: ${input.agreementType} for ${input.personId ?? input.entityId}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'AddAgreement', personId: input.personId, agreementType: input.agreementType },
    });
    return approval;
  });
}

/** Shared submit body for the two targeted material ops. */
async function submitTargetedAgreementOp(
  p: Persistence,
  actor: Actor,
  agreementId: string,
  reasonRaw: string | null | undefined,
  op: 'RenewAgreement' | 'TerminateAgreement',
  payloadInput: unknown,
  note: string,
  auditAfter: Record<string, unknown>,
  revisionOf: string | null | undefined,
): Promise<Approval> {
  const agreement = await p.reads.forActor(actor).getAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Agreement', agreementId);
  if (agreement.status !== 'Active') {
    throw new ConflictError('The agreement is not active.', { agreementId, status: agreement.status });
  }
  await assertNoOpenApprovalForAgreement(p, actor, agreementId);

  const reason = reasonRaw?.trim() ? reasonRaw.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: op,
      targetPersonId: agreement.personId ?? ENTITY_AGREEMENT_TARGET,
      targetId: agreementId,
      reason,
      payload: { operationType: op, input: payloadInput },
      submittedBy: actor.identity,
      revisionOf: revisionOf ?? null,
    });
    await tx.appendApprovalEvent({ approvalId, fromStatus: null, toStatus: 'Submitted', actor: actor.identity, note });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: op, agreementId, ...auditAfter },
    });
    return approval;
  });
}

export async function submitRenewAgreement(
  p: Persistence,
  actor: Actor,
  command: { input: RenewAgreementInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = renewAgreementInputSchema.parse(command.input);

  // Friendly: the new end must beat the CURRENT stored end (re-checked
  // authoritatively at execute — the term may have moved in between).
  const current = await p.reads.forActor(actor).getAgreementById(input.agreementId);
  if (current && current.status === 'Active' && input.newEndsOn <= current.endsOn) {
    throw new ConflictError('The new end date does not extend the current term.', {
      agreementId: input.agreementId,
      currentEndsOn: current.endsOn,
      newEndsOn: input.newEndsOn,
    });
  }

  return submitTargetedAgreementOp(
    p,
    actor,
    input.agreementId,
    command.reason,
    'RenewAgreement',
    input,
    `RenewAgreement request submitted: ${input.agreementId} to ${input.newEndsOn}`,
    { newEndsOn: input.newEndsOn },
    command.revisionOf,
  );
}

export async function submitTerminateAgreement(
  p: Persistence,
  actor: Actor,
  command: { input: TerminateAgreementInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = terminateAgreementInputSchema.parse(command.input);
  return submitTargetedAgreementOp(
    p,
    actor,
    input.agreementId,
    command.reason,
    'TerminateAgreement',
    input,
    `TerminateAgreement request submitted: ${input.agreementId}`,
    { terminationReason: input.reason },
    command.revisionOf,
  );
}
