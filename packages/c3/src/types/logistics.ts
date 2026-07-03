/**
 * Logistics types — C3 Platform
 *
 * Sprint 28 (S28-1) — Apparel Profile + Mission Kit Assignment read foundation.
 *
 * Two distinct concerns, deliberately separated:
 *
 *   ApparelProfile — STABLE person attributes (sizing, jersey print name).
 *     One active profile per person. Lives in C3PersonApparelProfiles, NOT as
 *     columns on C3People (keeps the frozen Person type, the governed
 *     AddPerson flow, and the s16 parity surface untouched).
 *
 *   KitAssignment — MISSION-SPECIFIC issued kit per participant. Lives in
 *     C3MissionKitAssignments. Tracks issuance/fulfillment of physical items
 *     (jerseys, apparel, equipment) for a person on a mission.
 *
 * Boundary (locked at S28 approval): KitAssignment is NOT a warehouse
 * inventory ledger, a travel-request list, a freight/shipping list, or a
 * general asset registry. Travel and freight are separate future domains
 * (the operational Excel hub's TRV/EQP/SHP tabs have different owners,
 * timelines, and status models — see Mission v2 — Operational Planning.md).
 *
 * Identity:
 *   ApparelProfile — PersonID (one active profile per person).
 *   KitAssignment  — MissionID + PersonID + ItemCategory + AssignmentKey.
 *     AssignmentKey is a stable, operator-defined key within the
 *     person/mission/category scope (e.g. "HOME-2026", "CONTROLLER-01").
 *     ItemDescription is editable display text and is NEVER identity.
 *     SP list Title values are display keys and are NEVER parsed for identity.
 *     No generated MKA-XXXX id — no demonstrated operational need.
 *
 * Relationships (locked canonical model):
 *   KitAssignment.MissionID  → C3Missions.Title   (business TR/SATR code)
 *   KitAssignment.PersonID   → C3People.PersonID  (canonical PER-XXXX)
 *   ApparelProfile.PersonID  → C3People.PersonID
 *   Plain-text FKs; no SharePoint lookups; SP numeric Id is transport only.
 *
 * Read-only in Sprint 28. Writes (governed/lifecycle, classified per
 * operation) are Sprint 29 scope.
 *
 * Ref: docs/architecture/C3PersonApparelProfiles SP List Schema.md
 * Ref: docs/architecture/C3MissionKitAssignments SP List Schema.md
 */

// ---------------------------------------------------------------------------
// Apparel
// ---------------------------------------------------------------------------

/** Jersey sizing scale. SP choice values must match exactly. */
export type JerseySize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL';

/**
 * Stable apparel attributes for a person. One active profile per person.
 *
 * All attribute fields are optional — a profile row may exist with partial
 * data. A missing profile is a normal state ("No apparel profile on file"),
 * never an error or a readiness failure.
 */
export interface ApparelProfile {
  /** Canonical person identity (PER-XXXX). FK to C3People.PersonID. */
  PersonID: string;
  /** Jersey size on the standard scale. */
  JerseySize?: JerseySize;
  /**
   * Name printed on the jersey. Free text in the read foundation; print
   * length/character validation is a write-time concern (Sprint 29).
   */
  NameOnJersey?: string;
  /** Free-text fit/preference notes (sponsor constraints, cut preferences). */
  Notes?: string;
}

// ---------------------------------------------------------------------------
// Kit assignments
// ---------------------------------------------------------------------------

/** Category of issued item. SP choice values must match exactly. */
export type ItemCategory = 'Jersey' | 'Apparel' | 'Equipment';

/**
 * Fulfillment lifecycle of an issued kit item. SP choice values must match
 * exactly (internal column name is KitStatus — never the SP reserved word
 * Status). Returned/Replaced/Missing are provisioned now; their lifecycle
 * transitions arrive with the Sprint 29 write design.
 */
export type KitStatus =
  | 'NotOrdered'
  | 'Ordered'
  | 'Shipped'
  | 'Delivered'
  | 'Confirmed'
  | 'Returned'
  | 'Replaced'
  | 'Missing';

/**
 * Kit statuses treated as fulfilled for display purposes (S28 decision).
 * A "complete" visual state additionally requires at least one assignment —
 * zero assignments must never render as complete/ready (truthful empty-state
 * rule, established S27).
 */
export const FULFILLED_KIT_STATUSES: KitStatus[] = ['Delivered', 'Confirmed'];

/**
 * One issued kit item for a person on a mission.
 *
 * Conceptual identity: MissionID + PersonID + ItemCategory + AssignmentKey.
 * Multiple items in the same category are supported via distinct
 * AssignmentKeys (e.g. HOME-2026 and AWAY-2026 jerseys).
 */
export interface KitAssignment {
  /** TR/SATR code. FK to C3Missions.Title. */
  MissionID: string;
  /** Canonical person identity (PER-XXXX). FK to C3People.PersonID. */
  PersonID: string;
  /** Category of the issued item. */
  ItemCategory: ItemCategory;
  /**
   * Stable operator-defined key within the person/mission/category scope,
   * e.g. "HOME-2026", "AWAY-2026", "CONTROLLER-01". Required. Trimmed on
   * read; stored casing preserved for display.
   */
  AssignmentKey: string;
  /** Editable human-readable description. Display only — never identity. */
  ItemDescription?: string;
  /** Fulfillment lifecycle state. */
  Status: KitStatus;
  /** Mission-specific jersey number (free text, e.g. "7"). */
  JerseyNumber?: string;
  /** Email of the staff member responsible for fulfillment. */
  OwnerEmail?: string;
}
