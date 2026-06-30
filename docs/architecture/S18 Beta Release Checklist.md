# S18 Beta Release Checklist
**C3 Contract Control Center**
**Sprint:** 18 — Governed SharePoint Write Operations
**Status:** BETA — hosted-workbench validated; pre-go-live blockers listed below
**See also:** S18 Beta Validation Runbook.md, Sprint 18 Closeout Report.md, ADR-013

> **Purpose:** This checklist is the operator's guide for confirming the S18 approval loop is working correctly in a given SP environment. Run it in order. A failure at any step is a blocker — do not proceed to the next section.

---

## Part 1 — SP DSM Environment Validation

### 1.1 SharePoint lists

- [ ] `C3Approvals` list exists and is accessible at `{siteUrl}/_api/web/lists/getbytitle('C3Approvals')`
- [ ] `C3Approvals` columns present with correct internal names:
  - [ ] `Title` (APR-XXXX identifier)
  - [ ] `OperationType` (Choice: InitiateJourney, …)
  - [ ] `TargetPersonID` (Single line text)
  - [ ] `SubmittedBy` (Single line text)
  - [ ] `SubmittedAt` (Date and Time)
  - [ ] `ApprovalStatus` (Choice: Submitted, InReview, Approved, Rejected, Executed, ExecutionFailed)
  - [ ] `ReviewedBy` (Single line text)
  - [ ] `ReviewedAt` (Date and Time)
  - [ ] `ExecutedAt` (Date and Time)
  - [ ] `ExecutionError` (Multi-line text)
  - [ ] `RejectionReason` (Multi-line text)
  - [ ] `Payload` (Multi-line text)
  - [ ] `Reason` (Multi-line text)
- [ ] `C3Journeys` list exists and accessible
- [ ] `C3People` list exists and accessible; at least one PER-XXXX person record with no active Onboarding journey

### 1.2 Identity

- [ ] SPFx `pageContext.user.loginName` is non-empty for the test user
- [ ] `currentUser.loginName` visible in browser console (`[C3]` log or DevTools inspection)
- [ ] Two distinct accounts available (submitter ≠ approver) for self-approval negative test

---

## Part 2 — Approval Submission Checklist

Goal: ops staff can submit a Start Onboarding Journey proposal that creates a `C3Approvals` record with `ApprovalStatus: Submitted`. No `C3Journeys` row is created.

- [ ] Open hosted workbench in SP DSM (`dataSrc=sharepoint`)
- [ ] Navigate to People Workspace; find a person with no active Onboarding journey
- [ ] Open Person Profile; navigate to Readiness tab
- [ ] "Start Onboarding Journey" button visible
- [ ] Click button; fill in form: `initiationReason` (required), `assignedTo` (required)
- [ ] Click "Submit for Approval"
- [ ] Toast appears: submission confirmation message
- [ ] "Awaiting approval" banner shown in panel (no immediate Journey card)
- [ ] SP verify — `C3Approvals` row created:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$orderby=ID desc&$top=1
  ```
  - [ ] `ApprovalStatus = Submitted`
  - [ ] `OperationType = InitiateJourney`
  - [ ] `TargetPersonID = <personId>`
  - [ ] `SubmittedBy = <loginName>`
  - [ ] `SubmittedAt` is set (non-null)
  - [ ] `Payload` is non-empty JSON
- [ ] SP verify — no new `C3Journeys` row for this person:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=PersonID eq '{personId}'
  ```
  - [ ] Row count is same as before submission

---

## Part 3 — Approval Review Checklist

Goal: Platform Owner can see the pending submission in the Approvals inbox and take Approve or Reject actions.

### 3.1 Inbox visibility

- [ ] Navigate to Approvals screen (shield icon in NavRail)
- [ ] Submitted card appears with `Submitted` badge (orange/warning)
- [ ] Card shows: Title, OperationType, PersonID, SubmittedBy, SubmittedAt
- [ ] Approve and Reject buttons visible (c3Role is `owner`)
- [ ] Inbox count badge shows correct count

### 3.2 Approve path

- [ ] Click Approve on the Submitted card
- [ ] Button shows "Approving…" while request is in flight
- [ ] Toast: "Approval approved — [title] has been approved."
- [ ] Card badge updates to `Approved` (purple/brand)
- [ ] Approve/Reject buttons replaced by Execute button
- [ ] SP verify:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items({id})?$select=ApprovalStatus,ReviewedBy,ReviewedAt
  ```
  - [ ] `ApprovalStatus = Approved`
  - [ ] `ReviewedBy = <loginName>`
  - [ ] `ReviewedAt` is set

### 3.3 Reject path (separate test record)

- [ ] Submit a second approval (repeat Part 2)
- [ ] Click Reject; Rejection reason textarea appears
- [ ] Enter rejection reason; click Confirm Reject
- [ ] Toast: "Approval rejected — [title] has been rejected."
- [ ] Card badge updates to `Rejected` (red/danger); no buttons shown
- [ ] SP verify:
  - [ ] `ApprovalStatus = Rejected`
  - [ ] `RejectionReason = <text entered>`
- [ ] SP verify — no new `C3Journeys` row for the target person

---

## Part 4 — Execution Checklist

Goal: clicking Execute on an Approved record creates a `C3Journeys` row and stamps the approval `Executed`.

- [ ] An Approved card is visible in the inbox
- [ ] Click Execute
- [ ] Button shows "Executing…" while in flight (may take 2–5 seconds — two SP writes)
- [ ] Toast: "Approval executed — [title] — Journey created for [personId]."
- [ ] Card disappears from inbox (no longer Submitted/InReview/Approved status)
- [ ] SP verify — `C3Approvals` stamped:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items({id})?$select=ApprovalStatus,ExecutedAt,ExecutionError
  ```
  - [ ] `ApprovalStatus = Executed`
  - [ ] `ExecutedAt` is set (ISO timestamp)
  - [ ] `ExecutionError` is null
- [ ] SP verify — `C3Journeys` row created:
  ```
  GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=PersonID eq '{personId}'&$orderby=ID desc&$top=1
  ```
  - [ ] `Title = JRN-XXXX` (next in sequence)
  - [ ] `PersonID = <targetPersonId>`
  - [ ] `JourneyType = Onboarding`
  - [ ] `Status = Active`
  - [ ] `InitiatedBy = <loginName from payload>`
  - [ ] `InitiatedAt` is set
  - [ ] `AssignedTo = <value from payload>`
- [ ] Navigate to Person Profile for the target person
  - [ ] Journey card (JRN-XXXX, Active) appears on Readiness tab

---

## Part 5 — Duplicate Prevention Checklist

Goal: attempting to Execute an approval for a person who already has an active Onboarding journey is blocked.

- [ ] Confirm the target person now has `Status = Active` journey in `C3Journeys` (from Part 4)
- [ ] Submit a second approval for the same person (repeat Part 2)
- [ ] Owner approves the second approval (repeat Part 3.2)
- [ ] Owner clicks Execute on the second Approved card
- [ ] Toast: "Execution blocked — duplicate journey. An active Onboarding journey already exists for this person. Approval has been marked ExecutionFailed."
- [ ] SP verify — second `C3Approvals` record:
  - [ ] `ApprovalStatus = ExecutionFailed`
  - [ ] `ExecutionError` contains duplicate message
  - [ ] `ExecutedAt` is **null** (ExecutionFailed must not stamp a timestamp)
- [ ] SP verify — no second `C3Journeys` row for the target person

---

## Part 6 — Negative-path Checklist

### 6.1 Self-approval blocked

- [ ] Submit an approval as User A (repeat Part 2)
- [ ] Stay logged in as User A
- [ ] Navigate to Approvals inbox; find the Submitted card
- [ ] Click Approve
- [ ] Toast: "Self-approval not permitted — You cannot approve your own submission."
- [ ] SP verify — `ApprovalStatus` unchanged (still `Submitted`)

> If testing with a single account, confirm `SubmittedBy` matches `currentUser.loginName` in the `C3Approvals` record. The guard operates on this comparison.

### 6.2 Rejected approval cannot execute

- [ ] Confirm a Rejected card exists in the C3Approvals list (from Part 3.3)
- [ ] Confirm no Execute button appears on a Rejected card in the inbox (cards with Rejected status show read-only view)
- [ ] Attempt to call `useExecuteApproval` directly via console or test (should throw immediately: "Only approved approvals can be executed. Current status: Rejected")

### 6.3 Submitted approval cannot execute

- [ ] Confirm a Submitted card has no Execute button (action area shows Approve/Reject only)
- [ ] Guard check: `useExecuteApproval` mutationFn first guard: `if (approval.approvalStatus !== 'Approved') throw` — fires before any SP write

### 6.4 Duplicate active Onboarding journey — verified in Part 5

### 6.5 PayloadValidationError (manual test via SP)

- [ ] In SharePoint, create a `C3Approvals` item manually with `ApprovalStatus = Approved` and blank/null `Payload`
- [ ] In the C3 Approvals inbox, the item should appear as Approved (after polling refresh)
- [ ] Click Execute
- [ ] Toast: "Execution blocked — invalid payload. The approval payload is missing or malformed. No journey was created."
- [ ] SP verify — `ApprovalStatus` unchanged (remains `Approved`; no ExecutionFailed stamp — correct, no write occurred)

---

## Part 7 — Pre-go-live Blockers

The following must be resolved before C3 SP mode is deployed beyond a single-operator beta environment. None of these are Sprint 18 scope — they are Sprint 19 and beyond.

| # | Blocker | Severity | Resolution |
|---|---------|----------|------------|
| **B1** | `c3Role` hardcoded `'owner'` in `SharePointHost.tsx` | 🔴 Critical | Replace with real SP security-group membership lookup. Until resolved, ALL authenticated users who reach the workbench have Platform Owner permissions in C3. |
| **B2** | `loginName` empty-string edge case in self-approval guard | 🟡 High | Verify `pageContext.user.loginName` is always non-empty for all user types (including guests and externals) in the target tenant. Add a fallback guard if needed. |
| **B3** | JRN-XXXX sequence race | 🟡 Medium | Concurrent submissions from two browser sessions can produce duplicate JRN IDs. SP will accept both (no unique constraint). Add SP column uniqueness or server-side counter before volume exceeds single-operator use. |
| **B4** | Manual runtime bundle commit | 🟡 Medium | Every code change requires a manual `npm run build:runtime` + git commit of the bundle before the workbench picks up the update. Wire CI. |
| **B5** | PartialExecutionError requires manual SP edit | 🟡 Medium | Journey created but approval stamp failed. Recovery: operator manually sets `ApprovalStatus = Executed` in SP. Document in operator runbook. Extremely rare in practice but must be covered before go-live. |
| **B6** | No journey state transitions via C3 | 🟠 Functional gap | `completeJourney`, `suspendJourney`, `cancelJourney` are stub-throwing. Ops staff cannot complete or cancel journeys through C3. Sprint 19 scope. |
| **B7** | No Executed/Rejected records in C3 UI | 🟠 Functional gap | Audit records only viewable in SharePoint directly. No C3 history view. Future sprint. |

---

## Part 8 — Beta Go/No-Go Criteria

The following are the minimum criteria for continuing hosted-workbench beta use by a single Platform Owner. They do **not** constitute production readiness.

### Go criteria (all must be true)

- [ ] **B1 understood and accepted**: Platform Owner confirms awareness that all SP-mode users currently receive owner role; usage is restricted to trusted operators only until B1 is resolved
- [ ] Part 2 checklist: Submission creates C3Approvals row, no C3Journeys row ✓
- [ ] Part 3 checklist: Approve path stamps C3Approvals correctly ✓
- [ ] Part 4 checklist: Execute path creates C3Journeys row and stamps Executed ✓
- [ ] Part 5 checklist: Duplicate block fires correctly; no duplicate journey ✓
- [ ] Part 6.1 checklist: Self-approval blocked ✓
- [ ] Parity harnesses all passing (s15/s16/s17/s18) ✓
- [ ] tsc clean on both packages ✓
- [ ] No console errors in hosted-workbench smoke test ✓

### No-go conditions (any blocks beta)

- [ ] C3Approvals list not accessible or missing required columns
- [ ] `C3Journeys` row created without a preceding `ApprovalStatus = Approved` record
- [ ] `ApprovalStatus = Executed` stamped without a corresponding `C3Journeys` row existing
- [ ] Self-approval not blocked (same loginName as submitter can approve)
- [ ] Duplicate active journey for the same person created
- [ ] `ExecutedAt` set on an `ExecutionFailed` record (discriminant violation)
- [ ] Any parity harness failing
- [ ] TypeScript compile errors

---

## Validation commands

```bash
node scripts/s18-parity-approvals.mjs
node scripts/s17-parity-journeys.mjs
node scripts/s15-parity-test.mjs
node scripts/s16-parity-people.mjs
npx tsc --noEmit -p packages/c3/tsconfig.json
npx tsc --noEmit -p packages/c3-spfx-host/tsconfig.json
```

NUL byte audit:
```bash
python3 -c "
files = [
  'packages/c3/src/screens/ApprovalInbox.tsx',
  'packages/c3/src/hooks/useExecuteApproval.ts',
  'packages/c3/src/hooks/usePatchApprovalStatus.ts',
  'packages/c3/src/hosts/SharePointHost.tsx',
]
for f in files:
    d = open(f,'rb').read()
    n = d.count(b'\x00')
    print(f'{f}: {n} NUL bytes' + (' ⚠' if n else ' ✓'))
"
```

Bundle check (must not be staged unless explicitly rebuilding):
```bash
git diff --name-only --staged | grep c3-spfx-host/dist
```
