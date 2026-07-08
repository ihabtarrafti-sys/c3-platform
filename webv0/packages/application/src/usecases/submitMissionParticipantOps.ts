/**
 * submitMissionParticipantOps — governed submission of mission-membership
 * operations (Sprint 39, the SP Set-D guard discipline rebuilt natively).
 *
 * SUBMIT-TIME GUARDS (friendly, fail-early — the authoritative re-check runs
 * inside the execution transaction):
 *   1. duplicate-PENDING: an OPEN approval (Submitted / InReview / Approved)
 *      for the same (mission, person) pair blocks a second submission of
 *      EITHER operation — no interleaving ambiguity. ExecutionFailed does NOT
 *      block: resubmission is the certified recovery path.
 *   2. duplicate-ACTIVE (Add): an already-active pair is refused at the door.
 *   3. Add requires an existing ACTIVE mission and an existing person.
 *   4. Remove requires the pair to exist and be ACTIVE (the mission itself may
 *      be retired — removal must never be trapped by a deactivated shell).
 *
 * The approval's targetPersonId carries the participant's PER id and targetId
 * the mission's MSN id — both known at submission.
 */
import {
  type Actor,
  type AddMissionParticipantInput,
  type Approval,
  type RemoveMissionParticipantInput,
  addMissionParticipantInputSchema,
  removeMissionParticipantInputSchema,
  ConflictError,
  formatApprovalId,
  NotFoundError,
  ParticipantConflictError,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

const OPEN_STATUSES = ['Submitted', 'InReview', 'Approved'] as const;
const PARTICIPANT_OPS = ['AddMissionParticipant', 'RemoveMissionParticipant'] as const;

/** Guard 1: any open participant approval for the pair blocks a new one. */
async function assertNoOpenApprovalForPair(
  p: Persistence,
  actor: Actor,
  missionId: string,
  personId: string,
): Promise<void> {
  const open = await p.reads.forActor(actor).listApprovals({ statuses: [...OPEN_STATUSES] });
  const clash = open.some(
    (a) =>
      (PARTICIPANT_OPS as readonly string[]).includes(a.operationType) &&
      a.targetId === missionId &&
      a.targetPersonId === personId,
  );
  if (clash) throw new ParticipantConflictError(missionId, personId, 'pending-approval');
}

export async function submitAddMissionParticipant(
  p: Persistence,
  actor: Actor,
  command: { input: AddMissionParticipantInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = addMissionParticipantInputSchema.parse(command.input);
  const reads = p.reads.forActor(actor);

  const mission = await reads.getMissionById(input.missionId);
  if (!mission) throw new NotFoundError('Mission', input.missionId);
  if (!mission.isActive) throw new ConflictError('Participants may not be added to an inactive mission.', { missionId: input.missionId });

  const person = await reads.getPersonById(input.personId);
  if (!person) throw new NotFoundError('Person', input.personId);

  await assertNoOpenApprovalForPair(p, actor, input.missionId, input.personId);

  const pair = await reads.getMissionParticipant(input.missionId, input.personId);
  if (pair?.isActive) throw new ParticipantConflictError(input.missionId, input.personId, 'active-participant');

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'AddMissionParticipant',
      targetPersonId: input.personId,
      targetId: input.missionId,
      reason,
      payload: { operationType: 'AddMissionParticipant', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `AddMissionParticipant request submitted: ${input.personId} as ${input.role} on ${input.missionId}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'AddMissionParticipant', missionId: input.missionId, personId: input.personId, role: input.role },
    });
    return approval;
  });
}

export async function submitRemoveMissionParticipant(
  p: Persistence,
  actor: Actor,
  command: { input: RemoveMissionParticipantInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = removeMissionParticipantInputSchema.parse(command.input);
  const reads = p.reads.forActor(actor);

  // Removal is valid even on a retired mission shell (cleanup must not be
  // trapped) — the pair itself must exist and be active.
  const pair = await reads.getMissionParticipant(input.missionId, input.personId);
  if (!pair) throw new NotFoundError('Mission participant', `${input.personId} on ${input.missionId}`);
  if (!pair.isActive) {
    throw new ConflictError('The person is not an active participant of this mission.', {
      missionId: input.missionId,
      personId: input.personId,
    });
  }

  await assertNoOpenApprovalForPair(p, actor, input.missionId, input.personId);

  const reason = command.reason?.trim() ? command.reason.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'RemoveMissionParticipant',
      targetPersonId: input.personId,
      targetId: input.missionId,
      reason,
      payload: { operationType: 'RemoveMissionParticipant', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `RemoveMissionParticipant request submitted: ${input.personId} from ${input.missionId}`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'RemoveMissionParticipant', missionId: input.missionId, personId: input.personId },
    });
    return approval;
  });
}
