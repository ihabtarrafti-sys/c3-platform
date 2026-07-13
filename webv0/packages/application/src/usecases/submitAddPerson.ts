/**
 * submitAddPerson — governed submission of an AddPerson request (ADR-013).
 * Operations/Owner may submit. Creates an immutable approval in one transaction,
 * appends the Submitted event, and writes the audit trail. No Person is created.
 */
import {
  type Actor,
  type Approval,
  type AddPersonInput,
  addPersonInputSchema,
  formatApprovalId,
  NotFoundError,
  PENDING_ADD_PERSON_TARGET,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface SubmitAddPersonCommand {
  readonly input: AddPersonInput;
  readonly reason?: string | null;
  /** M-06: set when this submit is a revision — stamped as the idempotency key. */
  readonly revisionOf?: string | null;
}

export async function submitAddPerson(
  p: Persistence,
  actor: Actor,
  command: SubmitAddPersonCommand,
): Promise<Approval> {
  assertSubmitApproval(actor);
  // Validate/normalise defensively even though the API also validates the wire.
  const input = addPersonInputSchema.parse(command.input);

  // S48: friendly submit-time check — the "signed with" entity must exist
  // (the FK is the authoritative guard at execute).
  if (input.entityId) {
    const entity = await p.reads.forActor(actor).getEntityById(input.entityId);
    if (!entity) throw new NotFoundError('Entity', input.entityId);
  }

  const reason = command.reason?.trim() ? command.reason.trim() : null;

  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'AddPerson',
      targetPersonId: PENDING_ADD_PERSON_TARGET,
      targetId: null,
      reason,
      payload: { operationType: 'AddPerson', input },
      submittedBy: actor.identity,
      revisionOf: command.revisionOf ?? null,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: 'AddPerson request submitted',
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'AddPerson', fullName: input.fullName },
    });
    return approval;
  });
}
