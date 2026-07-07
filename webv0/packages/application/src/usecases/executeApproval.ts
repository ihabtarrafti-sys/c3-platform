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
  type ApprovalPayload,
  type AuditAction,
  type Credential,
  type Person,
  ApprovalNotApprovedError,
  canApply,
  ConcurrencyError,
  ConflictError,
  formatCredentialId,
  formatPersonId,
  NotFoundError,
} from '@c3web/domain';
import { assertExecuteApproval, assertTenantMatch } from '@c3web/authz';
import type { Persistence, WriteTx } from '../ports';

export interface ExecuteResult {
  readonly approval: Approval;
  readonly person: Person | null;
  /** Set when the executed operation created or mutated a credential (Sprint 36). */
  readonly credential: Credential | null;
  readonly idempotent: boolean;
}

type MemberOperationPayload = Extract<
  ApprovalPayload,
  { operationType: 'ProvisionMember' | 'ChangeRole' | 'DeactivateMember' | 'ReactivateMember' }
>;

/**
 * Execute a member operation through the SECURITY DEFINER gateways (Sprint 35).
 * Runs inside the same transaction as the status flip + events + audit — an
 * unaudited access change is unrepresentable. Returns audit facts to record.
 */
async function executeMemberOperation(
  tx: WriteTx,
  actor: Actor,
  payload: MemberOperationPayload,
): Promise<{ entityId: string; action: AuditAction; before: Record<string, unknown> | null; after: Record<string, unknown>; note: string }> {
  switch (payload.operationType) {
    case 'ProvisionMember': {
      const { input } = payload;
      const userId = await tx.memberProvision({
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        provider: input.identity.provider,
        issuerTenantId: input.identity.issuerTenantId,
        subject: input.identity.subject,
      });
      return {
        entityId: userId,
        action: 'MemberProvisioned',
        before: null,
        after: { userId, email: input.email, role: input.role },
        note: `Executed: provisioned member ${input.email} (${input.role})`,
      };
    }
    case 'ChangeRole': {
      const { input } = payload;
      const previousRoles = await tx.memberSetRole(input.targetUserId, input.toRole, actor.identity);
      return {
        entityId: input.targetUserId,
        action: 'MemberRoleChanged',
        before: { roles: previousRoles },
        after: { role: input.toRole, email: input.email },
        note: `Executed: role changed to ${input.toRole} for ${input.email}`,
      };
    }
    case 'DeactivateMember': {
      const { input } = payload;
      const mode = await tx.memberSetActive(input.targetUserId, false, actor.identity);
      return {
        entityId: input.targetUserId,
        action: 'MemberDeactivated',
        before: { isActive: true },
        after: { isActive: false, mode, email: input.email },
        note: `Executed: deactivated ${input.email} (${mode})`,
      };
    }
    case 'ReactivateMember': {
      const { input } = payload;
      const mode = await tx.memberSetActive(input.targetUserId, true, actor.identity);
      return {
        entityId: input.targetUserId,
        action: 'MemberReactivated',
        before: { isActive: false },
        after: { isActive: true, mode, email: input.email },
        note: `Executed: reactivated ${input.email}`,
      };
    }
  }
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

      // Idempotent: already executed -> return what it created.
      if (approval.status === 'Executed') {
        const person = await tx.getPersonByCreatingApproval(approvalId);
        const credential =
          approval.payload.operationType === 'AddCredential' ? await tx.getCredentialByCreatingApproval(approvalId) : null;
        return { approval, person, credential, idempotent: true };
      }

      if (!canApply('executeSuccess', approval.status)) {
        throw new ApprovalNotApprovedError(approval.status);
      }
      if (approval.version !== expectedVersion) throw new ConcurrencyError('Approval', approvalId);

      // ── point of no return: any failure past here is an EXECUTION failure ──
      enteredExecution = true;

      // Non-AddPerson operations dispatch on the payload discriminant, all in
      // this one transaction. The AddPerson path below is the certified
      // original, unchanged. Anything without an executor FAILS CLOSED.
      if (approval.payload.operationType !== 'AddPerson') {
        // ── Sprint 36: credentials ─────────────────────────────────────────
        if (approval.payload.operationType === 'AddCredential') {
          const { input } = approval.payload;
          const seq = await tx.allocateSequence('credential');
          const credentialId = formatCredentialId(seq);
          // The composite FK (tenant_id, person_id) authoritatively enforces
          // that the owning person exists — a violation is a truthful
          // ExecutionFailed, not a partial write.
          const credential = await tx.insertCredential({
            credentialId,
            personId: input.personId,
            credentialType: input.credentialType,
            issuer: input.issuer,
            issuedOn: input.issuedOn,
            expiresOn: input.expiresOn,
            notes: input.notes,
            createdByApprovalId: approvalId,
          });
          const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, {
            status: 'Executed',
            executedAt: new Date().toISOString(),
            executionError: null,
          });
          if (!executed) throw new ConcurrencyError('Approval', approvalId);
          await tx.appendApprovalEvent({
            approvalId,
            fromStatus: approval.status,
            toStatus: 'Executed',
            actor: actor.identity,
            note: `Executed: created ${credentialId} for ${input.personId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Credential',
            entityId: credentialId,
            action: 'CredentialCreated',
            actor: actor.identity,
            before: null,
            after: {
              credentialId,
              personId: input.personId,
              credentialType: input.credentialType,
              issuedOn: input.issuedOn,
              expiresOn: input.expiresOn,
            },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'AddCredential', credentialId },
          });
          return { approval: executed, person: null, credential, idempotent: false };
        }

        if (approval.payload.operationType === 'DeactivateCredential') {
          const { input } = approval.payload;
          const credential = await tx.deactivateCredential(input.credentialId);
          if (!credential) {
            throw new ConflictError('The credential does not exist or is already inactive.', {
              credentialId: input.credentialId,
            });
          }
          const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, {
            status: 'Executed',
            executedAt: new Date().toISOString(),
            executionError: null,
          });
          if (!executed) throw new ConcurrencyError('Approval', approvalId);
          await tx.appendApprovalEvent({
            approvalId,
            fromStatus: approval.status,
            toStatus: 'Executed',
            actor: actor.identity,
            note: `Executed: deactivated ${input.credentialId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Credential',
            entityId: input.credentialId,
            action: 'CredentialDeactivated',
            actor: actor.identity,
            before: { isActive: true },
            after: { isActive: false, personId: credential.personId },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'DeactivateCredential', credentialId: input.credentialId },
          });
          return { approval: executed, person: null, credential, idempotent: false };
        }

        // ── Sprint 35: member operations ───────────────────────────────────
        // Exhaustiveness is compile-enforced: after the credential branches,
        // the payload narrows to exactly the member-operation union that
        // executeMemberOperation accepts — adding a new operation type without
        // an executor is a type error here, not a runtime surprise.
        const fact = await executeMemberOperation(tx, actor, approval.payload);

        const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, {
          status: 'Executed',
          executedAt: new Date().toISOString(),
          executionError: null,
        });
        if (!executed) throw new ConcurrencyError('Approval', approvalId);

        await tx.appendApprovalEvent({
          approvalId,
          fromStatus: approval.status,
          toStatus: 'Executed',
          actor: actor.identity,
          note: fact.note,
        });
        await tx.appendAuditEvent({
          entityType: 'Member',
          entityId: fact.entityId,
          action: fact.action,
          actor: actor.identity,
          before: fact.before,
          after: fact.after,
        });
        await tx.appendAuditEvent({
          entityType: 'Approval',
          entityId: approvalId,
          action: 'ApprovalExecuted',
          actor: actor.identity,
          before: { status: approval.status },
          after: { status: 'Executed', operationType: approval.payload.operationType, member: fact.entityId },
        });

        return { approval: executed, person: null, credential: null, idempotent: false };
      }

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

      return { approval: executed, person, credential: null, idempotent: false };
    });
  } catch (err) {
    // A concurrent duplicate execute already created the record: resolve to
    // the same idempotent result rather than a spurious failure.
    if (isUniqueViolation(err)) {
      const approval = await p.reads.forActor(actor).getApprovalById(approvalId);
      if (approval?.payload.operationType === 'AddCredential') {
        const credential = await p.writes.transaction(actor, (tx) => tx.getCredentialByCreatingApproval(approvalId));
        if (credential) return { approval, person: null, credential, idempotent: true };
      } else {
        const person = await p.writes.transaction(actor, (tx) => tx.getPersonByCreatingApproval(approvalId));
        if (approval && person) return { approval, person, credential: null, idempotent: true };
      }
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
