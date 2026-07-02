# Sprint 25 Closeout Report — Governed AddPerson Foundation
**C3 Contract Control Center**
**Sprint:** 25 — Governed AddPerson Foundation
**Closeout date:** 2026-07-02
**Status:** CLOSED
**Preceding sprint:** Sprint 24 CLOSED (Contracts / SP-02 Foundation)
**Validation baseline:** All parity harnesses pass, tsc clean, verify:runtime PASS

---

## Closeout statement

Sprint 25 closes as:

> **"C3 now has a governed write path for creating new people. Operators can submit an AddPerson request through the C3 UI — in SP DSM this creates a C3Approvals record (OperationType: AddPerson) which must be approved and executed by a Platform Owner before the person appears in C3People. In Mock DSM the person is created directly with a PER-XXXX code. `SharePointPersonService.createPerson` uses the POST-then-MERGE pattern (SP atomic item ID as sequence source for PER-XXXX). The entire AddPerson path is governed by ADR-013 — no direct UI-to-SP write. `AddPersonPanel` is a governed overlay drawer gated by `capabilities.canCreate`. `ApprovalInbox` surfaces the AddPerson payload and handles `PartialAddPersonExecutionError`. TD-24 added: Email field is absent from the C3People SP list schema."**

Sprint 25 does **not** close as:

> ~~"A person can be created in SP DSM without going through C3Approvals."~~
> ~~"Induction, contract writes, mission, finance, or SaaS work was done."~~
> ~~"Contracts or Intelligence are re-enabled in SP DSM (no change from S24 state)."~~
> ~~"Email field is available on C3People (TD-24 — deferred)."~~
> ~~"C3_Contracts migration was completed (TD-22 — unchanged)."~~

---

## Sprint objective

Implement the governed `AddPerson` operation: a UI-initiated request to create a new C3People record that routes through the ADR-013 approval model in SP DSM. Mock DSM uses a direct create path for development and regression purposes.

---

## Completed phases

### Phase 1 — Domain model

**Types and interfaces:**

- `packages/c3/src/types/people.ts` — `CreatePersonInput` type added (all fields optional except `FullName`)
- `packages/c3/src/services/interfaces/approvalPayloads.ts` — `AddPersonApprovalPayload` added; `ApprovalPayload` union extended with `AddPersonApprovalPayload`
- `packages/c3/src/services/interfaces/IApprovalsService.ts` — `AddPerson` added to `operationType` union
- `packages/c3/src/services/interfaces/IPersonService.ts` — `createPerson(input: CreatePersonInput): Promise<Person>` added
- `packages/c3/src/utils/approvalPayloadUtils.ts` — `humanizeAddPersonPayload` helper added; `humanizeApprovalPayload` dispatcher updated for `AddPerson`

---

### Phase 2 — Mock DSM direct create path

- `packages/c3/src/services/mock/MockPersonService.ts` — `createPerson` implemented: derives next `PER-XXXX` from mock store, appends new person, returns the created `Person`
- `packages/c3/src/hooks/usePersonService.ts` — new hook: returns the correct `IPersonService` implementation for the current data source mode (Mock or SharePoint)

---

### Phase 3 — SharePoint governed path

- `packages/c3/src/services/sharepoint/SharePointPersonService.ts` — `createPerson` implemented via POST-then-MERGE:
  1. POST a placeholder row (`TMP-<timestamp>`) to `C3People`
  2. Receive SP item integer ID
  3. Derive canonical `PER-XXXX` from padded SP ID
  4. MERGE canonical `Title` (PersonID) and all `CreatePersonInput` fields back onto the row
  5. Return a constructed `Person` object
- `packages/c3/src/hooks/useExecuteApproval.ts` — AddPerson dispatch branch added; parses `AddPersonApprovalPayload` from the approval payload string; calls `personService.createPerson`; stamps approval `Executed`; `PartialAddPersonExecutionError` class added and exported

---

### Phase 4 — UI

- `packages/c3/src/components/shared/AddPersonPanel.tsx` — new governed overlay drawer (OverlayDrawer / Fluent UI):
  - Required field: Full Name
  - Optional fields: IGN, Primary Role, Nationality, Current Team, Current Game Title, Primary Department, Notes
  - SP DSM: "Submit for Approval" button + governance MessageBar; submission routes through `useSubmitAddPersonApproval` → C3Approvals record
  - Mock DSM: "Add Person" button; direct create path
  - Gated by `capabilities.canCreate` (Platform Owners and Operations roles only)
  - No Email field (TD-24: column absent from C3People SP list schema)
- `packages/c3/src/components/shared/index.ts` — `AddPersonPanel` exported
- `packages/c3/src/screens/PeopleWorkspace.tsx` — "Add Person" button added to `PageHeader` actions, gated by `capabilities.canCreate`; `AddPersonPanel` mounted at bottom of render
- `packages/c3/src/hooks/useSubmitAddPersonApproval.ts` — new mode-branching submission hook:
  - Mock: calls `personService.createPerson` directly; invalidates `queryKeys.people.all()`; returns `{ mode: 'direct', person }`
  - SP: builds `AddPersonApprovalPayload`; calls `approvalsService.createApproval`; returns `{ mode: 'approval', approvalTitle, approvalId }`
- `packages/c3/src/screens/ApprovalInbox.tsx` — AddPerson PayloadSummary section added (renders fullName, ign, primaryRole, nationality, currentTeam, currentGameTitle, primaryDepartment, personnelCode, requestedBy, notes); `PartialAddPersonExecutionError` handler added

---

### Phase 5 — Parity and runtime

- `scripts/s18-parity-approvals.mjs` — APR-0004 seed record added (AddPerson, `TargetPersonID: 'PENDING-ADDPERSON'`, full payload); 10 new assertions added for AddPerson mapping and payload round-trip; count: 27 → 37
- Runtime rebuilt via `npm run beta:runtime`: 2395 modules, 1,812.35 kB (gzip: 402.43 kB)
- Runtime verified via `npm run verify:runtime`: SHA-256 hashes match

---

## Commit summary

| Hash | Phase | Type | Description |
|------|-------|------|-------------|
| `d8763ea` | All | feat | Add governed AddPerson foundation |
| `2020180` | Docs | docs | Close governed AddPerson sprint |
| `1159290` | Polish | fix | Populate AddPerson approval target placeholder |

HEAD at closeout: `1159290`
Preceding sprint HEAD: `cc88e92` (fix(s24-p1): Hide Intelligence in SP DSM)

### Polish fix: PENDING-ADDPERSON placeholder (commit `1159290`)

`C3Approvals.TargetPersonID` is a required field. At AddPerson submission time the person does not yet exist, so no `PER-XXXX` is available. The initial implementation used an empty string which SharePoint rejects with a choice validation error.

Fix: `useSubmitAddPersonApproval` now passes `targetPersonId: 'PENDING-ADDPERSON'`. After execution, `useExecuteApproval` calls `stampExecution` with the real `PER-XXXX`, and `SharePointApprovalsService.stampExecution` backfills `TargetPersonID` in the same MERGE. `IApprovalsService.StampExecutionRequest.Executed` gained an optional `targetPersonId?` field for this path. `MockApprovalsService` mirrors the backfill for test parity. Parity seed APR-0004 updated to use `PENDING-ADDPERSON`.

---

## Files changed

**New (3):**

| File | Description |
|------|-------------|
| `packages/c3/src/components/shared/AddPersonPanel.tsx` | Governed overlay drawer for AddPerson |
| `packages/c3/src/hooks/usePersonService.ts` | Mode-agnostic IPersonService accessor |
| `packages/c3/src/hooks/useSubmitAddPersonApproval.ts` | Mode-branching submission hook |

**Modified (13):**

| File | Change |
|------|--------|
| `packages/c3/src/types/people.ts` | `CreatePersonInput` type |
| `packages/c3/src/services/interfaces/approvalPayloads.ts` | `AddPersonApprovalPayload` + union |
| `packages/c3/src/services/interfaces/IApprovalsService.ts` | `AddPerson` operationType |
| `packages/c3/src/services/interfaces/IPersonService.ts` | `createPerson` method signature |
| `packages/c3/src/utils/approvalPayloadUtils.ts` | `humanizeAddPersonPayload` helper |
| `packages/c3/src/services/mock/MockPersonService.ts` | `createPerson` direct implementation |
| `packages/c3/src/services/sharepoint/SharePointPersonService.ts` | `createPerson` POST-then-MERGE |
| `packages/c3/src/hooks/useExecuteApproval.ts` | AddPerson dispatch + `PartialAddPersonExecutionError` |
| `packages/c3/src/components/shared/index.ts` | `AddPersonPanel` export |
| `packages/c3/src/screens/PeopleWorkspace.tsx` | Add Person button + panel mount |
| `packages/c3/src/screens/ApprovalInbox.tsx` | AddPerson PayloadSummary + error handler |
| `scripts/s18-parity-approvals.mjs` | APR-0004 seed + 10 AddPerson assertions |
| `packages/c3-spfx-host/.../c3-runtime.js` | Runtime rebuilt |

---

## Validation summary

All validation performed at closeout (HEAD: `d8763ea`).

| Validation | Result |
|------------|--------|
| `s18-parity-approvals.mjs` | ✓ 37/37 passed (was 27/27 before S25 — 10 new AddPerson assertions) |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc -b` (incremental build) | ✓ Clean |
| `npm run verify:runtime` | ✓ PASS — SHA-256: `ab6a19a66049c9d9c8a9134b6e031ec32ca5a77f05248f8e2981782fdf1c9976` |

---

## SharePoint lists involved

| List | Role in Sprint 25 | Schema change |
|------|-------------------|---------------|
| `C3People` | Write target for `createPerson` (POST-then-MERGE) | None — new rows created at execution time; existing schema unchanged |
| `C3Approvals` | Stores AddPerson approval records at submission time | None — `AddPerson` added to `OperationType` choice set (IT must add this value) |
| `C3Credentials` | No change in S25 | None |
| `C3Journeys` | No change in S25 | None |
| `C3Contracts` | No change in S25 | None |

**No SP list column schema changes in Sprint 25.**

**IT action required:** Add `AddPerson` to the `C3Approvals.OperationType` choice column values. Without this, AddPerson approval submissions will fail in hosted SP DSM (SP rejects the choice value).

---

## Tech debt changes in Sprint 25

| ID | Item | Status change |
|----|------|---------------|
| TD-24 | Email field missing from C3People SP list | New — Open / Deferred |

---

## Scope boundaries preserved

The following were not touched at any point during Sprint 25:

- No Induction implemented
- No contract writes (AddContract) implemented
- No mission, finance, or SaaS work
- No Contracts or Intelligence NavRail re-enable (unchanged from S24 state)
- No C3Credentials, C3Journeys, or C3Contracts schema changes
- No credential or journey behaviour changes
- No CI/CD pipeline

---

## Remaining known limitations

| Limitation | Risk |
|------------|------|
| `C3Approvals.OperationType` must include `AddPerson` in SP choice set | AddPerson submissions fail in hosted SP DSM until IT adds the value |
| Email field absent from C3People SP list (TD-24) | Operators cannot store or view email addresses in C3 |
| `C3Contracts` not yet provisioned in SP DSM | Contracts and Intelligence remain hidden in SP DSM (unchanged from S24) |
| Intelligence cold-load crash in SP DSM (TD-23) | Intelligence hidden in SP DSM; fully functional in Mock DSM (unchanged from S24) |
| Legacy `C3_Contracts` data not migrated (TD-22) |