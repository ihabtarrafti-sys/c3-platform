import { useMemo } from 'react';

import { useAllMissionParticipants } from '@c3/hooks/useAllMissionParticipants';
import { useMissions } from '@c3/hooks/useMissions';
import type { Mission, MissionParticipantRole } from '@c3/types';

/**
 * A person's mission assignment joined with the mission record — the
 * PersonProfile "Missions (n)" section row shape.
 */
export interface PersonMissionRow {
  mission: Mission;
  role: MissionParticipantRole;
}

/**
 * Returns the missions a person is assigned to, with their participant role.
 *
 * Thin composition of two existing cached queries — useAllMissionParticipants
 * and useMissions — filtered by PersonID and joined by MissionID. No new
 * network calls when either cache is already warm (PersonProfile after
 * MissionWorkspace navigation, for example).
 *
 * Assignments whose MissionID does not resolve to a mission record are
 * dropped from the rows (the assignment exists but there is nothing to
 * render or navigate to); this is a display concern, not an FK validation.
 *
 * Rows sorted by Span.StartDate ascending (soonest mission first) — matches
 * the mission list convention.
 *
 * Sprint 28 (S28-3).
 */
export const usePersonMissions = (
  personId: string,
): { rows: PersonMissionRow[]; isLoading: boolean } => {
  const { allParticipants, isLoading: participantsLoading } = useAllMissionParticipants();
  const { data: missions = [], isLoading: missionsLoading } = useMissions();

  const rows = useMemo<PersonMissionRow[]>(() => {
    if (!personId) return [];
    const missionById = new Map(missions.map(m => [m.MissionID, m]));
    return allParticipants
      .filter(p => p.PersonID === personId)
      .flatMap(p => {
        const mission = missionById.get(p.MissionID);
        return mission ? [{ mission, role: p.Role }] : [];
      })
      .sort((a, b) => a.mission.Span.StartDate.localeCompare(b.mission.Span.StartDate));
  }, [allParticipants, missions, personId]);

  return { rows, isLoading: participantsLoading || missionsLoading };
};
