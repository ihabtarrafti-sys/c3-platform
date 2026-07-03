/**
 * spApparelProfileMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `ApparelProfile` interface.
 *
 * Sprint 28 (S28-2) -- Apparel Profile read foundation.
 *
 * Design follows the established mapper pattern (S15-S27):
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing/blank PersonID   -> record rejected (hard reject)
 *       Unknown JerseySize       -> warn, mapped as undefined (display-only
 *         attribute -- an unknown size must not remove the whole profile)
 *       Blank NameOnJersey/Notes -> undefined, no warn (absent optional)
 *       Missing/null IsActive    -> defaults to true
 *       Explicit IsActive false  -> valid persistence row; the SERVICE
 *         excludes it from reads (inactive rows retained for history)
 *   - Title carries a display key (PersonID) and is NEVER parsed for identity.
 *   - No FK validation (established mapper contract).
 *
 * Diagnostic prefix: [C3/ApparelProfile]
 *
 * See: docs/architecture/C3PersonApparelProfiles SP List Schema.md
 */

import type { ApparelProfile, JerseySize } from '@c3/types';

// ---------------------------------------------------------------------------
// SpApparelProfileItem
// ---------------------------------------------------------------------------

export interface SpApparelProfileItem {
  /** SP built-in integer primary key. Transport metadata only. */
  Id: number;
  /** Display key (PersonID). Never parsed for identity. */
  Title: string | null;
  /** Plain-text FK to C3People.PersonID. Blank/null -> hard reject. */
  PersonID: string | null;
  /** Choice column -- one of the JerseySize values. Unknown -> warn + undefined. */
  JerseySize: string | null;
  /** Jersey print name. Trimmed; blank -> undefined. */
  NameOnJersey: string | null;
  /** Free-text notes. */
  Notes: string | null;
  /** Yes/No column. Null/missing -> true. Explicit false -> excluded by reads. */
  IsActive: boolean | null;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface SpApparelProfileMapResult {
  mapped: number;
  rejected: number;
  warnings: number;
}

/** Mapped profile plus its persistence-level active flag (not a domain field). */
export interface MappedApparelProfile {
  profile: ApparelProfile;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Known value sets -- must stay in sync with types/logistics.ts and the SP
// choice values in the schema doc (choice-drift risk).
// ---------------------------------------------------------------------------

const VALID_JERSEY_SIZES = new Set<string>(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);

const PREFIX = '[C3/ApparelProfile]';

// ---------------------------------------------------------------------------
// mapSpItemToApparelProfile
// ---------------------------------------------------------------------------

/**
 * Map a single raw SP list item to a MappedApparelProfile.
 *
 * Returns null (hard reject) only when PersonID is blank or null.
 * Non-fatal anomalies increment warnRef.count and log a warning.
 */
export function mapSpItemToApparelProfile(
  item: SpApparelProfileItem,
  warnRef: { count: number },
): MappedApparelProfile | null {
  const itemLabel = `Item ${item.Id}`;

  // Hard reject: missing PersonID
  if (!item.PersonID || item.PersonID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing PersonID -- record rejected`);
    return null;
  }

  // JerseySize -- display-only attribute; unknown value degrades to undefined
  let jerseySize: JerseySize | undefined;
  if (item.JerseySize && item.JerseySize.trim() !== '') {
    if (VALID_JERSEY_SIZES.has(item.JerseySize)) {
      jerseySize = item.JerseySize as JerseySize;
    } else {
      console.warn(
        `${PREFIX} ${itemLabel}: unknown JerseySize "${item.JerseySize}" -- treated as absent. ` +
        'Verify the C3PersonApparelProfiles choice values match the JerseySize union exactly.',
      );
      warnRef.count++;
    }
  }

  return {
    profile: {
      PersonID:     item.PersonID.trim(),
      JerseySize:   jerseySize,
      NameOnJersey: item.NameOnJersey?.trim() || undefined,
      Notes:        item.Notes?.trim() || undefined,
    },
    // Persistence flag: null/missing defaults to true (schema default is Yes).
    isActive: item.IsActive !== false,
  };
}

// ---------------------------------------------------------------------------
// mapSpItemsToApparelProfiles
// ---------------------------------------------------------------------------

/**
 * Map a batch of raw SP list items. Logs one aggregate diagnostic line.
 * The caller (service layer) filters `isActive` and projects `.profile`.
 */
export function mapSpItemsToApparelProfiles(
  items: SpApparelProfileItem[],
): { records: MappedApparelProfile[]; result: SpApparelProfileMapResult } {
  const warnRef = { count: 0 };
  const records: MappedApparelProfile[] = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToApparelProfile(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      records.push(mapped);
    }
  }

  const result: SpApparelProfileMapResult = {
    mapped: records.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listApparelProfiles: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { records, result };
}
