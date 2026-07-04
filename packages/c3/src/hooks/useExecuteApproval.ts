/**
 * useExecuteApproval.ts
 *
 * TanStack Query mutation hook for executing an approved C3 governance approval.
 *
 * Sprint 18 Phase 4A: InitiateJourney execution path.
 * Sprint 20 Phase 3:  AddCredential dispatch branch added.
 * Sprint 23 Phase 1:  DeactivateCredential dispatch branch added.
 * Sprint 25:          AddPerson dispatch branch added.
 * Sprint 25 (polish): AddPerson Step 5 passes targetPersonId: createdPersonId to
 *                     stampExecution -- backfills C3Approvals.TargetPersonID from
 *                     'PENDING-ADDPERSON' to the created PER-XXXX in the same MERGE.
 *
 * Dispatch is by operationType extracted from the approval payload.
 * Each branch has its own validation and execution sequence.
 *
 * -- InitiateJourney execution sequence (ADR-013, unchanged) --
 *   1. Guard: approvalStatus must be 'Approved'.
 *   2. Parse payload, validate InitiateJourney fields.
 *   3. Duplicate check: getActiveJourney(personId, 'Onboarding').
 *      Duplicate -> stamp ExecutionFailed + throw DuplicateJourneyError.
 *   4. Create journey: journeyService.initiateJourney(input).
 *      Failure -> stamp ExecutionFailed + throw.
 *   5. Stamp approval Executed.
 *      Failure -> LOG + throw PartialExecutionError (journey valid, stamp failed).
 *   6. Invalidate approvals.all(), journey.list(personId), journey.allActive('Onboarding').
 *
 * -- AddCredential execution sequence (Sprint 20 Phase 3) --
 *   1. Guard: approvalStatus must be 'Approved' (same guard, shared).
 *   2. Parse payload, validate AddCredential fields (holderPersonId, credentialType, referenceNumber).
 *      CredentialType validated against VALID_CREDENTIAL_TYPES from spCredentialMapper.
 *   3. No duplicate guard - multiple credentials of the same type are valid per person.
 *   4. Create credential: credentialService.addCredential(input).
 *      Failure -> stamp ExecutionFailed + throw.
 *   5. Stamp approval Executed.
 *      Failure -> LOG + throw PartialCredentialExecutionError (credential valid, stamp failed).
 *   6. Invalidate approvals.all(), person.credentials(holderPersonId), credentials.all().
 *
 * Critical boundaries:
 *   - Only Approved approvals can be executed. Any other status throws before step 2.
 *   - No C3Credentials row is created for Submitted, InReview, Rejected, Executed,
 *     or ExecutionFailed approvals.
 *   - ExecutionFailed does NOT stamp ExecutedAt (enforced by StampExecutionRequest discriminant).
 *   - Does not modify Contracts, Missions, or Finance.
 *   - Does not change journey lifecycle behavior.
 *
 * -- DeactivateCredential execution sequence (Sprint 23 Phase 1) --
 *   1. Guard: approvalStatus must be 'Approved'.
 *   2. Parse payload, validate required fields (credentialId, holderPersonId,
 *      credentialType, referenceNumber, reason).
 *   3. Get target credential via credentialService.getCredential(credentialId).
 *      Not found  -> throw PayloadValidationError (pre-write, no stamp).
 *      IsActive = false -> throw CredentialAlreadyInactiveError (do NOT stamp
 *                          ExecutionFailed; operator should use stamp recovery).
 *      IsActive = true  -> proceed.
 *   4. Deactivate: credentialService.deactivateCredential(credentialId).
 *      Failure -> stamp ExecutionFailed + throw.
 *   5. Stamp approval Executed.
 *      Failure -> LOG + throw PartialDeactivationExecutionError.
 *   6. Invalidate approvals.all(), person.credentials(holderPersonId), credentials.all().
 *
 * Exported error classes:
 *   - DuplicateJourneyError:              active journey already exists for the target person.
 *   - PayloadValidationError:             approval payload is invalid or malformed.
 *   - PartialExecutionError:              journey created but approval stamp failed.
 *   - PartialCredentialExecutionError:    credential created but approval stamp failed.
 *   - CredentialAlreadyInactiveError:     target credential is already IsActive = false.
 *   - PartialDeactivationExecutionError:  credential deactivated but approval stamp failed.
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApp } from './useApp';
import { usePersonService } from './usePersonService';
import { useApprovalsService } from './useApprovalsService';
import { useJourneyService } from './useJourneyService';
import { useCredentialService } from './useCredentialService';
import { VALID_CREDENTIAL_TYPES } from '@c3/utils/spCredentialMapper';
import type { C3Approval } from '@c3/utils/spApprovalMapper';
import type { CredentialType, CreateCredentialInput, CreatePersonInput } from '@c3/types';
import type {
  InitiateJourneyApprovalPayload,
  AddCredentialApprovalPayload,
  AddMissionParticipantApprovalPayload,
  RemoveMissionParticipantApprovalPayload,
} from '@c3/services/interfaces/approvalPayloads';
import { useMissionService } from './useMissionService';
import {
  validateAddParticipantPayload,
  validateRemoveParticipantPayload,
} from '@c3/utils/participantWrites';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the target person already has an active Onboarding journey.
 * The duplicate check fires before any write. Approval is stamped ExecutionFailed.
 */
export class DuplicateJourneyError extends Error {
  override readonly name = 'DuplicateJourneyError';
  constructor(personId: string) {
    super(
      `[C3/Execution] Duplicate: an active Onboarding journey already exists for ${personId}. ` +
      `Approval stamped ExecutionFailed.`,
    );
  }
}

/**
 * Thrown when the approval payload is invalid or cannot be parsed.
 * No write occurs. Approval status is unchanged (remains Approved).
 */
export class PayloadValidationError extends Error {
  override readonly name = 'PayloadValidationError';
  constructor(message: string) {
    super(`[C3/Execution] Payload validation failed: ${message}`);
  }
}

/**
 * Thrown when the journey was created successfully but the C3Approvals stamp
 * to Executed failed. The journey row exists and is valid. The approval record
 * remains in Approved status. Operator must manually resolve via SharePoint.
 */
export class PartialExecutionError extends Error {
  override readonly name = 'PartialExecutionError';
  constructor(journeyId: string, approvalId: number, cause: unknown) {
    super(
      `[C3/Execution] Journey ${journeyId} was created for approval ${approvalId}, ` +
      `but stamping Executed on the approval record failed. ` +
      `The journey is valid. Manually update C3Approvals ID ${approvalId} to Executed. ` +
      `Stamp error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Thrown when the credential was created successfully but the C3Approvals stamp
 * to Executed failed. The credential row exists and is valid. The approval record
 * remains in Approved status. Operator must manually resolve via SharePoint.
 *
 * Sprint 20 Phase 3.
 */
export class PartialCredentialExecutionError extends Error {
  override readonly name = 'PartialCredentialExecutionError';
  constructor(credentialId: string, approvalId: number, cause: unknown) {
    super(
      `[C3/Execution] Credential ${credentialId} was created for approval ${approvalId}, ` +
      `but stamping Executed on the approval record failed. ` +
      `The credential is valid. Manually update C3Approvals ID ${approvalId} to Executed. ` +
      `Stamp error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Thrown when a DeactivateCredential approval is executed but the target
 * credential is already IsActive = false. Hard block -- do NOT stamp
 * ExecutionFailed (the credential state IS the desired outcome).
 * The approval record remains Approved. Use useRecoverDeactivationExecutionStamp
 * to stamp it Executed without re-applying the deactivation.
 *
 * Sprint 23 Phase 1.
 */
export class CredentialAlreadyInactiveError extends Error {
  override readonly name = 'CredentialAlreadyInactiveError';
  constructor(credentialId: string) {
    super(
      `[C3/Execution] Credential ${credentialId} is already IsActive = false. ` +
      `Use Recover Execution Stamp to stamp the approval as Executed.`,
    );
  }
}

/**
 * Thrown when the credential was deactivated (IsActive = false MERGE succeeded)
 * but the C3Approvals stamp to Executed failed. The credential is inactive and
 * valid. The approval record remains in Approved status.
 * Operator must manually resolve via SharePoint or use stamp recovery.
 *
 * Sprint 23 Phase 1.
 */
export class PartialDeactivationExecutionError extends Error {
  override readonly name = 'PartialDeactivationExecutionError';
  constructor(credentialId: string, approvalId: number, cause: unknown) {
    super(
      `[C3/Execution] Credential ${credentialId} was deactivated for approval ${approvalId}, ` +
      `but stamping Executed on the approval record failed. ` +
      `The credential is inactive. Manually update C3Approvals ID ${approvalId} to Executed. ` +
      `Stamp error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Thrown when the person was created successfully (PER-XXXX assigned) but
 * the C3Approvals stamp to Executed failed. The C3People row exists and is
 * valid with a canonical PersonID. The approval record remains in Approved status.
 * Operator must manually update C3Approvals ID {approvalId} to Executed.
 *
 * Sprint 25.
 */
export class PartialAddPersonExecutionError extends Error {
  override readonly name = 'PartialAddPersonExecutionError';
  constructor(personId: string, approvalId: number, cause: unknown) {
    super(
      `[C3/Execution] Person ${personId} was created for approval ${approvalId}, ` +
      `but stamping Executed on the approval record failed. ` +
      `The person is valid. Manually update C3Approvals ID ${approvalId} to Executed. ` +
      `Stamp error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Payload parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the raw Payload JSON string to a plain object.
 * Throws PayloadValidationError (pre-write) if the JSON is invalid or not an object.
 */
/**
 * Thrown when the participant add write applied (created/reactivated/
 * already-applied) but the C3Approvals stamp to Executed failed. The
 * participant state is correct. Recovery: re-execute the approval — the
 * idempotent contract detects the already-applied state and repairs only
 * the stamp; no duplicate participant row is created. Sprint 29B.
 */
export class PartialParticipantAddExecutionError extends Error {
  override readonly name = 'PartialParticipantAddExecutionError';
  constructor(missionId: string, personId: string, approvalId: number, cause: unknown) {
    super(
      `[C3/Execution] PARTIAL: ${personId} was added to ${missionId} but approval ${approvalId} ` +
      `could not be stamped Executed. Re-execute the approval to repair the stamp — the ` +
      `participant write is idempotent and will not duplicate. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Thrown when the participant removal applied (IsActive=false / already
 * inactive) but the approval stamp failed. Recovery: re-execute — the
 * already-inactive detection repairs only the stamp. Sprint 29B.
 */
export class PartialParticipantRemovalExecutionError extends Error {
  override readonly name = 'PartialParticipantRemovalExecutionError';
  constructor(missionId: string, personId: string, approvalId: number, cause: unknown) {
    super(
      `[C3/Execution] PARTIAL: ${personId} was removed from ${missionId} but approval ${approvalId} ` +
      `could not be stamped Executed. Re-execute the approval to repair the stamp — removal is ` +
      `idempotent. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function parseRawPayload(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    throw new PayloadValidationError('Payload column is empty or missing.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PayloadValidationError('Payload column is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PayloadValidationError('Payload must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

/**
 * Validate and cast a raw payload object as AddMissionParticipantApprovalPayload.
 * Delegates the field rules to the shared pure module (participantWrites) so
 * submission, execution, services, and parity all enforce identical rules.
 */
function validateAddMissionParticipantPayload(
  obj: Record<string, unknown>,
): AddMissionParticipantApprovalPayload {
  const errors = validateAddParticipantPayload({
    missionId:    typeof obj['missionId'] === 'string' ? obj['missionId'] : '',
    personId:     typeof obj['personId'] === 'string' ? obj['personId'] : '',
    externalCode: typeof obj['externalCode'] === 'string' ? obj['externalCode'] : '',
    role:         typeof obj['role'] === 'string' ? obj['role'] : '',
    perDiemRate:  typeof obj['perDiemRate'] === 'number' ? obj['perDiemRate']
                  : obj['perDiemRate'] === undefined || obj['perDiemRate'] === null ? undefined
                  : Number.NaN,
  });
  if (errors.length > 0) throw new PayloadValidationError(errors.join(' '));
  return obj as unknown as AddMissionParticipantApprovalPayload;
}

/**
 * Validate and cast a raw payload object as RemoveMissionParticipantApprovalPayload.
 */
function validateRemoveMissionParticipantPayload(
  obj: Record<string, unknown>,
): RemoveMissionParticipantApprovalPayload {
  const errors = validateRemoveParticipantPayload({
    missionId: typeof obj['missionId'] === 'string' ? obj['missionId'] : '',
    personId:  typeof obj['personId'] === 'string' ? obj['personId'] : '',
    reason:    typeof obj['reason'] === 'string' ? obj['reason'] : '',
  });
  if (errors.length > 0) throw new PayloadValidationError(errors.join(' '));
  return obj as unknown as RemoveMissionParticipantApprovalPayload;
}

/**
 * Validate and cast a raw payload object as InitiateJourneyApprovalPayload.
 * Throws PayloadValidationError if required fields are missing or wrong.
 */
function validateInitiateJourneyPayload(obj: Record<string, unknown>): InitiateJourneyApprovalPayload {
  if (typeof obj['personId'] !== 'string' || !obj['personId'].trim()) {
    throw new PayloadValidationError('Payload.personId is missing or blank.');
  }
  if (obj['journeyType'] !== 'Onboarding') {
    throw new PayloadValidationError(
      `journeyType must be 'Onboarding', got: ${String(obj['journeyType'])}.`,
    );
  }
  return obj as unknown as InitiateJourneyApprovalPayload;
}

/**
 * Validate and cast a raw payload object as AddCredentialApprovalPayload.
 * Throws PayloadValidationError if required fields are missing, blank, or invalid.
 */
function validateAddCredentialPayload(obj: Record<string, unknown>): AddCredentialApprovalPayload {
  if (typeof obj['holderPersonId'] !== 'string' || !obj['holderPersonId'].trim()) {
    throw new PayloadValidationError('Payload.holderPersonId is missing or blank.');
  }
  if (typeof obj['credentialType'] !== 'string' || !obj['credentialType'].trim()) {
    throw new PayloadValidationError('Payload.credentialType is missing or blank.');
  }
  if (!VALID_CREDENTIAL_TYPES.has(obj['credentialType'] as string)) {
    throw new PayloadValidationError(
      `credentialType '${String(obj['credentialType'])}' is not a recognized CredentialType value.`,
    );
  }
  if (typeof obj['referenceNumber'] !== 'string' || !obj['referenceNumber'].trim()) {
    throw new PayloadValidationError('Payload.referenceNumber is missing or blank.');
  }
  return obj as unknown as AddCredentialApprovalPayload;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useExecuteApproval = () => {
  const { currentUser }    = useApp();
  const approvalsService   = useApprovalsService();
  const journeyService     = useJourneyService();
  const credentialService  = useCredentialService();
  const personService      = usePersonService();
  const missionService     = useMissionService();
  const queryClient        = useQueryClient();

  return useMutation({
    mutationFn: async (card: C3Approval): Promise<void> => {

      // -- Step 0: Freshness read (S31 — Approval Query Integrity) --
      // The cached card is a UI snapshot; execution safety depends on CURRENT
      // status. Read the row fresh by its retained SP numeric Id; the fresh
      // row drives the guard, and its ETag preconditions every stamp below
      // (a mid-execution change 412s into the partial-execution recovery
      // path). This prevents stale sequential actions; it is NOT an atomic
      // execution lock (residual two-session race recorded as TD-29).
      const fresh = await approvalsService.getApproval(card.id);
      if (!fresh) {
        throw new Error(
          `[C3/Execution] Approval ${card.title} (ID ${card.id}) was not found in C3Approvals. ` +
          `It may have been removed — refresh the inbox before retrying.`,
        );
      }
      const approval = fresh.approval;
      const freshEtag = fresh.etag ?? undefined;
      const stamp = (req: Parameters<typeof approvalsService.stampExecution>[1]) =>
        approvalsService.stampExecution(approval.id, req, freshEtag);

      // -- Step 1: Approved guard (against the FRESH row, never the card) --
      // Must be first -- before payload parsing, duplicate check, and any write.
      if (approval.approvalStatus !== 'Approved') {
        throw new Error(
          `[C3/Execution] Only approved approvals can be executed. ` +
          `Current status: ${approval.approvalStatus}.`,
        );
      }

      // -- Step 2: Parse payload and dispatch by operationType --
      const payloadObj = parseRawPayload(approval.payload);
      const opType = payloadObj['operationType'];

      // -- InitiateJourney branch (unchanged from Sprint 18 Phase 4A) --
      if (opType === 'InitiateJourney') {
        const payload = validateInitiateJourneyPayload(payloadObj);
        const personId = payload.personId;

        // Step 3: Duplicate check
        const existingJourney = await journeyService.getActiveJourney(personId, 'Onboarding');
        if (existingJourney) {
          const duplicateMsg =
            `Duplicate: an active Onboarding journey (${existingJourney.JourneyID}) ` +
            `already exists for ${personId}. Execution blocked.`;
          await stamp({
            newStatus:      'ExecutionFailed',
            executionError: duplicateMsg.slice(0, 250),
          });
          throw new DuplicateJourneyError(personId);
        }

        // Step 4: Create journey
        let journeyId: string;
        try {
          const journey = await journeyService.initiateJourney({
            PersonID:         personId,
            Type:             'Onboarding',
            InitiatedBy:      payload.initiatedBy ?? currentUser.loginName,
            AssignedTo:       payload.assignedTo,
            InitiationReason: payload.initiationReason,
            Notes:            payload.notes,
            MissionID:        payload.missionId,
            obligationAssignments:
              payload.obligationAssignments?.length > 0
                ? payload.obligationAssignments
                : undefined,
          });
          journeyId = journey.JourneyID;
        } catch (journeyErr) {
          const errMsg = journeyErr instanceof Error ? journeyErr.message : String(journeyErr);
          try {
            await stamp({
              newStatus:      'ExecutionFailed',
              executionError: errMsg.slice(0, 250),
            });
          } catch (stampErr) {
            console.error(
              '[C3/Execution] Failed to stamp ExecutionFailed after journey creation error:',
              stampErr,
            );
          }
          throw journeyErr;
        }

        // Step 5: Stamp approval as Executed
        const executedAt = new Date().toISOString();
        try {
          await stamp({
            newStatus: 'Executed',
            executedAt,
          });
        } catch (stampErr) {
          console.error(
            '[C3/Execution] PARTIAL FAILURE: journey was created but approval stamp failed.',
            `JourneyID: ${journeyId} | ApprovalID: ${approval.id}`,
            stampErr,
          );
          throw new PartialExecutionError(journeyId, approval.id, stampErr);
        }

        console.info(
          `[C3/Execution] Approval ${approval.title} executed. ` +
          `Journey ${journeyId} created for ${personId}. ExecutedAt: ${executedAt}`,
        );
        return;
      }

      // -- AddCredential branch (Sprint 20 Phase 3) --
      if (opType === 'AddCredential') {
        const payload = validateAddCredentialPayload(payloadObj);
        const holderPersonId = payload.holderPersonId;

        // Step 3: No duplicate guard -- multiple credentials of the same type
        // are valid for a person (unlike journeys which have a one-active rule).

        // Step 4: Create credential
        const credInput: CreateCredentialInput = {
          HolderPersonID:         holderPersonId,
          Type:                   payload.credentialType as CredentialType,
          ReferenceNumber:        payload.referenceNumber,
          IssuedBy:               payload.issuedBy,
          IssuedDate:             payload.issuedDate,
          ExpiryDate:             payload.expiryDate,
          ValidFromDate:          payload.validFromDate,
          SubType:                payload.subType,
          Notes:                  payload.notes,
          SupersedesCredentialID: payload.supersedesCredentialId,
        };

        let credentialId: string;
        try {
          const credential = await credentialService.addCredential(credInput);
          credentialId = credential.CredentialID;
        } catch (credErr) {
          const errMsg = credErr instanceof Error ? credErr.message : String(credErr);
          try {
            await stamp({
              newStatus:      'ExecutionFailed',
              executionError: errMsg.slice(0, 250),
            });
          } catch (stampErr) {
            console.error(
              '[C3/Execution] Failed to stamp ExecutionFailed after credential creation error:',
              stampErr,
            );
          }
          throw credErr;
        }

        // Step 5: Stamp approval as Executed
        const executedAt = new Date().toISOString();
        try {
          await stamp({
            newStatus: 'Executed',
            executedAt,
          });
        } catch (stampErr) {
          console.error(
            '[C3/Execution] PARTIAL FAILURE: credential was created but approval stamp failed.',
            `CredentialID: ${credentialId} | ApprovalID: ${approval.id}`,
            stampErr,
          );
          throw new PartialCredentialExecutionError(credentialId, approval.id, stampErr);
        }

        console.info(
          `[C3/Execution] Approval ${approval.title} executed. ` +
          `Credential ${credentialId} (${payload.credentialType}) created for ${holderPersonId}. ` +
          `ExecutedAt: ${executedAt}`,
        );
        return;
      }

      // -- DeactivateCredential branch (Sprint 23 Phase 1) --
      if (opType === 'DeactivateCredential') {
        // Step 2: Validate required payload fields.
        const credentialId = payloadObj['credentialId'];
        const holderPersonId = payloadObj['holderPersonId'];
        const credentialType = payloadObj['credentialType'];
        const referenceNumber = payloadObj['referenceNumber'];
        const reason = payloadObj['reason'];

        if (typeof credentialId   !== 'string' || !credentialId.trim())   throw new PayloadValidationError('Payload.credentialId is missing or blank.');
        if (typeof holderPersonId !== 'string' || !holderPersonId.trim()) throw new PayloadValidationError('Payload.holderPersonId is missing or blank.');
        if (typeof credentialType !== 'string' || !credentialType.trim()) throw new PayloadValidationError('Payload.credentialType is missing or blank.');
        if (typeof referenceNumber !== 'string' || !referenceNumber.trim()) throw new PayloadValidationError('Payload.referenceNumber is missing or blank.');
        if (typeof reason !== 'string' || !reason.trim()) throw new PayloadValidationError('Payload.reason is missing or blank.');

        const cid = credentialId.trim();
        const hpid = holderPersonId.trim();

        // Step 3: Get target credential (no IsActive filter -- finds inactive too).
        const target = await credentialService.getCredential(cid);
        if (target === null || target === undefined) {
          throw new PayloadValidationError(
            `Credential '${cid}' not found in C3Credentials. Cannot deactivate.`,
          );
        }

        // Already inactive: block execution without stamping ExecutionFailed.
        // The credential IS in the desired state. Use stamp recovery instead.
        if (!target.IsActive) {
          throw new CredentialAlreadyInactiveError(cid);
        }

        // Step 4: Deactivate the credential (MERGE IsActive = false).
        try {
          await credentialService.deactivateCredential(cid);
        } catch (deactivateErr) {
          const errMsg = deactivateErr instanceof Error ? deactivateErr.message : String(deactivateErr);
          try {
            await stamp({
              newStatus:      'ExecutionFailed',
              executionError: errMsg.slice(0, 250),
            });
          } catch (stampErr) {
            console.error(
              '[C3/Execution] Failed to stamp ExecutionFailed after deactivateCredential error:',
              stampErr,
            );
          }
          throw deactivateErr;
        }

        // Step 5: Stamp approval Executed.
        const executedAt = new Date().toISOString();
        try {
          await stamp({
            newStatus: 'Executed',
            executedAt,
          });
        } catch (stampErr) {
          console.error(
            '[C3/Execution] PARTIAL FAILURE: credential was deactivated but approval stamp failed.',
            `CredentialID: ${cid} | ApprovalID: ${approval.id}`,
            stampErr,
          );
          throw new PartialDeactivationExecutionError(cid, approval.id, stampErr);
        }

        console.info(
          `[C3/Execution] Approval ${approval.title} executed. ` +
          `Credential ${cid} (${String(credentialType)}) deactivated for ${hpid}. ` +
          `ExecutedAt: ${executedAt}`,
        );
        return;
      }

      // -- AddPerson branch (Sprint 25) --
      if (opType === 'AddPerson') {
        // Step 2: Validate fullName (required).
        const fullName = payloadObj['fullName'];
        if (typeof fullName !== 'string' || !fullName.trim()) {
          throw new PayloadValidationError('Payload.fullName is missing or blank.');
        }

        const trimmedName = fullName.trim();

        // Step 3: FullName duplicate check against the cached People list.
        // Client-side only -- guards against the obvious case. See TD-24 for
        // server-side uniqueness enforcement (requires Email column in C3People).
        const existingPeople =
          queryClient.getQueryData<import('@c3/types').Person[]>(queryKeys.people.all()) ?? [];
        const duplicate = existingPeople.find(
          p => p.FullName.trim().toLowerCase() === trimmedName.toLowerCase(),
        );
        if (duplicate) {
          const dupMsg =
            `A person with the same full name already exists: "${duplicate.FullName}" ` +
            `(${duplicate.PersonID}). Execution blocked to prevent duplicate person records.`;
          await stamp({
            newStatus:      'ExecutionFailed',
            executionError: dupMsg.slice(0, 250),
          });
          throw new PayloadValidationError(dupMsg);
        }

        // Step 4: Create person via POST-then-MERGE PER-XXXX.
        const personInput: CreatePersonInput = {
          FullName:          trimmedName,
          IGN:               typeof payloadObj['ign']               === 'string' && (payloadObj['ign'] as string).trim()               ? (payloadObj['ign'] as string).trim()               : undefined,
          Nationality:       typeof payloadObj['nationality']       === 'string' && (payloadObj['nationality'] as string).trim()       ? (payloadObj['nationality'] as string).trim()       : undefined,
          PrimaryRole:       typeof payloadObj['primaryRole']       === 'string' && (payloadObj['primaryRole'] as string).trim()       ? (payloadObj['primaryRole'] as string).trim()       : undefined,
          PersonnelCode:     typeof payloadObj['personnelCode']     === 'string' && (payloadObj['personnelCode'] as string).trim()     ? (payloadObj['personnelCode'] as string).trim()     : undefined,
          CurrentTeam:       typeof payloadObj['currentTeam']       === 'string' && (payloadObj['currentTeam'] as string).trim()       ? (payloadObj['currentTeam'] as string).trim()       : undefined,
          CurrentGameTitle:  typeof payloadObj['currentGameTitle']  === 'string' && (payloadObj['currentGameTitle'] as string).trim()  ? (payloadObj['currentGameTitle'] as string).trim()  : undefined,
          PrimaryDepartment: typeof payloadObj['primaryDepartment'] === 'string' && (payloadObj['primaryDepartment'] as string).trim() ? (payloadObj['primaryDepartment'] as string).trim() : undefined,
          Notes:             typeof payloadObj['notes']             === 'string' && (payloadObj['notes'] as string).trim()             ? (payloadObj['notes'] as string).trim()             : undefined,
        };

        let createdPersonId: string;
        try {
          const person = await personService.createPerson(personInput);
          createdPersonId = person.PersonID;
        } catch (createErr) {
          const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
          try {
            await stamp({
              newStatus:      'ExecutionFailed',
              executionError: errMsg.slice(0, 250),
            });
          } catch (stampErr) {
            console.error(
              '[C3/Execution] Failed to stamp ExecutionFailed after createPerson error:',
              stampErr,
            );
          }
          throw createErr;
        }

        // Step 5: Stamp approval Executed.
        // Also backfill TargetPersonID: the approval was submitted with the
        // 'PENDING-ADDPERSON' placeholder because no PER-XXXX existed at
        // submission time. The same MERGE updates it to the created PersonID.
        const executedAt = new Date().toISOString();
        try {
          await stamp({
            newStatus:      'Executed',
            executedAt,
            targetPersonId: createdPersonId,  // backfill PENDING-ADDPERSON -> PER-XXXX
          });
        } catch (stampErr) {
          console.error(
            '[C3/Execution] PARTIAL FAILURE: person was created but approval stamp failed.',
            `PersonID: ${createdPersonId} | ApprovalID: ${approval.id}`,
            stampErr,
          );
          throw new PartialAddPersonExecutionError(createdPersonId, approval.id, stampErr);
        }

        console.info(
          `[C3/Execution] Approval ${approval.title} executed. ` +
          `Person ${createdPersonId} ("${trimmedName}") created. ExecutedAt: ${executedAt}`,
        );
        return;
      }

      // -- AddMissionParticipant branch (Sprint 29B, full ADR-013) --
      if (opType === 'AddMissionParticipant') {
        const payload = validateAddMissionParticipantPayload(payloadObj);

        // Steps 2-4: the service implements the authoritative idempotent
        // contract (mission/person state, duplicate/conflict, reactivation,
        // already-applied detection). Pre-write failures (conflict,
        // data-integrity) stamp ExecutionFailed with a clear message.
        let outcome: string;
        try {
          const result = await missionService.addMissionParticipant({
            MissionID:      payload.missionId,
            PersonID:       payload.personId,
            ExternalCode:   payload.externalCode,
            Role:           payload.role,
            PerDiemRate:    payload.perDiemRate,
            actorLoginName: currentUser.loginName,
          });
          outcome = result.outcome;
        } catch (writeErr) {
          const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
          try {
            await stamp({
              newStatus:      'ExecutionFailed',
              executionError: errMsg.slice(0, 250),
            });
          } catch (stampErr) {
            console.error('[C3/Execution] Failed to stamp ExecutionFailed after participant add error:', stampErr);
          }
          throw writeErr;
        }

        // Step 5: stamp Executed. 'already-applied' reaching this point IS the
        // stamp-recovery path — re-executing after a partial failure repairs
        // only the approval record; no duplicate participant row is created.
        const executedAt = new Date().toISOString();
        try {
          await stamp({ newStatus: 'Executed', executedAt });
        } catch (stampErr) {
          console.error(
            '[C3/Execution] PARTIAL FAILURE: participant write applied but approval stamp failed.',
            `Mission: ${payload.missionId} | Person: ${payload.personId} | ApprovalID: ${approval.id}`,
            stampErr,
          );
          throw new PartialParticipantAddExecutionError(payload.missionId, payload.personId, approval.id, stampErr);
        }

        console.info(
          `[C3/Execution] Approval ${approval.title} executed (${outcome}). ` +
          `${payload.personId} added to ${payload.missionId} as ${payload.role}. ExecutedAt: ${executedAt}`,
        );
        return;
      }

      // -- RemoveMissionParticipant branch (Sprint 29B, full ADR-013) --
      if (opType === 'RemoveMissionParticipant') {
        const payload = validateRemoveMissionParticipantPayload(payloadObj);

        let outcome: string;
        try {
          const result = await missionService.removeMissionParticipant({
            MissionID:      payload.missionId,
            PersonID:       payload.personId,
            reason:         payload.reason,
            actorLoginName: currentUser.loginName,
          });
          outcome = result.outcome;
        } catch (writeErr) {
          const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
          try {
            await stamp({
              newStatus:      'ExecutionFailed',
              executionError: errMsg.slice(0, 250),
            });
          } catch (stampErr) {
            console.error('[C3/Execution] Failed to stamp ExecutionFailed after participant removal error:', stampErr);
          }
          throw writeErr;
        }

        // 'already-inactive' reaching the stamp IS the recovery path.
        const executedAt = new Date().toISOString();
        try {
          await stamp({ newStatus: 'Executed', executedAt });
        } catch (stampErr) {
          console.error(
            '[C3/Execution] PARTIAL FAILURE: participant removal applied but approval stamp failed.',
            `Mission: ${payload.missionId} | Person: ${payload.personId} | ApprovalID: ${approval.id}`,
            stampErr,
          );
          throw new PartialParticipantRemovalExecutionError(payload.missionId, payload.personId, approval.id, stampErr);
        }

        console.info(
          `[C3/Execution] Approval ${approval.title} executed (${outcome}). ` +
          `${payload.personId} removed from ${payload.missionId}. ExecutedAt: ${executedAt}`,
        );
        return;
      }

      // -- Unknown operationType --
      throw new PayloadValidationError(
        `Unknown operationType: '${String(opType)}'. ` +
        `Supported: 'InitiateJourney', 'AddCredential', 'DeactivateCredential', 'AddPerson', ` +
        `'AddMissionParticipant', 'RemoveMissionParticipant'.`,
      );
    },

    onSuccess: (_, approval) => {
      // Always refresh the approval inbox
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      try {
        const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
        const opType = p['operationType'];

        if (opType === 'InitiateJourney') {
          const personId = typeof p['personId'] === 'string' ? p['personId'] : undefined;
          if (personId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.journey.active(personId, 'Onboarding') });
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.journey.allActive('Onboarding') });
        } else if (opType === 'AddCredential') {
          const holderPersonId = typeof p['holderPersonId'] === 'string' ? p['holderPersonId'] : undefined;
          if (holderPersonId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.person.credentials(holderPersonId) });
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.credentials.all() });
        } else if (opType === 'DeactivateCredential') {
          const holderPersonId = typeof p['holderPersonId'] === 'string' ? p['holderPersonId'] : undefined;
          if (holderPersonId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.person.credentials(holderPersonId) });
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.credentials.all() });
        } else if (opType === 'AddPerson') {
          // Refresh people list so PeopleWorkspace shows the newly created person.
          void queryClient.invalidateQueries({ queryKey: queryKeys.people.all() });
        } else if (opType === 'AddMissionParticipant' || opType === 'RemoveMissionParticipant') {
          // S29B: BOTH participant caches (per-mission + batch) — SituationRoom
          // counts/gaps and Command Center work items consume these keys and
          // refresh without any screen modification.
          const missionId = typeof p['missionId'] === 'string' ? p['missionId'] : undefined;
          if (missionId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.mission.participants(missionId) });
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.mission.allParticipants() });
        }
      } catch {
        // Ignore parse failures -- approvals.all() invalidation above is sufficient
      }
    },

    onError: (_, approval) => {
      // Always re-fetch approvals on error so status changes (ExecutionFailed) are visible
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      try {
        const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
        const opType = p['operationType'];

        if (opType === 'InitiateJourney') {
          // Duplicate check may have found an existing journey -- refresh journey state
          const personId = typeof p['personId'] === 'string' ? p['personId'] : undefined;
          if (personId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
          }
        } else if (opType === 'AddCredential') {
          const holderPersonId = typeof p['holderPersonId'] === 'string' ? p['holderPersonId'] : undefined;
          if (holderPersonId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.person.credentials(holderPersonId) });
          }
        } else if (opType === 'DeactivateCredential') {
          // CredentialAlreadyInactiveError: credential may have been deactivated
          // externally -- refresh so PersonProfile reflects the true state.
          const holderPersonId = typeof p['holderPersonId'] === 'string' ? p['holderPersonId'] : undefined;
          if (holderPersonId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.person.credentials(holderPersonId) });
          }
        } else if (opType === 'AddPerson') {
          // Partial execution may have created the person -- refresh to show any partial state.
          void queryClient.invalidateQueries({ queryKey: queryKeys.people.all() });
        } else if (opType === 'AddMissionParticipant' || opType === 'RemoveMissionParticipant') {
          // Partial execution may have applied the participant write -- refresh both caches.
          const missionId = typeof p['missionId'] === 'string' ? p['missionId'] : undefined;
          if (missionId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.mission.participants(missionId) });
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.mission.allParticipants() });
        }
      } catch {
        // ignore
      }
    },
  });
};
