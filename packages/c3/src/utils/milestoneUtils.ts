/**
 * milestoneUtils — Sprint 12 (Mission Milestones: Planning Spine)
 *
 * Pure functions for computing milestone state.
 * No React, no hooks, no side effects.
 *
 * Entry points:
 *   computeMilestoneDaysUntilDue(milestone) → number | null
 *   computeMilestoneStatus(milestone)        → MilestoneStatus
 *   computeMilestoneView(milestone)          → MissionMilestoneView
 */

import type { MissionMilestone, MilestoneStatus, MissionMilestoneView } from '@c3/types';
import { daysUntilExpiry } from './urgency';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milestones within this many days of their PlannedDate are DueSoon. */
export const MILESTONE_DUE_SOON_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// computeMilestoneDaysUntilDue
// ---------------------------------------------------------------------------

/**
 * Compute the number of days until (or since) the milestone's PlannedDate.
 *
 * Delegates to daysUntilExpiry for midnight-normalised UTC date arithmetic,
 * consistent with how credential expiry and departure windows are computed.
 *
 * Returns null if the milestone is already Complete (CompletedDate is set),
 * since deadline proximity is irrelevant once done.
 * Returns a negative number if PlannedDate has already passed.
 * Returns zero if PlannedDate is today.
 */
export const computeMilestoneDaysUntilDue = (
  milestone: MissionMilestone,
): number | null => {
  if (milestone.CompletedDate) return null;
  return daysUntilExpiry(milestone.PlannedDate);
};

// ---------------------------------------------------------------------------
// computeMilestoneStatus
// ---------------------------------------------------------------------------

/**
 * Compute the current MilestoneStatus from stored milestone fields.
 *
 * Status rules (first-match):
 *   Complete  — CompletedDate is set.
 *   Blocked   — Any DependsOn entry resolves to a non-Complete milestone.
 *               In v1 this check is always skipped (no dependency context
 *               available at the utils layer). Blocked milestones require
 *               a caller-level check with the full milestone list.
 *   Overdue   — PlannedDate has passed (daysUntilDue < 0). CompletedDate null.
 *   DueSoon   — PlannedDate is within MILESTONE_DUE_SOON_THRESHOLD_DAYS.
 *   Upcoming  — PlannedDate is further out.
 *
 * Note: Blocked status computation is deferred to the service layer where the
 * full milestone list is available. This function never returns 'Blocked';
 * it is reserved for future use by the batch-aware computation path.
 */
export const computeMilestoneStatus = (
  milestone: MissionMilestone,
): MilestoneStatus => {
  if (milestone.CompletedDate) return 'Complete';

  const days = computeMilestoneDaysUntilDue(milestone);

  // days is null only when CompletedDate is set — handled above.
  const d = days as number;

  if (d < 0) return 'Overdue';
  if (d <= MILESTONE_DUE_SOON_THRESHOLD_DAYS) return 'DueSoon';
  return 'Upcoming';
};

// ---------------------------------------------------------------------------
// computeMilestoneView
// ---------------------------------------------------------------------------

/**
 * Extend a raw MissionMilestone with computed fields for UI rendering.
 *
 * Use this whenever a component needs to display milestone status or
 * remaining/overdue day counts. Never store the result — recompute on render.
 */
export const computeMilestoneView = (
  milestone: MissionMilestone,
): MissionMilestoneView => ({
  ...milestone,
  status:       computeMilestoneStatus(milestone),
  daysUntilDue: computeMilestoneDaysUntilDue(milestone),
});
