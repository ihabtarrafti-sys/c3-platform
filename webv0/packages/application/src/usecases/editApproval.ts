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
  type ApprovalRevision,
  CORRECTIONS_EXCLUDED_OPS,
  ConcurrencyError,
  ConflictError,
  DomainError,
  EDIT_TARGET_KEYS,
  type EditApprovalInput,
  ForbiddenError,
  NotFoundError,
  REVISABLE_STATUSES,
  REVISION_MAX_ATTEMPTS,
  type ReviseApprovalInput,
  approvalPayloadSchema,
  changedInputFields,
  editApprovalInputSchema,
  reviseApprovalInputSchema,
} from '@c3web/domain';
import { assertSubmitApproval, assertTenantMatch } from '@c3web/authz';
import type { Persistence } from '../ports';
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

/**
 * Dispatch to the op's REAL submit — every duplicate/business guard applies.
 * M-06: `revisionOf` (the source approval id) is threaded into every op's command
 * so the created successor is stamped with it at insert time — the drain's
 * idempotency key (find the successor by `revisionOf = source`, never submit twice).
 */
async function dispatchSubmit(
  p: Persistence,
  actor: Actor,
  payload: ApprovalPayload,
  reason: string | null,
  revisionOf: string | null,
): Promise<Approval> {
  const command = { input: payload.input as never, reason, revisionOf };
  switch (payload.operationType) {
    case 'AddPerson':
      return submitAddPerson(p, actor, { input: payload.input, reason, revisionOf });
    case 'ProvisionMember':
    case 'ChangeRole':
    case 'DeactivateMember':
    case 'ReactivateMember':
      return submitMemberChange(p, actor, { payload, reason, revisionOf });
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

/**
 * M-06: is a tx-2 submit failure DETERMINISTIC (will refuse identically on every
 * retry) or TRANSIENT (retriable)? A business-guard refusal is a DomainError and is
 * deterministic — EXCEPT ConcurrencyError, which is a lock/version race and retries.
 * Anything that is not a DomainError (a crash, an infra/pg fault) is transient too.
 */
function isTransientSubmitFailure(err: unknown): boolean {
  if (err instanceof ConcurrencyError) return true;
  if (err instanceof DomainError) return false;
  return true;
}

/**
 * R3-N03: did the submit fail because a peer drainer already created the live successor
 * (the 0061 partial-unique on (tenant_id, revision_of) refused the second)? A Postgres
 * unique-violation is 23505. We re-probe on any 23505 and converge only if a successor is
 * actually present, so a 23505 from an unrelated unique is handled safely by fall-through.
 */
function isLiveSuccessorConflict(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === '23505';
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 1000) : String(err).slice(0, 1000);
}

type RevisionOutcome = { readonly kind: 'completed'; readonly revised: Approval } | { readonly kind: 'abandoned'; readonly error: Error };

/**
 * M-06 tx-2 + tx-3: complete a claimed revision intent, IDEMPOTENTLY. Shared by the
 * opportunistic in-request path and the crash-recovery drain.
 *   probe — a prior (crashed) attempt may already have submitted the successor; find
 *           it by `revisionOf = source` so we never submit twice;
 *   tx-2  — otherwise run the op's REAL submit, stamping revisionOf = source. A
 *           deterministic refusal abandons the intent at once (attempt 1) and surfaces
 *           the truthful error; a transient failure bumps attempts (abandon only after
 *           the backstop) and rethrows so a later drain retries;
 *   tx-3  — link the source → successor (write-once) and mark the intent Completed;
 *           the append-only events fire only on the first successful link.
 */
async function completeRevisionIntent(p: Persistence, actor: Actor, intent: ApprovalRevision): Promise<RevisionOutcome> {
  let revised = await p.reads.forActor(actor).findSuccessorApproval(intent.sourceApprovalId);

  if (!revised) {
    const payload = approvalPayloadSchema.parse(intent.payload);
    try {
      revised = await dispatchSubmit(p, actor, payload, intent.reason, intent.sourceApprovalId);
    } catch (err) {
      // R3-N03: a peer drainer already created the live successor — the 0061 DB unique
      // refused THIS second submit. Re-probe and converge onto the peer's successor (no
      // fork); if it isn't visible yet, fall through to the normal transient retry.
      if (isLiveSuccessorConflict(err)) {
        revised = await p.reads.forActor(actor).findSuccessorApproval(intent.sourceApprovalId);
      }
      if (!revised) {
        if (!isTransientSubmitFailure(err)) {
          await p.writes.transaction(actor, (tx) => tx.markRevisionAbandoned(intent.id, describeError(err)));
          return { kind: 'abandoned', error: err as Error };
        }
        const attempts = await p.writes.transaction(actor, (tx) => tx.bumpRevisionAttempt(intent.id, describeError(err)));
        if (attempts >= REVISION_MAX_ATTEMPTS) {
          await p.writes.transaction(actor, (tx) =>
            tx.markRevisionAbandoned(intent.id, `Giving up after ${attempts} transient attempt(s): ${describeError(err)}`),
          );
          return { kind: 'abandoned', error: err as Error };
        }
        throw err; // transient — intent stays Pending; a later drain retries it
      }
    }
  }

  const successor = revised;
  await p.writes.transaction(actor, async (tx) => {
    await tx.lockApproval(intent.sourceApprovalId); // serialise the link
    const linked = await tx.setSupersededBy(intent.sourceApprovalId, successor.approvalId); // write-once (idempotent)
    await tx.markRevisionCompleted(intent.id, successor.approvalId);
    if (linked) {
      await tx.appendApprovalEvent({
        approvalId: successor.approvalId,
        fromStatus: 'Submitted',
        toStatus: 'Submitted',
        actor: actor.identity,
        note: `Revision of ${intent.sourceApprovalId} (supersedes it)`,
      });
      await tx.appendAuditEvent({
        entityType: 'Approval',
        entityId: intent.sourceApprovalId,
        action: 'ApprovalSuperseded',
        actor: actor.identity,
        before: null,
        after: { supersededBy: successor.approvalId },
      });
    }
  });
  return { kind: 'completed', revised: { ...successor, revisionOf: intent.sourceApprovalId } };
}

export async function reviseApproval(p: Persistence, actor: Actor, inputRaw: ReviseApprovalInput): Promise<ReviseResult> {
  const { approvalId, expectedVersion, input, reason } = reviseApprovalInputSchema.parse(inputRaw);

  // Read + gate (advisory; the authoritative re-gate runs under the source lock in tx-1).
  const reads = p.reads.forActor(actor);
  const current = await reads.getApprovalById(approvalId);
  if (!current) throw new NotFoundError('Approval', approvalId);
  assertTenantMatch(actor.tenantId, current.tenantId);
  assertOwnRequest(actor, current);
  assertCorrectionsAllowed(current.operationType);

  // Validate FIRST: a schema-invalid revision must never cost the old request.
  const payload = approvalPayloadSchema.parse({ operationType: current.operationType, input });

  // ── tx-1: atomically {re-gate under lock → withdraw-if-open → claim the write-once
  // intent}. After this commits, the source is closed IFF a durable intent exists —
  // "withdrawn with no record" is unrepresentable, and the unique (tenant, source)
  // index makes a concurrent second revise refuse rather than fork. ──────────────────
  const intent = await p.writes.transaction(actor, async (tx) => {
    const src = await tx.lockApproval(approvalId);
    if (!src) throw new NotFoundError('Approval', approvalId);
    assertOwnRequest(actor, src);
    if (!REVISABLE_STATUSES.includes(src.status)) {
      const why =
        src.status === 'Approved'
          ? 'an Approved request belongs to the reviewers (execute or reject are their tools)'
          : src.status === 'ExecutionFailed'
            ? 'an ExecutionFailed request is recovered by the owner re-executing it'
            : 'this request is already done';
      throw new ConflictError(`Cannot revise a ${src.status} request — ${why}.`, { approvalId, status: src.status });
    }
    if (src.supersededBy) {
      throw new ConflictError('This request has already been revised — correct its revision instead.', {
        approvalId,
        supersededBy: src.supersededBy,
      });
    }
    if (src.version !== expectedVersion) throw new ConcurrencyError('Approval', approvalId);

    // Withdraw while still open (Submitted/InReview); terminal rows are already closed.
    if (src.status === 'Submitted' || src.status === 'InReview') {
      const withdrawn = await tx.updateApprovalStatus(approvalId, expectedVersion, { status: 'Withdrawn' });
      if (!withdrawn) throw new ConcurrencyError('Approval', approvalId);
      await tx.appendApprovalEvent({
        approvalId,
        fromStatus: src.status,
        toStatus: 'Withdrawn',
        actor: actor.identity,
        note: 'Withdrawn by the submitter (superseded by a revision)',
      });
    }

    const claimed = await tx.insertRevisionIntent({
      sourceApprovalId: approvalId,
      operationType: current.operationType,
      payload,
      reason: reason ?? current.reason ?? null,
      submittedBy: actor.identity,
    });
    // Write-once: a concurrent revise already holds the claim → refuse (no fork).
    if (!claimed) throw new ConflictError('This request is already being revised.', { approvalId });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalRevisionRequested',
      actor: actor.identity,
      before: { status: src.status },
      after: { intentId: claimed.id },
    });
    return claimed;
  });

  // ── tx-2 + tx-3: complete opportunistically in-request; the drain is the crash net. ──
  const outcome = await completeRevisionIntent(p, actor, intent);
  if (outcome.kind === 'completed') return { revised: outcome.revised, superseded: approvalId };
  // Deterministic refusal (or the transient backstop): the intent is durably Abandoned,
  // the source stays Withdrawn, and we surface the truthful error — the submitter
  // resubmits fresh, but now there is a discoverable record instead of a silent orphan.
  throw outcome.error;
}

/**
 * M-06: drain the revise-intent outbox — finish every Pending intent a crash left
 * between tx-1 and completion. Idempotent + safe to run repeatedly/concurrently: an
 * already-submitted successor is re-linked (never re-submitted), a deterministic
 * refusal is abandoned, a transient failure is isolated and retried by a later run.
 */
export async function drainApprovalRevisions(
  p: Persistence,
  actor: Actor,
): Promise<{ attempted: number; completed: number; abandoned: number }> {
  assertSubmitApproval(actor);
  const pending = await p.reads.forActor(actor).listPendingRevisionIntents();
  let completed = 0;
  let abandoned = 0;
  for (const intent of pending) {
    try {
      const outcome = await completeRevisionIntent(p, actor, intent);
      if (outcome.kind === 'completed') completed += 1;
      else abandoned += 1;
    } catch {
      // Transient — the intent stays Pending and a later drain retries it.
    }
  }
  return { attempted: pending.length, completed, abandoned };
}
