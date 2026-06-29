/**
 * spJourneyMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `Journey` interface consumed by the C3 platform.
 *
 * Sprint 17 (S17-1) — Journey Integration.
 *
 * Design follows the S15/S16 spCredentialMapper / spPersonMapper pattern:
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - All validation and type-guarding lives here — the service layer calls
 *     mapSpItemsToJourneys and receives typed Journey[] with diagnostic counts.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing/blank Title (JourneyID)  → record rejected (hard reject)
 *       Missing/blank PersonID           → record rejected (hard reject)
 *       Unknown Type value               → record rejected (hard reject)
 *       Unknown Status value             → record rejected (hard reject)
 *       Malformed ObligationAssignmentsJSON → warn, field treated as undefined
 *       Blank ObligationAssignmentsJSON  → undefined, no warn (absent optional field)
 *       All other absent optional fields → undefined, no warn
 *   - DateTime fields (InitiatedAt, CompletedAt, assignedAt) are preserved as
 *     full ISO datetime strings. normalizeSpDate is NOT used here — it strips to
 *     date-only (YYYY-MM-DD), which would corrupt Journey datetime semantics.
 *     Journey DateTimes are DateTime SP columns, not DateOnly.
 *   - Unknown PersonID values (non-blank) are NOT rejected. FK validation
 *     against the People list is not the mapper's responsibility.
 *
 * Diagnostic prefix: [C3/Journey]
 *
 * See: docs/architecture/C3Journeys SP List Schema.md
 * See: docs/adr/ADR-003-journey-definition.md
 */

import type { Journey, JourneyType, JourneyStatus, ObligationAssignment } from '@c3/types';
import { normalizeSpDateTime } from './dateUtils';

// ---------------------------------------------------------------------------
// SpJourneyItem
//
// Shape of a raw SharePoint REST list item for C3Journeys.
// Field names match the list schema column internal names exactly.
// All fields typed permissively — type-guard layer narrows them.
// ---------------------------------------------------------------------------

export interface SpJourneyItem {
  /** SP built-in integer primary key. Not mapped to Journey type. */
  Id: number;

  /**
   * Title column repurposed as JourneyID (e.g. "JRN-0001").
   * Blank or null → hard reject.
   */
  Title: string | null;

  /**
   * Application-layer PersonID (e.g. "PER-0001").
   * Plain text — NOT a SP Lookup. Blank/null → hard reject.
   * Non-blank but unresolvable values are retained — no FK lookup here.
   */
  PersonID: string | null;

  /**
   * Choice column — one of the 5 JourneyType values.
   * SP internal column name is JourneyType (not Type -- reserved word in SP).
   * Unknown value → hard reject (Journey excluded from type-filtered queries).
   */
  JourneyType: string | null;

  /**
   * Choice column — one of the 4 JourneyStatus values.
   * Unknown value → hard reject.
   */
  Status: string | null;

  /** UTC datetime the journey was initiated. Required by schema. */
  InitiatedAt: string | null;

  /** Email or display name of the initiating staff member. Required. */
  InitiatedBy: string | null;

  /** Overall governance owner (optional). */
  AssignedTo: string | null;

  /** Free-text reason for initiation (optional). */
  InitiationReason: string | null;

  /** Linked ContractID (optional). */
  ContractID: string | null;

  /** Linked MissionID (optional). */
  MissionID: string | null;

  /** UTC datetime the journey reached Completed status (optional). */
  CompletedAt: string | null;

  /** Free-text notes (optional). */
  Notes: string | null;

  /**
   * Serialised JSON array of ObligationAssignment objects (optional).
   * Blank → undefined. Malformed → warn + undefined. Valid array → parsed.
   */
  ObligationAssignmentsJSON: string | null;
}

// ---------------------------------------------------------------------------
// SpJourneyMapResult
// ---------------------------------------------------------------------------

export interface SpJourneyMapResult {
  mapped: number;
  rejected: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Known value sets — validated at mapping time
// ---------------------------------------------------------------------------

const VALID_JOURNEY_TYPES = new Set<string>([
  'Onboarding',
  'VisaRenewal',
  'TeamTransfer',
  'ContractRenewal',
  'Offboarding',
]);

const VALID_JOURNEY_STATUSES = new Set<string>([
  'Active',
  'Completed',
  'Suspended',
  'Cancelled',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PREFIX = '[C3/Journey]';

/**
 * Parse the ObligationAssignmentsJSON plain-text column.
 *
 * Blank/null  → undefined, no warn (absent optional field)
 * Not an array → warn + undefined
 * Malformed   → warn + undefined
 * Valid array → ObligationAssignment[]
 *
 * Unknown obligationType values are passed through as-is. Filtering
 * unknown capability types is a coverage computation concern, not a mapper
 * concern.
 */
function parseObligationAssignments(
  raw: string | null | undefined,
  warnRef: { count: number },
): ObligationAssignment[] | undefined {
  if (!raw || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`${PREFIX} ObligationAssignmentsJSON parse failed — treated as empty`);
    warnRef.count++;
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    console.warn(`${PREFIX} ObligationAssignmentsJSON is not an array — treated as empty`);
    warnRef.count++;
    return undefined;
  }
  return parsed as ObligationAssignment[];
}

// ---------------------------------------------------------------------------
// mapSpItemToJourney
// ---------------------------------------------------------------------------

/**
 * Map a single raw SP list item to a typed Journey.
 *
 * Returns null (hard reject) if:
 *   - Title (JourneyID) is blank or null
 *   - PersonID is blank or null
 *   - Type is unknown (not in JourneyType union)
 *   - Status is unknown (not in JourneyStatus union)
 *
 * Non-fatal anomalies increment warnRef.count and log a warning; the record
 * is still returned.
 */
export function mapSpItemToJourney(
  item: SpJourneyItem,
  warnRef: { count: number },
): Journey | null {
  const itemLabel = `Item ${item.Id}`;

  // ── Hard reject: missing JourneyID ─────────────────────────────────────
  if (!item.Title || item.Title.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing JourneyID — record rejected`);
    return null;
  }

  // ── Hard reject: missing PersonID ──────────────────────────────────────
  if (!item.PersonID || item.PersonID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing PersonID — record rejected`);
    return null;
  }

  // ── Hard reject: unknown JourneyType ───────────────────────────────────
  if (!item.JourneyType || !VALID_JOURNEY_TYPES.has(item.JourneyType)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown JourneyType "${item.JourneyType ?? ''}" — record rejected`,
    );
    return null;
  }

  // ── Hard reject: unknown JourneyStatus ─────────────────────────────────
  if (!item.Status || !VALID_JOURNEY_STATUSES.has(item.Status)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown JourneyStatus "${item.Status ?? ''}" — record rejected`,
    );
    return null;
  }

  // ── DateTime fields — full ISO string preserved (not date-only) ─────────
  const initiatedAt = normalizeSpDateTime(item.InitiatedAt, `${itemLabel}.InitiatedAt`, warnRef, PREFIX);
  const completedAt = normalizeSpDateTime(item.CompletedAt, `${itemLabel}.CompletedAt`, warnRef, PREFIX);

  // ── ObligationAssignments — safe JSON parse ─────────────────────────────
  const obligationAssignments = parseObligationAssignments(item.ObligationAssignmentsJSON, warnRef);

  return {
    JourneyID:        item.Title.trim(),
    PersonID:         item.PersonID.trim(),
    Type:             item.JourneyType as JourneyType,
    Status:           item.Status as JourneyStatus,
    InitiatedAt:      initiatedAt ?? '',
    InitiatedBy:      item.InitiatedBy?.trim() ?? '',
    AssignedTo:       item.AssignedTo?.trim() || undefined,
    InitiationReason: item.InitiationReason?.trim() || undefined,
    ContractID:       item.ContractID?.trim() || undefined,
    MissionID:        item.MissionID?.trim() || undefined,
    CompletedAt:      completedAt,
    Notes:            item.Notes?.trim() || undefined,
    obligationAssignments,
  };
}

// ---------------------------------------------------------------------------
// mapSpItemsToJourneys
// ---------------------------------------------------------------------------

/**
 * Map a batch of raw SP list items to typed Journey[].
 *
 * Logs one aggregate diagnostic line at the end of the batch.
 * Individual rejection/warning lines are logged by mapSpItemToJourney.
 *
 * Returns { journeys, result } — the caller (service layer) uses only
 * journeys; result is available for diagnostic logging.
 */
export function mapSpItemsToJourneys(
  items: SpJourneyItem[],
): { journeys: Journey[]; result: SpJourneyMapResult } {
  const warnRef = { count: 0 };
  const journeys: Journey[] = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToJourney(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      journeys.push(mapped);
    }
  }

  const result: SpJourneyMapResult = {
    mapped: journeys.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listJourneys: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { journeys, result };
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       