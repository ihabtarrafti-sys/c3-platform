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
