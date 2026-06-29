import { useQuery } from '@tanstack/react-query';

import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { MissionParticipant } from '@c3/types';

/**
 * Fetches all participants for a given Mission.
 *
 * Returns an empty array while loading or if the Mission has no participants.
 * The hook is safe to call with an empty string (returns [] immediately without
 * triggering a fetch, via the `enabled` guard).
 *
 * Used by useMissionGaps (Phase 2) to determine which persons to evaluate.
 *
 * Sprint 10 (M10-1).
 */
export const useMissionParticipants = (
  missionId: string,
): { data: MissionParticipant[]; isLoading: boolean } => {
  const missionService = useMissionService();

  const { data = [], isLoading } = useQuery<MissionParticipant[]>({
    queryKey: queryKeys.mission.participants(missionId),
    queryFn: () => missionService.listMissionParticipants(missionId),
    enabled: missionId.length > 0,
  });

  return { data, isLoading };
};
