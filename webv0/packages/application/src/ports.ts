/**
 * ports.ts — the persistence contract the application depends on (hexagonal
 * boundary). @c3web/persistence implements these; the application NEVER imports
 * persistence. apps/api wires a concrete implementation in.
 *
 * Every method is tenant-scoped: implementations run under a DB transaction
 * bound to the actor's tenant (application-layer enforcement) with PostgreSQL
 * RLS as defense in depth.
 */

import type {
  Actor,
  Agreement,
  Apparel,
  Approval,
  ApprovalEvent,
  ApprovalStatus,
  AuditEvent,
  C3Role,
  Credential,
  Journey,
  JourneyStatus,
  Kit,
  Member,
  Mission,
  MissionParticipant,
  Person,
} from '@c3web/domain';

/** Read-only, tenant-scoped views. */
export interface ReadStore {
  listPeople(): Promise<Person[]>;
  getPersonById(personId: string): Promise<Person | null>;
  listApprovals(filter?: { statuses?: ApprovalStatus[] }): Promise<Approval[]>;
  getApprovalById(approvalId: string): Promise<Approval | null>;
  listApprovalEvents(approvalId: string): Promise<ApprovalEvent[]>;
  listAuditEventsForEntity(entityType: string, entityId: string): Promise<AuditEvent[]>;
  /** Tenant-scoped member directory (via the member_list gateway; Sprint 35). */
  listMembers(): Promise<Member[]>;
  // Sprint 36: credentials (plain ISO dates end-to-end).
  listCredentials(): Promise<Credential[]>;
  listCredentialsForPerson(personId: string): Promise<Credential[]>;
  getCredentialById(credentialId: string): Promise<Credential | null>;
  // Sprint 37: journeys.
  listJourneys(): Promise<Journey[]>;
  listJourneysForPerson(personId: string): Promise<Journey[]>;
  getJourneyById(journeyId: string): Promise<Journey | null>;
  // Sprint 38: equipment.
  listKit(): Promise<Kit[]>;
  getKitById(kitId: string): Promise<Kit | null>;
  listApparel(): Promise<Apparel[]>;
  getApparelById(apparelId: string): Promise<Apparel | null>;
  // Sprint 39: missions. Participant reads join the person's display name.
  listMissions(): Promise<Mission[]>;
  getMissionById(missionId: string): Promise<Mission | null>;
  listMissionParticipants(missionId: string): Promise<MissionParticipant[]>;
  getMissionParticipant(missionId: string, personId: string): Promise<MissionParticipant | null>;
  // Sprint 41: agreements. Financial-field omission happens in the
  // APPLICATION query layer (per-actor); the store returns full rows.
  listAgreements(): Promise<Agreement[]>;
  listAgreementsForPerson(personId: string): Promise<Agreement[]>;
  getAgreementById(agreementId: string): Promise<Agreement | null>;
  // Sprint 42: the person hub's read side.
  listMissionMembershipsForPerson(personId: string): Promise<PersonMissionMembership[]>;
  listApprovalsForPerson(personId: string): Promise<Approval[]>;
  // Sprint 43: the Situation Room snapshot (bulk, slim, one pass).
  listAllMissionParticipants(): Promise<Array<{ missionId: string; personId: string; role: string; isActive: boolean }>>;
}

/** Fields written when creating a Person during AddPerson execution. */
export interface NewPersonRow {
  readonly personId: string;
  readonly fullName: string;
  readonly ign: string | null;
  readonly nationality: string | null;
  readonly primaryRole: string | null;
  readonly personnelCode: string | null;
  readonly currentTeam: string | null;
  readonly currentGameTitle: string | null;
  readonly primaryDepartment: string | null;
  readonly notes: string | null;
  /** The approval whose execution created this person (idempotency boundary). */
  readonly createdByApprovalId: string;
}

/** Fields written when submitting a new approval. */
export interface NewApprovalRow {
  readonly approvalId: string;
  readonly operationType: Approval['operationType'];
  readonly targetPersonId: string;
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly payload: unknown;
  readonly submittedBy: string;
}

/**
 * Transactional, tenant-bound write surface. All methods execute inside the
 * single transaction opened by WriteStore.transaction and are subject to RLS.
 */
/** Fields written when creating a Credential during AddCredential execution. */
export interface NewCredentialRow {
  readonly credentialId: string;
  readonly personId: string;
  readonly credentialType: string;
  readonly issuer: string | null;
  readonly issuedOn: string; // plain ISO YYYY-MM-DD
  readonly expiresOn: string | null;
  readonly notes: string | null;
  /** The approval whose execution created this credential (idempotency boundary). */
  readonly createdByApprovalId: string;
}

/** Fields written when creating a Journey during InitiateJourney execution. */
export interface NewJourneyRow {
  readonly journeyId: string;
  readonly personId: string;
  readonly journeyType: string;
  readonly title: string | null;
  readonly startedOn: string; // plain ISO YYYY-MM-DD
  readonly notes: string | null;
  /** The approval whose execution created this journey (idempotency boundary). */
  readonly createdByApprovalId: string;
}

/** Fields written when creating an equipment item (Sprint 38, direct CRUD). */
export interface NewEquipmentRow {
  readonly name: string;
  readonly category: string;
  readonly size: string | null;
  readonly assignedPersonId: string | null;
  readonly notes: string | null;
}

/** Editable-field patch for an equipment update (only provided keys change). */
export interface EquipmentPatch {
  readonly name?: string;
  readonly category?: string;
  readonly size?: string | null;
  readonly assignedPersonId?: string | null;
  readonly notes?: string | null;
}

/** Fields written when creating a mission (Sprint 39, direct CRUD shell). */
export interface NewMissionRow {
  readonly name: string;
  readonly gameTitle: string | null;
  readonly startsOn: string; // plain ISO YYYY-MM-DD
  readonly endsOn: string | null;
  readonly notes: string | null;
}

/** Editable-field patch for a mission update (only provided keys change). */
export interface MissionPatch {
  readonly name?: string;
  readonly gameTitle?: string | null;
  readonly startsOn?: string;
  readonly endsOn?: string | null;
  readonly notes?: string | null;
}

/** Fields written when creating an Agreement during AddAgreement execution. */
export interface NewAgreementRow {
  readonly agreementId: string;
  readonly personId: string;
  readonly agreementCode: string | null;
  readonly agreementType: string;
  readonly linkedAgreementId: string | null;
  readonly startsOn: string; // plain ISO YYYY-MM-DD
  readonly endsOn: string;
  readonly valueUsdCents: number | null;
  readonly notes: string | null;
  /** The approval whose execution created this agreement (idempotency boundary). */
  readonly createdByApprovalId: string;
}

/** A person's mission membership, enriched with the mission's identity (Sprint 42). */
export interface PersonMissionMembership {
  readonly missionId: string;
  readonly missionName: string;
  readonly missionIsActive: boolean;
  readonly role: string;
  readonly isActive: boolean;
}

/** NON-MATERIAL patch for a direct agreement update (only provided keys change). */
export interface AgreementPatch {
  readonly agreementCode?: string | null;
  readonly agreementType?: string;
  readonly linkedAgreementId?: string | null;
  readonly notes?: string | null;
}

export interface WriteTx {
  /** Atomic, server-controlled business-ID allocation (never MAX+1). */
  allocateSequence(kind: 'person' | 'approval' | 'credential' | 'journey' | 'kit' | 'apparel' | 'mission' | 'agreement'): Promise<number>;

  insertApproval(row: NewApprovalRow): Promise<Approval>;

  /** SELECT ... FOR UPDATE — serialises concurrent transitions/executions. */
  lockApproval(approvalId: string): Promise<Approval | null>;

  /**
   * Optimistic status transition. Updates only when the row's current version
   * equals expectedVersion; returns null on a version mismatch (caller raises
   * ConcurrencyError). Immutable columns are DB-protected.
   */
  updateApprovalStatus(
    approvalId: string,
    expectedVersion: number,
    patch: {
      status: ApprovalStatus;
      reviewedBy?: string | null;
      reviewedAt?: string | null;
      rejectionReason?: string | null;
      executedAt?: string | null;
      executionError?: string | null;
      targetPersonId?: string;
    },
  ): Promise<Approval | null>;

  insertPerson(row: NewPersonRow): Promise<Person>;

  /** Return the person an approval already created (idempotent execute path). */
  getPersonByCreatingApproval(approvalId: string): Promise<Person | null>;

  appendApprovalEvent(evt: {
    approvalId: string;
    fromStatus: ApprovalStatus | null;
    toStatus: ApprovalStatus;
    actor: string;
    note?: string | null;
  }): Promise<void>;

  appendAuditEvent(evt: {
    entityType: string;
    entityId: string;
    action: AuditEvent['action'];
    actor: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }): Promise<void>;

  // ── Sprint 35 member gateways (SECURITY DEFINER functions; the app role has
  //    no table access to the directory — these are the ONLY member surface).
  //    Guard violations surface as domain errors (SelfAdministrationError,
  //    LastOwnerProtectionError, IdentityAlreadyBoundError, ConflictError,
  //    NotFoundError) mapped by the adapter from the gateway's C3E: prefix.

  /** Execute-time provision: create/reuse + bind-once + membership + role. Returns the member user id. */
  memberProvision(input: {
    email: string;
    displayName: string;
    role: C3Role;
    provider: string;
    issuerTenantId: string;
    subject: string;
  }): Promise<string>;

  /** Exact-set role change. Returns the PREVIOUS role set for the audit before-image. */
  memberSetRole(userId: string, toRole: C3Role, actorEmail: string): Promise<string>;

  /** Activation flip (Phase-E1 semantics). Returns 'deactivated-sole' | 'membership-removed' | 'reactivated'. */
  memberSetActive(userId: string, active: boolean, actorEmail: string): Promise<string>;

  /** Tenant-scoped single-member read (null when not a member of this tenant). */
  getMember(userId: string): Promise<Member | null>;

  // ── Sprint 36 credentials ──────────────────────────────────────────────────
  insertCredential(row: NewCredentialRow): Promise<Credential>;
  /** Return the credential an approval already created (idempotent execute path). */
  getCredentialByCreatingApproval(approvalId: string): Promise<Credential | null>;
  /**
   * Deactivate iff currently active: returns the updated credential, or null
   * when it does not exist / is already inactive (caller raises ConflictError
   * → truthful ExecutionFailed).
   */
  deactivateCredential(credentialId: string): Promise<Credential | null>;

  // ── Sprint 37 journeys ─────────────────────────────────────────────────────
  insertJourney(row: NewJourneyRow): Promise<Journey>;
  /** Return the journey an approval already created (idempotent execute path). */
  getJourneyByCreatingApproval(approvalId: string): Promise<Journey | null>;
  /** Read the current row inside the transaction (for precise refusal errors). */
  getJourney(journeyId: string): Promise<Journey | null>;
  /**
   * Version-guarded, state-guarded transition: updates only when the row's
   * version matches AND its current status is in `allowedFrom` (the state
   * machine enforced at the statement level). Returns null when no row
   * qualified — the caller distinguishes not-found / illegal / stale.
   */
  transitionJourney(
    journeyId: string,
    expectedVersion: number,
    allowedFrom: readonly JourneyStatus[],
    patch: { status: JourneyStatus; endedOn: string | null },
  ): Promise<Journey | null>;

  // ── Sprint 38 equipment (direct CRUD; version-guarded like the ETag era) ──
  insertKit(kitId: string, row: NewEquipmentRow): Promise<Kit>;
  getKit(kitId: string): Promise<Kit | null>;
  /** Version-guarded field patch; null = stale/missing (caller distinguishes). */
  updateKit(kitId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Kit | null>;
  /** Version-guarded deactivate iff currently active; null = stale/missing/inactive. */
  deactivateKit(kitId: string, expectedVersion: number): Promise<Kit | null>;
  insertApparel(apparelId: string, row: NewEquipmentRow): Promise<Apparel>;
  getApparel(apparelId: string): Promise<Apparel | null>;
  updateApparel(apparelId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Apparel | null>;
  deactivateApparel(apparelId: string, expectedVersion: number): Promise<Apparel | null>;

  // ── Sprint 39 missions ─────────────────────────────────────────────────────
  insertMission(missionId: string, row: NewMissionRow): Promise<Mission>;
  getMission(missionId: string): Promise<Mission | null>;
  /** Version-guarded field patch; null = stale/missing (caller distinguishes). */
  updateMission(missionId: string, expectedVersion: number, patch: MissionPatch): Promise<Mission | null>;
  /** Version-guarded deactivate iff currently active; null = stale/missing/inactive. */
  deactivateMission(missionId: string, expectedVersion: number): Promise<Mission | null>;

  /**
   * Row-lock the (mission, person) participant pair inside this transaction
   * (SELECT ... FOR UPDATE) — serialises concurrent governed executions so the
   * duplicate-active guard and the reactivation flip cannot race.
   */
  getParticipantForUpdate(missionId: string, personId: string): Promise<MissionParticipant | null>;
  /** Read the pair without locking (idempotent execute path). */
  getParticipant(missionId: string, personId: string): Promise<MissionParticipant | null>;
  /** First-ever membership for the pair; the UNIQUE constraint backs it. */
  insertParticipant(missionId: string, personId: string, role: string): Promise<MissionParticipant>;
  /** Flip an INACTIVE pair back to active with a (possibly new) role; null when no inactive row matched. */
  reactivateParticipant(missionId: string, personId: string, role: string): Promise<MissionParticipant | null>;
  /** Flip an ACTIVE pair to inactive; null when no active row matched. */
  deactivateParticipant(missionId: string, personId: string): Promise<MissionParticipant | null>;

  // ── Sprint 41 agreements ───────────────────────────────────────────────────
  insertAgreement(row: NewAgreementRow): Promise<Agreement>;
  /** Read the row inside the transaction (for precise refusal errors). */
  getAgreement(agreementId: string): Promise<Agreement | null>;
  /** Return the agreement an approval already created (idempotent execute path). */
  getAgreementByCreatingApproval(approvalId: string): Promise<Agreement | null>;
  /**
   * Statement-guarded term extension: updates only when the row is Active AND
   * newEndsOn still beats the stored end date. Null = no row qualified — the
   * caller distinguishes not-found / terminated / no-longer-extends.
   */
  renewAgreement(agreementId: string, newEndsOn: string): Promise<Agreement | null>;
  /** Terminate iff currently Active; null = missing/already terminated. */
  terminateAgreement(agreementId: string): Promise<Agreement | null>;
  /** Version-guarded NON-MATERIAL patch; null = stale/missing. */
  updateAgreement(agreementId: string, expectedVersion: number, patch: AgreementPatch): Promise<Agreement | null>;
}

export interface WriteStore {
  /** Run fn in ONE tenant-bound transaction; commit on resolve, rollback on throw. */
  transaction<T>(actor: Actor, fn: (tx: WriteTx) => Promise<T>): Promise<T>;
}

/** A tenant-scoped read store factory (opens a read-only tenant-bound tx). */
export interface ReadStoreFactory {
  forActor(actor: Actor): ReadStore;
}

/** Everything a use-case needs from persistence. */
export interface Persistence {
  readonly reads: ReadStoreFactory;
  readonly writes: WriteStore;
}
