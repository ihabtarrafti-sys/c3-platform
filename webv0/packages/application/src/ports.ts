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
  AgreementTerm,
  Apparel,
  Approval,
  ApprovalEvent,
  C3Document,
  ApprovalStatus,
  AuditEvent,
  C3Role,
  Credential,
  Entity,
  FxRate,
  Invoice,
  Journey,
  JourneyStatus,
  Kit,
  Member,
  Mission,
  MissionBudget,
  MissionLine,
  MissionParticipant,
  Person,
  Team,
  TeamMembership,
  Distribution,
  DistributionShare,
  Claim,
  C3Notification,
  Delegation,
  Beneficiary,
} from '@c3web/domain';

/** Read-only, tenant-scoped views. */
// ── S3.1 global search port types (the persistence layer implements) ─────────
export const SEARCH_DOMAINS = [
  'person',
  'mission',
  'agreement',
  'entity',
  'credential',
  'journey',
  'kit',
  'apparel',
  'approval',
  'team',
  'invoice',
  'claim',
  'distribution',
  'document',
  'term',
  'line',
  'beneficiary',
] as const;
export type SearchDomain = (typeof SEARCH_DOMAINS)[number];

export interface TenantSearchSpec {
  /** Raw query, already trimmed + lowercased by the use case. */
  readonly q: string;
  readonly limitPerDomain: number;
  readonly domains: readonly SearchDomain[];
  /** Non-null narrows CLAIM hits to this submitter (non-finance roles). */
  readonly claimsOwnIdentity: string | null;
  /** DOCUMENT owner types the role may see (empty = no document hits). */
  readonly documentOwnerTypes: readonly string[];
}

export interface TenantSearchRow {
  readonly kind: SearchDomain;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly parent_id: string | null;
}

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
  // Finance S4: a mission's ACTIVE income/expense lines (the P&L raw material).
  listMissionLines(missionId: string): Promise<MissionLine[]>;
  // S2: budgets for one mission; bulk lines for the all-missions finance dashboard.
  listMissionBudgets(missionId: string): Promise<MissionBudget[]>;
  listAllMissionLines(): Promise<MissionLine[]>;
  listAllMissionBudgets(): Promise<MissionBudget[]>;
  // Sprint 41: agreements. Financial-field omission happens in the
  // APPLICATION query layer (per-actor); the store returns full rows.
  listAgreements(): Promise<Agreement[]>;
  listAgreementsForPerson(personId: string): Promise<Agreement[]>;
  getAgreementById(agreementId: string): Promise<Agreement | null>;
  // Finance S3: the financial terms of an agreement (active rows only).
  listAgreementTerms(agreementId: string): Promise<AgreementTerm[]>;
  // S48: entities (the tenant's legal operating entities).
  listEntities(): Promise<Entity[]>;
  getEntityById(entityId: string): Promise<Entity | null>;
  // S4: documents attached to an owning record (ACTIVE rows, newest first).
  listDocuments(ownerType: string, ownerId: string): Promise<C3Document[]>;
  // Finance S1: the tenant's editable FX rates.
  listFxRates(): Promise<FxRate[]>;
  // Sprint 42: the person hub's read side.
  listMissionMembershipsForPerson(personId: string): Promise<PersonMissionMembership[]>;
  listApprovalsForPerson(personId: string): Promise<Approval[]>;
  // S5: the whole tenant audit stream (the audit-trail export).
  listAllAuditEvents(): Promise<AuditEvent[]>;
  // Sprint 43: the Situation Room snapshot (bulk, slim, one pass).
  listAllMissionParticipants(): Promise<Array<{ missionId: string; personId: string; personName: string; role: string; isActive: boolean; perDiemAmountMinor: number | null; perDiemCurrency: string | null }>>;
  // S6: invoices (newest first). Gating is the use-case's job (finance read).
  listInvoices(): Promise<Invoice[]>;
  getInvoiceById(invoiceId: string): Promise<Invoice | null>;
  // S7: teams + memberships (memberships join the person's display name).
  listTeams(): Promise<Team[]>;
  getTeamById(teamId: string): Promise<Team | null>;
  listTeamMembers(teamId: string): Promise<TeamMembership[]>;
  listTeamMembershipsForPerson(personId: string): Promise<TeamMembership[]>;
  /** Slim bulk read for the Situation Room snapshot. */
  listAllTeamMemberships(): Promise<Array<{ teamId: string; personId: string; isActive: boolean }>>;
  // S8: distributions (shares join the person's display name).
  listDistributionsForMission(missionId: string): Promise<Distribution[]>;
  getDistributionById(distributionId: string): Promise<Distribution | null>;
  listDistributionShares(distributionId: string): Promise<DistributionShare[]>;
  /** M-04: every share of every head on ONE mission — one query, not one per head. */
  listDistributionSharesForMission(missionId: string): Promise<DistributionShare[]>;
  /**
   * M-04: candidate PrizeSharePersonal suggestions for a roster in ONE query —
   * active agreements' live terms with a percent, ordered (person, agreement)
   * so "first hit per person" reproduces the nested walk's suggestion.
   */
  listPrizeShareTermsForPeople(personIds: readonly string[]): Promise<Array<{ personId: string; agreementId: string; termId: string; percentBps: number }>>;
  /** Slim bulk pending-payout view for the Situation Room snapshot. */
  listDistributionsWithPending(): Promise<
    Array<{ distributionId: string; missionId: string; status: string; createdAt: string; pendingCount: number; pendingAmountMinor: number; currency: string }>
  >;
  // S9: claims. Per-actor scoping is the use-case's job (own vs finance-all).
  listClaims(): Promise<Claim[]>;
  listClaimsForSubmitter(identity: string): Promise<Claim[]>;
  getClaimById(claimId: string): Promise<Claim | null>;
  // S10: the actor's own notification inbox (newest first, capped).
  listNotifications(identity: string, limit: number): Promise<C3Notification[]>;
  listDelegations(): Promise<Delegation[]>;
  // S12: the beneficiary registry (finance-gated at the usecase).
  listBeneficiaries(): Promise<Beneficiary[]>;
  listBeneficiariesForPerson(personId: string): Promise<Beneficiary[]>;
  getBeneficiaryById(beneficiaryId: string): Promise<Beneficiary | null>;
  /**
   * S3.1 + M-04: global search pushed into PostgreSQL — one statement,
   * per-domain rank + LIMIT, RLS'd. The USE CASE owns the role boundary
   * (domain inclusion, claims narrowing, document owner-type allowlist).
   */
  searchTenant(spec: TenantSearchSpec): Promise<TenantSearchRow[]>;
  /** HARDEN-2 (0037): one settings row, or null (= the code-side defaults). */
  getTenantSetting(key: string): Promise<{ value: unknown; version: number } | null>;
  /** Tier 0.5: the unrevoked delegation held by this grantee, if any (its DLG id). */
  findUnrevokedDelegationId(granteeIdentity: string): Promise<string | null>;
  /** Tier 0.5: does this identity hold an UNREVOKED delegation whose window covers onDate? */
  hasActiveDelegation(identity: string, onDate: string): Promise<boolean>;
}

/** Fields written when creating a Person during AddPerson execution. */
/** S11: one sparse patch type for BOTH identity and operational writes (the
 *  gate that decides WHICH keys are allowed lives in the usecases). */
export interface PersonFieldsPatch {
  fullName?: string;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  otherNationalities?: readonly string[];
  ign?: string | null;
  primaryRole?: string | null;
  personnelCode?: string | null;
  currentTeam?: string | null;
  currentGameTitle?: string | null;
  primaryDepartment?: string | null;
  entityId?: string | null;
  notes?: string | null;
  position?: string | null;
  dateOfJoining?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CredentialFieldsPatch {
  kind?: string;
  documentNumber?: string | null;
  issuingCountry?: string | null;
  issuedOn?: string;
  expiresOn?: string | null;
  credentialType?: string;
  issuer?: string | null;
  notes?: string | null;
}

export interface NewBeneficiaryRow {
  beneficiaryId: string;
  personId: string;
  label: string;
  bankName: string;
  bankCountry: string;
  currency: string;
  paymentType: string | null;
  registeredWithEntityId: string | null;
  notes: string | null;
  createdByApprovalId: string | null;
}

export interface BeneficiaryFieldsPatch {
  label?: string;
  bankName?: string;
  bankCountry?: string;
  currency?: string;
  paymentType?: string | null;
  registeredWithEntityId?: string | null;
  status?: string;
  statusDate?: string | null;
  notes?: string | null;
}

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
  readonly entityId: string | null;
  readonly notes: string | null;
  /** The approval whose execution created this person; NULL for batch imports (provenance = the batch approval, audit-carried). */
  readonly createdByApprovalId: string | null;
  /** S5 imports may create historical (inactive) rows. Default true. */
  readonly isActive?: boolean;
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
  readonly kind?: string;
  readonly documentNumber?: string | null;
  readonly issuingCountry?: string | null;
  readonly issuer: string | null;
  readonly issuedOn: string; // plain ISO YYYY-MM-DD
  readonly expiresOn: string | null;
  readonly notes: string | null;
  /** NULL for batch imports (provenance = the batch approval, audit-carried). */
  readonly createdByApprovalId: string | null;
  /** S5 imports may create historical (inactive) rows. Default true. */
  readonly isActive?: boolean;
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
  readonly code: string | null;
  readonly organizer: string | null;
  readonly city: string | null;
  readonly teamId: string | null;
  readonly gameTitle: string | null;
  readonly startsOn: string; // plain ISO YYYY-MM-DD
  readonly endsOn: string | null;
  readonly notes: string | null;
}

/** Editable-field patch for a mission update (only provided keys change). */
export interface MissionPatch {
  readonly name?: string;
  readonly code?: string | null;
  readonly organizer?: string | null;
  readonly city?: string | null;
  readonly teamId?: string | null;
  readonly gameTitle?: string | null;
  readonly startsOn?: string;
  readonly endsOn?: string | null;
  readonly notes?: string | null;
}

/** S9: claim rows (born Submitted). */
export interface NewClaimRow {
  readonly claimId: string;
  readonly submittedBy: string;
  readonly personId: string | null;
  readonly missionId: string | null;
  readonly category: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly expenseOn: string;
}

/** S8: distribution rows (amounts pre-computed by the domain allocator). */
export interface NewDistributionRow {
  readonly distributionId: string;
  readonly missionId: string;
  readonly lineId: string;
  readonly poolMinor: number;
  readonly currency: string;
  readonly orgShareBps: number;
  readonly orgCutMinor: number;
  readonly notes: string | null;
  readonly createdBy: string;
}

export interface NewDistributionShareRow {
  readonly distributionId: string;
  readonly personId: string;
  readonly shareBps: number;
  readonly amountMinor: number;
}

/** S7: team CRUD rows/patches (direct-audited org structure). */
export interface NewTeamRow {
  readonly teamId: string;
  readonly name: string;
  readonly code: string;
  readonly kind: string;
  readonly gameTitle: string | null;
  readonly notes: string | null;
}

export interface TeamPatch {
  readonly name?: string;
  readonly code?: string;
  readonly gameTitle?: string | null;
  readonly notes?: string | null;
}

/** Fields written when creating an Agreement during AddAgreement execution. */
export interface NewAgreementRow {
  readonly agreementId: string;
  /** Null = entity-level agreement (the anchor rule guarantees entityId is set). */
  readonly personId: string | null;
  readonly entityId: string | null;
  readonly agreementCode: string | null;
  readonly agreementType: string;
  readonly linkedAgreementId: string | null;
  readonly startsOn: string; // plain ISO YYYY-MM-DD
  readonly endsOn: string;
  readonly valueUsdCents: number | null;
  readonly notes: string | null;
  /** NULL for batch imports (provenance = the batch approval, audit-carried). */
  readonly createdByApprovalId: string | null;
  /** S5 imports may carry history. Default Active. */
  readonly status?: string;
}

/** Fields written when creating a mission income/expense line (Finance S4 + S2). */
export interface NewMissionLineRow {
  readonly lineId: string;
  readonly missionId: string;
  readonly direction: string;
  readonly category: string;
  readonly label: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** 'Expected' for income lines; null for expense lines (DB CHECK). */
  readonly paymentStatus: string | null;
}

/** Editable-field patch for a line update (direction/category/payment immutable here). */
export interface MissionLinePatch {
  readonly label?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
}

/** S2: the audited income-payment update (whole value set, replaced together). */
export interface MissionLinePaymentPatch {
  readonly paymentStatus: string;
  readonly receivedAmountMinor: number | null;
  readonly receivedUsdPerUnit: number | null;
  readonly paymentSourceLabel: string | null;
  readonly refNo: string | null;
}

/** Fields written when creating an agreement financial term (Finance S3). */
export interface NewAgreementTermRow {
  readonly termId: string;
  readonly agreementId: string;
  readonly kind: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly percentBps: number | null;
  readonly label: string | null;
}

/** Value patch for a term update (kind is immutable; value replaced wholesale). */
export interface AgreementTermPatch {
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly percentBps: number | null;
  readonly label: string | null;
}

/** Fields written when registering a Document at attach time (S4). */
export interface NewDocumentRow {
  readonly documentId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly label: string | null;
  readonly storageKey: string;
  readonly uploadedBy: string;
}

/** Fields written when issuing an Invoice (S6). Status is always 'Issued'. */
export interface NewInvoiceRow {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly entityId: string;
  readonly missionId: string;
  readonly lineId: string;
  readonly billedToName: string;
  readonly billedToDetails: string | null;
  readonly incomeCategory: string;
  readonly description: string | null;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly vatRateBps: number;
  readonly vatMinor: number;
  readonly totalMinor: number;
  readonly issuedOn: string;
  readonly issuedBy: string;
}

/** Fields written when creating an Entity (S48, direct-audited). */
export interface NewEntityRow {
  readonly name: string;
  readonly code: string | null;
  readonly jurisdiction: string;
  readonly registrationId: string | null;
  readonly localCurrency: string;
}

/** Editable-field patch for an entity update (only provided keys change). */
export interface EntityPatch {
  readonly name?: string;
  readonly code?: string | null;
  readonly jurisdiction?: string;
  readonly registrationId?: string | null;
  readonly localCurrency?: string;
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
  // ── HARDEN-2 (0037): tenant settings (version-guarded from birth) ─────────
  /** One settings row inside the tx, or null (the guard's basis). */
  getTenantSetting(key: string): Promise<{ value: unknown; version: number } | null>;
  /** Create a setting; null when a concurrent creator won (23505). */
  insertTenantSetting(key: string, value: unknown): Promise<{ value: unknown; version: number } | null>;
  /** Version-guarded settings update; null = stale/missing. */
  updateTenantSetting(key: string, expectedVersion: number, value: unknown): Promise<{ value: unknown; version: number } | null>;
  /**
   * Atomic, server-controlled business-ID allocation (never MAX+1). Beyond
   * the canonical kinds, S6 allocates per-(entity, year) invoice series via
   * `invoice-series:ENT-XXXX:YYYY` composite kinds (the DB CHECK admits the
   * pattern; numbers are never reused).
   */
  allocateSequence(
    kind:
      | 'person'
      | 'approval'
      | 'credential'
      | 'journey'
      | 'kit'
      | 'apparel'
      | 'mission'
      | 'missionLine'
      | 'document'
      | 'agreement'
      | 'agreementTerm'
      | 'entity'
      | 'invoice'
      | 'team'
      | 'distribution'
      | 'claim'
      | 'delegation'
      | 'beneficiary'
      | `invoice-series:${string}`,
  ): Promise<number>;

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

  /** S11: row-lock a person for governed/direct mutation. */
  lockPerson(personId: string): Promise<Person | null>;
  /** S11: sparse UPDATE with version guard — null clears, undefined leaves untouched. */
  updatePersonFields(personId: string, expectedVersion: number, patch: PersonFieldsPatch): Promise<Person | null>;
  /** S11: lifecycle flip with version guard. */
  setPersonActive(personId: string, expectedVersion: number, isActive: boolean): Promise<Person | null>;
  // ── S12: credential v2 + the beneficiary registry ─────────────────────────
  lockCredential(credentialId: string): Promise<Credential | null>;
  /** Sparse facts/details patch with version guard — null clears, undefined leaves untouched. */
  updateCredentialFields(credentialId: string, expectedVersion: number, patch: CredentialFieldsPatch): Promise<Credential | null>;
  /** HARDEN-1 H-05: settlement checks read+LOCK the lines INSIDE the tx. */
  listMissionLinesTxLocked(missionId: string): Promise<MissionLine[]>;
  /** HARDEN-1 H-05: revoke/payout serialize on the distribution head. */
  lockDistribution(distributionId: string): Promise<Distribution | null>;
  insertBeneficiary(row: NewBeneficiaryRow): Promise<Beneficiary>;
  lockBeneficiary(beneficiaryId: string): Promise<Beneficiary | null>;
  updateBeneficiaryFields(beneficiaryId: string, expectedVersion: number, patch: BeneficiaryFieldsPatch): Promise<Beneficiary | null>;

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
  /** Version-guarded status set (D-7); null = stale/missing. State legality is the use-case's job. */
  setKitStatus(kitId: string, expectedVersion: number, status: string): Promise<Kit | null>;
  insertApparel(apparelId: string, row: NewEquipmentRow): Promise<Apparel>;
  getApparel(apparelId: string): Promise<Apparel | null>;
  updateApparel(apparelId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Apparel | null>;
  deactivateApparel(apparelId: string, expectedVersion: number): Promise<Apparel | null>;
  setApparelStatus(apparelId: string, expectedVersion: number, status: string): Promise<Apparel | null>;

  // ── S48 entities (direct-audited) ─────────────────────────────────────────
  insertEntity(entityId: string, row: NewEntityRow): Promise<Entity>;
  getEntity(entityId: string): Promise<Entity | null>;
  updateEntity(entityId: string, expectedVersion: number, patch: EntityPatch): Promise<Entity | null>;
  deactivateEntity(entityId: string, expectedVersion: number): Promise<Entity | null>;
  /** Version-guarded reactivate iff currently INACTIVE; null = stale/missing/active. */
  reactivateEntity(entityId: string, expectedVersion: number): Promise<Entity | null>;
  /** Finance S1: set/replace the tenant's rate for a currency (value of 1 unit in USD). */
  upsertFxRate(currency: string, usdPerUnit: number): Promise<FxRate>;
  /** Finance S2 + HARDEN-2 M-03: set/clear a participant's per-diem daily rate, version- and active-guarded; null = stale/removed/missing. */
  setParticipantPerDiem(missionId: string, personId: string, amountMinor: number | null, currency: string | null, expectedVersion: number): Promise<MissionParticipant | null>;

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

  // ── Finance S4 mission lines (direct-audited; soft removal) ───────────────
  insertMissionLine(row: NewMissionLineRow): Promise<MissionLine>;
  /** Read one ACTIVE line inside the transaction (for the update/remove guard). */
  getMissionLine(lineId: string): Promise<MissionLine | null>;
  /** Version-guarded field patch; null = stale/missing/inactive. */
  updateMissionLine(lineId: string, expectedVersion: number, patch: MissionLinePatch): Promise<MissionLine | null>;
  /** Version-guarded soft removal iff currently active; null = stale/missing/inactive. */
  deactivateMissionLine(lineId: string, expectedVersion: number): Promise<MissionLine | null>;
  /** S2: version-guarded income-payment set; null = stale/missing/inactive. */
  setMissionLinePayment(lineId: string, expectedVersion: number, patch: MissionLinePaymentPatch): Promise<MissionLine | null>;
  /** HARDEN-2 M-03: read one budget cell inside the tx (the guard's basis). */
  getMissionBudget(missionId: string, direction: string, category: string, currency: string): Promise<MissionBudget | null>;
  /** S2 + M-03: create an EMPTY cell; null when a concurrent creator won (23505). */
  insertMissionBudget(missionId: string, direction: string, category: string, currency: string, amountMinor: number): Promise<MissionBudget | null>;
  /** S2 + M-03: version-guarded cell update; null = stale/missing. */
  updateMissionBudget(missionId: string, direction: string, category: string, currency: string, expectedVersion: number, amountMinor: number): Promise<MissionBudget | null>;
  /** S2 + M-03: version-guarded cell clear; false = stale/missing. */
  deleteMissionBudget(missionId: string, direction: string, category: string, currency: string, expectedVersion: number): Promise<boolean>;
  /** S2: version-guarded finance-stage set; legality is the use-case's job. */
  setMissionFinanceStage(missionId: string, expectedVersion: number, stage: string): Promise<Mission | null>;

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

  // ── S4 documents (metadata; bytes live in object storage) ─────────────────
  insertDocument(row: NewDocumentRow): Promise<C3Document>;
  /** Read one ACTIVE document inside the transaction (for the remove guard). */
  getDocument(documentId: string): Promise<C3Document | null>;
  /** Version-guarded soft removal iff currently active; null = stale/missing/inactive. */
  deactivateDocument(documentId: string, expectedVersion: number): Promise<C3Document | null>;

  // ── S6 invoices (direct-audited; numbers NEVER reused — voids leave gaps) ──
  insertInvoice(row: NewInvoiceRow): Promise<Invoice>;
  /** Read one invoice inside the transaction, any status. */
  getInvoice(invoiceId: string): Promise<Invoice | null>;
  /** Version-guarded Issued→Voided flip with the mandatory reason; null = stale/missing/not-Issued. */
  voidInvoice(invoiceId: string, expectedVersion: number, reason: string): Promise<Invoice | null>;
  /** Version-guarded PDF attach (the stored artifact's DOC id); null = stale/missing. */
  setInvoiceDocument(invoiceId: string, expectedVersion: number, documentId: string): Promise<Invoice | null>;

  // ── S10 notifications (L2 rows; UNIQUE dedupe; no deletes) ────────────────
  /** Insert-if-first-crossing: ON CONFLICT (tenant,user,signal_key) DO NOTHING. Returns true when a NEW row landed. */
  insertNotification(row: { userIdentity: string; signalKey: string; kind: string; title: string; link: string }): Promise<boolean>;
  insertDelegation(row: { delegationId: string; granteeIdentity: string; grantedBy: string; startsOn: string; endsOn: string; reason: string }): Promise<Delegation>;
  lockDelegation(delegationId: string): Promise<Delegation | null>;
  revokeDelegation(delegationId: string, expectedVersion: number, revokedBy: string, revokeReason: string): Promise<Delegation | null>;
  hasActiveDelegation(identity: string, onDate: string): Promise<boolean>;
  /** Flip one of the actor's rows read (idempotent); false when no row matched. */
  markNotificationRead(identity: string, signalKey: string): Promise<boolean>;
  /** Flip all of the actor's unread rows; returns the count flipped. */
  markAllNotificationsRead(identity: string): Promise<number>;

  // ── S9 expense claims (lifecycle record; no deletes) ──────────────────────
  insertClaim(row: NewClaimRow): Promise<Claim>;
  /** Read one claim inside the transaction, any status. */
  getClaim(claimId: string): Promise<Claim | null>;
  /** Version-guarded status patch; null = stale/missing. */
  updateClaim(
    claimId: string,
    expectedVersion: number,
    patch: {
      status: string;
      reviewedBy?: string | null;
      rejectionReason?: string | null;
      paidOn?: string | null;
      paymentSourceLabel?: string | null;
      refNo?: string | null;
    },
  ): Promise<Claim | null>;

  // ── S8 distributions (direct-audited; one LIVE per line; no deletes) ──────
  insertDistribution(row: NewDistributionRow): Promise<Distribution>;
  insertDistributionShare(row: NewDistributionShareRow): Promise<void>;
  /** Read one distribution inside the transaction, any status. */
  getDistribution(distributionId: string): Promise<Distribution | null>;
  /** The (distribution, person) share row, joined with the person name. */
  getDistributionShare(distributionId: string, personId: string): Promise<DistributionShare | null>;
  /** All share rows of a distribution (the revoke guard reads them in-tx). */
  listDistributionSharesTx(distributionId: string): Promise<DistributionShare[]>;
  /** Version-guarded Live→Revoked flip; null = stale/missing/not-Live. */
  revokeDistribution(distributionId: string, expectedVersion: number, reason: string): Promise<Distribution | null>;
  /** Version-guarded payout flip; null = stale/missing. */
  setPayout(
    distributionId: string,
    personId: string,
    expectedVersion: number,
    patch: { payoutStatus: string; paidOn: string | null; paymentSourceLabel: string | null; refNo: string | null },
  ): Promise<DistributionShare | null>;

  // ── S7 teams (direct-audited org structure; the entity-register pattern) ──
  insertTeam(row: NewTeamRow): Promise<Team>;
  /** Read one team inside the transaction, any status. */
  getTeam(teamId: string): Promise<Team | null>;
  /** Version-guarded field patch; null = stale/missing/inactive. */
  updateTeam(teamId: string, expectedVersion: number, patch: TeamPatch): Promise<Team | null>;
  /** Version-guarded active→inactive flip; null = stale/missing/inactive. */
  deactivateTeam(teamId: string, expectedVersion: number): Promise<Team | null>;
  /** Version-guarded inactive→active flip; null = stale/missing/active. */
  reactivateTeam(teamId: string, expectedVersion: number): Promise<Team | null>;
  /** The (team, person) membership row, any status (the reactivation guard). */
  getTeamMembership(teamId: string, personId: string): Promise<TeamMembership | null>;
  /** First-ever membership for the pair; the UNIQUE constraint backs it. */
  insertTeamMembership(teamId: string, personId: string, role: string): Promise<TeamMembership>;
  /** M-03: flip an INACTIVE pair back to active (version-guarded); null when no matching row at that version. */
  reactivateTeamMembership(teamId: string, personId: string, role: string, expectedVersion: number): Promise<TeamMembership | null>;
  /** M-03: flip an ACTIVE pair to inactive (version-guarded); null when stale or no active row. */
  deactivateTeamMembership(teamId: string, personId: string, expectedVersion: number): Promise<TeamMembership | null>;

  // ── Finance S3 agreement terms (direct-audited; soft removal) ─────────────
  insertAgreementTerm(row: NewAgreementTermRow): Promise<AgreementTerm>;
  /** Read one ACTIVE term inside the transaction (for the update/remove guard). */
  getAgreementTerm(termId: string): Promise<AgreementTerm | null>;
  /** Version-guarded value replacement; null = stale/missing/inactive. */
  updateAgreementTerm(termId: string, expectedVersion: number, patch: AgreementTermPatch): Promise<AgreementTerm | null>;
  /** Version-guarded soft removal iff currently active; null = stale/missing/inactive. */
  deactivateAgreementTerm(termId: string, expectedVersion: number): Promise<AgreementTerm | null>;
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
