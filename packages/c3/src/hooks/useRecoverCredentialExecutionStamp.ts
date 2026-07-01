/**
 * useRecoverCredentialExecutionStamp.ts
 *
 * Sprint 21 Phase 1 — AddCredential Partial Execution Recovery.
 *
 * Handles the known partial-execution failure mode where:
 *   - Step 4 (addCredential) succeeded: the C3Credentials row exists and is valid.
 *   - Step 5 (stampExecution → Executed) failed: the approval remains at Approved.
 *
 * This hook stamps the approval Executed WITHOUT creating a new credential.
 * It is the only safe recovery path when a credential already exists for the
 * target person but the approval audit record was not updated.
 *
 * Clicking the normal Execute button in this state would call addCredential again,
 * creating a duplicate CRED-XXXX row for the same person, type, and reference
 * number. This hook bypasses addCredential entirely.
 *
 * Recovery preconditions (all checked before any write):
 *   1. approvalStatus === 'Approved'
 *   2. operationType === 'AddCredential'
 *   3. payload must be parseable JSON with non-empty holderPersonId, credentialType,
 *      and referenceNumber
 *   4. credentialService.listCredentialsForPerson(holderPersonId) must return a
 *      credential matching credentialType + referenceNumber (re-checked at stamp
 *      time — guards against stale cache or credential deactivated between
 *      detection and the operator clicking Recover)
 *
 * If precondition 4 fails at stamp time, CredentialRecoveryTargetMissingError is
 * thrown. The approval is NOT modified. The operator should use the normal Execute
 * button to create a new credential.
 *
 * Exported error classes:
 *   CredentialRecoveryPreConditionError  — wrong status/operationType/bad payload
 *   CredentialRecoveryTargetMissingError — no matching credential at stamp time
 *
 * Boundaries:
 *   - Never calls addCredential. No new C3Credentials row is created.
 *   - Never stamps ExecutionFailed. Only stamps Executed.
 *   - Does not modify the normal Execute path (useExecuteApproval is unchanged).
 *   - No service interface changes.
 *   - No schema changes.
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 * See: packages/c3/src/hooks/useExecuteApproval.ts (PartialCredentialExecutionError)
 * See: packages/c3/src/hooks/useRecoverExecutionStamp.ts (InitiateJourney mirror)
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
 * Thrown when the approval does not satisfy the preconditions for credential
 * recovery:
 *   - approvalStatus is not 'Approved'
 *   - operationType is not 'AddCredential'
 *   - payload is missing, not valid JSON, or lacks holderPersonId / credentialType
 *     / referenceNumber
 *
 * No write occurs. The approval is unchanged.
 */
export class CredentialRecoveryPreConditionError extends Error {
  override readonly name = 'CredentialRecoveryPreConditionError';
  constructor(message: string) {
    super(`[C3/CredentialRecovery] Pre-condition not met: ${message}`);
  }
}

/**
 * Thrown when no credential matching credentialType + referenceNumber is found
 * for holderPersonId at stamp time. This can happen if:
 *   - The UI showed the Recover button based on stale query data (rare).
 *   - The credential was deactivated between detection and the operator clicking
 *     Recover.
 *   - This approval was never partially executed (genuine state mismatch).
 *
 * No write occurs. The approval is unchanged.
 * The operator should use the normal Execute button to create a new credential.
 */
export class CredentialRecoveryTargetMissingError extends Error {
  override readonly name = 'CredentialRecoveryTargetMissingError';
  constructor(holderPersonId: string, credentialType: string, referenceNumber: string) {
    super(
      `[C3/CredentialRecovery] No matching credential found for ${holderPersonId} ` +
      `(type: ${credentialType}, ref: ${referenceNumber}). ` +
      `Use the Execute button to create one.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Safe payload field extraction
// ---------------------------------------------------------------------------

interface CredentialRecoveryPayloadFields {
  holderPersonId: string;
  credentialType: string;
  referenceNumber: string;
}

function extractCredentialPayloadFields(
  raw: string | undefined,
): CredentialRecoveryPayloadFields | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const holderPersonId  = parsed['holderPersonId'];
    const credentialType  = parsed['credentialType'];
    const referenceNumber = parsed['referenceNumber'];
    if (
      typeof holderPersonId  === 'string' && holderPersonId.trim().length  > 0 &&
      typeof credentialType  === 'string' && credentialType.trim().length  > 0 &&
      typeof referenceNumber === 'string' && referenceNumber.trim().length > 0
    ) {
      return {
        holderPersonId:  holderPersonId.trim(),
        credentialType:  credentialType.trim(),
        referenceNumber: referenceNumber.trim(),
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

export const useRecoverCredentialExecutionStamp = () => {
  const approvalsService  = useApprovalsService();
  const credentialService = useCredentialService();
  const queryClient       = useQueryClient();

  return useMutation({
    mutationFn: async (approval: C3Approval): Promise<{ holderPersonId: string }> => {

      // ── Precondition 1: must be Approved ──────────────────────────────────
      if (approval.approvalStatus !== 'Approved') {
        throw new CredentialRecoveryPreConditionError(
          `approvalStatus must be 'Approved', got '${approval.approvalStatus}'.`,
        );
      }

      // ── Precondition 2: must be AddCredential ─────────────────────────────
      if (approval.operationType !== 'AddCredential') {
        throw new CredentialRecoveryPreConditionError(
          `operationType must be 'AddCredential', got '${approval.operationType}'.`,
        );
      }

      // ── Precondition 3: parse fields from payload ─────────────────────────
      const fields = extractCredentialPayloadFields(approval.payload);
      if (!fields) {
        throw new CredentialRecoveryPreConditionError(
          'Payload is missing, not valid JSON, or lacks holderPersonId, ' +
          'credentialType, or referenceNumber.',
        );
      }

      const { holderPersonId, credentialType, referenceNumber } = fields;

      // ── Precondition 4: re-check credential exists at stamp time ──────────
      // Re-verify at mutation time to guard against stale cache or a credential
      // deactivated between detection and the operator clicking Recover.
      const credentials = await credentialService.listCredentialsForPerson(holderPersonId);
      const existing = credentials.find(
        c => c.Type === credentialType && c.ReferenceNumber === referenceNumber,
      );
      if (!existing) {
        throw new CredentialRecoveryTargetMissingError(holderPersonId, credentialType, referenceNumber);
      }

      // ── Stamp approval Executed ───────────────────────────────────────────
      // Credential already exists — do NOT call addCredential.
      // stampExecution sets: ApprovalStatus = Executed, ExecutedAt = ISO datetime,
      // ExecutionError = null. No C3Credentials row is created or modified.
      const executedAt = new Date().toISOString();
      await approvalsService.stampExecution(approval.id, {
        newStatus: 'Executed',
        executedAt,
      });

      console.info(
        `[C3/CredentialRecovery] Stamped ${approval.title} (ID ${approval.id}) as Executed. ` +
        `Existing credential ${existing.CredentialID} for ${holderPersonId} preserved. ` +
        `ExecutedAt: ${executedAt}`,
      );

      return { holderPersonId };
    },

    onSuccess: ({ holderPersonId }) => {
      // Mirror the invalidation pattern of useExecuteApproval.onSuccess (AddCredential
      // branch) so ApprovalInbox, PersonProfile credentials panel, and any credential
      // aggregation views update consistently.
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
