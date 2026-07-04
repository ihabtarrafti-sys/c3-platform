/**
 * usePersonApprovals.ts
 *
 * Sprint 21 Phase 2 -- Person-scoped approval history.
 * Sprint 31 -- rewritten for Approval Query Integrity: the pre-S31
 * implementation fetched ALL statuses through the legacy $top=500 read and
 * filtered client-side, silently truncating any person's history once
 * C3Approvals exceeded 500 rows (TD-19). It now uses the COMPLETE,
 * exhaustively paged, server-filtered read on the indexed TargetPersonID
 * column — behaviourally identical filtering (exact match on the same
 * column), with no omission at any list size.
 *
 * refetchInterval remains disabled: PersonProfile renders a historical audit
 * view, not a live action queue. Any approval mutation invalidates the
 * approvals root key, which reaches this key by prefix.
 *
 * Boundaries: read-only; no schema changes; result shape unchanged for the
 * PersonProfile consumer.
 */

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useApprovalsService } from '@c3/hooks/useApprovalsService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

export interface UsePersonApprovalsResult {
  data: C3Approval[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Returns the complete approval history for a person (canonical PersonID),
 * newest first (Id desc). Empty personId suppresses the fetch entirely.
 */
export const usePersonApprovals = (personId: string): UsePersonApprovalsResult => {
  const service = useApprovalsService();

  const { data = [], isLoading, isError, error } = useQuery<C3Approval[]>({
    queryKey: queryKeys.approvals.byPerson(personId),
    queryFn:  ({ signal }) => service.listApprovalsByPerson(personId, { signal }),
    enabled:  personId.trim().length > 0,
  });

  return { data, isLoading, isError, error: (error ?? null) as Error | null };
};
