/**
 * workItemGenerators/readinessGenerators.ts
 *
 * Mission-readiness WorkItem generator — Sprint 30 (Mission Readiness Cockpit).
 *
 * v1 emits exactly ONE condition: the zero-roster blind spot.
 *
 *   MissionStatus is Confirmed or Active
 *   AND the mission is inside the existing departure-pressure window
 *       (callers pass the same `upcomingMissions` set MDP uses: Active always,
 *       Confirmed within DEPARTURE_PRESSURE_WINDOW_DAYS; PostMission excluded)
 *   AND the mission has ZERO active participants.
 *
 * Why this exists: MissionDeparturePressure requires at least one open gap,
 * and zero participants produce zero gaps by construction — so a committed
 * mission with no roster generated no work item anywhere before Sprint 30.
 *
 * Non-duplication contract: MDP and this item are mutually exclusive for the
 * same mission BY CONSTRUCTION — MDP needs gaps (which need participants);
 * this item needs zero participants. No dedupe pass is required.
 *
 * Disappearance: the item vanishes on the next recompute when any participant
 * is added (governed execution), when the mission leaves Confirmed/Active, or
 * when a Confirmed mission's StartDate passes without activation (it drops out
 * of the departure window).
 *
 * Work-item contract (Sprint 30 approved):
 *   id            mrg-{missionId}-participants   (deterministic; facet-scoped so a
 *                                                 future kit trigger becomes
 *                                                 mrg-{missionId}-kit without renaming)
 *   owner         'Operations' via ProtocolDefault — roster assembly is an
 *                 Operations function; no person-level owner exists for an
 *                 empty roster.
 *   dueDate       Mission.Span.StartDate (the binding deadline).
 *   priority      computeWorkItemPriority: ≤7 days → Immediate, else High.
 *   navigation    links.missionId only — Command Center routes this category to
 *                 the Missions workspace, where "+ Add participant" lives.
 */

import type { Mission, WorkItem, WorkItemTrigger } from '@c3/types';
import { computeWorkItemPriority } from '../workItemPriority';
import { getDaysUntilDeparture } from './helpers';

/**
 * Generate the zero-roster readiness item for one upcoming mission.
 *
 * @param mission                        An upcoming mission (Active, or Confirmed
 *                                       inside the departure window). Callers
 *                                       filter — this function trusts the set.
 * @param participantPersonIdsByMission  Map of missionId → active personIds
 *                                       (S14-2 authoritative participant source).
 * @returns The WorkItem, or null when the mission has at least one participant.
 */
export const generateMissionReadinessGap = (
  mission: Mission,
  participantPersonIdsByMission: Map<string, string[]>,
): WorkItem | null => {
  const participantIds = participantPersonIdsByMission.get(mission.MissionID) ?? [];
  if (participantIds.length > 0) return null;

  const days = getDaysUntilDeparture(mission);

  const trigger: WorkItemTrigger = {
    type: 'MissionReadinessGap',
    missionId: mission.MissionID,
    facet: 'Participants',
    daysUntilDeparture: days,
  };

  return {
    id: `mrg-${mission.MissionID}-participants`,
    category: 'MissionReadinessGap',
    title: `${mission.Name} has no participants assigned`,
    detail:
      mission.Status === 'Active'
        ? 'Mission is active with an empty roster — assign participants now'
        : `Departs in ${days} day${days !== 1 ? 's' : ''} · roster must be assigned before departure`,
    owner: 'Operations',
    ownerSource: 'ProtocolDefault',
    dueDate: mission.Span.StartDate,
    blockingMission: mission.Name,
    status: 'Open',
    trigger,
    links: { missionId: mission.MissionID },
    priority: computeWorkItemPriority(
      'MissionReadinessGap',
      trigger,
      mission.Name,
      days,
    ),
  };
};
