/**
 * workItemGenerators/milestoneGenerators.ts
 *
 * Milestone WorkItem generator: MilestoneAlert.
 *
 * Surfaces milestones that are Overdue or DueSoon across all ADR-002-eligible
 * missions. One WorkItem per qualifying milestone.
 *
 * Sprint 12 (Mission Milestones: Planning Spine) — original implementation.
 * Sprint 14 S14-3: extracted from the monolithic workItemGenerators.ts.
 *
 * Deterministic WorkItem ID:
 *   MilestoneAlert: ml-{milestoneId}
 */

import type { WorkItem, WorkItemTrigger } from '@c3/types';
import type { Mission } from '@c3/types';
import type { MissionMilestone } from '@c3/types';
import { MISSION_OBLIGATION_ACTIVE_STATUSES } from '@c3/types';
import { computeMilestoneStatus, computeMilestoneDaysUntilDue } from '../milestoneUtils';
import { computeWorkItemPriority } from '../workItemPriority';
import { getDaysUntilDeparture } from './helpers';

/**
 * Generate MilestoneAlert WorkItems for all ADR-002-eligible missions.
 *
 * Surfaces milestones that are Overdue or DueSoon — the two states where
 * operator action is needed before mission departure.
 *
 * One WorkItem per qualifying milestone. ID: ml-{milestoneId}.
 *
 * Milestones that are Complete, Upcoming, or Blocked are not surfaced:
 *   - Complete: no action required
 *   - Upcoming: not yet within the action window (> 7 days)
 *   - Blocked: dependency not met; actioning this milestone requires
 *              resolving the dependency first (v1: not enforced)
 */
export const generateMilestoneWorkItems = (
  missions: Mission[],
  allMilestones: MissionMilestone[],
): WorkItem[] => {
  const items: WorkItem[] = [];

  // Index milestones by MissionID for O(1) lookup per mission.
  const milestonesByMission = new Map<string, MissionMilestone[]>();
  for (const milestone of allMilestones) {
    const existing = milestonesByMission.get(milestone.MissionID);
    if (existing) {
      existing.push(milestone);
    } else {
      milestonesByMission.set(milestone.MissionID, [milestone]);
    }
  }

  // Only ADR-002-eligible missions generate milestone WorkItems.
  const eligibleMissions = missions.filter((m) =>
    MISSION_OBLIGATION_ACTIVE_STATUSES.includes(m.Status),
  );

  for (const mission of eligibleMissions) {
    const missionMilestones = milestonesByMission.get(mission.MissionID) ?? [];
    const daysUntilDeparture = getDaysUntilDeparture(mission);

    for (const milestone of missionMilestones) {
      const status = computeMilestoneStatus(milestone);

      // Only Overdue and DueSoon milestones generate WorkItems.
      if (status !== 'Overdue' && status !== 'DueSoon') continue;

      // computeMilestoneDaysUntilDue returns null only for Complete milestones,
      // which are filtered above. Cast is safe.
      const daysUntilDue = computeMilestoneDaysUntilDue(milestone) as number;

      const trigger: WorkItemTrigger = {
        type: 'MilestoneGap',
        missionId: mission.MissionID,
        missionName: mission.Name,
        milestoneId: milestone.MilestoneID,
        milestoneName: milestone.Name,
        daysUntilDue,
        daysUntilDeparture,
      };

      const title =
        status === 'Overdue'
          ? `${milestone.Name} — overdue · ${mission.Name}`
          : `${milestone.Name} — due in ${daysUntilDue}d · ${mission.Name}`;

      const detailParts: string[] = [milestone.Category];
      if (milestone.Owner) detailParts.push(milestone.Owner);
      const detail = detailParts.join(' · ');

      items.push({
        id: `ml-${milestone.MilestoneID}`,
        category: 'MilestoneAlert',
        title,
        detail,
        owner: milestone.Owner,
        ownerSource: milestone.Owner ? 'ProtocolDefault' : 'Unrouted',
        dueDate: milestone.PlannedDate,
        blockingMission: mission.Name,
        status: 'Open',
        trigger,
        links: { missionId: mission.MissionID },
        priority: computeWorkItemPriority(
          'MilestoneAlert',
          trigger,
          mission.Name,
          daysUntilDeparture,
        ),
      });
    }
  }

  return items;
};
