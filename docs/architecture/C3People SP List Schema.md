# C3People — SharePoint List Schema
## IT Provisioning Handover

**List internal name:** `C3People`  
**List display title:** `C3 People`  
**Sprint:** 16 — People Integration  
**Status:** READY FOR PROVISIONING  

This document is the authoritative schema reference for provisioning the People list in SharePoint. Column names, types, and values must be configured exactly as specified. Any deviation — including casing on the `Title` column repurposing — will cause the C3 runtime to reject or misread person records.

> **Critical: Title column repurposed as PersonID.** The SharePoint built-in `Title` column stores the C3 application identifier `PersonID` (e.g. `PER-0001`). `FullName` is a separate column. This is the most important schema constraint in this list. The legacy mapper in the codebase (`src/mappers/personMapper.ts`) maps `Title → FullName` — that mapper is wrong for this schema and must not be used for the SharePoint service.

---

## List Settings

| Setting | Value |
|---|---|
| Title | C3 People |
| Internal name | `C3People` (no spaces) |
| Description | Registered persons in the Geekay Esports C3 platform — players, staff, coaches, and contractors. |
| Versioning | Enable major versions. Set version limit to 10. |
| Audience | Site members (read/write for ops). Site visitors (read-only for non-ops). External sharing: Off. |
| Item-level permissions | Read all items. Edit only own items (ops staff manage their own records; admin manages all). |

---

## Required Column: Title (PersonID)

The built-in `Title` column is **repurposed** to store the C3 person identifier.

| Property | Value |
|---|---|
| Column name | `Title` (existing — do not rename) |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Purpose | C3 application PersonID, e.g. `PER-0001`. The C3 runtime reads this field as `PersonID`. |

**Naming convention for ops staff:** `PER-` followed by a zero-padded 4-digit number (e.g. `PER-0001`, `PER-0042`). Sort by Title to audit sequence gaps. PersonID is assigned sequentially and never reused.

> **Do not store the person's name in Title.** FullName is a separate column below. This is the opposite of the default SharePoint pattern — brief IT staff accordingly.

---

## Custom Columns

Add the following columns in order. Column internal names must match the display names exactly (use identical casing — SharePoint preserves it).

### 1. FullName

| Property | Value |
|---|---|
| Display name | `FullName` |
| Internal name | `FullName` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 200 |
| Description | Full legal name of the person, e.g. `Abdulaziz Alabdullatif`. Used for display throughout C3 and for credential matching. |
| Indexed | **Yes** — C3 may query by name in future sprints. |

### 2. IGN

| Property | Value |
|---|---|
| Display name | `IGN` |
| Internal name | `IGN` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 100 |
| Description | In-game name / alias, e.g. `Kakarot`. Display-only field — not used by protocol engine. Leave blank for staff who have no public alias. |

### 3. Nationality

| Property | Value |
|---|---|
| Display name | `Nationality` |
| Internal name | `Nationality` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 100 |
| Description | Country of nationality as a plain text string, e.g. `Saudi Arabia`, `Jordan`. The C3 credential protocol references nationality for visa obligation evaluation. Enter the full country name — do not abbreviate. |

### 4. PrimaryRole

| Property | Value |
|---|---|
| Display name | `PrimaryRole` |
| Internal name | `PrimaryRole` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 150 |
| Description | The person's primary role or job title, e.g. `Player`, `Head Coach`, `Graphic Designer`, `Player Operations Manager`. Plain text — no controlled vocabulary enforced at the SP layer. C3 does not branch on PrimaryRole values currently. |

### 5. PersonnelCode

| Property | Value |
|---|---|
| Display name | `PersonnelCode` |
| Internal name | `PersonnelCode` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 50 |
| Description | Internal HR personnel code, e.g. `FN/PL/001`. Format is `{GameCode}/{RoleCode}/{Sequence}`. Used for contract linking — the Contracts list references PersonnelCode as a cross-list key. Leave blank if no HR code is assigned yet. |
| Indexed | **Yes** — contracts are joined to people via PersonnelCode. |

### 6. CurrentTeam

| Property | Value |
|---|---|
| Display name | `CurrentTeam` |
| Internal name | `CurrentTeam` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Description | Name of the team the person is currently assigned to, e.g. `GKE Fortnite`, `GKA Apex Legends`, `Operations`, `Creative`. **Plain text — do not create this as a SharePoint Lookup column.** C3 reads CurrentTeam as a flat string; SP lookup overhead is unnecessary for this field. |

### 7. CurrentGameTitle

| Property | Value |
|---|---|
| Display name | `CurrentGameTitle` |
| Internal name | `CurrentGameTitle` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Description | Game title the person competes in or supports, e.g. `Fortnite`, `PUBG Mobile`, `League of Legends`, `Apex Legends`. Leave blank for staff roles not tied to a specific title (Operations, Creative). **Plain text — not a SP Lookup.** |

### 8. PrimaryDepartment

| Property | Value |
|---|---|
| Display name | `PrimaryDepartment` |
| Internal name | `PrimaryDepartment` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Description | Organizational department, e.g. `Esports`, `Operations`, `Creative`. **Plain text — not a SP Lookup.** C3 reads this as a flat string for display purposes. |

### 9. IsActive

| Property | Value |
|---|---|
| Display name | `IsActive` |
| Internal name | `IsActive` |
| Type | Yes/No (checkbox) |
| Required | Yes |
| Default value | **Yes** |
| Indexed | **Yes** — C3 queries `IsActive eq 1` to fetch only active persons. |
| Description | Uncheck when a person is no longer with Geekay Esports (departed, contract expired, offboarded). Inactive persons are hidden from operational views but retained as audit history. Do not delete records. |

### 10. FirstContractDate

| Property | Value |
|---|---|
| Display name | `FirstContractDate` |
| Internal name | `FirstContractDate` |
| Type | Date and Time |
| Required | No |
| Date format | **Date Only** (no time component) |
| Description | ISO 8601 date the person signed their first contract with Geekay. Populated by ops when the first contract is entered. Leave blank until the first contract record exists. |

### 11. LatestContractDate

| Property | Value |
|---|---|
| Display name | `LatestContractDate` |
| Internal name | `LatestContractDate` |
| Type | Date and Time |
| Required | No |
| Date format | **Date Only** |
| Description | ISO 8601 date of the most recent contract. Updated each time a new contract is entered for this person. Used by C3 for quick contract recency display without querying the Contracts list. |

### 12. TotalContracts

| Property | Value |
|---|---|
| Display name | `TotalContracts` |
| Internal name | `TotalContracts` |
| Type | Number |
| Required | No |
| Minimum value | 0 |
| Decimal places | 0 |
| Default value | 0 |
| Description | Running count of contracts ever signed by this person with Geekay. Incremented manually or via automation each time a new contract is entered. C3 displays this in the person profile for quick history scanning. |

### 13. Notes

| Property | Value |
|---|---|
| Display name | `Notes` |
| Internal name | `Notes` |
| Type | Multiple lines of text |
| Required | No |
| Text type | Plain text |
| Rows | 4 |
| Description | Free-text operational notes for ops staff. Not used by the C3 protocol engine. Examples: visa processing notes, transfer context, onboarding reminders. |

---

## Index Summary

Create indexes on the following columns (list settings → Indexed columns):

| Column | Reason |
|---|---|
| `IsActive` | `$filter=IsActive eq 1` is applied to every `listPeople()` call. |
| `FullName` | Future sprint: name-based search. Index proactively. |
| `PersonnelCode` | Contract → Person join. Index prevents full-list scan when resolving contract ownership. |

SharePoint supports up to 20 indexes per list. Using 3 here.

---

## Views

Create a default view with the following columns, in order:

1. Title (PersonID)
2. FullName
3. IGN
4. PrimaryRole
5. CurrentTeam
6. Nationality
7. IsActive
8. LatestContractDate

Sort: `FullName` ascending.

Add a second view `Inactive Persons` filtered by `IsActive eq No`, sorted by `FullName` ascending. This view is used for offboarding audits.

---

## Minimum Test Dataset

Provision these records before Sprint 16 regression testing. The PersonIDs and field values must match the mock service exactly. The C3 parity harness (`scripts/s16-parity-people.mjs`) will compare SP output against mock output field by field.

> **SP Item ID ≠ PersonID sequence.** SharePoint auto-assigns the SP item `Id` (1, 2, 3…) based on insertion order. The C3 `Person.Id` field maps to the SP item `Id` — it is not derived from PersonID. Provision in the order below so that SP IDs match the mock data IDs.

### Mirror records (10) — for parity test

| SP ID | Title (PersonID) | FullName | IGN | Nationality | PrimaryRole | PersonnelCode | CurrentTeam | CurrentGameTitle | PrimaryDepartment | IsActive | FirstContractDate | LatestContractDate | TotalContracts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PER-0001 | Abdulaziz Alabdullatif | Kakarot | Saudi Arabia | Player | FN/PL/001 | GKE Fortnite | Fortnite | Esports | Yes | 2026-01-10 | 2026-06-21 | 2 |
| 2 | PER-0003 | Diab Hassan | Diab | Morocco | Graphic Designer | CR/GD/002 | Creative | *(blank)* | Creative | Yes | 2025-09-01 | 2025-09-01 | 1 |
| 3 | PER-0002 | Mohammad Alkhalailah | Klownz | Jordan | Player Operations Manager | OP/OP/001 | Operations | *(blank)* | Operations | Yes | 2026-02-15 | 2026-06-21 | 2 |
| 4 | PER-0004 | Elaf Hussein | Elaf | Morocco | Performance Analyst | PG/AN/001 | GKA PUBG | PUBG Mobile | Esports | Yes | 2026-01-15 | 2026-01-15 | 1 |
| 5 | PER-0005 | Bechir Mettali | Boch | Tunisia | Performance Analyst | LL/AN/002 | GKA League of Legends | League of Legends | Esports | Yes | 2026-03-01 | 2026-03-01 | 1 |
| 6 | PER-0006 | Sari Al-Khatib | Sari | Jordan | Graphic Designer | CR/GD/001 | Creative | *(blank)* | Creative | Yes | 2026-02-01 | 2026-02-01 | 1 |
| 7 | PER-0007 | Nadia Khoury | Nadia | Lebanon | Video Editor | CR/VE/003 | Creative | *(blank)* | Creative | Yes | 2026-02-01 | 2026-02-01 | 1 |
| 8 | PER-0008 | Keon Williams | Keon | United States | Player | AL/PL/001 | GKA Apex Legends | Apex Legends | Esports | Yes | 2026-04-01 | 2026-04-01 | 1 |
| 9 | PER-0009 | Jamison Moore | Jxmo | United States | Head Coach | AL/CH/001 | GKA Apex Legends | Apex Legends | Esports | Yes | 2026-04-01 | 2026-04-01 | 1 |
| 10 | PER-0010 | Tyler Johnson | Phantom | United States | Player | AL/PL/002 | GKA Apex Legends | Apex Legends | Esports | Yes | 2026-04-01 | 2026-04-01 | 1 |

> **Note on ordering:** The mock data inserts persons in this exact sequence (PER-0001 first, but with PersonID `PER-0003` as SP Id 2, etc.). The C3 parity harness checks `Person.Id` against `SP item Id` — provision in the exact order above so SP IDs align with mock `Id` values.

### Stress records (3) — for diagnostic validation

Add these after the mirror records:

| SP ID | Title (PersonID) | FullName | Notes |
|---|---|---|---|
| 11 | *(leave blank)* | Missing PersonID | Tests: hard reject for missing PersonID (blank Title) |
| 12 | PER-9999 | Inactive Test Person | Set `IsActive = No`. Tests: inactive persons are excluded from `listPeople()` results. |
| 13 | PER-INVALID | No Required Fields | Leave `FullName` blank. Tests: mapper handles missing FullName gracefully (should warn, not throw). |

**Expected diagnostic output for stress records:**
```
[C3/People] Item 11: missing PersonID — record rejected
[C3/People] Item 13: missing FullName for PER-INVALID — record accepted with empty FullName (warn)
```

Record 12 should not appear in `listPeople()` output at all (filtered by `IsActive eq 1`).

---

## Mapper Reference

When implementing `spPersonMapper.ts` (Sprint 16, S16-4), map SP fields to the `Person` type as follows:

| SP Column / Property | C3 `Person` field | Notes |
|---|---|---|
| `item.Id` | `Person.Id` | SP auto-generated integer ID |
| `item.Title` | `Person.PersonID` | **Title = PersonID, not FullName** |
| `item.FullName` | `Person.FullName` | Separate column |
| `item.IGN` | `Person.IGN` | Optional |
| `item.Nationality` | `Person.Nationality` | Optional |
| `item.PrimaryRole` | `Person.PrimaryRole` | Optional |
| `item.PersonnelCode` | `Person.PersonnelCode` | Optional |
| `item.CurrentTeam` | `Person.CurrentTeam` | Plain text string |
| `item.CurrentGameTitle` | `Person.CurrentGameTitle` | Plain text string |
| `item.PrimaryDepartment` | `Person.PrimaryDepartment` | Plain text string |
| `item.IsActive` | `Person.IsActive` | Boolean (SP Yes/No) |
| `item.FirstContractDate` | `Person.FirstContractDate` | ISO date string via `normalizeSpDate()` |
| `item.LatestContractDate` | `Person.LatestContractDate` | ISO date string via `normalizeSpDate()` |
| `item.TotalContracts` | `Person.TotalContracts` | Integer, default 0 if null |

**Do not use `src/mappers/personMapper.ts`.** That mapper maps `Title → FullName`, which is wrong for this schema. The S16-4 mapper (`src/utils/spPersonMapper.ts`) is the authoritative implementation for SharePoint people reads.

---

## Checklist Before Signoff

- [ ] List created at the correct site URL (`https://geekaygames.sharepoint.com/sites/C3`)
- [ ] All 13 custom columns present with correct internal names (check via Site Settings → List Settings)
- [ ] `Title` column understood by IT as PersonID — not FullName
- [ ] `IsActive` default = Yes
- [ ] `CurrentTeam`, `CurrentGameTitle`, `PrimaryDepartment` configured as plain text (not Lookup columns)
- [ ] Indexes created on `IsActive`, `FullName`, `PersonnelCode`
- [ ] Default view configured with correct columns and sort
- [ ] `Inactive Persons` view configured
- [ ] 10 mirror records entered in order (SP Id 1–10 must match mock Id sequence)
- [ ] 3 stress records entered (SP Id 11–13)
- [ ] Confirm site URL and list REST endpoint with the C3 development team before starting S16-5
