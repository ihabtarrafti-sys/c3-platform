import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { MissionParticipant } from '@c3/types';

/**
 * Fetches all MissionParticipant records across all missions and derives a
 * participantPersonIdsByMission Map for the WorkItem generation pipeline.
 *
 * Sprint 14 S14-2: introduced to replace Mission.ParticipantPersonIDs as the
 * authoritative source of participant identity in workItemGenerators.ts.
 *
 * The hook returns both the raw array (allParticipants) and the pre-built
 * Map (participantPersonIdsByMission) — the Map is the primary consumer-facing
 * output; allParticipants is exposed for any consumer that needs the full record.
 *
 * Design note: a single batch call (listAllMissionParticipants) is preferred over
 * per-mission calls because useWorkItems already holds Mission[] and does not need
 * to issue N per-mission fetches. The SP implementation will back this with a
 * single list query (SELECT * FROM MissionParticipants WHERE Status = 'Active').
 *
 * Ref: ADR-001 — parallel factory pattern
 * Ref: Sprint 14 S14-2 — participant representation
 */
export const useAllMissionParticipants = (): {
  allParticipants:              MissionParticipant[];
  participantPersonIdsByMission: Map<string, string[]>;
  isLoading:                    boolean;
} => {
  const missionService = useMissionService();

  const { data: allParticipants = [], isLoading } = useQuery<MissionParticipant[]>({
    queryKey: queryKeys.mission.allParticipants(),
    queryFn:  () => missionService.listAllMissionParticipants(),
  });

  // Build missionId → personIds map once per data change.
  // Each MissionParticipant.PersonID is in the same namespace as
  // Person.PersonID, Credential.HolderPersonID, and Journey.PersonID.
  const participantPersonIdsByMission = useMemo<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    for (const p of allParticipants) {
      const list = map.get(p.MissionID) ?? [];
      list.push(p.PersonID);
      map.set(p.MissionID, list);
    }
    return map;
  }, [allParticipants]);

  return { allParticipants, participantPersonIdsByMission, isLoading };
};
