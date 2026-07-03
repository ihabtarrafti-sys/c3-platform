/**
 * participantWrites.ts
 *
 * Pure rules for the Sprint 29B governed participant membership writes
 * (AddMissionParticipant / RemoveMissionParticipant — full ADR-013).
 *
 * Single source of truth for payload validation, deterministic Title
 * construction, ExternalCode normalization, and the already-applied match
 * used by idempotent execution/recovery. Consumed by:
 *   - submit hooks (submission-time validation)
 *   - useExecuteApproval branches (authoritative execution-time validation)
 *   - Mock/SharePoint mission services (write guards)
 *   - scripts/s29b-parity-participant-writes.mjs (compiled-from-source parity)
 *
 * No React, no hooks, no service dependencies. Pure functions only.
 */

import type { MissionParticipant, MissionParticipantRole } from '@c3/types';

// ---------------------------------------------------------------------------
// Role set — must stay in sync with types/mission.ts (choice-drift rule)
// ---------------------------------------------------------------------------

export const PARTICIPANT_ROLES: MissionParticipantRole[] = [
  'Player',
  'Coach',
  'Manager',
  'Analyst',
  'Staff',
];

const VALID_ROLE_SET = new Set<string>(PARTICIPANT_ROLES);

// ---------------------------------------------------------------------------
// Normalization + deterministic Title
// ---------------------------------------------------------------------------

/** Normalize an operator-entered ExternalCode: trim; casing preserved. */
export function normalizeExternalCode(raw: string): string {
  return raw.trim();
}

/**
 * Deterministic display Title for a participant row ("<MissionID>|<PersonID>").
 * Doubles as the SharePoint EnforceUniqueValues race guard. Display/constraint
 * only — NEVER parsed for identity (resolution uses the canonical columns).
 */
export function buildParticipantTitle(missionId: string, personId: string): string {
  return `${missionId}|${personId}`;
}

// ---------------------------------------------------------------------------
// Payload validation (pure — returns error messages; empty array = valid)
// ---------------------------------------------------------------------------

export interface AddParticipantFields {
  missionId: string;
  personId: string;
  externalCode: string;
  role: string;
  perDiemRate?: number;
}

export function validateAddParticipantPayload(p: AddParticipantFields): string[] {
  const errors: string[] = [];
  if (!p.missionId?.trim()) errors.push('MissionID is required.');
  if (!p.personId?.trim()) errors.push('PersonID is required.');
  if (!normalizeExternalCode(p.externalCode ?? '')) errors.push('ExternalCode is required.');
  if (!VALID_ROLE_SET.has(p.role)) errors.push(`Unknown participant role "${p.role}".`);
  if (p.perDiemRate !== undefined) {
    if (typeof p.perDiemRate !== 'number' || !Number.isFinite(p.perDiemRate)) {
      errors.push('PerDiemRate must be a finite number when provided.');
    } else if (p.perDiemRate < 0) {
      errors.push('PerDiemRate cannot be negative.');
    }
  }
  return errors;
}

export interface RemoveParticipantFields {
  missionId: string;
  personId: string;
  reason: string;
}

export function validateRemoveParticipantPayload(p: RemoveParticipantFields): string[] {
  const errors: string[] = [];
  if (!p.missionId?.trim()) errors.push('MissionID is required.');
  if (!p.personId?.trim()) errors.push('PersonID is required.');
  if (!p.reason?.trim()) errors.push('A removal reason is required.');
  return errors;
}

// ---------------------------------------------------------------------------
// Already-applied match (idempotent execution / stamp recovery)
// ---------------------------------------------------------------------------

/**
 * True when an existing ACTIVE participant row exactly matches the approved
 * payload — used by AddMissionParticipant execution to distinguish
 * "already applied (recover the stamp only)" from "conflicting active row
 * (stop with ParticipantConflictError)".
 *
 * PerDiemRate comparison treats undefined and absent as equal; ExternalCode
 * compares normalized.
 */
export function participantMatchesPayload(
  existing: MissionParticipant,
  payload: AddParticipantFields,
): boolean {
  return (
    existing.MissionID === payload.missionId &&
    existing.PersonID === payload.personId &&
    existing.Role === payload.role &&
    normalizeExternalCode(existing.ExternalCode) === normalizeExternalCode(payload.externalCode) &&
    (existing.PerDiemRate ?? null) === (payload.perDiemRate ?? null)
  );
}

// ---------------------------------------------------------------------------
// Pending-request duplicate key
// ---------------------------------------------------------------------------

/** Approval statuses that block a duplicate membership request. */
export const PENDING_APPROVAL_STATUSES = ['Submitted', 'InReview', 'Approved'] as const;

/**
 * Duplicate-pending key: one in-flight request per
 * operationType + MissionID + PersonID.
 */
export function pendingRequestKey(
  operationType: 'AddMissionParticipant' | 'RemoveMissionParticipant',
  missionId: string,
  personId: string,
): string {
  return `${operationType}|${missionId}|${personId}`;
}
