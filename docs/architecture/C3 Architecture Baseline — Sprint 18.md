# C3 Architecture Baseline — Sprint 18
**C3 Contract Control Center**
**Sprint:** 18 — Governed SharePoint Write Operations
**Baseline date:** 2026-06-30
**Status:** CLOSED — 2026-06-30

---

## Closeout statement

Sprint 18 closes as:

> **"C3 now performs live governed writes against SharePoint. The ADR-013 approval gate is operational: ops staff submit Start Onboarding Journey proposals, Platform Owners approve or reject them in the C3 Approvals inbox, and approved proposals are executed to produce real C3Journeys rows. C3Approvals is the permanent audit record for every write decision."**

Sprint 18 does **not** close as:

> ~~"C3 role resolution is production-grade."~~
> ~~"Journey state transitions (complete, suspend, cancel) are live."~~
> ~~"Credential writes are live."~~
> ~~"Real-time notifications are implemented."~~

---

## Section 1 — Architectural shift introduced in Sprint 18

### Before Sprint 18 (Sprint 17 baseline)

All write surfaces in SP mode were hidden by `useSpReadOnly`. C3 performed zero writes against SharePoint. The SP data layer was read-only in production. Mock mode retained direct writes to in-memory state.

### After Sprint 18

C3 performs **controlled SharePoint operational writes** through the ADR-013 governed write model.

**Core principle (ADR-013):** Every write that modifies production SharePoint data must pass through an approval record in `C3Approvals` before any operational list is touched. There are no direct UI writes in SP mode.

**Operational-truth writes are no longer direct UI writes.** A user's intent (Start Onboarding Journey) produces a proposal, not an immediate database row. The journey row is created only after a second, independently authorized actor approves the proposal and an operator triggers execution.

**The approval is the audit record.** `C3Approvals` carries who proposed, who reviewed, when, and what the operation contained (`Payload` column). This record is retained permanently regardless of outcome (Approved/Rejected/Executed/ExecutionFailed).

**C3Journeys writes are gated.** A new row in `C3Journeys` is only created by `useExecuteApproval` after an approval reaches `Executed` state. No path in SP mode bypasses this gate.

**C3Approvals is the governance trail.** Every approval lifecycle transition (Submitted → InReview → Approved/Rejected → Executed/ExecutionFailed) is recorded in the `C3Approvals` list as a series of SP PATCH operations with reviewer identity and timestamps.

---

## Section 2 — New components delivered in Sprint 18

### Service layer

**`IApprovalsService`** (`packages/c3/src/services/interfaces/IApprovalsService.ts`)

Interface for all C3Approvals CRUD:
- `createApproval(req)` — creates Submitted record
- `listApprovals(filter)` — queries by status filter; returns typed `C3Approval[]`
- `patchApprovalStatus(id, req)` — Approved or Rejected transition; sets ReviewedBy/ReviewedAt
- `stampExecution(id, req)` — Executed (sets ExecutedAt) or ExecutionFailed (sets ExecutionError, no ExecutedAt); enforced by `StampExecutionRequest` discriminated union

**`MockApprovalsService`** (`packages/c3/src/services/mock/MockApprovalsService.ts`)

In-memory implementation seeded with six lifecycle-state records. Used in mock DSM; gate-free journey creation path unchanged.

**`SharePointApprovalsService`** (`packages/c3/src/services/sharepoint/SharePointApprovalsService.ts`)

Live SP implementation. Native `fetch`, same-origin, form-digest fetched fresh per write. Shared `mergeItem()` helper for PATCH operations.

**`SharePointJourneyService.initiateJourney`** — implemented (was throwing stub since S17)

Creates a new C3Journeys row via SP REST POST. Derives JRN-XXXX sequence from last list item. Maps 13 columns. SP reserved-word compliance: `JourneyType` column (not `Type`). `ObligationAssignmentsJSON` column stores assignments as JSON string.

### Mapper

**`spApprovalMapper.ts`** (`packages/c3/src/utils/spApprovalMapper.ts`)

Pure SP REST → `C3Approval` mapper. Hard-rejects on missing Title or unknown `ApprovalStatus`; soft-warns on missing `Payload`. Returns `{ approvals, result }` including diagnostic counters (fetched, mapped, rejected, warnings).

### Hook layer

**`useApprovalsService`** (`packages/c3/src/hooks/useApprovalsService.ts`)

Parallel-factory hook; selects SP vs mock implementation via `config.dataSourceMode`.

**`useListApprovals`** (`packages/c3/src/hooks/useListApprovals.ts`)

TanStack Query `useQuery`; accepts status filter and `refetchInterval` (default 30 s). Stale time 15 s.

**`usePatchApprovalStatus`** (`packages/c3/src/hooks/usePatchApprovalStatus.ts`)

TanStack Query `useMutation`. Enforces self-approval guard (`SelfApprovalError`). Invalidates `queryKeys.approvals.all()` on success.

**`useExecuteApproval`** (`packages/c3/src/hooks/useExecuteApproval.ts`)

TanStack Query `useMutation`. Coordinates `approvalsService` + `journeyService` at hook layer. Five-step guard sequence (ADR-013 §Execution). Error classes: `DuplicateJourneyError`, `PayloadValidationError`, `PartialExecutionError`.

**`useSubmitJourneyApproval`** (`packages/c3/src/hooks/useSubmitJourneyApproval.ts`)

Mode-branching hook. Mock: calls `useInitiateJourney` directly. SP: calls `approvalsService.createApproval`. Returns `SubmissionOutcome` discriminant.

### Query keys

**`queryKeys.approvals`** added to `queryKeys.ts`:
```typescript
approvals: {
  all: () => ['approvals'] as const,
  list: (filter?) => ['approvals', 'list', filter] as const,
}
```

### UI

**`ApprovalInbox`** screen (`packages/c3/src/screens/ApprovalInbox.tsx`)

Status-to-action matrix:
- Submitted / InReview → Approve + Reject (owner only)
- Approved → Execute (owner only; badge: brand/purple)
- Rejected / Executed / ExecutionFailed → read-only

30-second background polling via `useListApprovals` default `refetchInterval`.

Badge color intent: Submitted = warning (orange), InReview = informative (blue), Approved = brand (purple — awaiting execution), Executed = success (green — terminal), Rejected = danger (red), ExecutionFailed = danger (red).

**NavRail entry:** `ShieldTaskRegular` icon, visible to all roles except `visitor`.

**`StartJourneyPanel`** updated: SP mode shows "Awaiting approval" banner after submission; mock mode unchanged.

### Host

**`SharePointHost.tsx`** — c3Role hardcoded `'owner'` (beta stub; prominent `⚠ WARNING` comment with go-live gate wording).

**`currentUser.loginName`** — populated from `pageContext.user.loginName` via SPFx host chain (`IC3HostProps → C3HostWebPart → C3Host → HostContext.userLoginName → SharePointHost`).

### Types

**`C3Screen` union** — `{ id: 'approvals' }` added.

**`StampExecutionRequest` discriminated union** — `ExecutionFailed` branch has `executedAt?: null` (TypeScript enforces no timestamp on failed executions).

**`InitiateJourneyApprovalPayload`** — serialised into `C3Approvals.Payload`; deserialised at execution time.

### New SharePoint list

**`C3Approvals`** — Provisioned in Phase 0 pre-work. Schema: `docs/architecture/C3Approvals SP List Schema.md`. Permanent audit ledger; records never deleted.

---

## Section 3 — Runtime architecture (confirmed state after Sprint 18)

### SharePoint service registry

| Service | SP mode behaviour | State after S18 |
|---------|-------------------|-----------------|
| Approvals | Calls live `C3Approvals` SP list | Live (S18) |
| Journeys (read) | Calls live `C3Journeys` SP list | Live (S17) |
| Journeys — `initiateJourney` | Creates new row in `C3Journeys` via approval gate | Live (S18) |
| Journeys — `completeJourney` / `suspendJourney` / `cancelJourney` | Stub-throwing | Deferred — Sprint 19 |
| People | Calls live `C3People` SP list | Live (S16) |
| Credentials (read) | Calls live `C3Credentials` SP list | Live (S15) |
| Credentials (write) | Stub-throwing | Deferred — Sprint 20+ |
| Contracts | Returns `[]` graceful stub | Deferred — SP-02 |
| Missions | Returns `[]` graceful stub | Deferred — future sprint |
| Milestones | Returns `[]` graceful stub | Deferred — future sprint |
| Finance | Returns `[]` graceful stub | Deferred — future sprint |

### Data source modes

**Mock DSM** — demo and regression baseline. All writes are direct in-memory; no approval gate. Journey creation in mock mode is gate-free. All write surfaces visible.

**SP DSM** — beta operational path. All write surfaces gated by ADR-013 approval loop. Only `initiateJourney` is executable via C3 in SP mode. All other write surfaces remain hidden.

### SP write pattern (all Sprint 18 writes)

```
GET /_api/contextinfo → form digest
POST /_api/web/lists/getbytitle('C3Approvals')/items   (create)
POST /_api/web/lists/getbytitle('C3Approvals')/items(id) + X-HTTP-Method: MERGE + IF-MATCH: *  (patch)
POST /_api/web/lists/getbytitle('C3Journeys')/items   (create)
```

All requests: `credentials: 'same-origin'`. GET: `Accept: application/json;odata=nometadata`. POST create: `Content-Type: application/json;odata=verbose` + `__metadata: { type: '...' }`. PATCH: same + `X-HTTP-Method: MERGE` + `IF-MATCH: *`. No PnP.js.

---

## Section 4 — What was validated in mock mode (regression baseline)

| Screen | Result |
|--------|--------|
| Command Center | Work queue renders; urgency bands correct |
| People Workspace | 10 people; KPI strip correct |
| Person Profile — PER-0001 | Credentials, journey card; obligation assignment renders |
| StartJourneyPanel (mock) | Creates Journey directly; no approval gate |
| Approvals inbox (mock) | Lists 4 of 6 seed records (Submitted, InReview, Approved, Executed); Rejected/ExecutionFailed terminal state visible |
| Approve action (mock) | SelfApprovalError if same loginName; toast fires correctly |
| Execute action (mock) | Journey created; DuplicateJourneyError if re-executed |
| Situation Room | Work queue correct |
| Console | Zero errors |

No regression observed.

---

## Section 5 — Parity baselines (confirmed Sprint 18 closeout)

| Harness | Result |
|---------|--------|
| `s18-parity-approvals.mjs` | 27/27 passed |
| `s17-parity-journeys.mjs` | 51/51 passed |
| `s15-parity-test.mjs` | All passed |
| `s16-parity-people.mjs` | All passed |
| `tsc --noEmit` — `packages/c3` | Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | Clean |

S15 credential baseline unchanged: `Mapped: 9. Rejected: 1. Warnings: 1.`
S16 people baseline unchanged: `Mapped: 10. Rejected: 0. Warnings: 0.`
S17 journey baseline unchanged: `Mapped: 2. Rejected: 0. Warnings: 0.`

---

## Section 6 — What is deferred to Sprint 19 and why

### Role resolution (go-live blocker)

`c3Role: 'owner'` is hardcoded in `SharePointHost.tsx`. All SP-mode users see the Approvals inbox and can Approve/Reject/Execute. This was a deliberate beta compromise for Sprint 18 hosted-workbench validation. Sprint 19 **must** replace this with real SP group membership resolution before any user other than the Platform Owner is given access to the workbench.

### Journey state transitions

`completeJourney`, `suspendJourney`, `cancelJourney` remain stub-throwing. They follow the same ADR-013 gate pattern as `initiateJourney` — no new C3Approvals schema additions are required. Sprint 19 scope.

### Sequence generation hardening

JRN-XXXX sequence derives from last SP list item ID (fetch → parse → increment). Race condition under concurrent submissions. Sprint 19 — investigate SP column uniqueness enforcement.

### Credential writes

`addCredential`, `deactivateCredential` deferred. Separate workstream; Sprint 20+ target.

### Contracts / SP-02

`SharePointContractService` returns `[]`. FK alignment issue (numeric SP IDs vs PER-NNNN format) noted in S17 baseline — still unresolved. Separate workstream.

### ObligationAssignmentsJSON migration

Plain-text JSON column retained per ADR-003. Migration to normalised child list deferred per S17 baseline. Each new journey initiated via S18 increases migration surface.

---

## Section 7 — File inventory (Sprint 18 additions and modifications)

| File | Status | Notes |
|------|--------|-------|
| `docs/adr/ADR-013-Governance-Approval-Pattern.md` | Modified | Status → Approved; Q1–Q6 resolved |
| `docs/architecture/C3Approvals SP List Schema.md` | New | IT provisioning handover |
| `docs/architecture/Sprint 18 Planning Memo.md` | Modified | Lifecycle corrections pre-sprint |
| `docs/architecture/S18 Beta Validation Runbook.md` | New | Phase 4B — full DSM flow + recovery |
| `docs/architecture/Sprint 18 Closeout Report.md` | New | This sprint's closeout |
| `docs/architecture/C3 Architecture Baseline — Sprint 18.md` | New | This document |
| `docs/architecture/S18 Beta Release Checklist.md` | New | Beta go/no-go checklist |
| `packages/c3/src/services/interfaces/IApprovalsService.ts` | New | Approvals service interface + StampExecutionRequest |
| `packages/c3/src/services/interfaces/approvalPayloads.ts` | New | InitiateJourneyApprovalPayload type |
| `packages/c3/src/utils/spApprovalMapper.ts` | New | SP REST → C3Approval mapper |
| `packages/c3/src/services/mock/MockApprovalsService.ts` | New | In-memory approvals service |
| `packages/c3/src/services/sharepoint/SharePointApprovalsService.ts` | New | Live SP approvals service |
| `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` | Modified | `initiateJourney` implemented |
| `packages/c3/src/hooks/useApprovalsService.ts` | New | Parallel-factory hook |
| `packages/c3/src/hooks/useListApprovals.ts` | New | TanStack Query list hook |
| `packages/c3/src/hooks/usePatchApprovalStatus.ts` | New | Approve/Reject mutation + SelfApprovalError |
| `packages/c3/src/hooks/useExecuteApproval.ts` | New | Execute coordinator + error classes |
| `packages/c3/src/hooks/useSubmitJourneyApproval.ts` | New | Mode-branching submission hook |
| `packages/c3/src/hooks/queryKeys.ts` | Modified | Added `queryKeys.approvals` |
| `packages/c3/src/types/screens.ts` | Modified | Added `{ id: 'approvals' }` |
| `packages/c3/src/screens/ApprovalInbox.tsx` | New | Approval review + execution screen |
| `packages/c3/src/components/layout/NavRail.tsx` | Modified | Added Approvals nav entry |
| `packages/c3/src/components/layout/AppShell.tsx` | Modified | Added `case 'approvals'` routing |
| `packages/c3/src/hosts/SharePointHost.tsx` | Modified | loginName threading; c3Role stub + warning |
| `packages/c3/src/hooks/useSpReadOnly.ts` | Removed (partial) | SP read-only guard lifted on Start Journey only |
| `scripts/s18-parity-approvals.mjs` | New | 27-assertion approvals parity harness |
| `packages/c3-spfx-host/src/.../c3-runtime.js` | Modified | Runtime bundle rebuilt after each phase |
