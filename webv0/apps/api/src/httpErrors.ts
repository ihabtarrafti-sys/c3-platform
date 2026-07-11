/**
 * httpErrors.ts — map domain errors to HTTP at the transport edge. The domain
 * never knows about HTTP; this is the only place codes become statuses.
 */
import { type DomainError, isDomainError, type DomainErrorCode } from '@c3web/domain';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  SELF_REVIEW_BLOCKED: 403,
  APPROVAL_NOT_APPROVED: 409,
  APPROVAL_ALREADY_EXECUTED: 409,
  CONCURRENCY: 409,
  TENANT_CONTEXT_MISSING: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  // Sprint 35 tenant-admin guards: self-administration is a permission
  // boundary (403); the other two are state-integrity refusals (409).
  SELF_ADMINISTRATION_BLOCKED: 403,
  LAST_OWNER_PROTECTED: 409,
  IDENTITY_ALREADY_BOUND: 409,
  // Sprint 39: duplicate-participant refusals are state conflicts.
  PARTICIPANT_CONFLICT: 409,
  // Track B6: an intake token that is unknown / expired / used / revoked —
  // 410 Gone (it may once have been valid; it is not now).
  INTAKE_LINK_UNAVAILABLE: 410,
};

export interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function mapError(err: unknown): MappedError {
  if (isDomainError(err)) {
    const de = err as DomainError;
    return { status: STATUS_BY_CODE[de.code] ?? 400, code: de.code, message: de.message, details: de.details as Record<string, unknown> | undefined };
  }
  // Unique-violation from Postgres surfacing to the edge → conflict.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
    return { status: 409, code: 'CONFLICT', message: 'The operation conflicts with an existing record.' };
  }
  return { status: 500, code: 'INTERNAL', message: 'An unexpected error occurred.' };
}
