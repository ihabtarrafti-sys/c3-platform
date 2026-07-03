# C3PersonApparelProfiles SP List Schema

**Sprint:** 28 Phase 1
**Status:** Proposed — Ready for provisioning
**Last updated:** 2026-07-03
**Author:** Engineering (C3 Platform)
**Purpose:** Define the SharePoint list schema for `C3PersonApparelProfiles` — stable apparel
attributes (sizing, jersey print name) per person. Pre-condition for the Sprint 28 read path.
**Scope:** Read-only foundation. No apparel write path in Sprint 28 (profile edits are a
Sprint 29 candidate; governance classification pending).

---

## 1. List Identity

| Property | Value |
|---|---|
| Display name | `C3PersonApparelProfiles` |
| Internal / API list title | `C3PersonApparelProfiles` |
| Purpose | One active apparel profile per person — stable attributes, not mission state |
| Naming convention | C3 list convention: CamelCase, no underscore |

> **Locked decision:** apparel attributes are deliberately **NOT columns on `C3People`** —
> that would touch the frozen `Person` type, the governed AddPerson flow, `spPersonMapper`,
> and the 220-test s16 parity surface. A separate optional 1:1 list keeps all of that intact.

> **Provisioning rule (post-mortem):** never pre-create via grid/Excel import (`field_N`
> internal names are permanent). Use the hardened script or the manual checklist below.

---

## 2. Column Schema

Maps to `ApparelProfile` in `packages/c3/src/types/logistics.ts`.

| Internal Name | Display Name | SP Type | Required | Maps To | Notes |
|---|---|---|---|---|---|
| `Title` | Profile Key | Single line text | No | — | Display key = PersonID. **Never parsed for identity.** |
| `PersonID` | Person ID | Single line text | Yes | `PersonID` | Plain-text FK → `C3People.PersonID`. **Not an SP lookup.** Indexed. One active row per person. |
| `JerseySize` | Jersey Size | Choice | No | `JerseySize` | **Internal name `JerseySize`, not `Size`.** Values in §4. Unknown value degrades to absent (display-only attribute — the mapper does not reject the profile). |
| `NameOnJersey` | Name on Jersey | Single line text | No | `NameOnJersey` | Free text (255). Print length/character validation is a write-time concern (S29). |
| `Notes` | Notes | Multi-line text (plain) | No | `Notes` | Fit/preference notes, sponsor constraints. |
| `IsActive` | Is Active | Yes/No (default Yes) | No | *(persistence flag)* | Null/missing maps as `true`. Reads exclude explicit `false`. Inactive rows retained for history. |

**Deliberately omitted (no business evidence — deferred):** shirt/hoodie/pants/shoe sizes
(nothing in code, mock data, or operational docs requires them; `Notes` absorbs edge cases;
additive choice columns are cheap later), any snapshot of person names (names resolve live
from C3People everywhere).

---

## 3. SP List Settings

Content types disabled · Major versioning (limit 10) · Attachments disabled · Index: `PersonID`.

---

## 4. Choice Values

### `JerseySize`

Must match the `JerseySize` TypeScript union exactly: `XS`, `S`, `M`, `L`, `XL`, `XXL`, `3XL`.
Default: (none).

---

## 5. Identity and Uniqueness

**One active profile per person** — conceptual key `PersonID`. SharePoint does not enforce
this; duplicates are an operator-data problem (the read service uses the first active row and
logs a warning). `Title` = PersonID for readability; never identity.

---

## 6. Relationship Model

```
C3PersonApparelProfiles.PersonID → C3People.PersonID   (canonical PER-XXXX, plain text)
```

No SP lookups; SP numeric `Id` is transport metadata only.

---

## 7. Out of Scope (Sprint 28)

No writes (create/edit/deactivate), no lifecycle UI, no sizing beyond jersey, no per-mission
apparel state (that is `C3MissionKitAssignments`).

---

## 8. Provisioning Checklist

Preferred: `docs/architecture/scripts/Create-C3PersonApparelProfiles.ps1`. Manual fallback:

```
[ ] 1. Create blank list "C3PersonApparelProfiles" (NEVER from Excel/grid import)
[ ] 2. Columns: PersonID (Text, Req) · JerseySize (Choice, §4) ·
       NameOnJersey (Text) · Notes (plain multi-line) · IsActive (Yes/No, default Yes)
[ ] 3. VERIFY INTERNAL NAMES via REST (mandatory):
       {site}/_api/web/lists/getbytitle('C3PersonApparelProfiles')/fields
           ?$select=InternalName,Title,TypeAsString,Required&$filter=Hidden eq false
       Any field_N entry → STOP and re-provision.
[ ] 4. Verify JerseySize choices exactly XS/S/M/L/XL/XXL/3XL
[ ] 5. Verify IsActive default = Yes
[ ] 6. Index PersonID; Title display name "Profile Key"
[ ] 7. Sample rows (§9)
```

---

## 9. Sample Rows

Mirror the Mock DSM seeds (`MockApparelProfileService.ts`) exactly:

| Title | PersonID | JerseySize | NameOnJersey | Notes | IsActive |
|---|---|---|---|---|---|
| `PER-0001` | `PER-0001` | `L` | `ABDULAZIZ` | `Prefers athletic fit.` | Yes |
| `PER-0002` | `PER-0002` | `M` | `ALKHALAILAH` | _(blank)_ | Yes |

**No row for PER-0004** — deliberately: the missing-profile state ("No apparel profile on
file.") is part of hosted validation.

---

## 10. Future Notes

- Profile edits: Sprint 29 candidate — governance classification pending (lightweight
  role-gated update vs full ADR-013; decided at S29 Phase 0).
- Additional size fields: additive when business evidence appears.
- Choice-drift risk: JerseySize union and SP choices must change together.
