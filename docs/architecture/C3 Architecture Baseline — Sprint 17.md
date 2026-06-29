# C3 Architecture Baseline — Sprint 17
**C3 Contract Control Center**
**Sprint:** 17 -- Journey SharePoint Integration
**Baseline date:** 2026-06-29
**Status:** CLOSED -- 2026-06-29

---

## Closeout statement

Sprint 17 closes as:

> **"Live SharePoint Journey fetch, mapping, diagnostics, and SP read-only UI guard validated. All three SP read layers (Credentials, People, Journeys) confirmed simultaneously against live data."**

Sprint 17 does **not** close as:

> ~~"Journey write operations (initiate, complete, suspend, cancel) are implemented."~~

Write operations are governed by ADR-013 (Governance Approval Pattern) and are explicitly deferred to Sprint 18. The Journey service stubs remain throwing for all four write methods.

### Live validation evidence (confirmed 2026-06-29)

- HTTP 200 on `GET .../C3Journeys/items?$select=Id,Title,PersonID,JourneyType,...&$filter=Status eq 'Active'&$top=2000`
- Console aggregate: `[C3/Journey] listJourneys: fetched 2 SP records. Mapped: 2. Rejected: 0. Warnings: 0.`
- JRN-0001 (Active, Onboarding, PER-0001): journey card renders in Person Profile Readiness tab; ObligationAssignments parsed from live JSON
- JRN-0002 (Active, Onboarding, PER-0002): journey card renders
- JRN-0003 (Completed, PER-0003): not returned by `listAllActiveJourneys()` -- correct per `$filter=Status eq 'Active'`
- S15 regression: `[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.` -- baseline unchanged
- S16 regression: `[C3/People] listPeople: fetched 10 SP records. Mapped: 10. Rejected: 0. Warnings: 0.` -- baseline unchanged
- SP read-only guard: 5 write actions hidden in SP mode; all reappear in mock mode

---

## Section 1 -- What Sprint 17 delivered

### S17-1: spJourneyMapper.ts

Pure mapping utility at `packages/c3/src/utils/spJourneyMapper.ts`. Converts raw SP REST list items (`SpJourneyItem`) to typed `Journey` objects. Follows the S15/S16 `spCredentialMapper`/`spPersonMapper` pattern -- no React, no hooks, no service dependencies.

Key behaviours:

- **Hard reject** -- blank/null `Title` (JourneyID) -- record excluded
- **Hard reject** -- blank/null `PersonID` -- record excluded
- **Hard reject** -- unknown `JourneyType` value (not in `JourneyType` union) -- record excluded; Journey will not appear in type-filtered queries
- **Hard reject** -- unknown `Status` value (not in `JourneyStatus` union) -- record excluded
- **Non-blank unknown PersonID** -- retained (no FK lookup against C3People; that is not the mapper's responsibility)
- **DateTime preservation** -- `InitiatedAt`, `CompletedAt`, and `assignedAt` in `ObligationAssignment` are preserved as full ISO 8601 datetime strings. `normalizeSpDate()` is explicitly NOT used here -- it strips to date-only (`YYYY-MM-DD`), which would corrupt Journey datetime semantics. A private `normalizeSpDateTime()` helper validates the string and returns `val.trim()`.
- **ObligationAssignmentsJSON** -- blank/null: `undefined` (no warn, absent field). Malformed JSON: `warn + undefined`. Non-array: `warn + undefined`. Valid array: `ObligationAssignment[]`.
- **Aggregate log** -- one `console.info` per batch: `[C3/Journey] listJourneys: fetched N SP records. Mapped: M. Rejected: R. Warnings: W.`

Validated against 51 test cases in `s17-parity-journeys.mjs` (0 failures).

### S17-2: read-only SharePointJourneyService.ts

Live SP service at `packages/c3/src/services/sharepoint/SharePointJourneyService.ts`. Implements `IJourneyService` using native `fetch` with `credentials: 'same-origin'` and `Accept: application/json;odata=nometadata`. No PnP.js dependency. Follows the S15 `SharePointCredentialService` pattern.

**Implemented (read) methods:**

- `listAllActiveJourneys(type?)` -- `$filter=Status eq 'Active'` (optionally extended with `and JourneyType eq '...'`), `$top=2000`
- `listJourneysForPerson(personId, type?)` -- `$filter=PersonID eq '...'` (optionally `and JourneyType eq '...'`), `$orderby=InitiatedAt desc`, `$top=2000`
- `getActiveJourney(personId, type)` -- `$filter=PersonID eq '...' and JourneyType eq '...' and Status eq 'Active'`, `$top=1`

All three fail safely on every error path (network failure, non-2xx HTTP, unparseable JSON, missing `value` array) -- return `null`/`[]` with `console.error`, never throw.

OData single-quote escaping (`escOData`) applied to all user-supplied string values in filter clauses.

**Stub (write) methods -- Sprint 18:**

- `initiateJourney()` -- throws `"initiateJourney not implemented in SharePoint mode (Sprint 18)"`
- `completeJourney()` -- throws
- `suspendJourney()` -- throws
- `cancelJourney()` -- throws

### S17-3: s17-parity-journeys.mjs

Parity harness at `scripts/s17-parity-journeys.mjs`. Runs the journey mapper against inlined SP-shaped items locally (no network). 51 assertions across:

- Batch count assertions (mapped, rejected, warnings)
- Mirror record field-level parity (JRN-0001/0002/0003 vs mock service seeds)
- Stress assertions: blank Title (hard reject), unknown JourneyType (hard reject), malformed ObligationAssignmentsJSON (soft warn, retained)
- DateTime format assertions: confirms full ISO strings preserved, not stripped to date-only

Result: 51 passed / 0 failed.

### S17-4: useJourneyService.ts fix

`packages/c3/src/hooks/useJourneyService.ts` corrected to pass `config.spSiteUrl` to `createSharePointJourneyService(config.spSiteUrl)`. The prior stub passed zero arguments; TypeScript caught this as TS2554. `config.spSiteUrl` added to `useMemo` dependency array, matching the `useCredentialService` pattern.

### S17-5: sharepoint/index.ts -- siteUrl threading

`packages/c3/src/services/sharepoint/index.ts` updated to pass `siteUrl` to `createSharePointJourneyService(siteUrl)`, consistent with how Credentials and People services receive the site URL.

### S17-6: useSpReadOnly.ts -- SP read-only mode guard

New hook at `packages/c3/src/hooks/useSpReadOnly.ts`:

```typescript
export const useSpReadOnly = (): boolean => {
  const { config } = useApp();
  return config.dataSourceMode === 'sharepoint';
};
```

Used by `PersonProfile.tsx` and `ContractProfile.tsx` to hide all unimplemented write surfaces in SP mode. Sprint 18 will replace these hide guards with governed write-path logic when write operations are implemented.

**Write surfaces hidden in SP mode:**

| Screen | Action hidden |
|---|---|
| PersonProfile -- Credentials section | Add Credential (header button) |
| PersonProfile -- empty credentials | Add Credential (primary button) |
| PersonProfile -- Readiness tab | Start Onboarding Journey |
| PersonProfile -- Readiness tab, obligation rows | Resolve (via `onResolveObligation=undefined`) |
| ContractProfile -- PageHeader | Edit Contract + Add Amendment (as a unit) |

`ReadinessPanel.tsx` required no changes -- it already supports `onResolveObligation=undefined` and suppresses Resolve buttons when the prop is absent.

### S17-7: C3Journeys SP List Schema correction

Pre-validation inspection identified that the schema document originally specified the journey-type choice column with internal name `Type`. SharePoint treats `Type` as a reserved metadata word in certain list contexts. The internal name was corrected to `JourneyType` (display name remains `Type`) throughout:

- `docs/architecture/C3Journeys SP List Schema.md` -- section heading, internal name, index table, mapper reference, checklist
- `spJourneyMapper.ts` -- `SpJourneyItem.JourneyType` field name
- `SharePointJourneyService.ts` -- `$select` and all `$filter` clauses
- `s17-parity-journeys.mjs` -- all SP item objects

Domain model unchanged: `Journey.Type` (TypeScript) remains `Journey.Type`. The mapper maps `SpJourneyItem.JourneyType` → `Journey.Type`.

---

## Section 2 -- Runtime architecture (confirmed state after S17)

### SharePoint service registry -- current implementation state

| Service | SP mode behaviour | State after S17 |
|---|---|---|
| Credentials | Calls real `C3Credentials` SP list | Live (S15) |
| People | Calls real `C3People` SP list | Live (S16) |
| Journeys (read) | Calls real `C3Journeys` SP list | Live (S17) |
| Journeys (write) | Stubs throwing | Deferred -- Sprint 18 |
| Credentials (write) | Stubs throwing | Deferred -- Sprint 18 |
| Contracts | Returns `[]` graceful stub | Deferred -- SP-02 |
| Missions | Returns `[]` graceful stub | Deferred -- future sprint |
| Milestones | Returns `[]` graceful stub | Deferred -- future sprint |
| Finance | Returns `[]` graceful stub | Deferred -- future sprint |

### DateTime handling -- critical distinction

Three different normalisation strategies exist in the codebase after S17:

| Helper | Location | Behaviour | Used for |
|---|---|---|---|
| `normalizeSpDate(val, context, prefix, warnRef)` | `packages/c3/src/utils/dateUtils.ts` | Strips to `YYYY-MM-DD` date-only | Person date fields (`FirstContractDate`, `LatestContractDate`), Credential date fields (`IssuedDate`, `ExpiryDate`) -- SP `Date Only` columns |
| `normalizeSpDateTime(val, context, warnRef)` | `packages/c3/src/utils/spJourneyMapper.ts` (private) | Validates string is parseable datetime; returns `val.trim()` (full ISO preserved) | Journey `InitiatedAt`, `CompletedAt`, `ObligationAssignment.assignedAt` -- SP `Date and Time` columns |
| Raw string | Various | No normalisation; plain string from SP | Text fields, IDs |

The distinction matters: Journey datetime fields are SP `Date and Time` columns that return full ISO strings (e.g. `"2026-01-10T09:00:00Z"`). Using `normalizeSpDate` would strip these to `"2026-01-10"`, corrupting the time component needed for `$orderby=InitiatedAt desc` sorting precision.

### OData escaping

All three live SP services use `escOData(val)` for user-supplied string values in `$filter` clauses. Single quotes within values are doubled (`'` → `''`). This applies to PersonID, JourneyType, CredentialID, and all other string filter parameters. Unescaped values would produce HTTP 400 for any PersonID or JourneyType containing an apostrophe.

---

## Section 3 -- What was validated in mock mode (regression baseline)

Mock-mode smoke test performed before and after SP guard changes:

| Screen | Result |
|---|---|
| Command Center | Work queue renders; all urgency bands correct |
| People Workspace | 10 people; 3-card KPI strip correct |
| Person Profile -- PER-0001 | 3 credentials; journey card (JRN-0001, Active); obligation assignment renders |
| Person Profile -- Readiness tab | Resolve buttons visible (mock mode); AddCredentialPanel opens |
| Readiness evaluation | Gap computation correct; Travel obligation Covered via JRN-0001 |
| Person Profile -- PER-0003 | Journey card (JRN-0003, Completed) |
| Situation Room | Work queue correct |
| ContractProfile | Edit Contract + Add Amendment visible in mock mode |
| Console | Zero errors |

**No regression observed in mock mode.** All write action buttons appear correctly in mock mode and are hidden only when `dataSourceMode = 'sharepoint'`.

---

## Section 4 -- What is deferred to Sprint 18 and why

### Journey write operations

`initiateJourney`, `completeJourney`, `suspendJourney`, and `cancelJourney` are stub-throwing in `SharePointJourneyService`. These are governance-gated write operations per ADR-013:

- **`initiateJourney`** -- requires approval by an authorised ops coordinator; creates a Journey record and optionally posts to the governance log
- **`completeJourney` / `suspendJourney` / `cancelJourney`** -- status transitions with audit trail requirements

Sprint 18 must define the full approval flow, SP write payload, and error-handling for partial writes before any of these can be implemented. The `useSpReadOnly` guard ensures these stubs are never reached via the UI in SP mode until Sprint 18.

### Credential write operations

`addCredential` and `deactivateCredential` in `SharePointCredentialService` are also stub-throwing. Same Sprint 18 scope.

### Contracts/SP-02

The contract register (`SharePointContractService`) is a graceful stub returning `[]`. The Contract Profile and Contract List screens fail silently in SP mode (empty states, no crashes). A separate structural issue exists where contract navigation passes numeric SP item IDs (e.g. `"1"`, `"2"`) as PersonID values to `getPerson()` -- these do not resolve to any `C3People` `Title` value (which stores `PER-NNNN` format). This FK alignment will be resolved as part of the SP-02 Contracts integration workstream.

---

## Section 5 -- S17 close criteria

| Gate | Pass condition | Result |
|---|---|---|
| `JourneyType` SP internal name | `InternalName: "JourneyType"` confirmed via REST | PASS |
| C3Journeys GET | HTTP 200; `JourneyType` present as string in response | PASS |
| Journey aggregate (active read) | `fetched 2 SP records. Mapped: 2. Rejected: 0. Warnings: 0.` | PASS |
| Person Profile journey card | Renders from live SP; JourneyID, Status, dates, InitiatedBy correct | PASS |
| ObligationAssignments live | JRN-0001 obligation renders from parsed JSON | PASS |
| DateTime preservation | Full ISO string preserved; not stripped to date-only | PASS |
| SP read-only guard -- 5 actions hidden | All hidden in SP mode | PASS |
| SP read-only guard -- mock regression | All visible in mock mode | PASS |
| S15 regression | `[C3/Credential]`: `Mapped: 9. Rejected: 1. Warnings: 1.` | PASS |
| S16 regression | `[C3/People]`: `Mapped: 10. Rejected: 0. Warnings: 0.` | PASS |
| s17-parity-journeys.mjs | 51/51 passed | PASS |
| s15-parity-test.mjs | 87/87 passed | PASS |
| s16-parity-people.mjs | 220/220 passed | PASS |
| tsc --noEmit | Clean | PASS |
| No crash on navigation | All screens navigable in SP mode | PASS |

**All gates passed. Sprint 17 is CLOSED (2026-06-29).**

---

## Section 6 -- Deferred items and ADR notes

### SP-02: Contracts SharePoint integration

The contract-to-person navigation path passes numeric SP item IDs as PersonID to `getPerson()`. These do not resolve in `C3People` (which uses `PER-NNNN` format in `Title`). Until `SharePointContractService` is implemented with `HolderPersonID` carrying canonical `PER-NNNN` values, the Contracts → Person Profile navigation path will produce `[C3/People] getPerson: no SP record found for PersonID "N"` warnings and empty person profiles from the contract path.

**Impact:** Zero -- the Situation Room → Person Profile path (which sources PersonID from live People data) is unaffected. Only the Contract → Person path is broken in SP mode.

**Resolution:** Implement `SharePointContractService` with `HolderPersonID` in `PER-NNNN` format. Define and agree on how existing numeric contract records are migrated or cross-referenced before SP-02 provisioning.

### ADR-013: Governance Approval Pattern (Sprint 18 blocker)

Sprint 18 write operations must adhere to ADR-013. Each write path (initiate journey, complete journey, add credential) requires:
- Role check before write
- Approval confirmation UI (separate from the current `StartJourneyPanel` / `AddCredentialPanel` which remain mock-only)
- SP write payload structure agreed with IT
- Partial write error handling (network failure after SP write, before local cache invalidation)

The `useSpReadOnly` guard and stub-throwing service methods are the explicit placeholders for this governance boundary.

### ObligationAssignmentsJSON -- normalisation deferred

`ObligationAssignmentsJSON` (plain-text JSON column) is accepted for the Sprint 17 read-only pilot per ADR-003. Before Journey write operations go live (Sprint 18), evaluate migration to a normalised `C3ObligationAssignments` child SP list with a `JourneyID` foreign key. Decision and migration plan must precede Sprint 18 provisioning. See ADR-003 §7 for the full normalisation deferral rationale.

---

## Section 7 -- File inventory (Sprint 17 additions and modifications)

| File | Status | Notes |
|---|---|---|
| `packages/c3/src/utils/spJourneyMapper.ts` | New | S17-1 -- pure journey mapper |
| `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` | Rewritten | S17-2 -- 3 read methods; 4 write stubs |
| `packages/c3/src/hooks/useJourneyService.ts` | Modified | S17-4 -- pass `config.spSiteUrl`; add to useMemo deps |
| `packages/c3/src/services/sharepoint/index.ts` | Modified | S17-5 -- pass `siteUrl` to `createSharePointJourneyService` |
| `packages/c3/src/hooks/useSpReadOnly.ts` | New | S17-6 -- SP read-only mode guard hook |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | S17-6 -- hide 3 write surfaces + pass undefined to ReadinessPanel |
| `packages/c3/src/screens/ContractProfile.tsx` | Modified | S17-6 -- hide Edit Contract + Add Amendment |
| `scripts/s17-parity-journeys.mjs` | New | S17-3 -- 51-assertion journey parity harness |
| `docs/architecture/C3Journeys SP List Schema.md` | Modified | S17-7 -- `JourneyType` internal name correction throughout |
| `docs/architecture/S17 Journey Live Validation Runbook.md` | New | Live validation steps and confirmed results |
| `docs/architecture/C3 Architecture Baseline — Sprint 17.md` | New | This document |
| `packages/c3-spfx-host/.../c3-runtime.js` | Modified | Runtime bundle rebuild after S17 live validation |
