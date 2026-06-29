# S15 Live Validation Runbook
**C3 Contract Control Center — Sprint 15**
**Date:** 2026-06-29
**Status:** READY FOR EXECUTION
**Prerequisite:** `C3Credentials` list exists at `https://geekaygames.sharepoint.com/sites/C3`

> **Runtime mode note (confirmed 2026-06-29):** When `dataSourceMode = 'sharepoint'`, the app switches ALL domains to the SP service registry — not credentials only. `useCredentialService` is the sole exception (independently wired in S15-3). All other services (`people`, `contracts`, `journeys`, etc.) route through `createSharePointSPService` → `createSharePointServiceRegistry`, where non-credential services are graceful stubs returning empty arrays. As a result, People Workspace shows 0 people in SP mode, and gap computation cannot run (no people to compute gaps for). **S15 live validation is therefore scoped to service-layer proof only** — fetch, mapping, and console diagnostics. Full UI integration (Person Profile → SP credentials → gap engine → Situation Room) is deferred to Sprint 16 when `SharePointPersonService` is implemented. This is not a regression; the architecture is working as designed.

---

## Section 1 — Column Creation Checklist

Create each column exactly as specified. Column **internal names are permanent** — they are set at creation time from the first name you type. If you make a mistake, delete the column and recreate it.

**Workflow:** For each column, click **+ Add column** in the list → choose the type → type the internal name first → save → only then change the display name if different.

> The `Title` column already exists on every SP list. It is repurposed as CredentialID — only rename its display label; do not delete it.

---

### Column 1 — Title (CredentialID)

| Property | Value |
|---|---|
| Internal name | `Title` (built-in — already exists, cannot be changed) |
| Display name | Rename to: **Credential ID** |
| SP column type | Single line of text (built-in) |
| Required | Yes |
| Default value | None |
| Notes | Stores the application-layer credential identifier, e.g. `CRED-0001`. The mapper falls back to `CRED-{SP_ID}` if blank, but all records in the test dataset must have this populated. |

---

### Column 2 — HolderPersonID

| Property | Value |
|---|---|
| Internal name | `HolderPersonID` |
| Display name | Holder Person ID |
| SP column type | Single line of text |
| Required | No (enforced by mapper, not by SP) |
| Default value | None |
| Max characters | 255 |
| Notes | Stores the application-layer PersonID, e.g. `PER-0001`. **Not a SP Lookup column** — plain text. Missing or blank → mapper hard-rejects the record. Must exactly match the PersonID values in C3People when that list is created. |

---

### Column 3 — CredentialType

| Property | Value |
|---|---|
| Internal name | `CredentialType` |
| Display name | Credential Type |
| SP column type | Choice |
| Required | Yes |
| Allow fill-in | **No** (enforced choices only — except during stress record entry, see Section 3) |
| Default value | None |
| Choice values (enter exactly, one per line) | `Passport` |
| | `NationalID` |
| | `EmiratesID` |
| | `Iqama` |
| | `ResidencePermit` |
| | `DriversLicense` |
| | `Visa` |
| | `EntryPermit` |
| | `WorkPermit` |
| | `LabourCard` |
| | `LeagueRegistration` |
| | `FederationLicense` |
| | `TransferClearance` |
| | `InsuranceCard` |
| | `MedicalClearance` |
| | `BankAccount` |
| | `TaxNumber` |
| | `Other` |
| Notes | **18 values total.** These must match the TypeScript `CredentialType` union exactly — case-sensitive, no spaces within values. `Work Permit` (with space) is intentionally NOT in this list; it is used in stress record 9 to test the unknown-type mapper path. See Section 3 for how to enter stress record 9. |

---

### Column 4 — ReferenceNumber

| Property | Value |
|---|---|
| Internal name | `ReferenceNumber` |
| Display name | Reference Number |
| SP column type | Single line of text |
| Required | No |
| Default value | None |
| Notes | Passport number, visa number, Emirates ID number, etc. The mapper returns `''` (empty string) if null. |

---

### Column 5 — IssuedBy

| Property | Value |
|---|---|
| Internal name | `IssuedBy` |
| Display name | Issued By |
| SP column type | Single line of text |
| Required | No |
| Default value | None |
| Notes | Name of the issuing authority. e.g. `Kingdom of Saudi Arabia`. |

---

### Column 6 — IssuedDate

| Property | Value |
|---|---|
| Internal name | `IssuedDate` |
| Display name | Issued Date |
| SP column type | Date and Time |
| Date only | Yes (no time component) |
| Required | No |
| Default value | None |
| Notes | SP REST returns `"2022-03-15T00:00:00Z"` for Date-only columns. The mapper parses this correctly and normalises to `"2022-03-15"`. |

---

### Column 7 — ExpiryDate

| Property | Value |
|---|---|
| Internal name | `ExpiryDate` |
| Display name | Expiry Date |
| SP column type | Date and Time |
| Date only | Yes (no time component) |
| Required | No |
| Default value | None |
| Notes | Invalid or missing → mapper returns `undefined` (treated as non-expiring). Stress record 10 tests this path by injecting `"not-a-date"` via REST API (cannot be entered via UI). |

---

### Column 8 — ValidFromDate

| Property | Value |
|---|---|
| Internal name | `ValidFromDate` |
| Display name | Valid From Date |
| SP column type | Date and Time |
| Date only | Yes |
| Required | No |
| Default value | None |
| Notes | Used for credentials with a distinct validity window separate from the issued date. All test records use `null` for this field. |

---

### Column 9 — SubType

| Property | Value |
|---|---|
| Internal name | `SubType` |
| Display name | Sub-Type |
| SP column type | Single line of text |
| Required | No |
| Default value | None |
| Notes | Free-text qualifier for the credential type. e.g. `Employment Visa` for a `Visa` type credential. Not a Choice column — accepts any string. |

---

### Column 10 — Notes

| Property | Value |
|---|---|
| Internal name | `Notes` |
| Display name | Notes |
| SP column type | Multiple lines of text |
| Rich text | No (plain text only) |
| Required | No |
| Default value | None |
| Notes | Operator-facing notes. The stress records use this field for test labels (e.g. `stress: hard reject`) — that text will be returned by the mapper and is harmless. |

---

### Column 11 — IsActive

| Property | Value |
|---|---|
| Internal name | `IsActive` |
| Display name | Is Active |
| SP column type | Yes/No (checkbox) |
| Required | No |
| Default value | **Yes** |
| Notes | SP REST returns `true` / `false` (boolean). The mapper handles this plus legacy numeric/string forms defensively. All 10 test records set this to Yes (true). The $filter `IsActive eq 1` used by `listAllCredentials` and `listCredentialsForPerson` works with SP Yes/No boolean — SP OData treats `1` as equivalent to `true` for Yes/No columns. |

---

### Column 12 — SupersedesCredentialID

| Property | Value |
|---|---|
| Internal name | `SupersedesCredentialID` |
| Display name | Supersedes Credential ID |
| SP column type | Single line of text |
| Required | No |
| Default value | None |
| Notes | References the `Title` (CredentialID) of the credential this one replaces. e.g. when a passport is renewed, the new record's `SupersedesCredentialID` = the old record's `Title`. All 10 test records leave this blank. |

---

### Column creation summary

| # | Internal name | Type | Required |
|---|---|---|---|
| 1 | `Title` (rename display only) | Single line | Yes |
| 2 | `HolderPersonID` | Single line | No |
| 3 | `CredentialType` | Choice (18 values) | Yes |
| 4 | `ReferenceNumber` | Single line | No |
| 5 | `IssuedBy` | Single line | No |
| 6 | `IssuedDate` | Date only | No |
| 7 | `ExpiryDate` | Date only | No |
| 8 | `ValidFromDate` | Date only | No |
| 9 | `SubType` | Single line | No |
| 10 | `Notes` | Multiple lines | No |
| 11 | `IsActive` | Yes/No | No (default: Yes) |
| 12 | `SupersedesCredentialID` | Single line | No |

**Total: 12 columns** (including repurposed Title). No additional columns beyond this set.

---

## Section 2 — Index Checklist

Indexes are set via **List Settings → Indexed columns → Add a new index**.

| Column | Internal name | Index? | Why |
|---|---|---|---|
| Title | `Title` | Built-in (already indexed by SP) | Primary key lookup; `getCredential` queries `$filter=Title eq '...'` |
| HolderPersonID | `HolderPersonID` | **Yes — add index** | `listCredentialsForPerson` queries `$filter=... and HolderPersonID eq '...'`. Without index, SP scans all rows for every per-person query. Most frequent query in the Situation Room (one call per person). |
| IsActive | `IsActive` | **Yes — add index** | Every read query filters `IsActive eq 1`. Index prevents full-table scan. Especially important once real credentials accumulate (multiple records per person per year). |
| CredentialType | `CredentialType` | No — defer | Not used in a standalone filter; always combined with IsActive and/or HolderPersonID. The compound filter benefits from the two indexed columns above. Add later if query performance degrades. |

**Action:** After all 12 columns are created and before entering any records, go to **List Settings → Indexed columns** and add single-column indexes for `HolderPersonID` and `IsActive`.

---

## Section 3 — Test Records

Enter all 10 records in the order shown. Records 1–7 are mirror records (clean, should map without any warnings). Records 8–10 are stress records testing specific mapper paths.

> **Date entry:** SP date pickers accept dates by clicking. Enter dates as shown. SP stores them as UTC midnight ISO strings internally — the mapper handles this.

> **IsActive:** For all 10 records, leave the checkbox **checked** (Yes/true). The $filter=IsActive eq 1 must return all of them; mapper behaviour is tested on the mapped output, not the filter.

---

### Record 1 — CRED-0001

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0001` |
| HolderPersonID | `PER-0001` |
| CredentialType | `Passport` |
| ReferenceNumber | `SA-G123456` |
| IssuedBy | `Kingdom of Saudi Arabia` |
| IssuedDate | `2022-03-15` |
| ExpiryDate | `2032-03-14` |
| ValidFromDate | *(leave blank)* |
| SubType | *(leave blank)* |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

---

### Record 2 — CRED-0002

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0002` |
| HolderPersonID | `PER-0001` |
| CredentialType | `Visa` |
| ReferenceNumber | `UAE-VISA-889901` |
| IssuedBy | `UAE General Directorate of Residency` |
| IssuedDate | `2025-07-10` |
| ExpiryDate | `2026-07-09` |
| ValidFromDate | *(leave blank)* |
| SubType | `Employment Visa` |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

> Note: This credential expires 2026-07-09 — approximately 10 days from today (2026-06-29). It will render as an expiry warning (red) in the C3 UI. This is intentional and is the expected state.

---

### Record 3 — CRED-0003

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0003` |
| HolderPersonID | `PER-0001` |
| CredentialType | `EmiratesID` |
| ReferenceNumber | `784-1990-1234567-1` |
| IssuedBy | `UAE Federal Authority for Identity` |
| IssuedDate | `2025-07-10` |
| ExpiryDate | `2027-07-09` |
| ValidFromDate | *(leave blank)* |
| SubType | *(leave blank)* |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

---

### Record 4 — CRED-0004

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0004` |
| HolderPersonID | `PER-0002` |
| CredentialType | `Passport` |
| ReferenceNumber | `JO-P456789` |
| IssuedBy | `Hashemite Kingdom of Jordan` |
| IssuedDate | `2021-11-01` |
| ExpiryDate | `2031-10-31` |
| ValidFromDate | *(leave blank)* |
| SubType | *(leave blank)* |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

---

### Record 5 — CRED-0005

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0005` |
| HolderPersonID | `PER-0003` |
| CredentialType | `Passport` |
| ReferenceNumber | `MA-AB789012` |
| IssuedBy | `Kingdom of Morocco` |
| IssuedDate | `2023-05-20` |
| ExpiryDate | `2033-05-19` |
| ValidFromDate | *(leave blank)* |
| SubType | *(leave blank)* |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

---

### Record 6 — CRED-0006

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0006` |
| HolderPersonID | `PER-0003` |
| CredentialType | `Visa` |
| ReferenceNumber | `UAE-VISA-556677` |
| IssuedBy | `UAE General Directorate of Residency` |
| IssuedDate | `2025-09-01` |
| ExpiryDate | `2027-08-31` |
| ValidFromDate | *(leave blank)* |
| SubType | `Employment Visa` |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

---

### Record 7 — CRED-0007

**Expected outcome: Maps cleanly. No warnings. No rejection.**

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0007` |
| HolderPersonID | `PER-0003` |
| CredentialType | `EmiratesID` |
| ReferenceNumber | `784-1995-7654321-3` |
| IssuedBy | `UAE Federal Authority for Identity` |
| IssuedDate | `2025-09-01` |
| ExpiryDate | `2027-08-31` |
| ValidFromDate | *(leave blank)* |
| SubType | *(leave blank)* |
| Notes | *(leave blank)* |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

---

### Record 8 — CRED-0008 (Stress — Hard Reject)

**Expected outcome: Mapper rejects this record. It must NOT appear in the mapped output. Console will log: `[C3/Credential] Item N: missing HolderPersonID — record rejected`.**

Enter via the normal list UI.

| Field | Value to enter |
|---|---|
| Title (Credential ID) | `CRED-0008` |
| HolderPersonID | *(leave blank — intentionally empty)* |
| CredentialType | `Passport` |
| ReferenceNumber | *(leave blank)* |
| IssuedBy | *(leave blank)* |
| IssuedDate | *(leave blank)* |
| ExpiryDate | *(leave blank)* |
| ValidFromDate | *(leave blank)* |
| SubType | *(leave blank)* |
| Notes | `stress: hard reject` |
| IsActive | ✓ Yes |
| SupersedesCredentialID | *(leave blank)* |

> The SP `CredentialType` column is Required — you must select a value. `Passport` is used here as a placeholder. The mapper never reaches the type field for this record because it rejects first on missing HolderPersonID.

---

### Record 9 — CRED-0009 (Stress — Unknown CredentialType)

**Expected outcome: Mapper accepts the record but warns. `Type` is mapped to `'Other'`. Console will log: `[C3/Credential] Item N: unknown CredentialType "Work Permit" — mapped to Other.`**

> ⚠️ **This record requires a special entry method.** The value `Work Permit` (with a space) is intentionally not in the choice list. The SP UI Choice picker will not let you select it.

**Preferred method — Temporary fill-in:**
1. Go to **List Settings → CredentialType column → Edit**
2. Enable **"Allow 'Fill-in' choices"** → Save
3. Add the record via the normal UI new-item form — the CredentialType field will now show a text input alongside the dropdown; type `Work Permit` (with a space) there
4. Save the item
5. Return to column settings and **disable "Allow fill-in"** again — the stored value on the item is not affected

**Fallback — REST API via browser DevTools:**
Only use this if the fill-in method is unavailable or behaves unexpectedly. Note: SP's Choice column may reject an out-of-list value via REST even with fill-in disabled, depending on tenant configuration. If the REST POST returns a 400 or the `CredentialType` value is not stored as `Work Permit`, document the failure and proceed — the stress test purpose is to exercise the mapper's unknown-type path, and the test is still valid if the REST path is used.

```javascript
const digestResp = await fetch(
  'https://geekaygames.sharepoint.com/sites/C3/_api/contextinfo',
  { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata' } }
);
const digest = (await digestResp.json()).FormDigestValue;

const resp = await fetch(
  "https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3Credentials')/items",
  {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
      'X-RequestDigest': digest,
    },
    body: JSON.stringify({
      Title: 'CRED-0009',
      HolderPersonID: 'PER-0001',
      CredentialType: 'Work Permit',
      ReferenceNumber: '',
      Notes: 'stress: unknown type',
      IsActive: true,
    }),
  }
);
console.log(resp.status, await resp.json());
```

> Run on the C3 SharePoint site page so same-origin auth applies.

---

### Record 10 — CRED-0010 (Stress — Invalid ExpiryDate)

**Expected outcome: Mapper accepts the record with a warning. `ExpiryDate` maps to `undefined` (not null, not a sentinel date). Console will log: `[C3/Credential] Item N.ExpiryDate: invalid date "not-a-date" — treated as absent (non-expiring)`.**

> ⚠️ **This record requires REST API entry.** The SP date picker rejects non-date strings. There is no UI workaround.

Open DevTools on the C3 SharePoint site and run:

```javascript
// Reuse the digest obtained in Record 9 above (valid for ~30 minutes), or re-fetch:
const digestResp = await fetch(
  'https://geekaygames.sharepoint.com/sites/C3/_api/contextinfo',
  { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata' } }
);
const digest = (await digestResp.json()).FormDigestValue;

// POST with invalid ExpiryDate string
const resp = await fetch(
  "https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3Credentials')/items",
  {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
      'X-RequestDigest': digest,
    },
    body: JSON.stringify({
      Title: 'CRED-0010',
      HolderPersonID: 'PER-0001',
      CredentialType: 'LeagueRegistration',
      ReferenceNumber: '',
      Notes: 'stress: invalid expiry',
      IsActive: true,
      ExpiryDate: 'not-a-date',
    }),
  }
);
console.log(resp.status, await resp.json());
```

> **Important:** SP may reject the POST entirely rather than store or sanitise the invalid date string. Three possible outcomes — document whichever one occurs:
> - **POST returns 201, `ExpiryDate` stored as `"not-a-date"`** → mapper warning fires as expected. Full stress-path verified.
> - **POST returns 201, `ExpiryDate` stored as `null` or a real date** → SP sanitised the value. Warning will not fire on the invalid-string path, but the mapper's null/undefined handling is still exercised. Note "SP sanitised invalid date" in the evidence log.
> - **POST returns 4xx (rejected entirely)** → Do not retry. Document the failure and skip Record 10 from the record count. Treat the null/blank date path (e.g. leave ExpiryDate blank via the UI) as the live SP-supported case — enter a replacement record with no ExpiryDate and note that the "invalid string" stress path is not testable against this tenant. This does not block Sprint 15 close.

---

### Test records summary

| # | CredentialID | HolderPersonID | CredentialType | Expected mapper result | Expected console |
|---|---|---|---|---|---|
| 1 | CRED-0001 | PER-0001 | Passport | ✓ Mapped clean | Info (aggregate only) |
| 2 | CRED-0002 | PER-0001 | Visa | ✓ Mapped clean | Info (aggregate only) |
| 3 | CRED-0003 | PER-0001 | EmiratesID | ✓ Mapped clean | Info (aggregate only) |
| 4 | CRED-0004 | PER-0002 | Passport | ✓ Mapped clean | Info (aggregate only) |
| 5 | CRED-0005 | PER-0003 | Passport | ✓ Mapped clean | Info (aggregate only) |
| 6 | CRED-0006 | PER-0003 | Visa | ✓ Mapped clean | Info (aggregate only) |
| 7 | CRED-0007 | PER-0003 | EmiratesID | ✓ Mapped clean | Info (aggregate only) |
| 8 | CRED-0008 | *(blank)* | Passport | ✗ Hard rejected | WARN: missing HolderPersonID |
| 9 | CRED-0009 | PER-0001 | `Work Permit` (invalid) | ⚠ Mapped to Other | WARN: unknown CredentialType |
| 10 | CRED-0010 | PER-0001 | LeagueRegistration | ✓ Mapped, ExpiryDate=undefined (absent) | Info (aggregate only) — null date is the silent path |

**Expected batch result after entering all 10:**
`fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.`

> **Live SP finding (confirmed 2026-06-29):** SharePoint rejected the HTTP POST with `ExpiryDate = "not-a-date"` (HTTP 400). CRED-0010 was entered via UI with `ExpiryDate` blank. SP returns `null` for a blank date column. The mapper processes `null → undefined` silently — no `console.warn` fires. Only CRED-0009 (unknown CredentialType "Work Permit") generates a warning. Expected warning count is therefore **1**, not 2.

---

## Section 4 — Live Validation Runbook

### 4.1 — Prerequisites checklist

Before starting the runbook, confirm all of the following:

- [ ] All 12 columns created with exact internal names
- [ ] Indexes added to `HolderPersonID` and `IsActive`
- [ ] All 10 test records entered (7 mirror + 3 stress)
- [ ] List verified: navigate to the C3Credentials list, confirm 10 items appear
- [ ] Development machine: Node.js installed, repo cloned at `C:\Projects\c3-platform`
- [ ] `packages/c3-spfx-host` dependencies installed: run `npm install` in that directory if not done since last pull

---

### 4.2 — Start the local SPFx workbench

The **local workbench** (`gulp serve`) runs the SPFx web part in your browser pointing at the live SharePoint site. No App Catalog deployment needed.

```
cd C:\Projects\c3-platform\packages\c3-spfx-host
npx heft start --clean
```

Or if the npm script is configured:
```
npm run start
```

This opens a browser at:
```
https://geekaygames.sharepoint.com/sites/C3/_layouts/15/workbench.aspx
```

> If the browser opens to `https://localhost:4321/temp/workbench.html` instead, navigate manually to the SharePoint workbench URL above. The local workbench has no real SP auth context; the SharePoint-hosted workbench does.

You may be prompted to sign in to SharePoint. Sign in with the account that has access to the C3 site.

---

### 4.3 — Add the C3 web part to the workbench

1. On the SharePoint-hosted workbench page, click the **+ (Add a new web part)** button
2. Search for `C3` — the web part appears as `C3Host` or the manifest display name
3. Click to add it to the canvas
4. The web part loads. It should display in **mock mode** by default (showing demo data, "Demo mode · Changes are not persisted" banner)

---

### 4.4 — Switch to SharePoint mode

1. Click the **pencil / edit icon** on the web part (top-right of the web part frame) to open the property pane
2. Locate the **"Data source mode"** dropdown
3. Change from `Mock (local / dev)` → `SharePoint (live data)`
4. The property pane closes / the web part re-renders

> The normalization guard in `C3HostWebPart.ts` ensures only the string `'sharepoint'` reaches the runtime — any other value (including empty) defaults to `'mock'`. The dropdown is the safe path.

---

### 4.5 — Confirm `spSiteUrl` is resolving correctly

Open **DevTools (F12) → Console** and look for either:

**Option A — Diagnostics screen:** Navigate to the Diagnostics screen within the C3 app. It should display the resolved `spSiteUrl`. Confirm it shows:
```
https://geekaygames.sharepoint.com/sites/C3
```

**Option B — Console check:** In the Console, run:
```javascript
// The app config is not directly accessible from the console, but you can check
// the network request URL to infer the resolved siteUrl
```
Look at the **Network tab** → filter by `XHR` or `Fetch` → look for a request to:
```
https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3Credentials')/items?...
```
The hostname + site path in the URL is the resolved `spSiteUrl`. If it shows the correct URL, the wiring is working.

**Option C — Console info log:** The mapper logs on every fetch. After the app loads in SP mode, look for:
```
[C3/Credential] listAllCredentials: fetched N SP records. Mapped: N. Rejected: N. Warnings: N.
```
If this appears, the fetch reached SP and returned records.

---

### 4.6 — Console and network checks

Open **DevTools → Network tab** before switching to SP mode. Filter by **Fetch/XHR**.

#### Expected network requests (SP mode)

| Request | Expected URL pattern | Expected status |
|---|---|---|
| listAllCredentials | `.../_api/web/lists/getbytitle('C3Credentials')/items?$select=ID,Title,...&$filter=IsActive eq 1&$top=2000` | **200 OK** |
| listCredentialsForPerson | Same base URL, with `&$filter=IsActive eq 1 and HolderPersonID eq 'PER-NNNN'` | **200 OK** |

#### Expected console output (clean run)

After loading in SP mode with all 10 records in the list:

```
[C3/Credential] Item 8: missing HolderPersonID — record rejected
[C3/Credential] Item N: unknown CredentialType "Work Permit" — mapped to Other. This credential will satisfy no obligations...
[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.

> CRED-0010 (blank ExpiryDate): SP returns `null`. Mapper: `null → undefined`, silent. No warning fires. The invalid-string date warning path is not exercisable against this SP tenant.
```

> The order of individual warn lines and the exact SP item IDs may differ depending on the SP internal IDs assigned (SP auto-increments, not set by us). The aggregate summary line (`fetched 10 SP records...`) is the key pass/fail signal.

#### Console warnings that indicate problems

| Console message | Cause | Action |
|---|---|---|
| `SharePoint returned HTTP 401` | Auth failure — not signed in or insufficient permissions | Sign in to SP; confirm site access |
| `SharePoint returned HTTP 403` | Permissions denied on the list specifically | Check that C3Credentials list is accessible to your account |
| `SharePoint returned HTTP 404` | List name mismatch — SP cannot find `C3Credentials` | Verify the list internal name is exactly `C3Credentials` (List Settings → check the URL, which shows the internal name) |
| `response is missing the "value" array` | OData response shape unexpected | Check that the Accept header `application/json;odata=nometadata` is being sent and accepted |
| `fetched 0 SP records` (no other errors) | List exists but all records have `IsActive = No`, or the filter is excluding all records | Check list — confirm IsActive is checked (Yes) on all records |
| `fetched 10 SP records. Mapped: 10` | Stress record 8 was not rejected — HolderPersonID is not blank in SP | Verify Record 8 was entered with blank HolderPersonID. SP may show it as blank in the UI but store a space — check the raw item via REST: `/_api/web/lists/getbytitle('C3Credentials')/items?$filter=Title eq 'CRED-0008'&$select=Title,HolderPersonID` |

---

### 4.7 — Functional checks in the C3 UI

> **Scope note:** In SP mode, `SharePointPersonService.listPeople()` is a stub returning `[]`. People Workspace will show 0 people. The gap engine has no people to compute gaps for, so the Situation Room and Readiness tab will be empty. Checks B, C, and D from the original plan are **not executable in S15**. They are deferred to Sprint 16 when `SharePointPersonService` is implemented. The checks below are the correct S15 scope.

#### Check A — No crash on SP mode load

Navigate through the main screens: **Command Center, People, Contracts, Situation Room**.

- People Workspace: shows 0 people or an empty state — this is **correct behaviour** (SP stub, not a bug)
- Command Center: may show 0 work queue items (work items derive from people + gaps — both empty in SP mode) — also correct
- Situation Room: empty gap list — correct
- No React error boundaries triggered, no blank white screens, no unhandled JS exceptions in the console

**Pass condition:** App navigates without crashing across all screens in SP mode.

#### Check B — Console: no errors from the credential fetch path

In DevTools → Console, filter for `[C3/Credential]`. Confirm:

- No `console.error` lines from mirror records 1–7 or from the network/parse path
- The expected `console.warn` lines from stress records 8 and 9 are present (these are correct, not failures)
- CRED-0010 (blank ExpiryDate) produces **no warning** — `null → undefined` is the silent path; absence of a warning here is correct
- The aggregate info line appears: `fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.`

**Pass condition:** Zero `console.error` calls from `[C3/Credential]`. Expected `console.warn` calls from stress records confirm the mapper is executing against real SP data.

#### Check C — Network: real SP REST call confirmed

In DevTools → Network → Fetch/XHR, confirm:

- A GET request to `https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3Credentials')/items?$select=...&$filter=IsActive eq 1&$top=2000` was made
- Response status: **200 OK**
- Response body: a JSON object with a `value` array containing the 10 entered records

**Pass condition:** HTTP 200 with a `value` array of 10 SP items. This is the proof that `SharePointCredentialService` is reaching and reading the live `C3Credentials` list.

#### Deferred to Sprint 16 — Full UI integration

The following checks are explicitly deferred. They are not Sprint 15 failures:

- Person Profile → Credentials tab showing real SP credential records (requires `SharePointPersonService.listPeople()`)
- Readiness tab → gap computation driven by real SP credentials (requires People data)
- Situation Room → SP-credential-driven gaps (requires People data + gap engine integration)

---

### 4.8 — What success looks like

S15 live validation passes when all of the following are true. UI integration checks (Person Profile, Readiness, Situation Room) are explicitly out of scope — they require People SP integration (Sprint 16).

| Check | Pass condition |
|---|---|
| Network | GET to `C3Credentials/items` returns **HTTP 200** with a `value` array of 10 items |
| Console — aggregate | `[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.` |
| Console — stress 8 | `[C3/Credential] Item N: missing HolderPersonID — record rejected` |
| Console — stress 9 | `[C3/Credential] Item N: unknown CredentialType "Work Permit" — mapped to Other` |
| Console — stress 10 | No warning (expected). `ExpiryDate` is `null` in SP (blank field). Mapper: `null → undefined`, silent. Confirmed live: SP rejects malformed date strings with HTTP 400. |
| Console — no errors | Zero `console.error` calls from the `[C3/Credential]` path for mirror records 1–7 |
| No crashes | All screens navigable without unhandled exceptions or React error boundaries |
| People Workspace | Shows 0 people / empty state — confirms SP mode active, stub failing safely |
| *(Deferred)* Person Profile credentials | Not checked in S15 — requires Sprint 16 People integration |
| *(Deferred)* Readiness / Situation Room | Not checked in S15 — requires Sprint 16 People integration |

---

## Section 5 — Sprint 15 Close Criteria

Sprint 15 is complete and ready to tag `v0.15.0-sp-credentials` when **all of the following** are confirmed:

### Must pass (hard gates)

- [ ] **S15-1:** C3Credentials SP list schema document delivered *(done)*
- [ ] **S15-2:** `spCredentialMapper.ts` implemented, locally verified *(done)*
- [ ] **S15-3:** `SharePointCredentialService` implemented, TypeScript clean *(done)*
- [ ] **S15-4:** SP test dataset (10 records) documented *(done)*
- [ ] **S15-5A:** Local mapper parity harness passes 87/87 assertions *(done)*
- [ ] **S15-6:** SPFx host wiring complete — `spSiteUrl` and `dataSourceMode` wired from SPFx page context through to `AppConfig` *(done)*
- [ ] **S15-7:** Mock-mode visual smoke test passed — no regressions from S15 changes *(done)*
- [ ] **S15-8 (real S15-5):** Live SP fetch validation passes all checks in Section 4.8 of this runbook

### Must document (not blocking but required before close)

- [ ] Console output from the live validation run captured (screenshot or copy-paste)
- [ ] Confirmed which SP behaviour stress record 10 produced (invalid date string → null sanitisation vs. stored as-is)
- [ ] Any unexpected REST response shape differences noted for Sprint 16 mapper consideration
- [ ] `C3 Architecture Baseline — Sprint 15.md` written

### Must NOT be present at close

- [ ] No TypeScript errors in `packages/c3` or `packages/c3-spfx-host`
- [ ] No unresolved `console.error` calls triggered by the live fetch (errors from stress records are expected; errors from mirror records are not)
- [ ] No regressions in mock mode (confirmed by S15-7)

### Tag action

Once all hard gates pass and documentation is complete:

```bash
# From the repo root
git add -A
git commit -m "S15-8: Live SP credential validation passed — Sprint 15 complete"
git tag v0.15.0-sp-credentials
git push origin main --tags
```

---

*This runbook is the authoritative guide for Sprint 15 live validation. When Section 4.8 passes and Section 5 criteria are met, Sprint 15 is closed.*
