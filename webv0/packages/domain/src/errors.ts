/**
 * errors.ts — storage-neutral domain error taxonomy.
 *
 * Renamed/extracted from the frozen `services/errors.ts` (which carried
 * SharePoint-flavoured names like "ContractsListUnprovisioned"). Every error
 * carries a stable `code` so the API layer can map it to an HTTP status and a
 * structured error body WITHOUT string matching. HTTP mapping itself lives in
 * apps/api (the transport edge), never here.
 */

export type DomainErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'SELF_REVIEW_BLOCKED'
  | 'APPROVAL_NOT_APPROVED'
  | 'APPROVAL_ALREADY_EXECUTED'
  | 'CONCURRENCY'
  | 'TENANT_CONTEXT_MISSING'
  | 'FORBIDDEN'
  | 'CONFLICT'
  // Sprint 35 tenant-admin guards (A-8 Phase 2 design invariants).
  | 'SELF_ADMINISTRATION_BLOCKED'
  | 'LAST_OWNER_PROTECTED'
  | 'IDENTITY_ALREADY_BOUND'
  // Sprint 39 missions: the duplicate-participant guard family.
  | 'PARTICIPANT_CONFLICT'
  // Track B6 guest intake: an unclaimable token (unknown/expired/used/revoked).
  | 'INTAKE_LINK_UNAVAILABLE'
  // Comms: the tenant's module license is LAPSED (row present, outside its
  // window) — reads continue, writes refuse. Never used for never-entitled
  // (no row), which is 404 on BOTH read and write (module state must not leak).
  | 'MODULE_READ_ONLY';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  override readonly name: string = 'DomainError';
  /** Machine-readable, safe-to-serialise detail for the API error body. */
  readonly details?: Readonly<Record<string, unknown>>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  override readonly code = 'VALIDATION' as const;
  override readonly name = 'ValidationError';
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class NotFoundError extends DomainError {
  override readonly code = 'NOT_FOUND' as const;
  override readonly name = 'NotFoundError';
  constructor(entity: string, identity: string) {
    super(`${entity} not found: ${identity}`, { entity, identity });
  }
}

export class InvalidTransitionError extends DomainError {
  override readonly code = 'INVALID_TRANSITION' as const;
  override readonly name = 'InvalidTransitionError';
  constructor(from: string, action: string) {
    super(`Illegal approval transition: cannot '${action}' from status '${from}'.`, { from, action });
  }
}

export class SelfReviewError extends DomainError {
  override readonly code = 'SELF_REVIEW_BLOCKED' as const;
  override readonly name = 'SelfReviewError';
  constructor(reason: 'self' | 'indeterminate-reviewer' | 'indeterminate-submitter') {
    super(
      reason === 'self'
        ? 'A submitter may not review, approve, reject, or execute their own request.'
        : `Review blocked: ${reason} identity could not be verified (failing closed).`,
      { reason },
    );
  }
}

export class ApprovalNotApprovedError extends DomainError {
  override readonly code = 'APPROVAL_NOT_APPROVED' as const;
  override readonly name = 'ApprovalNotApprovedError';
  constructor(currentStatus: string) {
    super(`Execution requires an Approved request; current status is '${currentStatus}'.`, { currentStatus });
  }
}

export class ApprovalAlreadyExecutedError extends DomainError {
  override readonly code = 'APPROVAL_ALREADY_EXECUTED' as const;
  override readonly name = 'ApprovalAlreadyExecutedError';
  constructor(approvalId: string) {
    super(`Approval ${approvalId} is already Executed; execution is idempotent and will not run again.`, { approvalId });
  }
}

export class ConcurrencyError extends DomainError {
  override readonly code = 'CONCURRENCY' as const;
  override readonly name = 'ConcurrencyError';
  constructor(entity: string, identity: string) {
    super(`${entity} ${identity} was modified concurrently. Reload the latest version and retry.`, { entity, identity });
  }
}

export class TenantContextMissingError extends DomainError {
  override readonly code = 'TENANT_CONTEXT_MISSING' as const;
  override readonly name = 'TenantContextMissingError';
  constructor() {
    super('No tenant context is established for this operation. Failing closed.');
  }
}

export class ForbiddenError extends DomainError {
  override readonly code = 'FORBIDDEN' as const;
  override readonly name = 'ForbiddenError';
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class ConflictError extends DomainError {
  override readonly code = 'CONFLICT' as const;
  override readonly name = 'ConflictError';
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Track B6: a guest-intake token is not (or no longer) claimable — unknown,
 * expired, revoked, or already used. Deliberately non-specific to the guest
 * (no oracle: the message never distinguishes "unknown" from "used up").
 */
export class IntakeLinkUnavailableError extends DomainError {
  override readonly code = 'INTAKE_LINK_UNAVAILABLE' as const;
  override readonly name = 'IntakeLinkUnavailableError';
  constructor() {
    super('This intake link is no longer available. Ask your contact for a fresh link.');
  }
}

/**
 * Comms: the tenant's module license is LAPSED — the record stays readable,
 * writes refuse (403 at the edge; a licensing denial is not retryable, so never
 * the 409 conflict class). ONLY for row-present-outside-window; a never-entitled
 * tenant (no row) gets NotFound on both read and write — module state never leaks.
 */
export class ModuleReadOnlyError extends DomainError {
  override readonly code = 'MODULE_READ_ONLY' as const;
  override readonly name = 'ModuleReadOnlyError';
  constructor(moduleKey: string) {
    super('This module is read-only: the license has lapsed. The record remains readable.', { moduleKey });
  }
}

export class SelfAdministrationError extends DomainError {
  override readonly code = 'SELF_ADMINISTRATION_BLOCKED' as const;
  override readonly name = 'SelfAdministrationError';
  constructor(action: string) {
    super(`A member may not '${action}' their own access. Another authorized member must perform this.`, { action });
  }
}

export class LastOwnerProtectionError extends DomainError {
  override readonly code = 'LAST_OWNER_PROTECTED' as const;
  override readonly name = 'LastOwnerProtectionError';
  constructor(action: string) {
    super(`Refused: '${action}' would leave the organization without an active owner (failing closed).`, { action });
  }
}

export class IdentityAlreadyBoundError extends DomainError {
  override readonly code = 'IDENTITY_ALREADY_BOUND' as const;
  override readonly name = 'IdentityAlreadyBoundError';
  constructor() {
    super('This external identity is already bound to a user. Identity bindings are write-once (bind-once key).');
  }
}

/**
 * Sprint 39: a duplicate-participant refusal. Raised at SUBMIT (friendly, both
 * conflict kinds) and again authoritatively at EXECUTE inside the transaction
 * ('active-participant' only — a pair that became active between approval and
 * execution surfaces as a truthful ExecutionFailed, never a duplicate row).
 */
export class ParticipantConflictError extends DomainError {
  override readonly code = 'PARTICIPANT_CONFLICT' as const;
  override readonly name = 'ParticipantConflictError';
  constructor(missionId: string, personId: string, conflict: 'pending-approval' | 'active-participant') {
    super(
      conflict === 'pending-approval'
        ? `An open approval already exists for ${personId} on ${missionId}. Resolve it before submitting another.`
        : `${personId} is already an active participant of ${missionId}.`,
      { missionId, personId, conflict },
    );
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
