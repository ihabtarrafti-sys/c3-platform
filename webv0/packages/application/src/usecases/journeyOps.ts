/**
 * journeyOps — the Journeys domain use-cases (Sprint 37).
 *
 * Two mutation classes, per the design (S37-journeys-domain.md):
 *   - submitInitiateJourney: GOVERNED — creates the approval; the journey is
 *     born only when an owner (≠ requester) executes it.
 *   - transitionJourney: DIRECT-BUT-AUDITED — role-gated (owner/operations),
 *     state-machine validated, version-guarded, and the audit event commits in
 *     the SAME transaction as the flip. Cancel requires a reason.
 */
import {
  type Actor,
  type Approval,
  type InitiateJourneyInput,
  type Journey,
  type JourneyTransition,
  type AuditAction,
  initiateJourneyInputSchema,
  canTransitionJourney,
  nextJourneyStatus,
  JOURNEY_CLOSING_TRANSITIONS,
  ConcurrencyError,
  ConflictError,
  formatApprovalId,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertOperateJourneys, assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

export async function submitInitiateJourney(
  p: Persistence,
  actor: Actor,
  command: { input: InitiateJourneyInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = initiateJourneyInputSchema.parse(command.input);

  // Friendly early check: the person must exist in this tenant.
  const person = await p.reads.forActor(actor).getPersonById(input.personId);
  if (!person) throw new NotFoundError('Person', input.personId);

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'InitiateJourney',
      targetPersonId: input.personId,
      targetId: null, // the JRN id does not exist until execution
      reason,
      payload: { operationType: 'InitiateJourney', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `InitiateJourney request submitted for ${input.personId}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'InitiateJourney', personId: input.personId, journeyType: input.journeyType },
    });
    return approval;
  });
}

const AUDIT_FOR_TRANSITION: Record<JourneyTransition, AuditAction> = {
  suspend: 'JourneySuspended',
  resume: 'JourneyResumed',
  complete: 'JourneyCompleted',
  cancel: 'JourneyCancelled',
};

/** Server-side plain calendar date for endedOn stamps (UTC day — deterministic). */
function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function transitionJourney(
  p: Persistence,
  actor: Actor,
  journeyId: string,
  action: JourneyTransition,
  expectedVersion: number,
  reason?: string | null,
): Promise<Journey> {
  assertOperateJourneys(actor);

  const trimmedReason = reason?.trim() ? reason.trim() : null;
  if (action === 'cancel' && !trimmedReason) {
    throw new ValidationError('Cancelling a journey requires a reason.');
  }

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getJourney(journeyId);
    if (!current) throw new NotFoundError('Journey', journeyId);
    if (!canTransitionJourney(action, current.status)) {
      throw new InvalidTransitionError(current.status, action);
    }
    const to = nextJourneyStatus(action, current.status)!;
    const endedOn = JOURNEY_CLOSING_TRANSITIONS.includes(action) ? utcTodayIso() : null;
    // L-01: a journey cannot end before it started (friendly pre-check; the DB
    // journey_ended_after_started CHECK is the authority).
    if (endedOn !== null && endedOn < current.startedOn) {
      throw new ConflictError('A journey cannot be closed before its start date.', { journeyId, startedOn: current.startedOn, endedOn });
    }

    // Version + state guarded at the statement level: a stale or raced row
    // updates nothing and surfaces as a truthful concurrency refusal.
    const updated = await tx.transitionJourney(journeyId, expectedVersion, [current.status], { status: to, endedOn });
    if (!updated) throw new ConcurrencyError('Journey', journeyId);

    await tx.appendAuditEvent({
      entityType: 'Journey',
      entityId: journeyId,
      action: AUDIT_FOR_TRANSITION[action],
      actor: actor.identity,
      before: { status: current.status },
      after: { status: to, ...(endedOn ? { endedOn } : {}), ...(trimmedReason ? { reason: trimmedReason } : {}) },
    });
    return updated;
  });
}
