/**
 * lifecycle.ts — approval status value set and legal transitions (ADR-013).
 *
 * Extracted from the frozen reference's ApprovalStatusValue + the documented
 * lifecycle. Review state and execution state are DISTINCT:
 *
 *   Submitted ── beginReview ──▶ InReview ── approve ──▶ Approved
 *                                   │                       │
 *                                   └── reject ──▶ Rejected  ├─ execute(ok)  ──▶ Executed
 *                                                            └─ execute(fail) ──▶ ExecutionFailed
 *                                                                                    │
 *                                                            (idempotent retry) ─────┘──▶ Executed
 *
 * A Rejected/Executed row is terminal. ExecutionFailed is a recoverable state
 * from which a safe retry may still reach Executed (idempotency boundary lives
 * in the execute use-case).
 */

export const APPROVAL_STATUSES = [
  'Submitted',
  'InReview',
  'Approved',
  'Rejected',
  'Executed',
  'ExecutionFailed',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

export type ApprovalAction = 'beginReview' | 'approve' | 'reject' | 'executeSuccess' | 'executeFailure';

/** The status an action moves an approval INTO, given its current status. */
const TRANSITIONS: Readonly<Record<ApprovalAction, { from: readonly ApprovalStatus[]; to: ApprovalStatus }>> = {
  beginReview: { from: ['Submitted'], to: 'InReview' },
  approve: { from: ['InReview'], to: 'Approved' },
  reject: { from: ['Submitted', 'InReview'], to: 'Rejected' },
  executeSuccess: { from: ['Approved', 'ExecutionFailed'], to: 'Executed' },
  executeFailure: { from: ['Approved', 'ExecutionFailed'], to: 'ExecutionFailed' },
};

export function canApply(action: ApprovalAction, from: ApprovalStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/** Resulting status for a legal action, or null when the action is illegal. */
export function nextStatus(action: ApprovalAction, from: ApprovalStatus): ApprovalStatus | null {
  return canApply(action, from) ? TRANSITIONS[action].to : null;
}

export function allowedActionsFrom(from: ApprovalStatus): ApprovalAction[] {
  return (Object.keys(TRANSITIONS) as ApprovalAction[]).filter((a) => canApply(a, from));
}

/** Pending band: an approval awaiting execution (blocks duplicate work). */
export const PENDING_STATUSES: readonly ApprovalStatus[] = ['Submitted', 'InReview', 'Approved'];
/** Actionable set: pending band + the recoverable ExecutionFailed state. */
export const ACTIONABLE_STATUSES: readonly ApprovalStatus[] = ['Submitted', 'InReview', 'Approved', 'ExecutionFailed'];
/** Terminal states. */
export const TERMINAL_STATUSES: readonly ApprovalStatus[] = ['Executed', 'Rejected'];

export const isPending = (s: ApprovalStatus): boolean => PENDING_STATUSES.includes(s);
export const isActionable = (s: ApprovalStatus): boolean => ACTIONABLE_STATUSES.includes(s);
export const isTerminal = (s: ApprovalStatus): boolean => TERMINAL_STATUSES.includes(s);
