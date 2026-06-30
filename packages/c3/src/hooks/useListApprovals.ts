/**
 * useListApprovals.ts
 *
 * TanStack Query hook for fetching pending/in-review approvals from C3Approvals.
 *
 * Sprint 18 Phase 3B.
 *
 * Defaults to Submitted + InReview — the two statuses an owner needs to action.
 * Caller may supply a custom status filter to widen the result set.
 *
 * Mode-transparent: selects SP vs mock implementation via useApprovalsService.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApprovalsService } from './useApprovalsService';

const DEFAULT_STATUSES = ['Submitted', 'InReview'];

export interface UseListApprovalsOptions {
  status?: string[];
  /** TanStack Query refetchInterval in ms. Pass false to disable. Default: 30 000. */
  refetchInterval?: number | false;
}

export const useListApprovals = (options: UseListApprovalsOptions = {}) => {
  const { status = DEFAULT_STATUSES, refetchInterval = 30_000 } = options;
  const service = useApprovalsService();

  const filter = { status };

  return useQuery({
    queryKey: queryKeys.approvals.list(filter),
    queryFn:  () => service.listApprovals(filter),
    refetchInterval,
    staleTime: 15_000,
  });
};
