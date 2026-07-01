# C3 Beta Checkpoint — Sprint 21
**C3 Contract Control Center**
**Status:** BETA CHECKPOINT — Sprint 21 validated
**Baseline date:** 2026-07-01
**Supersedes:** C3 Beta Checkpoint — Sprint 20
**See also:** Sprint 21 Closeout Report.md, C3 Architecture Baseline — Sprint 21.md, ADR-013, ADR-013 Addendum — Journey Lifecycle Transitions.md

> **Purpose:** This checklist is the operator's guide for confirming the complete S21 beta operational path is working correctly in a given SP environment. It supersedes the Sprint 20 checkpoint. Run all parts in order. A failure at any step is a blocker — do not proceed to the next section until resolved.

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `git log --oneline -5` shows:
  ```
  7c7967e docs(s22): Add beta operational runbook and error library
  4d9f3f2 docs(backlog): Record C3 product expansion backlog
  998aa6f docs(s21): Close Sprint 21 and update beta baseline
  22c9a5e chore(s21-phase-4): Add beta runtime verification scripts
  e226257 build(s21-phase-3): Update SPFx runtime bundle after credential UX hardening
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
- [ ] Runtime bundle verified:
  ```bash
  npm run beta:runtime    # build + copy in one step
  npm run verify:runtime  # expect PASS and SHA-256 match
  ```

### 0.2 SharePoint list readiness

- [ ] `C3Approvals` list exists and accessible
- [ ] `C3Approvals.OperationType` choice column includes `AddCredential` and `InitiateJourney`
- [ ] All required `C3Approvals` columns present (Title, OperationType, TargetPersonID, Payload, ApprovalStatus, ReviewedBy, ReviewedAt, RejectionReason, ExecutedAt, ExecutionError)
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

- [ ] Open hosted workbench with Platform Owner account (SP DSM: `dataSrc=sharepoint`)
- [ ] Console: `c3Role: 'owner'`; Approvals inbox in NavRail; lifecycle action buttons visible on Person Profile
- [ ] Open workbench with non-C3-group account
- [ ] Console: `c3Role: 'visitor'`; Approvals inbox NOT in NavRail; no lifecycle or Add Credential buttons
- [ ] (If testing operations role) Console: `c3Role: 'operations'`; lifecycle buttons visible; Add Credential visible; no Approve/Reject/Execute in inbox

---

## Part 2 — People / Profile Navigation Checklist

Goal: PersonProfile loads correctly when navigated from the People Workspace using canonical PersonID.

- [ ] Open People Workspace (SP DSM)
- [ ] Click through to a person
- [ ] PersonProfile loads: correct person name in header; three tabs visible (Profile, Readiness, Approvals)
- [ ] No "Could not load person" error state
- [ ] Profile tab: Credentials section shows actual credential count (0 is acceptable if person has no credentials)
- [ ] Add Credential button visible (owner/operations role) or absent (visitor role)
- [ ] Navigate to a different person: same result

---

## Part 3 — Approval Submission Checklist (Journey)

- [ ] Logged in as Platform Owner or Operations (SP DSM)
- [ ] People → person with no active Onboarding journey → Readiness tab → Start Onboarding Journey
- [ ] Fill form; click "Submit for Approval"
- [ ] Toast: submission confirmation; "Awaiting approval" banner shown
- [ ] SP verify C3Approvals: `Title = APR-XXXX`; `ApprovalStatus = Submitted`; `OperationType = InitiateJourney`; no `TMP-*` Title

---

## Part 4 — Approval Review Checklist

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

- [ ] Approved card in inbox → Platform Owner clicks Execute
- [ ] Toast: "Journey created for [personId]"
- [ ] SP verify C3Approvals: `ApprovalStatus = Executed`, `ExecutedAt` set, `ExecutionError` null
- [ ] SP verify C3Journeys: `Title = JRN-XXXX`; `Status = Active`; no `TMP-*` Title
- [ ] Person Profile shows Journey card (JRN-XXXX, Active)

---

## Part 6 — Approval History Checklist

Goal: Executed, Rejected, and Failed records are visible in-app. Tab filtering works correctly.

### 6.1 Tab structure

- [ ] Open Approvals inbox (SP DSM, Platform Owner)
- [ ] Six tabs visible: Pending / Approved / Executed / Rejected / Failed / All
- [ ] Pending tab: shows only Submitted + InReview records; tab count matches
- [ ] Approved tab: shows only Approved records awaiting execution
- [ ] Executed tab: shows Executed records; tab count matches SP

### 6.2 Executed record detail

- [ ] Click an Executed card
- [ ] `ReviewedBy`, `ReviewedAt`, `ExecutedAt` displayed
- [ ] `PayloadSummary` rendered with human-readable labels (e.g. "League Registration" not "LeagueRegistration" for AddCredential)
- [ ] No Approve/Reject/Execute action buttons (terminal state)

### 6.3 Rejected record detail

- [ ] Click a Rejected card
- [ ] `RejectionReason` displayed with danger colour
- [ ] `ReviewedBy` and `ReviewedAt` displayed
- [ ] No action buttons

### 6.4 Failed record detail (if available)

- [ ] If an ExecutionFailed record exists: visible in Failed tab
- [ ] `ExecutionError` displayed with danger colour
- [ ] No action buttons

### 6.5 All tab

- [ ] All records across all statuses visible in a single list
- [ ] Count matches sum of individual tabs

### 6.6 Empty states

- [ ] Select a tab with no matching records: appropriate empty-state message shown (not a blank white box)

---

## Part 7 — Journey Partial Execution Recovery Checklist

Goal: When an InitiateJourney approval is in Approved state and the person already has an active journey, the Execute button is replaced by a recovery action.

### 7.1 Setup

- [ ] An Active journey exists for a person
- [ ] A corresponding C3Approvals record for that person exists with `ApprovalStatus = Approved`

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
- [ ] SP verify C3Journeys: **no second journey row** for the same person
- [ ] Card moves to Executed tab

### 7.4 Recovery target missing error

- [ ] If the Active journey is cancelled between detection and clicking Recover:
  - [ ] `RecoveryTargetMissingError` toast shown
  - [ ] No C3Approvals stamp attempted
  - [ ] Card remains in Approved state

---

## Part 8 — Credential Approval Submission Checklist

Goal: AddCredential flows through the ADR-013 approval loop in SP DSM.

- [ ] Logged in as Platform Owner or Operations (SP DSM)
- [ ] People → person → Person Profile → Add Credential button visible
- [ ] Click Add Credential → panel opens
- [ ] Submit button label reads "Submit for Approval" (SP DSM)
- [ ] Fill form: Credential Type (required), Reference Number (required), and optional fields
- [ ] Click "Submit for Approval"
- [ ] Toast: "Credential approval submitted — APR-XXXX"
- [ ] Panel closes; no credential card appears immediately on Person Profile
- [ ] SP verify C3Approvals:
  - [ ] `Title = APR-XXXX` (derived from SP item ID — not TMP-*)
  - [ ] `ApprovalStatus = Submitted`
  - [ ] `OperationType = AddCredential`
  - [ ] `TargetPersonID = <personId>`
  - [ ] `Payload` is non-empty JSON containing `operationType`, `holderPersonId`, `credentialType`, `referenceNumber`
- [ ] SP verify C3Credentials: **no new row** for this person yet

---

## Part 9 — Credential Approval Review and Execution Checklist

Goal: Platform Owner approves and executes the AddCredential approval. C3Credentials row is created with CRED-XXXX Title.

### 9.1 Approval Inbox — AddCredential card

- [ ] Platform Owner opens Approvals inbox → Pending tab
- [ ] AddCredential card visible (APR-XXXX from Part 8)
- [ ] `PayloadSummary` shows: human-readable `credentialType` label (e.g. "League Registration"), `referenceNumber`, `holderPersonId`
- [ ] Approve and Reject buttons present

### 9.2 Approve

- [ ] Click Approve
- [ ] Toast: "Approval approved"; badge: Approved; Execute button appears

### 9.3 Execute

- [ ] Click Execute
- [ ] Toast: "[Human-readable credential type] credential registered for [holderPersonId]" (e.g. "League Registration credential registered for PER-0004")
- [ ] SP verify C3Approvals: `ApprovalStatus = Executed`, `ExecutedAt` set, `ExecutionError` null
- [ ] SP verify C3Credentials:
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
- [ ] Two distinct CRED-XXXX records in C3Credentials

### 9.5 AddCredential Reject path

- [ ] Submit a second AddCredential approval; Platform Owner clicks Reject; enter reason
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

- [ ] If PersonProfile is opened without a valid PersonID, a clear empty/selection state is shown — not a "Could not load person" error

### 12.11 AddCredential — invalid payload blocked at execution (S21-P3)

- [ ] Corrupt or missing payload on an Approved AddCredential card → click Execute
- [ ] Toast: "Execution blocked — invalid payload. The approval payload is missing or malformed. No record was created."
- [ ] SP verify: `ApprovalStatus` unchanged (still `Approved`); no `C3Credentials` row created
- [ ] `ExecutedAt` null; `ExecutionError` absent

### 12.12 AddCredential — execution failure stamps ExecutionFailed (S21-P3)

- [ ] Simulate SP write failure mid-execution (e.g. digest expired, permissions revoked)
- [ ] Toast: "Execution failed" with error detail
- [ ] SP verify: `ApprovalStatus = ExecutionFailed`; `ExecutedAt` null; no orphan `C3Credentials` row (if CRED POST failed)
- [ ] If `PartialCredentialExecutionError`: CRED row exists, `ApprovalStatus` not yet stamped

### 12.13 AddCredential — partial execution recovery (S21-P1)

- [ ] Approved AddCredential card where a matching `CRED-XXXX` row already exists in SP → card shows **Recover Execution Stamp** button (not Execute)
- [ ] Click Recover → approval stamped `Executed`; no new `C3Credentials` row created
- [ ] SP verify: one `C3Credentials` row for the person/type combination; `ApprovalStatus = Executed`

### 12.14 AddCredential — recovery target missing (S21-P3)

- [ ] Approved AddCredential card where no matching `CRED-XXXX` row exists → card shows **Execute** button (not Recover)
- [ ] If Recover is triggered and target is absent → `CredentialRecoveryTargetMissingError` toast shown; no write attempted

---

## Part 13 — Beta Go/No-Go Criteria

### Go criteria (all must be true)

- [ ] Part 0 all checks pass (parity, tsc, runtime verify, SP list readiness, group provisioning)
- [ ] Part 1: `c3Role` correctly resolved from SP group for all tested accounts
- [ ] Part 2: PersonProfile loads correctly from People Workspace; three tabs visible; Add Credential visible/hidden per role
- [ ] Part 3: APR-XXXX (InitiateJourney) derived from SP item ID; no TMP-* row
- [ ] Part 4: Approve and Reject paths stamp C3Approvals correctly
- [ ] Part 5: Execute creates JRN-XXXX row; no TMP-* row; Person Profile shows Journey card
- [ ] Part 6: Approval history visible in all relevant tabs; audit fields rendered; human-readable labels; empty states correct
- [ ] Part 7: Recovery candidate detected (Approved + existing active journey); Recover Stamp works; no duplicate journey
- [ ] Part 8: APR-XXXX (AddCredential) derived from SP item ID; no TMP-* row; no premature CRED row
- [ ] Part 9: CRED-XXXX derived from SP item ID; no TMP-* row; execute toast shows human-readable label; multiple credentials per person allowed; credential visible on Person Profile
- [ ] Part 10: All four journey lifecycle transitions pass (no regression from S19)
- [ ] Part 11: Duplicate journey prevention fires correctly
- [ ] Part 12: All negative-path guards confirmed
- [ ] Part 15: PersonProfile Approvals tab shows correct active/history sections; no action buttons; human-readable labels

### No-go conditions (any blocks beta)

- [ ] `c3Role` is `'owner'` for a user not in `C3 Platform Owners` group
- [ ] `c3Role` is `'visitor'` for a user who is in a C3 group
- [ ] PersonProfile shows "Could not load person" when navigated from People Workspace
- [ ] PersonProfile does not show three tabs (Profile, Readiness, Approvals)
- [ ] Add Credential visible to visitor-role accounts
- [ ] Add Credential NOT visible to owner or operations accounts in SP DSM
- [ ] C3Approvals (AddCredential) `Title` is `TMP-*` after submission (MERGE failed)
- [ ] C3Credentials `Title` is `TMP-*` after execution (MERGE failed)
- [ ] C3Credentials row created without preceding `ApprovalStatus = Approved` record
- [ ] `ApprovalStatus = Executed` on AddCredential record without corresponding C3Credentials row
- [ ] Execute button visible for credential recovery candidate instead of Recover button
- [ ] Recovery stamp creates a second C3Credentials row (must be stamp-only)
- [ ] Recovery stamp creates a second C3Journeys row (must be stamp-only)
- [ ] Execute button visible instead of Recover button when active journey already exists (Approved + InitiateJourney)
- [ ] Approval history tabs (Executed/Rejected/Failed) show no records when SP has records
- [ ] ApprovalInbox execute toast shows raw credential type key instead of human-readable label
- [ ] PersonProfile Approvals tab shows Approve/Reject/Execute/Recover action buttons (must be display-only)
- [ ] PersonProfile Approvals tab shows raw JSON payload (must be formatted summary only)
- [ ] Self-approval not blocked
- [ ] Duplicate active journey for same person created (InitiateJourney guard)
- [ ] `ExecutedAt` set on `ExecutionFailed` record (discriminant violation)
- [ ] `InvalidTransitionError` not thrown for invalid journey transition
- [ ] Any parity harness failing
- [ ] TypeScript compile errors
- [ ] `npm run verify:runtime` fails (SHA-256 mismatch or missing file)
- [ ] Any console errors in hosted-workbench smoke test

---

## Part 14 — Known Beta Caveats (acknowledged)

| Caveat | Risk | Operator action |
|--------|------|-----------------|
| Manual runtime bundle commit required | Medium | After every source change: `npm run beta:runtime` (build + copy in one step), then `npm run verify:runtime` (SHA-256 sync check), then `git add .../c3-runtime.js && git commit` |
| `PartialCredentialExecutionError` (CRED created, stamp failed) — recovery detection may not trigger if card is already in a non-Approved state | Low | Use Part 12.13 recovery path when card is still Approved; otherwise manually set `ApprovalStatus = Executed` in C3Approvals |
| `PartialExecutionError` recovery false positive (manual SP row) | Very low | If a row was manually inserted in SP, the recovery detector may not trigger correctly |
| TMP-* orphan row if MERGE fails after POST | Very low | Delete the TMP-* row in SP; re-submit the operation |
| No dedicated audit columns for journey lifecycle transitions | Low | Notes-append is the audit trail; SuspendedAt/CancelledAt deferred to Sprint 22 |
| ~~`deactivateCredential` not implemented~~ | ~~Functional gap~~ | Resolved S23-P1 — governed via DeactivateCredential approval loop |
| Contracts/SP-02 not resolved | Functional gap | Separate workstream |
| `$top=500` truncation in person-scoped approval history | Latent — not a beta concern | Not a concern until C3Approvals exceeds 500 total records |

---

## Part 15 — PersonProfile Approvals Tab Checklist (NEW in S21)

### 15.1 Approvals tab visible

- [ ] Open any Person Profile → three tabs visible: **Profile**, **Readiness**, **Approvals**
- [ ] Approvals tab is accessible to both owner and operations roles

### 15.2 Active approvals section

- [ ] With pending approvals for the person: "Active / Needs Attention" section shows cards (Submitted / InReview / Approved / ExecutionFailed)
- [ ] Each row shows: title, operationType, status badge, human-readable payload summary (e.g. "League Registration · A12345678 · PER-0004")
- [ ] Payload summary uses label ("League Registration") not raw key ("LeagueRegistration")
- [ ] No Approve / Reject / Execute / Recover buttons anywhere in PersonProfile Approvals tab

### 15.3 History section

- [ ] Executed and Rejected approvals appear in "History" section
- [ ] Rejection reason displayed on rejected rows
- [ ] Execution error displayed on ExecutionFailed rows
- [ ] `executedAt` displayed on Executed rows

### 15.4 Empty state

- [ ] Person with no approvals → single empty state message ("No approval activity for this person yet.")
- [ ] Person with approvals but all terminal → Active section shows inner empty state; History section shows records

### 15.5 No action buttons (explicit check)

- [ ] Inspect DOM / visual check: zero Approve, Reject, Execute, Recover buttons rendered in Approvals tab
- [ ] Confirm ApprovalInbox is unchanged and remains the sole action surface

### 15.6 Safe summaries only — no raw JSON

- [ ] Payload summary renders plain-text label strings only
- [ ] No raw JSON block visible in PersonProfile Approvals tab under any condition

---

## Part 16 — Credential Deactivation Checklist (NEW in S23-P1)

### 16.1 PersonProfile — Deactivate button visible (owner/operations)

- [ ] Open any Person Profile with at least one credential → "Deactivate" button visible on each credential row
- [ ] Button visible to `owner` and `operations` roles only — hidden for `management`, `hr`, `legal`, `finance`, `visitor`
- [ ] Button renders at the right edge of each credential DataRow (action slot)

### 16.2 PersonProfile — Deactivation confirm dialog

- [ ] Clicking "Deactivate" opens a confirm dialog with the credential label and reference number
- [ ] Dialog contains a required "Reason" textarea
- [ ] "Deactivate" confirm button is disabled until a non-blank reason is entered
- [ ] "Go Back" closes the dialog without submitting

### 16.3 Mock DSM — direct deactivation

- [ ] In Mock DSM, clicking Deactivate + entering reason + confirming → success toast "Credential deactivated."
- [ ] Credential disappears from the credentials list immediately (cache invalidated)
- [ ] No approval appears in ApprovalInbox (Mock DSM bypasses approval)

### 16.4 SP DSM — approval submission

- [ ] In SP DSM, clicking Deactivate + entering reason + confirming → success toast "Deactivation submitted: APR-XXXX"
- [ ] Credential remains active in PersonProfile (deactivation deferred to execution)
- [ ] New C3Approvals record appears in ApprovalInbox with OperationType: DeactivateCredential and status Submitted
- [ ] Payload summary in ApprovalInbox shows credentialId, holderPersonId, credentialType, referenceNumber, reason

### 16.5 SP DSM — approval execution

- [ ] Owner approves the DeactivateCredential approval (Submitted → Approved)
- [ ] Execute button visible on Approved + DeactivateCredential card
- [ ] Clicking Execute → credential `IsActive = false` in C3Credentials (verify in SP list)
- [ ] Approval stamped Executed; card moves to Executed tab
- [ ] PersonProfile credentials panel no longer shows the deactivated credential

### 16.6 Recovery detection (PartialDeactivationExecutionError)

- [ ] If credential is already `IsActive = false` but approval is still Approved: ApprovalInbox shows "Recover Execution Stamp" (amber) with warning MessageBar
- [ ] Clicking "Recover Execution Stamp" stamps the approval Executed without modifying C3Credentials
- [ ] Toast: "Execution stamp recovered: APR-XXXX marked Executed. Credential CRED-XXXX confirmed inactive."

### 16.7 CredentialAlreadyInactiveError (defence against double-click)

- [ ] If Execute is clicked on a card where `IsActive` is already `false` → error toast "Execution blocked — credential already inactive"
- [ ] Approval remains Approved (not stamped ExecutionFailed)
- [ ] Recovery path (16.6) resolves the record

### 16.8 Payload summary in ApprovalInbox

- [ ] DeactivateCredential approval card shows "Deactivation Payload" section
- [ ] Displays: Credential ID, Holder Person ID, Credential Type (humanized label), Reference Number, Reason
- [ ] Malformed payload → "Invalid payload — JSON parse failed." (same guard as AddCredential)

---

## Validation commands

```bash
# Runtime bundle (after any source change)
npm run beta:runtime     # build:c3-runtime + copy:c3-runtime in one step
npm run verify:runtime   # confirm both files exist, non-empty, SHA-256 match
# Then commit the bundle:
#   git add