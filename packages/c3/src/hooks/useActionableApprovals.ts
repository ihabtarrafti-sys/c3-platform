/**
 * useActionableApprovals.ts — Sprint 31 (Approval Query Integrity).
 *
 * COMPLETE actionable set (Submitted / InReview / Approved / ExecutionFailed)
 * via the exhaustively paged, fail-closed service read. ExecutionFailed is
 * actionable recovery state — it is never confined to a history window, so a
 * stuck failed execution can no longer age out of the inbox (S31 Phase 0
 * finding R2).
 *
 * Consumer: ApprovalInbox (pending / approved / failed tabs + counts).
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApprovalsService } from './useApprovalsService';

export const useActionableApprovals = () => {
  const service = useApprovalsService();

  return useQuery({
    queryKey: queryKeys.approvals.actionable(),
    queryFn:  ({ signal }) => service.listActionableApprovals({ signal }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
};
