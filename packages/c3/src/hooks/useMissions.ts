import { useQuery } from '@tanstack/react-query';

import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { Mission, MissionFilter } from '@c3/types';

/**
 * Fetches the list of Missions, optionally filtered by status and/or entity.
 *
 * Results are sorted by Span.StartDate ascending (soonest Mission first).
 *
 * Common usage patterns:
 *
 *   // All Missions
 *   const { data: missions } = useMissions();
 *
 *   // Only Missions that generate operational obligations (ADR-002 gate)
 *   const { data: activeMissions } = useMissions({
 *     status: ['Confirmed', 'Active', 'PostMission'],
 *   });
 *
 *   // Confirmed + Active only (for Mission selector in Situation Room)
 *   const { data: liveMissions } = useMissions({
 *     status: ['Confirmed', 'Active'],
 *   });
 *
 * Sprint 10 (M10-1).
 */
export const useMissions = (
  filter?: MissionFilter,
): { data: Mission[] | undefined; isLoading: boolean } => {
  const missionService = useMissionService();

  const { data, isLoading } = useQuery<Mission[]>({
    queryKey: queryKeys.mission.filtered(filter),
    queryFn: () => missionService.listMissions(filter),
  });

  return { data, isLoading };
};
