/**
 * submitAgreementTermOps — governed submission of the three agreement
 * financial-term operations (Finance Sprint 3.5). Term money is MATERIAL: every
 * change (add / edit / remove, all kinds) rides the approval pipeline —
 * requester ≠ approver, the owner executes.
 *
 * SUBMIT-TIME GUARDS (friendly; the authoritative re-check runs inside the
 * execution transaction):
 *   - the owning agreement exists and is Active (terms are frozen on a
 *     terminated agreement);
 *   - Update/Remove: the term exists, is active, and belongs to the agreement;
 *   - Add/Update: the value set satisfies assertTermShape for its kind;
 *   - duplicate-PENDING per TERM: an open Update/Remove approval for the same
 *     TRM id blocks a second change to it (no interleaving; the version race
 *     the direct path guarded is closed by serialising through one approval).
 *
 * Approval columns: targetPersonId = the agreement's owning person; targetId =
 * the AGR id (Add) or the TRM id (Update/Remove).
 */
import {
  type Actor,
  type Approval,
  type SubmitAddAgreementTermInput,
  type SubmitUpdateAgreementTermInput,
  type SubmitRemoveAgreementTermInput,
  type TermValues,
  submitAddAgreementTermInputSchema,
  submitUpdateAgreementTermInputSchema,
  submitRemoveAgreementTermInputSchema,
  assertTermShape,
  ConflictError,
  ENTITY_AGREEMENT_TARGET,
  formatApprovalId,
  NotFoundError,
} from '@c3web/domain';
import { assertSubmitApproval, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

const OPEN_STATUSES = ['Submitted', 'InReview', 'Approved'] as const;
const TERM_CHANGE_OPS = ['UpdateAgreementTerm', 'RemoveAgreementTerm'] as const;

/** An open change approval for this specific term blocks a new one. */
async function assertNoOpenApprovalForTerm(p: Persistence, actor: Actor, termId: string): Promise<void> {
  const open = await p.reads.forActor(actor).listApprovals({ statuses: [...OPEN_STATUSES] });
  const clash = open.some(
    (a) =>
      (TERM_CHANGE_OPS as readonly string[]).includes(a.operationType) &&
      'termId' in a.payload.input &&
      (a.payload.input as { termId: string }).termId === termId,
  );
  if (clash) {
    throw new ConflictError('An open approval already exists for this financial term. Resolve it before submitting another.', { termId });
  }
}

async function requireActiveAgreement(p: Persistence, actor: Actor, agreementId: string) {
  const agreement = await p.reads.forActor(actor).getAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Agreement', agreementId);
  if (agreement.status !== 'Active') {
    throw new ConflictError('Financial terms may only be changed on an active agreement.', { agreementId, status: agreement.status });
  }
  return agreement;
}

/** Shared body: insert the approval + submission event + audit, in one tx. */
async function insertTermApproval(
  p: Persistence,
  actor: Actor,
  op: 'AddAgreementTerm' | 'UpdateAgreementTerm' | 'RemoveAgreementTerm',
  targetPersonId: string,
  targetId: string,
  payloadInput: unknown,
  reasonRaw: string | null | undefined,
  note: string,
  auditAfter: Record<string, unknown>,
  revisionOf: string | null | undefined,
): Promise<Approval> {
  const reason = reasonRaw?.trim() ? reasonRaw.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: op,
      targetPersonId,
      targetId,
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
      after: { status: 'Submitted', operationType: op, ...auditAfter },
    });
    return approval;
  });
}

export async function submitAddAgreementTerm(
  p: Persistence,
  actor: Actor,
  command: { input: SubmitAddAgreementTermInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  assertViewFinancials(actor);
  const input = submitAddAgreementTermInputSchema.parse(command.input);
  const values: TermValues = { amountMinor: input.amountMinor, currency: input.currency, percentBps: input.percentBps, label: input.label };
  assertTermShape(input.kind, values); // friendly; re-checked at execute

  const agreement = await requireActiveAgreement(p, actor, input.agreementId);
  return insertTermApproval(
    p,
    actor,
    'AddAgreementTerm',
    agreement.personId ?? ENTITY_AGREEMENT_TARGET,
    input.agreementId,
    input,
    command.reason,
    `AddAgreementTerm request submitted: ${input.kind} on ${input.agreementId}`,
    { agreementId: input.agreementId, kind: input.kind },
    command.revisionOf,
  );
}

export async function submitUpdateAgreementTerm(
  p: Persistence,
  actor: Actor,
  command: { input: SubmitUpdateAgreementTermInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  assertViewFinancials(actor);
  const input = submitUpdateAgreementTermInputSchema.parse(command.input);
  const agreement = await requireActiveAgreement(p, actor, input.agreementId);

  const terms = await p.reads.forActor(actor).listAgreementTerms(input.agreementId);
  const term = terms.find((t) => t.termId === input.termId);
  if (!term) throw new NotFoundError('Agreement term', input.termId);

  const next: TermValues = { amountMinor: input.amountMinor, currency: input.currency, percentBps: input.percentBps, label: input.label };
  assertTermShape(term.kind, next); // shape validated against the STORED kind
  await assertNoOpenApprovalForTerm(p, actor, input.termId);

  return insertTermApproval(
    p,
    actor,
    'UpdateAgreementTerm',
    agreement.personId ?? ENTITY_AGREEMENT_TARGET,
    input.termId,
    input,
    command.reason,
    `UpdateAgreementTerm request submitted: ${input.termId} on ${input.agreementId}`,
    { agreementId: input.agreementId, termId: input.termId },
    command.revisionOf,
  );
}

export async function submitRemoveAgreementTerm(
  p: Persistence,
  actor: Actor,
  command: { input: SubmitRemoveAgreementTermInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  assertViewFinancials(actor);
  const input = submitRemoveAgreementTermInputSchema.parse(command.input);
  const agreement = await requireActiveAgreement(p, actor, input.agreementId);

  const terms = await p.reads.forActor(actor).listAgreementTerms(input.agreementId);
  const term = terms.find((t) => t.termId === input.termId);
  if (!term) throw new NotFoundError('Agreement term', input.termId);
  await assertNoOpenApprovalForTerm(p, actor, input.termId);

  return insertTermApproval(
    p,
    actor,
    'RemoveAgreementTerm',
    agreement.personId ?? ENTITY_AGREEMENT_TARGET,
    input.termId,
    input,
    command.reason,
    `RemoveAgreementTerm request submitted: ${input.termId} on ${input.agreementId}`,
    { agreementId: input.agreementId, termId: input.termId },
    command.revisionOf,
  );
}
