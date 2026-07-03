/**
 * spApprovalMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items from the
 * C3Approvals list and the typed C3Approval domain object.
 *
 * Sprint 18 Phase 2B (S18-2B).
 *
 * Design follows the S15/S16/S17 spCredentialMapper / spPersonMapper /
 * spJourneyMapper pattern:
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - All validation and type-guarding lives here -- the service layer calls
 *     mapSpItemsToApprovals and receives typed C3Approval[] with counts.
 *   - Invalid/unknown values degrade gracefully:
 *       Title                        -> NEVER a reject (S29B): legacy APR-XXXX
 *         passes through; blank/correlation values derive from the item ID
 *       Missing/blank ApprovalStatus -> hard reject
 *       Invalid ApprovalStatus value -> hard reject
 *       Missing/blank OperationType  -> hard reject
 *       Null ID                      -> hard reject
 *       Missing SubmittedBy          -> soft warn
 *       Missing SubmittedAt          -> soft warn
 *       Missing Payload              -> soft warn
 *       Executed but no ExecutedAt   -> soft warn (data inconsistency)
 *   - DateTime fields (SubmittedAt, ReviewedAt, ExecutedAt) use
 *     normalizeSpDateTime (full ISO string preserved -- not date-only).
 *     normalizeSpDate must NOT be used here.
 *   - TargetPersonID is a plain-text canonical C3 PersonID (e.g. "PER-0001"),
 *     NOT a numeric SharePoint lookup item ID.
 *
 * Diagnostic prefix: [C3/Approvals]
 *
 * See: docs/architecture/C3Approvals SP List Schema.md
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import { normalizeSpDateTime } from './dateUtils';
import { APPROVAL_STATUS_VALUES, type ApprovalStatusValue } from '@c3/services/interfaces/IApprovalsService';

const PREFIX = '[C3/Approvals]';

// ---------------------------------------------------------------------------
// SpApprovalItem
//
// Raw shape of a C3Approvals SP list item from the REST API.
// Field names match the provisioned list column InternalNames exactly.
// All columns typed permissively -- the guard layer narrows them.
// ---------------------------------------------------------------------------

export interface SpApprovalItem {
  /** SP built-in integer primary key. */
  ID: number;
  /**
   * Display/correlation Title. Legacy rows: authoritative APR-XXXX. New rows
   * (S29B Add-only submissions): non-authoritative correlation value; the
   * ApprovalID derives from ID. Never parsed for operational identity.
   */
  Title: string | null;
  /** Governed operation type, e.g. 'InitiateJourney'. Null -> hard reject. */
  OperationType: string | null;
  /** Opaque secondary target reference (optional). */
  TargetID: string | null;
  /** Canonical C3 PersonID (e.g. "PER-0001"). Plain Text -- not a numeric lookup. */
  TargetPersonID: string | null;
  /** SPFx claims-format login name of the submitter. Null -> soft warn. */
  SubmittedBy: string | null;
  /** DateTime -- full ISO string. Null -> soft warn. */
  SubmittedAt: string | null;
  /** Current lifecycle state. Null or invalid value -> hard reject. */
  ApprovalStatus: string | null;
  /** Login name of the reviewer (set when entering InReview or Approved). */
  ReviewedBy: string | null;
  /** DateTime -- full ISO string. */
  ReviewedAt: string | null;
  /** DateTime -- full ISO string. Set on Executed state. */
  ExecutedAt: string | null;
  /** Error detail when ApprovalStatus is ExecutionFailed. */
  ExecutionError: string | null;
  /** Login name of the delegator (if approval was delegated). */
  DelegatedBy: string | null;
  /** Login name of the delegate. */
  DelegateTo: string | null;
  /** Human-readable reason for the request. */
  Reason: string | null;
  /** Reason for rejection (set when ApprovalStatus is Rejected). */
  RejectionReason: string | null;
  /** JSON-serialised payload for the governed operation. Null -> soft warn. */
  Payload: string | null;
}

// ---------------------------------------------------------------------------
// C3Approval -- domain type
// ---------------------------------------------------------------------------

export interface C3Approval {
  /** SP list item ID. */
  id: number;
  /** APR-XXXX reference identifier. */
  title: string;
  operationType: string;
  targetId: string | undefined;
  targetPersonId: string | undefined;
  submittedBy: string;
  submittedAt: string | undefined;
  approvalStatus: ApprovalStatusValue;
  reviewedBy: string | undefined;
  reviewedAt: string | undefined;
  executedAt: string | undefined;
  executionError: string | undefined;
  delegatedBy: string | undefined;
  delegateTo: string | undefined;
  reason: string | undefined;
  rejectionReason: string | undefined;
  payload: string | undefined;
}

// ---------------------------------------------------------------------------
// SpApprovalMapResult
// ---------------------------------------------------------------------------

export interface SpApprovalMapResult {
  mapped: number;
  rejected: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// ApprovalID derivation (S29B immutable-submission hardening)
// ---------------------------------------------------------------------------

/** Legacy authoritative Title shape written by the pre-S29B MERGE flow. */
const APR_TITLE_PATTERN = /^APR-\d{4,}$/;

/**
 * Derive the displayed ApprovalID for a C3Approvals row.
 *
 *   - A legacy Title matching APR-XXXX is accepted as-is (those values were
 *     themselves derived from the SP item ID by the old POST-then-MERGE flow,
 *     so both schemes agree for historical rows).
 *   - Anything else (blank, TMP-*, APR-PENDING-* correlation values) derives
 *     APR-<ID padded to 4> from the SharePoint item ID — deterministic: the
 *     same item always maps to the same identifier.
 *
 * This is internal same-list persistence/display derivation ONLY. The SP
 * numeric Id never becomes a cross-domain foreign key, and Title is never
 * parsed for operational payload identity.
 */
export function deriveApprovalTitle(id: number, rawTitle: string | null | undefined): string {
  const trimmed = rawTitle?.trim() ?? '';
  if (APR_TITLE_PATTERN.test(trimmed)) return trimmed;
  return `APR-${String(id).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// mapSpItemToApproval
// ---------------------------------------------------------------------------

/**
 * Map a single raw C3Approvals SP list item to a typed C3Approval.
 *
 * Returns null (hard reject) if:
 *   - ID is null or NaN
 *   - ApprovalStatus is blank, null, or not in the 6-value lifecycle set
 *   - OperationType is blank or null
 *
 * Title no longer hard-rejects (S29B): the ApprovalID is derived via
 * deriveApprovalTitle — legacy APR-XXXX Titles pass through; new Add-only
 * submissions carry a correlation Title and derive from the item ID.
 *
 * Non-fatal anomalies increment warnRef.count and log a warning; the record
 * is still returned.
 */
export function mapSpItemToApproval(
  item: SpApprovalItem,
  warnRef: { count: number },
): C3Approval | null {
  const itemLabel = `Item ${item.ID}`;

  // Hard reject: null/NaN ID
  if (item.ID == null || isNaN(item.ID)) {
    console.warn(`${PREFIX} item with null ID -- record rejected`);
    return null;
  }

  // ApprovalID (S29B): legacy APR-XXXX Titles pass through; correlation/blank
  // Titles derive deterministically from the SP item ID. Never a hard reject.
  const title = deriveApprovalTitle(item.ID, item.Title);

  // Hard reject: missing or invalid ApprovalStatus
  if (!item.ApprovalStatus || !APPROVAL_STATUS_VALUES.has(item.ApprovalStatus)) {
    console.warn(
      `${PREFIX} ${itemLabel}: invalid ApprovalStatus "${item.ApprovalStatus ?? ''}" -- record rejected`,
    );
    return null;
  }

  // Hard reject: missing OperationType
  if (!item.OperationType || item.OperationType.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing OperationType -- record rejected`);
    return null;
  }

  // Soft warns
  if (!item.SubmittedBy) {
    console.warn(`${PREFIX} ${itemLabel}: missing SubmittedBy -- identity will be empty`);
    warnRef.count++;
  }

  if (!item.SubmittedAt) {
    console.warn(`${PREFIX} ${itemLabel}: missing SubmittedAt -- timestamp will be absent`);
    warnRef.count++;
  }

  if (!item.Payload) {
    console.warn(`${PREFIX} ${itemLabel}: missing Payload -- execution will fail if attempted`);
    warnRef.count++;
  }

  if (item.ApprovalStatus === 'Executed' && !item.ExecutedAt) {
    console.warn(
      `${PREFIX} ${itemLabel}: ApprovalStatus is Executed but ExecutedAt is absent -- data inconsistency`,
    );
    warnRef.count++;
  }

  // DateTime fields -- full ISO string preserved
  const submittedAt  = normalizeSpDateTime(item.SubmittedAt,  `${itemLabel}.SubmittedAt`,  warnRef, PREFIX);
  const reviewedAt   = normalizeSpDateTime(item.ReviewedAt,   `${itemLabel}.ReviewedAt`,   warnRef, PREFIX);
  const executedAt   = normalizeSpDateTime(item.ExecutedAt,   `${itemLabel}.ExecutedAt`,   warnRef, PREFIX);

  return {
    id:              item.ID,
    title:           title,
    operationType:   item.OperationType.trim(),
    targetId:        item.TargetID?.trim() || undefined,
    targetPersonId:  item.TargetPersonID?.trim() || undefined,
    submittedBy:     item.SubmittedBy?.trim() ?? '',
    submittedAt,
    approvalStatus:  item.ApprovalStatus as ApprovalStatusValue,
    reviewedBy:      item.ReviewedBy?.trim() || undefined,
    reviewedAt,
    executedAt,
    executionError:  item.ExecutionError?.trim() || undefined,
    delegatedBy:     item.DelegatedBy?.trim() || undefined,
    delegateTo:      item.DelegateTo?.trim() || undefined,
    reason:          item.Reason?.trim() || undefined,
    rejectionReason: item.RejectionReason?.trim() || undefined,
    payload:         item.Payload?.trim() || undefined,
  };
}

// ---------------------------------------------------------------------------
// mapSpItemsToApprovals
// ---------------------------------------------------------------------------

/**
 * Map a batch of raw C3Approvals SP list items to typed C3Approval[].
 *
 * Logs one aggregate diagnostic line at the end of the batch.
 * Individual rejection/warning lines are logged by mapSpItemToApproval.
 */
export function mapSpItemsToApprovals(
  items: SpApprovalItem[],
): { approvals: C3Approval[]; result: SpApprovalMapResult } {
  const warnRef = { count: 0 };
  const approvals: C3Approval[] = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToApproval(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      approvals.push(mapped);
    }
  }

  const result: SpApprovalMapResult = {
    mapped: approvals.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listApprovals: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { approvals, result };
}
