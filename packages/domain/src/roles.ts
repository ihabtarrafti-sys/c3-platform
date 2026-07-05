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
  /** True when the role has no write/governance affordance at all. */
  readonly isReadOnly: boolean;
}

const CAPABILITIES: Readonly<Record<C3Role, C3Capabilities>> = {
  owner: {
    canReadPeople: true,
    canSubmitApproval: true,
    canReviewApproval: true,
    canExecuteApproval: true,
    isReadOnly: false,
  },
  operations: {
    canReadPeople: true,
    canSubmitApproval: true,
    canReviewApproval: false,
    canExecuteApproval: false,
    isReadOnly: false,
  },
  legal: { canReadPeople: true, canSubmitApproval: false, canReviewApproval: false, canExecuteApproval: false, isReadOnly: true },
  finance: { canReadPeople: true, canSubmitApproval: false, canReviewApproval: false, canExecuteApproval: false, isReadOnly: true },
  hr: { canReadPeople: true, canSubmitApproval: false, canReviewApproval: false, canExecuteApproval: false, isReadOnly: true },
  management: { canReadPeople: true, canSubmitApproval: false, canReviewApproval: false, canExecuteApproval: false, isReadOnly: true },
  visitor: { canReadPeople: true, canSubmitApproval: false, canReviewApproval: false, canExecuteApproval: false, isReadOnly: true },
};

/** Total function: every role resolves to a fully-specified capability set. */
export function capabilitiesFor(role: C3Role): C3Capabilities {
  return CAPABILITIES[role];
}
