# S17 Journey Live Validation Runbook
**C3 Contract Control Center — Sprint 17**
**Date:** 2026-06-29
**Status:** COMPLETE — PASS
**Prerequisite:** `C3Journeys` list provisioned at `https://geekaygames.sharepoint.com/sites/C3`

> **Runtime mode note:** When `dataSourceMode = 'sharepoint'`, the `SharePointJourneyService` is now fully implemented for all three read methods. `listAllActiveJourneys(type?)`, `listJourneysForPerson(personId, type?)`, and `getActiveJourney(personId, type)` all call the live `C3Journeys` SP list. Four write stubs (`initiateJourney`, `completeJourney`, `suspendJourney`, `cancelJourney`) remain throwing with "not implemented" — deferred to Sprint 18.

> **JourneyType column name note (critical):** The SP choice column for journey type has **display name** `Type` and **internal name** `JourneyType`. The internal name was set to `JourneyType` to avoid a SharePoint reserved-word collision with `Type`. All REST queries use `JourneyType` in `$select` and `$filter`. The domain model `Journey.Type` is unchanged. See §1 for provisioning guidance and §6 for the live confirmation.

> **Parity harness baseline:** `scripts/s17-parity-journeys.mjs` passes 51/51 locally. The live run in this runbook is the real-SP confirmation that the same mapper handles actual REST response shapes correctly.

---

## Section 1 — Column Creation Reference

> **This section is a provisioning reference.** The authoritative column definition source is `docs/architecture/C3Journeys SP List Schema.md`. Use that document for full field descriptions, choice values, and the provisioning checklist. This section summarises the critical details for live validation context.

**List internal name:** `C3Journeys`
**List display title:** `C3 Journeys`
**Site:** `https://geekaygames.sharepoint.com/sites/C3`

### Column summary

| # | Internal name | Display name | SP type | Required | Notes |
|---|---|---|---|---|---|
| 0 | `Title` (built-in) | Title / JourneyID | Single line | Yes | Repurposed as JourneyID, e.g. `JRN-0001`. Blank = hard reject. |
| 1 | `PersonID` | PersonID | Single line | Yes | C3 PersonID, e.g. `PER-0001`. Plain text, NOT a SP Lookup. Blank = hard reject. |
| 2 | `JourneyType` | Type | Choice | Yes | **Internal name is `JourneyType`, NOT `Type`.** 5 values: `Onboarding`, `VisaRenewal`, `TeamTransfer`, `ContractRenewal`, `Offboarding`. Unknown value = hard reject. |
| 3 | `Status` | Status | Choice | Yes | 4 values: `Active`, `Completed`, `Suspended`, `Cancelled`. Unknown = hard reject. |
| 4 | `InitiatedAt` | InitiatedAt | Date and Time (full) | Yes | Full ISO datetime preserved by mapper — `normalizeSpDate()` NOT used here. |
| 5 | `InitiatedBy` | InitiatedBy | Single line | Yes | Email or display name of initiating staff member. |
| 6 | `AssignedTo` | AssignedTo | Single line | No | Governance owner. Optional. |
| 7 | `InitiationReason` | InitiationReason | Multiple lines (plain) | No | Free text. |
| 8 | `ContractID` | ContractID | Single line | No | Linked contract, e.g. `CTR-0001`. Plain text. |
| 9 | `MissionID` | MissionID | MissionID | Single line | No | Informational only. |
| 10 | `CompletedAt` | CompletedAt | Date and Time (full) | No | Full ISO datetime preserved. |
| 11 | `Notes` | Notes | Multiple lines (plain) | No | Free text. |
| 12 | `ObligationAssignmentsJSON` | ObligationAssignmentsJSON | Multiple lines (plain) | No | JSON array. Blank = `undefined` (no warn). Malformed = warn + `undefined`. |

**Total: 13 columns** (built-in Title + 12 custom).

### Index summary

| Internal name | Reason |
|---|---|
| `PersonID` | `getActiveJourney()` and `listJourneysForPerson()` both filter by PersonID |
| `Status` | `listAllActiveJourneys()` filters `Status eq 'Active'` on every call |
| `JourneyType` | `getActiveJourney(personId, type)` filters by PersonID and JourneyType |

---

## Section 2 — JourneyType Column — Critical Provisioning Note

**The choice column for journey type must have internal name `JourneyType`, not `Type`.**

SharePoint treats `Type` as a reserved metadata word in certain list contexts and may silently collide with system fields. The internal name is set at column creation time and cannot be changed afterward without deleting and recreating the column.

### How to verify after provisioning

In a browser signed into the SharePoint site, run the following in the address bar or DevTools console:

```
GET https://geekaygames.sharepoint.com/sites/C3/_api/web/lists/getbytitle('C3 Journeys')/fields?$filter=Title eq 'Type'&$select=InternalName,Title
```

Expected response:
```json
{
  "value": [{
    "InternalName": "JourneyType",
    "Title": "Type"
  }]
}
```

If `InternalName` returns `"Type"` instead of `"JourneyType"`, the column must be deleted and recreated with the correct internal name before C3 live validation can run.

### C3 REST query behaviour

All three read methods build OData queries using `JourneyType`:

```
$select=Id,Title,PersonID,JourneyType,Status,InitiatedAt,...
$filter=Status eq 'Active'
$filter=Status eq 'Active' and JourneyType eq 'Onboarding'
$filter=PersonID eq 'PER-0001' and JourneyType eq 'Onboarding' and Status eq 'Active'
```

If the internal name is wrong, SP will return HTTP 400 or silently omit the field from the response, causing all records to fail with "unknown JourneyType" hard rejects.

---

## Section 3 — Test Dataset

### Mirror records (3) — for parity with mock service seeds

Enter these 3 records in order via the SP list **+ New item** form. JourneyIDs and field values must match the mock service (`MockJourneyService.ts`) exactly.

---

**Record 1 (SP Id 1) — JRN-0001: Active Onboarding with obligation assignment (PER-0001)**

| Field | Value |
|---|---|
| Title (JourneyID) | `JRN-0001` |
| PersonID | `PER-0001` |
| JourneyType (display: Type) | `Onboarding` |
| Status | `Active` |
| InitiatedAt | `2026-01-10 09:00` *(set both date and time)* |
| InitiatedBy | `ops.coordinator@geekay.gg` |
| AssignedTo | `ops.coordinator@geekay.gg` |
| InitiationReason | `New season roster -- UAE operations onboarding.` |
| ContractID | `CTR-0001` |
| MissionID | *(leave blank)* |
| CompletedAt | *(leave blank)* |
| Notes | *(leave blank)* |
| ObligationAssignmentsJSON | `[{"obligationType":"Travel","requirement":"Travel Authorization","assignedTo":"pro.coordinator@geekay.gg","assignedAt":"2026-01-10T09:30:00Z"}]` |

---

**Record 2 (SP Id 2) — JRN-0002: Active Onboarding, no obligation assignments (PER-0002)**

| Field | Value |
|---|---|
| Title (JourneyID) | `JRN-0002` |
| PersonID | `PER-0002` |
| JourneyType (display: Type) | `Onboarding` |
| Status | `Active` |
| InitiatedAt | `2026-02-15 11:30` |
| InitiatedBy | `ops.coordinator@geekay.gg` |
| AssignedTo | `ops.coordinator@geekay.gg` |
| InitiationReason | `Transfer window acquisition -- onboarding initiated.` |
| ContractID | *(leave blank)* |
| MissionID | *(leave blank)* |
| CompletedAt | *(leave blank)* |
| Notes | *(leave blank)* |
| ObligationAssignmentsJSON | *(leave blank)* |

---

**Record 3 (SP Id 3) — JRN-0003: Completed Onboarding (PER-0003)**

| Field | Value |
|---|---|
| Title (JourneyID) | `JRN-0003` |
| PersonID | `PER-0003` |
| JourneyType (display: Type) | `Onboarding` |
| Status | `Completed` |
| InitiatedAt | `2025-09-01 08:00` |
| InitiatedBy | `ops.coordinator@geekay.gg` |
| AssignedTo | `ops.coordinator@geekay.gg` |
| InitiationReason | `Pre-season onboarding.` |
| ContractID | `CTR-0003` |
| MissionID | *(leave blank)* |
| CompletedAt | `2025-10-14 16:00` |
| Notes | `All credentials verified and filed. Cleared for full operations.` |
| ObligationAssignmentsJSON | *(leave blank)* |

---

> **Why these three:** JRN-0001 has an obligation assignment (PER-0001's Travel gap renders as `Covered`). JRN-0002 has none (PER-0002's gaps remain `Routed`). JRN-0003 is Completed (appears in completed/historical view only, not returned by `listAllActiveJourneys()`). Together they cover both Active journey lifecycle states, the obligationAssignment parse path, and the completed-journey filter path.

### Stress records (3) — for diagnostic validation

These records exercise mapper hard rejects and soft-warn paths. Enter via the SP list UI or REST API injection as needed.

| SP Id | Title | Notes |
|---|---|---|
| 4 | *(blank)* | Blank Title = hard reject. Requires REST injection if SP enforces required Title via UI. |
| 5 | JRN-0005 | Set JourneyType to `UnknownType` (custom value). Hard reject — unknown JourneyType. Requires SP to allow custom values temporarily. |
| 6 | JRN-0006 | Set ObligationAssignmentsJSON to `not valid json{`. Soft warn — malformed JSON, record retained. PersonID = `PER-0001`, Status = `Active`, JourneyType = `Onboarding`. |

**Expected diagnostic output for stress records:**

```
[C3/Journey] Item 4: missing JourneyID -- record rejected
[C3/Journey] Item 5: unknown JourneyType "UnknownType" -- record rejected
[C3/Journey] ObligationAssignmentsJSON parse failed -- treated as empty
[C3/Journey] listJourneys: fetched 6 SP records. Mapped: 4. Rejected: 2. Warnings: 1.
```

> **Stress row cleanup:** After validating the stress diagnostic output, delete the stress rows (SP Ids 4, 5, 6) from the list. The expected final clean state is `fetched 2 SP records. Mapped: 2. Rejected: 0. Warnings: 0.` when calling `listAllActiveJourneys()` against a clean list with only the 3 mirror records (and only JRN-0001 and JRN-0002 have `Status = Active`).

---

## Section 4 — Live Validation Runbook

### 4.1 — Prerequisites checklist

- [ ] All 13 columns present with correct internal names (verify `JourneyType` internal name via REST — see §2)
- [ ] `JourneyType` choice field has exactly 5 values matching TypeScript casing
- [ ] `Status` choice field has exactly 4 values matching TypeScript casing
- [ ] `ObligationAssignmentsJSON` configured as plain-text multiline (not Enhanced Rich Text)
- [ ] Indexes created: `PersonID`, `Status`, `JourneyType`
- [ ] 3 mirror records entered in order (SP Ids 1–3)
- [ ] C3Credentials and C3People lists from S15/S16 still intact
- [ ] Repo at `C:\Projects\c3-platform`, `npm install` current
- [ ] `s17-parity-journeys.mjs` passes 51/51 locally before live run

### 4.2 — Start the hosted workbench

```
cd C:\Projects\c3-platform\packages\c3-spfx-host
npm run start
```

Navigate to:

```
https://geekaygames.sharepoint.com/sites/C3/_layouts/15/workbench.aspx
```

Add the **C3Host** web part and open **DevTools (F12) → Console** and **Network → Fetch/XHR** before switching to SP mode.

### 4.3 — Confirm mock mode baseline first

Verify in mock mode:
- People Workspace loads with 10 persons
- Readiness tab for PER-0001 shows journey context (JRN-0001, Active) and obligation assignments
- No console errors

**Pass condition:** Mock mode renders cleanly.

### 4.4 — Switch to SharePoint mode

1. Open web part property pane → **Data source mode** → `SharePoint (live data)`
2. Web part re-renders

### 4.5 — Network checks

#### Expected requests after switching to SP mode

| Service | Expected URL pattern | Expected status |
|---|---|---|
| `listPeople` | `.../C3People/items?$select=Id,Title,FullName,...&$filter=IsActive eq 1&$top=2000` | 200 OK |
| `listAllCredentials` | `.../C3Credentials/items?$select=ID,Title,...&$filter=IsActive eq 1&$top=2000` | 200 OK |
| `listJourneysForPerson` | `.../C3Journeys/items?$select=Id,Title,PersonID,JourneyType,Status,...&$filter=PersonID eq 'PER-NNNN'&$orderby=InitiatedAt desc&$top=2000` | 200 OK |
| `listAllActiveJourneys` | `.../C3Journeys/items?$select=...&$filter=Status eq 'Active'&$top=2000` | 200 OK |

#### C3Journeys request — what to check

In the Network tab, click the `C3Journeys` request → Preview:

- `value` array present
- `JourneyType` field is present as a string (e.g. `"Onboarding"`), NOT nested in a lookup object
- `InitiatedAt` is a full ISO datetime string (e.g. `"2026-01-10T09:00:00Z"`), NOT date-only
- `ObligationAssignmentsJSON` is a plain string (not an object)

#### Troubleshooting by HTTP status

| Status | Cause | Action |
|---|---|---|
| 400 | `JourneyType` internal name wrong — SP rejects OData filter | Verify internal name via REST (§2); delete and recreate column if needed |
| 200, `JourneyType` absent from items | `$select=JourneyType` not matched — internal name mismatch | Same as 400 cause above |
| 200, `value: []` | `Status eq 'Active'` filter excludes all records | Confirm Status choice values match exactly (`Active`, not `active`) |
| 401 | Not authenticated | Sign into SP, reload |
| 404 | List internal name not `C3Journeys` | Check List Settings URL |

### 4.6 — Console checks

#### Expected console output — clean 3-record run (active journeys only)

When navigating to a person with an active journey, `listJourneysForPerson` fires:

```
[C3/Journey] listJourneys: fetched 2 SP records. Mapped: 2. Rejected: 0. Warnings: 0.
```

*(2 active journeys: JRN-0001 for PER-0001, JRN-0002 for PER-0002. JRN-0003 is Completed — returned by `listJourneysForPerson` but not by `listAllActiveJourneys`.)*

#### Expected console output — with stress records present

```
[C3/Journey] Item 4: missing JourneyID -- record rejected
[C3/Journey] Item 5: unknown JourneyType "UnknownType" -- record rejected
[C3/Journey] ObligationAssignmentsJSON parse failed -- treated as empty
[C3/Journey] listJourneys: fetched 6 SP records. Mapped: 4. Rejected: 2. Warnings: 1.
```

#### S15/S16 regression check — credential and people prefixes unaffected

| Prefix | Expected to appear | Must NOT appear |
|---|---|---|
| `[C3/Journey]` | Yes — on any Journey fetch | On Credential or People messages |
| `[C3/People]` | Yes — on People fetch | On Journey or Credential messages |
| `[C3/Credential]` | Yes — on Credential fetch | On Journey or People messages |

### 4.7 — Functional checks in the C3 UI

#### Check A — Person Profile Readiness tab — journey context from live SP

Navigate to a Person Profile (e.g. PER-0001 via People Workspace or Situation Room):

- **Readiness tab** shows journey card: `Active` badge, `JRN-0001`, `Initiated by ops.coordinator@geekay.gg`
- Obligation assignments render from live SP `ObligationAssignmentsJSON`
- Journey fetched via `listJourneysForPerson('PER-0001')`
- `[C3/Journey]` diagnostic prefix appears in console (not `[C3/Credential]`)

**Pass condition:** Journey card renders from live SP data. No mock data visible.

#### Check B — Person with completed journey (PER-0003)

Navigate to PER-0003:

- Readiness tab shows journey card: `Completed` badge, `JRN-0003`
- No "Start Onboarding Journey" button (journey exists — even a Completed one suppresses the button)
- CompletedAt date displayed correctly (full datetime from SP)

**Pass condition:** Completed journey card renders; start button absent.

#### Check C — Person with no journey (PER-0004 through PER-0010)

Navigate to a person with no journey record:

- Readiness tab shows "No onboarding journey" empty state
- In SP read-only mode: **"Start Onboarding Journey" button is hidden** (read-only guard active)
- No `[C3/Journey]` error in console (empty result is not an error)

**Pass condition:** Empty state renders. Start button absent in SP mode. No errors.

#### Check D — SP read-only guard confirmed

In SP mode, verify all five write actions are hidden:

| Screen | Action | Expected in SP mode |
|---|---|---|
| Person Profile → Credentials section | Add Credential (header) | Hidden |
| Person Profile → empty credentials | Add Credential (primary) | Hidden |
| Person Profile → Readiness tab | Start Onboarding Journey | Hidden |
| Person Profile → Readiness tab, obligation rows | Resolve button | Hidden |
| Contract Profile → PageHeader | Edit Contract + Add Amendment | Hidden |

All five must be absent from the DOM when `dataSourceMode = 'sharepoint'`. They reappear in mock mode.

**Pass condition:** All five hidden in SP mode. All five visible in mock mode (regression check).

#### Check E — S15/S16 regression

Confirm credential and people reads are unaffected:

- `[C3/Credential]` aggregate appears: `fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.`
- `[C3/People]` aggregate appears: `fetched 10 SP records. Mapped: 10. Rejected: 0. Warnings: 0.`
- No cross-prefix contamination

**Pass condition:** S15 and S16 baselines unchanged.

#### Check F — No crash on navigation

Navigate: Command Center → People → Person Profile → Readiness tab → Contract Profile

- No React error boundaries
- No unhandled JS exceptions
- Contract → SP mode renders the header without Edit Contract / Add Amendment
- Non-Journey service stubs (Missions, Milestones) log expected "not implemented" — not a blocker

**Pass condition:** All screens navigable without crashes.

---

## Section 5 — S17 Journey Validation Gates

### Hard gates (must pass)

| Gate | Pass condition |
|---|---|
| `JourneyType` internal name | REST query confirms `InternalName: "JourneyType"` |
| Network: C3Journeys GET | HTTP 200, `value` array present, `JourneyType` field as plain string |
| Console: Journey aggregate | `[C3/Journey] listJourneys: fetched N SP records. Mapped: N. Rejected: 0. Warnings: 0.` (clean run) |
| Console: diagnostic prefix isolation | `[C3/Journey]`, `[C3/People]`, `[C3/Credential]` all appear separately |
| Person Profile: journey card | Renders from live SP data; JourneyID, Status, InitiatedBy, InitiatedAt correct |
| DateTime preservation | `InitiatedAt` displayed as date portion of full ISO string (not date-only-stripped) |
| ObligationAssignments | JRN-0001 obligation assignment renders correctly from live JSON |
| SP read-only guard | 5 actions hidden in SP mode; reappear in mock mode |
| S15 regression | C3Credentials fetch unaffected: `Mapped: 9. Rejected: 1. Warnings: 1.` |
| S16 regression | C3People fetch unaffected: `Mapped: 10. Rejected: 0. Warnings: 0.` |
| No crash | All screens navigable in SP mode without exceptions |

### Known non-blockers (do not fail the sprint gate)

| Item | Behaviour | Resolution |
|---|---|---|
| Contracts in SP mode | Contract register fails; Person Profile contract tab may show empty or error | Deferred — Contracts/SP-02 |
| Contract-to-person navigation | Legacy numeric IDs (`"1"`, `"2"`) passed to `getPerson()` — no SP record found | Deferred — SP-02 |
| Journey write paths | `initiateJourney` / `completeJourney` / `suspendJourney` / `cancelJourney` throw — write stubs | Deferred — Sprint 18 |
| Mission/Milestone stubs | `[C3/Mission]` or similar "not implemented" console warnings | Deferred — future sprint |

---

## Section 6 — Live Validation Results (2026-06-29)

**Executed by:** Ihab
**Environment:** SharePoint hosted workbench — `https://geekaygames.sharepoint.com/sites/C3/_layouts/15/workbench.aspx`
**Data source mode:** SharePoint (live data)
**Date:** 2026-06-29

---

### 6.1 — JourneyType schema correction

During pre-validation inspection, a schema discrepancy was identified: the original `C3Journeys SP List Schema.md` specified the choice column internal name as `Type`. This is a SharePoint reserved-word risk. The schema doc was corrected to `JourneyType` before live validation ran. The SP list was provisioned with `JourneyType` as the internal name — confirmed via REST endpoint verification before the validation run.

Correction scope:
- Schema doc updated: `docs/architecture/C3Journeys SP List Schema.md` (commit `a4be651`)
- `spJourneyMapper.ts`: `SpJourneyItem.JourneyType` field, all `$select`/`$filter` references
- `SharePointJourneyService.ts`: `$select=...,JourneyType,...` and all filter clauses use `JourneyType eq '...'`
- `useJourneyService.ts`: fixed missing `siteUrl` argument and dependency

---

### 6.2 — Journey service result

**Console output (live run — after deleting blank stress row):**

```
[C3/Journey] listJourneys: fetched 2 SP records. Mapped: 2. Rejected: 0. Warnings: 0.
```

Active journeys returned: JRN-0001 (PER-0001, Active Onboarding) and JRN-0002 (PER-0002, Active Onboarding). JRN-0003 (Completed) was present in the list but not returned by `listAllActiveJourneys()` — correct, as the `$filter=Status eq 'Active'` clause excludes Completed records.

**S17 Journey live validation gate: PASS**

---

### 6.3 — S15/S16 regression confirmation

Live run confirmed both prior services unaffected:

```
[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.
[C3/People] listPeople: fetched 10 SP records. Mapped: 10. Rejected: 0. Warnings: 0.
```

These match the S15 and S16 baselines exactly. No regression.

**S15 regression gate: PASS**
**S16 regression gate: PASS**

---

### 6.4 — SP read-only guard confirmation

All five write-action surfaces confirmed hidden in SP mode:

| Action | Location | SP mode |
|---|---|---|
| Add Credential | PersonProfile credentials section header | Hidden |
| Add Credential | PersonProfile empty-credentials empty state | Hidden |
| Start Onboarding Journey | PersonProfile Readiness tab empty state | Hidden |
| Resolve (obligation rows) | ReadinessPanel — via `onResolveObligation=undefined` | Hidden |
| Edit Contract + Add Amendment | ContractProfile PageHeader | Hidden |

All five confirmed visible in mock mode (regression check passed). The `useSpReadOnly()` hook in `packages/c3/src/hooks/useSpReadOnly.ts` is the single source of truth for SP read-only state.

**SP read-only guard gate: PASS**

---

### 6.5 — Navigation and functional checks

| Check | Result |
|---|---|
| Person Profile journey card (PER-0001) | PASS — Active badge, JRN-0001, InitiatedBy, date correct |
| Person Profile journey card (PER-0003) | PASS — Completed badge, JRN-0003, CompletedAt correct |
| Person with no journey | PASS — empty state renders; Start Journey hidden in SP mode |
| ObligationAssignments (JRN-0001) | PASS -- JSON parsed, obligation assignment rendered in Readiness tab |
| DateTime preservation | PASS -- InitiatedAt displayed as correct date-portion of full ISO string |
| No crash on navigation | PASS |
| Diagnostic prefix isolation | PASS -- no cross-prefix contamination |

---

### 6.6 — Known deferred items

| ID | Item | Status | Resolution |
|---|---|---|---|
| SP-02 | Contract register fails in SP mode; contract → person navigation passes numeric IDs (`"1"`, `"2"`) instead of `PER-NNNN` | Deferred | Contracts SharePoint integration (future sprint) |
| S18-J | Journey write paths (`initiateJourney`, `completeJourney`, `suspendJourney`, `cancelJourney`) — stubs throwing | Deferred | Sprint 18 — governed write path with ADR-013 approval pattern |
| S18-C | Credential write paths (`addCredential`, `deactivateCredential`) — stubs throwing | Deferred | Sprint 18 |
| S?-M | Mission/Milestone/MissionParticipant live services — all stubs | Deferred | Future mission integration sprint |

---

### 6.7 — Final validation summary

**Overall result: PASS**
**Confirmed:** 2026-06-29

| Gate | Result |
|---|---|
| `JourneyType` internal name verified | PASS |
| C3Journeys GET — HTTP 200 | PASS |
| Journey aggregate (active read) | PASS -- `fetched 2 SP records. Mapped: 2. Rejected: 0. Warnings: 0.` |
| Journey card in Person Profile | PASS |
| ObligationAssignments parsed from SP | PASS |
| DateTime strings preserved (not stripped) | PASS |
| SP read-only guard — 5 actions hidden | PASS |
| SP read-only guard — mock mode regression | PASS |
| S15 C3Credentials — unaffected | PASS -- `Mapped: 9. Rejected: 1. Warnings: 1.` |
| S16 C3People — unaffected | PASS -- `Mapped: 10. Rejected: 0. Warnings: 0.` |
| Diagnostic prefix isolation | PASS |
| No crash on navigation | PASS |
| Contract register failure (SP mode) | DEFERRED -- SP-02 (non-blocker) |
| Journey write paths | DEFERRED -- Sprint 18 (non-blocker) |

**S17 is CLOSED — 2026-06-29.**

---

*This runbook is the authoritative record for S17 Journey live validation. For the full C3Journeys column definitions, provisioning checklist, and test dataset, see `docs/architecture/C3Journeys SP List Schema.md`.*
