# C3 Beta Checkpoint — Sprint 20
**C3 Contract Control Center**
**Status:** BETA CHECKPOINT — Sprint 20 validated
**Baseline date:** 2026-07-01
**Replaces:** C3 Beta Release Candidate Checklist (Sprint 19 baseline)
**See also:** Sprint 20 Closeout Report.md, C3 Architecture Baseline — Sprint 20.md, C3 Beta Release Candidate Checklist.md, ADR-013, ADR-013 Addendum — Journey Lifecycle Transitions.md

> **Purpose:** This checklist is the operator's guide for confirming the complete S20 beta operational path is working correctly in a given SP environment. It extends the Sprint 19 checklist with new checks for approval history, partial execution recovery, and the governed credential write path. Run all parts in order. A failure at any step is a blocker — do not proceed to the next section until resolved.

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `git log --oneline -3` shows:
  ```
  b77c5d6 build(s20-phase-3): Update SPFx runtime bundle after credential entry fix
  4e5045e fix(s20-phase-3): Restore credential approval entry point in SP DSM
  bdf716b feat(s20-phase-3): Add governed credential write path
  ```
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

- [ ] `C3Approvals` list exists and accessible
- [ ] `C3Approvals.OperationType` choice column includes `AddCredential` (in addition to `InitiateJourney`)
- [ ] All existing `C3Approvals` columns from S19 checklist present (Title, OperationType, TargetPersonID, Payload, ApprovalStatus, etc.)
- [ ] `C3Journeys` list exists and accessible
- [ ] `C3Credentials` list exists and accessible
- [ ] `C3Credentials` required columns present:
  - [ ] `Title` — CRED-XXXX identifier (20-char max)
  - [ ] `PersonID` — Single line text (holder's PersonID, e.g. PER-XXXX)
  - [ ] `CredentialType` — Choice column
  - [ ] `ReferenceNumber` — Single line text
  - [ ] `IsActive` — Yes/No
  - [ ] `IssuedBy` — Single line text (optional)
  - [ ] `IssuedDate` — Date and Time (optional)
  - [ ] `ExpiryDate` — Date and Time (optional)
  - [ ] `ValidFromDate` — Date and Time (optional)
  - [ ] `SubType` — Single line text (optional)
  - [ ] `Notes` — Multi-line text (optional)
  - [ ] `SupersedesCredentialID` — Single line text (optional)
- [ ] `C3People` list exists and accessible; at least one PER-XXXX person record present

### 0.3 SP security group provisioning

- [ ] `C3 Platform Owners` group exists; test Platform Owner account is a member
- [ ] `C3 Operations` group exists; test Operations account is a member (if testing operations role)
- [ ] At least one non-owner test account available (not in any C3 group — resolves to `visitor`)

### 0.4 Identity check

- [ ] `currentUser.loginName` visible in browser console (`[C3]` log) — confirm non-empty
- [ ] `currentUser.c3Role` visible in browser console — confirm correct role for each test account

---

## Part 1 — Role Resolution Checklist

*(Unchanged from Sprint 19. Documented here for completeness.)*

- [ ] Open hosted workbench with Platform Owner account (SP DSM: `dataSrc=sharepoint`)
- [ ] Console: `c3Role: 'owner'`; Approvals inbox in NavRail; lifecycle action buttons visible on Person Profile
- [ ] Open workbench with non-C3-group account
- [ ] Console: `c3Role: 'visitor'`; Approvals inbox NOT in NavRail; no lifecycle or Add Credential buttons
- [ ] (If testing operations role) Console: `c3Role: 'operations'`; lifecycle buttons visible; Add Credential visible; no Approve/Reject/Execute in inbox

---

## Part 2 — People / Profile Navigation Checklist (NEW in S20)

Goal: PersonProfile loads correctly when navigated from the People Workspace using canonical PersonID.

- [ ] Open People Workspace (SP DSM)
- [ ] Click through to a person
- [ ] PersonProfile loads: correct person name in header; Readiness tab visible; Credentials section visible
- [ ] No "Could not load person" error state
- [ ] Credentials section shows actual credential count (0 is acceptable if the person has no credentials — it is not an error)
- [ ] Add Credential button visible (owner/operations role) or absent (visitor role)
- [ ] Navigate to a different person: same result

---

## Part 3 — Approval Submission Checklist (Journey)

*(Unchanged from Sprint 19.)*

- [ ] Logged in as Platform Owner or Operations (SP DSM)
- [ ] People → person with no active Onboarding journey → Readiness tab → Start Onboarding Journey
- [ ] Fill form; click "Submit for Approval"
- [ ] Toast: submission confirmation; "Awaiting approval" banner shown
- [ ] SP verify C3Approvals: `Title = APR-XXXX` (from SP item ID); `ApprovalStatus = Submitted`; `OperationType = InitiateJourney`; no `TMP-*` Title

---

## Part 4 — Approval Review Checklist

*(Unchanged from Sprint 19.)*

### 4.1 Approve path

- [ ] Platform Owner opens Approvals inbox → Submitted card visible → Approve
- [ ] Toast: "Approval approved"; badge: Approved; Execute button appears
- [ ] SP verify: `ApprovalStatus = Approved`, `ReviewedBy` and `ReviewedAt` set

### 4.2 Reject path (separate test record)

- [ ] Submit second approval → Platform Owner clicks Reject → enter reason → Confirm Reject
- [ ] Toast: "Approval rejected"; badge: Rejected; no further action buttons
- [ ] SP verify: `ApprovalStatus = Rejected`, `RejectionReason` set; no C3Journeys row

---

## Part 5 — Execution Checklist (Journey)

*(Unchanged from Sprint 19.)*

- [ ] Approved card in inbox → Platform Owner clicks Execute
- [ ] Toast: "Journey created for [personId]"
- [ ] SP verify C3Approvals: `ApprovalStatus = Executed`, `ExecutedAt` set, `ExecutionError` null
- [ ] SP verify C3Journeys: `Title = JRN-XXXX` (from SP item ID); `Status = Active`; no `TMP-*` Title
- [ ] Person Profile shows Journey card (JRN-XXXX, Active)

---

## Part 6 — Approval History Checklist (NEW in S20)

Goal: Executed, Rejected, and Failed records are visible in-app. Tab filtering works correctly.

### 6.1 Tab structure

- [ ] Open Approvals inbox (SP DSM, Platform Owner)
- [ ] Six tabs visible: Pending / Approved / Executed / Rejected / Failed / All
- [ ] Pending tab: shows only Submitted + InReview records; tab count matches
- [ ] Approved tab: shows only Approved records awaiting execution
- [ ] Executed tab: shows Executed records from prior operations; tab count matches SP

### 6.2 Executed record detail

- [ ] Click an Executed card
- [ ] `ReviewedBy`, `ReviewedAt`, `ExecutedAt` displayed
- [ ] `PayloadSummary` rendered: fields for the operation type shown (journeyType, personId, assignedTo, etc. for InitiateJourney)
- [ ] No Approve/Reject/Execute action buttons (terminal state)

### 6.3 Rejected record detail

- [ ] Click a Rejected card (from Part 4.2)
- [ ] `RejectionReason` displayed with danger colour
- [ ] `ReviewedBy` and `ReviewedAt` displayed
- [ ] No action buttons

### 6.4 Failed record detail (if available)

- [ ] If an ExecutionFailed record exists: visible in Failed tab
- [ ] `ExecutionError` displayed with danger colour
- [ ] No action buttons

### 6.5 All tab

- [ ] All tab: all records across all statuses visible in a single list
- [ ] Count matches sum of individual tabs

### 6.6 Empty states

- [ ] Select a tab with no matching records: appropriate empty-state message shown (not a blank white box)

---

## Part 7 — Partial Execution Recovery Checklist (NEW in S20)

Goal: When an InitiateJourney approval is in Approved state and the person already has an active journey, the Execute button is replaced by a recovery action.

### 7.1 Setup

- [ ] An Active journey exists for a person (from Part 5 or pre-existing)
- [ ] A corresponding C3Approvals record for that person exists with `ApprovalStatus = Approved` (simulates PartialExecutionError: journey created but stamp failed)
  - *Note: The easiest way to simulate this in beta is to manually set an Executed record back to Approved in SP, or to create a fresh Approved record for a person who already has an Active journey*

### 7.2 Recovery candidate detection

- [ ] Open Approvals inbox → Approved tab
- [ ] For the Approved card where the person already has an Active journey:
  - [ ] Brief "Checking…" spinner visible (not blocking)
  - [ ] Execute button is **replaced** by "Recover Execution Stamp" (warning-coloured button)
  - [ ] MessageBar warning callout visible explaining that a journey already exists

### 7.3 Recovery execution

- [ ] Click "Recover Execution Stamp"
- [ ] Toast: stamp recovered successfully
- [ ] SP verify C3Approvals: `ApprovalStatus = Executed`, `ExecutedAt` set
- [ ] SP verify C3Journeys: **no second journey row** for the same person (only the pre-existing Active journey remains)
- [ ] Card moves to Executed tab

### 7.4 Recovery target missing error

- [ ] If the Active journey is cancelled between detection and clicking Recover:
  - [ ] `RecoveryTargetMissingError` toast shown: "Use Execute instead"
  - [ ] No C3Approvals stamp attempted
  - [ ] Card remains in Approved state

---

## Part 8 — Credential Approval Submission Checklist (NEW in S20)

Goal: AddCredential flows through the ADR-013 approval loop in SP DSM. A C3Approvals row with `OperationType = AddCredential` is created. No C3Credentials row at submission time.

- [ ] Logged in as Platform Owner or Operations (SP DSM)
- [ ] People → person → Person Profile (confirm profile loads correctly per Part 2)
- [ ] Add Credential button visible
- [ ] Click Add Credential → panel opens
- [ ] Submit button label reads "Submit for Approval" (SP DSM)
- [ ] Fill form: Credential Type (required), Reference Number (required), and optional fields
- [ ] Click "Submit for Approval"
- [ ] Toast: "Credential approval submitted — APR-XXXX"
- [ ] Panel closes; no credential card appears immediately on Person Profile
- [ ] SP verify C3Approvals:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$orderby=ID desc&$top=1
  ```
  - [ ] `Title = APR-XXXX` (derived from SP item ID — not incremented from previous)
  - [ ] `ApprovalStatus = Submitted`
  - [ ] `OperationType = AddCredential`
  - [ ] `TargetPersonID = <personId>`
  - [ ] `Payload` is non-empty JSON containing `operationType`, `holderPersonId`, `credentialType`, `referenceNumber`
  - [ ] No `TMP-*` Title (MERGE to canonical APR-XXXX completed)
- [ ] SP verify C3Credentials: **no new row** for this person yet

---

## Part 9 — Credential Approval Review and Execution Checklist (NEW in S20)

Goal: Platform Owner approves and executes the AddCredential approval. C3Credentials row is created with CRED-XXXX Title.

### 9.1 Approval Inbox — AddCredential card

- [ ] Platform Owner opens Approvals inbox → Pending tab
- [ ] AddCredential card visible (APR-XXXX from Part 8)
- [ ] `PayloadSummary` shows: `credentialType`, `referenceNumber`, `holderPersonId` (required); optional fields shown when present
- [ ] Approve and Reject buttons present

### 9.2 Approve

- [ ] Click Approve
- [ ] Toast: "Approval approved"; badge: Approved; Execute button appears

### 9.3 Execute

- [ ] Click Execute
- [ ] Toast: "[credentialType] credential registered for [holderPersonId]"
- [ ] SP verify C3Approvals: `ApprovalStatus = Executed`, `ExecutedAt` set, `ExecutionError` null
- [ ] SP verify C3Credentials:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=PersonID eq '{personId}'&$orderby=ID desc&$top=1
  ```
  - [ ] `Title = CRED-XXXX` (derived from SP item ID)
  - [ ] `PersonID = <holderPersonId>`
  - [ ] `CredentialType = <credentialType from payload>`
  - [ ] `ReferenceNumber = <referenceNumber from payload>`
  - [ ] `IsActive = true`
  - [ ] No `TMP-*` Title present
- [ ] Person Profile → Credentials section: new credential card visible (CRED-XXXX)

### 9.4 Multiple credentials per person

- [ ] Repeat Part 8–9.3 for the same person, same credential type
- [ ] Both credentials appear on Person Profile; no duplicate prevention error
- [ ] Two distinct CRED-XXXX records in C3Credentials for the same person

### 9.5 AddCredential Reject path

- [ ] Submit a second AddCredential approval (repeat Part 8)
- [ ] Platform Owner clicks Reject; enter reason; Confirm Reject
- [ ] Toast: "Approval rejected"; badge: Rejected
- [ ] SP verify: `ApprovalStatus = Rejected`, `RejectionReason` set; no C3Credentials row

---

## Part 10 — Journey Lifecycle Checklist

*(Unchanged from Sprint 19. Run to confirm no regression.)*

- [ ] Active journey exists → lifecycle action buttons visible (owner/operations)
- [ ] Complete: `Status = Completed`; `CompletedAt` set; Notes append
- [ ] Suspend + Resume: `Status = Suspended` then `Active`; Notes appended both transitions
- [ ] Cancel (Active → Cancelled): `Status = Cancelled`; Notes appended; "Go Back" dismiss button
- [ ] Cancel (Suspended → Cancelled): valid transition confirmed
- [ ] Visitor: no lifecycle action buttons visible

---

## Part 11 — Duplicate Journey Prevention Checklist

*(Unchanged from Sprint 19.)*

- [ ] Person has Active Onboarding journey → submit second approval → Owner approves → Execute
- [ ] Toast: "Execution blocked — duplicate journey. Approval has been marked ExecutionFailed."
- [ ] SP verify: second C3Approvals → `ApprovalStatus = ExecutionFailed`; `ExecutedAt` null; no second journey

---

## Part 12 — Negative-path Checklist

### 12.1 Visitor cannot approve/execute

- [ ] Visitor-role account: Approvals inbox not in NavRail; cannot reach Approve/Reject/Execute actions

### 12.2 Self-approval blocked

- [ ] Submit approval as User A → while still User A, click Approve on own submission
- [ ] Toast: "Self-approval not permitted"
- [ ] `ApprovalStatus` unchanged

### 12.3 Submitted approval cannot execute

- [ ] Submitted card: Approve/Reject buttons only — no Execute button

### 12.4 Rejected approval cannot execute

- [ ] Rejected card: read-only; no Execute button

### 12.5 Completed journey is read-only (terminal)

- [ ] No lifecycle action buttons on Completed journey card

### 12.6 Cancelled journey is read-only (terminal)

- [ ] No lifecycle action buttons on Cancelled journey card

### 12.7 Add Credential not visible to visitor

- [ ] Visitor-role account: no Add Credential button on Person Profile (including when Credentials count is 0)

### 12.8 Add Credential — mock DSM uses direct write (no approval loop)

- [ ] In mock DSM: submit Add Credential form → button label reads "Register Credential"
- [ ] Toast: "Credential registered" (not "submitted for approval")
- [ ] Credential card appears immediately on Person Profile (no inbox flow)

### 12.9 No TMP-* orphan rows after credential execution

- [ ] After any AddCredential execution:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=startswith(Title,'TMP-')
  ```
  - [ ] Returns empty results

### 12.10 PersonProfile navigation from non-canonical ID (regression guard)

- [ ] If PersonProfile is opened without a valid PersonID, a clear empty/selection state is shown — not the "Could not load person" error from before S20 fix

---

## Part 13 — Beta Go/No-Go Criteria

### Go criteria (all must be true)

- [ ] Part 0 all checks pass (parity, tsc, SP list readiness, group provisioning)
- [ ] Part 1: `c3Role` correctly resolved from SP group for all tested accounts
- [ ] Part 2: PersonProfile loads correctly from People Workspace; Add Credential visible/hidden per role
- [ ] Part 3: APR-XXXX (InitiateJourney) derived from SP item ID; no TMP-* row
- [ ] Part 4: Approve and Reject paths stamp C3Approvals correctly
- [ ] Part 5: Execute creates JRN-XXXX row; no TMP-* row; Person Profile shows Journey card
- [ ] Part 6: Approval history visible in all relevant tabs; audit fields rendered; empty states correct
- [ ] Part 7: Recovery candidate detected (Approved + existing active journey); Recover Stamp works; no duplicate journey
- [ ] Part 8: APR-XXXX (AddCredential) derived from SP item ID; no TMP-* row; no premature CRED row
- [ ] Part 9: CRED-XXXX derived from SP item ID; no TMP-* row; multiple credentials per person allowed; credential visible on Person Profile
- [ ] Part 10: All four journey lifecycle transitions pass (no regression from S19)
- [ ] Part 11: Duplicate journey prevention fires correctly
- [ ] Part 12: All negative-path guards confirmed

### No-go conditions (any blocks beta)

- [ ] `c3Role` is `'owner'` for a user not in `C3 Platform Owners` group
- [ ] `c3Role` is `'visitor'` for a user who is in a C3 group
- [ ] PersonProfile shows "Could not load person" when navigated from People Workspace
- [ ] Add Credential visible to visitor-role accounts
- [ ] Add Credential NOT visible to owner or operations accounts in SP DSM
- [ ] C3Approvals (AddCredential) `Title` is `TMP-*` after submission (MERGE failed)
- [ ] C3Credentials `Title` is `TMP-*` after execution (MERGE failed)
- [ ] C3Credentials row created without preceding `ApprovalStatus = Approved` record
- [ ] `ApprovalStatus = Executed` on AddCredential record without corresponding C3Credentials row
- [ ] Recovery stamp creates a second C3Journeys row (must be stamp-only)
- [ ] Execute button visible instead of Recover button when active journey already exists (Approved + InitiateJourney)
- [ ] Approval history tabs (Executed/Rejected/Failed) show no records when SP has records
- [ ] Self-approval not blocked
- [ ] Duplicate active journey for same person created (InitiateJourney guard)
- [ ] `ExecutedAt` set on `ExecutionFailed` record (discriminant violation)
- [ ] `InvalidTransitionError` not thrown for invalid journey transition (SP write proceeds)
- [ ] Any parity harness failing
- [ ] TypeScript compile errors
- [ ] Any console errors in hosted-workbench smoke test

---

## Part 14 — Known Beta Caveats (acknowledged)

| Caveat | Risk | Operator action |
|--------|------|-----------------|
| Manual runtime bundle commit required | Medium | After every code change: `npm run build:runtime` + bundle commit |
| `PartialCredentialExecutionError` (CRED created, stamp failed) | Low — no in-app recovery UX | Manually set `ApprovalStatus = Executed` in C3Approvals for the affected record |
| `PartialExecutionError` recovery false positive (manual SP row) | Very low | If a CRED row was manually inserted in SP outside C3, the recovery detector may not trigger correctly |
| TMP-* orphan row if MERGE fails after POST | Very low | Delete the TMP-* row in SP; re-submit the operation |
| No dedicated audit columns for journey lifecycle transitions | Low | Notes-append is the audit trail; SuspendedAt/CancelledAt deferred to Sprint 21 |
| `deactivateCredential` not implemented | Functional gap — credentials cannot be deactivated via C3 | Manage credential IsActive flag directly in SP |
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

# NUL byte audit (Sprint 20 key files)
python3 -c "
import sys
files = [
  'packages/c3/src/components/ErrorBoundary.tsx',
  'packages/c3/src/hooks/useRecoverExecutionStamp.ts',
  'packages/c3/src/hooks/useSubmitCredentialApproval.ts',
  'packages/c3/src/hooks/useExecuteApproval.ts',
  'packages/c3/src/services/sharepoint/SharePointCredentialService.ts',
  'packages/c3/src/screens/ApprovalInbox.tsx',
  'packages/c3/src/screens/PeopleWorkspace.tsx',
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
