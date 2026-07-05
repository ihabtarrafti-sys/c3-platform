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
  | 'CONFLICT';

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

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
