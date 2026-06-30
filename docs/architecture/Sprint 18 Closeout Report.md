# Sprint 18 Closeout Report — Governed SharePoint Write Operations
**C3 Contract Control Center**
**Sprint:** 18 — Governed SharePoint Write Operations
**Closeout date:** 2026-06-30
**Status:** CLOSED
**Preceding sprint:** Sprint 17 CLOSED (Journey live read, SP read-only guard)
**Validation baseline:** All parity harnesses pass, tsc clean, hosted smoke test confirmed

---

## Closeout statement

Sprint 18 closes as:

> **"The C3 governed write lifecycle is live. Ops staff can submit Start Onboarding Journey proposals through the approval gate, Platform Owners can approve or reject them in the C3 Approvals inbox, and approved proposals are executed to produce live C3Journeys rows with C3Approvals stamped Executed. Duplicate execution is blocked. ExecutionFailed path is implemented. Beta hardening is complete."**

Sprint 18 does **not** close as:

> ~~"C3 role resolution is live."~~
> ~~"Journey state transitions (complete, suspend, cancel) are implemented."~~
> ~~"Credential writes are implemented."~~
> ~~"Background or batch execution is available."~~
> ~~"Power Automate notification flows are implemented."~~

---

## Sprint objective

Deliver the first live, governed SharePoint write path: **Start Onboarding Journey via approval gate**. Prove the ADR-013 lifecycle end-to-end in the hosted-workbench environment. Establish the beta-quality bar for governed writes before any further write surfaces are expanded.

---

## Completed phases

### Phase 0 — ADR-013 approval and C3Approvals schema (pre-sprint)

**Commits:** `85c67c6`, `d3f4a50`, `0e93829`, `3536155`

- ADR-013 (Governance Approval Pattern) advanced from `Proposed` to `Approved`
- All six open decisions (Q1–Q6) resolved: timeout policy, no batch for S18, no break-glass, all-or-nothing delegation, schema finalised, new proposal on rejection
- `C3Approvals SP List Schema.md` authored and handed to IT for provisioning
- ADR-013 approval status and lifecycle recorded with Platform Owner sign-off

### Phase 2B — Approvals service layer and identity threading

**Commit:** `da4b14a` (+ `791aa2a` file-repair, `fe75fbf` bundle)

- `IApprovalsService` interface: `createApproval`, `listApprovals`, `patchApprovalStatus`, `stampExecution`
- `StampExecutionRequest` discriminated union: `ExecutionFailed` branch has `executedAt?: null` — TS enforces no timestamp on failed executions
- `spApprovalMapper.ts`: pure SP REST → `C3Approval` mapper; hard-rejects on missing Title/invalid status; soft-warns on missing Payload
- `MockApprovalsService.ts`: in-memory implementation seeded with 6 lifecycle-state records
- `SharePointApprovalsService.ts`: native `fetch`, same-origin, form-digest per write; `mergeItem()` shared helper
- `useApprovalsService` hook: parallel-factory pattern (SP vs mock via config.dataSourceMode)
- `s18-parity-approvals.mjs` harness: 27 assertions across all six lifecycle states
- `pageContext.user.loginName` threaded through SPFx host chain to `currentUser.loginName`

### Phase 3A — Approval submission path

**Commits:** `e64de01`, `b3f50fe`, `338a0f4`

- `useSubmitJourneyApproval` hook: mode-branching — mock path creates Journey directly (unchanged); SP path calls `approvalsService.createApproval()` with full `InitiateJourneyApprovalPayload` serialised as JSON into the `Payload` column
- `StartJourneyPanel.tsx` updated: shows "Awaiting approval" banner after SP submission; "Start Journey" UI becomes "Submit for Approval" in SP mode
- No `C3Journeys` row created at submission time — deferred to execution
- Hosted-workbench validation confirmed: C3Approvals row created with `ApprovalStatus: Submitted`

### Phase 3B — Approval review MVP

**Commits:** `40eeee3`, `29c5661`

- `ApprovalInbox` screen: lists Submitted, InReview, and Approved records; card-per-approval layout
- `usePatchApprovalStatus` hook: `SelfApprovalError` class; self-approval guard (`currentUser.loginName === approval.submittedBy`)
- `useListApprovals` hook: configurable status filter, default 30-second polling interval
- `{ id: 'approvals' }` added to C3Screen union; `ShieldTaskRegular` NavRail entry
- Owner role sees Approve + Reject buttons (Submitted/InReview); non-owner sees read-only view
- `queryKeys.approvals` added; invalidation on approve/reject causes inbox refetch
- c3Role stub bumped to `'owner'` for hosted-workbench validation

### Phase 4A — Execute approved approvals

**Commit:** `af11f85` (+ `97842e2` bundle)

- `SharePointJourneyService.initiateJourney` implemented (was throwing stub since S17-2)
  - Derives JRN-XXXX sequence by fetching last SP item by ID desc
  - Writes 13 columns; `JourneyType` (not `Type` — SP reserved word); `ObligationAssignmentsJSON` as JSON string
- `useExecuteApproval` hook: five-step guard sequence (ADR-013 §Execution):
  1. Status guard (`Approved` only — first, before any write)
  2. Payload parse + validation (`PayloadValidationError` — no write on failure)
  3. Duplicate check (`getActiveJourney` — stamps `ExecutionFailed` + throws `DuplicateJourneyError`)
  4. Journey creation (`initiateJourney` — stamps `ExecutionFailed` on failure)
  5. Approval stamp (`stampExecution(Executed)` — throws `PartialExecutionError` on failure; does NOT stamp ExecutionFailed because journey exists)
- `ApprovalInbox`: Execute button on Approved cards (owner only); full toast discrimination per error class
- Query invalidation: `approvals.all`, `journey.list(personId)`, `journey.active(personId, 'Onboarding')`, `journey.allActive('Onboarding')`
- Hosted-workbench DSM validation passed: C3Approvals stamped Executed; C3Journeys row confirmed

### Phase 4B — Beta hardening

**Commits:** `b09bc5a`, `11afcc5`

- `ApprovalInbox`: `Approved` badge changed from `'success'` (green) to `'brand'` (purple) — distinct from `Executed` (green)
- `ApprovalInbox`: `PayloadValidationError` now has specific operator-facing toast; `DuplicateJourneyError` toast clarified ("Approval has been marked ExecutionFailed"); `PartialExecutionError` toast includes explicit manual resolution instruction
- `SharePointHost.tsx`: c3Role stub elevated to `⚠ WARNING — TEMPORARY BETA STUB. NOT PRODUCTION AUTHORIZATION.` with go-live gate wording
- `S18 Beta Validation Runbook.md` written: full DSM test flow with SP REST verify queries, all negative paths, three error recovery procedures, known caveats table, parity check commands, pre-go-live checklist

---

## Commit summary

| Hash | Phase | Description |
|------|-------|-------------|
| `85c67c6` | Pre-work | Revise Sprint 18 Planning Memo (lifecycle corrections) |
| `d3f4a50` | Pre-work | ADR-013 approved — Q1–Q6 resolved, lifecycle updated |
| `0e93829` | Pre-work | Fix: restore truncated ADR-013 |
| `3536155` | Pre-work | C3Approvals SP list schema — provisioning handover |
| `da4b14a` | Phase 2B | Approvals service layer + identity threading |
| `791aa2a` | Phase 2B | Fix: restore truncated host and date utility files |
| `fe75fbf` | Phase 2B | Build: SPFx runtime bundle |
| `e64de01` | Phase 3A | Wire StartJourneyPanel to approval submission in SP mode |
| `b3f50fe` | Phase 3A | Fix: remove unused currentUser from StartJourneyPanel |
| `338a0f4` | Phase 3A | Build: SPFx runtime bundle |
| `40eeee3` | Phase 3B | Add approval review MVP |
| `29c5661` | Phase 3B | Build: SPFx runtime bundle |
| `af11f85` | Phase 4A | Execute approved journey approvals |
| `97842e2` | Phase 4A | Build: SPFx runtime bundle |
| `b09bc5a` | Phase 4B | Harden approval execution loop for beta |
| `11afcc5` | Phase 4B | Build: SPFx runtime bundle after beta hardening |

HEAD at time of closeout: `11afcc5`

---

## Live validation summary

All validation performed against live SharePoint DSM (hosted-workbench, same-origin fetch).

| Validation | Result |
|------------|--------|
| C3Approvals POST (`createApproval`) | ✓ HTTP 201; `ApprovalStatus: Submitted` confirmed |
| C3Approvals PATCH (`patchApprovalStatus` → Approved) | ✓ HTTP 200; `ApprovalStatus: Approved`, `ReviewedBy`, `ReviewedAt` set |
| C3Approvals PATCH (`patchApprovalStatus` → Rejected) | ✓ HTTP 200; `RejectionReason` set |
| C3Approvals PATCH (`stampExecution` → Executed) | ✓ HTTP 200; `ApprovalStatus: Executed`, `ExecutedAt` set |
| C3Journeys POST (`initiateJourney`) | ✓ HTTP 201; all 13 fields present; `Status: Active` |
| Duplicate execution block | ✓ `ExecutionFailed` stamped; no duplicate C3Journeys row |
| Self-approval block | ✓ `SelfApprovalError` thrown; status unchanged |
| Parity — `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| Parity — `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| Parity — `s15-parity-test.mjs` | ✓ All passed |
| Parity — `s16-parity-people.mjs` | ✓ All passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| Mock mode regression | ✓ Journey panel creates Journey directly; all write surfaces visible |

---

## SharePoint lists involved

| List | Role in Sprint 18 | Schema doc |
|------|-------------------|------------|
| `C3Approvals` | New. Governance audit ledger. Receives every proposed write as `ApprovalStatus: Submitted`; transitions to Approved/Rejected/Executed/ExecutionFailed. Permanent — records never deleted. | `C3Approvals SP List Schema.md` |
| `C3Journeys` | Existing. Receives live POST when an `InitiateJourney` approval is Executed. First real write to this list from C3. | `C3Journeys SP List Schema.md` |
| `C3People` | Existing. Read-only in Sprint 18. | `C3People SP List Schema.md` |
| `C3Credentials` | Existing. Read-only in Sprint 18. | `C3Credentials SP List Schema.md` |

---

## Governed write lifecycle (ADR-013)

```
Ops staff
  │
  │  Start Onboarding Journey → fill form → Submit for Approval
  ▼
C3Approvals row: ApprovalStatus = Submitted
  │
  │  (Platform Owner opens Approvals inbox)
  ├─→ Reject  ──► ApprovalStatus = Rejected │ RejectionReason set
  │               No C3Journeys write       │ Terminal state
  │
  └─→ Approve ──► ApprovalStatus = Approved │ ReviewedBy, ReviewedAt set
                    │
                    │  (Platform Owner clicks Execute)
                    │
                    ├─→ Duplicate check fails
                    │   ApprovalStatus = ExecutionFailed │ ExecutionError set
                    │   No C3Journeys write              │ Terminal state
                    │
                    ├─→ initiateJourney POST fails
                    │   ApprovalStatus = ExecutionFailed │ ExecutionError set
                    │   No C3Journeys write              │ Terminal state
                    │
                    ├─→ initiateJourney POST succeeds
                    │   C3Journeys row created (JRN-XXXX, Status: Active)
                    │   ApprovalStatus = Executed │ ExecutedAt set │ Terminal state
                    │
                    └─→ initiateJourney POST succeeds but stamp fails (rare)
                        C3Journeys row exists (valid)
                        ApprovalStatus remains Approved
                        PartialExecutionError surfaced → operator resolves manually
```

### Scope boundaries preserved

The following boundaries were not crossed at any point during Sprint 18:

- No `C3Journeys` write except through an Executed approval
- No `C3Credentials` writes
- No Contracts, Missions, Finance, or Milestones touched
- No SP schema additions or modifications after Phase 0 provisioning
- No batch execution, no background runner, no Power Automate flows
- Mock DSM unchanged — direct journey creation path intact for demo/regression

---

## Known limitations

See `S18 Beta Validation Runbook.md` §1 for full detail. Summary:

| Limitation | Risk level | Resolution path |
|------------|-----------|-----------------|
| `c3Role` hardcoded `'owner'` in SharePointHost.tsx | High (go-live blocker) | SP security-group membership lookup — future sprint |
| Self-approval guard skipped if `loginName` is empty | Medium | Ensure SPFx `pageContext.user.loginName` is always populated |
| JRN-XXXX sequence race under concurrent writes | Low (operational) | SP unique constraint or server-side sequence — future sprint |
| Manual runtime bundle commit required | Medium (ops) | CI bundle build pipeline — future sprint |
| No batch or background execution | Accepted for beta | Future sprint if volume demands it |
| PartialExecutionError requires manual SP resolution | Low (rare) | Operator runbook steps documented in S18 Beta Validation Runbook.md |
| Executed/Rejected records not visible in C3 UI | Accepted for beta | Future sprint filter controls |

---

## Recommended next sprint

**Sprint 19 — Role Resolution and Journey State Transitions**

### Priority 1 — Replace c3Role stub (go-live blocker)

Implement real SP security-group membership lookup in SharePointHost. The hardcoded `'owner'` stub in Phase 4B was a deliberate beta compromise but is not acceptable for production. The `c3Role` value must be derived from the current user's SP group memberships at mount time. Options: `/_api/web/currentUser/groups`, or a dedicated `C3Roles` list with loginName → role mapping.

### Priority 2 — Journey state transitions

`completeJourney`, `suspendJourney`, and `cancelJourney` are stub-throwing in `SharePointJourneyService`. These are the next logical write surfaces. They follow the same ADR-013 gate pattern established in Sprint 18 — `OperationType: CompleteJourney` etc. — and require no new schema changes in `C3Approvals`.

### Priority 3 — Sequence generation hardening

JRN-XXXX sequence derived from last SP item ID is vulnerable to race conditions under concurrent submissions. Add SP list column uniqueness enforcement or a server-side counter before volume increases.

### Non-priority (defer beyond S19)

- Credential writes (`addCredential`, `deactivateCredential`) — Sprint 20 target
- ObligationAssignmentsJSON → normalised child list migration — Sprint 19–20
- Contracts / SP-02 — separate workstream
- Power Automate notification flows
- Batch or background execution
