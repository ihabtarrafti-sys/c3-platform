# C3Missions SP List Schema

**Sprint:** 26 Phase 1
**Status:** Proposed — Ready for provisioning
**Last updated:** 2026-07-02
**Author:** Engineering (C3 Platform)
**Purpose:** Define the SharePoint list schema for `C3Missions` — the mission/event operational
list. This document is the pre-condition for the Sprint 26 Phase 2 read-path implementation and
IT/operator provisioning.
**Scope:** Read-only foundation. No mission write path in Sprint 26.

---

## 1. List Identity

| Property | Value |
|---|---|
| Display name | `C3Missions` |
| Internal / API list title | `C3Missions` |
| URL segment | `/Lists/C3Missions` |
| Purpose | Mission/event commitments — the operational context Obligations, Journeys, Logistics, and Finance derive meaning from |
| Naming convention | Follows C3 list convention: CamelCase, no underscore (matches `C3People`, `C3Credentials`, `C3Journeys`, `C3Approvals`, `C3Contracts`) |

> **Important:** `Title` stores the **business-assigned TR/SATR code** (e.g. `TR/2026/006`,
> `SATR/2026/003`), not an SP-derived canonical ID. The POST-then-MERGE pattern used by
> People/Credentials/Journeys/Approvals does **NOT** apply to this list. See §5.

---

## 2. Column Schema

Maps 1:1 to the frozen `Mission` type in `packages/c3/src/types/mission.ts`. Do not add columns
for `MissionName`, `MissionType`, `RelatedTeam`, or `PrimaryOwner` — these were proposed in
Sprint 26 planning and explicitly rejected. The existing business-aligned model is the source
of truth.

| Internal Name | Display Name | SP Type | Required | Maps To (`Mission` field) | Notes |
|---|---|---|---|---|---|
| `Title` | Mission ID | Single line text | Yes | `MissionID` | Business TR/SATR code (e.g. `TR/2026/006`). **Business-assigned — never SP-generated.** Same code is the Finance Sales Order reference. |
| `Name` | Mission Name | Single line text | Yes | `Name` | Display name, e.g. `RLCS 2026 - World Championship & EWC`. |
| `Game` | Game | Single line text | Yes | `Game` | Game title, e.g. `Rocket League`. |
| `Organizer` | Organizer | Single line text | Yes | `Organizer` | Tournament organiser, e.g. `Psyonix / EWC`. |
| `Entity` | Entity | Choice | Yes | `Entity` | `UAE` / `KSA` / `Multi`. Should agree with the TR code prefix (TR/ = UAE, SATR/ = KSA). |
| `MissionStatus` | Status | Choice | Yes | `Status` | **Internal name must be `MissionStatus`, not `Status`** — see §4 and the reserved-word warning below. |
| `Jurisdiction` | Jurisdiction | Single line text | Yes | `Jurisdiction` | Where the mission takes place, `City, Country` (e.g. `Paris, France`). Drives future jurisdiction-aware credential evaluation. |
| `StartDate` | Start Date | Date and Time (Date Only) | Yes | `Span.StartDate` | First operational day. Obligation spans begin here. |
| `EndDate` | End Date | Date and Time (Date Only) | Yes | `Span.EndDate` | Last operational day. Urgency horizon — credentials must be valid through this date. |
| `SettlementDate` | Settlement Date | Date and Time (Date Only) | Yes | `Span.SettlementDate` | Financial closure. May be months after EndDate. |
| `OperatingCurrency` | Operating Currency | Choice | No | `OperatingCurrency` | `USD` / `AED` / `SAR` / `EUR`. Denominator for future finance lines. |
| `CreatedBy` | Created By (Staff) | Single line text | Yes | `CreatedBy` | Staff member name/email. Plain text — NOT the SP-managed `Author` people column. |
| `ConfirmedAt` | Confirmed At | Date and Time | No | `ConfirmedAt` | UTC timestamp the mission reached `Confirmed`. Blank until confirmed. |
| `ConfirmedBy` | Confirmed By | Single line text | No | `ConfirmedBy` | Staff member who confirmed. Blank until confirmed. |
| `Notes` | Notes | Multi-line text (plain) | No | `Notes` | Free-text operational notes. |
| `IsActive` | Is Active | Yes/No | No | (internal filter) | Operational filter flag. Defaults to `Yes`. Not exposed on the `Mission` domain type. |

### System / SP-managed columns (not provisioned manually)

| Column | Notes |
|---|---|
| `Id` | SP auto-incremented integer. **Never used as a mission identifier.** |
| `Created` | SP-managed creation timestamp. **Maps to `Mission.CreatedAt`** (see mapping note below). |
| `Modified` | SP-managed last-modified timestamp. |
| `Author` / `Editor` | SP-managed people columns. Not mapped — `CreatedBy` plain-text column is authoritative for the domain model. |

> **`CreatedAt` mapping note:** `Mission.CreatedAt` maps from the SP-managed `Created` column.
> For rows back-filled during provisioning, `Created` reflects the import time rather than the
> original business creation date — acceptable for the read foundation. A future write path
> creates rows at business-creation time, making `Created` accurate going forward.

> **⚠ SP reserved-word warning (critical for provisioning):** Do **not** name the status
> column `Status`. SharePoint silently renames colliding internal names (e.g. to `Status0`),
> which breaks OData `$select`/`$filter` invisibly. Use `MissionStatus` — same pattern as
> `ApprovalStatus` in `C3Approvals`. After provisioning, verify internal names via:
> `{site}/_api/web/lists/getbytitle('C3Missions')/fields?$select=InternalName,Title&$filter=Hidden eq false`

---

## 3. SP List Settings

| Setting | Value |
|---|---|
| Content types | Disabled (single default content type is sufficient) |
| Versioning | Recommended: Major versions enabled, limit to 10 |
| Attachments | Disabled |
| Audience targeting | Disabled |
| Item-level permissions | Default (read all items) — adjust per security model |
| Indexing | Index `MissionStatus` and `Entity` (see §10) |

---

## 4. Choice Values

### `MissionStatus` — Status

Values **must match the `MissionStatus` TypeScript union exactly** (ADR-002 consequence —
a mismatched choice value causes the mapper to hard-reject the row, silently removing the
mission from all screens and gap computation).

| Value | Description |
|---|---|
| `Planning` | Under consideration — no financial commitment made |
| `FinancePending` | Proposed to Finance — awaiting approval |
| `Confirmed` | Finance approved — obligations activate here (ADR-002 gate) |
| `Active` | Mission in progress (StartDate reached) |
| `PostMission` | Event ended — awaiting financial settlement |
| `Settled` | Accounts closed — mission archived |
| `Canceled` | Commitment withdrawn at any pre-Active state |

Default: `Planning`

> Note the spelling: `Canceled` (single L) — matching the TypeScript union. This differs
> from `C3Journeys.Status` which uses `Cancelled` (double L). Provision exactly as written.

### `Entity` — Legal Entity

| Value | Description |
|---|---|
| `UAE` | Geekay UAE entity (TR/ code prefix) |
| `KSA` | Geekay KSA entity (SATR/ code prefix) |
| `Multi` | Multi-entity mission |

Default: (none — must be chosen per row)

### `OperatingCurrency` — Operating Currency

| Value |
|---|
| `USD` |
| `AED` |
| `SAR` |
| `EUR` |

Default: (none — optional field)

---

## 5. Identity Model — Business TR/SATR Codes

```
C3Missions.Title = MissionID = Geekay TR code (business-assigned)
```

Mission identity is **not** platform-generated (locked ADR):

- `TR/2026/006` — UAE entity, 2026, 6th commitment of the year
- `SATR/2026/003` — KSA entity, 2026, 3rd commitment of the year

The same codes are used as Finance Sales Order references. Adopting them as the platform
identifier preserves cross-system linkage without introducing a new ID namespace.

**Consequences:**

- The POST-then-MERGE pattern (used for PER/CRED/JRN/APR-XXXX) does **not** apply here.
- SP integer `Id` is never used as a mission identifier anywhere in the app layer.
- The future mission write path must accept a human-assigned TR code and should validate
  format (`TR/YYYY/NNN` or `SATR/YYYY/NNN`) and uniqueness before POST. It must preserve
  the business MissionID standard — no generated fallbacks.
- OData lookups filter on `Title eq '{missionId}'`. TR codes contain `/` characters, which
  are legal inside a quoted OData string literal; the service URL-encodes the filter value.

---

## 6. Relationship Model

### Future `C3MissionParticipants` join list (Sprint 27 — not provisioned now)

```
C3MissionParticipants.MissionID  →  C3Missions.Title   (TR/SATR code, plain text)
C3MissionParticipants.PersonID   →  C3People.Title     (PER-XXXX, plain text)
```

Participants are a **separate join list** — participant arrays are never embedded in
`C3Missions` columns. This follows the C3 canonical plain-text FK pattern (no SP lookup
columns), consistent with `C3Credentials.HolderPersonID`, `C3Journeys.PersonID`,
`C3Approvals.TargetPersonID`, and `C3Contracts.PersonID`.

### Existing inbound reference

`C3Journeys.MissionID` (optional plain-text column) already references mission TR codes for
journeys initiated from a mission-scoped gap.

---

## 7. Out of Scope

Explicitly deferred from Sprint 26 (do not provision columns for these):

- **Mission creation / write path** — no POST from the app in this sprint
- **Governed AddMission approval** — future ADR-013 operation type
- **Status transitions from the UI** — `confirmMission` / `updateMissionStatus` remain stubs in SP DSM
- **Participants** — `C3MissionParticipants` list is Sprint 27
- **Jersey / logistics tracking** — Sprint 27+
- **Budget / finance lines / income** — mock-only; SP schema deferred
- **Milestones** — mock-only; SP schema deferred
- **Jurisdiction-aware credential discrimination** — `Jurisdiction` is stored for future use only
- **Pagination** — OData `$top=500` is acceptable for beta (mission volume is tens per year)

---

## 8. Provisioning Checklist

Steps for IT / SP Site Owner before the Phase 2 read path can be validated in SP DSM.

```
[ ] 1. Create the list
        - Site Contents → New → List
        - Name: C3Missions
        - Description: C3 mission/event commitments. Managed by C3 Platform.
        - Confirm internal list title is "C3Missions" (no spaces, no underscores)

[ ] 2. Add columns (in order)
        - Name               Single line text          Required
        - Game               Single line text          Required
        - Organizer          Single line text          Required
        - Entity             Choice                    Required  (values: see §4)
        - MissionStatus      Choice                    Required  (values: see §4; default Planning)
        - Jurisdiction       Single line text          Required
        - StartDate          Date and Time (Date Only) Required
        - EndDate            Date and Time (Date Only) Required
        - SettlementDate     Date and Time (Date Only) Required
        - OperatingCurrency  Choice                    Optional  (values: see §4)
        - CreatedBy          Single line text          Required
        - ConfirmedAt        Date and Time             Optional
        - ConfirmedBy        Single line text          Optional
        - Notes              Multi-line text (plain)   Optional
        - IsActive           Yes/No                    Optional  (default: Yes)

[ ] 3. VERIFY INTERNAL NAMES after creation (critical)
        - GET {site}/_api/web/lists/getbytitle('C3Missions')/fields
              ?$select=InternalName,Title&$filter=Hidden eq false
        - Confirm MissionStatus is "MissionStatus" (NOT "Status" / "Status0")
        - Confirm CreatedBy is "CreatedBy" (NOT "CreatedBy0")
          (If SP renames CreatedBy due to collision, rename the column and re-verify;
           the mapper reads the internal name exactly.)

[ ] 4. Add at least one test row
        - Title: TR/2026/006 (or a real current TR code)
        - See Sample Rows (§9)

[ ] 5. Verify read permissions
        - Operations, Owner, and all authenticated C3 roles need Read access

[ ] 6. Add SP indexes
        - Index: MissionStatus
        - Index: Entity

[ ] 7. Smoke test after Phase 2 + NavRail guard removal
        - Open C3 in SP DSM (guard must be lifted first — see TD-25)
        - Missions screen lists all C3Missions rows
        - Confirm no console errors and no mapper rejection warnings
```

---

## 9. Sample Rows

Mirrors the Mock DSM regression data (`MockMissionService.ts`) so hosted validation can be
compared 1:1 against mock behaviour.

### Sample Row 1

| Column | Value |
|---|---|
| Title | `TR/2026/006` |
| Name | `RLCS 2026 - World Championship & EWC` |
| Game | `Rocket League` |
| Organizer | `Psyonix / EWC` |
| Entity | `UAE` |
| MissionStatus | `Confirmed` |
| Jurisdiction | `Paris, France` |
| StartDate | `2026-07-08` |
| EndDate | `2026-08-16` |
| SettlementDate | `2026-12-30` |
| OperatingCurrency | `USD` |
| CreatedBy | `ops.coordinator@geekay.gg` |
| ConfirmedAt | `2026-06-15T10:00:00Z` |
| ConfirmedBy | `finance.lead@geekay.gg` |
| Notes | `Combined WC + EWC trip. Finance approved June 15.` |
| IsActive | `Yes` |

### Sample Row 2

| Column | Value |
|---|---|
| Title | `SATR/2026/003` |
| Name | `Saudi eLeague 2026 - Season 2` |
| Game | `EA Sports FC` |
| Organizer | `Saudi eLeague` |
| Entity | `KSA` |
| MissionStatus | `FinancePending` |
| Jurisdiction | `Riyadh, Saudi Arabia` |
| StartDate | `2026-09-01` |
| EndDate | `2026-09-30` |
| SettlementDate | `2026-11-30` |
| OperatingCurrency | `SAR` |
| CreatedBy | `ops.coordinator@geekay.gg` |
| ConfirmedAt | _(blank)_ |
| ConfirmedBy | _(blank)_ |
| Notes | `Awaiting Finance sign-off. Do not book travel until confirmed.` |
| IsActive | `Yes` |

---

## 10. Future Notes / Deferred Items

### TD-25 — SP DSM missions nav hidden pending provisioning

Until IT provisions `C3Missions` and a hosted smoke test passes, the Missions NavRail item is
hidden in SP DSM (`visibleWhen: mode !== 'sharepoint'`) — the same beta-containment pattern
as Contracts (S24) and Amendments (S20). The read service itself is 404-safe and returns `[]`
if the list is missing, so lifting the guard early degrades to an empty state, not a crash.

### Mission write path (future sprint)

When implemented, mission creation must follow ADR-013 governance (approval before write) and
accept a business-assigned TR/SATR code as `Title`. Status transitions (`confirmMission`,
`updateMissionStatus`) must validate lifecycle transitions exactly as `MockMissionService`
does, and set `ConfirmedAt`/`ConfirmedBy` on confirmation.

### Indexing recommendation

`MissionStatus` is the primary operational filter (ADR-002 gate queries filter on
Confirmed/Active/PostMission); `Entity` is the secondary filter. Mission volume is low
(tens per year), so this is future-proofing rather than an immediate throttling concern.

### Choice-value drift risk

If a new `MissionStatus` value is ever added to the TypeScript union, the SP choice set must
be updated in the same change — a value present in SP but unknown to the mapper hard-rejects
the row; a value in TS but missing from SP cannot be persisted. This is the same
drift risk documented for `C3Approvals.OperationType`.
