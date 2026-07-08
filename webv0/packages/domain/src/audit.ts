/**
 * audit.ts — append-only audit and approval-event definitions.
 *
 * Two distinct append-only streams:
 *   - ApprovalEvent: one row per approval lifecycle transition (the governance
 *     trail — who moved it, from → to, when, optional note).
 *   - AuditEvent: one row per governed mutation of an operational entity (e.g.
 *     a Person being created), with before/after snapshots.
 *
 * Both are WRITE-ONCE; the persistence layer enforces append-only at the DB
 * level (no UPDATE/DELETE grants + triggers). These are the type definitions.
 */

import type { ApprovalStatus } from './lifecycle';

export const AUDIT_ACTIONS = [
  'ApprovalSubmitted',
  'ApprovalReviewStarted',
  'ApprovalApproved',
  'ApprovalRejected',
  'ApprovalExecuted',
  'ApprovalExecutionFailed',
  'PersonCreated',
  // A-8 Phase 1: session establishment (successful /me membership resolution).
  // Access DENIALS have no resolvable tenant and live in the platform-level
  // access_event stream (migration 0007), not here.
  'SessionEstablished',
  // Sprint 35 tenant-admin (A-8 Phase 2): entity mutations of governed member
  // operations. The approval-chain actions above are generic and reused.
  'MemberProvisioned',
  'MemberRoleChanged',
  'MemberDeactivated',
  'MemberReactivated',
  // Owner-only direct lockout — the sole non-workflow access mutation; still
  // audited synchronously in the same transaction as the flip.
  'EmergencyLockout',
  // Sprint 36: the Credentials domain entity mutations.
  'CredentialCreated',
  'CredentialDeactivated',
  // Sprint 37: Journeys — one governed creation + four DIRECT-audited
  // transitions (role-gated, state-machine validated, same-tx audit).
  'JourneyInitiated',
  'JourneySuspended',
  'JourneyResumed',
  'JourneyCompleted',
  'JourneyCancelled',
  // Sprint 38: Kit & Apparel — pure direct-audited CRUD (no approvals).
  'KitCreated',
  'KitUpdated',
  'KitDeactivated',
  'ApparelCreated',
  'ApparelUpdated',
  'ApparelDeactivated',
  // Sprint 39: Missions — the direct-audited shell plus GOVERNED participant
  // membership. Reactivating a removed pair is recorded as a
  // MissionParticipantAdded whose before-image shows the inactive row.
  'MissionCreated',
  'MissionUpdated',
  'MissionDeactivated',
  'MissionParticipantAdded',
  'MissionParticipantRemoved',
  // Sprint 41: Agreements (contracts, NDAs, addendums, …) — three GOVERNED
  // material operations plus the direct-audited non-material edit.
  'AgreementCreated',
  'AgreementRenewed',
  'AgreementTerminated',
  'AgreementUpdated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One immutable step in an approval's lifecycle. */
export interface ApprovalEvent {
  readonly approvalId: string;
  readonly tenantId: string;
  readonly fromStatus: ApprovalStatus | null;
  readonly toStatus: ApprovalStatus;
  readonly actor: string;
  readonly at: string;
  readonly note: string | null;
}

/** One immutable audit record for a governed mutation of an entity. */
export interface AuditEvent {
  readonly tenantId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly actor: string;
  readonly at: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}
