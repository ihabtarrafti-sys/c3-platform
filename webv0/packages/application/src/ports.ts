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
  Approval,
  ApprovalEvent,
  ApprovalStatus,
  AuditEvent,
  C3Role,
  Member,
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
export interface WriteTx {
  /** Atomic, server-controlled business-ID allocation (never MAX+1). */
  allocateSequence(kind: 'person' | 'approval'): Promise<number>;

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
