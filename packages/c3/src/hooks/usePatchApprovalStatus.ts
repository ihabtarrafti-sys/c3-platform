/**
 * usePatchApprovalStatus.ts
 *
 * TanStack Query mutation hook for approving or rejecting a C3 approval.
 *
 * Sprint 18 Phase 3B.
 *
 * Invariants enforced here (ADR-013):
 *   - Self-approval blocked: throws SelfApprovalError when the current user
 *     is the same person who submitted the approval (loginName comparison).
 *   - Role gate is enforced in the UI -- this hook is role-agnostic; callers
 *     must not expose the mutation to non-owners.
 *   - patchApprovalStatus does NOT set ExecutedAt, ExecutionError, or
 *     create/update any C3Journeys record.
 *
 * After a successful patch the hook invalidates the approvals.all query key,
 * which causes useListApprovals to refetch automatically.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApp } from './useApp';
import { useApprovalsService } from './useApprovalsService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';
import type { PatchApprovalStatusRequest } from '@c3/services/interfaces/IApprovalsService';

// ---------------------------------------------------------------------------
// SelfApprovalError
// ---------------------------------------------------------------------------

/**
 * Thrown when the current user attempts to approve or reject an approval
 * they themselves submitted.
 *
 * ADR-013: ReviewedBy must differ from SubmittedBy.
 */
export class SelfApprovalError extends Error {
  override readonly name = 'SelfApprovalError';

  constructor(loginName: string) {
    super(
      `[C3/Approvals] Self-approval not permitted (ADR-013). ` +
      `User "${loginName}" cannot review their own submission.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface PatchApprovalStatusVariables {
  /** The approval being actioned -- used for self-approval check and query context. */
  approval: C3Approval;
  /** The new status to apply. Only 'Approved' or 'Rejected' are valid. */
  newStatus: 'Approved' | 'Rejected';
  /** Required when newStatus is 'Rejected'. */
  rejectionReason?: string;
}

export const usePatchApprovalStatus = () => {
  const { currentUser } = useApp();
  const service         = useApprovalsService();
  const queryClient     = useQueryClient();

  return useMutation({
    mutationFn: async ({
      approval: card,
      newStatus,
      rejectionReason,
    }: PatchApprovalStatusVariables): Promise<void> => {

      // -- S31 freshness read (Approval Query Integrity) --
      // The cached card is a UI snapshot; the review precondition must be
      // driven by the CURRENT row, and the fresh ETag preconditions the MERGE
      // so a concurrent change surfaces as a truthful concurrency failure.
      const fresh = await service.getApproval(card.id);
      if (!fresh) {
        throw new Error(
          `[C3/Approvals] Approval ${card.title} (ID ${card.id}) was not found in C3Approvals. ` +
          `It may have been removed — refresh the inbox before retrying.`,
        );
      }
      const approval = fresh.approval;

      // Review actions are valid only from the pending review states — the
      // same states the UI renders the buttons for. A stale tab acting on a
      // row that has since moved on gets a truthful refusal, not a write.
      if (approval.approvalStatus !== 'Submitted' && approval.approvalStatus !== 'InReview') {
        throw new Error(
          `[C3/Approvals] Cannot ${newStatus === 'Approved' ? 'approve' : 'reject'} ${approval.title}: ` +
          `its live status is '${approval.approvalStatus}' — it changed after this view loaded. ` +
          `Refresh the inbox.`,
        );
      }

      // Self-approval enforcement (ADR-013) — against the FRESH row.
      if (
        currentUser.loginName &&
        currentUser.loginName === approval.submittedBy
      ) {
        throw new SelfApprovalError(currentUser.loginName);
      }

      const req: PatchApprovalStatusRequest = {
        newStatus,
        ...(newStatus === 'Rejected' ? { rejectionReason: rejectionReason ?? '' } : {}),
      };

      await service.patchApprovalStatus(approval.id, req, fresh.etag ?? undefined);
    },

    onSuccess: () => {
      // Invalidate the entire approvals key family so the inbox refetches.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
    },
  });
};
