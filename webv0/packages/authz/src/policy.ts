/**
 * policy.ts — server-side authorization for the People + AddPerson slice.
 *
 * This is the ONE module every governed call site funnels through. Browser
 * capability checks (in apps/web) are UX-only and NON-authoritative; this
 * module is the enforced boundary.
 *
 * Authorization matrix (Sprint 34 Phase 1):
 *   - read People:            every authenticated role.
 *   - submit AddPerson:       owner, operations.
 *   - begin review / approve / reject / execute:  owner only,
 *     AND the actor must not be the submitter (separation of duties,
 *     fail-closed on indeterminate identity).
 *
 * Tenant match is enforced here too: an actor may only act on records in their
 * own tenant. A mismatch fails closed (treated as not-found by callers).
 */

import {
  type Actor,
  type C3Role,
  capabilitiesFor,
  checkSelfReview,
  ForbiddenError,
  SelfReviewError,
} from '@c3web/domain';

export type ReviewAction = 'beginReview' | 'approve' | 'reject';

export const canReadPeople = (role: C3Role): boolean => capabilitiesFor(role).canReadPeople;
export const canSubmitApproval = (role: C3Role): boolean => capabilitiesFor(role).canSubmitApproval;
export const canReviewApproval = (role: C3Role): boolean => capabilitiesFor(role).canReviewApproval;
export const canExecuteApproval = (role: C3Role): boolean => capabilitiesFor(role).canExecuteApproval;
export const canReadMembers = (role: C3Role): boolean => capabilitiesFor(role).canReadMembers;
export const canSubmitMemberChange = (role: C3Role): boolean => capabilitiesFor(role).canSubmitMemberChange;
export const canOperateJourneys = (role: C3Role): boolean => capabilitiesFor(role).canOperateJourneys;
export const canManageKit = (role: C3Role): boolean => capabilitiesFor(role).canManageKit;
export const canManageApparel = (role: C3Role): boolean => capabilitiesFor(role).canManageApparel;
export const canManageMissions = (role: C3Role): boolean => capabilitiesFor(role).canManageMissions;
export const canManageEntities = (role: C3Role): boolean => capabilitiesFor(role).canManageEntities;
export const canReadAgreements = (role: C3Role): boolean => capabilitiesFor(role).canReadAgreements;
export const canViewFinancials = (role: C3Role): boolean => capabilitiesFor(role).canViewFinancials;
export const canViewPerDiem = (role: C3Role): boolean => capabilitiesFor(role).canViewPerDiem;

export function assertReadPeople(actor: Actor): void {
  if (!canReadPeople(actor.role)) {
    throw new ForbiddenError('Your role may not read the People register.', { role: actor.role });
  }
}

export function assertSubmitApproval(actor: Actor): void {
  if (!canSubmitApproval(actor.role)) {
    throw new ForbiddenError('Your role may not submit approvals.', { role: actor.role, action: 'submit' });
  }
}

/**
 * Guard a review-family action (begin review / approve / reject). Requires the
 * review capability (owner) AND that the actor is provably distinct from the
 * submitter. Fails closed on any indeterminate identity.
 */
export function assertReviewApproval(actor: Actor, submitterIdentity: string, action: ReviewAction): void {
  if (!canReviewApproval(actor.role)) {
    throw new ForbiddenError('Your role may not review approvals.', { role: actor.role, action });
  }
  const check = checkSelfReview(actor.identity, submitterIdentity);
  if (check.blocked) throw new SelfReviewError(check.reason);
}

/**
 * Guard execution. Requires the execute capability (owner) AND separation of
 * duties from the submitter (the requester may not execute their own request).
 */
export function assertExecuteApproval(actor: Actor, submitterIdentity: string): void {
  if (!canExecuteApproval(actor.role)) {
    throw new ForbiddenError('Your role may not execute approvals.', { role: actor.role, action: 'execute' });
  }
  const check = checkSelfReview(actor.identity, submitterIdentity);
  if (check.blocked) throw new SelfReviewError(check.reason);
}

/**
 * May the actor view the approvals inbox / an approval / its history? Actors who
 * can submit (operations) or review (owner) may; pure read-only roles may not.
 */
export function assertViewApprovals(actor: Actor): void {
  if (!canSubmitApproval(actor.role) && !canReviewApproval(actor.role)) {
    throw new ForbiddenError('Your role may not view approvals.', { role: actor.role });
  }
}

/** Fail-closed tenant match. Callers surface a mismatch as not-found. */
export function assertTenantMatch(actorTenantId: string, recordTenantId: string): void {
  if (actorTenantId !== recordTenantId || !actorTenantId) {
    throw new ForbiddenError('Cross-tenant access is not permitted.', { actorTenantId, recordTenantId });
  }
}

/**
 * Guard reading the Members register (sensitive directory data — owner and
 * operations only).
 */
export function assertReadMembers(actor: Actor): void {
  if (!canReadMembers(actor.role)) {
    throw new ForbiddenError('Your role may not view organization members.', { role: actor.role });
  }
}

/** Guard SUBMITTING a governed member operation (owner, operations). */
export function assertSubmitMemberChange(actor: Actor): void {
  if (!canSubmitMemberChange(actor.role)) {
    throw new ForbiddenError('Your role may not request member changes.', { role: actor.role, action: 'submit-member-change' });
  }
}

/**
 * Guard a DIRECT-audited journey lifecycle transition (Sprint 37 — the CP
 * "exempt-edit" posture: owner and operations; not approval-gated).
 */
export function assertOperateJourneys(actor: Actor): void {
  if (!canOperateJourneys(actor.role)) {
    throw new ForbiddenError('Your role may not operate journey lifecycles.', { role: actor.role });
  }
}

/** Guard direct-audited Kit management (Sprint 38: owner, operations). */
export function assertManageKit(actor: Actor): void {
  if (!canManageKit(actor.role)) {
    throw new ForbiddenError('Your role may not manage kit.', { role: actor.role });
  }
}

/** Guard direct-audited Apparel management (Sprint 38: owner, operations, hr — CP parity). */
export function assertManageApparel(actor: Actor): void {
  if (!canManageApparel(actor.role)) {
    throw new ForbiddenError('Your role may not manage apparel.', { role: actor.role });
  }
}

/**
 * Guard direct-audited Mission SHELL management (Sprint 39: owner, operations
 * — a deliberate grant; participant membership is governed, not gated here).
 */
export function assertManageMissions(actor: Actor): void {
  if (!canManageMissions(actor.role)) {
    throw new ForbiddenError('Your role may not manage missions.', { role: actor.role });
  }
}

/** Guard managing the tenant's legal operating entities (S48 — owner/operations). */
export function assertManageEntities(actor: Actor): void {
  if (!canManageEntities(actor.role)) {
    throw new ForbiddenError('Your role may not manage entities.', { role: actor.role });
  }
}

/**
 * Guard reading the Agreements domain (Sprint 41 — the CP Set-E boundary:
 * commercial data; hr and visitor are denied entirely, fail closed).
 */
export function assertReadAgreements(actor: Actor): void {
  if (!canReadAgreements(actor.role)) {
    throw new ForbiddenError('Agreements are unavailable for your role.', { role: actor.role });
  }
}

/** Non-throwing summary for building UX-only capability hints served to the web app. */
export interface CapabilityView {
  readonly canReadPeople: boolean;
  readonly canSubmitApproval: boolean;
  readonly canReviewApproval: boolean;
  readonly canExecuteApproval: boolean;
  readonly canReadMembers: boolean;
  readonly canSubmitMemberChange: boolean;
  readonly canOperateJourneys: boolean;
  readonly canManageKit: boolean;
  readonly canManageApparel: boolean;
  readonly canManageMissions: boolean;
  readonly canManageEntities: boolean;
  readonly canReadAgreements: boolean;
  readonly canViewFinancials: boolean;
  readonly canViewPerDiem: boolean;
}

export function capabilityView(role: C3Role): CapabilityView {
  const c = capabilitiesFor(role);
  return {
    canReadPeople: c.canReadPeople,
    canSubmitApproval: c.canSubmitApproval,
    canReviewApproval: c.canReviewApproval,
    canExecuteApproval: c.canExecuteApproval,
    canReadMembers: c.canReadMembers,
    canSubmitMemberChange: c.canSubmitMemberChange,
    canOperateJourneys: c.canOperateJourneys,
    canManageKit: c.canManageKit,
    canManageApparel: c.canManageApparel,
    canManageMissions: c.canManageMissions,
    canManageEntities: c.canManageEntities,
    canReadAgreements: c.canReadAgreements,
    canViewFinancials: c.canViewFinancials,
    canViewPerDiem: c.canViewPerDiem,
  };
}
