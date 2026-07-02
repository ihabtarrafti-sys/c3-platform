/**
 * spCredentialMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `Credential` interface consumed by the C3 protocol engine.
 *
 * Sprint 15 (S15-2) -- SharePoint Credential Integration.
 *
 * Design:
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - All validation and type-guarding lives here -- the service layer calls
 *     mapSpItemsToCredentials and receives typed Credential[] or null rejection.
 *   - Runtime guards match the TypeScript types exactly, not SP column labels.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing HolderPersonID  -> record rejected (hard reject)
 *       Unknown CredentialType  -> mapped to 'Other' with console.warn
 *       Invalid date string     -> undefined (non-expiring semantics) with console.warn
 *       Empty Title             -> CRED-{SP_ID} fallback with console.warn
 *   - Aggregate diagnostic summary logged once per batch (console.info).
 *
 * See: docs/architecture/C3Credentials SP List Schema.md
 * See: Sprint 15 Proposal -- S2 (field mapping), S3 (type guards), S4 (dates)
 */

import type { Credential, CredentialType } from '@c3/types';
import { normalizeSpDate } from './dateUtils';

// ---------------------------------------------------------------------------
// SpCredentialItem
//
// Shape of a raw SharePoint REST list item for C3Credentials.
// Fields match the list schema column internal names exactly.
// All fields are typed permissively (unknown | null) because SP REST
// responses can return null for optional columns and the type-guard layer
// is responsible for narrowing.
// ---------------------------------------------------------------------------

export interface SpCredentialItem {
  /** SP built-in integer primary key -- maps to Credential.Id. */
  ID: number;

  /**
   * Title column repurposed as CredentialID (e.g. "CRED-0001").
   * Null or empty -> falls back to CRED-{ID} at runtime.
   */
  Title: string | null;

  /**
   * Application-layer PersonID of the holder (e.g. "PER-0001").
   * Plain text -- NOT a SP Lookup. Missing/blank -> record rejected.
   */
  HolderPersonID: string | null;

  /**
   * Choice column -- one of the 18 CredentialType values.
   * Unknown value -> mapped to 'Other' with warning.
   */
  CredentialType: string | null;

  /** Document reference number (passport no., visa no., etc.). */
  ReferenceNumber: string | null;

  IssuedBy: string | null;
  IssuedDate: string | null;
  ExpiryDate: string | null;
  ValidFromDate: string | null;
  SubType: string | null;
  Notes: string | null;

  /**
   * SP Yes/No column. SP REST returns boolean true/false for Yes/No columns,
   * but defensive parsing handles legacy numeric (1/0) or string forms.
   */
  IsActive: boolean | number | string | null;

  SupersedesCredentialID: string | null;
}

// ---------------------------------------------------------------------------
// MapResult
//
// Returned by the batch mapper so the service layer can log aggregate
// diagnostics and expose them to the DiagnosticsService.
// ---------------------------------------------------------------------------

export interface SpCredentialMapResult {
  /** Successfully mapped credentials. */
  credentials: Credential[];
  /** Number of SP items that were rejected (hard errors, e.g. missing HolderPersonID). */
  rejectedCount: number;
  /** Number of SP items that mapped with non-fatal warnings (unknown type, invalid date, etc.). */
  warnCount: number;
}

// ---------------------------------------------------------------------------
// CredentialType guard
//
// 18 values: 17 domain-specific types + 'Other' catch-all.
// Must stay in sync with the CredentialType union in types/credentials.ts.
// The SP list schema (C3Credentials SP List Schema.md) enforces the same
// set as its choice field -- divergence indicates a schema drift.
// ---------------------------------------------------------------------------

export const VALID_CREDENTIAL_TYPES = new Set<string>([
  // Identity & Residency (6)
  'Passport', 'NationalID', 'EmiratesID', 'Iqama', 'ResidencePermit', 'DriversLicense',
  // Visa & Entry (2)
  'Visa', 'EntryPermit',
  // Work Authorisation (2)
  'WorkPermit', 'LabourCard',
  // Competition & Transfers (3)
  'LeagueRegistration', 'FederationLicense', 'TransferClearance',
  // Health (2)
  'InsuranceCard', 'MedicalClearance',
  // Financial (2)
  'BankAccount', 'TaxNumber',
  // Catch-all (1)
  'Other',
]); // Total: 18

function isValidCredentialType(val: unknown): val is CredentialType {
  return typeof val === 'string' && VALID_CREDENTIAL_TYPES.has(val);
}


// ---------------------------------------------------------------------------
// IsActive parsing
//
// SP Yes/No columns return boolean in the REST API.
// Defensive handling for legacy or edge-case forms.
// Conservative default: unknown -> false (treat as inactive).
// ---------------------------------------------------------------------------

function parseIsActive(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 1 || val === '1' || val === 'Yes' || val === 'yes') return true;
  if (val === 0 || val === '0' || val === 'No'  || val === 'no')  return false;
  // Unknown -- log and treat as inactive so the credential doesn't silently
  // satisfy obligations when its active status is uncertain.
  return false;
}

// ---------------------------------------------------------------------------
// Single-item mapper
//
// Returns a Credential on success, null on hard rejection.
// Hard rejection: missing HolderPersonID -- the record cannot be attributed
//   to any person and is invisible to the protocol engine.
// All other errors are soft (warnings); the record is still returned.
// ---------------------------------------------------------------------------

/**
 * Map one raw SP list item to a Credential.
 *
 * @returns A typed Credential on success, or null if the record is rejected
 *          (currently: missing/blank HolderPersonID).
 */
export function mapSpItemToCredential(
  item: SpCredentialItem,
  warnRef: { count: number } = { count: 0 },
): Credential | null {
  const ctx = `Item ${item.ID}`;

  // Hard reject: missing HolderPersonID
  if (!item.HolderPersonID || item.HolderPersonID.trim() === '') {
    console.warn(`[C3/Credential] ${ctx}: missing HolderPersonID -- record rejected`);
    return null;
  }

  // CredentialID: Title or CRED-{ID} fallback
  const credentialId = item.Title?.trim() || `CRED-${item.ID}`;
  if (!item.Title?.trim()) {
    console.warn(`[C3/Credential] ${ctx}: empty Title -- CredentialID assigned as ${credentialId}`);
    warnRef.count++;
  }

  // CredentialType: type guard or 'Other'
  let type: CredentialType;
  if (isValidCredentialType(item.CredentialType)) {
    type = item.CredentialType;
  } else {
    console.warn(
      `[C3/Credential] ${ctx}: unknown CredentialType "${item.CredentialType}" -- mapped to Other. ` +
      `This credential will satisfy no obligations. Check SP list choice values against CredentialType union.`,
    );
    warnRef.count++;
    type = 'Other';
  }

  // Date fields
  const issuedDate   = normalizeSpDate(item.IssuedDate,   `${ctx}.IssuedDate`,   warnRef);
  const expiryDate   = normalizeSpDate(item.ExpiryDate,   `${ctx}.ExpiryDate`,   warnRef);
  const validFromDate = normalizeSpDate(item.ValidFromDate, `${ctx}.ValidFromDate`, warnRef);

  // Build Credential
  return {
    Id:                    item.ID,
    CredentialID:          credentialId,
    HolderPersonID:        item.HolderPersonID.trim(),
    Type:                  type,
    ReferenceNumber:       item.ReferenceNumber?.trim() ?? '',
    IssuedBy:              item.IssuedBy?.trim()              || undefined,
    IssuedDate:            issuedDate,
    ExpiryDate:            expiryDate,
    ValidFromDate:         validFromDate,
    SubType:               item.SubType?.trim()               || undefined,
    Notes:                 item.Notes?.trim()                 || undefined,
    IsActive:              parseIsActive(item.IsActive),
    SupersedesCredentialID: item.SupersedesCredentialID?.trim() || undefined,
  };
}

// ---------------------------------------------------------------------------
// Batch mapper
//
// Maps a full SP response array. Logs an aggregate summary after mapping.
// Returns SpCredentialMapResult so the service layer can expose diagnostic
// counts to SharePointDiagnosticsService without re-computing them.
// ---------------------------------------------------------------------------

/**
 * Map an array of raw SP list items to typed Credentials.
 *
 * Logs per-item warnings for soft errors and a one-line aggregate summary.
 * Hard-rejected items (missing HolderPersonID) are excluded from the result
 * and counted in `rejectedCount`.
 *
 * @param items  Raw SP REST list items from the C3Credentials list.
 * @returns      { credentials, rejectedCount, warnCount }
 */
export function mapSpItemsToCredentials(items: SpCredentialItem[]): SpCredentialMapResult {
  const credentials: Credential[] = [];
  let rejectedCount = 0;
  const warnRef = { count: 0 };

  for (const item of items) {
    const cred = mapSpItemToCredential(item, warnRef);
    if (cred === null) {
      rejectedCount++;
    } else {
      credentials.push(cred);
    }
  }

  console.info(
    `[C3/Credential] listAllCredentials: fetched ${items.length} SP records. ` +
    `Mapped: ${credentials.length}. Rejected: ${rejectedCount}. Warnings: ${warnRef.count}.`,
  );

  return { credentials, rejectedCount, warnCount: warnRef.count };
}

// ---------------------------------------------------------------------------
// PersonID validation
//
// Regression-only helper. Called during mixed-mode testing (SP credentials
// + mock people) to surface HolderPersonIDs in SP that don't match any
// known Person in the application.
//
// Not called in production paths. The service layer invokes this during
// Phase B regression (Sprint 15 S10) when knownPersonIds is available.
// ---------------------------------------------------------------------------

/**
 * Validate that all credential HolderPersonIDs are known to the application.
 *
 * Logs a warning for each PersonID present in SP credentials but not in the
 * provided known-persons set. Records with unknown (but non-empty) PersonIDs
 * are valid SP records -- they are not rejected, just flagged for investigation.
 *
 * Typical caller pattern:
 * const people = await mockPersonService.listPeople();
 * const knownIds = new Set(people.map(p => p.PersonID));
 * validateCredentialPersonIds(credentials, knownIds);
 *
 * @param credentials    Mapped credentials (output of mapSpItemsToCredentials).
 * @param knownPersonIds Set of PersonID strings known to the application.
 */
export function validateCredentialPersonIds(
  credentials: Credential[],
  knownPersonIds: Set<string>,
): void {
  const unknownIds = new Set<string>();

  for (const cred of credentials) {
    if (!knownPersonIds.has(cred.HolderPersonID)) {
      unknownIds.add(cred.HolderPersonID);
    }
  }

  if (unknownIds.size === 0) {
    console.info('[C3/Credential] PersonID validation: all HolderPersonIDs matched known persons');
    return;
  }

  console.warn(
    `[C3/Credential] PersonID validation: ${unknownIds.size} HolderPersonID(s) in SP ` +
    `do not match any known Person: ${[...unknownIds].sort().join(', ')}. ` +
    `These credentials are loaded but will not contribute to gap computation ` +
    `until the corresponding Person records are available.`,
  );
}
