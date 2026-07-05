/**
 * executeApproval — the owner-only, transactional execution of an approved
 * AddPerson request.
 *
 * Happy path (ONE transaction):
 *   1. lock/claim the approval (FOR UPDATE);
 *   2. verify Approved (or ExecutionFailed retry) and not already executed;
 *   3. allocate the canonical PersonID;
 *   4. create exactly one Person (unique created_by_approval_id = idempotency);
 *   5. stamp the approval Executed + backfill target person id;
 *   6. append the approval event + audit events;
 *   7. commit atomically.
 *
 * Idempotency: an already-Executed approval returns the person it created
 * (no second person, no error). A concurrent duplicate execute is caught by the
 * unique constraint and resolved to the same idempotent result.
 *
 * Failure: a genuine fault DURING execution rolls the transaction back (no
 * Person, no false Executed truth) and is then recorded truthfully as
 * ExecutionFailed in a separate transaction. Pre-condition rejections
 * (forbidden / self-review / not-approved / stale-version) propagate unchanged
 * and are NOT recorded as execution failures.
 */
import {
  type Actor,
  type AddPersonApprovalPayload,
  type Approval,
  type Person,
  ApprovalNotApprovedError,
  canApply,
  ConcurrencyError,
  formatPersonId,
  NotFoundError,
} from '@c3web/domain';
import { assertExecuteApproval, assertTenantMatch } from '@c3web/authz';
import type { Persistence, WriteTx } from '../ports';

export interface ExecuteResult {
  readonly approval: Approval;
  readonly person: Person | null;
  readonly idempotent: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export async function executeApproval(
  p: Persistence,
  actor: Actor,
  approvalId: string,
  expectedVersion: number,
): Promise<ExecuteResult> {
  let enteredExecution = false;

  try {
    return await p.writes.transaction(actor, async (tx: WriteTx) => {
      const approval = await tx.lockApproval(approvalId);
      if (!approval) throw new NotFoundError('Approval', approvalId);

      // Role (owner) + separation of duties (submitter may not execute).
      assertExecuteApproval(actor, approval.submittedBy);
      assertTenantMatch(actor.tenantId, approval.tenantId);

      // Idempotent: already executed -> return the person it created.
      if (approval.status === 'Executed') {
        const person = await tx.getPersonByCreatingApproval(approvalId);
        return { approval, person, idempotent: true };
      }

      if (!canApply('executeSuccess', approval.status)) {
        throw new ApprovalNotApprovedError(approval.status);
      }
      if (approval.version !== expectedVersion) throw new ConcurrencyError('Approval', approvalId);

      // ── point of no return: any failure past here is an EXECUTION failure ──
      enteredExecution = true;

      const seq = await tx.allocateSequence('person');
      const personId = formatPersonId(seq);
      const { input } = approval.payload as AddPersonApprovalPayload;

      const person = await tx.insertPerson({
        personId,
        fullName: input.fullName,
        ign: input.ign,
        nationality: input.nationality,
        primaryRole: input.primaryRole,
        personnelCode: input.personnelCode,
        currentTeam: input.currentTeam,
        currentGameTitle: input.currentGameTitle,
        primaryDepartment: input.primaryDepartment,
        notes: input.notes,
        createdByApprovalId: approvalId,
      });

      const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, {
        status: 'Executed',
        executedAt: new Date().toISOString(),
        executionError: null,
        targetPersonId: personId,
      });
      if (!executed) throw new ConcurrencyError('Approval', approvalId);

      await tx.appendApprovalEvent({
        approvalId,
        fromStatus: approval.status,
        toStatus: 'Executed',
        actor: actor.identity,
        note: `Executed: created ${personId}`,
      });
      await tx.appendAuditEvent({
        entityType: 'Person',
        entityId: personId,
        action: 'PersonCreated',
        actor: actor.identity,
        before: null,
        after: { personId, fullName: person.fullName },
      });
      await tx.appendAuditEvent({
        entityType: 'Approval',
        entityId: approvalId,
        action: 'ApprovalExecuted',
        actor: actor.identity,
        before: { status: approval.status },
        after: { status: 'Executed', targetPersonId: personId },
      });

      return { approval: executed, person, idempotent: false };
    });
  } catch (err) {
    // A concurrent duplicate execute already created the person: resolve to the
    // same idempotent result rather than a spurious failure.
    if (isUniqueViolation(err)) {
      const approval = await p.reads.forActor(actor).getApprovalById(approvalId);
      const person = await p.writes.transaction(actor, (tx) => tx.getPersonByCreatingApproval(approvalId));
      if (approval && person) return { approval, person, idempotent: true };
    }

    // Genuine fault after the point of no return -> record ExecutionFailed truthfully.
    if (enteredExecution) {
      const message = err instanceof Error ? err.message : String(err);
      await recordExecutionFailure(p, actor, approvalId, message).catch(() => {});
    }
    throw err;
  }
}

async function recordExecutionFailure(p: Persistence, actor: Actor, approvalId: string, message: string): Promise<void> {
  await p.writes.transaction(actor, async (tx: WriteTx) => {
    const approval = await tx.lockApproval(approvalId);
    if (!approval) return;
    // Only record from an executable state; never overwrite a real Executed truth.
    if (approval.status !== 'Approved' && approval.status !== 'ExecutionFailed') return;
    const failed = await tx.updateApprovalStatus(approvalId, approval.version, {
      status: 'ExecutionFailed',
      executionError: message.slice(0, 1000),
    });
    if (!failed) return;
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: approval.status,
      toStatus: 'ExecutionFailed',
      actor: actor.identity,
      note: 'Execution failed',
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalExecutionFailed',
      actor: actor.identity,
      before: { status: approval.status },
      after: { status: 'ExecutionFailed' },
    });
  });
}
