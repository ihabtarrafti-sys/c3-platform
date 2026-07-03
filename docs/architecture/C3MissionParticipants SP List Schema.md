# C3MissionParticipants SP List Schema

**Sprint:** 27 Phase 2
**Status:** Proposed — Ready for provisioning
**Last updated:** 2026-07-03
**Author:** Engineering (C3 Platform)
**Purpose:** Define the SharePoint list schema for `C3MissionParticipants` — the mission/person
assignment join list. Pre-condition for the Sprint 27 Phase 3 read-path implementation and
operator provisioning.
**Scope:** Read-only foundation. No participant write path in Sprint 27.

---

## 1. List Identity

| Property | Value |
|---|---|
| Display name | `C3MissionParticipants` |
| Internal / API list title | `C3MissionParticipants` |
| URL segment | `/Lists/C3MissionParticipants` |
| Purpose | One row per person assigned to a mission — the join between `C3Missions` and `C3People` |
| Naming convention | C3 list convention: CamelCase, no underscore |

> **Provisioning rule (post-mortem):** create this list with the script or checklist below.
> **Never** pre-create it via grid/Excel import — imports assign `field_N` internal names that
> can never be corrected in place. See `C3Missions Provisioning Post-Mortem.md`.

---

## 2. Column Schema

Maps to the frozen `MissionParticipant` type in `packages/c3/src/types/mission.ts`. No new
domain properties are introduced in Sprint 27.

| Internal Name | Display Name | SP Type | Required | Maps To | Notes |
|---|---|---|---|---|---|
| `Title` | Assignment Key | Single line text | No | — | **Convenience display key only**: `<MissionID>\|<PersonID>` (e.g. `TR/2026/006\|PER-0001`). The mapper NEVER derives identity by parsing Title. No generated `MPT-XXXX` — the domain type has no participant ID and there is no operational need. |
| `MissionID` | Mission ID | Single line text | Yes | `MissionID` | Plain-text FK → `C3Missions.Title` (business TR/SATR code). **Not an SP lookup.** Indexed. |
| `PersonID` | Person ID | Single line text | Yes | `PersonID` | Plain-text FK → `C3People.Title` (canonical PER-XXXX). **Not an SP lookup.** Indexed. |
| `ExternalCode` | External Code | Single line text | Yes | `ExternalCode` | Geekay participant code (e.g. `RL/PL/026`) cross-referencing Finance/Logistics. Mapper tolerates blank with a warning. |
| `ParticipantRole` | Role | Choice | Yes | `Role` | **Internal name must be `ParticipantRole`, not `Role`** — collision-safe, same rationale as `MissionStatus`. Values in §4. |
| `PerDiemRate` | Per Diem Rate | Number | No | `PerDiemRate` | Numeric daily allowance. **Denominated in `Mission.OperatingCurrency`** — no participant-level currency. |
| `IsActive` | Is Active | Yes/No (default Yes) | No | *(persistence flag — not on the domain type)* | Null/missing maps as `true`. Both read methods exclude explicit `false` rows. Inactive rows are retained for history; there is no lifecycle UI in this sprint. |

**Deliberately omitted** (do not provision): `CurrencyCode` (per-diem uses the mission's
operating currency), `DisplayName`/`FullName` (names resolve live from `C3People` by PersonID
— no stale duplicates), `Notes` (no domain field, no documented business need), `MPT-XXXX`
identity column (no operational need; SP integer `Id` remains transport metadata only).

### System / SP-managed columns (not provisioned manually)

`Id` (transport metadata only — never cross-domain identity), `Created`, `Modified`,
`Author`, `Editor`.

---

## 3. SP List Settings

| Setting | Value |
|---|---|
| Content types | Disabled |
| Versioning | Major versions, limit 10 |
| Attachments | Disabled |
| Indexing | `MissionID`, `PersonID`. (`IsActive` not indexed — row volume is small and reads filter client-side after mapping.) |

---

## 4. Choice Values

### `ParticipantRole` — Role

Values **must match the `MissionParticipantRole` TypeScript union exactly** — an unknown value
hard-rejects the row (it silently disappears from every screen and from gap computation).

| Value |
|---|
| `Player` |
| `Coach` |
| `Manager` |
| `Analyst` |
| `Staff` |

Default: (none — must be chosen per row)

---

## 5. Identity and Uniqueness

**One person per mission, one participant role.** Conceptual uniqueness key:

```
MissionID + PersonID
```

This matches the mock regression data and every consumer (`participantPersonIdsByMission`
treats PersonID as the per-mission unit; gap computation evaluates each person once per
mission). SharePoint does not enforce compound uniqueness — operators must not create a second
active row for the same MissionID + PersonID. If a duplicate is ever created, both rows map
(the mapper does not deduplicate); the fix is data cleanup, not code.

`Title` carries the deterministic display key `<MissionID>|<PersonID>` for human readability
in SP views. It is never parsed for identity.

> **S29B write model (governed — full ADR-013):** `AddMissionParticipant` and
> `RemoveMissionParticipant` are owner-approved operations (request: owner/operations;
> approve: owner; self-approval blocked). Execution (owner session) performs the actual row
> write: add resolves ALL rows (incl. inactive) by `MissionID+PersonID` — 0 rows → POST;
> 1 inactive row → **governed reactivation** (ETag MERGE: IsActive=true + ExternalCode/
> ParticipantRole/PerDiemRate refreshed from the approved payload); 1 active exact-match →
> already-applied (stamp recovery); 1 active mismatch → conflict error; multiple →
> data-integrity error. Removal sets `IsActive=false` (mandatory reason; never deleted) and
> is blocked while active kit assignments exist. `EnforceUniqueValues` on `Title`
> (`<MissionID>|<PersonID>`) is the server-side race guard — enabled in the S29A delta;
> Title is never parsed for identity.
>
> **S29B list permissions (target posture):** **Edit = C3 Platform Owners only**; all other
> groups (incl. C3 Operations) Read — Operations submit membership requests through C3 and
> must not be able to bypass governance by editing rows directly. Evidence + method:
> `C3 Governance List Permissions — Sprint 29B.md`.

---

## 6. Relationship Model

```
C3MissionParticipants.MissionID  →  C3Missions.Title   (TR/SATR code, plain text)
C3MissionParticipants.PersonID   →  C3People.Title     (PER-XXXX, plain text)
```

- Plain-text canonical FKs — **no SharePoint lookup columns** (locked ADR; lookups couple to
  SP-internal identity, break on migration, and block OData filtering by canonical ID).
- SP numeric item IDs are never cross-domain identity.
- Participant arrays are never embedded in `C3Missions` rows.
- Person names are **resolved live from `C3People` by PersonID** at render time. Unknown
  PersonIDs render `Unknown person (PER-XXXX)`.

---

## 7. Out of Scope (Sprint 27)

No participant writes of any kind: no AddMissionParticipant / RemoveMissionParticipant /
UpdateMissionParticipant, no participant approval workflow, no jersey/equipment/travel
logistics, no per-diem payment processing, no inactive-row lifecycle UI. Mission writes remain
throwing stubs (TD-26).

---

## 8. Provisioning Checklist

Preferred: run `docs/architecture/scripts/Create-C3MissionParticipants.ps1` (hardened per the
S26 post-mortem). Manual fallback:

```
[ ] 1. Create the list (Site Contents → New → List → blank)
        - Name: C3MissionParticipants
        - NEVER create from Excel/grid import
[ ] 2. Add columns (classic column creation, exact names, no spaces at creation time)
        - MissionID        Single line text   Required
        - PersonID         Single line text   Required
        - ExternalCode     Single line text   Required
        - ParticipantRole  Choice             Required  (values: §4, in order)
        - PerDiemRate      Number             Optional
        - IsActive         Yes/No             Optional  (default: Yes)
[ ] 3. VERIFY INTERNAL NAMES via REST (mandatory — do not skip):
        {site}/_api/web/lists/getbytitle('C3MissionParticipants')/fields
            ?$select=InternalName,Title,TypeAsString,Required&$filter=Hidden eq false
        - ParticipantRole must be "ParticipantRole" (not "Role", not "ParticipantRole0")
        - Every column above must appear with its exact internal name — any "field_N"
          entry means the list was grid-imported: STOP and re-provision
[ ] 4. Verify ParticipantRole choices == Player/Coach/Manager/Analyst/Staff (exact)
[ ] 5. Verify IsActive default == Yes (create a test row without touching IsActive;
        confirm it reads back true)
[ ] 6. Set Title display name to "Assignment Key" (optional cosmetic)
[ ] 7. Add indexes: MissionID, PersonID
[ ] 8. Add sample rows (§9) — Title = "<MissionID>|<PersonID>"
[ ] 9. Read permissions for all authenticated C3 roles
```

---

## 9. Sample Rows

Mirror the Mock DSM regression data (`MockMissionService.ts`) for 1:1 hosted comparison:

| Title | MissionID | PersonID | ExternalCode | ParticipantRole | PerDiemRate | IsActive |
|---|---|---|---|---|---|---|
| `TR/2026/006\|PER-0001` | `TR/2026/006` | `PER-0001` | `RL/PL/026` | `Player` | `35` | Yes |
| `TR/2026/006\|PER-0002` | `TR/2026/006` | `PER-0002` | `RL/CH/004` | `Coach` | `25` | Yes |
| `SATR/2026/003\|PER-0004` | `SATR/2026/003` | `PER-0004` | `FC/PL/001` | `Player` | `35` | Yes |

---

## 10. Future Notes / Deferred Items

- **Participant write path** — future sprint; must follow ADR-013 governance and enforce the
  MissionID+PersonID uniqueness rule at write time.
- **Scale note:** reads use OData `$top=500`. Participant volume is small (participants ×
  missions per year); revisit pagination only if volume approaches the cap.
- **Choice-value drift risk:** any change to `MissionParticipantRole` in TypeScript must update
  the SP choice set in the same change — same risk class as `MissionStatus` and
  `C3Approvals.OperationType`.
- **PersonProfile missions section** — deferred to Sprint 28 (recorded in the Product
  Expansion Backlog); no PersonProfile change in Sprint 27.
