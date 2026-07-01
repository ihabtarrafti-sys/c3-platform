/**
 * usePersonApprovals.ts
 *
 * Sprint 21 Phase 2 — Person-scoped approval history.
 *
 * Returns all C3Approvals where TargetPersonID matches the supplied personId,
 * across all 6 lifecycle statuses. Filtering is client-side — the full
 * all-statuses list is fetched once and cached by TanStack Query. When
 * ApprovalInbox is also mounted, both components share the same cache entry
 * (identical queryKey) and no extra fetch fires.
 *
 * refetchInterval is disabled (false) because PersonProfile renders a
 * historical audit view, not a live action queue. Manual navigation or
 * window-focus refetch is sufficient for this surface.
 *
 * Boundaries:
 *   - No service-level changes. Reuses IApprovalsService.listApprovals.
 *   - No schema changes.
 *   - No mutations. Read-only.
 *
 * See: packages/c3/src/hooks/useListApprovals.ts
 * See: packages/c3/src/components/shared/PersonApprovalHistoryCard.tsx
 */

import { useMemo } from 'react';

import { useListApprovals } from '@c3/hooks/useListApprovals';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// All 6 lifecycle statuses — we fetch everything and filter client-side.
const ALL_APPROVAL_STATUSES = [
  'Submitted',
  'InReview',
  'Approved',
  'Rejected',
  'Executed',
  'ExecutionFailed',
] as const;

export interface UsePersonApprovalsResult {
  data: C3Approval[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Returns approvals scoped to a single person (by canonical PersonID).
 *
 * When personId is empty string the filter returns [] without suppressing the
 * underlying query — the list fetch still fires but results are filtered to
 * nothing. In practice PersonProfile guards on person load before rendering
 * components that call this hook, so personId is always non-empty here.
 */
export const usePersonApprovals = (personId: string): UsePersonApprovalsResult => {
  const {
    data: allApprovals = [],
    isLoading,
    isError,
    error,
  } = useListApprovals({
    status:          [...ALL_APPROVAL_STATUSES],
    refetchInterval: false,   // history surface — no live polling
  });

  const data = useMemo(
    () => allApprovals.filter(a => a.targetPersonId === personId),
    [allApprovals, personId],
  );

  return { data, isLoading, isError, error: error ?? null };
};
