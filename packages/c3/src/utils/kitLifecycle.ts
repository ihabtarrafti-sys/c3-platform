/**
 * kitLifecycle.ts
 *
 * Pure kit-assignment lifecycle rules — Sprint 29A.
 *
 * Single source of truth for the approved KitStatus transition matrix,
 * reason requirements, audit-line formatting, deterministic Title
 * construction, and write-input validation. Consumed by:
 *
 *   - MockMissionService / SharePointMissionService   (authoritative guard)
 *   - MockApparelProfileService / SharePoint…          (apparel validation)
 *   - UI transition menus                              (affordance — shows only
 *                                                       valid target states)
 *   - scripts/s29-parity-kit-lifecycle.mjs             (compiled-from-source parity)
 *
 * UI validation is affordance; SERVICE validation is authority; SharePoint
 * list permissions are the security boundary (ADR-013 Addendum — Mission Kit
 * Logistics Exemption).
 *
 * No React, no hooks, no service dependencies. Pure functions only.
 */

import type { ItemCategory, JerseySize, KitStatus } from '@c3/types';
import { ITEM_CATEGORIES, JERSEY_SIZES } from '@c3/types';

// ---------------------------------------------------------------------------
// Transition matrix (approved at Sprint 29 Phase 0)
//
// Forward skips are allowed (hand-delivered items never "ship").
// Confirmed only from Delivered. No backward transitions — corrections go
// through the exception states. Replaced restarts the pipeline via Ordered.
// ---------------------------------------------------------------------------

export const KIT_TRANSITIONS: Record<KitStatus, KitStatus[]> = {
  NotOrdered: ['Ordered', 'Shipped', 'Delivered'],
  Ordered:    ['Shipped', 'Delivered', 'Missing'],
  Shipped:    ['Delivered', 'Missing'],
  Delivered:  ['Confirmed', 'Returned', 'Missing'],
  Confirmed:  ['Returned', 'Missing'],
  Returned:   ['Replaced'],
  Missing:    ['Replaced'],
  Replaced:   ['Ordered'],
};

/** Transitions INTO these states require a mandatory reason. */
export const REASON_REQUIRED_STATUSES: KitStatus[] = ['Returned', 'Missing', 'Replaced'];

/** True when `to` is a valid transition target from `from`. */
export function canTransitionKitStatus(from: KitStatus, to: KitStatus): boolean {
  return KIT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Valid target states from a given status — drives the UI transition menu. */
export function validKitTransitions(from: KitStatus): KitStatus[] {
  return [...(KIT_TRANSITIONS[from] ?? [])];
}

/** True when a transition into `to` requires a mandatory reason. */
export function kitTransitionRequiresReason(to: KitStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(to);
}

// ---------------------------------------------------------------------------
// AssignmentKey normalization + deterministic Title
// ---------------------------------------------------------------------------

/** Normalize an operator-entered AssignmentKey: trim; casing preserved. */
export function normalizeAssignmentKey(raw: string): string {
  return raw.trim();
}

/**
 * Deterministic display Title for a kit assignment row. Doubles as the
 * SharePoint EnforceUniqueValues race guard. Display/concurrency only —
 * NEVER parsed for identity (row resolution uses the canonical columns).
 */
export function buildKitAssignmentTitle(
  missionId: string,
  personId: string,
  itemCategory: ItemCategory,
  assignmentKey: string,
): string {
  return `${missionId}|${personId}|${itemCategory}|${assignmentKey}`;
}

// ---------------------------------------------------------------------------
// Audit lines (StatusNotes)
//
// Format (approved): [ISO_TIMESTAMP] KITSTATUS <old>→<new> by <loginName> — <reason>
// Creation and deactivation use the same shape with explicit markers.
// StatusNotes is readable context; SP version history + Editor is the
// authoritative actor record.
// ---------------------------------------------------------------------------

export function buildKitAuditLine(
  from: KitStatus | 'CREATED' | 'ACTIVE',
  to: KitStatus | 'DEACTIVATED',
  actorLoginName: string,
  reason?: string,
  nowIso?: string,
): string {
  const ts = nowIso ?? new Date().toISOString();
  const suffix = reason && reason.trim() !== '' ? ` — ${reason.trim()}` : '';
  return `[${ts}] KITSTATUS ${from}→${to} by ${actorLoginName}${suffix}`;
}

/** Append an audit line to existing StatusNotes (newline-separated). */
export function appendKitAuditLine(existing: string | null | undefined, line: string): string {
  const base = existing?.trim() ?? '';
  return base === '' ? line : `${base}\n${line}`;
}

// ---------------------------------------------------------------------------
// Write-input validation (pure — returns error messages; empty array = valid)
// ---------------------------------------------------------------------------

const VALID_CATEGORY_SET = new Set<string>(ITEM_CATEGORIES);
const VALID_SIZE_SET = new Set<string>(JERSEY_SIZES);
export const NAME_ON_JERSEY_MAX_LENGTH = 30;

export function validateCreateKitAssignmentInput(input: {
  MissionID: string;
  PersonID: string;
  ItemCategory: string;
  AssignmentKey: string;
  actorLoginName: string;
}): string[] {
  const errors: string[] = [];
  if (!input.actorLoginName?.trim()) errors.push('Actor identity is empty — refusing to write.');
  if (!input.MissionID?.trim()) errors.push('MissionID is required.');
  if (!input.PersonID?.trim()) errors.push('PersonID is required.');
  if (!VALID_CATEGORY_SET.has(input.ItemCategory)) errors.push(`Unknown ItemCategory "${input.ItemCategory}".`);
  if (!normalizeAssignmentKey(input.AssignmentKey ?? '')) errors.push('AssignmentKey is required.');
  return errors;
}

export function validateKitTransitionRequest(req: {
  toStatus: KitStatus;
  reason?: string;
  actorLoginName: string;
}): string[] {
  const errors: string[] = [];
  if (!req.actorLoginName?.trim()) errors.push('Actor identity is empty — refusing to write.');
  if (kitTransitionRequiresReason(req.toStatus) && !req.reason?.trim()) {
    errors.push(`A reason is required when transitioning to ${req.toStatus}.`);
  }
  return errors;
}

export function validateUpsertApparelProfileInput(input: {
  PersonID: string;
  JerseySize?: string;
  NameOnJersey?: string;
  actorLoginName: string;
}): string[] {
  const errors: string[] = [];
  if (!input.actorLoginName?.trim()) errors.push('Actor identity is empty — refusing to write.');
  if (!input.PersonID?.trim()) errors.push('PersonID is required.');
  if (input.JerseySize !== undefined && input.JerseySize !== '' && !VALID_SIZE_SET.has(input.JerseySize)) {
    errors.push(`Unknown JerseySize "${input.JerseySize}".`);
  }
  const name = input.NameOnJersey?.trim() ?? '';
  if (name.length > NAME_ON_JERSEY_MAX_LENGTH) {
    errors.push(`NameOnJersey exceeds ${NAME_ON_JERSEY_MAX_LENGTH} characters.`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Write-failure classification (pure — services translate HTTP outcomes into
// domain error categories; parity-testable without fetch)
// ---------------------------------------------------------------------------

export type WriteFailureKind =
  | 'concurrency'   // 412 — another operator changed the row; refresh and retry
  | 'duplicate'     // SP unique-constraint violation on the deterministic Title
  | 'permission'    // 403 — SharePoint list ACL denied the write
  | 'generic';

export function classifyWriteFailure(httpStatus: number, bodyText: string): WriteFailureKind {
  if (httpStatus === 412) return 'concurrency';
  if (httpStatus === 403) return 'permission';
  // SPDuplicateValuesFoundException surfaces as HTTP 400 with a recognisable message.
  if (httpStatus === 400 && /duplicate value|SPDuplicateValues/i.test(bodyText)) return 'duplicate';
  return 'generic';
}
