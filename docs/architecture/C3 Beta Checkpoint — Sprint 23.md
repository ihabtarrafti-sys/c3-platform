# C3 Beta Checkpoint — Sprint 23
**C3 Contract Control Center**
**Status:** BETA CHECKPOINT — Sprint 23 validated
**Baseline date:** 2026-07-01
**Supersedes:** C3 Beta Checkpoint — Sprint 21
**See also:** Sprint 23 Closeout Report.md, C3 Architecture Baseline — Sprint 23.md, ADR-013, ADR-013 Addendum — Journey Lifecycle Transitions.md

> **Purpose:** This checklist is the operator's guide for confirming the complete S23 beta operational path is working correctly in a given SP environment. It supersedes the Sprint 21 checkpoint. Run all parts in order. A failure at any step is a blocker — do not proceed to the next section until resolved.

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `git log --oneline -5` shows:
  ```
  294fd8f feat(s23-phase-1): Implement governed credential deactivation
  3f88957 docs(s22): Add beta operational runbook and error library
  4d9f3f2 docs(backlog): Record C3 product expansion backlog
  998aa6f docs(s21): Close Sprint 21 and update beta baseline
  22c9a5e chore(s21-phase-4): Add beta runtime verification scripts
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
  npm run verify:runtime  # expect PASS and SHA-256 match
  # SHA-256 (S23): f8d7bcb6c0e61b26f480163e46e605a5fcdefa57be642abe9bfe00e4f0d68a27
  ```

### 0.2 SharePoint list readiness

- [ ] `C3Approvals` list exists and accessible
- [ ] `C3Approvals.OperationType` choice column includes `AddCredential`, `InitiateJourney`, and `DeactivateCredential`
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

## Part 7 — Journey Lifecycle Checklist

Goal: Valid transitions succeed; invalid transitions are blocked.

### 7.1 Complete journey

- [ ] Person with an Active journey → PersonProfile → Complete → Confirm
- [ ] Toast: "Journey completed"; badge: Completed
- [ ] SP verify C3Journeys: `Status = Completed`, `CompletedAt` set (if column provisioned) or Notes appended
- [ ] Start Journey button re-appears (since journey is no longer Active)

### 7.2 Suspend and resume

- [ ] Active journey → Suspend → enter reason → Confirm
- [ ] Toast: "Journey suspended"; badge: Suspended; Resume button visible
- [ ] Resume → Confirm → back to Active
- [ ] SP verify: Status toggled correctly in both transitions; Notes appended each time

### 7.3 Cancel journey

- [ ] Active or Suspended journey → Cancel → enter reason → Confirm
- [ ] Toast: "Journey cancelled"; badge: Cancelled
- [ ] Start Journey button re-appears

### 7.4 Invalid transition guard

- [ ] Attempt to Suspend a Completed or Cancelled journey: `InvalidTransitionError` toast shown; SP unchanged
- [ ] Attempt to Complete an already-Completed journey: same guard

---

## Part 8 — AddCredential Submission Checklist

### 8.1 SP DSM — approval path

- [ ] PersonProfile → Add Credential → fill form → Submit for Approval
- [ ] Toast: submission confirmation
- [ ] SP verify C3Approvals: `Title = APR-XXXX`; `OperationType = AddCredential`; `ApprovalStatus = Submitted`

### 8.2 Payload summary

- [ ] ApprovalInbox card → "Credential Payload" section shows humanized credentialType label (e.g. "League Registration" not "LeagueRegistration")
- [ ] PersonProfile Approvals tab shows same humanized label in history row

### 8.3 Execution

- [ ] Approve → Execute → toast: "League Registration credential registered for PER-XXXX"
- [ ] SP verify C3Credentials: `Title = CRED-XXXX`; `IsActive = true`; `PersonID = PER-XXXX`
- [ ] PersonProfile credentials list shows the new credential

### 8.4 Date order advisory

- [ ] In AddCredential panel: set ExpiryDate earlier than IssueDate
- [ ] Advisory MessageBar shown between Issue Date and Issued By fields ("Expiry date is before issue date")
- [ ] Submit is NOT blocked — advisory only

### 8.5 Negative paths

- [ ] Reject: SP verify C3Credentials row NOT created; C3Approvals `RejectionReason` set
- [ ] ExecutionFailed card: `ExecutionError` displayed in inbox
- [ ] Recovery candidate detection: Approved + AddCredential card where matching CRED row exists → "Recover Execution Stamp" replaces Execute
- [ ] Recovery: stamp Executed; no second CRED row created

---

## Part 9 — PersonProfile Approvals Tab Checklist

### 9.1 Tab visible

- [ ] Open any Person Profile → three tabs visible: **Profile**, **Readiness**, **Approvals**
- [ ] Approvals tab accessible to both owner and operations roles

### 9.2 Active approvals section

- [ ] With pending approvals for the person: "Active / Needs Attention" section shows cards (Submitted / InReview / Approved / ExecutionFailed)
- [ ] Each row: title, operationType badge, status badge, human-readable payload summary
- [ ] No Approve / Reject / Execute / Recover buttons anywhere in PersonProfile Approvals tab

### 9.3 History section

- [ ] Executed and Rejected approvals appear in "History" section
- [ ] Rejection reason shown on rejected rows; executedAt shown on Executed rows

### 9.4 Empty states and display-only contract

- [ ] Person with no approvals → empty state message shown
- [ ] Inspect DOM: zero Approve/Reject/Execute/Recover buttons in Approvals tab

---

## Part 10 — Credential Deactivation Checklist (NEW in S23)

### 10.1 PersonProfile — Deactivate button visibility

- [ ] Open any Person Profile with at least one credential
- [ ] "Deactivate" button visible on each credential row (owner and operations roles)
- [ ] "Deactivate" button absent for visitor, management, hr, legal, finance roles

### 10.2 Deactivation confirm dialog

- [ ] Clicking "Deactivate" opens a confirm dialog with the credential label and reference number
- [ ] Dialog contains a required "Reason" textarea
- [ ] "Deactivate" confirm button is disabled until a non-blank reason is entered
- [ ] "Go Back" closes the dialog without any write

### 10.3 Mock DSM — direct deactivation

- [ ] In Mock DSM: Deactivate + reason + Confirm → success toast "Credential deactivated."
- [ ] Credential disappears from PersonProfile credentials list immediately
- [ ] No approval appears in ApprovalInbox

### 10.4 SP DSM — approval submission

- [ ] In SP DSM: Deactivate + reason + Confirm → toast "Deactivation submitted: APR-XXXX"
- [ ] Credential remains active in PersonProfile (deactivation deferred to execution)
- [ ] ApprovalInbox shows a new card: OperationType = DeactivateCredential, status = Submitted
- [ ] Payload summary in ApprovalInbox shows credentialId, holderPersonId, humanized credentialType, referenceNumber, reason

### 10.5 SP DSM — approval execution

- [ ] Owner approves the DeactivateCredential approval (Submitted → Approved)
- [ ] Execute button visible on Approved + DeactivateCredential card
- [ ] Execute → toast "Credential CRED-XXXX deactivated."
- [ ] SP verify C3Credentials: `IsActive = false` on the credential row
- [ ] C3Approvals: `ApprovalStatus = Executed`, `ExecutedAt` set
- [ ] PersonProfile: deactivated credential no longer visible in credentials list

### 10.6 CredentialAlreadyInactiveError (defence against double-click)

- [ ] If Execute is clicked on a card where `IsActive` is already `false` → error toast "Execution blocked — credential already inactive."
- [ ] Approval remains Approved (NOT stamped ExecutionFailed)
- [ ] ApprovalInbox shows recovery path (see 10.7)

### 10.7 PartialDeactivationExecutionError recovery

- [ ] With an Approved + DeactivateCredential card where `IsActive = false` but approval is still Approved:
  - [ ] Amber MessageBar visible in ApprovalInbox card: "Execution partially completed — credential is inactive but the approval was not stamped Executed."
  - [ ] "Recover Execution Stamp" button visible (replaces normal Execute)
- [ ] Clicking "Recover Execution Stamp" → stamps the approval Executed; no further write to C3Credentials
- [ ] Toast: "Execution stamp recovered: APR-XXXX marked Executed. Credential CRED-XXXX confirmed inactive."
- [ ] Approval moves to Executed tab

### 10.8 Payload summary — DeactivateCredential card

- [ ] DeactivateCredential card in ApprovalInbox renders "Deactivation Payload" section
- [ ] Displays: Credential ID, Holder Person ID, humanized Credential Type (e.g. "League Registration"), Reference Number, Reason
- [ ] Malformed payload → "Invalid payload — JSON parse failed."

---

## Part 11 — Error Recovery Checklist (all paths)

| Path | Test | Expected |
|------|------|----------|
| Journey stamp failure (`PartialExecutionError`) | Approved + InitiateJourney + active JRN exists | "Recover Execution Stamp" replaces Execute |
| Journey recovery stamp | Click Recover | Stamp Executed; no new JRN row |
| Credential add stamp failure (`PartialCredentialExecutionError`) | Approved + AddCredential + CRED row exists | "Recover Execution Stamp" replaces Execute |
| Credential add recovery | Click Recover | Stamp Executed; no new CRED row |
| Credential deactivation stamp failure (`PartialDeactivationExecutionError`) | Approved + DeactivateCredential + `IsActive = false` | Amber recovery MessageBar + Recover button |
| Credential deactivation recovery | Click Recover | Stamp Executed; no re-MERGE on C3Credentials |
| CredentialAlreadyInactiveError | Execute on DeactivateCredential where `IsActive = false` | Error toast; approval stays Approved |

---

## Part 12 — Negative Paths / "Must Never Happen" List

- [ ] `c3Role` is `'owner'` for a user not in `C3 Platform Owners` group
- [ ] `c3Role` is `'visitor'` for a user who is in a C3 group
- [ ] PersonProfile shows "Could not load person" when navigated from People Workspace
- [ ] PersonProfile does not show three tabs (Profile, Readiness, Approvals)
- [ ] Deactivate button visible to visitor, management, hr, legal, or finance roles
- [ ] Deactivate button absent for owner or operations roles (when credentials exist)
- [ ] Deactivation confirm dialog submits without a non-blank reason
- [ ] C3Approvals (AddCredential or DeactivateCredential) `Title` is `TMP-*` after submission
- [ ] C3Credentials `Title` is `TMP-*` after execution (AddCredential only)
- [ ] C3Credentials row created without preceding `ApprovalStatus = Approved` record
- [ ] `IsActive = false` on C3Credentials set without preceding `ApprovalStatus = Approved` record (SP DSM)
- [ ] `ApprovalStatus = Executed` on AddCredential record without corresponding C3Credentials row
- [ ] `ApprovalStatus = Executed` on DeactivateCredential record without `IsActive = false` on C3Credentials
- [ ] Execute button visible for credential recovery candidate instead of Recover button
- [ ] Recovery stamp creates a second C3Credentials row (must be stamp-only)
- [ ] Recovery stamp creates a second C3Journeys row (must be stamp-only)
- [ ] Execute button visible instead of Recover button when active journey already exists (Approved + InitiateJourney)
- [ ] deactivateCredential MERGE fires without a preceding C3Approvals Approved record (SP DSM)
- [ ] Approval history tabs show no records when SP has records
- [ ] ApprovalInbox execute toast shows raw credential type key
- [ ] PersonProfile Approvals tab shows action buttons (must be display-only)
- [ ] PersonProfile Approvals tab shows raw JSON payload
- [ ] Self-approval not blocked
- [ ] Duplicate active journey for same person created
- [ ] `ExecutedAt` set on `ExecutionFailed` record
- [ ] `InvalidTransitionError` not thrown for invalid journey transition
- [ ] Any parity harness failing
- [ ] TypeScript compile errors
- [ ] `npm run verify:runtime` fails (SHA-256 mismatch or missing file)
- [ ] Any console errors in hosted-workbench smoke test

---

## Part 13 — Known Beta Caveats (acknowledged)

| Caveat | Risk | Operator action |
|--------|------|-----------------|
| Manual runtime bundle commit required | Medium | After every source change: `npm run beta:runtime`, then `npm run verify:runtime`, then `git add .../c3-runtime.js && git commit` |
| No credential reactivation | Functional gap | Manually set `IsActive = true` in C3Credentials SP list if needed |
| No inactive credential archive/history view | Functional gap | Deactivated credentials are not visible in-app; check SP list directly |
| `PartialExecutionError` recovery false positive (manual SP row) | Very low | If a row was manually inserted in SP, the recovery detector may not trigger correctly |
| TMP-* orphan row if MERGE fails after POST | Very low | Delete the TMP-* row in SP; re-submit the operation |
| No dedicated audit columns for journey lifecycle transitions | Low | Notes-append is the audit trail; SuspendedAt/CancelledAt deferred |
| `$top=500` truncation in person-scoped approval history | Latent — not a beta concern | Not a concern until C3Approvals exceeds 500 total records |
| Contracts/SP-02 not resolved | Functional gap | Separate workstream |

---

## Validation commands

```bash
# Parity harnesses
node scripts/s18-parity-approvals.mjs    # 27/27
node scripts/s17-parity-journeys.mjs     # 51/51
node scripts/s15-parity-test.mjs         # 87/87
node scripts/s16-parity-people.mjs       # 220/220

# TypeScript
npx tsc --noEmit -p packages/c3/tsconfig.json
npx tsc --noEmit -p packages/c3-spfx-host/tsconfig.json

# Runtime bundle verification (no rebuild needed unless source changed)
npm run verify:runtime
# Expected SHA-256 (S23): f8d7bcb6c0e61b26f480163e46e605a5fcdefa57be642abe9bfe00e4f0d68a27

# After any source change:
npm run beta:runtime     # build:c3-runtime + copy:c3-runtime
npm run verify:runtime   # confirm SHA-256 match
git add packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js
git commit -m "build(sXX-phaseY): Update SPFx runtime bundle after ..."
```
