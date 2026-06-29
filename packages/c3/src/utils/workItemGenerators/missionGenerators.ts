/**
 * workItemGenerators/missionGenerators.ts
 *
 * Mission-level WorkItem generator: MissionDeparturePressure.
 *
 * One departure pressure item per upcoming mission that has at least one
 * participant with an open gap. These are cross-person context-setters:
 * they surface the operational risk of a mission departure before the
 * individual credential items do.
 *
 * Sprint 14 S14-3: extracted from the monolithic workItemGenerators.ts.
 * Sprint 14 S14-2: participantPersonIdsByMission replaces Mission.ParticipantPersonIDs.
 *
 * Deterministic WorkItem ID:
 *   MissionDeparturePressure: mdp-{missionId}
 */

import type { WorkItem, WorkItemTrigger } from '@c3/types';
import type { OperationalGap } from '@c3/types';
import type { Mission } from '@c3/types';
import { computeWorkItemPriority } from '../workItemPriority';
import { getDaysUntilDeparture } from './helpers';

/**
 * Generate a MissionDeparturePressure item for an upcoming mission with open gaps.
 * One item per mission — cross-person context-setter for the Situation Room.
 *
 * Only generated when at least one participant has an open gap.
 * Returns null if no gaps found for any participant.
 *
 * @param mission                      The upcoming Mission.
 * @param gapsByPerson                 All OperationalGaps grouped by personId.
 * @param participantPersonIdsByMission Map of missionId → personId[] (S14-2).
 */
export const generateMissionDeparturePressure = (
  mission: Mission,
  gapsByPerson: Map<string, OperationalGap[]>,
  participantPersonIdsByMission: Map<string, string[]>,
): WorkItem | null => {
  const days = getDaysUntilDeparture(mission);
  let criticalCount = 0;
  let highCount = 0;
  let totalGaps = 0;
  const affectedPersonIds = new Set<string>();

  for (const personId of (participantPersonIdsByMission.get(mission.MissionID) ?? [])) {
    const personGaps = gapsByPerson.get(personId) ?? [];
    if (personGaps.length === 0) continue;
    affectedPersonIds.add(personId);
    for (const gap of personGaps) {
      totalGaps++;
      if (gap.urgencyTier === 'Critical') criticalCount++;
      else if (gap.urgencyTier === 'High') highCount++;
    }
  }

  if (totalGaps === 0) return null;

  const p = affectedPersonIds.size;
  const trigger: WorkItemTrigger = {
    type: 'MissionDeparture',
    missionId: mission.MissionID,
    openGapCount: totalGaps,
    daysUntilDeparture: days,
  };

  return {
    id: `mdp-${mission.MissionID}`,
    category: 'MissionDeparturePressure',
    title: `${mission.Name} departs in ${days} day${days !== 1 ? 's' : ''} with open gaps`,
    detail: `${criticalCount} critical · ${highCount} high · ${p} participant${p !== 1 ? 's' : ''} affected`,
    owner: undefined,
    ownerSource: 'Unrouted',
    dueDate: mission.Span.StartDate,
    blockingMission: mission.Name,
    status: 'Open',
    trigger,
    links: { missionId: mission.MissionID },
    priority: computeWorkItemPriority(
      'MissionDeparturePressure',
      trigger,
      mission.Name,
      days,
    ),
  };
};
