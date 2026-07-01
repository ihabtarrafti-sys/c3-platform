# C3 Architecture Baseline — Sprint 20
**C3 Contract Control Center**
**Sprint:** 20 — Approval History, Partial Execution Recovery, and Credential Write Path
**Baseline date:** 2026-07-01
**Status:** CLOSED — 2026-07-01

---

## Closeout statement

Sprint 20 closes as:

> **"C3 now supports two governed operational write paths through ADR-013: Journey initiation (live since Sprint 18) and Credential creation (live Sprint 20). C3Approvals is the governance trail for both. C3Journeys and C3Credentials rows are written only after a Platform Owner has approved and executed the corresponding C3Approvals record. The full approval audit history — Executed, Rejected, and Failed records — is visible in-app in the Approval Inbox. Operators can recover from partial execution failures (PartialExecutionError) without manual SP intervention. SP DSM is the beta operational path. Mock DSM remains the demo and regression baseline. Real SP group role resolution is active. APR-XXXX, JRN-XXXX, and CRED-XXXX identifiers are all derived from SharePoint's atomic server-assigned item IDs. The Approval Inbox is both the work queue and the audit/history surface."**

---

## Section 1 — Architectural shifts introduced in Sprint 20

### Before Sprint 20 (Sprint 19 baseline)

- `ApprovalInbox` showed all approvals in a flat list with no filtering. Executed and Rejected records were not visible from within C3 — operators had to query SP directly to review audit history.
- `PartialExecutionError` (C3Journeys row created, Executed stamp failed) required manual SP intervention to set `ApprovalStatus = Executed` on the stranded C3Approvals record.
- `addCredential` was stub-throwing in SP DSM. No credential write path existed through the ADR-013 approval loop.
- `PersonProfile` gated Add Credential with `!isSpReadOnly`. `useSpReadOnly` returns `config.dataSourceMode === 'sharepoint'`, which is always `true` in SP DSM — Add Credential was permanently hidden.
- `PeopleWorkspace` navigated to PersonProfile with `personId: String(person.Id)` (integer string, e.g. `"1"`). `SharePointPersonService.getPerson` filters on `Title eq '...'` (canonical `PER-XXXX`) — integer string found no record, causing the "Could not load person" error state. Mock worked due to an OR lookup in `MockPersonService.getPerson`.

### After Sprint 20

**1. Approval history and audit detail (Phase 1)**

`ApprovalInbox` now fetches all statuses in a single `listApprovals` call and applies client-side tab filtering. Six tabs: Pending / Approved / Executed / Rejected / Failed / All. Tab counts are displayed in labels. `ReviewedAt`, `RejectionReason`, and `ExecutionError` are surfaced in card detail views. A `PayloadSummary` sub-component renders structured `InitiateJourney` payload fields (and `AddCredential` payload fields added in Phase 3). Malformed JSON renders a labelled error with a raw-payload disclosure block — no crash path.

**2. Partial execution recovery (Phase 2)**

`useRecoverExecutionStamp` is a stamp-only mutation hook. It never calls `initiateJourney`. It is invoked from `ApprovalInbox` when an Approved + InitiateJourney card is detected with a pre-existing active journey (indicating the Execute previously succeeded in creating the journey but failed to stamp the approval). Pre-condition guards run at hook invocation; a safety re-check of `getActiveJourney` runs at stamp time to guard against races. If the journey is missing at stamp time, `RecoveryTargetMissingError` is thrown and no write is attempted. `useActiveJourney` gained an optional `enabled` parameter to support the lazy query pattern used by `ApprovalInbox`.

**3. Governed credential write path (Phase 3)**

`AddCredential` is the second governed operation type in C3Approvals. The write path mirrors `InitiateJourney`:

```
SP DSM path:
  AddCredentialPanel
    → useSubmitCredentialApproval (SP branch)
    → SharePointApprovalsService.createApproval({ operationType: 'AddCredential', payload: JSON })
    → POST-then-MERGE → APR-XXXX (C3Approvals, Submitted)
  Platform Owner: Approve → Execute
    → useExecuteApproval dispatches AddCredential branch
    → SharePointCredentialService.addCredential (POST-then-MERGE → CRED-XXXX)
    → stampExecution('Executed')

Mock DSM path (unchanged):
  AddCredentialPanel
    → useSubmitCredentialApproval (mock branch)
    → useAddCredential.mutateAsync (direct write)
```

Key differences from `InitiateJourney`:
- No duplicate guard: multiple credentials of the same type are valid per person
- `PartialCredentialExecutionError` thrown when CRED row is created but Executed stamp fails (no in-app recovery path — deferred)
- `CRED-XXXX` identifiers from POST-then-MERGE using SP auto-ID — same atomicity guarantee as APR/JRN

**4. PersonID routing and capability gate (Phase 3 fix)**

`PeopleWorkspace` now passes `person.PersonID` (canonical `PER-XXXX`) to PersonProfile navigation. `PersonProfile` gates Add Credential via `canCreate` from `useCapabilities()` — true for `owner` and `operations` roles, false for all others. The `useSpReadOnly` hook is no longer used in `PersonProfile`.

---

## Section 2 — New components delivered in Sprint 20

### ErrorBoundary.tsx

`packages/c3/src/components/ErrorBoundary.tsx`

React class component. `getDerivedStateFromError` + `componentDidCatch` with console logging. C3-branded fallback: error title, description, error detail block, Reload button. Inline token fallbacks ensure the boundary renders even if the token provider crashed. Placed inside `<main>` in `AppShell.tsx` so NavRail remains functional on screen crash.

### useRecoverExecutionStamp.ts

`packages/c3/src/hooks/useRecoverExecutionStamp.ts`

TanStack Query `useMutation`. Stamp-only recovery for `PartialExecutionError` cases. Never creates a new journey. Pre-conditions: `approvalStatus === 'Approved'`, `operationType === 'InitiateJourney'`, parseable `personId` in payload. Safety re-check: `getActiveJourney(personId, 'Onboarding')` at stamp time. Exported error classes: `RecoveryPreConditionError`, `RecoveryTargetMissingError`. `onSuccess` invalidates `approvals.all()`, `journey.list`, `journey.active`, `journey.allActive`.

### useSubmitCredentialApproval.ts

`packages/c3/src/hooks/useSubmitCredentialApproval.ts`

Mode-branching hook. SP DSM: calls `approvalsService.createApproval({ operationType: 'AddCredential', ... })` and returns `{ mode: 'approval', approvalTitle, approvalId }`. Mock DSM: calls `addCredential.mutateAsync(input)` and returns `{ mode: 'direct', credential }`. `AddCredentialPanel` renders the appropriate success toast based on the outcome mode.

### AddCredentialApprovalPayload

`packages/c3/src/services/interfaces/approvalPayloads.ts`

Discriminated union member for `ApprovalPayload`:

```ts
interface AddCredentialApprovalPayload {
  operationType: 'AddCredential';
  holderPersonId: string;
  credentialType: string;      // one of VALID_CREDENTIAL_TYPES
  referenceNumber: string;     // required
  issuedBy?: string;
  issuedDate?: string;
  expiryDate?: string;
  validFromDate?: string;
  subType?: string;
  notes?: string;
  supersedesCredentialId?: string;
}
```

`ApprovalPayload = InitiateJourneyApprovalPayload | AddCredentialApprovalPayload`

### SharePointCredentialService — addCredential

`packages/c3/src/services/sharepoint/SharePointCredentialService.ts`

`addCredential(input: CreateCredentialInput)` — POST-then-MERGE pattern:
1. Validate `CredentialType` against `VALID_CREDENTIAL_TYPES` (18 values)
2. Fetch form digest
3. POST with `TMP-<Date.now().toString(36)>` placeholder Title + all credential fields + `IsActive: true`
4. Extract SP integer ID → `credentialId = 'CRED-' + String(ID).padStart(4, '0')`
5. MERGE `Title = credentialId` with fresh digest
6. GET by SP ID to confirm write
7. Map and return `Credential`

### PartialCredentialExecutionError

`packages/c3/src/hooks/useExecuteApproval.ts`

```ts
class PartialCredentialExecutionError extends Error {
  override readonly name = 'PartialCredentialExecutionError';
  constructor(credentialId: string, approvalId: number, cause: unknown) { ... }
}
```

Thrown when C3Credentials row is created but `stampExecution('Executed')` fails. Parallel to `PartialExecutionError` for journeys. No in-app recovery path implemented (deferred, noted in TD-13).

---

## Section 3 — Runtime architecture (confirmed state after Sprint 20)

### SharePoint service registry

| Service | SP mode behaviour | State after S20 |
|---------|-------------------|-----------------|
| Role resolution | `/_api/web/currentUser/groups` → C3 role at mount | Live (S19) |
| Approvals — `createApproval` | POST-then-MERGE → APR-XXXX via SP item ID; supports `InitiateJourney` + `AddCredential` | Live (S18, extended S20) |
| Approvals — `listApprovals` | Reads C3Approvals — all statuses | Live (S18) |
| Approvals — `patchApprovalStatus` | MERGE Approve/Reject | Live (S18) |
| Approvals — `stampExecution` | MERGE Executed/ExecutionFailed | Live (S18) |
| Journeys (read) | Reads C3Journeys | Live (S17) |
| Journeys — `initiateJourney` | POST-then-MERGE → JRN-XXXX via SP item ID | Live (S18, hardened S19) |
| Journeys — `completeJourney` | GET→guard→PATCH; `CompletedAt` + Notes | Live (S19) |
| Journeys — `suspendJourney` | GET→guard→PATCH; Notes | Live (S19) |
| Journeys — `resumeJourney` | GET→guard→PATCH; Notes | Live (S19) |
| Journeys — `cancelJourney` | GET→guard→PATCH; Notes | Live (S19) |
| People | Reads C3People | Live (S16) |
| Credentials (read) | Reads C3Credentials | Live (S15) |
| Credentials — `addCredential` | POST-then-MERGE → CRED-XXXX via SP item ID | Live (S20) |
| Credentials — `deactivateCredential` | Stub-throwing | Deferred — Sprint 21+ |
| Contracts | Returns `[]` graceful stub | Deferred — SP-02 |
| Missions | Returns `[]` graceful stub | Deferred — future sprint |
| Milestones | Returns `[]` graceful stub | Deferred — future sprint |
| Finance | Returns `[]` graceful stub | Deferred — future sprint |

### Data source modes

**Mock DSM** — demo and regression baseline. All writes are direct in-memory. Add Credential is a direct `addCredential` write. No approval gate. All write surfaces visible. `canCreate` capability gate applies (owner + operations see Add Credential).

**SP DSM** — beta operational path. Journey initiation and credential creation gated by ADR-013 approval loop. Journey lifecycle transitions are direct role-gated PATCH operations (ADR-013 Addendum). Role resolved from SP security-group membership at mount. Add Credential visible to `owner` and `operations` roles.

### SP write patterns

**Sequence-generating write (APR/JRN/CRED creation) — POST-then-MERGE:**
```
1. GET /_api/contextinfo → form digest (D1)
2. POST /_api/web/lists/getbytitle('LIST')/items   Title=TMP-<base36>  (creates row; server assigns ID)
3. GET /_api/contextinfo → form digest (D2, fresh — D1 consumed by POST)
4. POST /_api/web/lists/getbytitle('LIST')/items(ID)
   + X-HTTP-Method: MERGE + IF-MATCH: *
   Title=APR-XXXX | JRN-XXXX | CRED-XXXX
```

**Lifecycle transition write — GET-then-MERGE (journeys only):**
```
1. GET item by Title → current Status, Notes
2. isValidTransition(currentStatus, action) — throw if invalid
3. Fail-close: throw if actorLoginName empty
4. GET /_api/contextinfo → form digest
5. PATCH (MERGE + IF-MATCH: *)  { Status, [CompletedAt], Notes: currentNotes + audit line }
```

All requests: `credentials: 'same-origin'`. No PnP.js.

---

## Section 4 — Governance model (confirmed after Sprint 20)

### Write category matrix

| Operation | Pattern | Gate |
|-----------|---------|------|
| Initiate journey | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Add credential | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Complete/Suspend/Resume/Cancel journey | Direct role-gated PATCH | `owner` or `operations` role only |
| Deactivate credential (future) | ADR-013 approval loop (planned S21) | Same gate pattern |
| All other write surfaces | Stub-throwing | Not yet implemented |

### Role capabilities

| Role | Submit approval | Manage journey lifecycle | Approve/Reject | Execute approval |
|------|----------------|--------------------------|----------------|-----------------|
| `owner` | Yes (`canCreate`) | Yes | Yes | Yes |
| `operations` | Yes (`canCreate`) | Yes | No | No |
| `management` | No | No | No | No |
| `hr` / `legal` / `finance` | No | No | No | No |
| `visitor` | No | No | No | No |

### Identifier format

| Entity | Format | Source |
|--------|--------|--------|
| Approval | `APR-XXXX` | SP auto-ID (C3Approvals) — zero-padded to 4 digits |
| Journey | `JRN-XXXX` | SP auto-ID (C3Journeys) — zero-padded to 4 digits |
| Credential | `CRED-XXXX` | SP auto-ID (C3Credentials) — zero-padded to 4 digits |

### Audit trail (beta state)

- Journey initiation: `C3Approvals` row (permanent record of proposal, review, execution)
- Credential creation: `C3Approvals` row (same lifecycle)
- Journey lifecycle transitions: `Notes` field append with `[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]`
- Dedicated audit columns (`SuspendedAt`, `CancelledAt`, etc.) deferred to Sprint 21 schema work
- Approval history: visible in-app in ApprovalInbox (Executed/Rejected/Failed tabs)

---

## Section 5 — Parity baselines (confirmed Sprint 20 closeout)

| Harness | Result |
|---------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |

Baselines unchanged from Sprint 19. No parity harnesses were modified in Sprint 20.

---

## Section 6 — What is deferred to Sprint 21 and beyond

### Journey lifecycle audit columns (Sprint 21, schema change)

`SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` columns do not exist in `C3Journeys`. Notes-append is the audit bridge for beta. Sprint 21 should provision these columns and update `SharePointJourneyService` to write structured fields.

### Credential deactivation (Sprint 21)

`deactivateCredential` is stub-throwing. The next governed credential write surface. ADR-013 gate applies; requires a `DeactivateCredential` operation type in `C3Approvals.OperationType`.

### PartialCredentialExecutionError recovery UX (Sprint 21)

No in-app recovery path exists for `PartialCredentialExecutionError` (CRED row created, Executed stamp failed). Parallel to the journey recovery path delivered in Sprint 20. Detection logic: Approved + AddCredential card where a CRED row with matching holderPersonId and credentialType already exists.

### Contracts/SP-02 (separate workstream)

FK mismatch unresolved. Returns `[]` gracefully.

### CI bundle pipeline (ongoing)

Manual `npm run build:runtime` + bundle commit after every change. Not in the C3 sprint sequence.

---

## Section 7 — File inventory (Sprint 20 additions and modifications)

| File | Status | Notes |
|------|--------|-------|
| `packages/c3/src/components/ErrorBoundary.tsx` | New | React error boundary with C3-branded fallback |
| `packages/c3/src/components/layout/AppShell.tsx` | Modified | ErrorBoundary wrap around renderScreen() |
| `packages/c3/src/components/layout/NavRail.tsx` | Modified | visibleWhen signature extended; Amendments gated in SP DSM |
| `packages/c3/src/hooks/useOperationalGaps.ts` | Modified | error field added |
| `packages/c3/src/hooks/useMissions.ts` | Modified | error field added |
| `packages/c3/src/hooks/useAllMilestones.ts` | Modified | error field added |
| `packages/c3/src/hooks/useAllMissionParticipants.ts` | Modified | error field added |
| `packages/c3/src/hooks/useWorkItems.ts` | Modified | error threaded through result |
| `packages/c3/src/screens/CommandCenter.tsx` | Modified | error EmptyState before empty-queue check |
| `packages/c3/src/hooks/useActiveJourney.ts` | Modified | optional enabled parameter |
| `packages/c3/src/hooks/useRecoverExecutionStamp.ts` | New | Stamp-only recovery mutation hook |
| `packages/c3/src/screens/ApprovalInbox.tsx` | Modified (major) | 6-tab history, PayloadSummary, recovery candidate UX, AddCredential summary |
| `packages/c3/src/services/interfaces/approvalPayloads.ts` | Modified | AddCredentialApprovalPayload + widened union |
| `packages/c3/src/services/interfaces/IApprovalsService.ts` | Modified | operationType union widened |
| `packages/c3/src/utils/spCredentialMapper.ts` | Modified | VALID_CREDENTIAL_TYPES exported |
| `packages/c3/src/services/sharepoint/SharePointCredentialService.ts` | Modified | addCredential POST-then-MERGE |
| `packages/c3/src/hooks/useSubmitCredentialApproval.ts` | New | Mode-branching credential submission hook |
| `packages/c3/src/hooks/useExecuteApproval.ts` | Modified | AddCredential dispatch branch + PartialCredentialExecutionError |
| `packages/c3/src/components/shared/AddCredentialPanel.tsx` | Modified | SP/mock mode branch; submit label; outcome toast |
| `packages/c3/src/screens/PeopleWorkspace.tsx` | Modified | Canonical PersonID routing fix (person.PersonID) |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | canCreate guard replaces !isSpReadOnly |
| `docs/architecture/C3 Tech Debt Register.md` | Modified | TD-11 resolved (S20-P2), TD-13 resolved with caveat (S20-P3) |
| `docs/architecture/Sprint 20 Closeout Report.md` | New | Sprint closeout |
| `docs/architecture/C3 Architecture Baseline — Sprint 20.md` | New | This document |
| `docs/architecture/C3 Beta Checkpoint — Sprint 20.md` | New | Updated beta validation checklist |
| `packages/c3-spfx-host/src/.../c3-runtime.js` | Modified | Rebuilt after Phase 0, Phase 1, and Phase 3 fix |
