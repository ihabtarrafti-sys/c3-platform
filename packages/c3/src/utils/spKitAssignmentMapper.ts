/**
 * spKitAssignmentMapper.ts
 *
 * Pure mapping layer between raw SharePoint REST API list items and the
 * typed `KitAssignment` interface.
 *
 * Sprint 28 (S28-2) -- Mission Kit Assignment read foundation.
 *
 * Design follows the established mapper pattern (S15-S27):
 *   - No React, no hooks, no service dependencies. Pure functions only.
 *   - Invalid/unknown values degrade gracefully:
 *       Missing/blank MissionID      -> record rejected (hard reject)
 *       Missing/blank PersonID       -> record rejected (hard reject)
 *       Missing/blank AssignmentKey  -> record rejected (hard reject --
 *         AssignmentKey completes conceptual identity; a row without one has
 *         no stable identity within its person/mission/category scope)
 *       Unknown ItemCategory         -> record rejected (hard reject)
 *       Unknown KitStatus            -> record rejected (hard reject)
 *       JerseyNumber                 -> preserved as trimmed text when
 *         non-empty (free text; no numeric validation at read time)
 *       OwnerEmail blank             -> undefined, no warn (absent optional)
 *       OwnerEmail present but not email-shaped -> warn, value preserved
 *         trimmed (do not reject; do not discard operator data)
 *       Missing/null IsActive        -> defaults to true
 *       Explicit IsActive false      -> valid persistence row; the SERVICE
 *         excludes it from reads (inactive rows retained for history)
 *   - Conceptual identity: MissionID + PersonID + ItemCategory +
 *     AssignmentKey. AssignmentKey is trimmed; stored casing is preserved
 *     for display. ItemDescription is editable display text -- NEVER identity.
 *   - Title carries the display key
 *     "<MissionID>|<PersonID>|<ItemCategory>|<AssignmentKey>" and is NEVER
 *     parsed for identity.
 *   - No FK validation (established mapper contract).
 *
 * Diagnostic prefix: [C3/KitAssignment]
 *
 * See: docs/architecture/C3MissionKitAssignments SP List Schema.md
 */

import type { ItemCategory, KitAssignment, KitStatus } from '@c3/types';

// ---------------------------------------------------------------------------
// SpKitAssignmentItem
// ---------------------------------------------------------------------------

export interface SpKitAssignmentItem {
  /** SP built-in integer primary key. Transport metadata only. */
  Id: number;
  /** Display key. Never parsed for identity. */
  Title: string | null;
  /** Plain-text FK to C3Missions.Title (TR/SATR code). Blank/null -> hard reject. */
  MissionID: string | null;
  /** Plain-text FK to C3People.PersonID. Blank/null -> hard reject. */
  PersonID: string | null;
  /** Choice column -- Jersey / Apparel / Equipment. Unknown -> hard reject. */
  ItemCategory: string | null;
  /** Stable operator-defined key. Blank/null -> hard reject. */
  AssignmentKey: string | null;
  /** Editable display text. Never identity. */
  ItemDescription: string | null;
  /**
   * Choice column -- one of the 8 KitStatus values.
   * SP internal column name is KitStatus (not Status -- reserved word in SP).
   * Unknown value -> hard reject.
   */
  KitStatus: string | null;
  /** Mission-specific jersey number. Free text; trimmed when non-empty. */
  JerseyNumber: string | null;
  /** Fulfillment owner email. */
  OwnerEmail: string | null;
  /** Yes/No column. Null/missing -> true. Explicit false -> excluded by reads. */
  IsActive: boolean | null;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface SpKitAssignmentMapResult {
  mapped: number;
  rejected: number;
  warnings: number;
}

/** Mapped assignment plus its persistence-level active flag (not a domain field). */
export interface MappedKitAssignment {
  assignment: KitAssignment;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Known value sets -- must stay in sync with types/logistics.ts and the SP
// choice values in the schema doc (choice-drift risk).
// ---------------------------------------------------------------------------

const VALID_ITEM_CATEGORIES = new Set<string>(['Jersey', 'Apparel', 'Equipment']);

const VALID_KIT_STATUSES = new Set<string>([
  'NotOrdered',
  'Ordered',
  'Shipped',
  'Delivered',
  'Confirmed',
  'Returned',
  'Replaced',
  'Missing',
]);

const PREFIX = '[C3/KitAssignment]';

// ---------------------------------------------------------------------------
// mapSpItemToKitAssignment
// ---------------------------------------------------------------------------

/**
 * Map a single raw SP list item to a MappedKitAssignment.
 *
 * Returns null (hard reject) if:
 *   - MissionID is blank or null
 *   - PersonID is blank or null
 *   - AssignmentKey is blank or null
 *   - ItemCategory is unknown (not in ItemCategory union)
 *   - KitStatus is unknown (not in KitStatus union)
 *
 * Non-fatal anomalies increment warnRef.count and log a warning.
 */
export function mapSpItemToKitAssignment(
  item: SpKitAssignmentItem,
  warnRef: { count: number },
): MappedKitAssignment | null {
  const itemLabel = `Item ${item.Id}`;

  if (!item.MissionID || item.MissionID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing MissionID -- record rejected`);
    return null;
  }

  if (!item.PersonID || item.PersonID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing PersonID -- record rejected`);
    return null;
  }

  if (!item.AssignmentKey || item.AssignmentKey.trim() === '') {
    console.warn(
      `${PREFIX} ${itemLabel}: missing AssignmentKey -- record rejected ` +
      '(AssignmentKey completes the conceptual identity of a kit assignment)',
    );
    return null;
  }

  if (!item.ItemCategory || !VALID_ITEM_CATEGORIES.has(item.ItemCategory)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown ItemCategory "${item.ItemCategory ?? ''}" -- record rejected. ` +
      'Verify the C3MissionKitAssignments choice values match the ItemCategory union exactly.',
    );
    return null;
  }

  if (!item.KitStatus || !VALID_KIT_STATUSES.has(item.KitStatus)) {
    console.warn(
      `${PREFIX} ${itemLabel}: unknown KitStatus "${item.KitStatus ?? ''}" -- record rejected. ` +
      'Verify the C3MissionKitAssignments choice values match the KitStatus union exactly.',
    );
    return null;
  }

  // OwnerEmail -- optional; present-but-malformed is preserved with a warning
  // (operator data is not discarded; write-time validation is a S29 concern).
  let ownerEmail: string | undefined;
  const rawOwner = item.OwnerEmail?.trim() ?? '';
  if (rawOwner !== '') {
    if (!rawOwner.includes('@')) {
      console.warn(
        `${PREFIX} ${itemLabel}: OwnerEmail "${rawOwner}" does not look like an email -- preserved as-is`,
      );
      warnRef.count++;
    }
    ownerEmail = rawOwner;
  }

  return {
    assignment: {
      MissionID:       item.MissionID.trim(),
      PersonID:        item.PersonID.trim(),
      ItemCategory:    item.ItemCategory as ItemCategory,
      AssignmentKey:   item.AssignmentKey.trim(),
      ItemDescription: item.ItemDescription?.trim() || undefined,
      Status:          item.KitStatus as KitStatus,
      JerseyNumber:    item.JerseyNumber?.trim() || undefined,
      OwnerEmail:      ownerEmail,
    },
    // Persistence flag: null/missing defaults to true (schema default is Yes).
    isActive: item.IsActive !== false,
  };
}

// ---------------------------------------------------------------------------
// mapSpItemsToKitAssignments
// ---------------------------------------------------------------------------

/**
 * Map a batch of raw SP list items. Logs one aggregate diagnostic line.
 * The caller (service layer) filters `isActive` and projects `.assignment`.
 */
export function mapSpItemsToKitAssignments(
  items: SpKitAssignmentItem[],
): { records: MappedKitAssignment[]; result: SpKitAssignmentMapResult } {
  const warnRef = { count: 0 };
  const records: MappedKitAssignment[] = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToKitAssignment(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      records.push(mapped);
    }
  }

  const result: SpKitAssignmentMapResult = {
    mapped: records.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listKitAssignments: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { records, result };
}
