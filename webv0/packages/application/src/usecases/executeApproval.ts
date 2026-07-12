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
  type Agreement,
  type Approval,
  type ApprovalPayload,
  type AuditAction,
  type Credential,
  type Journey,
  type MissionParticipant,
  type Person,
  ApprovalNotApprovedError,
  canApply,
  checkSelfReview,
  ConcurrencyError,
  ConflictError,
  ForbiddenError,
  SelfReviewError,
  formatAgreementId,
  formatAgreementTermId,
  formatCredentialId,
  formatJourneyId,
  formatPersonId,
  formatBeneficiaryId,
  assertTermShape,
  NotFoundError,
  ParticipantConflictError,
} from '@c3web/domain';
import { assertExecuteApproval, assertTenantMatch, canExecuteApproval } from '@c3web/authz';
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
  /** Set when the executed operation created or mutated an agreement (Sprint 41). */
  readonly agreement: Agreement | null;
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
      // Tier 0.5: an ACTIVE delegation substitutes for the ROLE half only —
      // the self-review separation is NOT delegable.
      if (canExecuteApproval(actor.role)) {
        assertExecuteApproval(actor, approval.submittedBy);
      } else {
        const today = new Date().toISOString().slice(0, 10);
        const delegated = await tx.hasActiveDelegation(actor.identity.toLowerCase(), today);
        if (!delegated) {
          throw new ForbiddenError('Your role may not execute approvals.', { role: actor.role, action: 'execute' });
        }
        const check = checkSelfReview(actor.identity, approval.submittedBy);
        if (check.blocked) throw new SelfReviewError(check.reason);
      }
      assertTenantMatch(actor.tenantId, approval.tenantId);

      // Idempotent: already executed -> return what it created. Participant
      // ops have no created_by column (a pair outlives many approvals); the
      // pair row itself is the result, re-read via the immutable payload.
      // Renew/Terminate return the agreement re-read by its id.
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
        const agreement =
          approval.payload.operationType === 'AddAgreement'
            ? await tx.getAgreementByCreatingApproval(approvalId)
            : approval.payload.operationType === 'RenewAgreement' || approval.payload.operationType === 'TerminateAgreement'
              ? await tx.getAgreement(approval.payload.input.agreementId)
              : null;
        return { approval, person, credential, journey, participant, agreement, idempotent: true };
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
          return { approval: executed, person: null, credential: null, journey, participant: null, agreement: null, idempotent: false };
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
            kind: input.kind,
            documentNumber: input.documentNumber,
            issuingCountry: input.issuingCountry,
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
          return { approval: executed, person: null, credential, journey: null, participant: null, agreement: null, idempotent: false };
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
          return { approval: executed, person: null, credential, journey: null, participant: null, agreement: null, idempotent: false };
        }

        if (approval.payload.operationType === 'ReactivateCredential') {
          const { input } = approval.payload;
          const credential = await tx.reactivateCredential(input.credentialId);
          if (!credential) {
            throw new ConflictError('The credential does not exist or is already active.', {
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
            note: `Executed: reactivated ${input.credentialId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Credential',
            entityId: input.credentialId,
            action: 'CredentialReactivated',
            actor: actor.identity,
            before: { isActive: false },
            after: { isActive: true, personId: credential.personId },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'ReactivateCredential', credentialId: input.credentialId },
          });
          return { approval: executed, person: null, credential, journey: null, participant: null, agreement: null, idempotent: false };
        }

        // ── Sprint 41: agreements — the material lifecycle, executed ───────
        if (approval.payload.operationType === 'AddAgreement') {
          const { input } = approval.payload;
          const seq = await tx.allocateSequence('agreement');
          const agreementId = formatAgreementId(seq);
          // Composite FKs authoritatively require the person and (when given)
          // the linked parent agreement; the partial unique index on the
          // agreement code turns a duplicate into a truthful ExecutionFailed.
          const agreement = await tx.insertAgreement({
            agreementId,
            personId: input.personId,
            entityId: input.entityId ?? null,
            agreementCode: input.agreementCode,
            agreementType: input.agreementType,
            linkedAgreementId: input.linkedAgreementId,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            valueUsdCents: input.valueUsdCents,
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
            note: `Executed: created ${agreementId} (${input.agreementType}) for ${input.personId ?? input.entityId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Agreement',
            entityId: agreementId,
            action: 'AgreementCreated',
            actor: actor.identity,
            before: null,
            after: {
              agreementId,
              personId: input.personId,
              agreementType: input.agreementType,
              startsOn: input.startsOn,
              endsOn: input.endsOn,
              linkedAgreementId: input.linkedAgreementId,
            },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'AddAgreement', agreementId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement, idempotent: false };
        }

        if (approval.payload.operationType === 'RenewAgreement') {
          const { input } = approval.payload;
          const current = await tx.getAgreement(input.agreementId);
          if (!current) throw new NotFoundError('Agreement', input.agreementId);
          if (current.status !== 'Active') {
            throw new ConflictError('The agreement is not active.', { agreementId: input.agreementId, status: current.status });
          }
          if (input.newEndsOn <= current.endsOn) {
            throw new ConflictError('The new end date no longer extends the current term.', {
              agreementId: input.agreementId,
              currentEndsOn: current.endsOn,
              newEndsOn: input.newEndsOn,
            });
          }
          const agreement = await tx.renewAgreement(input.agreementId, input.newEndsOn);
          if (!agreement) throw new ConcurrencyError('Agreement', input.agreementId);

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
            note: `Executed: renewed ${input.agreementId} to ${input.newEndsOn}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Agreement',
            entityId: input.agreementId,
            action: 'AgreementRenewed',
            actor: actor.identity,
            before: { endsOn: current.endsOn },
            after: { endsOn: input.newEndsOn },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'RenewAgreement', agreementId: input.agreementId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement, idempotent: false };
        }

        if (approval.payload.operationType === 'TerminateAgreement') {
          const { input } = approval.payload;
          const current = await tx.getAgreement(input.agreementId);
          if (!current) throw new NotFoundError('Agreement', input.agreementId);
          if (current.status !== 'Active') {
            throw new ConflictError('The agreement is not active.', { agreementId: input.agreementId, status: current.status });
          }
          const agreement = await tx.terminateAgreement(input.agreementId);
          if (!agreement) throw new ConcurrencyError('Agreement', input.agreementId);

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
            note: `Executed: terminated ${input.agreementId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Agreement',
            entityId: input.agreementId,
            action: 'AgreementTerminated',
            actor: actor.identity,
            before: { status: 'Active' },
            after: { status: 'Terminated', reason: input.reason },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'TerminateAgreement', agreementId: input.agreementId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement, idempotent: false };
        }

        // ── S5: ImportBatch — every row lands in THIS one transaction, or none ──
        // (atomicity IS the idempotency story: a mid-batch fault rolls back
        // wholly to a truthful ExecutionFailed; re-execute re-runs the batch.)
        if (approval.payload.operationType === 'ImportBatch') {
          const { input } = approval.payload;
          let count = 0;

          if (input.domain === 'people') {
            for (const row of input.people ?? []) {
              const seq = await tx.allocateSequence('person');
              const personId = formatPersonId(seq);
              await tx.insertPerson({
                personId,
                fullName: row.fullName,
                ign: row.ign,
                nationality: row.nationality,
                primaryRole: row.primaryRole,
                personnelCode: row.personnelCode,
                currentTeam: row.currentTeam,
                currentGameTitle: row.currentGameTitle,
                primaryDepartment: row.primaryDepartment,
                entityId: row.entityId,
                notes: row.notes,
                createdByApprovalId: null, // provenance = the batch approval (audited below)
                isActive: row.isActive,
              });
              await tx.appendAuditEvent({
                entityType: 'Person',
                entityId: personId,
                action: 'PersonCreated',
                actor: actor.identity,
                before: null,
                after: { personId, fullName: row.fullName, importedBy: approvalId },
              });
              count += 1;
            }
          } else if (input.domain === 'credentials') {
            for (const row of input.credentials ?? []) {
              const seq = await tx.allocateSequence('credential');
              const credentialId = formatCredentialId(seq);
              await tx.insertCredential({
                credentialId,
                personId: row.personId,
                credentialType: row.credentialType,
                issuer: row.issuer,
                issuedOn: row.issuedOn,
                expiresOn: row.expiresOn,
                notes: row.notes,
                createdByApprovalId: null,
                isActive: row.isActive,
              });
              await tx.appendAuditEvent({
                entityType: 'Credential',
                entityId: credentialId,
                action: 'CredentialCreated',
                actor: actor.identity,
                before: null,
                after: { credentialId, personId: row.personId, credentialType: row.credentialType, importedBy: approvalId },
              });
              count += 1;
            }
          } else {
            for (const row of input.agreements ?? []) {
              const seq = await tx.allocateSequence('agreement');
              const agreementId = formatAgreementId(seq);
              await tx.insertAgreement({
                agreementId,
                personId: row.personId,
                entityId: row.entityId ?? null,
                agreementCode: row.agreementCode,
                agreementType: row.agreementType,
                linkedAgreementId: row.linkedAgreementId,
                startsOn: row.startsOn,
                endsOn: row.endsOn,
                valueUsdCents: row.valueUsdCents,
                notes: row.notes,
                createdByApprovalId: null,
                status: row.status,
              });
              await tx.appendAuditEvent({
                entityType: 'Agreement',
                entityId: agreementId,
                action: 'AgreementCreated',
                actor: actor.identity,
                before: null,
                after: { agreementId, personId: row.personId, agreementType: row.agreementType, status: row.status, importedBy: approvalId },
              });
              count += 1;
            }
          }

          const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, { status: 'Executed', executedAt: new Date().toISOString(), executionError: null });
          if (!executed) throw new ConcurrencyError('Approval', approvalId);
          await tx.appendApprovalEvent({
            approvalId,
            fromStatus: approval.status,
            toStatus: 'Executed',
            actor: actor.identity,
            note: `Executed: imported ${count} ${input.domain} from "${input.fileName}"`,
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'ImportBatch', domain: input.domain, imported: count },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
        }

        // ── Sprint 3.5: agreement financial terms — the governed money change ──
        // The submit guards were friendly; THIS is authoritative, in-transaction.
        // A terminated agreement or a vanished term is a truthful ExecutionFailed,
        // never a partial write. The term is written through the same
        // version-guarded writeTx methods the direct S3 path used.
        if (approval.payload.operationType === 'AddAgreementTerm') {
          const { input } = approval.payload;
          const agreement = await tx.getAgreement(input.agreementId);
          if (!agreement) throw new NotFoundError('Agreement', input.agreementId);
          if (agreement.status !== 'Active') {
            throw new ConflictError('Financial terms may only be changed on an active agreement.', { agreementId: input.agreementId, status: agreement.status });
          }
          assertTermShape(input.kind, { amountMinor: input.amountMinor, currency: input.currency, percentBps: input.percentBps, label: input.label });

          const seq = await tx.allocateSequence('agreementTerm');
          const termId = formatAgreementTermId(seq);
          const term = await tx.insertAgreementTerm({
            termId,
            agreementId: input.agreementId,
            kind: input.kind,
            amountMinor: input.amountMinor,
            currency: input.currency,
            percentBps: input.percentBps,
            label: input.label,
          });

          const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, { status: 'Executed', executedAt: new Date().toISOString(), executionError: null });
          if (!executed) throw new ConcurrencyError('Approval', approvalId);
          await tx.appendApprovalEvent({ approvalId, fromStatus: approval.status, toStatus: 'Executed', actor: actor.identity, note: `Executed: added ${input.kind} term ${term.termId} to ${input.agreementId}` });
          await tx.appendAuditEvent({
            entityType: 'Agreement',
            entityId: input.agreementId,
            action: 'AgreementTermAdded',
            actor: actor.identity,
            before: null,
            after: { termId: term.termId, kind: input.kind, amountMinor: input.amountMinor, currency: input.currency, percentBps: input.percentBps, label: input.label },
          });
          await tx.appendAuditEvent({ entityType: 'Approval', entityId: approvalId, action: 'ApprovalExecuted', actor: actor.identity, before: { status: approval.status }, after: { status: 'Executed', operationType: 'AddAgreementTerm', termId: term.termId } });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
        }

        if (approval.payload.operationType === 'UpdateAgreementTerm') {
          const { input } = approval.payload;
          const agreement = await tx.getAgreement(input.agreementId);
          if (!agreement) throw new NotFoundError('Agreement', input.agreementId);
          if (agreement.status !== 'Active') {
            throw new ConflictError('Financial terms may only be changed on an active agreement.', { agreementId: input.agreementId, status: agreement.status });
          }
          const current = await tx.getAgreementTerm(input.termId);
          if (!current || current.agreementId !== input.agreementId) {
            throw new ConflictError('The financial term no longer exists.', { termId: input.termId });
          }
          const next = { amountMinor: input.amountMinor, currency: input.currency, percentBps: input.percentBps, label: input.label };
          assertTermShape(current.kind, next); // authoritative shape check against the stored kind
          const updated = await tx.updateAgreementTerm(input.termId, current.version, next);
          if (!updated) throw new ConcurrencyError('Agreement term', input.termId);

          const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, { status: 'Executed', executedAt: new Date().toISOString(), executionError: null });
          if (!executed) throw new ConcurrencyError('Approval', approvalId);
          await tx.appendApprovalEvent({ approvalId, fromStatus: approval.status, toStatus: 'Executed', actor: actor.identity, note: `Executed: changed term ${input.termId} on ${input.agreementId}` });
          await tx.appendAuditEvent({
            entityType: 'Agreement',
            entityId: input.agreementId,
            action: 'AgreementTermUpdated',
            actor: actor.identity,
            before: { termId: current.termId, amountMinor: current.amountMinor, currency: current.currency, percentBps: current.percentBps, label: current.label },
            after: { termId: current.termId, ...next },
          });
          await tx.appendAuditEvent({ entityType: 'Approval', entityId: approvalId, action: 'ApprovalExecuted', actor: actor.identity, before: { status: approval.status }, after: { status: 'Executed', operationType: 'UpdateAgreementTerm', termId: input.termId } });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
        }

        if (approval.payload.operationType === 'RemoveAgreementTerm') {
          const { input } = approval.payload;
          const agreement = await tx.getAgreement(input.agreementId);
          if (!agreement) throw new NotFoundError('Agreement', input.agreementId);
          if (agreement.status !== 'Active') {
            throw new ConflictError('Financial terms may only be changed on an active agreement.', { agreementId: input.agreementId, status: agreement.status });
          }
          const current = await tx.getAgreementTerm(input.termId);
          if (!current || current.agreementId !== input.agreementId) {
            throw new ConflictError('The financial term no longer exists.', { termId: input.termId });
          }
          const removed = await tx.deactivateAgreementTerm(input.termId, current.version);
          if (!removed) throw new ConcurrencyError('Agreement term', input.termId);

          const executed = await tx.updateApprovalStatus(approvalId, expectedVersion, { status: 'Executed', executedAt: new Date().toISOString(), executionError: null });
          if (!executed) throw new ConcurrencyError('Approval', approvalId);
          await tx.appendApprovalEvent({ approvalId, fromStatus: approval.status, toStatus: 'Executed', actor: actor.identity, note: `Executed: removed term ${input.termId} from ${input.agreementId}` });
          await tx.appendAuditEvent({
            entityType: 'Agreement',
            entityId: input.agreementId,
            action: 'AgreementTermRemoved',
            actor: actor.identity,
            before: { termId: current.termId, kind: current.kind, amountMinor: current.amountMinor, currency: current.currency, percentBps: current.percentBps, label: current.label },
            after: { termId: current.termId, isActive: false },
          });
          await tx.appendAuditEvent({ entityType: 'Approval', entityId: approvalId, action: 'ApprovalExecuted', actor: actor.identity, before: { status: approval.status }, after: { status: 'Executed', operationType: 'RemoveAgreementTerm', termId: input.termId } });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
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
          return { approval: executed, person: null, credential: null, journey: null, participant, agreement: null, idempotent: false };
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
          return { approval: executed, person: null, credential: null, journey: null, participant, agreement: null, idempotent: false };
        }

        // ── S11: governed person mutations ───────────────────────────────────
        if (approval.payload.operationType === 'UpdatePersonIdentity') {
          const { input } = approval.payload;
          const current = await tx.lockPerson(input.personId);
          if (!current) throw new NotFoundError('Person', input.personId);

          const patch = input.patch;
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
            before[key] = current[key as keyof typeof current] ?? null;
            after[key] = patch[key] ?? null;
          }

          const person = await tx.updatePersonFields(input.personId, current.version, patch);
          if (!person) throw new ConcurrencyError('Person', input.personId);

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
            note: `Executed: identity updated for ${input.personId} (${Object.keys(patch).join(', ')})`,
          });
          await tx.appendAuditEvent({
            entityType: 'Person',
            entityId: input.personId,
            action: 'PersonIdentityUpdated',
            actor: actor.identity,
            before,
            after,
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'UpdatePersonIdentity', personId: input.personId },
          });
          return { approval: executed, person, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
        }

        if (approval.payload.operationType === 'DeactivatePerson' || approval.payload.operationType === 'ReactivatePerson') {
          const deactivating = approval.payload.operationType === 'DeactivatePerson';
          const { input } = approval.payload;
          const current = await tx.lockPerson(input.personId);
          if (!current) throw new NotFoundError('Person', input.personId);
          if (current.isActive !== deactivating) {
            throw new ConflictError(`The person is already ${deactivating ? 'inactive' : 'active'}.`, {
              personId: input.personId,
            });
          }

          const person = await tx.setPersonActive(input.personId, current.version, !deactivating);
          if (!person) throw new ConcurrencyError('Person', input.personId);

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
            note: `Executed: ${deactivating ? 'deactivated' : 'reactivated'} ${input.personId} — ${input.reason}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Person',
            entityId: input.personId,
            action: deactivating ? 'PersonDeactivated' : 'PersonReactivated',
            actor: actor.identity,
            before: { isActive: current.isActive },
            after: { isActive: !deactivating, reason: input.reason },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: approval.payload.operationType, personId: input.personId },
          });
          return { approval: executed, person, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
        }

        // ── S12: governed credential facts + the beneficiary registry ────────
        if (approval.payload.operationType === 'UpdateCredentialFacts') {
          const { input } = approval.payload;
          const current = await tx.lockCredential(input.credentialId);
          if (!current) throw new NotFoundError('Credential', input.credentialId);
          // M-07: re-check under the row lock. A DeactivateCredential that executed
          // first (both lock the credential, so they serialize) leaves it retired —
          // the facts of a retired record must not change, in EITHER approval order.
          if (!current.isActive) {
            throw new ConflictError('The credential has been retired — its facts can no longer be updated.', { credentialId: input.credentialId });
          }
          const patch = input.patch;
          // date sanity re-checked against the RESULTING pair (sparse patch)
          const issued = patch.issuedOn ?? current.issuedOn;
          const expires = patch.expiresOn !== undefined ? patch.expiresOn : current.expiresOn;
          if (expires !== null && expires <= issued) {
            throw new ConflictError('Expiry must be after the issue date.', { credentialId: input.credentialId, issued, expires });
          }
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
            before[key] = current[key as keyof typeof current] ?? null;
            after[key] = patch[key] ?? null;
          }
          const credential = await tx.updateCredentialFields(input.credentialId, current.version, patch);
          if (!credential) throw new ConcurrencyError('Credential', input.credentialId);

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
            note: `Executed: credential facts updated for ${input.credentialId} (${Object.keys(patch).join(', ')})`,
          });
          await tx.appendAuditEvent({
            entityType: 'Credential',
            entityId: input.credentialId,
            action: 'CredentialFactsUpdated',
            actor: actor.identity,
            before,
            after,
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'UpdateCredentialFacts', credentialId: input.credentialId },
          });
          return { approval: executed, person: null, credential, journey: null, participant: null, agreement: null, idempotent: false };
        }

        if (approval.payload.operationType === 'AddBeneficiary') {
          const { input } = approval.payload;
          const seq = await tx.allocateSequence('beneficiary');
          const beneficiaryId = formatBeneficiaryId(seq);
          try {
            await tx.insertBeneficiary({
              beneficiaryId,
              personId: input.personId,
              label: input.label,
              bankName: input.bankName,
              bankCountry: input.bankCountry,
              currency: input.currency,
              paymentType: input.paymentType,
              registeredWithEntityId: input.registeredWithEntityId,
              notes: input.notes,
              createdByApprovalId: approvalId,
            });
          } catch (err) {
            if (isUniqueViolation(err)) {
              throw new ConflictError(`'${input.label}' is already a live beneficiary label for ${input.personId}.`);
            }
            throw err;
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
            note: `Executed: beneficiary ${beneficiaryId} "${input.label}" for ${input.personId}`,
          });
          await tx.appendAuditEvent({
            entityType: 'Beneficiary',
            entityId: beneficiaryId,
            action: 'BeneficiaryAdded',
            actor: actor.identity,
            before: null,
            after: { personId: input.personId, label: input.label, bankName: input.bankName, currency: input.currency },
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: 'AddBeneficiary', beneficiaryId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
        }

        if (approval.payload.operationType === 'UpdateBeneficiary' || approval.payload.operationType === 'RetireBeneficiary') {
          const retiring = approval.payload.operationType === 'RetireBeneficiary';
          const beneficiaryId = approval.payload.input.beneficiaryId;
          const current = await tx.lockBeneficiary(beneficiaryId);
          if (!current) throw new NotFoundError('Beneficiary', beneficiaryId);
          if (current.status === 'Retired') {
            throw new ConflictError(`${beneficiaryId} is already retired.`);
          }
          const patch = retiring
            ? { status: 'Retired', statusDate: new Date().toISOString().slice(0, 10), notes: current.notes }
            : approval.payload.input.patch;
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
            before[key] = (current as unknown as Record<string, unknown>)[key] ?? null;
            after[key] = (patch as Record<string, unknown>)[key] ?? null;
          }
          let updated;
          try {
            updated = await tx.updateBeneficiaryFields(beneficiaryId, current.version, patch);
          } catch (err) {
            if (isUniqueViolation(err)) {
              throw new ConflictError('That label is already live for this person.');
            }
            throw err;
          }
          if (!updated) throw new ConcurrencyError('Beneficiary', beneficiaryId);

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
            note: retiring
              ? `Executed: retired ${beneficiaryId} — ${approval.payload.input.reason}`
              : `Executed: beneficiary ${beneficiaryId} updated (${Object.keys(patch).join(', ')})`,
          });
          await tx.appendAuditEvent({
            entityType: 'Beneficiary',
            entityId: beneficiaryId,
            action: retiring ? 'BeneficiaryRetired' : 'BeneficiaryUpdated',
            actor: actor.identity,
            before,
            after: retiring ? { ...after, reason: approval.payload.input.reason } : after,
          });
          await tx.appendAuditEvent({
            entityType: 'Approval',
            entityId: approvalId,
            action: 'ApprovalExecuted',
            actor: actor.identity,
            before: { status: approval.status },
            after: { status: 'Executed', operationType: approval.payload.operationType, beneficiaryId },
          });
          return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
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

        return { approval: executed, person: null, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
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
        entityId: input.entityId ?? null,
        notes: input.notes,
        // H-02: PII rides its own gated columns, never `notes`.
        dateOfBirth: input.dateOfBirth ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        addressCity: input.addressCity ?? null,
        addressCountry: input.addressCountry ?? null,
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

      return { approval: executed, person, credential: null, journey: null, participant: null, agreement: null, idempotent: false };
    });
  } catch (err) {
    // A concurrent duplicate execute already created the record: resolve to
    // the same idempotent result rather than a spurious failure.
    if (isUniqueViolation(err)) {
      const approval = await p.reads.forActor(actor).getApprovalById(approvalId);
      if (approval?.payload.operationType === 'AddCredential') {
        const credential = await p.writes.transaction(actor, (tx) => tx.getCredentialByCreatingApproval(approvalId));
        if (credential) return { approval, person: null, credential, journey: null, participant: null, agreement: null, idempotent: true };
      } else if (approval?.payload.operationType === 'AddAgreement') {
        // Concurrent duplicate execute created the agreement -> idempotent.
        // No created row means the 23505 was the agreement-CODE unique index
        // (a genuine conflict): fall through to truthful ExecutionFailed.
        const agreement = await p.writes.transaction(actor, (tx) => tx.getAgreementByCreatingApproval(approvalId));
        if (agreement) return { approval, person: null, credential: null, journey: null, participant: null, agreement, idempotent: true };
      } else if (approval?.payload.operationType === 'AddMissionParticipant') {
        // A unique-violation on the pair row means ANOTHER approval activated
        // this membership concurrently — that is a genuine conflict for THIS
        // approval (never idempotent success): fall through to the truthful
        // ExecutionFailed recording below.
      } else {
        const person = await p.writes.transaction(actor, (tx) => tx.getPersonByCreatingApproval(approvalId));
        if (approval && person) return { approval, person, credential: null, journey: null, participant: null, agreement: null, idempotent: true };
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
