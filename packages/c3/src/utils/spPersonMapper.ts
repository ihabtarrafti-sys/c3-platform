/**
 * spPersonMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `Person` interface consumed by the C3 platform.
 *
 * Sprint 16 (S16-5) — People Integration.
 *
 * Design follows the S15 spCredentialMapper pattern:
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - All validation and type-guarding lives here — the service layer calls
 *     mapSpItemsToPeople and receives typed Person[] with diagnostic counts.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing/blank Title (PersonID)  → record rejected (hard reject)
 *       Missing/blank FullName          → record rejected (hard reject)
 *       Unknown IsActive value          → false with console.warn
 *       Invalid date string             → undefined with console.warn (via normalizeSpDate)
 *       Non-numeric TotalContracts      → undefined with console.warn
 *       All other optional text fields  → undefined (no warn — absent optional field)
 *   - Inactive records are NOT rejected here. Filtering by IsActive belongs to the
 *     service layer via $filter=IsActive eq 1 in the SP query.
 *   - Aggregate diagnostic summary logged once per batch (console.info).
 *
 * CRITICAL — Title column mapping:
 *   In C3People, the built-in Title column stores the PersonID (e.g. "PER-0001").
 *   FullName is a SEPARATE column. Do NOT map Title → FullName.
 *   The legacy mapper at src/mappers/personMapper.ts maps Title → FullName —
 *   that is wrong for this schema and must not be used or referenced here.
 *
 * See: docs/architecture/C3People SP List Schema.md (authoritative schema reference)
 * See: docs/architecture/C3 Architecture Baseline — Sprint 16.md
 */

import type { Person } from '@c3/types';
import { normalizeSpDate } from './dateUtils';

// ---------------------------------------------------------------------------
// SpPersonItem
//
// Shape of a raw SharePoint REST list item for C3People.
// Fields match the list schema column internal names exactly.
// All fields are typed permissively (unknown | null) because SP REST
// responses can return null for optional columns — the type-guard layer
// below is responsible for narrowing.
//
// PLAIN TEXT FIELDS: CurrentTeam, CurrentGameTitle, PrimaryDepartment are
// plain text columns in C3People — NOT SharePoint Lookup columns. They must
// never be typed as SPLookupValue or object. The schema doc explicitly
// prohibits Lookup column creation for these fields to avoid complexity.
// ---------------------------------------------------------------------------

export interface SpPersonItem {
  /** SP built-in integer primary key — maps to Person.Id. */
  Id: number;

  /**
   * Title column repurposed as PersonID (e.g. "PER-0001").
   * Missing/blank → hard reject. See schema doc: Title = PersonID, not FullName.
   */
  Title: string | null;

  /**
   * Full legal name of the person, e.g. "Abdulaziz Alabdullatif".
   * Missing/blank → hard reject.
   */
  FullName: string | null;

  /** In-game name / alias. Optional. */
  IGN: string | null;

  /** Country of nationality, plain text. Optional. */
  Nationality: string | null;

  /** Primary role or job title, plain text. Optional. */
  PrimaryRole: string | null;

  /** Internal HR personnel code, e.g. "FN/PL/001". Optional. */
  PersonnelCode: string | null;

  /**
   * Current team assignment, plain text (e.g. "GKE Fortnite", "Operations").
   * NOT a SP Lookup — schema doc explicitly requires plain text column.
   */
  CurrentTeam: string | null;

  /**
   * Game title the person competes in or supports, plain text.
   * NOT a SP Lookup. Blank for staff not tied to a specific title.
   */
  CurrentGameTitle: string | null;

  /**
   * Organizational department, plain text (e.g. "Esports", "Creative").
   * NOT a SP Lookup.
   */
  PrimaryDepartment: string | null;

  /**
   * SP Yes/No column. SP REST returns boolean true/false for Yes/No columns.
   * Defensive handling covers legacy numeric (1/0) and string forms.
   */
  IsActive: boolean | number | string | null;

  /** SP DateOnly column — ISO-like string from REST, e.g. "2026-01-10T00:00:00Z". */
  FirstContractDate: string | null;

  /** SP DateOnly column — ISO-like string from REST. */
  LatestContractDate: string | null;

  /** SP Number column — running count of contracts. */
  TotalContracts: number | string | null;

  /** Free-text operational notes. Optional. */
  Notes: string | null;
}

// ---------------------------------------------------------------------------
// SpPersonMapResult
//
// Returned by the batch mapper so the service layer can log aggregate
// diagnostics and expose them to the DiagnosticsService.
// ---------------------------------------------------------------------------

export interface SpPersonMapResult {
  /** Successfully mapped persons. */
  people: Person[];
  /** Number of SP items rejected (hard errors: missing PersonID or FullName). */
  rejectedCount: number;
  /** Number of SP items mapped with non-fatal warnings (unknown IsActive, invalid date, etc.). */
  warnCount: number;
}

// ---------------------------------------------------------------------------
// IsActive parsing
//
// Follows the same pattern as spCredentialMapper.parseIsActive.
// Conservative default: unknown → false (treat as inactive) so the person
// does not silently satisfy obligations when their active status is uncertain.
// ---------------------------------------------------------------------------

function parseIsActive(val: unknown, ctx: string, warnRef: { count: number }): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 1 || val === '1' || val === 'Yes' || val === 'yes') return true;
  if (val === 0 || val === '0' || val === 'No'  || val === 'no')  return false;
  console.warn(
    `[C3/People] ${ctx}.IsActive: unknown value "${val}" — defaulting to false (inactive). ` +
    `Check SP column type; SP Yes/No should return boolean.`,
  );
  warnRef.count++;
  return false;
}

// ---------------------------------------------------------------------------
// TotalContracts parsing
//
// SP Number column — REST returns a number. Defensive handling for edge cases
// (stringified number, corrupt value). Returns undefined rather than 0 for
// corrupt values: 0 is a meaningful state (no contracts) and should not be
// silently assigned to records with corrupt data.
// ---------------------------------------------------------------------------

function parseTotalContracts(
  val: unknown,
  ctx: string,
  warnRef: { count: number },
): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) {
    console.warn(
      `[C3/People] ${ctx}.TotalContracts: non-numeric value "${val}" — treated as unknown.`,
    );
    warnRef.count++;
    return undefined;
  }
  return Math.max(0, Math.floor(n));
}

// ---------------------------------------------------------------------------
// Single-item mapper
//
// Returns a Person on success, null on hard rejection.
//
// Hard rejections:
//   1. Missing/blank Title (PersonID) — cannot identify who this record is for.
//   2. Missing/blank FullName — a person without a name cannot be displayed
//      or matched. Required column per schema; blank indicates a data entry error.
//
// Soft warnings (record is still returned):
//   - Unknown IsActive value → false
//   - Invalid date value → undefined (non-expiring semantics for dates)
//   - Non-numeric TotalContracts → undefined
// ---------------------------------------------------------------------------

/**
 * Map one raw SP list item to a Person.
 *
 * @returns A typed Person on success, or null if the record is hard-rejected
 *          (missing/blank Title or FullName).
 */
export function mapSpItemToPerson(
  item: SpPersonItem,
  warnRef: { count: number } = { count: 0 },
): Person | null {
  const ctx = `Item ${item.Id}`;

  // ── Hard reject: missing PersonID (blank Title) ────────────────────────────
  if (!item.Title || item.Title.trim() === '') {
    console.warn(`[C3/People] ${ctx}: missing PersonID (blank Title) — record rejected`);
    return null;
  }

  const personId = item.Title.trim();

  // ── Hard reject: missing FullName ──────────────────────────────────────────
  if (!item.FullName || item.FullName.trim() === '') {
    console.warn(
      `[C3/People] ${ctx} (${personId}): missing FullName — record rejected. ` +
      `FullName is a required column in C3People; check SP list for data entry errors.`,
    );
    return null;
  }

  // ── Date fields ────────────────────────────────────────────────────────────
  const firstContractDate  = normalizeSpDate(item.FirstContractDate,  `${ctx}.FirstContractDate`,  warnRef, '[C3/People]');
  const latestContractDate = normalizeSpDate(item.LatestContractDate, `${ctx}.LatestContractDate`, warnRef, '[C3/People]');

  // ── Build Person ───────────────────────────────────────────────────────────
  return {
    Id:                item.Id,
    PersonID:          personId,
    FullName:          item.FullName.trim(),
    IGN:               item.IGN?.trim()               || undefined,
    Nationality:       item.Nationality?.trim()        || undefined,
    PrimaryRole:       item.PrimaryRole?.trim()        || undefined,
    PersonnelCode:     item.PersonnelCode?.trim()      || undefined,
    CurrentTeam:       item.CurrentTeam?.trim()        || undefined,
    CurrentGameTitle:  item.CurrentGameTitle?.trim()   || undefined,
    PrimaryDepartment: item.PrimaryDepartment?.trim()  || undefined,
    IsActive:          parseIsActive(item.IsActive, ctx, warnRef),
    FirstContractDate:  firstContractDate,
    LatestContractDate: latestContractDate,
    TotalContracts:     parseTotalContracts(item.TotalContracts, ctx, warnRef),
    Notes:             item.Notes?.trim()              || undefined,
  };
}

// ---------------------------------------------------------------------------
// Batch mapper
//
// Maps a full SP response array. Logs an aggregate summary after mapping.
// Returns SpPersonMapResult so the service layer can expose diagnostic
// counts to SharePointDiagnosticsService without re-computing them.
//
// NOTE: This mapper does not filter by IsActive. The service layer applies
// $filter=IsActive eq 1 in the SP REST query before calling this mapper.
// Records with IsActive=false that reach the mapper are mapped normally —
// they may appear here only if the service omits the IsActive filter (e.g.
// in diagnostic or admin contexts). The mapper itself stays IsActive-agnostic.
// ---------------------------------------------------------------------------

/**
 * Map an array of raw SP list items to typed Persons.
 *
 * Logs per-item warnings for soft errors and a one-line aggregate summary.
 * Hard-rejected items (missing PersonID or FullName) are excluded from the
 * result and counted in `rejectedCount`.
 *
 * @param items  Raw SP REST list items from the C3People list.
 * @returns      { people, rejectedCount, warnCount }
 */
export function mapSpItemsToPeople(items: SpPersonItem[]): SpPersonMapResult {
  const people: Person[] = [];
  let rejectedCount = 0;
  const warnRef = { count: 0 };

  for (const item of items) {
    const person = mapSpItemToPerson(item, warnRef);
    if (person === null) {
      rejectedCount++;
    } else {
      people.push(person);
    }
  }

  console.info(
    `[C3/People] listPeople: fetched ${items.length} SP records. ` +
    `Mapped: ${people.length}. Rejected: ${rejectedCount}. Warnings: ${warnRef.count}.`,
  );

  return { people, rejectedCount, warnCount: warnRef.count };
}
