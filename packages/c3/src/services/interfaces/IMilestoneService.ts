import type { MissionMilestone } from '@c3/types';

/**
 * IMilestoneService — Milestone domain service interface.
 *
 * Follows the parallel factory pattern established in ADR-001. All milestone
 * data access goes through this interface; components and hooks never call
 * service implementations directly.
 *
 * Read methods return empty arrays or null rather than throwing on not-found.
 * Write method (completeMilestone) throws if it cannot complete, since the
 * caller depends on the returned MissionMilestone object being in the new state.
 *
 * Sprint 12 — two read methods + one write method.
 * Mock implementation: in-memory seed data for TR/2026/006.
 * SharePoint implementation: graceful stub (blocked on list schema design).
 */
export interface IMilestoneService {
  /**
   * Returns all milestones for a given mission, ordered by PlannedDate ascending.
   *
   * Returns an empty array if no milestones exist for the mission or the
   * missionId is not found. Never throws for missing missions.
   */
  listMissionMilestones(missionId: string): Promise<MissionMilestone[]>;

  /**
   * Returns milestones for all missions in a single batch call.
   *
   * Used by useAllMilestones (Sprint 12-2) to feed the WorkItem generator
   * without issuing N separate queries. Avoids N+1 for work queue composition.
   *
   * Returns an empty array if no milestones exist.
   */
  listAllMilestones(): Promise<MissionMilestone[]>;

  /**
   * Marks a milestone as complete.
   *
   * Sets CompletedDate to today's ISO date on the stored record. Returns the
   * updated MissionMilestone.
   *
   * Throws if:
   *   - The milestoneId does not exist.
   *   - The milestone is already complete.
   *
   * In mock mode: updates the in-memory store and returns the new record.
   * In SharePoint mode: not yet implemented (throws).
   */
  completeMilestone(milestoneId: string): Promise<MissionMilestone>;
}
