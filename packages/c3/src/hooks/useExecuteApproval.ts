/**
 * useExecuteApproval.ts
 *
 * TanStack Query mutation hook for executing an approved C3 governance approval.
 *
 * Sprint 18 Phase 4A: InitiateJourney execution path.
 * Sprint 20 Phase 3:  AddCredential dispatch branch added.
 *
 * Dispatch is by operationType extracted from the approval payload.
 * Each branch has its own validation and execution sequence.
 *
 * ── InitiateJourney execution sequence (ADR-013, unchanged) ──────────────────
 *   1. Guard: approvalStatus must be 'Approved'.
 *   2. Parse payload, validate InitiateJourney fields.
 *   3. Duplicate check: getActiveJourney(personId, 'Onboarding').
 *      Duplicate → stamp ExecutionFailed + throw DuplicateJourneyError.
 *   4. Create journey: journeyService.initiateJourney(input).
 *      Failure → stamp ExecutionFailed + throw.
 *   5. Stamp approval Executed.
 *      Failure → LOG + throw PartialExecutionError (journey valid, stamp failed).
 *   6. Invalidate approvals.all(), journey.list(personId), journey.allActive('Onboarding').
 *
 * ── AddCredential execution sequence (Sprint 20 Phase 3) ─────────────────────
 *   1. Guard: approvalStatus must be 'Approved' (same guard, shared).
 *   2. Parse payload, validate AddCredential fields (holderPersonId, credentialType, referenceNumber).
 *      CredentialType validated against VALID_CREDENTIAL_TYPES from spCredentialMapper.
 *   3. No duplicate guard — multiple credentials of the same type are valid per person.
 *   4. Create credential: credentialService.addCredential(input).
 *      Failure → stamp ExecutionFailed + throw.
 *   5. Stamp approval Executed.
 *      Failure → LOG + throw PartialCredentialExecutionError (credential valid, stamp failed).
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
 * Exported error classes:
 *   - DuplicateJourneyError:              active journey already exists for the target person.
 *   - PayloadValidationError:             approval payload is invalid or malformed.
 *   - PartialExecutionError:              journey created but approval stamp failed.
 *   - PartialCredentialExecutionError:    credential created but approval stamp failed.
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApp } from './useApp';
import { useApprovalsService } from './useApprovalsService';
import { useJourneyService } from './useJourneyService';
import { useCredentialService } from './useCredentialService';
import { VALID_CREDENTIAL_TYPES } from '@c3/utils/spCredentialMapper';
import type { C3Approval } from '@c3/utils/spApprovalMapper';
import type { CredentialType, CreateCredentialInput } from '@c3/types';
import type {
  InitiateJourneyApprovalPayload,
  AddCredentialApprovalPayload,
} from '@c3/services/interfaces/approvalPayloads';

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

// ---------------------------------------------------------------------------
// Payload parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the raw Payload JSON string to a plain object.
 * Throws PayloadValidationError (pre-write) if the JSON is invalid or not an object.
 */
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
  const queryClient        = useQueryClient();

  return useMutation({
    mutationFn: async (approval: C3Approval): Promise<void> => {

      // ── Step 1: Approved guard ─────────────────────────────────────────────
      // Must be first — before payload parsing, duplicate check, and any write.
      if (approval.approvalStatus !== 'Approved') {
        throw new Error(
          `[C3/Execution] Only approved approvals can be executed. ` +
          `Current status: ${approval.approvalStatus}.`,
        );
      }

      // ── Step 2: Parse payload and dispatch by operationType ────────────────
      const payloadObj = parseRawPayload(approval.payload);
      const opType = payloadObj['operationType'];

      // ── InitiateJourney branch (unchanged from Sprint 18 Phase 4A) ─────────
      if (opType === 'InitiateJourney') {
        const payload = validateInitiateJourneyPayload(payloadObj);
        const personId = payload.personId;

        // Step 3: Duplicate check
        const existingJourney = await journeyService.getActiveJourney(personId, 'Onboarding');
        if (existingJourney) {
          const duplicateMsg =
            `Duplicate: an active Onboarding journey (${existingJourney.JourneyID}) ` +
            `already exists for ${personId}. Execution blocked.`;
          await approvalsService.stampExecution(approval.id, {
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
            await approvalsService.stampExecution(approval.id, {
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
          await approvalsService.stampExecution(approval.id, {
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

      // ── AddCredential branch (Sprint 20 Phase 3) ───────────────────────────
      if (opType === 'AddCredential') {
        const payload = validateAddCredentialPayload(payloadObj);
        const holderPersonId = payload.holderPersonId;

        // Step 3: No duplicate guard — multiple credentials of the same type
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
            await approvalsService.stampExecution(approval.id, {
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
          await approvalsService.stampExecution(approval.id, {
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

      // ── Unknown operationType ──────────────────────────────────────────────
      throw new PayloadValidationError(
        `Unknown operationType: '${String(opType)}'. ` +
        `Supported: 'InitiateJourney', 'AddCredential'.`,
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
        }
      } catch {
        // Ignore parse failures — approvals.all() invalidation above is sufficient
      }
    },

    onError: (_, approval) => {
      // Always re-fetch approvals on error so status changes (ExecutionFailed) are visible
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      try {
        const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
        const opType = p['operationType'];

        if (opType === 'InitiateJourney') {
          // Duplicate check may have found an existing journey — refresh journey state
          const personId = typeof p['personId'] === 'string' ? p['personId'] : undefined;
          if (personId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
          }
        } else if (opType === 'AddCredential') {
          const holderPersonId = typeof p['holderPersonId'] === 'string' ? p['holderPersonId'] : undefined;
          if (holderPersonId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.person.credentials(holderPersonId) });
          }
        }
      } catch {
        // ignore
      }
    },
  });
};
