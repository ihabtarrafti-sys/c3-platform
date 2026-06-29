import { useQuery } from '@tanstack/react-query';

import { useMilestoneService } from '@c3/hooks/useMilestoneService';
import { queryKeys } from '@c3/hooks/queryKeys';
import { computeMilestoneView } from '@c3/utils/milestoneUtils';
import type { MissionMilestoneView } from '@c3/types';

/**
 * Fetches milestones for a single mission and returns them as computed views.
 *
 * Computes MilestoneStatus and daysUntilDue at query time so the UI only
 * ever receives MissionMilestoneView — never raw MissionMilestone.
 *
 * An empty string missionId disables the query (enabled: false). This matches
 * the pattern used by useMissionGaps when no mission is selected.
 *
 * Results are ordered by PlannedDate ascending (service-side sort).
 *
 * Sprint 12 (S12-2). Used by the Situation Room milestone section (S12-4).
 */
export const useMissionMilestones = (
  missionId: string,
): { milestones: MissionMilestoneView[]; isLoading: boolean } => {
  const milestoneService = useMilestoneService();

  const { data, isLoading } = useQuery<MissionMilestoneView[]>({
    queryKey:  queryKeys.milestone.forMission(missionId),
    queryFn:   async () => {
      const raw = await milestoneService.listMissionMilestones(missionId);
      return raw.map(computeMilestoneView);
    },
    enabled: missionId !== '',
  });

  return {
    milestones: data ?? [],
    isLoading,
  };
};
