/**
 * submitPersonOps — S11 People v2: the governed person mutations (owner-
 * ratified C2). Identity-material facts and lifecycle flips are compliance
 * facts — they enter the pipeline (submit → review → approve → execute,
 * requester ≠ approver) and never change directly. One open request per
 * person across this family (a second would race the first's snapshot).
 *
 * The payload is a SNAPSHOT of intent; the current record is re-read and
 * validated at execute time (executeApproval).
 */
import {
  type Actor,
  type Approval,
  ConflictError,
  deactivatePersonInputSchema,
  type DeactivatePersonInput,
  formatApprovalId,
  NotFoundError,
  reactivatePersonInputSchema,
  type ReactivatePersonInput,
  updatePersonIdentityInputSchema,
  type UpdatePersonIdentityInput,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

const OPEN_STATUSES = ['Submitted', 'InReview', 'Approved', 'ExecutionFailed'] as const;
const PERSON_OPS = ['UpdatePersonIdentity', 'DeactivatePerson', 'ReactivatePerson'] as const;

async function assertNoOpenPersonOp(p: Persistence, actor: Actor, personId: string): Promise<void> {
  const open = await p.reads.forActor(actor).listApprovals({ statuses: [...OPEN_STATUSES] });
  const clash = open.some(
    (a) => (PERSON_OPS as readonly string[]).includes(a.operationType) && a.targetPersonId === personId,
  );
  if (clash) {
    throw new ConflictError('An open person request already exists for this person. Resolve it before submitting another.', {
      personId,
    });
  }
}

type PersonOp = 'UpdatePersonIdentity' | 'DeactivatePerson' | 'ReactivatePerson';

async function submitPersonOp(
  p: Persistence,
  actor: Actor,
  personId: string,
  reasonRaw: string | null | undefined,
  op: PersonOp,
  payloadInput: unknown,
  note: string,
  auditAfter: Record<string, unknown>,
  revisionOf: string | null | undefined,
): Promise<Approval> {
  const person = await p.reads.forActor(actor).getPersonById(personId);
  if (!person) throw new NotFoundError('Person', personId);
  await assertNoOpenPersonOp(p, actor, personId);

  const reason = reasonRaw?.trim() ? reasonRaw.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: op,
      targetPersonId: personId,
      targetId: null,
      reason,
      payload: { operationType: op, input: payloadInput } as Approval['payload'],
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
      after: { status: 'Submitted', operationType: op, personId, ...auditAfter },
    });
    return approval;
  });
}

export async function submitUpdatePersonIdentity(
  p: Persistence,
  actor: Actor,
  command: { input: UpdatePersonIdentityInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = updatePersonIdentityInputSchema.parse(command.input);
  return submitPersonOp(
    p,
    actor,
    input.personId,
    command.reason,
    'UpdatePersonIdentity',
    input,
    `UpdatePersonIdentity request submitted for ${input.personId} (${Object.keys(input.patch).join(', ')})`,
    { fields: Object.keys(input.patch) },
    command.revisionOf,
  );
}

export async function submitDeactivatePerson(
  p: Persistence,
  actor: Actor,
  command: { input: DeactivatePersonInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = deactivatePersonInputSchema.parse(command.input);
  // Friendly: refuse an obviously moot request (re-checked at execute).
  const person = await p.reads.forActor(actor).getPersonById(input.personId);
  if (person && !person.isActive) {
    throw new ConflictError('The person is already inactive.', { personId: input.personId });
  }
  return submitPersonOp(
    p,
    actor,
    input.personId,
    command.reason ?? input.reason,
    'DeactivatePerson',
    input,
    `DeactivatePerson request submitted for ${input.personId}: ${input.reason}`,
    { deactivationReason: input.reason },
    command.revisionOf,
  );
}

/**
 * M-03: idempotent DeactivatePerson hand-off for the offboarding capstone.
 * Departure completion and this submit are separate commits, so a retry after a
 * partial failure must NOT create a second request — nor error just because the
 * first one already landed. Returns the existing OPEN DeactivatePerson approval
 * for the person if one exists (created:false), otherwise submits a fresh one
 * (created:true). The submit's own assertNoOpenPersonOp still guards true
 * concurrent doubles.
 */
export async function findOrSubmitDeactivatePerson(
  p: Persistence,
  actor: Actor,
  command: { input: DeactivatePersonInput; reason?: string | null; revisionOf?: string | null },
): Promise<{ approval: Approval; created: boolean }> {
  assertSubmitApproval(actor);
  const input = deactivatePersonInputSchema.parse(command.input);
  const open = await p.reads.forActor(actor).listApprovals({ statuses: [...OPEN_STATUSES] });
  const existing = open.find((a) => a.operationType === 'DeactivatePerson' && a.targetPersonId === input.personId);
  if (existing) return { approval: existing, created: false };
  const approval = await submitDeactivatePerson(p, actor, command);
  return { approval, created: true };
}

export async function submitReactivatePerson(
  p: Persistence,
  actor: Actor,
  command: { input: ReactivatePersonInput; reason?: string | null; revisionOf?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = reactivatePersonInputSchema.parse(command.input);
  const person = await p.reads.forActor(actor).getPersonById(input.personId);
  if (person && person.isActive) {
    throw new ConflictError('The person is already active.', { personId: input.personId });
  }
  return submitPersonOp(
    p,
    actor,
    input.personId,
    command.reason ?? input.reason,
    'ReactivatePerson',
    input,
    `ReactivatePerson request submitted for ${input.personId}: ${input.reason}`,
    { reactivationReason: input.reason },
    command.revisionOf,
  );
}
