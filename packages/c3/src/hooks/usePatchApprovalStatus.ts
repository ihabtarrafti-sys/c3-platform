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
 *   - Role gate is enforced in the UI — this hook is role-agnostic; callers
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
  /** The approval being actioned — used for self-approval check and query context. */
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
      approval,
      newStatus,
      rejectionReason,
    }: PatchApprovalStatusVariables): Promise<void> => {

      // Self-approval enforcement (ADR-013)
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

      await service.patchApprovalStatus(approval.id, req);
    },

    onSuccess: () => {
      // Invalidate the entire approvals key family so the inbox refetches.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });
    },
  });
};
