import type {
  CreateKitAssignmentInput,
  DeactivateKitAssignmentRequest,
  KitAssignment,
  KitStatusTransitionRequest,
  Mission,
  MissionFilter,
  MissionParticipant,
  MissionParticipantRole,
  MissionStatus,
} from '@c3/types';

// ---------------------------------------------------------------------------
// S29B participant write requests/results (service-layer shapes — the frozen
// MissionParticipant domain type is unchanged). actorLoginName comes from the
// authenticated AppContext only; services fail closed on empty.
// ---------------------------------------------------------------------------

export interface AddMissionParticipantRequest {
  MissionID: string;
  PersonID: string;
  ExternalCode: string;
  Role: MissionParticipantRole;
  PerDiemRate?: number;
  actorLoginName: string;
}

export interface AddMissionParticipantResult {
  participant: MissionParticipant;
  outcome: 'created' | 'reactivated' | 'already-applied';
}

export interface RemoveMissionParticipantRequest {
  MissionID: string;
  PersonID: string;
  /** Mandatory audit justification. */
  reason: string;
  actorLoginName: string;
}

export interface RemoveMissionParticipantResult {
  outcome: 'removed' | 'already-inactive';
}

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
   * S33 Correction Set D — authoritative membership-state read for ONE exact
   * canonical MissionID + PersonID pair, INCLUDING inactive historical rows.
   * Drives the submission-time guard (utils/participantSubmissionGuard):
   * the active-only list queries must never be used to infer absence.
   * THROWS on read failure (the guard fails closed — callers must not treat
   * an error as "no rows").
   */
  getParticipantMembershipStates(
    missionId: string,
    personId: string,
  ): Promise<{ isActive: boolean }[]>;

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
   * Executes an approved AddMissionParticipant (S29B — full ADR-013; called
   * ONLY from useExecuteApproval after owner approval, or directly in Mock DSM).
   *
   * Idempotent contract (resolves ALL rows for MissionID+PersonID, incl. inactive):
   *   0 rows       → POST → outcome 'created'
   *   1 inactive   → governed reactivation (ETag MERGE; fields refreshed) → 'reactivated'
   *   1 active     → exact payload match → 'already-applied' (no write);
   *                  mismatch → throws ParticipantConflictError
   *   multiple     → throws DataIntegrityError (no write)
   */
  addMissionParticipant(req: AddMissionParticipantRequest): Promise<AddMissionParticipantResult>;

  /**
   * Executes an approved RemoveMissionParticipant (S29B — full ADR-013).
   * Sets IsActive=false on the exact active row (ETag MERGE) — never deletes.
   * Re-checks the active-kit dependency authoritatively before writing.
   * An already-inactive row → outcome 'already-inactive' (stamp recovery).
   */
  removeMissionParticipant(req: RemoveMissionParticipantRequest): Promise<RemoveMissionParticipantResult>;

  /**
   * Creates a kit assignment (S29A — ADR-013 Addendum: Mission Kit Logistics
   * Exemption; role-gated owner/operations). Initial KitStatus is ALWAYS
   * 'NotOrdered'. Guards: active-participant check, compound duplicate
   * protection. Throws domain errors — never fails silently.
   */
  createKitAssignment(input: CreateKitAssignmentInput): Promise<KitAssignment>;

  /**
   * Transitions a kit assignment's KitStatus (S29A lifecycle exemption).
   * Validated against the approved transition matrix (utils/kitLifecycle.ts);
   * service validation is authoritative. Appends a StatusNotes audit line.
   * Reason mandatory into Returned/Missing/Replaced. ETag concurrency.
   */
  transitionKitStatus(req: KitStatusTransitionRequest): Promise<KitAssignment>;

  /**
   * Deactivates a kit assignment (S29A lifecycle exemption): IsActive=false,
   * mandatory reason, StatusNotes audit line. The row is retained for
   * history — never physically deleted. ETag concurrency.
   */
  deactivateKitAssignment(req: DeactivateKitAssignmentRequest): Promise<void>;

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
