# Sprint 18 Planning Memo — Governed SharePoint Write Operations
**C3 Contract Control Center**
**Prepared:** 2026-06-29
**Status:** PROPOSAL — for Platform Owner review and approval before sprint begins
**Preceding sprint:** Sprint 17 CLOSED (Journey live read, SP read-only guard)
**This document:** Planning and sequencing proposal only. No code, no SP schema changes, no implementation.

---

## Executive summary

Sprint 18 introduces the first C3 write paths against live SharePoint data. Before a single line of implementation code is written, two pre-conditions must be met:

1. **ADR-013 must advance from `Proposed` to `Approved`** — the Platform Owner must formally approve the Governance Approval Pattern, with all six open decisions resolved. ADR-013 is currently in `Proposed` state. This is a hard implementation blocker.
2. **The `C3Approvals` SharePoint list must be designed, documented, and provisioned** — no governed write can execute until this list exists. Its schema depends on the ADR-013 open decisions.

Neither of these is a code task. Both must be completed before Sprint 18 implementation begins. The recommendation is to treat them as Sprint 18 pre-work — confirmed and signed off before the first sprint task is started.

**Recommended S18 scope:** Implement `initiateJourney` only, as the sole write operation, behind the full ADR-013 approval gate. All other write operations (complete, suspend, cancel, add credential, obligation post-initiation assignment) remain deferred.

---

## Section 1 — Current state after Sprint 17

### Write surface inventory

All write surfaces are currently hidden in SP mode by the `useSpReadOnly` hook (S17-6). The guard will be lifted progressively as each governed write path is implemented and validated. Sprint 18 lifts the guard on exactly one surface.

| Surface | Screen | Guard state | S18 action |
|---|---|---|---|
| Start Onboarding Journey | PersonProfile — Readiness tab | Hidden | Replace with governed write path |
| Add Credential (header) | PersonProfile — Credentials | Hidden | Remains hidden |
| Add Credential (empty state) | PersonProfile — Credentials | Hidden | Remains hidden |
| Resolve (obligation rows) | PersonProfile — Readiness tab | Hidden | Remains hidden |
| Edit Contract | ContractProfile | Hidden | Remains hidden (SP-02 not started) |
| Add Amendment | ContractProfile | Hidden | Remains hidden (SP-02 not started) |

### Service write method inventory

| Method | Service | Current SP behaviour | S18 action |
|---|---|---|---|
| `initiateJourney()` | `SharePointJourneyService` | Throws | Implement with approval gate |
| `completeJourney()` | `SharePointJourneyService` | Throws | Remains throwing |
| `suspendJourney()` | `SharePointJourneyService` | Throws | Remains throwing |
| `cancelJourney()` | `SharePointJourneyService` | Throws | Remains throwing |
| `addCredential()` | `SharePointCredentialService` | Throws | Remains throwing |
| `deactivateCredential()` | `SharePointCredentialService` | Throws | Remains throwing |

### Live read baseline (confirmed S17)

- Credentials: 9 mapped / 10 fetched / 1 rejected — S15 baseline unchanged
- People: 10 mapped / 10 fetched / 0 rejected — S16 baseline unchanged
- Journeys: 2 mapped / 2 fetched / 0 rejected — S17 baseline

---

## Section 2 — ADR review findings

### ADR-013 — Governance Approval Pattern (current status: `Proposed`)

ADR-013 defines the approval lifecycle that governs all C3 write operations. Its key constraints for Sprint 18:

- No write bypasses the gate — enforced at the service layer, not just the UI
- Approval state lives in SharePoint (`C3Approvals` list — not yet provisioned)
- Optimistic execution is prohibited — the write only executes after `Approved` state is recorded
- Self-approval is prohibited at the **approval action** — `ReviewedBy` must differ from `SubmittedBy`. Submission is always allowed, including by the Platform Owner. The block applies only when the same identity attempts to approve their own submission.
- The Platform Owner (`owner` C3Role) holds sole final approval authority by default. Delegation is explicit and recorded (see Q4). Escalation notifies `admin` role but does not grant approval authority to `admin`.

**Current blocker:** ADR-013 is `Proposed` — it has not been approved. Its own text states: *"This ADR must reach `Approved` status before any C3 write-path implementation begins."* All six open decisions (Q1–Q6) are unresolved.

### ADR-013 open decisions — must be resolved in S18 pre-work

| Decision | Question | Why it blocks |
|---|---|---|
| Q1 | Approval timeout policy | Determines `C3Approvals` list schema (timeout field? escalation FK?) |
| Q2 | Batch approvals allowed? | Affects approval UI design — single-record review vs. batch review panel |
| Q3 | Emergency bypass procedure | Determines whether a bypass mechanism needs to be built or documented |
| Q4 | Delegation scope model | Determines whether `C3Approvals` needs a DelegatedBy field and scope column |
| Q5 | `C3Approvals` list schema | Unblocked only after Q1–Q4; must be designed and provisioned before S18 code |
| Q6 | Rejection re-submission policy | Determines whether approval records are mutable after rejection |

**Action required:** Platform Owner convenes a pre-sprint decision session (≤ 2 hours) to resolve Q1–Q6 and formally advance ADR-013 to `Approved`. Without this, Sprint 18 has no implementation mandate.

### ADR-003 — Journey Definition (status: `Accepted`)

ADR-003 has four open questions. One is directly relevant to the Sprint 18 scope:

**Open Question A — Post-initiation obligation assignment:** Does `IJourneyService` need `addObligationAssignment()` for S18, or does assigning obligations at initiation time suffice?

- If assignment at initiation suffices: S18 scope is simpler. `initiateJourney` carries `obligationAssignments[]` in its payload. No new service method, no new UI panel beyond the governed initiation flow.
- If post-initiation assignment is required: S18 must also design `addObligationAssignment()` with its own approval gate path, an obligation assignment UI panel, and a separate SP write payload. Significantly larger scope.

**Recommendation:** Resolve this with ops staff before Sprint 18 begins. Given that the existing `StartJourneyPanel` already supports assigning obligations at initiation, the proposal is to defer post-initiation assignment to Sprint 19 and treat obligation-at-initiation as sufficient for S18.

---

## Section 3 — Write path selection and rationale

### Candidate write operations

Four write paths were considered for Sprint 18 priority:

**Option A — `initiateJourney` (Start Onboarding Journey)**
Creates a new Journey record in `C3Journeys` with `Status: Active`. Moves a person from `Unrouted` → `Routed` in the Situation Room. This is the foundation of all other Journey write operations — completing or suspending a Journey in SP mode is meaningless if no Journeys were initiated via SP.

**Option B — `completeJourney` / `suspendJourney` / `cancelJourney`**
State transitions on existing Journey records. Require an existing live SP Journey record to be acted upon. Cannot be the first write implemented — there is no meaningful state to transition until S18 initiation is live.

**Option C — `addCredential`**
Creates a new Credential record in `C3Credentials`. Isolated scope (no dependency on Journey write paths). However, Credential lifecycle (expiry, renewal, type) carries equal compliance risk to Journey state, and the current credential model (S15) is stable with 9/10 credentials mapped correctly. Adding a Credential creates a new record in an already-validated list — low structural risk, but medium compliance risk if credential metadata is incorrect.

**Option D — `addObligationAssignment` (Resolve Credential)**
Post-initiation mutation of `obligationAssignments` within a Journey. Requires resolution of ADR-003 open question A and a new service method. Depends on a Journey already existing in SP (blocked by Option A). Cannot be first.

### Recommendation: Option A — `initiateJourney` only

**Rationale:**

`initiateJourney` is the write path that unblocks everything else. Without it, ops staff cannot route any person via C3 in SP mode. The S17 guard means no Journeys will accumulate in SP from C3 actions — the live `C3Journeys` list currently contains only the test dataset (JRN-0001, JRN-0002, JRN-0003). Sprint 18 must produce at least one real SP-initiated Journey before state-transition writes are meaningful.

The risk profile is also the most manageable: `initiateJourney` creates a new record (no mutation of existing data), the write payload is well-bounded (13-column schema, all fields defined in S17 schema doc), and the approval gate ensures no Journey is created without Platform Owner sign-off. If the approval is wrong, a new Cancellation Journey can be proposed as a corrective action.

Credential writes (`addCredential`) are deferred not because they are more complex, but because starting the Journey write path first lets the approval gate architecture be proven on the simpler case (a new Journey record vs. a Credential record with more type-specific validation requirements).

---

## Section 4 — Recommended Sprint 18 sequence

Sprint 18 is split into four phases. Phases 0 and 1 are pre-implementation prerequisites. Phases 2 and 3 are implementation. No code is written until Phase 1 is complete.

### Phase 0 — ADR-013 approval (pre-sprint; no code)

**Deliverable:** ADR-013 advanced from `Proposed` to `Approved`, all Q1–Q6 resolved, Platform Owner signature on record.

**Tasks:**
- Platform Owner reviews ADR-013 open decisions Q1–Q6
- Decisions recorded in ADR-013 `ADR Progression` table with date and actor
- ADR status updated to `Approved`

**Blocker if skipped:** No implementation is permitted under ADR-013's own terms. Any code written before approval is non-compliant and must be reverted.

### Phase 1 — C3Approvals list schema and provisioning (pre-sprint; docs and SP only)

**Deliverable:** `C3Approvals SP List Schema.md` authored and reviewed; IT provisioned; REST-verified via `/_api/web/lists/getbytitle('C3Approvals')/fields`.

**Tasks:**
- Author schema document (equivalent to `C3Credentials SP List Schema.md` / `C3People SP List Schema.md`)
- Define `C3Approvals` columns (see full schema below)
- `ApprovalStatus` choice values: `Submitted`, `InReview`, `Approved`, `Rejected`, `Executed`, `ExecutionFailed`

**Proposed `C3Approvals` column schema:**

| Column (Display Name) | SP Internal Name | SP Type | Notes |
|---|---|---|---|
| Title (rename: ApprovalID) | `Title` | Single line text | Custom ID format: APR-NNNN |
| Operation Type | `OperationType` | Choice | Values: InitiateJourney, CompleteJourney, SuspendJourney, CancelJourney, AddCredential, DeactivateCredential |
| Target ID | `TargetID` | Single line text | FK to the target record (e.g. JRN-NNNN for Journey ops) |
| Target Person ID | `TargetPersonID` | Single line text | FK to C3People PersonID |
| Submitted By | `SubmittedBy` | Single line text | Login name or display name of submitter |
| Submitted At | `SubmittedAt` | Date and Time | UTC ISO |
| Approval Status | `ApprovalStatus` | Choice | Submitted / InReview / Approved / Rejected / Executed / ExecutionFailed |
| Reviewed By | `ReviewedBy` | Single line text | Identity of approver or rejecter — must differ from SubmittedBy |
| Reviewed At | `ReviewedAt` | Date and Time | UTC ISO; null until reviewed |
| Executed At | `ExecutedAt` | Date and Time | UTC ISO; set when SP operational write succeeds |
| Execution Error | `ExecutionError` | Multi-line text | Error message when ApprovalStatus = ExecutionFailed; null otherwise |
| Delegated By | `DelegatedBy` | Single line text | Owner identity if delegation is in effect; null if direct approval |
| Delegate To | `DelegateTo` | Single line text | Delegate identity who reviewed; null if no delegation |
| Reason | `Reason` | Multi-line text | Optional context from submitter |
| Rejection Reason | `RejectionReason` | Multi-line text | Required on Rejected; null otherwise |
| Payload | `Payload` | Multi-line text | Serialised JSON of the proposed write input (e.g. InitiateJourneyInput) |
- Coordinate IT provisioning
- REST-verify column InternalNames (lesson from JourneyType reserved-word issue in S17)
- Write parity harness for approval mapper (`s18-parity-approvals.mjs`) — validates the approval mapper produces correct output for the 6 approval lifecycle states

**Column schema note:** The `Payload` column stores the serialised proposed write (e.g. the `InitiateJourneyInput` fields). The approver reviews this in the approval UI; upon `Approved`, the service deserialises it and executes the SP write. This is the ADR-013 constraint that "the gate applies to the intent, not the data."

### Phase 2 — Approval service layer (implementation)

**Deliverable:** `SharePointApprovalsService.ts` implementing `IApprovalsService`, with write-path wrapper pattern.

**New files:**
- `packages/c3/src/services/sharepoint/SharePointApprovalsService.ts` — `createApproval()`, `listPendingApprovals()`, `approveOperation()`, `rejectOperation()`
- `packages/c3/src/utils/spApprovalMapper.ts` — pure mapper following the S15/S16/S17 mapper pattern
- `packages/c3/src/hooks/useApprovalsService.ts` — hook, following `useCredentialService` / `useJourneyService` pattern

**Write-path pattern for `initiateJourney`:**

The approval gate wraps the SP write with the following sequence:
1. Role check: is the current user an `operator`, `admin`, or `owner`? If not, reject immediately.
2. `createApproval(payload)` — POST to `C3Approvals` with `ApprovalStatus: Submitted`; returns ApprovalID. Submission is always permitted regardless of C3Role (subject to step 1).
3. Notify Platform Owner (mechanism TBD — see open decision below)
4. Return `{ approvalId, status: 'Submitted' }` to the UI — no Journey record created yet
5. Platform Owner (or explicit delegate) opens approval panel → `approveOperation(approvalId, reviewerIdentity)`
6. Service checks `ReviewedBy !== SubmittedBy` — if they match, approval action is rejected; `ApprovalStatus` remains `Submitted` or `InReview`; no write proceeds. Error surfaced to approver.
7. If identity check passes: PATCH `ApprovalStatus → Approved`, set `ReviewedBy`, `ReviewedAt`
8. Service reads `Payload` from `C3Approvals` record, deserialises, executes SP write to `C3Journeys`
9. On write success: PATCH `ApprovalStatus → Executed`, set `ExecutedAt`
10. On write failure: PATCH `ApprovalStatus → ExecutionFailed`, set `ExecutionError`; surface error to Platform Owner's session; no Journey record exists

Step 6 requires a refresh/polling mechanism (or Power Automate notification flow) to bring the Platform Owner's session to the pending approval. This is an architectural question for Phase 2 design.

### Phase 3 — initiateJourney implementation and UI

**Deliverable:** Governed `initiateJourney()` in `SharePointJourneyService`, updated `StartJourneyPanel`, `ApprovalGatePanel`, and SP read-only guard lifted on "Start Onboarding Journey."

**Modified files:**
- `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` — `initiateJourney()` implemented using Phase 2 approval wrapper
- `packages/c3/src/screens/PersonProfile.tsx` — `!isSpReadOnly` guard on "Start Onboarding Journey" replaced with governed write hook
- `packages/c3/src/components/shared/StartJourneyPanel.tsx` — multi-step confirmation: compose intent → submit for approval → show pending state
- `packages/c3/src/components/shared/ApprovalGatePanel.tsx` (new) — Platform Owner review surface: shows pending operations with OperationType, target person, proposed payload, Approve/Reject controls

**UI state model for StartJourneyPanel after S18:**
```
Idle
  │ (user clicks "Start Onboarding Journey")
  ▼
Composing (fill in AssignedTo, InitiationReason, optional obligations)
  │ (user clicks "Submit for Approval")
  ▼
Submitting (POST to C3Approvals)
  │
  ├─→ Error (POST failed) → show error, retry option
  │
  └─→ Pending ("Submitted to Platform Owner for review. You'll be notified when approved.")
        │ (Platform Owner approves — ReviewedBy ≠ SubmittedBy confirmed)
        ▼
      Approved (approval decision recorded; write execution begins)
        │
        ├─→ Executed → C3Journeys record created → Journey card appears in Person Profile
        │
        └─→ ExecutionFailed → error surfaced to Platform Owner; no Journey record; re-trigger or reject and restart
        │ (Platform Owner rejects — or self-approval attempt blocked)
        ▼
      Rejected → submitter notified with RejectionReason → no Journey record created
```

**Parity harness:** `s18-parity-approvals.mjs` — validates all 6 approval lifecycle state transitions produce correct `SpApprovalItem` → `Approval` mappings. Extend `s17-parity-journeys.mjs` with assertions that confirm an approved `InitiateJourney` operation produces the correct `SpJourneyItem` input to the journey mapper.

---

## Section 5 — Required SharePoint additions

| List | Action | When |
|---|---|---|
| `C3Approvals` | Create new list | Phase 1 (pre-sprint) |
| `C3Journeys` | No column changes needed for `initiateJourney` | — |
| `C3Credentials` | No changes | — |
| `C3People` | No changes | — |

`C3Approvals` is the only new list required for S18. All columns needed for `initiateJourney` exist in `C3Journeys` already (provisioned and live-validated in S17).

**Reserved-word risk:** Apply the JourneyType lesson — verify `InternalName` for any `Status` or `Type` columns in `C3Approvals` against SP reserved words before provisioning. Proposed internal name for the Status column: `ApprovalStatus` (not `Status`) to avoid the same class of collision.

---

## Section 6 — Write operations that require the gate vs. direct

Per ADR-013, **every C3 write that modifies SharePoint operational data requires the approval gate**. There are no direct writes in the Sprint 18 scope.

The mock service remains gate-free — in mock mode, `initiateJourney()` continues to write to in-memory state directly with no approval step. The gate applies exclusively to the SharePoint service layer.

For completeness, operations that are permanently excluded from the gate (per ADR-013 Known Decisions):
- All read operations
- Diagnostics log writes
- User preference writes (UI state, no compliance surface)

---

## Section 7 — UI changes required

| Component | Change | Why |
|---|---|---|
| `StartJourneyPanel.tsx` | Multi-step flow (compose → submit → pending) | Approval gate means write is not immediate |
| `PersonProfile.tsx` | Remove `isSpReadOnly` guard on "Start Onboarding Journey"; replace with governed write call | Guard served S17 — S18 makes the write real |
| `ApprovalGatePanel.tsx` (new) | Platform Owner review surface | Required by ADR-013 approval lifecycle |
| `PersonProfile.tsx` | Show "pending approval" badge on Journey section when an approval is in `Submitted` state for this person | UX continuity — submitter needs to know what's happening |
| Notification mechanism | TBD (email via Power Automate, Teams card, or in-app badge) | ADR-013 §6: Platform Owner notification is synchronous on submission |

**Components that do NOT change in S18:**
- `ReadinessPanel.tsx` — remains unchanged; `onResolveObligation=undefined` guard stays
- `ContractProfile.tsx` — Edit Contract and Add Amendment remain hidden (SP-02 not started)
- `AddCredentialPanel.tsx` — remains mock-only (credential writes deferred)

---

## Section 8 — Validation gates

### S18 acceptance gates (must all pass before S18 is declared closed)

| Gate | Pass condition |
|---|---|
| ADR-013 approved | Platform Owner signature on record in ADR progression table |
| `C3Approvals` provisioned | REST GET on `C3Approvals` returns HTTP 200; all columns present with correct InternalNames |
| `createApproval` POST | HTTP 201; new item in `C3Approvals` with `ApprovalStatus: Submitted` |
| `approveOperation` PATCH — Approved | HTTP 200; `ApprovalStatus` transitions to `Approved`; `ReviewedBy` and `ReviewedAt` set |
| `initiateJourney` write — Executed | HTTP 201 on `C3Journeys`; `ApprovalStatus` transitions to `Executed`; `ExecutedAt` set; new Journey record present with correct PersonID, JourneyType, Status, InitiatedAt, InitiatedBy |
| Self-approval blocked | `ReviewedBy === SubmittedBy` → approval action rejected; `ApprovalStatus` remains `Submitted` or `InReview`; no Journey created; error surfaced to approver |
| ExecutionFailed state | If `C3Journeys` POST fails after approval: `ApprovalStatus = ExecutionFailed`; `ExecutionError` populated; no Journey record; no silent failure |
| Journey card renders after Executed | `ApprovalStatus: Executed` → Journey card visible in Person Profile Readiness tab; `[C3/Journey]` aggregate increments |
| Rejection produces no Journey | Rejected approval → no row in `C3Journeys`; Person Profile shows no new journey card |
| S17 regression | `[C3/Journey]`: `Mapped: 2. Rejected: 0. Warnings: 0.` (pre-existing test journeys unaffected) |
| S16 regression | `[C3/People]`: `Mapped: 10. Rejected: 0. Warnings: 0.` |
| S15 regression | `[C3/Credential]`: `Mapped: 9. Rejected: 1. Warnings: 1.` |
| s18-parity-approvals.mjs | All assertions pass |
| tsc --noEmit | Clean |
| Mock mode regression | All 5 write surfaces visible in mock mode; StartJourneyPanel gate-free in mock mode |
| ApprovalGatePanel visible to owner | Platform Owner can see pending operations; Approve/Reject controls functional |
| Audit record retained | Approved operation retains `C3Approvals` record with ApprovalStatus, ReviewedBy, ReviewedAt |

### Rollback strategy

Sprint 18 has no destructive rollback risk for the read layer — all existing S15/S16/S17 read paths are unchanged.

For the write layer:

**If `createApproval` fails:** No Journey record is created. The error is surfaced to the submitter in `StartJourneyPanel`. No state is corrupted.

**If `approveOperation` succeeds but the subsequent `C3Journeys` POST fails:** The approval record is in `Approved` state but no Journey exists. This is the partial write scenario identified in ADR-013. Mitigation: on failure, the service PATCHes `ApprovalStatus → ExecutionFailed` and sets `ExecutionError` with the failure detail. The error is surfaced to the Platform Owner's session. No Journey record exists. The Platform Owner can re-trigger execution or reject and restart with a new proposal. The service must not silently swallow this failure — `ExecutionFailed` is a terminal state that requires explicit resolution.

**If a Journey is initiated incorrectly:** The correction path is a new Cancellation proposal — `cancelJourney(JRN-XXXX)` — submitted through the same approval gate. No direct-delete mechanism is exposed.

---

## Section 9 — Risks and open decisions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ADR-013 Q1–Q6 resolution slower than expected | Medium | Blocks all implementation | Timebox the decision session; if Q3 (emergency bypass) or Q4 (delegation scope) cannot be resolved quickly, proceed with a simplified v1 that excludes those features and updates the ADR with a deferral note |
| `C3Approvals` provisioning lead time | Medium | Blocks Phase 2 start | Request IT provisioning in parallel with ADR-013 decision session; schema can be finalised while SP list is being created |
| User identity resolution in SP mode | High (new capability gap) | Blocks self-approval check and role gating | C3 currently has no mechanism to resolve the current SPFx user to a C3Role at runtime. Sprint 18 must address this: `PageContext.user.loginName` is available in the SPFx web part; it must be threaded through `AppConfig` or a new `useCurrentUser` hook |
| Notification mechanism scope | Medium | Without notification, Platform Owner has no session signal | Minimum viable: in-app badge on a new "Pending Approvals" indicator in the C3 header or Command Center. Power Automate email as a secondary signal. Do not block S18 on Teams integration. |
| ObligationAssignmentsJSON debt | Low (short term) | Medium (long term) | S18 `initiateJourney` will continue writing obligations as JSON to the `ObligationAssignmentsJSON` column on `C3Journeys`. Migration to a child list remains deferred. Each new Journey initiated via S18 increases the migration surface. Set a target for migration in Sprint 19–20. |
| Approval UI complexity | Medium | Could delay Phase 3 if approval UX is underestimated | ApprovalGatePanel must be scoped tightly for S18: show pending initiations only (not all operation types); no pagination, no batch controls (defer Q2 resolution to UI); Approve and Reject with mandatory reason for Reject. |

### Open decisions for Platform Owner (Sprint 18 pre-work)

These must be answered to finalise ADR-013 and begin implementation. Proposed positions are noted for review:

**Q1 — Approval timeout:** Proposed: 3 business days → escalation notification sent to `admin` role (informational only — `admin` does not gain approval authority); if no `owner` response in further 2 business days, auto-reject with notification to submitter. Final approval authority remains with `owner` throughout the timeout period. Escalation is a signal, not a delegation.

**Q2 — Batch approvals:** Proposed: individual-only for S18. Batch approval can be added in a later sprint once the single-record flow is proven. The `C3Approvals` list schema should not be designed around batch at this stage.

**Q3 — Emergency bypass:** Proposed: no automated bypass for S18. If approval is urgently needed, the Platform Owner reviews and approves directly (the approval panel is available to them immediately). If the Platform Owner is genuinely unavailable, the direct SharePoint edit (bypassing C3) remains available as a last resort — this is documented as an out-of-band action with a required post-hoc audit note added manually to `C3Approvals`. Do not build a break-glass mechanism in S18.

**Q4 — Delegation scope:** Proposed: all-or-nothing delegation for S18. Delegation is explicit and recorded: `DelegatedBy` carries the `owner` identity authorising the delegation; `DelegateTo` carries the delegate identity. A delegate may approve any operation type — scoped delegation deferred to Sprint 19+. Delegation must be established before the approval action (not retroactively). Self-approval prohibition applies equally to delegates — `ReviewedBy` must still differ from `SubmittedBy`.

**Q5 — C3Approvals schema:** Pending Q1–Q4 resolution. Proposed columns above in Phase 1. Final schema to be documented as `C3Approvals SP List Schema.md`.

**Q6 — Rejection re-submission:** Proposed: new proposal for re-submission. The rejected record is immutable (audit trail). The submitter opens the panel again, composes a new proposal (pre-populated from the rejected one as a convenience), and submits fresh. This keeps the audit trail clean.

### Open decision inherited from ADR-003

**ADR-003 Q-A — Post-initiation obligation assignment:** Proposed position for S18: defer. `initiateJourney` will carry `obligationAssignments[]` in its payload (assignment at initiation). `addObligationAssignment()` as a post-initiation mutation is deferred to Sprint 19, contingent on operator validation confirming the need.

---

## Section 10 — What S18 does NOT include

The following are explicitly out of scope. They are not deferred by oversight — they are deferred by design. Any scope creep into these areas during S18 should be challenged.

- `completeJourney`, `suspendJourney`, `cancelJourney` — implement after `initiateJourney` is live and proven; Sprint 19 target
- `addCredential`, `deactivateCredential` — separate credential write workstream; Sprint 20+ target
- Obligation post-initiation assignment — pending ADR-003 Q-A operator validation; Sprint 19 target
- `ObligationAssignmentsJSON` → `JourneyObligationAssignments` child list migration — deferred per ADR-003; Sprint 19–20 target
- Contracts/SP-02 — not started; separate workstream
- Missions, Milestones, Finance — deferred; separate workstream
- App Catalog, Document Intelligence — deferred
- Power Automate approval flow — the notification mechanism for S18 is in-app only; Power Automate is an enhancement for Sprint 19+
- Role delegation scoped by operation type — all-or-nothing delegation in S18 per Q4 proposal above

---

## Section 11 — Sprint 18 file inventory (projected)

| File | Status | Notes |
|---|---|---|
| `docs/architecture/C3Approvals SP List Schema.md` | New | Phase 1 deliverable — schema for C3Approvals list |
| `docs/adr/ADR-013-Governance-Approval-Pattern.md` | Modified | Status: Proposed → Approved; Q1–Q6 resolved |
| `packages/c3/src/utils/spApprovalMapper.ts` | New | Pure approval mapper |
| `packages/c3/src/services/sharepoint/SharePointApprovalsService.ts` | New | Approval CRUD service |
| `packages/c3/src/hooks/useApprovalsService.ts` | New | Approval service hook |
| `packages/c3/src/services/sharepoint/index.ts` | Modified | Register SharePointApprovalsService |
| `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` | Modified | Implement `initiateJourney()` via approval wrapper |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | Lift `isSpReadOnly` guard on Start Onboarding Journey |
| `packages/c3/src/components/shared/StartJourneyPanel.tsx` | Modified | Multi-step approval-aware flow |
| `packages/c3/src/components/shared/ApprovalGatePanel.tsx` | New | Platform Owner review surface |
| `packages/c3/src/hooks/useCurrentUser.ts` | New | Resolve SPFx page context user to C3Role |
| `scripts/s18-parity-approvals.mjs` | New | Approval mapper parity harness |
| `docs/architecture/S18 Approval Live Validation Runbook.md` | New | Closeout — provisioning + live results |
| `docs/architecture/C3 Architecture Baseline — Sprint 18.md` | New | Closeout — deliverables and architecture state |

---

## Section 12 — Recommended pre-sprint checklist

Before Sprint 18 implementation begins, the following must all be true:

- [ ] ADR-013 Q1–Q6 resolved and Platform Owner approval recorded in the ADR progression table
- [ ] ADR-003 Q-A resolved (obligation assignment at initiation sufficient for S18?)
- [ ] `C3Approvals SP List Schema.md` authored and reviewed
- [ ] IT provisioning of `C3Approvals` list requested (or confirmed in progress)
- [ ] SPFx page context user identity threading confirmed feasible (spike: can `PageContext.user.loginName` be accessed from `AppConfig` at runtime?)
- [ ] Notification mechanism decided (in-app badge is the minimum; Power Automate email is optional)
- [ ] S18 scope confirmed: `initiateJourney` only, no state transitions in S18

---

## Summary recommendation

Sprint 18 is the right sprint to start C3 writes — the read baseline is solid, the service patterns are proven, and the S17 guard is correctly positioned as a temporary placeholder. The write path to implement first is `initiateJourney`, behind the full ADR-013 approval gate.

The sprint should not begin until ADR-013 is approved and the `C3Approvals` list exists. Those two pre-conditions are the critical path. Everything else in Sprint 18 follows from them.

The scope proposed here is intentionally narrow: one write operation, one new SP list, one new service, one updated panel, one new panel. A narrow first write path proves the approval gate end-to-end — approval record created, Platform Owner reviews, write executes, Journey appears in the live read. Sprint 19 can then add state transitions (complete, suspend, cancel) with confidence that the gate works.
