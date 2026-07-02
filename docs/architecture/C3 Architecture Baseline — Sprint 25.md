# C3 Architecture Baseline — Sprint 25
**C3 Contract Control Center**
**Sprint:** 25 — Governed AddPerson Foundation
**Baseline date:** 2026-07-02
**Status:** CLOSED — 2026-07-02

---

## Closeout statement

Sprint 25 closes as:

> **"C3 has a governed write path for creating new C3People records. In SP DSM, `AddPersonPanel` submits an AddPerson approval (ADR-013) — no direct SP write occurs from the UI. A Platform Owner reviews and executes the approval in ApprovalInbox; `SharePointPersonService.createPerson` uses POST-then-MERGE to create the row and assign a canonical PER-XXXX code. In Mock DSM, `MockPersonService.createPerson` creates the person directly. `PartialAddPersonExecutionError` handles the partial-execution case. TD-24 added: Email is absent from the C3People SP list schema. Contracts and Intelligence remain hidden in SP DSM (unchanged from S24)."**

---

## Section 1 — Architectural shifts introduced in Sprint 25

### Before Sprint 25 (Sprint 24 baseline)

- `IPersonService.createPerson` did not exist — no write path for C3People records
- Adding a person required an operator to directly create a row in the `C3People` SP list
- `C3Approvals.OperationType` did not include `AddPerson`
- `ApprovalInbox` had no PayloadSummary branch for `AddPerson`
- `useExecuteApproval` had no dispatch branch for `AddPerson`
- `PeopleWorkspace` had no "Add Person" button or panel

### After Sprint 25

**1. AddPerson domain model**

`CreatePersonInput` type (all fields optional except `FullName`):

```ts
interface CreatePersonInput {
  FullName: string;
  IGN?: string;
  PrimaryRole?: string;
  Nationality?: string;
  PersonnelCode?: string;
  CurrentTeam?: string;
  CurrentGameTitle?: string;
  PrimaryDepartment?: string;
  Notes?: string;
}
```

`AddPersonApprovalPayload` extends the `ApprovalPayload` union with `operationType: 'AddPerson'`
and carries all `CreatePersonInput` fields plus `requestedBy`.

`IPersonService.createPerson(input: CreatePersonInput): Promise<Person>` is the write-path method.

**2. Submission model (ADR-013 governed)**

`useSubmitAddPersonApproval` branches on `config.dataSourceMode`:

```
Mock DSM:
  personService.createPerson(input)
  → person created immediately in mock store
  → queryKeys.people.all() invalidated
  → returns { mode: 'direct', person }

SP DSM:
  approvalsService.createApproval({
    operationType: 'AddPerson',
    targetPersonId: '',   // person does not exist yet
    reason: 'Create new person: ${input.FullName}',
    payload: JSON.stringify(AddPersonApprovalPayload),
  })
  → returns { mode: 'approval', approvalTitle, approvalId }
  → NO C3People row created at submission time
```

**3. SharePointPersonService.createPerson — POST-then-MERGE**

Mirrors the established pattern from `SharePointCredentialService.addCredential` and `SharePointJourneyService.createJourney`:

```
Step 1: POST { Title: 'TMP-<timestamp>', FullName, ... } to C3People
        → receive SP item integer ID (e.g. 42)

Step 2: Derive canonical PersonID:
        PER-XXXX = 'PER-' + String(id).padStart(4, '0')  (e.g. 'PER-0042')

Step 3: MERGE { Title: 'PER-0042' } back onto the same SP item
        → row now has canonical PersonID in the Title column

Step 4: Return constructed Person object
```

SP atomic item ID is the sequence source. No sequence collision risk. No pre-derive step.

**4. Execution path in useExecuteApproval**

`useExecuteApproval` dispatches on `operationType`:

```
operationType === 'AddPerson':
  1. Parse AddPersonApprovalPayload from approval.payload
  2. personService.createPerson(payload) → new Person with PER-XXXX
  3. approvalsService.stampExecution(approvalId) → Executed
  On step-2 success + step-3 failure: throw PartialAddPersonExecutionError
```

`PartialAddPersonExecutionError` is exported from `useExecuteApproval` and handled in `ApprovalInbox` with a named error toast (same pattern as `PartialCredentialExecutionError` and `PartialDeactivationExecutionError`).

**5. AddPersonPanel — governed overlay drawer**

`AddPersonPanel` is a Fluent UI `OverlayDrawer` (position: end, size: medium):

- Required field: Full Name
- Optional fields: IGN, Primary Role, Nationality, Current Team, Current Game Title, Primary Department, Notes / Reason
- SP DSM: Submit for Approval button; governance `MessageBar` (info intent) explaining the approval step
- Mock DSM: Add Person button; no MessageBar
- Both modes: success toast, form reset, panel close on completion
- Error MessageBar shown on submission failure
- Disabled during `isPending`
- No Email field (TD-24)

`AddPersonPanel` is gated by `capabilities.canCreate` — Platform Owners and Operations roles only.

**6. PeopleWorkspace Add Person button**

`PageHeader` now accepts an `actions` slot. `PeopleWorkspace` passes an "Add Person" button
(icon: `PersonAdd20Regular`) in that slot, gated by `capabilities.canCreate`. The panel is mounted
conditionally at the bottom of the screen render. Visitors see no button.

**7. ApprovalInbox — AddPerson PayloadSummary and error handler**

`PayloadSummary` component in `ApprovalInbox` now has an `AddPerson` branch that renders:
fullName, ign, primaryRole, nationality, currentTeam, currentGameTitle, primaryDepartment,
personnelCode, requestedBy, notes. Each field renders only when non-empty.

`PartialAddPersonExecutionError` is caught in `handleExecute` and surfaces a named toast.

---

## Section 2 — Data layer after Sprint 25

### SP lists read/written by C3 (SP DSM)

| List | Read operations | Write operations | Sprint introduced |
|------|----------------|-----------------|-------------------|
| `C3People` | `listPeople`, `getPerson`, `listPersonContracts` | `createPerson` (POST+MERGE) | S16 read / **S25 write** |
| `C3Credentials` | `listCredentialsForPerson`, `getCredential` | `addCredential` (POST+MERGE), `deactivateCredential` (MERGE) | S20/S23 |
| `C3Approvals` | `listApprovals`, `getApproval` (stub) | `submitApproval` (POST), `approveApproval` (MERGE), `stampExecution` (MERGE) | S18 |
| `C3Journeys` | `listAllActiveJourneys`, `getJourney` | `createJourney` (POST), lifecycle transitions (MERGE) | S18/S19 |
| `C3Contracts` | `listContracts`, `listRenewalContracts`, `getContract` | None | S24 |

### PersonID FK model (unchanged)

```
C3People.Title (PersonID)  ←───────────────────────────────────────────────────┐
C3Credentials.PersonID     (plain text FK)  ──────────────────────────────────┘
C3Approvals.TargetPersonID (plain text FK)  ──────────────────────────────────┘
C3Journeys.PersonID        (plain text FK)  ──────────────────────────────────┘
C3Contracts.PersonID       (plain text FK)  ──────────────────────────────────┘
```

`C3Approvals.TargetPersonID` is empty string for AddPerson approvals at submission time
(person does not yet exist). It is not backfilled after execution.

### POST-then-MERGE pattern — all write services

```
C3People.createPerson      POST TMP-<ts>  →  MERGE PER-XXXX  (S25)
C3Credentials.addCredential POST TMP-<ts> →  MERGE CRED-XXXX (S20)
C3Journeys.createJourney   POST TMP-<ts>  →  MERGE JRN-XXXX  (S18)
C3Approvals.createApproval POST APR-<pad> →  canonical Title  (S18)
```

All sequence IDs are derived from the SP atomic item integer ID. No pre-derive collision risk.

---

## Section 3 — NavRail visibility matrix (SP DSM)

Unchanged from Sprint 24.

| Screen | SP DSM | Mock DSM | Guard rationale |
|--------|--------|----------|-----------------|
| Command Center | ✅ | ✅ | Always visible |
| Contracts | ❌ | ✅ | Pending IT provisioning + smoke test (S24-P1 guard) |
| People | ✅ | ✅ | Live S16 |
| Renewals | ✅ (non-visitor) | ✅ | Live S24 (read only) |
| Amendments | ❌ | ✅ | SP service stub (S20 guard) |
| Inbox | ✅ (non-visitor) | ✅ | Live S18 |
| Situation Room | ✅ | ✅ | Live S17 |
| Intelligence | ❌ | ✅ | Cold-load crash containment (TD-23, S24-P1 guard) |
| Approvals | ✅ (non-visitor) | ✅ | Live S18 |
| Settings | ✅ (canManageSettings) | ✅ | Live S15 |
| Diagnostics | ✅ | ✅ | Always visible |

**People Workspace — Add Person button visibility:**

| Role | Add Person button visible |
|------|--------------------------|
| owner | ✅ (canCreate = true) |
| operations | ✅ (canCreate = true) |
| visitor | ❌ (canCreate = false) |

---

## Section 4 — Hook inventory after Sprint 25

### New hooks (S25)

| Hook | Source | Description |
|------|--------|-------------|
| `usePersonService` | `@c3/hooks/usePersonService` | Returns mode-appropriate `IPersonService` implementation |
| `useSubmitAddPersonApproval` | `@c3/hooks/useSubmitAddPersonApproval` | Mode-branching submission hook; returns `AddPersonSubmissionOutcome` |

### Updated hooks (S25)

| Hook | Change |
|------|--------|
| `useExecuteApproval` | AddPerson dispatch branch + `PartialAddPersonExecutionError` export |

### Unchanged hooks (S24 baseline)

`useCredentials`, `useGetCredential`, `usePeople`, `useContracts`, `useRenewalContracts`,
`useAmendments`, `useApp`, `useSP`, `useCapabilities`, `useSubmitCredentialApproval`,
`useSubmitDeactivationApproval`, `useRecoverCredentialExecutionStamp`,
`useRecoverDeactivationExecutionStamp`, `usePersonApprovals`, `useMissions`, `useJourney`,
`useStartJourney`, `useApproveApproval`, `useRejectApproval`, `useIntelligence`

---

## Section 5 — Tech debt register state after Sprint 25

| ID | Item | Status |
|----|------|--------|
| TD-07 | No server-side TargetPersonID filter | Open |
| TD-13 | Credential write path | 🔵 Partial — AddCredential + DeactivateCredential live; reactivate pending |
| TD-14 | No CI/CD pipeline | Open |
| TD-15 | Runtime bundle committed to git | 🔵 Partial mitigation S21-P4 |
| TD-16 | ToasterGuard workaround | Open |
| TD-17 | No license file | Open |
| TD-19 | Approval list $top=500 truncation | Open |
| TD-21 | No journey audit timestamp columns | Open |
| TD-22 | Legacy C3_Contracts not migrated | Open / Deferred |
| TD-23 | Intelligence SP DSM cold-load crash | Open / Deferred (contained) |
| TD-24 | Email field missing from C3People SP list | Open / Deferred |

---

## Section 6 — Runtime bundle state

| Attribute | Value |
|-----------|-------|
| Bundle SHA-256 | `ab6a19a66049c9d9c8a9134b6e031ec32ca5a77f05248f8e2981782fdf1c9976` |
| Bundle size | 1,812.35 kB (gzip: 402.43 kB) |
| Module count | 2395 |
| Verified with | `npm run verify:runtime` |
| Built at HEAD | `d8763ea` |
