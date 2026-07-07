import type { StatusVariant } from './components/StatusBadge';

/**
 * Enum → human-label mappings (D.4–D.6). Raw internal enums must never appear in
 * the UI; this is the single binding source for approval status, operation, and
 * audit-action labels, shared by the registers and the detail surfaces.
 */

/** D.4 — approval status → label + StatusBadge variant. */
const APPROVAL_STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Submitted: { label: 'Submitted', variant: 'pending' },
  InReview: { label: 'In review', variant: 'pending' },
  Approved: { label: 'Approved', variant: 'ready' },
  Rejected: { label: 'Rejected', variant: 'blocked' },
  Executed: { label: 'Executed', variant: 'ready' },
  ExecutionFailed: { label: 'Execution failed', variant: 'blocked' },
};

export function approvalStatusOf(status: string): { label: string; variant: StatusVariant } {
  return APPROVAL_STATUS[status] ?? { label: status, variant: 'neutral' };
}

/** Sprint 36 — derived credential status (credentialStatusOn) → label + variant. */
const CREDENTIAL_STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Active: { label: 'Active', variant: 'ready' },
  ExpiresSoon: { label: 'Expires soon', variant: 'pending' },
  Expired: { label: 'Expired', variant: 'blocked' },
  Inactive: { label: 'Inactive', variant: 'neutral' },
};

export function credentialStatusOf(status: string): { label: string; variant: StatusVariant } {
  return CREDENTIAL_STATUS[status] ?? { label: status, variant: 'neutral' };
}

/** D.5 — operation type → label. */
const OPERATION: Record<string, string> = {
  AddPerson: 'Add Person',
  ProvisionMember: 'Provision Member',
  ChangeRole: 'Change Role',
  DeactivateMember: 'Deactivate Member',
  ReactivateMember: 'Reactivate Member',
  AddCredential: 'Add Credential',
  DeactivateCredential: 'Deactivate Credential',
};
export function operationOf(op: string): string {
  return OPERATION[op] ?? op;
}

/** D.6 — audit action (AUDIT_ACTIONS) → label. */
const AUDIT_ACTION: Record<string, string> = {
  ApprovalSubmitted: 'Request submitted',
  ApprovalReviewStarted: 'Review started',
  ApprovalApproved: 'Request approved',
  ApprovalRejected: 'Request rejected',
  ApprovalExecuted: 'Request executed',
  ApprovalExecutionFailed: 'Execution failed',
  PersonCreated: 'Person created',
  SessionEstablished: 'Session established',
  MemberProvisioned: 'Member provisioned',
  MemberRoleChanged: 'Role changed',
  MemberDeactivated: 'Member deactivated',
  MemberReactivated: 'Member reactivated',
  EmergencyLockout: 'Emergency lockout',
  CredentialCreated: 'Credential created',
  CredentialDeactivated: 'Credential deactivated',
};
export function auditActionOf(action: string): string {
  return AUDIT_ACTION[action] ?? action;
}
