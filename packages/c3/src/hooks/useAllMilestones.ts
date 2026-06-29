import { useQuery } from '@tanstack/react-query';

import { useMilestoneService } from '@c3/hooks/useMilestoneService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { MissionMilestone } from '@c3/types';

/**
 * Fetches all milestones across all missions in a single batch call.
 *
 * Used by useWorkItems (S12-3) to feed the MilestoneAlert generator without
 * issuing N separate per-mission queries. Mirrors the `credentials.all()` /
 * listAllCredentials pattern used by useOperationalGaps and useMissionGaps.
 *
 * Returns raw MissionMilestone records (not computed views) so the generator
 * can apply its own status and priority logic.
 *
 * Cache key: queryKeys.milestone.all()
 * Invalidated by: useMarkMilestoneComplete.onSuccess
 *
 * Sprint 12 (S12-2).
 */
export const useAllMilestones = (): {
  data: MissionMilestone[] | undefined;
  isLoading: boolean;
} => {
  const milestoneService = useMilestoneService();

  const { data, isLoading } = useQuery<MissionMilestone[]>({
    queryKey: queryKeys.milestone.all(),
    queryFn:  () => milestoneService.listAllMilestones(),
  });

  return { data, isLoading };
};
