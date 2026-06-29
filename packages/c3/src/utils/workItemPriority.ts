/**
 * workItemPriority — Sprint 11 (Command Center: Operational Work Queue)
 *                   Sprint 12 (Mission Milestones: Planning Spine)
 *
 * Pure priority computation for WorkItems. No React, no hooks, no side effects.
 *
 * Priority is a WorkItem-level signal, distinct from UrgencyTier (which describes
 * a single OperationalGap). Priority incorporates mission departure proximity and
 * ownership routing state as additional signals beyond raw gap urgency.
 *
 * Rules (first match wins):
 *
 * Immediate:
 *   - MissionDeparturePressure with daysUntilDeparture ≤ 7
 *   - MilestoneAlert that is Overdue AND mission departs within 7 days
 *   - Any credential/journey item where the person participates in a mission
 *     departing within 7 days
 *
 * High:
 *   - MissionDeparturePressure with daysUntilDeparture 8–30 (always High in window)
 *   - MilestoneAlert that is Overdue (any departure) — already past; unconditional High
 *   - MilestoneAlert due within 3 days AND mission departs within 14 days
 *   - ObligationRouting where blockingMission set AND departure ≤ 14 days
 *     (capped at High — routing is an org step; credential work takes Immediate)
 *   - Any credential/journey item where person participates in mission departing 8–14 days
 *   - CredentialAcquisition or CredentialRenewal with gapUrgency Critical or High
 *   - JourneyInitiation with gapUrgency Critical (unrouted, no accountability)
 *
 * Normal:
 *   - MilestoneAlert due 4–14 days with no imminent departure pressure
 *   - ObligationRouting without imminent mission pressure
 *   - All items with gapUrgency Medium and no mission pressure
 *
 * See: docs/architecture/WorkItem Model — Sprint 11 Design.md
 * See: docs/releases/Sprint 12 Proposal.md
 */

import type { WorkItemCategory, WorkItemPriority, WorkItemTrigger } from '@c3/types';

/**
 * Compute the priority of a WorkItem from its category, trigger, and mission context.
 *
 * @param category                   The WorkItem category.
 * @param trigger                    The WorkItem trigger (carries urgency or departure data).
 * @param blockingMission            The name of the mission this item is blocking (if any).
 * @param daysUntilBlockingMission   Days until the blocking mission departs. 0 = Active now.
 *                                   Null if no blocking mission applies.
 */
export const computeWorkItemPriority = (
  category: WorkItemCategory,
  trigger: WorkItemTrigger,
  blockingMission: string | undefined,
  daysUntilBlockingMission: number | null,
): WorkItemPriority => {

  // ── MissionDeparturePressure ────────────────────────────────────────────
  // Priority driven entirely by departure proximity. All MDP items are
  // within the 30-day window, so minimum is High.
  if (category === 'MissionDeparturePressure') {
    if (trigger.type !== 'MissionDeparture') return 'High'; // defensive
    return trigger.daysUntilDeparture <= 7 ? 'Immediate' : 'High';
  }

  // ── MilestoneAlert ──────────────────────────────────────────────────────
  // Overdue milestones are a planning failure that has already occurred.
  // They warrant High unconditionally — the window to act without consequence
  // is already shrinking. Only Immediate if the mission is also departing
  // imminently (compounding pressure).
  if (category === 'MilestoneAlert') {
    if (trigger.type !== 'MilestoneGap') return 'Normal'; // defensive
    const { daysUntilDue, daysUntilDeparture } = trigger;

    if (daysUntilDue < 0 && daysUntilDeparture <= 7) return 'Immediate';
    if (daysUntilDue < 0) return 'High';
    if (daysUntilDue <= 3 && daysUntilDeparture <= 14) return 'High';
    return 'Normal';
  }

  // ── ObligationRouting ────────────────────────────────────────────────────
  // Routing is an organisational step. Caps at High — credential work should
  // take Immediate if available. Without mission pressure: always Normal.
  if (category === 'ObligationRouting') {
    if (
      blockingMission &&
      daysUntilBlockingMission !== null &&
      daysUntilBlockingMission <= 14
    ) {
      return 'High';
    }
    return 'Normal';
  }

  // ── Mission pressure (person-scoped items) ────────────────────────────────
  // Applies to JourneyInitiation, CredentialAcquisition, CredentialRenewal.
  // A person participating in a departing mission elevates their work items.
  if (blockingMission && daysUntilBlockingMission !== null) {
    if (daysUntilBlockingMission <= 7) return 'Immediate';
    if (daysUntilBlockingMission <= 14) return 'High';
    // 15–30 days: mission context noted but not within escalation window.
    // Fall through to gap-urgency-driven priority.
  }

  // ── Gap-urgency-driven priority ──────────────────────────────────────────
  if (trigger.type !== 'OperationalGap') return 'Normal'; // defensive

  const { gapUrgency } = trigger;

  switch (category) {
    case 'CredentialAcquisition':
    case 'CredentialRenewal':
      // Critical: no credential (acquisition) or expired (renewal)
      // High: credential expiring ≤ 30 days — both warrant High WorkItem priority
      if (gapUrgency === 'Critical' || gapUrgency === 'High') return 'High';
      return 'Normal';

    case 'JourneyInitiation':
      // Critical underlying gap means no one is accountable for this person's readiness.
      if (gapUrgency === 'Critical') return 'High';
      return 'Normal';

    default:
      return 'Normal';
  }
};
