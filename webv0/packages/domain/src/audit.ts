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
  // Sprint 42: the submitter withdrew their own request (terminal, no effects).
  'ApprovalWithdrawn',
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
  // D-7 (2026-07-09): fulfillment status transitions (direct-audited,
  // state-machine validated). One action; the before/after images carry
  // the from→to status.
  'KitStatusChanged',
  'ApparelStatusChanged',
  // Sprint 39: Missions — the direct-audited shell plus GOVERNED participant
  // membership. Reactivating a removed pair is recorded as a
  // MissionParticipantAdded whose before-image shows the inactive row.
  'MissionCreated',
  'MissionUpdated',
  'MissionDeactivated',
  'MissionParticipantAdded',
  'MissionParticipantRemoved',
  // Finance Sprint 2: a participant's per-diem daily rate was set or cleared.
  'MissionParticipantPerDiemSet',
  // Finance Sprint 4: mission income/expense lines (direct-audited, canViewFinancials).
  'MissionLineAdded',
  'MissionLineUpdated',
  'MissionLineRemoved',
  // S2 Mission Finance: income payment tracking, budgets, the financial lifecycle.
  'MissionLinePaymentSet',
  'MissionBudgetSet',
  'MissionFinanceStageChanged',
  // S4: registered evidence — audit lands on the OWNER record's trail.
  'DocumentAttached',
  'DocumentRemoved',
  // S6: invoices (direct-audited; the line flip audits as MissionLinePaymentSet).
  'InvoiceIssued',
  'InvoiceVoided',
  // S7: teams — org structure (direct-audited, the entity-register standing).
  'TeamCreated',
  'TeamUpdated',
  'TeamDeactivated',
  'TeamReactivated',
  'TeamMemberAdded',
  'TeamMemberRemoved',
  // S8: prize distributions — allocation decisions + payment facts.
  'DistributionCreated',
  'DistributionRevoked',
  'PayoutMarked',
  // S9: expense claims — the Finance Intelligence Hub, made a record.
  'ClaimSubmitted',
  'ClaimReviewStarted',
  'ClaimApproved',
  'ClaimRejected',
  'ClaimPaid',
  'DelegationGranted',
  'DelegationRevoked',
  // S11: People v2 — governed identity/lifecycle + direct-audited operational.
  'PersonIdentityUpdated',
  'PersonOperationalUpdated',
  'PersonDeactivated',
  'PersonReactivated',
  'CredentialFactsUpdated',
  'CredentialDetailsUpdated',
  'BeneficiaryAdded',
  'BeneficiaryUpdated',
  'BeneficiaryRetired',
  // Sprint 41: Agreements (contracts, NDAs, addendums, …) — three GOVERNED
  // material operations plus the direct-audited non-material edit.
  'AgreementCreated',
  'AgreementRenewed',
  'AgreementTerminated',
  'AgreementUpdated',
  // Finance Sprint 3: agreement financial terms (direct-audited, canViewFinancials).
  'AgreementTermAdded',
  'AgreementTermUpdated',
  'AgreementTermRemoved',
  // S48 (2026-07-10): Entities — the tenant's legal operating entities.
  // Direct-audited CRUD (the mission-shell pattern).
  'EntityCreated',
  'EntityUpdated',
  'EntityDeactivated',
  'EntityReactivated',
  // Finance Sprint 1: the org's editable FX rate for a currency was set.
  'FxRateSet',
  // HARDEN-2 (0037): a tenant setting was written (per-diem presets et al.).
  'PerDiemPresetsSet',
  // Track B1: request corrections — a pre-review edit / a revise-and-resubmit tie.
  'ApprovalEdited',
  'ApprovalSuperseded',
  // Track B6: guest intake — the STAFF actions (mint/revoke a link; promote or
  // reject a sandbox submission). The guest submission itself is not on the
  // audit stream (the sandbox row is the record); promotion also audits the
  // AddPerson approval it mints (ApprovalSubmitted).
  'IntakeLinkCreated',
  'IntakeLinkRevoked',
  'IntakePromoted',
  'IntakeRejected',
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
