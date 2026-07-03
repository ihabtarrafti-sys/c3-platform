import type { KitAssignment, Mission, MissionFilter, MissionParticipant, MissionStatus } from '@c3/types';

/**
 * IMissionService — Mission domain service interface.
 *
 * Follows the parallel factory pattern established in ADR-001. All mission
 * data access goes through this interface; components and hooks never call
 * service implementations directly.
 *
 * Read methods return empty arrays or null rather than throwing on not-found.
 * Write methods (confirmMission, updateMissionStatus) throw if they cannot
 * complete, since callers depend on the returned Mission object.
 *
 * Sprint 10 (M10-1) — mock implementation only.
 * SharePoint implementation is a graceful stub (blocked on IT access and SP
 * list schema design for the Missions list).
 */
export interface IMissionService {
  /**
   * Returns all Missions, optionally filtered by status and/or entity.
   * Results are ordered by Span.StartDate ascending (soonest first).
   */
  listMissions(filter?: MissionFilter): Promise<Mission[]>;

  /**
   * Returns a single Mission by its TR code ID, or null if not found.
   */
  getMission(missionId: string): Promise<Mission | null>;

  /**
   * Returns all participants for a Mission.
   * Returns an empty array if the Mission does not exist or has no participants.
   */
  listMissionParticipants(missionId: string): Promise<MissionParticipant[]>;

  /**
   * Returns all MissionParticipant records across all missions.
   *
   * Used by useAllMissionParticipants to build a participantPersonIdsByMission
   * Map for WorkItem generation. Introduced in S14-2 to replace
   * Mission.ParticipantPersonIDs as the authoritative participant source.
   *
   * Returns an empty array rather than throwing on failure.
   */
  listAllMissionParticipants(): Promise<MissionParticipant[]>;

  /**
   * Returns all active kit assignments for a Mission (S28-2, read-only).
   * Returns an empty array if the Mission has no assignments or the
   * C3MissionKitAssignments list is not provisioned (404-safe).
   */
  listKitAssignments(missionId: string): Promise<KitAssignment[]>;

  /**
   * Returns all active kit assignments across all missions (S28-2).
   * Batch call for MissionWorkspace — grouped locally by consumer
   * (no per-card queries). Returns an empty array rather than throwing.
   */
  listAllKitAssignments(): Promise<KitAssignment[]>;

  /**
   * Transitions a Mission from FinancePending to Confirmed.
   *
   * This is the ADR-002 activation gate: calling this method causes the Mission
   * to begin generating operational obligations for its participants. The
   * returned Mission will have Status === 'Confirmed' and ConfirmedAt set.
   *
   * In mock mode: updates the in-memory store.
   * In SharePoint mode: not yet implemented (throws).
   * Authority controls (who may confirm) are deferred to a future sprint.
   */
  confirmMission(missionId: string, confirmedBy: string): Promise<Mission>;

  /**
   * Updates the status of a Mission.
   * Used to transition through the lifecycle (Active, PostMission, Settled, Canceled).
   * Throws if the requested transition is not valid for the current status.
   */
  updateMissionStatus(missionId: string, status: MissionStatus): Promise<Mission>;
}
