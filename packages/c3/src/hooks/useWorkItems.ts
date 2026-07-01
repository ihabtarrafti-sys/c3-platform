/**
 * useWorkItems — Sprint 11 (Command Center: Operational Work Queue)
 *               Sprint 12 (Mission Milestones: Planning Spine)
 *
 * Composition hook. Wires existing cached data into the WorkItem generation
 * engine. No new fetches beyond what the Situation Room already triggers.
 *
 * Data flow:
 *   useOperationalGaps() → OperationalGap[]   (rolling-window urgency)
 *   useMissions()        → Mission[]           (all statuses; generator filters internally)
 *   useAllMilestones()   → MissionMilestone[]  (all milestones; generator filters internally)
 *         ↓
 *   generateWorkItems(gaps, missions, milestones)
 *         ↓
 *   WorkItem[]  (sorted: Immediate → High → Normal)
 *
 * Cache coherence:
 *   WorkItems recompute whenever useOperationalGaps, useMissions, or
 *   useAllMilestones invalidates. useMarkMilestoneComplete invalidates
 *   milestone.all() on success — the completed milestone's WorkItem
 *   disappears on the next render cycle.
 *
 * Design note (Sprint 11):
 *   CredentialAcquisition vs CredentialRenewal is discriminated by
 *   OperationalGap.daysToExpiry === null. Should migrate to explicit
 *   obligation status in a future sprint.
 *
 * Ref: docs/architecture/WorkItem Model — Sprint 11 Design.md
 * Ref: docs/releases/Sprint 12 Proposal.md
 */

import { useMemo } from 'react';

import { useOperationalGaps } from '@c3/hooks/useOperationalGaps';
import { useMissions } from '@c3/hooks/useMissions';
import { useAllMilestones } from '@c3/hooks/useAllMilestones';
import { useAllMissionParticipants } from '@c3/hooks/useAllMissionParticipants';
import { generateWorkItems } from '@c3/utils/workItemGenerators';
import type { WorkItem, WorkItemPriority } from '@c3/types';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface WorkItemCounts {
  immediate: number;
  high: number;
  normal: number;
  total: number;
}

export interface UseWorkItemsResult {
  /** All WorkItems, sorted Immediate → High → Normal. */
  items: WorkItem[];
  /** Pre-computed counts per priority band. Single-pass — no re-sort. */
  counts: WorkItemCounts;
  /** True while gaps, missions, or milestones are still loading. */
  isLoading: boolean;
  /** First error encountered across data sources, or null if all succeeded. */
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the computed operational work queue.
 *
 * Items are generated from all OperationalGaps, all Missions, and all
 * MissionMilestones. Each generator filters its input internally:
 *   - Gap generator: ADR-002 gate + 30-day departure window
 *   - Milestone generator: ADR-002 gate + Overdue/DueSoon status only
 *
 * No filter parameters are exposed here — the Command Center shows the
 * full shared queue, unscoped.
 *
 * Re-computes only when underlying data changes. Stable during loading —
 * returns empty items and zero counts until all three sources are ready.
 */
export const useWorkItems = (): UseWorkItemsResult => {
  const { gaps, isLoading: gapsLoading, error: gapsError }         = useOperationalGaps();
  const { data: missions = [], isLoading: missionsLoading, error: missionsError }   = useMissions();
  const { data: milestones = [], isLoading: milestonesLoading, error: milestonesError } = useAllMilestones();
  const {
    participantPersonIdsByMission,
    isLoading: participantsLoading,
    error: participantsError,
  } = useAllMissionParticipants();

  const isLoading = gapsLoading || missionsLoading || milestonesLoading || participantsLoading;
  const error = gapsError ?? missionsError ?? milestonesError ?? participantsError ?? null;

  const items = useMemo<WorkItem[]>(() => {
    if (isLoading) return [];
    return generateWorkItems(gaps, missions, milestones, participantPersonIdsByMission);
  }, [gaps, missions, milestones, participantPersonIdsByMission, isLoading]);

  const counts = useMemo<WorkItemCounts>(() => {
    const zero: WorkItemCounts = { immediate: 0, high: 0, normal: 0, total: 0 };
    if (items.length === 0) return zero;

    return items.reduce<WorkItemCounts>((acc, item) => {
      acc.total++;
      const key = item.priority.toLowerCase() as Lowercase<WorkItemPriority>;
      acc[key]++;
      return acc;
    }, { ...zero });
  }, [items]);

  return { items, counts, isLoading, error };
};
