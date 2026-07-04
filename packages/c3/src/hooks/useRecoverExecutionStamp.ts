/**
 * useRecoverExecutionStamp.ts
 *
 * Sprint 20 Phase 2 -- Partial Execution Recovery.
 *
 * Handles the known partial-execution failure mode where:
 *   - Step 4 (initiateJourney) succeeded: the C3Journeys row exists and is valid.
 *   - Step 5 (stampExecution -> Executed) failed: the approval remains at Approved.
 *
 * This hook stamps the approval Executed WITHOUT creating a new journey.
 * It is the only safe recovery path when a journey already exists for the
 * target person but the approval audit record was not updated.
 *
 * Recovery preconditions (all checked before any write):
 *   1. approvalStatus === 'Approved'
 *   2. operationType === 'InitiateJourney'
 *   3. payload must be parseable JSON with a non-empty personId
 *   4. getActiveJourney(personId, 'Onboarding') must return a journey
 *      (re-checked at mutation time -- guards against a race where the journey
 *      was cancelled between the UI detecting it and the operator clicking Recover)
 *
 * If precondition 4 fails at stamp time, RecoveryTargetMissingError is thrown.
 * The approval is NOT modified. The operator should use the normal Execute button
 * to create a new journey.
 *
 * Exported error classes:
 *   RecoveryPreConditionError -- wrong status / operationType / unparseable payload
 *   RecoveryTargetMissingError -- no active Onboarding journey found at stamp time
 *
 * Boundaries:
 *   - Never calls initiateJourney. No new C3Journeys row is created.
 *   - Never stamps ExecutionFailed. Only stamps Executed.
 *   - Does not modify self-approval enforcement (not applicable to execution).
 *   - Does not change normal Execute path (useExecuteApproval is unchanged).
 *   - No service interface changes (stampExecution already handles Executed).
 *   - No schema changes.
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 * See: packages/c3/src/hooks/useExecuteApproval.ts (normal execute path)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApprovalsService } from './useApprovalsService';
import { useJourneyService } from './useJourneyService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the approval does not satisfy the preconditions for recovery:
 *   - approvalStatus is not 'Approved'
 *   - operationType is not 'InitiateJourney'
 *   - payload is missing, not valid JSON, or lacks a non-empty personId
 *
 * No write occurs. The approval is unchanged.
 */
export class RecoveryPreConditionError extends Error {
  override readonly name = 'RecoveryPreConditionError';
  constructor(message: string) {
    super(`[C3/Recovery] Pre-condition not met: ${message}`);
  }
}

/**
 * Thrown when no active Onboarding journey is found for the target person
 * at stamp time. This can happen if:
 *   - The UI showed the Recover button based on stale data (rare).
 *   - The journey was cancelled between detection and the operator clicking Recover.
 *   - This approval was never partially executed (genuine state mismatch).
 *
 * No write occurs. The approval is unchanged.
 * The operator should use the normal Execute button to create a new journey.
 */
export class RecoveryTargetMissingError extends Error {
  override readonly name = 'RecoveryTargetMissingError';
  constructor(personId: string) {
    super(
      `[C3/Recovery] No active Onboarding journey found for ${personId}. ` +
      `Use the Execute button to create a new journey.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Safe personId extraction (shared utility -- no import coupling to payload types)
// ---------------------------------------------------------------------------

function extractPersonId(raw: string | undefined): string {
  if (!raw || !raw.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const personId = parsed['personId'];
    return typeof personId === 'string' ? personId.trim() : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useRecoverExecutionStamp = () => {
  const approvalsService = useApprovalsService();
  const journeyService   = useJourneyService();
  const queryClient      = useQueryClient();

  return useMutation({
    mutationFn: async (card: C3Approval): Promise<{ personId: string }> => {

      // -- S31 freshness read: the CURRENT row drives every precondition and
      //    its ETag preconditions the stamp (stale recovery attempts refuse). --
      const fresh = await approvalsService.getApproval(card.id);
      if (!fresh) {
        throw new RecoveryPreConditionError(
          `approval row ${card.id} (${card.title}) was not found in C3Approvals.`,
        );
      }
      const approval = fresh.approval;

      // -- Precondition 1: must be Approved (fresh row) --
      if (approval.approvalStatus !== 'Approved') {
        throw new RecoveryPreConditionError(
          `approvalStatus must be 'Approved', got '${approval.approvalStatus}' (live value — it changed after this view loaded).`,
        );
      }

      // -- Precondition 2: must be InitiateJourney --
      if (approval.operationType !== 'InitiateJourney') {
        throw new RecoveryPreConditionError(
          `operationType must be 'InitiateJourney', got '${approval.operationType}'.`,
        );
      }

      // -- Precondition 3: parse personId from payload --
      const personId = extractPersonId(approval.payload);
      if (!personId) {
        throw new RecoveryPreConditionError(
          'Payload is missing, not valid JSON, or does not contain a non-empty personId.',
        );
      }

      // -- Precondition 4: re-check active journey exists at stamp time --
      // This is a safety re-check. The UI already checked before showing the
      // Recover button, but we re-verify here to guard against:
      //   - Stale query cache in the UI
      //   - Journey cancelled between detection and stamp
      //   - Any other race condition
      const existingJourney = await journeyService.getActiveJourney(personId, 'Onboarding');
      if (!existingJourney) {
        throw new RecoveryTargetMissingError(personId);
      }

      // -- Stamp approval Executed --
      // Journey already exists -- do NOT call initiateJourney.
      // stampExecution sets: ApprovalStatus = Executed, ExecutedAt = ISO datetime,
      // ExecutionError = null. No C3Journeys row is created or modified.
      const executedAt = new Date().toISOString();
      await approvalsService.stampExecution(approval.id, {
        newStatus: 'Executed',
        executedAt,
      }, fresh.etag ?? undefined);

      console.info(
        `[C3/Recovery] Stamped ${approval.title} (ID ${approval.id}) as Executed. ` +
        `Existing journey ${existingJourney.JourneyID} for ${personId} preserved. ` +
        `ExecutedAt: ${executedAt}`,
      );

      // Return personId for onSuccess invalidation
      return { personId };
    },

    onSuccess: ({ personId }) => {
      // Mirror the invalidation pattern of useExecuteApproval.onSuccess so
      // all downstream views (ApprovalInbox, PersonProfile, Situation Room) update.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.journey.active(personId, 'Onboarding') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.journey.allActive('Onboarding') });
    },

    onError: () => {
      // Always re-fetch approvals on error so any status changes are visible.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
    },
  });
};
