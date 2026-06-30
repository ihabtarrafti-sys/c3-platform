/**
 * useExecuteApproval.ts
 *
 * TanStack Query mutation hook for executing an approved C3 governance approval.
 *
 * Sprint 18 Phase 4A.
 *
 * Execution sequence (ADR-013):
 *   1. Guard: approval.approvalStatus must be 'Approved' -- throws before any write.
 *   2. Parse and validate payload (InitiateJourneyApprovalPayload).
 *   3. Duplicate check: journeyService.getActiveJourney(personId, 'Onboarding').
 *      If active journey exists -> stampExecution(ExecutionFailed, duplicate message).
 *   4. Create journey: journeyService.initiateJourney(input).
 *      If journey creation fails -> stampExecution(ExecutionFailed, error message).
 *   5. Stamp approval: approvalsService.stampExecution(Executed, executedAt).
 *      If stamp fails after journey was created -> LOG + throw PartialExecutionError.
 *      Do NOT attempt to mark ExecutionFailed -- the journey exists and is valid.
 *   6. Invalidate query keys: approvals.all(), journey.list(personId), journey.allActive('Onboarding').
 *
 * Critical boundaries:
 *   - Only Approved approvals can be executed. Any other status throws before step 2.
 *   - No C3Journeys row is created for Submitted, InReview, Rejected,
 *     Executed, or ExecutionFailed approvals.
 *   - ExecutionFailed does NOT stamp ExecutedAt (enforced by StampExecutionRequest discriminant).
 *   - Does not modify Credentials, Contracts, Missions, or Finance.
 *
 * Exported error classes:
 *   - DuplicateJourneyError: active journey already exists for the target person.
 *   - PayloadValidationError: approval payload is invalid or malformed.
 *   - PartialExecutionError: journey was created but approval stamp failed.
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApp } from './useApp';
import { useApprovalsService } from './useApprovalsService';
import { useJourneyService } from './useJourneyService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';
import type { InitiateJourneyApprovalPayload } from '@c3/services/interfaces/approvalPayloads';

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

// ---------------------------------------------------------------------------
// Payload parsing + validation
// ---------------------------------------------------------------------------

/**
 * Parse and validate the Payload column of a C3Approvals record.
 * Throws PayloadValidationError (pre-write) on any validation failure.
 */
function parseAndValidatePayload(raw: string | undefined): InitiateJourneyApprovalPayload {
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

  const obj = parsed as Record<string, unknown>;

  if (obj['operationType'] !== 'InitiateJourney') {
    throw new PayloadValidationError(
      `operationType must be 'InitiateJourney', got: ${String(obj['operationType'])}.`,
    );
  }

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useExecuteApproval = () => {
  const { currentUser }    = useApp();
  const approvalsService   = useApprovalsService();
  const journeyService     = useJourneyService();
  const queryClient        = useQueryClient();

  return useMutation({
    mutationFn: async (approval: C3Approval): Promise<void> => {

      // ── Step 1: Approved guard ─────────────────────────────────────────────
      // Must be first -- before payload parsing, duplicate check, and any write.
      if (approval.approvalStatus !== 'Approved') {
        throw new Error(
          `[C3/Execution] Only approved approvals can be executed. ` +
          `Current status: ${approval.approvalStatus}.`,
        );
      }

      // ── Step 2: Parse and validate payload ────────────────────────────────
      // Throws PayloadValidationError (pre-write) if invalid.
      // Approval remains Approved on validation failure.
      const payload = parseAndValidatePayload(approval.payload);
      const personId = payload.personId;

      // ── Step 3: Duplicate check ────────────────────────────────────────────
      const existingJourney = await journeyService.getActiveJourney(personId, 'Onboarding');
      if (existingJourney) {
        const duplicateMsg =
          `Duplicate: an active Onboarding journey (${existingJourney.JourneyID}) ` +
          `already exists for ${personId}. Execution blocked.`;
        // Stamp ExecutionFailed -- do NOT set ExecutedAt (discriminant enforces this).
        await approvalsService.stampExecution(approval.id, {
          newStatus:      'ExecutionFailed',
          executionError: duplicateMsg.slice(0, 250),
        });
        throw new DuplicateJourneyError(personId);
      }

      // ── Step 4: Create journey ─────────────────────────────────────────────
      // Journey service throws on any SP/network error.
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
        // Journey creation failed -- stamp ExecutionFailed (no ExecutedAt).
        const errMsg = journeyErr instanceof Error
          ? journeyErr.message
          : String(journeyErr);
        try {
          await approvalsService.stampExecution(approval.id, {
            newStatus:      'ExecutionFailed',
            executionError: errMsg.slice(0, 250),
          });
        } catch (stampErr) {
          // stampExecution also failed -- log but re-throw the original journey error.
          console.error(
            '[C3/Execution] Failed to stamp ExecutionFailed after journey creation error:',
            stampErr,
          );
        }
        throw journeyErr;
      }

      // ── Step 5: Stamp approval as Executed ────────────────────────────────
      // Journey is created. Stamp approval Executed.
      // If this stamp fails, do NOT attempt to stamp ExecutionFailed
      // (that would delete a valid journey from the audit trail).
      // Throw PartialExecutionError so the UI can surface a specific message.
      const executedAt = new Date().toISOString();
      try {
        await approvalsService.stampExecution(approval.id, {
          newStatus:  'Executed',
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
    },

    onSuccess: (_, approval) => {
      const personId = (() => {
        try {
          const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
          return typeof p['personId'] === 'string' ? p['personId'] : undefined;
        } catch {
          return undefined;
        }
      })();

      // Invalidate approvals inbox
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      // Invalidate journey queries so PersonProfile and Situation Room update
      if (personId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.journey.active(personId, 'Onboarding') });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.journey.allActive('Onboarding') });
    },

    onError: (_, approval) => {
      // Always re-fetch approvals on error so status changes (e.g. ExecutionFailed) are visible.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      // If we have a personId, also refresh journey state (duplicate check may have found one).
      try {
        const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
        if (typeof p['personId'] === 'string') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.journey.list(p['personId']) });
        }
      } catch {
        // ignore -- payload parse failure is expected for PayloadValidationError cases
      }
    },
  });
};
