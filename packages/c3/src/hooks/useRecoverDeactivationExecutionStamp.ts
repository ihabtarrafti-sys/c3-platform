/**
 * useRecoverDeactivationExecutionStamp.ts
 *
 * Sprint 23 Phase 1 — DeactivateCredential Partial Execution Recovery.
 *
 * Handles the known partial-execution failure mode where:
 *   - Step 4 (deactivateCredential) succeeded: IsActive = false is already set
 *     on the C3Credentials row.
 *   - Step 5 (stampExecution → Executed) failed: the approval remains at Approved.
 *
 * This hook stamps the approval Executed WITHOUT calling deactivateCredential
 * again. It is the only safe recovery path when a credential is already inactive
 * but the approval audit record was not updated.
 *
 * Clicking the normal Execute button in this state would enter the
 * CredentialAlreadyInactiveError branch of useExecuteApproval, which intentionally
 * blocks re-execution. This hook bypasses deactivateCredential entirely.
 *
 * Recovery preconditions (all checked before any write):
 *   1. approvalStatus === 'Approved'
 *   2. operationType === 'DeactivateCredential'
 *   3. payload must be parseable JSON with non-empty credentialId and holderPersonId
 *   4. credentialService.getCredential(credentialId) must return a credential with
 *      IsActive === false (re-checked at stamp time — guards against stale cache or
 *      the credential being reactivated externally between detection and recovery)
 *
 * If precondition 4 finds the credential is still active (IsActive = true), this
 * hook throws DeactivationRecoveryTargetActiveError. In that case the operator
 * should use the normal Execute button to actually perform the deactivation.
 *
 * If precondition 4 finds the credential does not exist at all,
 * DeactivationRecoveryTargetMissingError is thrown.
 *
 * Exported error classes:
 *   DeactivationRecoveryPreConditionError   — wrong status/operationType/bad payload
 *   DeactivationRecoveryTargetMissingError  — credential not found at stamp time
 *   DeactivationRecoveryTargetActiveError   — credential is still IsActive = true
 *
 * Boundaries:
 *   - Never calls deactivateCredential. No C3Credentials row is modified.
 *   - Never stamps ExecutionFailed. Only stamps Executed.
 *   - Does not modify the normal Execute path (useExecuteApproval is unchanged).
 *   - No service interface changes.
 *   - No schema changes.
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 * See: packages/c3/src/hooks/useExecuteApproval.ts (PartialDeactivationExecutionError)
 * See: packages/c3/src/hooks/useRecoverCredentialExecutionStamp.ts (AddCredential mirror)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApprovalsService } from './useApprovalsService';
import { useCredentialService } from './useCredentialService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the approval does not satisfy the preconditions for deactivation
 * stamp recovery:
 *   - approvalStatus is not 'Approved'
 *   - operationType is not 'DeactivateCredential'
 *   - payload is missing, not valid JSON, or lacks credentialId / holderPersonId
 *
 * No write occurs. The approval is unchanged.
 */
export class DeactivationRecoveryPreConditionError extends Error {
  override readonly name = 'DeactivationRecoveryPreConditionError';
  constructor(message: string) {
    super(`[C3/DeactivationRecovery] Pre-condition not met: ${message}`);
  }
}

/**
 * Thrown when the target credential does not exist in C3Credentials at stamp time.
 * This should be rare; it can happen if the credential row was deleted externally
 * between detection and the operator clicking Recover.
 *
 * No write occurs. The approval is unchanged.
 */
export class DeactivationRecoveryTargetMissingError extends Error {
  override readonly name = 'DeactivationRecoveryTargetMissingError';
  constructor(credentialId: string) {
    super(
      `[C3/DeactivationRecovery] Credential '${credentialId}' was not found in ` +
      `C3Credentials at stamp time. The approval cannot be stamped Executed.`,
    );
  }
}

/**
 * Thrown when the target credential is still IsActive = true at stamp time.
 * This means the deactivation did NOT actually succeed — the UI may have shown
 * the Recover button based on stale data (rare) or a race condition.
 *
 * No write occurs. The approval is unchanged.
 * The operator should use the normal Execute button to perform the deactivation.
 */
export class DeactivationRecoveryTargetActiveError extends Error {
  override readonly name = 'DeactivationRecoveryTargetActiveError';
  constructor(credentialId: string) {
    super(
      `[C3/DeactivationRecovery] Credential '${credentialId}' is still active ` +
      `(IsActive = true). The deactivation has not been applied. ` +
      `Use the normal Execute button to deactivate it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Safe payload field extraction
// ---------------------------------------------------------------------------

interface DeactivationRecoveryPayloadFields {
  credentialId: string;
  holderPersonId: string;
}

function extractDeactivationPayloadFields(
  raw: string | undefined,
): DeactivationRecoveryPayloadFields | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const credentialId   = parsed['credentialId'];
    const holderPersonId = parsed['holderPersonId'];
    if (
      typeof credentialId   === 'string' && credentialId.trim().length   > 0 &&
      typeof holderPersonId === 'string' && holderPersonId.trim().length > 0
    ) {
      return {
        credentialId:   credentialId.trim(),
        holderPersonId: holderPersonId.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useRecoverDeactivationExecutionStamp = () => {
  const approvalsService  = useApprovalsService();
  const credentialService = useCredentialService();
  const queryClient       = useQueryClient();

  return useMutation({
    mutationFn: async (approval: C3Approval): Promise<{ holderPersonId: string }> => {

      // ── Precondition 1: must be Approved ──────────────────────────────────
      if (approval.approvalStatus !== 'Approved') {
        throw new DeactivationRecoveryPreConditionError(
          `approvalStatus must be 'Approved', got '${approval.approvalStatus}'.`,
        );
      }

      // ── Precondition 2: must be DeactivateCredential ──────────────────────
      if (approval.operationType !== 'DeactivateCredential') {
        throw new DeactivationRecoveryPreConditionError(
          `operationType must be 'DeactivateCredential', got '${approval.operationType}'.`,
        );
      }

      // ── Precondition 3: parse required payload fields ─────────────────────
      const fields = extractDeactivationPayloadFields(approval.payload);
      if (!fields) {
        throw new DeactivationRecoveryPreConditionError(
          'Payload is missing, not valid JSON, or lacks credentialId or holderPersonId.',
        );
      }

      const { credentialId, holderPersonId } = fields;

      // ── Precondition 4: re-check credential state at stamp time ───────────
      // Uses getCredential (no IsActive filter) so we can inspect inactive
      // credentials — listCredentialsForPerson filters IsActive eq 1 and
      // would not find the deactivated credential.
      const target = await credentialService.getCredential(credentialId);

      if (target === null || target === undefined) {
        throw new DeactivationRecoveryTargetMissingError(credentialId);
      }

      if (target.IsActive) {
        // Credential is still active — deactivation was not applied.
        // Stamping Executed here would create an incorrect audit record.
        throw new DeactivationRecoveryTargetActiveError(credentialId);
      }

      // ── Stamp approval Executed ───────────────────────────────────────────
      // Credential is confirmed inactive — do NOT call deactivateCredential.
      // stampExecution sets: ApprovalStatus = Executed, ExecutedAt = ISO datetime.
      const executedAt = new Date().toISOString();
      await approvalsService.stampExecution(approval.id, {
        newStatus: 'Executed',
        executedAt,
      });

      console.info(
        `[C3/DeactivationRecovery] Stamped ${approval.title} (ID ${approval.id}) as Executed. ` +
        `Credential ${credentialId} is confirmed IsActive = false. ` +
        `HolderPersonID: ${holderPersonId}. ExecutedAt: ${executedAt}`,
      );

      return { holderPersonId };
    },

    onSuccess: ({ holderPersonId }) => {
      // Mirror the invalidation pattern of useExecuteApproval.onSuccess
      // (DeactivateCredential branch) so ApprovalInbox, PersonProfile credentials
      // panel, and any credential aggregation views update consistently.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.person.credentials(holderPersonId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials.all() });
    },

    onError: () => {
      // Always re-fetch approvals on error so any status changes are visible.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
    },
  });
};
