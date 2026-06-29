import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApp } from '@c3/hooks/useApp';
import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { Mission } from '@c3/types';

/**
 * Mutation hook for approving a FinancePending mission.
 *
 * Transitions Mission.Status: FinancePending → Confirmed.
 * Sets ConfirmedAt and ConfirmedBy on the mission record.
 * The ADR-002 activation gate then applies: obligations begin generating
 * for mission participants on the next useOperationalGaps evaluation.
 *
 * Callers:
 *   Input: { missionId: string }
 *   The confirmedBy is sourced from currentUser.email (AppContext) — the
 *   operator triggering the approval.
 *
 * On success, invalidates:
 *   - mission.all()         — refreshes mission lists (scope selector, etc.)
 *   - mission.byId()        — refreshes the specific mission record
 *
 * The finance.forMission() key is NOT invalidated here — the approval does not
 * change the finance lines themselves. Finance lines remain stable across
 * the FinancePending → Confirmed transition.
 *
 * Throws when:
 *   - Mission not found
 *   - Mission.Status is not FinancePending (enforced by IMissionService)
 *
 * Pattern: parallel factory (IMissionService). ADR-001.
 * Sprint 13 (S13-2). UI wired in S13-4.
 */
export const useApproveMission = () => {
  const qc = useQueryClient();
  const missionService = useMissionService();
  const { currentUser } = useApp();

  return useMutation<Mission, Error, { missionId: string }>({
    mutationFn: ({ missionId }) =>
      missionService.confirmMission(missionId, currentUser.email),

    onSuccess: (_, { missionId }) => {
      // Invalidate all-missions list (scope selector, mission lists)
      void qc.invalidateQueries({ queryKey: queryKeys.mission.all() });
      // Invalidate the specific mission record (detail views)
      void qc.invalidateQueries({ queryKey: queryKeys.mission.byId(missionId) });
    },
  });
};
