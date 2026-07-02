/**
 * spMissionMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `Mission` interface consumed by the C3 platform.
 *
 * Sprint 26 (S26-2) -- Mission/Event Read Foundation.
 *
 * Design follows the S15/S16/S17 spCredentialMapper / spPersonMapper /
 * spJourneyMapper pattern:
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - All validation and type-guarding lives here -- the service layer calls
 *     mapSpItemsToMissions and receives typed Mission[] with diagnostic counts.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing/blank Title (MissionID)  -> record rejected (hard reject)
 *       Missing/blank Name               -> record rejected (hard reject)
 *       Unknown Entity value             -> record rejected (hard reject)
 *       Unknown MissionStatus value      -> record rejected (hard reject;
 *         ADR-002 gate depends on exact status values -- a mission with an
 *         unrecognised status must not silently pass through gap computation)
 *       Missing StartDate or EndDate     -> record rejected (hard reject;
 *         Span drives obligation windows and urgency horizons)
 *       Missing SettlementDate           -> warn, empty string (financial
 *         metadata -- not used in operational gap computation)
 *       Unknown OperatingCurrency        -> warn, field treated as undefined
 *       Blank Game/Organizer/Jurisdiction/CreatedBy -> warn, empty string
 *       All other absent optional fields -> undefined, no warn
 *   - Span dates (StartDate, EndDate, SettlementDate) are DateOnly SP columns
 *     -- normalizeSpDate strips to YYYY-MM-DD, matching the Mock DSM shape.
 *   - Timestamp fields (Created -> CreatedAt, ConfirmedAt) are DateTime SP
 *     columns -- normalizeSpDateTime preserves the full ISO datetime string.
 *   - Mission.CreatedAt maps from the SP-managed `Created` column. CreatedBy
 *     maps from the plain-text `CreatedBy` column (NOT the SP Author column).
 *
 * Diagnostic prefix: [C3/Mission]
 *
 * See: docs/architecture/C3Missions SP List Schema.md
 */

import type { Mission, MissionEntity, MissionStatus } from '@c3/types';
import { normalizeSpDate, normalizeSpDateTime } from './dateUtils';

// ---------------------------------------------------------------------------
// SpMissionItem
//
// Shape of a raw SharePoint REST list item for C3Missions.
// Field names match the list schema column internal names exactly.
// All fields typed permissively -- type-guard layer narrows them.
// ---------------------------------------------------------------------------

export interface SpMissionItem {
  /** SP built-in integer primary key. Never used as a mission identifier. */
  Id: number;

  /**
   * Title column repurposed as MissionID -- the business TR/SATR code
   * (e.g. "TR/2026/006"). Business-assigned, never SP-generated.
   * Blank or null -> hard reject.
   */
  Title: string | null;

  /** Display name, e.g. "RLCS 2026 - World Championship & EWC". Blank -> hard reject. */
  Name: string | null;

  /** Game title, e.g. "Rocket League". Blank -> warn + empty string. */
  Game: string | null;

  /** Tournament organiser. Blank -> warn + empty string. */
  Organizer: string | null;

  /**
   * Choice column -- one of the 3 MissionEntity values (UAE / KSA / Multi).
   * Unknown value -> hard reject.
   */
  Entity: string | null;

  /**
   * Choice column -- one of the 7 MissionStatus values.
   * SP internal column name is MissionStatus (not Status -- reserved word in SP).
   * Unknown value -> hard reject (ADR-002 gate integrity).
   */
  MissionStatus: string | null;

  /** Operational jurisdiction, "City, Country". Blank -> warn + empty string. */
  Jurisdiction: string | null;

  /** DateOnly -- first operational day. Missing -> hard reject. */
  StartDate: string | null;

  /** DateOnly -- last operational day (urgency horizon). Missing -> hard reject. */
  EndDate: string | null;

  /** DateOnly -- financial closure. Missing -> warn + empty string. */
  SettlementDate: string | null;

  /** Choice column -- USD / AED / SAR / EUR. Unknown -> warn + undefined. */
  OperatingCurrency: string | null;

  /** Plain-text staff name/email (NOT the SP Author column). Blank -> warn + empty string. */
  CreatedBy: string | null;

  /** UTC datetime the mission reached Confirmed (optional). */
  ConfirmedAt: string | null;

  /** Staff member who confirmed (optional). */
  ConfirmedBy: string | null;

  /** Free-text notes (optional). */
  Notes: string | null;

  /** SP-managed creation timestamp. Maps to Mission.CreatedAt. */
  Created: string | null;
}

// ---------------------------------------------------------------------------
// SpMissionMapResult
// ---------------------------------------------------------------------------

export interface SpMissionMapResult {
  mapped: number;
  rejected: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Known value sets -- validated at mapping time
//
// Must stay in sync with the unions in types/mission.ts and the SP choice
// values in C3Missions SP List Schema.md (choice-value drift risk, see §10).
// ---------------------------------------------------------------------------

const VALID_MISSION_STATUSES = new Set<string>([
  'Planning',
  'FinancePending',
  'Confirmed',
  'Active',
  'PostMission',
  'Settled',
  'Canceled',
]);

const VALID_ENTITIES = new Set<string>(['UAE', 'KSA', 'Multi']);

const VALID_CURRENCIES = new Set<string>(['USD', 'AED', 'SAR', 'EUR']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PREFIX = '[C3/Mission]';

/** Trim a required-by-schema string field; warn and return '' when blank. */
function requiredText(
  val: string | null,
  context: string,
  warnRef: { count: number },
): string {
  const trimmed = val?.trim() ?? '';
  if (trimmed === '') {
    console.warn(`${PREFIX} ${context}: blank required field -- treated as empty`);
    warnRef.count++;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// mapSpItemToMission
// ---------------------------------------------------------------------------

/**
 * Map a single raw SP list item to a typed Mission.
 *
 * Returns null (hard reject) if:
 *   - Title (MissionID) is blank or null
 *   - Name is blank or null
 *   - Entity is unknown (not in MissionEntity union)
 *   - MissionStatus is unknown (not in MissionStatus union)
 *   - StartDate or EndDate is missing/unparseable
 *
 * Non-fatal anomalies increment warnRef.count and log a warning; the record
 * is still returned.
 */
export function mapSpItemToMission(
  item: SpMissionItem,
  warnRef: { count: number },
): Mission | null {
  const itemLabel = `Item ${item.Id}`;

  // Hard reject: missing MissionID
  if (!item.Title || item.Title.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing MissionID (Title) -- record rejected`);
    return null;
  }

  // Hard reject: missing Name
  if (!item.Name || item.Name.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing Name -- record rejected`);
    return null;
  }

  // Hard reject: unknown Entity
  if (!item.Entity || !VALID_ENTITIES.has(item.Entity)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown Entity "${item.Entity ?? ''}" -- record rejected`,
    );
    return null;
  }

  // Hard reject: unknown MissionStatus (ADR-002 gate integrity)
  if (!item.MissionStatus || !VALID_MISSION_STATUSES.has(item.MissionStatus)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown MissionStatus "${item.MissionStatus ?? ''}" -- record rejected. ` +
      'Verify the C3Missions choice values match the MissionStatus union exactly.',
    );
    return null;
  }

  // Span dates -- DateOnly columns, normalised to YYYY-MM-DD
  const startDate = normalizeSpDate(item.StartDate, `${itemLabel}.StartDate`, warnRef, PREFIX);
  const endDate = normalizeSpDate(item.EndDate, `${itemLabel}.EndDate`, warnRef, PREFIX);
  const settlementDate = normalizeSpDate(
    item.SettlementDate,
    `${itemLabel}.SettlementDate`,
    warnRef,
    PREFIX,
  );

  // Hard reject: missing operational span boundaries
  if (!startDate || !endDate) {
    console.warn(
      `${PREFIX} ${itemLabel}: missing StartDate or EndDate -- record rejected ` +
      '(Span drives obligation windows and urgency horizons)',
    );
    return null;
  }

  if (!settlementDate) {
    console.warn(
      `${PREFIX} ${itemLabel}: missing SettlementDate -- treated as empty (financial metadata)`,
    );
    warnRef.count++;
  }

  // OperatingCurrency -- optional Choice; unknown value degrades to undefined
  let operatingCurrency: Mission['OperatingCurrency'];
  if (item.OperatingCurrency && item.OperatingCurrency.trim() !== '') {
    if (VALID_CURRENCIES.has(item.OperatingCurrency)) {
      operatingCurrency = item.OperatingCurrency as Mission['OperatingCurrency'];
    } else {
      console.warn(
        `${PREFIX} ${itemLabel}: unknown OperatingCurrency "${item.OperatingCurrency}" -- treated as absent`,
      );
      warnRef.count++;
    }
  }

  // Timestamps -- full ISO datetime preserved
  const createdAt = normalizeSpDateTime(item.Created, `${itemLabel}.Created`, warnRef, PREFIX);
  const confirmedAt = normalizeSpDateTime(item.ConfirmedAt, `${itemLabel}.ConfirmedAt`, warnRef, PREFIX);

  return {
    MissionID:    item.Title.trim(),
    Name:         item.Name.trim(),
    Game:         requiredText(item.Game, `${itemLabel}.Game`, warnRef),
    Organizer:    requiredText(item.Organizer, `${itemLabel}.Organizer`, warnRef),
    Entity:       item.Entity as MissionEntity,
    Status:       item.MissionStatus as MissionStatus,
    Jurisdiction: requiredText(item.Jurisdiction, `${itemLabel}.Jurisdiction`, warnRef),
    Span: {
      StartDate:      startDate,
      EndDate:        endDate,
      SettlementDate: settlementDate ?? '',
    },
    OperatingCurrency: operatingCurrency,
    CreatedAt:    createdAt ?? '',
    CreatedBy:    requiredText(item.CreatedBy, `${itemLabel}.CreatedBy`, warnRef),
    ConfirmedAt:  confirmedAt,
    ConfirmedBy:  item.ConfirmedBy?.trim() || undefined,
    Notes:        item.Notes?.trim() || undefined,
  };
}

// ---------------------------------------------------------------------------
// mapSpItemsToMissions
// ---------------------------------------------------------------------------

/**
 * Map a batch of raw SP list items to typed Mission[].
 *
 * Logs one aggregate diagnostic line at the end of the batch.
 * Individual rejection/warning lines are logged by mapSpItemToMission.
 *
 * Returns { missions, result } -- the caller (service layer) uses only
 * missions; result is available for diagnostic logging.
 */
export function mapSpItemsToMissions(
  items: SpMissionItem[],
): { missions: Mission[]; result: SpMissionMapResult } {
  const warnRef = { count: 0 };
  const missions: Mission[] = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToMission(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      missions.push(mapped);
    }
  }

  const result: SpMissionMapResult = {
    mapped: missions.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listMissions: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { missions, result };
}
