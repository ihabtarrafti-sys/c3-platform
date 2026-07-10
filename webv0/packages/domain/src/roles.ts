/**
 * roles.ts — role and capability definitions (extracted from the frozen
 * reference `packages/c3/src/types/roles.ts`).
 *
 * SP-independence: the role SET is identical to the certified reference, but
 * role RESOLUTION (which SharePoint group / which Entra claim maps to which
 * role) is NOT a domain concern — it is translated at the auth boundary
 * (see apps/api auth adapters). The domain only knows the seven canonical
 * roles and the capability each role carries.
 */

export const C3_ROLES = [
  'owner',
  'operations',
  'legal',
  'finance',
  'hr',
  'management',
  'visitor',
] as const;

export type C3Role = (typeof C3_ROLES)[number];

export function isC3Role(value: unknown): value is C3Role {
  return typeof value === 'string' && (C3_ROLES as readonly string[]).includes(value);
}

/**
 * Capability booleans relevant to the People + AddPerson vertical slice.
 * These are DEFINITIONS; the enforcement decisions live in @c3web/authz so
 * that every server-side call site funnels through one policy module.
 *
 * Slice authorization matrix (Sprint 34 Phase 1):
 *   - read People:            every authenticated role.
 *   - submit AddPerson:       owner, operations (an actor action).
 *   - review/approve/reject:  owner only.
 *   - execute:                owner only.
 *   - self-approval:          always blocked (enforced separately by identity).
 */
export interface C3Capabilities {
  /** May read the People register and Person profiles. */
  readonly canReadPeople: boolean;
  /** May submit a governed approval (e.g. AddPerson) for review. */
  readonly canSubmitApproval: boolean;
  /** May begin review / approve / reject a governed approval. */
  readonly canReviewApproval: boolean;
  /** May execute an approved governed approval. */
  readonly canExecuteApproval: boolean;
  /**
   * Sprint 35 tenant-admin: may read the Members register. Access data is
   * sensitive directory data — not for read-only business roles.
   */
  readonly canReadMembers: boolean;
  /**
   * May SUBMIT a governed member operation (provision/role-change/
   * deactivate/reactivate). Review + execute reuse canReviewApproval /
   * canExecuteApproval (owner), preserving requester ≠ approver.
   */
  readonly canSubmitMemberChange: boolean;
  /**
   * Sprint 37: may perform DIRECT-audited journey lifecycle transitions
   * (suspend/resume/complete/cancel) — the CP "exempt-edit" posture:
   * owner and operations only. Initiation stays governed (canSubmitApproval).
   */
  readonly canOperateJourneys: boolean;
  /** Sprint 38: direct-audited Kit CRUD — owner and operations. */
  readonly canManageKit: boolean;
  /**
   * Sprint 38: direct-audited Apparel CRUD — owner, operations, AND HR
   * (CP-parity: the certified ACL gave HR edit rights on Apparel; team
   * clothing is HR-adjacent). The first non-read capability for hr.
   */
  readonly canManageApparel: boolean;
  /**
   * Sprint 39: direct-audited Mission SHELL management (create/update/
   * deactivate) — owner and operations, a DELIBERATE grant (the CP Set-C
   * review found ops holding improper direct Missions edit; here it is a
   * designed capability, not an ACL accident). Participant membership is
   * governed and rides canSubmitApproval instead.
   */
  readonly canManageMissions: boolean;
  /**
   * S48: may manage the tenant's legal operating entities (create/edit/
   * deactivate) — owner, operations. A deliberate grant mirroring missions;
   * entities are operational reference data agreements/people point at.
   */
  readonly canManageEntities: boolean;
  /**
   * Sprint 41: may read the Agreements domain (contracts, NDAs, addendums)
   * AT ALL — owner, operations, legal, finance, management. HR and visitor
   * are DENIED entirely (the CP Set-E ACL boundary: agreements are sensitive
   * commercial data; denial is fail-closed and truthful, never a silent
   * empty register).
   */
  readonly canReadAgreements: boolean;
  /**
   * Sprint 41: may see FINANCIAL values (agreement USD) — owner, operations,
   * finance, management. Legal reads agreements WITHOUT values; the read
   * model omits the field entirely (absence, not masking).
   */
  readonly canViewFinancials: boolean;
  /**
   * Finance S2 (closes CP D-8): may see per-diem amounts — owner, operations,
   * finance, management. Others get the field OMITTED (absence, not masking).
   */
  readonly canViewPerDiem: boolean;
  /**
   * Tier 0.5: may grant/revoke approver delegations — owner ONLY. Granting
   * review power is a species of role management, the owner's exclusive act.
   */
  readonly canManageDelegations: boolean;
  /** True when the role has no write/governance affordance at all. */
  readonly isReadOnly: boolean;
}

const READ_ONLY = {
  canReadPeople: true,
  canSubmitApproval: false,
  canReviewApproval: false,
  canExecuteApproval: false,
  canReadMembers: false,
  canSubmitMemberChange: false,
  canOperateJourneys: false,
  canManageKit: false,
  canManageApparel: false,
  canManageMissions: false,
  canManageEntities: false,
  canReadAgreements: false,
  canViewFinancials: false,
    canViewPerDiem: false,
  canManageDelegations: false,
  isReadOnly: true,
} as const satisfies C3Capabilities;

const CAPABILITIES: Readonly<Record<C3Role, C3Capabilities>> = {
  owner: {
    canReadPeople: true,
    canSubmitApproval: true,
    canReviewApproval: true,
    canExecuteApproval: true,
    canReadMembers: true,
    canSubmitMemberChange: true,
    canOperateJourneys: true,
    canManageKit: true,
    canManageApparel: true,
    canManageMissions: true,
    canManageEntities: true,
    canReadAgreements: true,
    canViewFinancials: true,
    canViewPerDiem: true,
    canManageDelegations: true,
    isReadOnly: false,
  },
  operations: {
    canReadPeople: true,
    canSubmitApproval: true,
    canReviewApproval: false,
    canExecuteApproval: false,
    canReadMembers: true,
    canSubmitMemberChange: true,
    canOperateJourneys: true,
    canManageKit: true,
    canManageApparel: true,
    canManageMissions: true,
    canManageEntities: true,
    canReadAgreements: true,
    canViewFinancials: true,
    canViewPerDiem: true,
    canManageDelegations: false,
    isReadOnly: false,
  },
  // Sprint 41 (CP Set-E parity): legal reads contracts WITHOUT financial
  // values; finance and management read contracts WITH values. All three
  // remain read-only (no write/governance affordance).
  legal: { ...READ_ONLY, canReadAgreements: true },
  finance: { ...READ_ONLY, canReadAgreements: true, canViewFinancials: true },
  // Sprint 38 (CP-parity): HR manages Apparel — no longer fully read-only.
  hr: { ...READ_ONLY, canManageApparel: true, isReadOnly: false },
  management: { ...READ_ONLY, canReadAgreements: true, canViewFinancials: true },
  visitor: READ_ONLY,
};

/** Total function: every role resolves to a fully-specified capability set. */
export function capabilitiesFor(role: C3Role): C3Capabilities {
  return CAPABILITIES[role];
}
