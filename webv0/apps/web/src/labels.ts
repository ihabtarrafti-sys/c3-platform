import { formatMoney, formatPercentBps } from '@c3web/domain';
import type { AgreementTermDto } from '@c3web/api-contracts';
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
  Withdrawn: { label: 'Withdrawn', variant: 'neutral' },
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
  InitiateJourney: 'Initiate Journey',
  AddMissionParticipant: 'Add Mission Participant',
  RemoveMissionParticipant: 'Remove Mission Participant',
  AddAgreement: 'Add Agreement',
  RenewAgreement: 'Renew Agreement',
  TerminateAgreement: 'Terminate Agreement',
  AddAgreementTerm: 'Add Financial Term',
  UpdateAgreementTerm: 'Change Financial Term',
  RemoveAgreementTerm: 'Remove Financial Term',
  ImportBatch: 'Import Batch',
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
  ApprovalWithdrawn: 'Request withdrawn',
  PersonCreated: 'Person created',
  SessionEstablished: 'Session established',
  MemberProvisioned: 'Member provisioned',
  MemberRoleChanged: 'Role changed',
  MemberDeactivated: 'Member deactivated',
  MemberReactivated: 'Member reactivated',
  EmergencyLockout: 'Emergency lockout',
  CredentialCreated: 'Credential created',
  CredentialDeactivated: 'Credential deactivated',
  JourneyInitiated: 'Journey initiated',
  JourneySuspended: 'Journey suspended',
  JourneyResumed: 'Journey resumed',
  JourneyCompleted: 'Journey completed',
  JourneyCancelled: 'Journey cancelled',
  KitCreated: 'Kit item created',
  KitUpdated: 'Kit item updated',
  KitDeactivated: 'Kit item deactivated',
  ApparelCreated: 'Apparel item created',
  ApparelUpdated: 'Apparel item updated',
  ApparelDeactivated: 'Apparel item deactivated',
  MissionCreated: 'Mission created',
  MissionUpdated: 'Mission updated',
  MissionDeactivated: 'Mission deactivated',
  MissionParticipantAdded: 'Participant added',
  MissionParticipantRemoved: 'Participant removed',
  MissionParticipantPerDiemSet: 'Per-diem set',
  MissionLineAdded: 'P&L line added',
  MissionLineUpdated: 'P&L line updated',
  MissionLineRemoved: 'P&L line removed',
  MissionLinePaymentSet: 'Payment status set',
  MissionBudgetSet: 'Budget set',
  MissionFinanceStageChanged: 'Finance stage advanced',
  AgreementCreated: 'Agreement created',
  AgreementRenewed: 'Agreement renewed',
  AgreementTerminated: 'Agreement terminated',
  AgreementUpdated: 'Agreement updated',
  AgreementTermAdded: 'Financial term added',
  AgreementTermUpdated: 'Financial term updated',
  AgreementTermRemoved: 'Financial term removed',
  InvoiceIssued: 'Invoice issued',
  InvoiceVoided: 'Invoice voided',
};

/** S6 — invoice status → label + StatusBadge variant. */
const INVOICE_STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Issued: { label: 'Issued', variant: 'ready' },
  Voided: { label: 'Voided', variant: 'neutral' },
};
export function invoiceStatusOf(status: string): { label: string; variant: StatusVariant } {
  return INVOICE_STATUS[status] ?? { label: status, variant: 'neutral' };
}

/** Money in its native currency (integer minor units; formatMoney does the honest work). */
export function formatMinor(amountMinor: number, currency: string): string {
  return formatMoney(amountMinor, currency as Parameters<typeof formatMoney>[1]);
}

/** D-7 — equipment fulfillment status → label + StatusBadge variant. */
const EQUIPMENT_STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Received: { label: 'Received', variant: 'neutral' },
  InProgress: { label: 'In progress', variant: 'info' },
  OnHold: { label: 'On hold', variant: 'pending' },
  ReadyForShipment: { label: 'Ready for shipment', variant: 'info' },
  InTransit: { label: 'In transit', variant: 'info' },
  Delivered: { label: 'Delivered', variant: 'ready' },
  Done: { label: 'Done', variant: 'ready' },
  Rejected: { label: 'Rejected', variant: 'signal' },
};
export function equipmentStatusOf(status: string): { label: string; variant: StatusVariant } {
  return EQUIPMENT_STATUS[status] ?? { label: status, variant: 'neutral' };
}

/** D-7 — transition verb → button label. */
export const EQUIPMENT_TRANSITION_LABEL: Record<string, string> = {
  start: 'Start',
  hold: 'Hold',
  resume: 'Resume',
  ready: 'Ready to ship',
  ship: 'Ship',
  deliver: 'Deliver',
  complete: 'Mark done',
  reject: 'Reject',
};

/** Sprint 37 — journey status → label + StatusBadge variant. */
const JOURNEY_STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Active: { label: 'Active', variant: 'ready' },
  Suspended: { label: 'Suspended', variant: 'pending' },
  Completed: { label: 'Completed', variant: 'neutral' },
  Cancelled: { label: 'Cancelled', variant: 'blocked' },
};

export function journeyStatusOf(status: string): { label: string; variant: StatusVariant } {
  return JOURNEY_STATUS[status] ?? { label: status, variant: 'neutral' };
}

/** Sprint 41 — derived agreement renewal state (agreementRenewalStateOn) → label + variant. */
const AGREEMENT_RENEWAL_STATE: Record<string, { label: string; variant: StatusVariant }> = {
  Active: { label: 'Active', variant: 'ready' },
  Due90: { label: 'Due in 90', variant: 'pending' },
  Due60: { label: 'Due in 60', variant: 'pending' },
  Due30: { label: 'Due in 30', variant: 'blocked' },
  Expired: { label: 'Expired', variant: 'signal' },
  Terminated: { label: 'Terminated', variant: 'neutral' },
};

export function agreementRenewalStateOf(state: string): { label: string; variant: StatusVariant } {
  return AGREEMENT_RENEWAL_STATE[state] ?? { label: state, variant: 'neutral' };
}

/** Integer US cents → display currency (money is integers everywhere else). */
export function formatUsdCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Finance S3 — agreement financial term kind → human label. */
const AGREEMENT_TERM_KIND: Record<string, string> = {
  Salary: 'Salary (monthly)',
  PerformanceBonus: 'Performance bonus',
  Milestone: 'Milestone',
  PrizeSharePersonal: 'Prize share — personal',
  PrizeShareTeam: 'Prize share — team',
};
export function agreementTermKindOf(kind: string): string {
  return AGREEMENT_TERM_KIND[kind] ?? kind;
}

/** A term's value: money for monetary kinds, a percent for share kinds. */
export function formatTermValue(term: Pick<AgreementTermDto, 'amountMinor' | 'currency' | 'percentBps'>): string {
  if (term.percentBps != null) return formatPercentBps(term.percentBps);
  if (term.amountMinor != null && term.currency) return formatMoney(term.amountMinor, term.currency);
  return '—';
}

/** S2 — mission finance stage → label + StatusBadge variant. */
const MISSION_FINANCE_STAGE: Record<string, { label: string; variant: StatusVariant }> = {
  Planning: { label: 'Planning', variant: 'neutral' },
  FinancePending: { label: 'Finance pending', variant: 'pending' },
  Confirmed: { label: 'Confirmed', variant: 'info' },
  Active: { label: 'Active', variant: 'ready' },
  PostMission: { label: 'Post-mission', variant: 'pending' },
  Settled: { label: 'Settled', variant: 'ready' },
};
export function missionFinanceStageOf(stage: string): { label: string; variant: StatusVariant } {
  return MISSION_FINANCE_STAGE[stage] ?? { label: stage, variant: 'neutral' };
}

/** S2 — income payment status → label + StatusBadge variant. */
const PAYMENT_STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Expected: { label: 'Expected', variant: 'pending' },
  Invoiced: { label: 'Invoiced', variant: 'info' },
  Received: { label: 'Received', variant: 'ready' },
};
export function paymentStatusOf(status: string): { label: string; variant: StatusVariant } {
  return PAYMENT_STATUS[status] ?? { label: status, variant: 'neutral' };
}

/** S2 — line/budget category → human label (ids stay canonical on the wire). */
const LINE_CATEGORY: Record<string, string> = {
  PrizeMoney: 'Prize money',
  AppearanceFee: 'Appearance fee',
  Support: 'Support',
  Sponsorship: 'Sponsorship',
  RevenueShare: 'Revenue share',
  Buyout: 'Buyout',
  Campaign: 'Campaign',
  TravelReimbursement: 'Travel reimbursement',
  RegistrationFee: 'Registration fee',
  Travel: 'Travel',
  Accommodation: 'Accommodation',
  PlayerFee: 'Player fee',
  Equipment: 'Equipment',
  Logistics: 'Logistics',
  Contingency: 'Contingency',
  PerDiem: 'Per-diem',
  Other: 'Other',
};
export function lineCategoryOf(category: string): string {
  return LINE_CATEGORY[category] ?? category;
}
export function auditActionOf(action: string): string {
  return AUDIT_ACTION[action] ?? action;
}
