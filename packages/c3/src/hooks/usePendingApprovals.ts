/**
 * usePendingApprovals.ts — Sprint 31 (Approval Query Integrity).
 *
 * COMPLETE pending band (Submitted / InReview / Approved) via the exhaustively
 * paged, fail-closed service read. Replaces the pre-S31 pattern of
 * useListApprovals({status: PENDING}) whose $top=500 cap could fail the
 * duplicate-pending guard OPEN and understate pending chips.
 *
 * Consumers: MissionWorkspace pending indicators, mission-readiness pending
 * inputs. (The submit-time duplicate guard calls the service directly for a
 * fresh read — it does not consume this cache.)
 *
 * AbortSignal from TanStack propagates through every page request;
 * cancellation rejects with AbortError and never resolves as empty success.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useApprovalsService } from './useApprovalsService';

export const usePendingApprovals = () => {
  const service = useApprovalsService();

  return useQuery({
    queryKey: queryKeys.approvals.pending(),
    queryFn:  ({ signal }) => service.listPendingApprovals({ signal }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
};
