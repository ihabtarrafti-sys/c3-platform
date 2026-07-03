# C3MissionKitAssignments SP List Schema

**Sprint:** 28 Phase 1
**Status:** Proposed — Ready for provisioning
**Last updated:** 2026-07-03
**Author:** Engineering (C3 Platform)
**Purpose:** Define the SharePoint list schema for `C3MissionKitAssignments` — issued kit
(jerseys, apparel, equipment) per participant per mission. Pre-condition for the Sprint 28
read path.
**Scope:** Read-only foundation. No kit writes in Sprint 28 (lifecycle transitions are a
Sprint 29 candidate; governance classification pending).

---

## 1. List Identity

| Property | Value |
|---|---|
| Display name | `C3MissionKitAssignments` |
| Internal / API list title | `C3MissionKitAssignments` |
| Purpose | One row per issued kit item per person per mission |
| Naming convention | C3 list convention: CamelCase, no underscore |

> **Domain boundary (locked at S28 approval):** this list tracks **participant-issued mission
> kit**. It is NOT a warehouse inventory ledger, a travel-request list, a freight/shipping
> list, or a general equipment asset registry. Travel and freight are separate future domains
> (different owners, timelines, and status models — see Mission v2 — Operational Planning.md).

> **Provisioning rule (post-mortem):** never pre-create via grid/Excel import. Use the
> hardened script or the manual checklist below.

---

## 2. Column Schema

Maps to `KitAssignment` in `packages/c3/src/types/logistics.ts`.

| Internal Name | Display Name | SP Type | Required | Maps To | Notes |
|---|---|---|---|---|---|
| `Title` | Assignment Key (Display) | Single line text | No | — | Display key `<MissionID>\|<PersonID>\|<ItemCategory>\|<AssignmentKey>`. **Never parsed for identity.** |
| `MissionID` | Mission ID | Single line text | Yes | `MissionID` | Plain-text FK → `C3Missions.Title` (TR/SATR code). Indexed. |
| `PersonID` | Person ID | Single line text | Yes | `PersonID` | Plain-text FK → `C3People.PersonID`. Indexed. |
| `ItemCategory` | Item Category | Choice | Yes | `ItemCategory` | **Internal name `ItemCategory`, not `Category`.** Values in §4. |
| `AssignmentKey` | Assignment Key | Single line text | Yes | `AssignmentKey` | **Stable operator-defined key** within the person/mission/category scope, e.g. `HOME-2026`, `AWAY-2026`, `CONTROLLER-01`. Completes conceptual identity. Trimmed on read; casing preserved for display. |
| `ItemDescription` | Item Description | Single line text | No | `ItemDescription` | Editable human-readable text. **Display only — never identity.** Formatting/capitalisation edits do not create a new logical assignment. |
| `KitStatus` | Status | Choice | Yes | `Status` | **Internal name `KitStatus`, not `Status`** (SP reserved-word rename risk — same rule as `MissionStatus`). Values in §4. Default `NotOrdered`. |
| `JerseyNumber` | Jersey Number | Single line text | No | `JerseyNumber` | Mission-specific; free text, trimmed on read. |
| `OwnerEmail` | Owner Email | Single line text | No | `OwnerEmail` | Fulfillment owner (staff email). Single-field convention (matches `C3Journeys.AssignedTo` minimalism); `OwnerName` deferred until a display need is proven. |
| `IsActive` | Is Active | Yes/No (default Yes) | No | *(persistence flag)* | Null/missing maps as `true`. Reads exclude explicit `false`. Inactive rows retained for history — never physically deleted. |
| `StatusNotes` | Status Notes | Multi-line text (plain) | No | *(audit trail — S29A)* | Append-only audit lines written by the service on create/transition/deactivate: `[ISO] KITSTATUS <old>→<new> by <loginName> — <reason>`. Readable context; SP version history + `Editor` is the authoritative actor record. Never edited manually. |

**Deliberately omitted:** kit-level `Notes` (ItemDescription covers identification; tracking
numbers belong to the future freight domain), `CurrencyCode` (kit has no monetary fields),
generated `MPT/MKA-XXXX` id (no demonstrated operational need — SP `Id` remains transport
metadata only).

---

## 3. SP List Settings

Content types disabled · **Major versioning limit 50 (raised from 10 in S29A — version
history is part of the write audit)** · Attachments disabled · Indexes: `MissionID`,
`PersonID`, `Title` (required by uniqueness).

**Title uniqueness (S29A):** `EnforceUniqueValues = TRUE` on `Title`. The deterministic
display key `<MissionID>|<PersonID>|<ItemCategory>|<AssignmentKey>` doubles as server-side
race protection for concurrent creates (duplicate-check-then-POST alone is not sufficient).
Title remains display/concurrency-enforcement only — **never parsed for identity**; all row
resolution uses the explicit canonical columns. Duplicate Titles must be audited before
enabling (see `scripts/Update-S29A-LogisticsWriteDelta.ps1`).

**List permissions (security boundary — UI role checks are affordance only):**
Edit/Contribute: `C3 Platform Owners`, `C3 Operations`. Read-only: all other authenticated
C3 roles. Verify with the checklist in the S29A delta script.

---

## 4. Choice Values

Values **must match the TypeScript unions exactly** — an unknown value hard-rejects the row
(it silently disappears from every screen).

### `ItemCategory`
`Jersey`, `Apparel`, `Equipment`. Default: (none).

### `KitStatus`
`NotOrdered`, `Ordered`, `Shipped`, `Delivered`, `Confirmed`, `Returned`, `Replaced`,
`Missing`. Default: `NotOrdered`.

> `Returned`/`Replaced`/`Missing` are provisioned now so the S29 lifecycle write design does
> not require a schema change; their transitions have no write path in S28.
> **Fulfilled-for-display statuses (S28 decision):** `Delivered`, `Confirmed`. A "complete"
> visual state additionally requires ≥ 1 assignment — zero rows must never render as
> complete/ready.

---

## 5. Identity and Uniqueness

Conceptual uniqueness:

```
MissionID + PersonID + ItemCategory + AssignmentKey
```

- **Multiple items in the same category are supported** via distinct AssignmentKeys
  (HOME-2026 + AWAY-2026 jerseys; CONTROLLER-01 + HEADSET-01 equipment).
- `AssignmentKey` is required and stable; `ItemDescription` is editable display text and is
  **never** part of identity — the same key with a re-worded description remains the same
  logical assignment.
- SharePoint does not enforce compound uniqueness; duplicate active keys are operator-data
  cleanup, not code.
- `Title` is a display convenience and is never parsed.

---

## 6. Relationship Model

```
C3MissionKitAssignments.MissionID → C3Missions.Title    (TR/SATR code, plain text)
C3MissionKitAssignments.PersonID  → C3People.PersonID   (PER-XXXX, plain text)
```

No SP lookups; SP numeric `Id` is transport metadata only. Kit rows typically pair with a
`C3MissionParticipants` row for the same MissionID+PersonID, but this is not enforced — a kit
row for a non-participant renders under the mission with normal name resolution.

---

## 7. Write model (S29A — supersedes the S28 "no writes" scope)

Writes are live under **ADR-013 Addendum — Mission Kit Logistics Exemption** (role-gated:
owner, operations):

- **AddKitAssignment** — participant must be an active mission participant; compound
  duplicate protection (pre-check + Title uniqueness); initial `KitStatus` always
  `NotOrdered`; creation audit line in `StatusNotes`.
- **UpdateKitStatus** — validated transition matrix (see `utils/kitLifecycle.ts` and the
  addendum); reason mandatory into `Returned`/`Missing`/`Replaced`; audit line per
  transition.
- **DeactivateKitAssignment** — mandatory reason; `IsActive = false`; audit line; row
  retained.

All updates resolve the exact row by canonical columns, MERGE with the row's **actual ETag**
(never `IF-MATCH: *`), and convert HTTP 412 to a concurrency error.

Still out of scope: participant membership writes (S29B, full ADR-013), per-diem/payment
linkage, travel/freight, Situation Room logistics gaps, Command Center kit work items,
reactivation, arbitrary metadata editing.

---

## 8. Provisioning Checklist

Preferred: `docs/architecture/scripts/Create-C3MissionKitAssignments.ps1`. Manual fallback:

```
[ ] 1. Create blank list "C3MissionKitAssignments" (NEVER from Excel/grid import)
[ ] 2. Columns: MissionID (Text, Req) · PersonID (Text, Req) · ItemCategory (Choice, Req, §4)
       · AssignmentKey (Text, Req) · ItemDescription (Text) · KitStatus (Choice, Req, §4,
       default NotOrdered) · JerseyNumber (Text) · OwnerEmail (Text) ·
       IsActive (Yes/No, default Yes)
[ ] 3. VERIFY INTERNAL NAMES via REST (mandatory):
       {site}/_api/web/lists/getbytitle('C3MissionKitAssignments')/fields
           ?$select=InternalName,Title,TypeAsString,Required&$filter=Hidden eq false
       KitStatus must be "KitStatus" (not "Status"/"Status0"); ItemCategory must be
       "ItemCategory"; any field_N entry → STOP and re-provision.
[ ] 4. Verify choice sets (§4) and KitStatus default = NotOrdered
[ ] 5. Verify IsActive default = Yes
[ ] 6. Indexes: MissionID, PersonID; Title display name "Assignment Key (Display)"
[ ] 7. Sample rows (§9)
```

---

## 9. Sample Rows

Mirror the Mock DSM seeds (`MockMissionService.ts` MOCK_KIT_ASSIGNMENTS) exactly:

| Title | MissionID | PersonID | ItemCategory | AssignmentKey | ItemDescription | KitStatus | JerseyNumber | OwnerEmail | IsActive |
|---|---|---|---|---|---|---|---|---|---|
| `TR/2026/006\|PER-0001\|Jersey\|HOME-2026` | `TR/2026/006` | `PER-0001` | `Jersey` | `HOME-2026` | `Home jersey 2026` | `Delivered` | `7` | `ops.coordinator@geekay.gg` | Yes |
| `TR/2026/006\|PER-0001\|Equipment\|CONTROLLER-01` | `TR/2026/006` | `PER-0001` | `Equipment` | `CONTROLLER-01` | `Controller` | `Confirmed` | | `ops.coordinator@geekay.gg` | Yes |
| `TR/2026/006\|PER-0002\|Jersey\|HOME-2026` | `TR/2026/006` | `PER-0002` | `Jersey` | `HOME-2026` | `Home jersey 2026` | `Ordered` | | `ops.coordinator@geekay.gg` | Yes |
| `SATR/2026/003\|PER-0004\|Jersey\|HOME-2026` | `SATR/2026/003` | `PER-0004` | `Jersey` | `HOME-2026` | `Home jersey 2026` | `NotOrdered` | | | Yes |

---

## 10. Future Notes

- **S29 write design** decides per-operation governance: AddKitAssignment (leaning ADR-013
  governed), status transitions (leaning documented lifecycle actions), returns/replacements.
  Write-time validation adds AssignmentKey format rules and uniqueness enforcement.
- `$top=500` per query — documented scale limitation; revisit if assignments × missions per
  year approaches the cap.
- Choice-drift risk: ItemCategory/KitStatus unions and SP choices must change together.
