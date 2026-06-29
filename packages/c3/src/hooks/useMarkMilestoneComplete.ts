import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useMilestoneService } from '@c3/hooks/useMilestoneService';
import type { MissionMilestone } from '@c3/types';

/**
 * Mutation hook for marking a mission milestone complete.
 *
 * Sets CompletedDate to today on the stored record and invalidates the
 * milestone cache so the Situation Room and Command Center both update.
 *
 * On success, invalidates:
 *   - milestone.all()        — removes the completed milestone's WorkItem
 *                              from the Command Center on next render
 *   - milestone.forMission() — updates the Situation Room milestone section
 *                              to show the milestone as Complete
 *
 * The missionId is required for targeted forMission cache invalidation.
 * Callers that do not know the missionId at call-site can pass the milestone's
 * MissionID directly from the MissionMilestoneView.
 *
 * Throws on:
 *   - Milestone not found
 *   - Milestone already complete
 *
 * Pattern: parallel factory (IMilestoneService, not SPService). ADR-001.
 * Sprint 12 (S12-2).
 */
export const useMarkMilestoneComplete = () => {
  const qc = useQueryClient();
  const milestoneService = useMilestoneService();

  return useMutation<
    MissionMilestone,
    Error,
    { milestoneId: string; missionId: string }
  >({
    mutationFn: ({ milestoneId }) =>
      milestoneService.completeMilestone(milestoneId),

    onSuccess: (_, { missionId }) => {
      // Batch invalidation: removes the completed milestone's WorkItem from
      // the Command Center. useWorkItems recomputes on next render.
      void qc.invalidateQueries({
        queryKey: queryKeys.milestone.all(),
      });
      // Per-mission invalidation: updates the Situation Room milestone section.
      void qc.invalidateQueries({
        queryKey: queryKeys.milestone.forMission(missionId),
      });
    },
  });
};
