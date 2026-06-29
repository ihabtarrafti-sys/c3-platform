/**
 * workItemGenerators/helpers.ts
 *
 * Shared constants and pure helper functions used across the WorkItem
 * generation pipeline. No React, no hooks, no side effects.
 *
 * Sprint 14 S14-3: extracted from the monolithic workItemGenerators.ts.
 * These were all private helpers in the original file — they are exported
 * here so that the sibling modules (gapGenerators, missionGenerators,
 * milestoneGenerators) and index.ts can import them without circular deps.
 */

import type {
  WorkItem,
  OwnerSource,
} from '@c3/types';
import type { OperationalGap, UrgencyTier } from '@c3/types';
import type { Mission } from '@c3/types';
import type { CredentialCapability } from '@c3/types';
import { daysUntilExpiry } from '@c3/utils/urgency';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Departure window: Confirmed missions within this many days trigger pressure items. */
export const DEPARTURE_PRESSURE_WINDOW_DAYS = 30;

/** Urgency sort order (lower index = higher urgency). */
export const URGENCY_ORDER: Record<UrgencyTier, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
};

/** Priority sort order (lower index = higher priority). */
export const PRIORITY_ORDER: Record<WorkItem['priority'], number> = {
  Immediate: 0,
  High: 1,
  Normal: 2,
};

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

/**
 * Convert a CredentialCapability (PascalCase) to a URL-safe kebab-case slug
 * for use in deterministic WorkItem IDs.
 * e.g. 'RightToWork' → 'right-to-work', 'Travel' → 'travel'
 */
export const toCapabilitySlug = (cap: CredentialCapability): string =>
  String(cap)
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');

// ---------------------------------------------------------------------------
// Gap selection helpers
// ---------------------------------------------------------------------------

/**
 * Select the most urgent gap from a list.
 * Tie-breaks by daysToExpiry ascending (most imminent first); null last.
 */
export const pickMostUrgent = (gaps: OperationalGap[]): OperationalGap =>
  [...gaps].sort((a, b) => {
    const uDiff = URGENCY_ORDER[a.urgencyTier] - URGENCY_ORDER[b.urgencyTier];
    if (uDiff !== 0) return uDiff;
    if (a.daysToExpiry === null && b.daysToExpiry === null) return 0;
    if (a.daysToExpiry === null) return 1;
    if (b.daysToExpiry === null) return -1;
    return a.daysToExpiry - b.daysToExpiry;
  })[0];

/**
 * Group gaps by their satisfiedByCapability.
 * One entry per capability type; each entry holds all gaps of that type.
 */
export const groupByCapability = (
  gaps: OperationalGap[],
): Map<CredentialCapability, OperationalGap[]> => {
  const result = new Map<CredentialCapability, OperationalGap[]>();
  for (const gap of gaps) {
    const existing = result.get(gap.satisfiedByCapability);
    if (existing) {
      existing.push(gap);
    } else {
      result.set(gap.satisfiedByCapability, [gap]);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/**
 * Determine OwnerSource for a gap.
 * Follows the 4-level ownership resolution chain:
 *   1. Covered + assignedTo set → ObligationAssignment (explicit)
 *   2. Covered without assignedTo (defensive) → JourneyOwner
 *   3. Routed + assignedTo → JourneyOwner (derived)
 *   4. defaultOwner present → ProtocolDefault (suggested)
 *   5. None → Unrouted
 */
export const resolveOwnerSource = (gap: OperationalGap): OwnerSource => {
  if (gap.ownershipState === 'Covered') {
    return gap.assignedTo ? 'ObligationAssignment' : 'JourneyOwner';
  }
  if (gap.ownershipState === 'Routed' && gap.assignedTo) {
    return 'JourneyOwner';
  }
  if (gap.defaultOwner) {
    return 'ProtocolDefault';
  }
  return 'Unrouted';
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Compute an ISO date string N days from today.
 * Used to materialise a dueDate from daysToExpiry.
 */
export const isoDaysFromToday = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
};

/**
 * Days until mission departure.
 * Active missions return 0 (event is happening now — maximum pressure).
 * Confirmed missions return days until StartDate.
 */
export const getDaysUntilDeparture = (mission: Mission): number => {
  if (mission.Status === 'Active') return 0;
  return daysUntilExpiry(mission.Span.StartDate) ?? 0;
};

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

/**
 * Sort WorkItems into presentation order:
 *   1. Priority band ascending (Immediate → High → Normal)
 *   2. Within band: MissionDeparturePressure first (cross-person context-setters)
 *   3. Items with blockingMission before items without
 *   4. dueDate ascending (most imminent deadline first); absent last
 */
export const sortWorkItems = (items: WorkItem[]): WorkItem[] =>
  [...items].sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;

    const mdpA = a.category === 'MissionDeparturePressure' ? 0 : 1;
    const mdpB = b.category === 'MissionDeparturePressure' ? 0 : 1;
    if (mdpA !== mdpB) return mdpA - mdpB;

    const bMissionA = a.blockingMission ? 0 : 1;
    const bMissionB = b.blockingMission ? 0 : 1;
    if (bMissionA !== bMissionB) return bMissionA - bMissionB;

    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
