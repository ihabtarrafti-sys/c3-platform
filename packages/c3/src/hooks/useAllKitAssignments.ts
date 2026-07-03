import { useQuery } from '@tanstack/react-query';

import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { KitAssignment } from '@c3/types';

/**
 * Fetches all active kit assignments across all missions.
 *
 * Batch call for MissionWorkspace — consumers group locally by
 * MissionID/PersonID. One query, no per-card fetches (S27 rule).
 *
 * Sprint 28 (S28-3).
 */
export const useAllKitAssignments = (): {
  data: KitAssignment[];
  isLoading: boolean;
} => {
  const missionService = useMissionService();

  const { data = [], isLoading } = useQuery<KitAssignment[]>({
    queryKey: queryKeys.mission.allKitAssignments(),
    queryFn: () => missionService.listAllKitAssignments(),
  });

  return { data, isLoading };
};
