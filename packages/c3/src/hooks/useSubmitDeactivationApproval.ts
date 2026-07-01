/**
 * useSubmitDeactivationApproval.ts
 *
 * Sprint 23 Phase 1 -- mode-branching hook for submitting a Deactivate
 * Credential action.
 *
 * Mock DSM  --> calls credentialService.deactivateCredential() directly.
 *               Credential is immediately marked IsActive = false in the
 *               mock store. Cache is invalidated.
 *
 * SP DSM    --> submits a C3Approvals record (OperationType: DeactivateCredential,
 *               ApprovalStatus: Submitted). No C3Credentials write occurs at
 *               submission time. Deactivation is deferred to owner execution.
 *
 * Both inner services (useCredentialService, useApprovalsService) are always
 * called unconditionally -- React rules of hooks prohibit conditional calls.
 * The runtime branch happens inside submitAsync, not at hook instantiation.
 *
 * isPending is managed via local useState to provide a single flag across
 * both branches. The finally block guarantees it clears even on throw.
 *
 * Pattern follows useSubmitCredentialApproval (Sprint 20 Phase 3).
 *
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 * See: packages/c3/src/hooks/useSubmitCredentialApproval.ts (reference pattern)
 */

import { useState } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { useApprovalsService } from '@c3/hooks/useApprovalsService';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { DeactivateCredentialApprovalPayload } from '@c3/services/interfaces/approvalPayloads';

// ---------------------------------------------------------------------------
// Input and result types
// ---------------------------------------------------------------------------

export interface DeactivateCredentialInput {
  /** CRED-XXXX -- the credential to deactivate. */
  credentialId: string;
  /** PER-XXXX -- credential holder (for targetPersonId and cache invalidation). */
  holderPersonId: string;
  /** Raw CredentialType key -- included in payload for display. */
  credentialType: string;
  /** Reference number -- included in payload for audit verification. */
  referenceNumber: string;
  /** Reason for deactivation. Required. */
  reason: string;
}

export type DeactivationSubmissionOutcome =
  | {
      /** Mock DSM: credential was deactivated directly. */
      mode: 'direct';
    }
  | {
      /**
       * SP DSM: a DeactivateCredential approval was submitted.
       * The credential remains IsActive = true until an owner executes the approval.
       */
      mode: 'approval';
      approvalTitle: string;
      approvalId: number;
    };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSubmitDeactivationApproval = () => {
  const { config, currentUser } = useApp();
  const credentialService       = useCredentialService();   // always called (rules of hooks)
  const approvalsService        = useApprovalsService();    // always called
  const queryClient             = useQueryClient();

  const [isPending, setIsPending] = useState(false);

  /**
   * Submit a Deactivate Credential action.
   *
   * Mock DSM: deactivates directly, invalidates credential caches.
   * SP DSM:   submits an approval only. No C3Credentials write.
   *
   * Throws on failure in both modes -- callers (PersonProfile) catch and toast.
   */
  const submitAsync = async (
    input: DeactivateCredentialInput,
  ): Promise<DeactivationSubmissionOutcome> => {
    setIsPending(true);
    try {
      if (config.dataSourceMode !== 'sharepoint') {
        // ── Mock / dev path ──────────────────────────────────────────────
        // Direct deactivation. No approval record created.
        await credentialService.deactivateCredential(input.credentialId);

        // Invalidate active credential lists so PersonProfile refreshes.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.person.credentials(input.holderPersonId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.credentials.all(),
        });

        return { mode: 'direct' };
      }

      // ── SharePoint / approval path ────────────────────────────────────
      // Submit a DeactivateCredential approval intent only.
      // NO C3Credentials write occurs here.
      // Deactivation (MERGE IsActive = false) is deferred to execution time.
      const payload: DeactivateCredentialApprovalPayload = {
        operationType: 'DeactivateCredential',
        credentialId:   input.credentialId,
        holderPersonId: input.holderPersonId,
        credentialType: input.credentialType,
        referenceNumber: input.referenceNumber,
        reason:         input.reason,
        requestedBy:    currentUser.loginName || undefined,
      };

      const result = await approvalsService.createApproval({
        operationType:  'DeactivateCredential',
        targetPersonId: input.holderPersonId,
        targetId:       input.credentialId,
        reason:         input.reason,
        payload:        JSON.stringify(payload),
      });

      return {
        mode:          'approval',
        approvalTitle: result.title,
        approvalId:    result.approvalId,
      };
    } finally {
      setIsPending(false);
    }
  };

  return { submitAsync, isPending };
};
