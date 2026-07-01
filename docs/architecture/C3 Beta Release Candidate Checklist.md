# C3 Beta Release Candidate Checklist
**C3 Contract Control Center**
**Status:** BETA RELEASE CANDIDATE — Sprint 19 validated
**Baseline date:** 2026-07-01
**See also:** Sprint 19 Closeout Report.md, C3 Architecture Baseline — Sprint 19.md, ADR-013, ADR-013 Addendum — Journey Lifecycle Transitions.md, S18 Beta Validation Runbook.md

> **Purpose:** This checklist is the operator's guide for confirming the complete S19 beta operational path is working correctly in a given SP environment. Run all parts in order. A failure at any step is a blocker — do not proceed to the next section until the failure is resolved.

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `git log --oneline -2` shows:
  - `60e7be0 build(s19-phase-3): Update SPFx runtime bundle after sequence hardening`
  - `48f21fc fix(s19-phase-3): Use SP auto-ID for atomic APR/JRN sequence generation`
- [ ] Parity harnesses all pass:
  ```bash
  node scripts/s18-parity-approvals.mjs    # expect 27/27
  node scripts/s17-parity-journeys.mjs     # expect 51/51
  node scripts/s15-parity-test.mjs         # expect 87/87
  node scripts/s16-parity-people.mjs       # expect 220/220
  ```
- [ ] TypeScript clean:
  ```bash
  npx tsc --noEmit -p packages/c3/tsconfig.json
  npx tsc --noEmit -p packages/c3-spfx-host/tsconfig.json
  ```

### 0.2 SharePoint list readiness

- [ ] `C3Approvals` list exists and accessible at `{siteUrl}/_api/web/lists/getbytitle('C3Approvals')`
- [ ] `C3Approvals` required columns present:
  - [ ] `Title` — APR-XXXX identifier (20-char max)
  - [ ] `OperationType` — Choice (InitiateJourney, …)
  - [ ] `TargetPersonID` — Single line text
  - [ ] `TargetID` — Single line text (optional)
  - [ ] `SubmittedBy` — Single line text
  - [ ] `SubmittedAt` — Date and Time
  - [ ] `ApprovalStatus` — Choice (Submitted, InReview, Approved, Rejected, Executed, ExecutionFailed)
  - [ ] `ReviewedBy` — Single line text
  - [ ] `ReviewedAt` — Date and Time
  - [ ] `ExecutedAt` — Date and Time
  - [ ] `ExecutionError` — Multi-line text
  - [ ] `RejectionReason` — Multi-line text
  - [ ] `Payload` — Multi-line text
  - [ ] `Reason` — Multi-line text
- [ ] `C3Journeys` list exists and accessible
- [ ] `C3Journeys` required columns present:
  - [ ] `Title` — JRN-XXXX identifier (20-char max)
  - [ ] `PersonID` — Single line text
  - [ ] `JourneyType` — Choice (Onboarding, …)
  - [ ] `Status` — Choice (Active, Completed, Suspended, Cancelled)
  - [ ] `InitiatedBy` — Single line text
  - [ ] `InitiatedAt` — Date and Time
  - [ ] `AssignedTo` — Single line text
  - [ ] `InitiationReason` — Multi-line text
  - [ ] `CompletedAt` — Date and Time
  - [ ] `Notes` — Multi-line text
  - [ ] `MissionID` — Single line text
  - [ ] `ContractID` — Single line text
  - [ ] `ObligationAssignmentsJSON` — Multi-line text
- [ ] `C3People` list exists and accessible; at least one PER-XXXX person record present

### 0.3 SP security group provisioning

Required SP groups for role resolution (must exist in the target site):

- [ ] `C3 Platform Owners` group exists and the test Platform Owner account is a member
- [ ] `C3 Operations` group exists and the test Operations account is a member (if testing operations role)
- [ ] At least one non-owner test account is available (not in any C3 group — resolves to `visitor`)
- [ ] (Optional but recommended) Two distinct accounts available for self-approval negative test

### 0.4 Identity check

- [ ] SPFx `pageContext.user.loginName` is non-empty for all test accounts
- [ ] `currentUser.loginName` visible in browser console (`[C3]` log) — confirm non-empty
- [ ] `currentUser.c3Role` visible in browser console — confirm correct role for each test account

---

## Part 1 — Role Resolution Checklist

Goal: `c3Role` is derived from SP group membership, not hardcoded.

- [ ] Open hosted workbench with a Platform Owner account (SP DSM: `dataSrc=sharepoint`)
- [ ] In browser DevTools console: `[C3]` log includes `c3Role: 'owner'`
- [ ] Owner-restricted UI visible: Approvals inbox in NavRail; Approve/Reject/Execute buttons in inbox; journey lifecycle action buttons (Complete/Suspend/Cancel) on Person Profile
- [ ] Open workbench with a non-C3-group account
- [ ] Console: `c3Role: 'visitor'`
- [ ] Visitor UI: Approvals inbox **not** in NavRail; no lifecycle action buttons on Person Profile; read-only view throughout
- [ ] (If testing operations role) Open workbench with Operations account
- [ ] Console: `c3Role: 'operations'`
- [ ] Operations UI: journey lifecycle action buttons visible; Approvals inbox visible (read-only); no Approve/Reject/Execute buttons in inbox

---

## Part 2 — Approval Submission Checklist

Goal: ops staff submit a Start Onboarding Journey proposal. C3Approvals row created with APR-XXXX Title derived from SP item ID. No C3Journeys row.

- [ ] Logged in as Platform Owner or Operations account (SP DSM)
- [ ] Navigate to People Workspace → select a person with no active Onboarding journey
- [ ] Open Person Profile → Readiness tab
- [ ] "Start Onboarding Journey" button visible
- [ ] Fill form: `initiationReason` (required), `assignedTo` (required)
- [ ] Click "Submit for Approval"
- [ ] Toast: submission confirmation
- [ ] "Awaiting approval" banner shown (no immediate Journey card)
- [ ] SP verify — C3Approvals row:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$orderby=ID desc&$top=1
  ```
  - [ ] `Title = APR-XXXX` (derived from SP item ID — **not** incremented from previous)
  - [ ] `ApprovalStatus = Submitted`
  - [ ] `OperationType = InitiateJourney`
  - [ ] `TargetPersonID = <personId>`
  - [ ] `SubmittedBy = <loginName>`
  - [ ] `SubmittedAt` is set
  - [ ] `Payload` is non-empty JSON
  - [ ] **No `TMP-*` Title present** — MERGE to canonical APR-XXXX completed successfully
- [ ] SP verify — no new C3Journeys row for this person

---

## Part 3 — Approval Review Checklist

### 3.1 Approve path

- [ ] Platform Owner opens Approvals inbox (shield icon)
- [ ] Submitted card visible with correct APR-XXXX Title
- [ ] Badge: Submitted (orange/warning)
- [ ] Approve and Reject buttons present
- [ ] Click Approve
- [ ] Button shows "Approving…" while in flight
- [ ] Toast: "Approval approved"
- [ ] Badge updates to Approved (purple/brand); Execute button appears
- [ ] SP verify: `ApprovalStatus = Approved`, `ReviewedBy` and `ReviewedAt` set

### 3.2 Reject path (separate test record)

- [ ] Submit a second approval (repeat Part 2)
- [ ] Platform Owner clicks Reject; reason textarea appears
- [ ] Enter rejection reason; click Confirm Reject
- [ ] Toast: "Approval rejected"
- [ ] Badge: Rejected (red/danger); no further action buttons
- [ ] SP verify: `ApprovalStatus = Rejected`, `RejectionReason` set
- [ ] No new C3Journeys row created

---

## Part 4 — Execution Checklist

Goal: Execute on Approved record creates C3Journeys row with JRN-XXXX Title derived from SP item ID. Approval stamped Executed.

- [ ] An Approved card is in the inbox
- [ ] Platform Owner clicks Execute
- [ ] Button shows "Executing…"
- [ ] Toast: "Approval executed — Journey created for [personId]"
- [ ] SP verify — C3Approvals stamped:
  - [ ] `ApprovalStatus = Executed`
  - [ ] `ExecutedAt` is set (ISO timestamp)
  - [ ] `ExecutionError` is null
- [ ] SP verify — C3Journeys row created:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=PersonID eq '{personId}'&$orderby=ID desc&$top=1
  ```
  - [ ] `Title = JRN-XXXX` (derived from SP item ID — **not** incremented from previous)
  - [ ] **No `TMP-*` Title present** — MERGE to canonical JRN-XXXX completed
  - [ ] `PersonID = <targetPersonId>`
  - [ ] `JourneyType = Onboarding`
  - [ ] `Status = Active`
  - [ ] `InitiatedBy = <loginName from payload>`
  - [ ] `InitiatedAt` is set
  - [ ] `AssignedTo` is set
- [ ] Navigate to Person Profile for target person: Journey card (JRN-XXXX, Active) appears

---

## Part 5 — Sequence Verification Checklist

Goal: APR-XXXX and JRN-XXXX identifiers are unique and derived from SP item IDs (not sequence-counter race).

- [ ] Submit two approvals in quick succession (open two browser tabs simultaneously)
- [ ] SP verify C3Approvals: both have distinct APR-XXXX Titles; no two share the same Title; neither has a `TMP-*` Title
- [ ] Execute one approved approval to create a C3Journeys row
- [ ] Verify the JRN-XXXX Title matches the expected format for the SP item ID that was assigned
- [ ] Confirm no orphan `TMP-*` rows exist in either list:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$filter=startswith(Title,'TMP-')
  GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=startswith(Title,'TMP-')
  ```
  - [ ] Both return empty results

---

## Part 6 — Journey Lifecycle Checklist

Goal: Platform Owner and Operations accounts can Complete, Suspend, Resume, and Cancel journeys. Visitor cannot.

### 6.1 Prerequisites

- [ ] At least one Active journey exists for a person (created in Part 4 or pre-existing)
- [ ] Platform Owner account is logged in (SP DSM)

### 6.2 Complete journey

- [ ] Open Person Profile for person with Active journey
- [ ] Journey card shows lifecycle action buttons (Complete, Suspend, Cancel)
- [ ] Click Complete
- [ ] Confirmation dialog appears: "Complete this journey?"
- [ ] Click Confirm (Go to "Complete this journey" button)
- [ ] Toast: journey completed confirmation
- [ ] Journey card updates: Status shows Completed; action buttons removed (terminal state)
- [ ] SP verify:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=Title eq '{jrnId}'
  ```
  - [ ] `Status = Completed`
  - [ ] `CompletedAt` is set (ISO timestamp)
  - [ ] `Notes` contains `COMPLETED by <loginName>`

### 6.3 Suspend journey (requires a separate Active journey)

- [ ] Find/create an Active journey
- [ ] Click Suspend
- [ ] Confirmation dialog with reason text field
- [ ] Enter reason; click Confirm
- [ ] Toast: suspended confirmation
- [ ] Journey card: Status = Suspended; buttons show Resume and Cancel (not Suspend/Complete)
- [ ] SP verify: `Status = Suspended`; `Notes` contains `SUSPENDED by <loginName> — <reason>`

### 6.4 Resume journey

- [ ] From Suspended journey in 6.3
- [ ] Click Resume; confirmation dialog; click Confirm
- [ ] Toast: resumed confirmation
- [ ] Journey card: Status = Active; buttons revert to Complete/Suspend/Cancel
- [ ] SP verify: `Status = Active`; `Notes` contains `RESUMED by <loginName>`

### 6.5 Cancel journey (Active → Cancelled)

- [ ] From an Active journey
- [ ] Click Cancel
- [ ] Confirmation dialog shows "Go Back" as dismiss button (not "Cancel")
- [ ] Enter reason; click "Cancel Journey" (or equivalent confirm button in red)
- [ ] Toast: cancelled confirmation
- [ ] Journey card: Status = Cancelled; no further action buttons (terminal state)
- [ ] SP verify: `Status = Cancelled`; `Notes` contains `CANCELLED by <loginName>`

### 6.6 Cancel journey (Suspended → Cancelled)

- [ ] From a Suspended journey
- [ ] Click Cancel; confirm
- [ ] SP verify: `Status = Cancelled` (Suspended → Cancelled is a valid transition)

### 6.7 Visitor cannot see lifecycle buttons

- [ ] Log in with a non-C3-group account (`c3Role: 'visitor'`)
- [ ] Open Person Profile with an Active journey
- [ ] No lifecycle action buttons visible
- [ ] Journey card is read-only

### 6.8 Operations role can manage lifecycle

- [ ] Log in with Operations account (`c3Role: 'operations'`)
- [ ] Lifecycle buttons visible on Person Profile
- [ ] Suspend/Resume/Cancel actions work (repeat 6.3 / 6.4 / 6.5 steps above)
- [ ] Operations account does **not** see Approve/Reject/Execute buttons in Approvals inbox

---

## Part 7 — Duplicate Prevention Checklist

- [ ] Person has an Active Onboarding journey (from Part 4 or Part 6)
- [ ] Submit a second approval for the same person (repeat Part 2)
- [ ] Owner approves the second approval (Part 3.1)
- [ ] Owner clicks Execute on the second Approved card
- [ ] Toast: "Execution blocked — duplicate journey. Approval has been marked ExecutionFailed."
- [ ] SP verify:
  - [ ] Second C3Approvals record: `ApprovalStatus = ExecutionFailed`, `ExecutionError` contains duplicate message, `ExecutedAt` is **null**
  - [ ] No second C3Journeys row for the target person

---

## Part 8 — Negative-path Checklist

### 8.1 Visitor cannot approve/execute

- [ ] Log in as visitor-role account
- [ ] Navigate to Approvals screen — inbox not in NavRail (screen not accessible)
- [ ] Confirm visitor cannot reach Approve/Reject/Execute actions

### 8.2 Self-approval blocked

- [ ] Submit an approval as User A
- [ ] While still logged in as User A, navigate to Approvals inbox
- [ ] Click Approve on own submission
- [ ] Toast: "Self-approval not permitted — You cannot approve your own submission."
- [ ] SP verify: `ApprovalStatus` unchanged (still `Submitted`)

### 8.3 Submitted approval cannot execute

- [ ] A Submitted card in the inbox shows Approve/Reject buttons only — no Execute button
- [ ] Guard: `useExecuteApproval` first check: `if (approval.approvalStatus !== 'Approved') throw` — fires before any SP write

### 8.4 Rejected approval cannot execute

- [ ] A Rejected card in the inbox shows read-only view — no Execute button
- [ ] SP verify: `ApprovalStatus = Rejected` — unchanged after UI confirms no action possible

### 8.5 Completed journey is read-only (terminal)

- [ ] Person with Completed journey: no lifecycle action buttons on journey card
- [ ] Attempting `completeJourney` on a Completed journey throws `InvalidTransitionError` — no SP write

### 8.6 Cancelled journey is read-only (terminal)

- [ ] Person with Cancelled journey: no lifecycle action buttons on journey card

### 8.7 Invalid transition — Suspended cannot be Completed directly

- [ ] (Service-layer test) Call `completeJourney` on a Suspended journey
- [ ] `InvalidTransitionError` thrown before any SP write
- [ ] SP verify: `Status` unchanged (still `Suspended`)

### 8.8 actorLoginName fail-close

- [ ] (Service-layer test or console injection) Call any lifecycle transition with `actorLoginName: ''`
- [ ] Error thrown before any SP write: "actorLoginName must not be empty"
- [ ] SP verify: `Status` and `Notes` unchanged

---

## Part 9 — Beta Go/No-Go Criteria

### Go criteria (all must be true)

- [ ] Part 0 all checks pass (parity, tsc, SP list readiness, SP group provisioning)
- [ ] Part 1: `c3Role` correctly resolved from SP group for all tested accounts
- [ ] Part 2: APR-XXXX Title derived from SP item ID; no TMP-* row after submission
- [ ] Part 3: Approve and Reject paths stamp C3Approvals correctly
- [ ] Part 4: Execute creates JRN-XXXX row; JRN Title derived from SP item ID; no TMP-* row
- [ ] Part 5: No duplicate Titles; no orphan TMP-* rows
- [ ] Part 6: All four lifecycle transitions write correct Status/Notes to SP; visitor sees no action buttons
- [ ] Part 7: Duplicate prevention fires; ExecutionFailed stamped; no duplicate journey; ExecutedAt null
- [ ] Part 8: All negative-path guards confirmed

### No-go conditions (any blocks beta)

- [ ] `c3Role` is `'owner'` for a user not in `C3 Platform Owners` group
- [ ] `c3Role` is `visitor` for a user who is in a C3 group
- [ ] C3Approvals row Title is `TMP-*` after submission (MERGE failed — orphan row)
- [ ] C3Journeys row Title is `TMP-*` after execution (MERGE failed — orphan row)
- [ ] Two concurrent submissions produce identical APR-XXXX or JRN-XXXX Titles
- [ ] `C3Journeys` row created without a preceding `ApprovalStatus = Approved` record
- [ ] `ApprovalStatus = Executed` without corresponding C3Journeys row
- [ ] Self-approval not blocked (same loginName can approve own submission)
- [ ] Duplicate active journey for same person created
- [ ] `ExecutedAt` set on `ExecutionFailed` record (discriminant violation)
- [ ] Visitor-role account can see Approve/Reject/Execute or lifecycle action buttons
- [ ] `InvalidTransitionError` not thrown for invalid transition (SP write proceeds)
- [ ] Any parity harness failing
- [ ] TypeScript compile errors
- [ ] Any console errors in hosted-workbench smoke test

---

## Part 10 — Known Beta Caveats (acknowledged)

The following are known limitations accepted for beta use. They are documented here so that the operator can acknowledge them before proceeding.

| Caveat | Risk | Operator action |
|--------|------|-----------------|
| Manual runtime bundle commit required | Medium | After every code change: `npm run build:runtime` + `npm run copy:c3-runtime` + git commit bundle |
| PartialExecutionError (journey created, stamp failed) | Very low | Manually set `ApprovalStatus = Executed` in SP for the affected C3Approvals item |
| TMP-* orphan row if MERGE fails after POST | Very low | Delete the TMP-* row in SP; re-submit the operation |
| No dedicated audit columns for lifecycle transitions | Low | Notes-append is the audit trail; structured columns deferred to Sprint 20 |
| Executed/Rejected approvals not visible in C3 UI | Functional gap | Query SP directly for audit history |
| Credential writes not implemented | Functional gap | Use SP directly for credential management until Sprint 20+ |
| Contracts/SP-02 not resolved | Functional gap | Separate workstream |

---

## Validation commands

```bash
# Parity harnesses
node scripts/s18-parity-approvals.mjs
node scripts/s17-parity-journeys.mjs
node scripts/s15-parity-test.mjs
node scripts/s16-parity-people.mjs

# TypeScript
npx tsc --noEmit -p packages/c3/tsconfig.json
npx tsc --noEmit -p packages/c3-spfx-host/tsconfig.json

# NUL byte audit (key changed files)
python3 -c "
import sys
files = [
  'packages/c3/src/services/sharepoint/spRoleResolver.ts',
  'packages/c3/src/hosts/SharePointHost.tsx',
  'packages/c3/src/services/sharepoint/SharePointJourneyService.ts',
  'packages/c3/src/services/sharepoint/SharePointApprovalsService.ts',
  'packages/c3/src/screens/PersonProfile.tsx',
]
ok = True
for f in files:
    d = open(f, 'rb').read()
    n = d.count(b'\x00')
    status = 'OK' if n == 0 else f'WARNING: {n} NUL bytes'
    print(f'{f}: {status}')
    if n: ok = False
sys.exit(0 if ok else 1)
"

# Confirm clean working tree
git status
git diff --cached --name-only
```
