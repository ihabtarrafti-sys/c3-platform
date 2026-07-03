/**
 * spMissionParticipantMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `MissionParticipant` interface consumed by the C3 platform.
 *
 * Sprint 27 (S27-3) -- Mission Participants Foundation.
 *
 * Design follows the S15/S16/S17/S26 mapper pattern:
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - All validation and type-guarding lives here -- the service layer calls
 *     mapSpItemsToMissionParticipants and receives typed records plus an
 *     isActive flag it uses to exclude deactivated rows from reads.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing/blank MissionID        -> record rejected (hard reject)
 *       Missing/blank PersonID         -> record rejected (hard reject)
 *       Unknown ParticipantRole        -> record rejected (hard reject;
 *         role feeds per-diem tiers and future jurisdiction-aware protocols --
 *         an unrecognised role must not silently pass through)
 *       Blank ExternalCode             -> warn, mapped as empty string
 *         (required by schema, but not identity -- tolerate and surface)
 *       Invalid PerDiemRate            -> warn, mapped as undefined
 *       Missing/null IsActive          -> defaults to true
 *       Explicit IsActive === false    -> valid persistence row; the SERVICE
 *         excludes it from reads (inactive rows are retained for history)
 *   - Identity is MissionID + PersonID (one active row per person per
 *     mission). `Title` carries a convenience display key
 *     ("<MissionID>|<PersonID>") and is NEVER parsed for identity.
 *   - FK existence (MissionID in C3Missions, PersonID in C3People) is NOT
 *     validated here -- mappers never do FK lookups (established contract).
 *
 * Diagnostic prefix: [C3/MissionParticipant]
 *
 * See: docs/architecture/C3MissionParticipants SP List Schema.md
 */

import type { MissionParticipant, MissionParticipantRole } from '@c3/types';

// ---------------------------------------------------------------------------
// SpMissionParticipantItem
//
// Shape of a raw SharePoint REST list item for C3MissionParticipants.
// Field names match the list schema column internal names exactly.
// All fields typed permissively -- type-guard layer narrows them.
// ---------------------------------------------------------------------------

export interface SpMissionParticipantItem {
  /** SP built-in integer primary key. Transport metadata only -- never identity. */
  Id: number;

  /**
   * Convenience display key "<MissionID>|<PersonID>". Never parsed for
   * identity -- identity comes from the MissionID and PersonID columns.
   */
  Title: string | null;

  /** Plain-text FK to C3Missions.Title (TR/SATR code). Blank/null -> hard reject. */
  MissionID: string | null;

  /** Plain-text FK to C3People.Title (PER-XXXX). Blank/null -> hard reject. */
  PersonID: string | null;

  /** Geekay participant code (e.g. "RL/PL/026"). Blank -> warn + empty string. */
  ExternalCode: string | null;

  /**
   * Choice column -- one of the 5 MissionParticipantRole values.
   * SP internal column name is ParticipantRole (not Role -- collision risk).
   * Unknown value -> hard reject.
   */
  ParticipantRole: string | null;

  /** Number column -- daily allowance in the Mission's operating currency. */
  PerDiemRate: number | string | null;

  /** Yes/No column. Null/missing -> true. Explicit false -> excluded by service reads. */
  IsActive: boolean | null;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface SpMissionParticipantMapResult {
  mapped: number;
  rejected: number;
  warnings: number;
}

/**
 * A mapped participant plus its persistence-level active flag. The flag is
 * not part of the MissionParticipant domain type -- the service uses it to
 * exclude deactivated rows and then discards it.
 */
export interface MappedMissionParticipant {
  participant: MissionParticipant;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Known value sets -- must stay in sync with types/mission.ts and the SP
// choice values in C3MissionParticipants SP List Schema.md (drift risk).
// ---------------------------------------------------------------------------

const VALID_PARTICIPANT_ROLES = new Set<string>([
  'Player',
  'Coach',
  'Manager',
  'Analyst',
  'Staff',
]);

const PREFIX = '[C3/MissionParticipant]';

// ---------------------------------------------------------------------------
// parsePerDiemRate
// ---------------------------------------------------------------------------

/**
 * Parse the PerDiemRate column defensively. SP Number columns normally return
 * a JSON number, but string numerics are tolerated (locale/OData edge cases).
 *
 *   null / undefined / ''    -> undefined (silent -- optional field)
 *   number (finite)          -> number
 *   numeric string           -> parsed number
 *   anything else / NaN      -> warn + undefined
 */
function parsePerDiemRate(
  val: number | string | null | undefined,
  context: string,
  warnRef: { count: number },
): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') {
    if (Number.isFinite(val)) return val;
    console.warn(`${PREFIX} ${context}: non-finite PerDiemRate -- treated as absent`);
    warnRef.count++;
    return undefined;
  }
  if (typeof val === 'string') {
    const parsed = Number(val.trim());
    if (val.trim() !== '' && Number.isFinite(parsed)) return parsed;
  }
  console.warn(`${PREFIX} ${context}: invalid PerDiemRate "${String(val)}" -- treated as absent`);
  warnRef.count++;
  return undefined;
}

// ---------------------------------------------------------------------------
// mapSpItemToMissionParticipant
// ---------------------------------------------------------------------------

/**
 * Map a single raw SP list item to a MappedMissionParticipant.
 *
 * Returns null (hard reject) if:
 *   - MissionID is blank or null
 *   - PersonID is blank or null
 *   - ParticipantRole is unknown (not in MissionParticipantRole union)
 *
 * Non-fatal anomalies increment warnRef.count and log a warning; the record
 * is still returned.
 */
export function mapSpItemToMissionParticipant(
  item: SpMissionParticipantItem,
  warnRef: { count: number },
): MappedMissionParticipant | null {
  const itemLabel = `Item ${item.Id}`;

  // Hard reject: missing MissionID
  if (!item.MissionID || item.MissionID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing MissionID -- record rejected`);
    return null;
  }

  // Hard reject: missing PersonID
  if (!item.PersonID || item.PersonID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing PersonID -- record rejected`);
    return null;
  }

  // Hard reject: unknown ParticipantRole
  if (!item.ParticipantRole || !VALID_PARTICIPANT_ROLES.has(item.ParticipantRole)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown ParticipantRole "${item.ParticipantRole ?? ''}" -- record rejected. ` +
      'Verify the C3MissionParticipants choice values match the MissionParticipantRole union exactly.',
    );
    return null;
  }

  // ExternalCode -- required by schema, tolerated blank with warning
  const externalCode = item.ExternalCode?.trim() ?? '';
  if (externalCode === '') {
    console.warn(`${PREFIX} ${itemLabel}: blank ExternalCode -- treated as empty`);
    warnRef.count++;
  }

  const perDiemRate = parsePerDiemRate(item.PerDiemRate, `${itemLabel}.PerDiemRate`, warnRef);

  return {
    participant: {
      MissionID:    item.MissionID.trim(),
      PersonID:     item.PersonID.trim(),
      ExternalCode: externalCode,
      Role:         item.ParticipantRole as MissionParticipantRole,
      PerDiemRate:  perDiemRate,
    },
    // Persistence flag: null/missing defaults to true (schema default is Yes).
    isActive: item.IsActive !== false,
  };
}

// ---------------------------------------------------------------------------
// mapSpItemsToMissionParticipants
// ---------------------------------------------------------------------------

/**
 * Map a batch of raw SP list items to MappedMissionParticipant[].
 *
 * Logs one aggregate diagnostic line at the end of the batch.
 * Individual rejection/warning lines are logged by the per-item mapper.
 *
 * The caller (service layer) filters `isActive` and projects `.participant`.
 */
export function mapSpItemsToMissionParticipants(
  items: SpMissionParticipantItem[],
): { records: MappedMissionParticipant[]; result: SpMissionParticipantMapResult } {
  const warnRef = { count: 0 };
  const records: MappedMissionParticipant[] = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToMissionParticipant(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      records.push(mapped);
    }
  }

  const result: SpMissionParticipantMapResult = {
    mapped: records.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listMissionParticipants: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { records, result };
}
