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
  type Journey,
  type MissionParticipant,
  type Person,
  ApprovalNotApprovedError,
  canApply,
  ConcurrencyError,
  ConflictError,
  formatCredentialId,
  formatJourneyId,
  formatPersonId,
  NotFoundError,
  ParticipantConflictError,
} from '@c3web/domain';
import { assertExecuteApproval, assertTenantMatch } from '@c3web/authz';
import type { Persistence, WriteTx } from '../ports';

export interface ExecuteResult {
  readonly approval: Approval;
  readonly person: Person | null;
  /** Set when the executed operation created or mutated a credential (Sprint 36). */
  readonly credential: Credential | null;
  /** Set when the executed operation created a journey (Sprint 37). */
  readonly journey: Journey | null;
  /** Set when the executed operation added/removed a mission participant (Sprint 39). */
  readonly participant: MissionParticipant | null;
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

      // Idempotent: already executed -> return what it created. Participant
      // ops have no created_by column (a pair outlives many approvals); the
      // pair row itself is the result, re-read via the immutable payload.
      if (approval.status === 'Executed') {
        const person = await tx.getPersonByCreatingApproval(approvalId);
        const credential =
          approval.payload.operationType === 'AddCredential' ? await tx.getCredentialByCreatingApproval(approvalId) : null;
        const journey =
          approval.payload.operationType === 'InitiateJourney' ? await tx.getJourneyByCreatingApproval(approvalId) : null;
        const participant =
          approval.payload.operationType === 'AddMissionParticipant' || approval.payload.operationType === 'RemoveMissionParticipant'
            ? await tx.getParticipant(approval.payload.input.missionId, approval.payload.input.personId)
            : null;
        return { approval, person, credential, journey, participant, idempotent: true };
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
        // ── Sprint 37: journeys ────────────────────────────────────────────
        if (approval.payload.operationType === 'InitiateJourney') {
          const { input } = approval.payload;
          const seq = await tx.allocateSequence('journey');
          const journeyId = formatJourneyId(seq);
          // The composite FK (tenant_id, person_id) authoritatively enforces
          // the owning person; the journey is born Active.
          const journey = await tx.insertJourney({
            journeyId,
            personId: input.personId,
            journeyType: input.journeyType,
            title: input.title,
            startedOn: input.startedOn,
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
            note: `Executed: initiated ${journeyId} for ${input.personId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Journey',
            entityId: journeyId,
            action: 'JourneyInitiated',
            actor: actor.identity,
            before: null,
            after: { journeyId, personId: input.personId, journeyType: input.journeyType, startedOn: input.startedOn, status: 'Active' },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'InitiateJourney', journeyId },
          });
          return { approval: executed, person: null, credential: null, journey, participant: null, idempotent: false };
        }
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
          return { approval: executed, person: null, credential, journey: null, participant: null, idempotent: false };
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
          return { approval: executed, person: null, credential, journey: null, participant: null, idempotent: false };
        }

        // ── Sprint 39: mission participants (the Set-D discipline) ─────────
        // The submit-time guards were friendly; THIS is the authoritative
        // re-check, inside the transaction, on a row-locked pair. A pair that
        // became active between approval and execution is a truthful
        // ExecutionFailed — never a duplicate row (the UNIQUE constraint is
        // the last line).
        if (approval.payload.operationType === 'AddMissionParticipant') {
          const { input } = approval.payload;
          const mission = await tx.getMission(input.missionId);
          if (!mission) throw new NotFoundError('Mission', input.missionId);
          if (!mission.isActive) {
            throw new ConflictError('Participants may not be added to an inactive mission.', { missionId: input.missionId });
          }
          const pair = await tx.getParticipantForUpdate(input.missionId, input.personId);
          if (pair?.isActive) throw new ParticipantConflictError(input.missionId, input.personId, 'active-participant');

          // Reactivation reuses THE SAME row (the SP APR-0065 semantics);
          // first-ever membership inserts, with the person FK authoritative.
          const participant = pair
            ? await tx.reactivateParticipant(input.missionId, input.personId, input.role)
            : await tx.insertParticipant(input.missionId, input.personId, input.role);
          if (!participant) throw new ConcurrencyError('Mission participant', `${input.personId} on ${input.missionId}`);

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
            note: `Executed: added ${input.personId} as ${input.role} on ${input.missionId}${pair ? ' (reactivated existing membership row)' : ''}`,
          });
          await tx.appendAuditEvent({
            entityType: 'MissionParticipant',
            entityId: `${input.missionId}/${input.personId}`,
            action: 'MissionParticipantAdded',
            actor: actor.identity,
            before: pair ? { isActive: false, role: pair.role } : null,
            after: { isActive: true, role: input.role, missionId: input.missionId, personId: input.personId },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'AddMissionParticipant', missionId: input.missionId, personId: input.personId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant, idempotent: false };
        }

        if (approval.payload.operationType === 'RemoveMissionParticipant') {
          const { input } = approval.payload;
          const pair = await tx.getParticipantForUpdate(input.missionId, input.personId);
          if (!pair || !pair.isActive) {
            throw new ConflictError('The person is not an active participant of this mission.', {
              missionId: input.missionId,
              personId: input.personId,
            });
          }
          const participant = await tx.deactivateParticipant(input.missionId, input.personId);
          if (!participant) throw new ConcurrencyError('Mission participant', `${input.personId} on ${input.missionId}`);

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
            note: `Executed: removed ${input.personId} from ${input.missionId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'MissionParticipant',
            entityId: `${input.missionId}/${input.personId}`,
            action: 'MissionParticipantRemoved',
            actor: actor.identity,
            before: { isActive: true, role: pair.role },
            after: { isActive: false },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'RemoveMissionParticipant', missionId: input.missionId, personId: input.personId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant, idempotent: false };
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

        return { approval: executed, person: null, credential: null, journey: null, participant: null, idempotent: false };
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

      return { approval: executed, person, credential: null, journey: null, participant: null, idempotent: false };
    });
  } catch (err) {
    // A concurrent duplicate execute already created the record: resolve to
    // the same idempotent result rather than a spurious failure.
    if (isUniqueViolation(err)) {
      const approval = await p.reads.forActor(actor).getApprovalById(approvalId);
      if (approval?.payload.operationType === 'AddCredential') {
        const credential = await p.writes.transaction(actor, (tx) => tx.getCredentialByCreatingApproval(approvalId));
        if (credential) return { approval, person: null, credential, journey: null, participant: null, idempotent: true };
      } else if (approval?.payload.operationType === 'AddMissionParticipant') {
        // A unique-violation on the pair row means ANOTHER approval activated
        // this membership concurrently — that is a genuine conflict for THIS
        // approval (never idempotent success): fall through to the truthful
        // ExecutionFailed recording below.
      } else {
        const person = await p.writes.transaction(actor, (tx) => tx.getPersonByCreatingApproval(approvalId));
        if (approval && person) return { approval, person, credential: null, journey: null, participant: null, idempotent: true };
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
