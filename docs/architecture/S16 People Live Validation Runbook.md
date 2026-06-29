# S16 People Live Validation Runbook
**C3 Contract Control Center — Sprint 16**
**Date:** 2026-06-29
**Status:** READY FOR EXECUTION — pending C3People list provisioning
**Prerequisite:** `C3People` list does not yet exist. This runbook covers both provisioning and validation.

> **Runtime mode note:** When `dataSourceMode = 'sharepoint'`, the entire service registry switches to SharePoint. In S15, `SharePointPersonService` was a stub returning `[]`, so People Workspace showed 0 people. In S16, `SharePointPersonService` is fully implemented (`listPeople` and `getPerson`). Switching to SP mode will now populate People Workspace from live `C3People` data. Credential data continues to fetch from `C3Credentials` (S15 unchanged). Both service prefixes — `[C3/People]` and `[C3/Credential]` — must appear separately in the console; the diagnostic prefix fix in `normalizeSpDate` ensures People date warnings never emit `[C3/Credential]`.

> **Parity harness baseline:** `scripts/s16-parity-people.mjs` passes 220/220 locally against the inlined mapper logic. The live run in this runbook is the real-SP confirmation that the same mapper handles actual REST response shapes correctly.

---

## Section 1 — Column Creation Checklist

Create each column exactly as specified. Column **internal names are permanent** — they are set at creation time from the first name you type. If a mistake is made, delete the column and recreate it.

**Workflow:** Click **+ Add column** → choose type → type internal name first → save → adjust display name only if different.

> The `Title` column already exists on every SP list. **Do not rename it.** Its internal name must remain `Title`. The C3 runtime reads `item.Title` as `PersonID`. Brief IT staff: this is the opposite of the default SharePoint pattern — Title stores the person's ID (e.g. `PER-0001`), not their name.

---

### Column 0 — Title (PersonID, built-in)

| Property | Value |
|---|---|
| Internal name | `Title` (built-in — already exists, do not rename) |
| Display name | Leave as `Title`, or optionally rename display label to **Person ID** |
| SP column type | Single line of text (built-in) |
| Required | Yes (built-in) |
| Notes | Stores the C3 application PersonID, e.g. `PER-0001`. **Do not store the person's name here.** FullName is a separate column. This is the most critical schema constraint. |

---

### Column 1 — FullName

| Property | Value |
|---|---|
| Internal name | `FullName` |
| Display name | `FullName` |
| SP column type | Single line of text |
| Required | **Yes** |
| Maximum characters | 200 |
| Indexed | **Yes** |
| Description | Full legal name, e.g. `Abdulaziz Alabdullatif`. Required — blank FullName causes a mapper hard reject. |

---

### Column 2 — IGN

| Property | Value |
|---|---|
| Internal name | `IGN` |
| Display name | `IGN` |
| SP column type | Single line of text |
| Required | No |
| Maximum characters | 100 |
| Description | In-game name / alias. Leave blank for staff with no public alias. |

---

### Column 3 — Nationality

| Property | Value |
|---|---|
| Internal name | `Nationality` |
| Display name | `Nationality` |
| SP column type | Single line of text |
| Required | No |
| Maximum characters | 100 |
| Description | Full country name, e.g. `Saudi Arabia`, `Jordan`. Referenced by the credential protocol for visa obligation evaluation. |

---

### Column 4 — PrimaryRole

| Property | Value |
|---|---|
| Internal name | `PrimaryRole` |
| Display name | `PrimaryRole` |
| SP column type | Single line of text |
| Required | No |
| Maximum characters | 150 |
| Description | Job title or role, e.g. `Player`, `Head Coach`, `Graphic Designer`. Plain text — no controlled vocabulary at the SP layer. |

---

### Column 5 — PersonnelCode

| Property | Value |
|---|---|
| Internal name | `PersonnelCode` |
| Display name | `PersonnelCode` |
| SP column type | Single line of text |
| Required | No |
| Maximum characters | 50 |
| Indexed | **Yes** |
| Description | Internal HR code, e.g. `FN/PL/001`. Format: `{GameCode}/{RoleCode}/{Sequence}`. Used for contract → person joins. |

---

### Column 6 — CurrentTeam

| Property | Value |
|---|---|
| Internal name | `CurrentTeam` |
| Display name | `CurrentTeam` |
| SP column type | **Single line of text** |
| Required | No |
| Maximum characters | 200 |
| Description | Current team assignment, e.g. `GKE Fortnite`, `Operations`. **Plain text — NOT a SharePoint Lookup column.** C3 reads this as a flat string. Do not create a Lookup to a Teams list. |

---

### Column 7 — CurrentGameTitle

| Property | Value |
|---|---|
| Internal name | `CurrentGameTitle` |
| Display name | `CurrentGameTitle` |
| SP column type | **Single line of text** |
| Required | No |
| Maximum characters | 200 |
| Description | Game title, e.g. `Fortnite`, `PUBG Mobile`. **Plain text — NOT a SP Lookup.** Leave blank for staff not tied to a specific game. |

---

### Column 8 — PrimaryDepartment

| Property | Value |
|---|---|
| Internal name | `PrimaryDepartment` |
| Display name | `PrimaryDepartment` |
| SP column type | **Single line of text** |
| Required | No |
| Maximum characters | 200 |
| Description | Organizational department, e.g. `Esports`, `Creative`, `Operations`. **Plain text — NOT a SP Lookup.** |

---

### Column 9 — IsActive

| Property | Value |
|---|---|
| Internal name | `IsActive` |
| Display name | `IsActive` |
| SP column type | Yes/No (checkbox) |
| Required | Yes |
| Default value | **Yes** |
| Indexed | **Yes** |
| Description | Uncheck for departed or offboarded persons. `listPeople()` applies `$filter=IsActive eq 1` — inactive persons are excluded from all operational views. Do not delete records; uncheck IsActive instead. |

---

### Column 10 — FirstContractDate

| Property | Value |
|---|---|
| Internal name | `FirstContractDate` |
| Display name | `FirstContractDate` |
| SP column type | Date and Time |
| Required | No |
| Date format | **Date Only** (no time component) |
| Description | Date of the person's first contract. SP REST returns this as `"2026-01-10T00:00:00Z"`; the mapper normalises to `"2026-01-10"`. |

---

### Column 11 — LatestContractDate

| Property | Value |
|---|---|
| Internal name | `LatestContractDate` |
| Display name | `LatestContractDate` |
| SP column type | Date and Time |
| Required | No |
| Date format | **Date Only** |
| Description | Date of the most recent contract. Updated when new contracts are entered. |

---

### Column 12 — TotalContracts

| Property | Value |
|---|---|
| Internal name | `TotalContracts` |
| Display name | `TotalContracts` |
| SP column type | Number |
| Required | No |
| Minimum value | 0 |
| Decimal places | 0 |
| Default value | 0 |
| Description | Running count of all contracts signed. Integer. C3 displays this in the person profile. |

---

### Column 13 — Notes

| Property | Value |
|---|---|
| Internal name | `Notes` |
| Display name | `Notes` |
| SP column type | Multiple lines of text |
| Required | No |
| Text type | Plain text |
| Rows | 4 |
| Description | Free-text operational notes. Not used by the C3 protocol engine. |

---

### Column creation summary

| # | Internal name | Type | Required |
|---|---|---|---|
| 0 | `Title` (built-in) | Single line | Yes |
| 1 | `FullName` | Single line | **Yes** |
| 2 | `IGN` | Single line | No |
| 3 | `Nationality` | Single line | No |
| 4 | `PrimaryRole` | Single line | No |
| 5 | `PersonnelCode` | Single line | No |
| 6 | `CurrentTeam` | Single line (NOT Lookup) | No |
| 7 | `CurrentGameTitle` | Single line (NOT Lookup) | No |
| 8 | `PrimaryDepartment` | Single line (NOT Lookup) | No |
| 9 | `IsActive` | Yes/No | Yes (default: Yes) |
| 10 | `FirstContractDate` | Date only | No |
| 11 | `LatestContractDate` | Date only | No |
| 12 | `TotalContracts` | Number (integer) | No |
| 13 | `Notes` | Multiple lines | No |

**Total: 14 columns** (built-in Title + 13 custom). No additional columns beyond this set.

---

## Section 2 — Index Checklist

Indexes are set via **List Settings → Indexed columns → Add a new index**.

| Column | Internal name | Index? | Reason |
|---|---|---|---|
| Title | `Title` | Built-in (already indexed) | `getPerson()` queries `$filter=Title eq 'PER-NNNN'` |
| IsActive | `IsActive` | **Yes — add index** | Every `listPeople()` call applies `$filter=IsActive eq 1`. Without index, SP scans all rows. |
| FullName | `FullName` | **Yes — add index** | Future sprint: name-based search. Index proactively. |
| PersonnelCode | `PersonnelCode` | **Yes — add index** | Contract → Person join. Prevents full-list scan when resolving contract ownership. |

SP supports up to 20 indexes per list. This runbook uses 3 (plus the built-in Title index).

---

## Section 3 — Test Records

Enter all records in the order shown. **Order matters:** SP auto-assigns item `Id` by insertion order. The `Person.Id` field maps to the SP item `Id`. The parity harness (`s16-parity-people.mjs`) validates `Person.Id` against the expected SP `Id` for each mirror record — insertion order must match the table below exactly.

> **Date entry:** SP date pickers accept dates by clicking. Enter dates as shown (YYYY-MM-DD). SP stores them as UTC midnight ISO strings internally; the mapper normalises them to date-only strings.

> **IsActive:** Leave the checkbox **checked (Yes)** for all 10 mirror records. The service-layer `$filter=IsActive eq 1` must return all of them.

---

### Mirror Records (SP IDs 1–10)

Enter these 10 records in order via the SP list **+ New item** form.

**Record 1 (SP Id 1)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0001` |
| FullName | `Abdulaziz Alabdullatif` |
| IGN | `Kakarot` |
| Nationality | `Saudi Arabia` |
| PrimaryRole | `Player` |
| PersonnelCode | `FN/PL/001` |
| CurrentTeam | `GKE Fortnite` |
| CurrentGameTitle | `Fortnite` |
| PrimaryDepartment | `Esports` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-01-10` |
| LatestContractDate | `2026-06-21` |
| TotalContracts | `2` |
| Notes | *(leave blank)* |

**Record 2 (SP Id 2)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0003` |
| FullName | `Diab Hassan` |
| IGN | `Diab` |
| Nationality | `Morocco` |
| PrimaryRole | `Graphic Designer` |
| PersonnelCode | `CR/GD/002` |
| CurrentTeam | `Creative` |
| CurrentGameTitle | *(leave blank)* |
| PrimaryDepartment | `Creative` |
| IsActive | ✓ Yes |
| FirstContractDate | `2025-09-01` |
| LatestContractDate | `2025-09-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 3 (SP Id 3)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0002` |
| FullName | `Mohammad Alkhalailah` |
| IGN | `Klownz` |
| Nationality | `Jordan` |
| PrimaryRole | `Player Operations Manager` |
| PersonnelCode | `OP/OP/001` |
| CurrentTeam | `Operations` |
| CurrentGameTitle | *(leave blank)* |
| PrimaryDepartment | `Operations` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-02-15` |
| LatestContractDate | `2026-06-21` |
| TotalContracts | `2` |
| Notes | *(leave blank)* |

**Record 4 (SP Id 4)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0004` |
| FullName | `Elaf Hussein` |
| IGN | `Elaf` |
| Nationality | `Morocco` |
| PrimaryRole | `Performance Analyst` |
| PersonnelCode | `PG/AN/001` |
| CurrentTeam | `GKA PUBG` |
| CurrentGameTitle | `PUBG Mobile` |
| PrimaryDepartment | `Esports` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-01-15` |
| LatestContractDate | `2026-01-15` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 5 (SP Id 5)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0005` |
| FullName | `Bechir Mettali` |
| IGN | `Boch` |
| Nationality | `Tunisia` |
| PrimaryRole | `Performance Analyst` |
| PersonnelCode | `LL/AN/002` |
| CurrentTeam | `GKA League of Legends` |
| CurrentGameTitle | `League of Legends` |
| PrimaryDepartment | `Esports` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-03-01` |
| LatestContractDate | `2026-03-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 6 (SP Id 6)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0006` |
| FullName | `Sari Al-Khatib` |
| IGN | `Sari` |
| Nationality | `Jordan` |
| PrimaryRole | `Graphic Designer` |
| PersonnelCode | `CR/GD/001` |
| CurrentTeam | `Creative` |
| CurrentGameTitle | *(leave blank)* |
| PrimaryDepartment | `Creative` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-02-01` |
| LatestContractDate | `2026-02-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 7 (SP Id 7)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0007` |
| FullName | `Nadia Khoury` |
| IGN | `Nadia` |
| Nationality | `Lebanon` |
| PrimaryRole | `Video Editor` |
| PersonnelCode | `CR/VE/003` |
| CurrentTeam | `Creative` |
| CurrentGameTitle | *(leave blank)* |
| PrimaryDepartment | `Creative` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-02-01` |
| LatestContractDate | `2026-02-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 8 (SP Id 8)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0008` |
| FullName | `Keon Williams` |
| IGN | `Keon` |
| Nationality | `United States` |
| PrimaryRole | `Player` |
| PersonnelCode | `AL/PL/001` |
| CurrentTeam | `GKA Apex Legends` |
| CurrentGameTitle | `Apex Legends` |
| PrimaryDepartment | `Esports` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-04-01` |
| LatestContractDate | `2026-04-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 9 (SP Id 9)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0009` |
| FullName | `Jamison Moore` |
| IGN | `Jxmo` |
| Nationality | `United States` |
| PrimaryRole | `Head Coach` |
| PersonnelCode | `AL/CH/001` |
| CurrentTeam | `GKA Apex Legends` |
| CurrentGameTitle | `Apex Legends` |
| PrimaryDepartment | `Esports` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-04-01` |
| LatestContractDate | `2026-04-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

**Record 10 (SP Id 10)**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-0010` |
| FullName | `Tyler Johnson` |
| IGN | `Phantom` |
| Nationality | `United States` |
| PrimaryRole | `Player` |
| PersonnelCode | `AL/PL/002` |
| CurrentTeam | `GKA Apex Legends` |
| CurrentGameTitle | `Apex Legends` |
| PrimaryDepartment | `Esports` |
| IsActive | ✓ Yes |
| FirstContractDate | `2026-04-01` |
| LatestContractDate | `2026-04-01` |
| TotalContracts | `1` |
| Notes | *(leave blank)* |

---

### Stress Records (SP IDs 11–13)

These records exercise mapper hard rejects and the inactive-person service-layer filter. Some require REST API injection because SP enforces Required constraints that prevent blank entry via the UI.

---

#### Stress Record 11 (SP Id 11) — Blank Title / Missing PersonID

**Expected outcome:** Mapper hard-rejects this record. It must NOT appear in `listPeople()` output. Console: `[C3/People] Item 11: missing PersonID (blank Title) — record rejected`

> ⚠️ **Requires REST API injection.** The SP UI enforces `Title` as required and will not save a record with blank Title. Use the browser DevTools on a C3 SharePoint site page:

```javascript
const digestResp = await fetch(
  'https://geekaygames.sharepoint.com/sites/C3/_api/contextinfo',
  { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata' } }
);
const digest = (await digestResp.json()).FormDigestValue;

const resp = await fetch(
  "https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3People')/items",
  {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
      'X-RequestDigest': digest,
    },
    body: JSON.stringify({
      Title: '',
      FullName: 'Missing PersonID',
      IsActive: true,
      Notes: 'stress: hard reject — blank Title',
    }),
  }
);
console.log(resp.status, await resp.json());
```

> SP may reject this with HTTP 400 if it enforces Title server-side. If so, document `"SP enforces non-blank Title via API"` and skip this stress record. The parity harness has already validated the blank-Title rejection path locally (220/220 passed). The live run of this specific path is informational, not a hard gate.

---

#### Stress Record 12 (SP Id 12) — Inactive Person

**Expected outcome:** Person is excluded from `listPeople()` output (service filter `$filter=IsActive eq 1`). If fetched directly via `getPerson('PER-9999')`, the mapper would map it through with `IsActive: false` — the mapper does not reject inactive records, only the service-layer filter excludes them from list queries.

**Enter via SP list UI:**

| Field | Value |
|---|---|
| Title (PersonID) | `PER-9999` |
| FullName | `Inactive Test Person` |
| IGN | *(leave blank)* |
| Nationality | *(leave blank)* |
| PrimaryRole | *(leave blank)* |
| PersonnelCode | *(leave blank)* |
| CurrentTeam | *(leave blank)* |
| CurrentGameTitle | *(leave blank)* |
| PrimaryDepartment | *(leave blank)* |
| IsActive | ☐ No (**uncheck** the checkbox) |
| FirstContractDate | *(leave blank)* |
| LatestContractDate | *(leave blank)* |
| TotalContracts | *(leave blank)* |
| Notes | `stress: inactive — must not appear in listPeople output` |

**Validation:** After entering, the `listPeople()` response must show 10 records (SP IDs 1–10, all active) — not 11. PER-9999 must be absent.

---

#### Stress Record 13 (SP Id 13) — Blank FullName / Missing FullName

**Expected outcome:** Mapper hard-rejects this record. It must NOT appear in `listPeople()` output. Console: `[C3/People] Item 13 (PER-INVALID): missing FullName — record rejected. FullName is a required column in C3People; check SP list for data entry errors.`

> ⚠️ **Requires REST API injection.** The SP UI enforces `FullName` as required. Use DevTools on the C3 site (reuse the digest from Stress Record 11 if still valid, or re-fetch):

```javascript
const resp = await fetch(
  "https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3People')/items",
  {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
      'X-RequestDigest': digest,  // reuse from above
    },
    body: JSON.stringify({
      Title: 'PER-INVALID',
      FullName: '',
      IsActive: true,
      Notes: 'stress: hard reject — blank FullName',
    }),
  }
);
console.log(resp.status, await resp.json());
```

> Same caveat as Stress Record 11: SP may reject blank required fields via API. Document the result and treat local parity harness as the authoritative validation for this path if SP rejects the POST.

---

### Stress Records Summary

| SP Id | Title (PersonID) | FullName | IsActive | Entry method | Expected mapper result | Expected console |
|---|---|---|---|---|---|---|
| 11 | *(blank)* | `Missing PersonID` | Yes | REST API | Hard reject | `[C3/People] Item 11: missing PersonID (blank Title) — record rejected` |
| 12 | `PER-9999` | `Inactive Test Person` | **No** | UI | Not returned by `listPeople()` (service filter) | No mapper message — excluded before mapper by `$filter=IsActive eq 1` |
| 13 | `PER-INVALID` | *(blank)* | Yes | REST API | Hard reject | `[C3/People] Item 13 (PER-INVALID): missing FullName — record rejected.` |

**Expected aggregate result after entering all records (assuming REST stress records succeed):**
```
[C3/People] listPeople: fetched 11 SP records. Mapped: 10. Rejected: 1. Warnings: 0.
```

- Fetched 11: SP Ids 1–10 (active mirror) + SP Id 13 (PER-INVALID, IsActive=Yes). SP Id 11 would be here if the blank-Title POST succeeded; SP Id 12 (PER-9999, IsActive=No) is excluded by the `IsActive eq 1` filter before the mapper runs.
- Mapped 10: all active mirror records
- Rejected 1: PER-INVALID (blank FullName)
- Warnings 0: no soft errors in the clean mirror set

> If Stress Records 11 or 13 could not be injected via REST (SP rejected the POST), the expected result becomes `fetched 10 SP records. Mapped: 10. Rejected: 0. Warnings: 0.` — document which stress records were skipped.

---

### Optional Advanced Stress (REST-only, not required for sprint gate)

The local parity harness tests these paths with inlined mapper logic (Items 14–16 in `s16-parity-people.mjs`). If desired, exercise them against live SP as well. These are informational only — they do not block S16 close.

| Item | Title | What to inject | Expected result |
|---|---|---|---|
| 14 | `PER-S14` | `FirstContractDate: 'not-a-date'` | Warn: `[C3/People] Item 14.FirstContractDate: invalid date "not-a-date" — treated as absent (non-expiring)` |
| 15 | `PER-S15` | `TotalContracts: 'corrupt'` (string via REST) | Warn: `[C3/People] Item 15.TotalContracts: non-numeric value "corrupt" — treated as unknown.` |
| 16 | `PER-S16` | `IsActive: 'maybe'` (string, not boolean) | Warn: `[C3/People] Item 16.IsActive: unknown value "maybe" — defaulting to false (inactive).` |

> SP may coerce or reject these via the REST API. Document the actual SP behaviour (coercion, rejection, or storage). The local harness is the authoritative pass record for these paths regardless of SP behaviour.

---

## Section 4 — Live Validation Runbook

### 4.1 — Prerequisites checklist

Confirm all of the following before starting:

- [ ] All 14 columns created with correct internal names and types
- [ ] `CurrentTeam`, `CurrentGameTitle`, `PrimaryDepartment` confirmed as plain text columns — **not Lookup columns**
- [ ] `IsActive` default = Yes
- [ ] Indexes added: `IsActive`, `FullName`, `PersonnelCode`
- [ ] 10 mirror records entered in order (SP Ids 1–10)
- [ ] Stress Record 12 (PER-9999, IsActive=No) entered via UI
- [ ] Stress Records 11 and 13 attempted via REST; result documented
- [ ] Default view and `Inactive Persons` view configured
- [ ] C3Credentials list from S15 is still intact and accessible
- [ ] Development machine: repo cloned at `C:\Projects\c3-platform`, Node.js available
- [ ] `packages/c3-spfx-host`: run `npm install` if not done since last pull

---

### 4.2 — Start the hosted workbench

```
cd C:\Projects\c3-platform\packages\c3-spfx-host
npx heft start --clean
```

or

```
npm run start
```

Navigate to the **SharePoint-hosted workbench** (not the localhost workbench):

```
https://geekaygames.sharepoint.com/sites/C3/_layouts/15/workbench.aspx
```

Sign in if prompted. Add the **C3Host** web part to the canvas.

---

### 4.3 — Confirm mock mode baseline first

Before switching to SP mode, verify the app works in mock mode:

- People Workspace loads with the 10 mock persons
- No console errors
- `[C3/Credential]` and `[C3/People]` prefixes are absent (mock mode does not call SP)

**Pass condition:** Mock mode renders cleanly with no JS errors.

---

### 4.4 — Switch to SharePoint mode

1. Open the web part property pane (pencil / edit icon)
2. Change **Data source mode** to `SharePoint (live data)`
3. Web part re-renders

Open **DevTools (F12) → Console** and **Network tab → Fetch/XHR filter** before switching so requests are captured from the moment of the switch.

---

### 4.5 — Network checks

#### Expected requests after switching to SP mode

| Service | Expected URL pattern | Expected status |
|---|---|---|
| `listPeople` | `.../_api/web/lists/getbytitle('C3People')/items?$select=Id,Title,FullName,...&$filter=IsActive eq 1&$top=2000` | **200 OK** |
| `listAllCredentials` | `.../_api/web/lists/getbytitle('C3Credentials')/items?$select=ID,Title,...&$filter=IsActive eq 1&$top=2000` | **200 OK** |
| `listCredentialsForPerson` | Same C3Credentials base URL with `&$filter=IsActive eq 1 and HolderPersonID eq 'PER-NNNN'` | **200 OK** |

#### C3People request — what to check in the response

In the Network tab, click the `C3People` request → Preview or Response:

- `value` array is present
- Array length: 10 (active mirror records only — PER-9999 excluded by filter; stress hard-reject records may or may not be present depending on REST injection success)
- First item has `Title` = `"PER-0001"` and separate `FullName` field (not the same field)
- `CurrentTeam`, `CurrentGameTitle`, `PrimaryDepartment` are plain strings — if they appear as objects with `Id` and `Value` properties, the columns were inadvertently created as Lookups and must be recreated as plain text

#### Troubleshooting by HTTP status

| Status | Cause | Action |
|---|---|---|
| 401 | Not authenticated | Sign into SP; reload workbench |
| 403 | Insufficient permissions on C3People | Check site member permissions for the account |
| 404 | List internal name mismatch | Go to List Settings → check URL for internal name; must be exactly `C3People` |
| 200, `value: []` | Filter excludes all records | Confirm IsActive is checked (Yes) on all mirror records; confirm `IsActive` column is Yes/No type |
| 200, value array has SP Lookup objects for CurrentTeam | Columns created as Lookup | Delete and recreate as Single line of text |

---

### 4.6 — Console checks

#### Expected People console output (clean 10-record run)

```
[C3/People] listPeople: fetched 10 SP records. Mapped: 10. Rejected: 0. Warnings: 0.
```

If Stress Record 13 (PER-INVALID, blank FullName) was successfully injected and is returned by the filter (IsActive=Yes):
```
[C3/People] Item 13 (PER-INVALID): missing FullName — record rejected. FullName is a required column in C3People...
[C3/People] listPeople: fetched 11 SP records. Mapped: 10. Rejected: 1. Warnings: 0.
```

#### Expected Credential console output (S15 unchanged)

```
[C3/Credential] Item N: missing HolderPersonID — record rejected
[C3/Credential] Item N: unknown CredentialType "Work Permit" — mapped to Other...
[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.
```

#### Diagnostic prefix check — critical for S16

**Both prefixes must appear separately and correctly:**

| Prefix | Source | Expected to appear |
|---|---|---|
| `[C3/People]` | `spPersonMapper.ts` and `SharePointPersonService.ts` | Yes |
| `[C3/Credential]` | `spCredentialMapper.ts` and `SharePointCredentialService.ts` | Yes |

**Must NOT appear:**
- `[C3/Credential]` on any message about a person's date field (e.g. `FirstContractDate`, `LatestContractDate`)
- `[C3/People]` on any message about a credential field (e.g. `ExpiryDate`, `IssuedDate`)

This cross-contamination was the bug fixed in S16-5 by adding the `prefix` parameter to `normalizeSpDate`. If it reappears in the live run, a regression has occurred.

#### Console warnings that indicate problems (not expected)

| Message | Cause | Action |
|---|---|---|
| `[C3/Credential] Item N.FirstContractDate: ...` | Prefix regression — People date warning using Credential prefix | Check `spPersonMapper.ts` passes `'[C3/People]'` as 4th arg to `normalizeSpDate` |
| `[C3/People] Network error reaching SharePoint` | Fetch failed before the request was sent | Check CORS, auth, and site URL in `AppConfig` |
| `[C3/People] SharePoint returned HTTP 403` | Permissions | Check list permissions |
| `[C3/People] response is missing the "value" array` | Unexpected SP response shape | Check `$select` includes `Id` (capital I) — SP OData is case-sensitive |

---

### 4.7 — Functional checks in the C3 UI

#### Check A — People Workspace populated from live SP data

After switching to SP mode, navigate to **People Workspace**:

- 10 persons appear (the 10 active mirror records)
- Person names match the mirror record data exactly
- PER-9999 (Inactive Test Person) does NOT appear

**Pass condition:** 10 people visible. No PER-9999. Names match SP records.

> **S16 scope note:** This is the key difference from S15, where People showed 0 in SP mode. In S16, `SharePointPersonService.listPeople()` is fully implemented and must return real data here.

#### Check B — Person Profile opens for a live SP person

Click on one of the people (e.g. `Abdulaziz Alabdullatif`, PersonID `PER-0001`):

- Person Profile opens
- PersonID, FullName, IGN, Nationality, PrimaryRole, CurrentTeam, PrimaryDepartment display correctly
- Credential tab shows CRED-0001, CRED-0002, CRED-0003 (fetched from `C3Credentials` via `listCredentialsForPerson('PER-0001')`)
- Dates display as `2026-01-10` (date-only, not full ISO) — confirming `normalizeSpDate` is running correctly with the `[C3/People]` prefix

**Pass condition:** Profile opens. Fields match SP record 1. Credentials load from SP. Dates are date-only strings.

#### Check C — Credential data unaffected (S15 regression check)

Confirm the credential fetch is not broken by S16 changes:

- A `C3Credentials` network request fires (HTTP 200)
- `[C3/Credential]` aggregate log appears in console
- Person profiles show credential records from `C3Credentials`

**Pass condition:** Credential diagnostics appear with `[C3/Credential]` prefix. No regression from S16 changes.

#### Check D — No crash on navigation

Navigate through: **Command Center → People → Person Profile → Contracts → Situation Room**

- No React error boundaries triggered
- No blank white screens
- No unhandled JS exceptions in the console
- `listPersonContracts` and `listPersonActivities` stub warnings may appear in the console — these are expected and are not S16 blockers

**Pass condition:** All screens navigable without crashes.

#### Check E — Mock mode still works (regression)

Switch back to Mock mode via the property pane:

- People Workspace shows mock persons
- No SP requests fire (check Network tab)
- No `[C3/People]` or `[C3/Credential]` SP console logs appear

**Pass condition:** Mock mode renders cleanly after returning from SP mode. No mode-switching artefacts.

---

### 4.8 — Evidence to capture

For each of the following, take a screenshot or copy-paste the console output into a validation log:

1. **Network request for `C3People`:** URL, HTTP status, response `value` array length
2. **Network request for `C3Credentials`:** URL, HTTP status (S15 regression confirmation)
3. **Console — People aggregate log:** The `[C3/People] listPeople: fetched N SP records...` line
4. **Console — Credential aggregate log:** The `[C3/Credential] listAllCredentials: fetched N SP records...` line
5. **Console — prefix check:** Confirm no cross-contamination between `[C3/People]` and `[C3/Credential]`
6. **People Workspace screenshot:** Showing 10 live SP persons
7. **Person Profile screenshot:** PER-0001 open, fields visible
8. **Stress Record 11 REST result:** HTTP status (expected 201 or 400) — document which
9. **Stress Record 13 REST result:** HTTP status — document which
10. **Any unexpected mapper warnings or rejections:** Copy exact console text

---

## Section 5 — S16 People Validation Gates

All gates must pass before S16 People integration is considered complete.

### Hard gates (must pass)

| Gate | Pass condition |
|---|---|
| Network: C3People GET | HTTP 200, `value` array with 10 active records |
| Network: C3Credentials GET | HTTP 200 (S15 regression — must remain unbroken) |
| Console: People aggregate | `[C3/People] listPeople: fetched 10 SP records. Mapped: 10. Rejected: 0. Warnings: 0.` (or 11 fetched / 1 rejected if Stress 13 was injected) |
| Console: Credential aggregate | `[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.` |
| Console: prefix isolation | `[C3/People]` and `[C3/Credential]` appear separately; no cross-contamination |
| People Workspace | 10 persons populated from live SP data; PER-9999 absent |
| Person Profile | Opens for a live SP person; fields match SP record; dates are YYYY-MM-DD |
| Credentials in Profile | C3Credentials data appears in Person Profile credential tab |
| No crash | All screens navigable in SP mode without exceptions or error boundaries |
| Mock mode regression | Switching back to mock mode works; SP requests stop |

### Document (not blocking but required before close)

- [ ] Console output from live run captured (screenshot or copy-paste)
- [ ] Network request URL and response count for `C3People` confirmed
- [ ] REST injection results for Stress Records 11 and 13 documented (success or SP-rejected)
- [ ] Any unexpected mapper warnings noted with exact console text
- [ ] `C3 Architecture Baseline — Sprint 16.md` updated with live validation results

### Must NOT be present at close

- [ ] No `[C3/Credential]` prefix on People date warnings
- [ ] No Lookup column objects (`{ Id, Value }`) in `CurrentTeam`, `CurrentGameTitle`, or `PrimaryDepartment` fields
- [ ] No crash in SP mode or on mode switch
- [ ] No TypeScript errors (confirmed before this runbook: `tsc --noEmit` clean)

### Setup risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| IT provisions `CurrentTeam` as a SP Lookup column | Medium | Include explicit "NOT a Lookup column" warning in handover email; verify via REST response shape before validating UI |
| IT sets FullName as Not Required | Low | Stress Record 13 path will not be testable via UI or REST; check column settings before data entry |
| SP rejects blank Title and blank FullName via REST API | Medium | Local parity harness (220/220) is the authoritative validation for these paths; document SP behaviour and move on |
| Title column renamed by IT (breaks internal name) | Low | Internal name `Title` cannot be changed after creation — only display name can be renamed. Verify via List Settings URL that internal name remains `Title` |
| `IsActive` default not set to Yes | Medium | New records entered without an explicit IsActive value will default to false, excluded from `listPeople()`, appearing as data errors. Confirm default = Yes before test data entry |
| S15 C3Credentials list permissions changed | Low | Test credential fetch (Check C) as part of this runbook — catch any S15 regressions early |

---

*This runbook is the authoritative guide for S16 People live validation. When all hard gates in Section 5 pass and evidence is captured, S16 People integration is confirmed.*
