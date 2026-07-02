# C3 Beta Checkpoint — Sprint 25
**C3 Contract Control Center**
**Status:** BETA CHECKPOINT — Sprint 25 validated
**Baseline date:** 2026-07-02
**Supersedes:** C3 Beta Checkpoint — Sprint 24
**See also:** Sprint 25 Closeout Report.md, C3 Architecture Baseline — Sprint 25.md

> **Purpose:** This checklist is the operator's guide for confirming the complete S25 beta operational path is working correctly in a given SP environment. It supersedes the Sprint 24 checkpoint. Run all parts in order. A failure at any step is a blocker — do not proceed to the next section until resolved.
>
> **S25 scope note:** Sprint 25 delivered the governed AddPerson write path only. No Induction, no contract writes, no mission or finance work. The Contracts and Intelligence nav items remain hidden in SP DSM — see Part 0.3 and Part 7 for re-enable criteria. Before running the AddPerson path in hosted SP DSM, confirm that IT has added `AddPerson` to the `C3Approvals.OperationType` choice column (see Part 0.2).

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `git log --oneline -3` shows:
  ```
  d8763ea feat(s25): Add governed AddPerson foundation
  cc88e92 fix(s24-p1): Hide Intelligence in SP DSM pending cold-load stabilization
  46b193d fix(s24-p1): Stabilize Intelligence cold-load path
  ```
- [ ] Parity harnesses all pass:
  ```bash
  node scripts/s18-parity-approvals.mjs    # expect 37/37 (was 27/27 before S25)
  node scripts/s17-parity-journeys.mjs     # expect 51/51
  node scripts/s15-parity-test.mjs         # expect 87/87
  node scripts/s16-parity-people.mjs       # expect 220/220
  ```
- [ ] TypeScript clean:
  ```bash
  npx tsc -b packages/c3/tsconfig.json
  npx tsc -b packages/c3-spfx-host/tsconfig.json
  ```
- [ ] Runtime bundle verified:
  ```bash
  npm run verify:runtime  # expect PASS and SHA-256 match
  # SHA-256 (S25): ab6a19a66049c9d9c8a9134b6e031ec32ca5a77f05248f8e2981782fdf1c9976
  ```

### 0.2 SharePoint list readiness — S25 additions

- [ ] `C3Approvals.OperationType` choice column includes `AddPerson`
  - **This is a new IT action required for S25.** Without this value, AddPerson submission will
    fail in hosted SP DSM with a SharePoint choice validation error.
  - Add `AddPerson` alongside the existing values: `InitiateJourney`, `AddCredential`, `DeactivateCredential`

### 0.3 SharePoint list readiness — S23 baseline (unchanged in S25)

- [ ] `C3Approvals` list exists and accessible
- [ ] `C3Approvals.OperationType` choice includes `InitiateJourney`, `AddCredential`, `DeactivateCredential`
- [ ] `C3Credentials` list exists and accessible with all required columns
- [ ] `C3Journeys` list exists and accessible
- [ ] `C3People` list exists and accessible; at least one PER-XXXX person record present

### 0.4 C3Contracts list readiness (carried over from S24 — required for Contracts + Intelligence)

- [ ] `C3Contracts` list provisioned per `docs/architecture/C3Contracts SP List Schema.md`
- [ ] Required columns confirmed: `Title` (CON-XXXX), `PersonID` (PER-XXXX), `ContractStage1`, `Disposition1`, `ContractType`, `StartDate`, `EndDate`, `Team`, `GameTitle`
- [ ] At least one test contract record exists with a valid `PersonID` matching a C3People record
- [ ] **NOTE:** Until this checklist item passes, leave Contracts and Intelligence NavRail guards in place

### 0.5 SP security group provisioning

- [ ] `C3 Platform Owners` group exists; test Platform Owner account is a member
- [ ] `C3 Operations` group exists; test Operations account is a member
- [ ] At least one non-owner test account available (not in any C3 group — resolves to `visitor`)

### 0.6 Identity check

- [ ] `currentUser.loginName` visible in browser console — confirm non-empty
- [ ] `currentUser.c3Role` visible in browser console — confirm correct role

---

## Part 1 — Role Resolution

- [ ] Platform Owner account → `c3Role: 'owner'` in console
- [ ] Operations account → `c3Role: 'operations'` in console
- [ ] Non-group account → `c3Role: 'visitor'` in console

---

## Part 2 — NavRail visibility (SP DSM)

All checks below use SP DSM (`dataSrc=sharepoint`), hard refresh.

- [ ] Command Center: **visible**
- [ ] Contracts: **hidden** (pending provisioning — see 0.4)
- [ ] People: **visible**
- [ ] Renewals: **visible** (non-visitor)
- [ ] Amendments: **hidden** (stub service)
- [ ] Inbox: **visible** (non-visitor)
- [ ] Situation Room: **visible**
- [ ] Intelligence: **hidden** (TD-23 containment — see Part 8 for re-enable criteria)
- [ ] Approvals: **visible** (non-visitor)
- [ ] Settings: **visible** (owner only)
- [ ] Diagnostics: **visible**

---

## Part 3 — NavRail visibility (Mock DSM)

All checks below use Mock DSM (`dataSrc=mock`), hard refresh.

- [ ] Command Center: **visible**
- [ ] Contracts: **visible**
- [ ] People: **visible**
- [ ] Renewals: **visible**
- [ ] Amendments: **visible**
- [ ] Inbox: **visible**
- [ ] Situation Room: **visible**
- [ ] Intelligence: **visible**
- [ ] Approvals: **visible**
- [ ] Settings: **visible** (owner)
- [ ] Diagnostics: **visible**

---

## Part 4 — People and PersonProfile (SP DSM)

- [ ] People screen loads; person list renders with data from C3People
- [ ] PersonProfile opens for a selected person
- [ ] PersonProfile — Credentials tab: active credentials visible
- [ ] PersonProfile — Approvals tab: approval history visible
- [ ] PersonProfile — Deactivate button visible (owner/operations role only)
- [ ] **Add Person button visible** in People screen header (owner/operations role only)
- [ ] **Add Person button NOT visible** when signed in as visitor

---

## Part 5 — AddPerson path (SP DSM) — NEW in S25

**Prerequisite:** Part 0.2 must pass — `C3Approvals.OperationType` must include `AddPerson`.

### 5.1 Submission path

- [ ] Click "Add Person" in People screen header → `AddPersonPanel` opens (position: end, size: medium)
- [ ] Governance `MessageBar` (info intent) is visible: "This person will not appear in C3 until an owner approves and executes the request."
- [ ] Submit button label is "Submit for Approval"
- [ ] Full Name field is required — "Submit for Approval" button is disabled when Full Name is blank
- [ ] Fill in Full Name (e.g. "Ahmed Al-Rashid") and at least one optional field (e.g. IGN: "Phantom")
- [ ] Click "Submit for Approval" → button shows "Submitting..." while pending
- [ ] On success: toast "Person creation submitted" with APR-XXXX approval title
- [ ] Panel closes and form resets on success
- [ ] No new row in C3People yet — person is NOT visible in the People list

### 5.2 Approval review

- [ ] Navigate to Approvals (or Inbox) — new AddPerson approval is visible in the Submitted tab
- [ ] Approval card shows `OperationType: AddPerson`
- [ ] PayloadSummary shows person details: Full Name, IGN (if entered), and other fields that were filled in
- [ ] Approve the approval → status transitions to Approved

### 5.3 Execution path

- [ ] Execute the Approved AddPerson approval
- [ ] On success: toast "Approval executed — [Full Name] (PER-XXXX) added to C3People"
- [ ] Approval status transitions to Executed
- [ ] Navigate to People screen — new person with canonical PER-XXXX code is visible in the list
- [ ] PersonID (Title column in C3People) is in PER-XXXX format (e.g. PER-0042)

### 5.4 Partial execution recovery

- [ ] If Step 1 of execution (C3People POST) succeeds but Step 2 (approval stamp) fails:
  - Toast shows `PartialAddPersonExecutionError` message
  - Approval remains at Approved status
  - Operator must manually set approval to Executed in C3Approvals list
- [ ] If execution fails entirely (no C3People row created): toast shows generic error; approval remains Approved; no orphan row

---

## Part 6 — AddPerson path (Mock DSM) — regression

- [ ] Click "Add Person" in People screen → `AddPersonPanel` opens
- [ ] No governance MessageBar — SP-mode callout is absent in Mock DSM
- [ ] Submit button label is "Add Person" (not "Submit for Approval")
- [ ] Fill Full Name and submit → toast "Person added: [Full Name] (PER-XXXX)"
- [ ] Panel closes; new person immediately visible in People list (no approval required)

---

## Part 7 — Credential lifecycle paths (SP DSM)

All paths unchanged from Sprint 23/24 baseline.

### 7.1 AddCredential path

- [ ] AddCredentialPanel opens from PersonProfile
- [ ] Submission creates `C3Approvals` record (OperationType: AddCredential, Submitted)
- [ ] ApprovalInbox — Submitted tab shows the new record
- [ ] Approve → Execute path: CRED-XXXX created in C3Credentials; approval Executed
- [ ] PersonProfile — new credential appears in Credentials tab

### 7.2 DeactivateCredential path

- [ ] Deactivate button visible on credential row (owner/operations role)
- [ ] Submission creates `C3Approvals` record (OperationType: DeactivateCredential, Submitted)
- [ ] Approve → Execute: C3Credentials row MERGE IsActive = false; approval Executed

### 7.3 Recovery paths

- [ ] PartialCredentialExecutionError recovery: amber MessageBar + Recover button in ApprovalInbox
- [ ] PartialDeactivationExecutionError recovery: amber MessageBar + Recover button in ApprovalInbox

---

## Part 8 — Journey lifecycle paths (SP DSM)

All paths unchanged from Sprint 19/24 baseline.

- [ ] StartJourneyPanel opens from PersonProfile
- [ ] Submission creates `C3Approvals` record (OperationType: InitiateJourney, Submitted)
- [ ] Approve → Execute: JRN-XXXX created in C3Journeys; approval Executed
- [ ] Journey card visible on PersonProfile
- [ ] Suspend / Cancel / Reactivate lifecycle transitions work as expected

---

## Part 9 — Contracts and Intelligence (SP DSM re-enable criteria)

These two screens are hidden in SP DSM at S25 closeout (unchanged from S24). Remove the NavRail guards **only after** all criteria in this section pass.

### 9.1 Contracts re-enable

- [ ] C3Contracts list provisioned per Part 0.4
- [ ] Hard refresh SP DSM → click Contracts nav item → list loads with real contract data
- [ ] PersonProfile contract card shows contracts linked by PersonID
- [ ] No ErrorBoundary on Contracts screen
- [ ] After passing: remove `visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint'` from the `contracts` nav item in `NavRail.tsx`

### 9.2 Intelligence re-enable

- [ ] C3Contracts provisioned per Part 0.4 (Intelligence metrics need real contract data)
- [ ] Hard refresh SP DSM → **first** navigation to Intelligence → no ErrorBoundary
- [ ] Repeat 3× from hard refresh to confirm stability
- [ ] KPI strip renders with real data (not all zeros)
- [ ] After passing: remove `visibleWhen` from the `intelligence` nav item in `NavRail.tsx`; close TD-23

---

## Part 10 — Mock DSM regression (all screens)

Hard refresh Mock DSM. Verify every screen in the nav renders without errors.

- [ ] Command Center: renders
- [ ] Contracts: renders with mock contract list
- [ ] People: renders with mock person list; Add Person button visible (owner/ops)
- [ ] Renewals: renders
- [ ] Amendments: renders
- [ ] Inbox: renders
- [ ] Situation Room: renders
- [ ] Intelligence: renders with mock KPIs and insights (no ErrorBoundary)
- [ ] Approvals: renders
- [ ] Settings: renders (owner)
- [ ] Diagnostics: renders

---

## Part 11 — ErrorBoundary reset validation

- [ ] In SP DSM: if any screen triggers an ErrorBoundary, navigating to a different screen resets the boundary
- [ ] Confirm `key={screen.id}` behaviour on `AppShell.tsx` is working

---

## Notes

- The AddPerson approval in SP DSM leaves `TargetPersonID` empty on the C3Approvals record. This is by design — the person does not exist at submission time. After execution, `TargetPersonID` is not backfilled.
- If IT has not yet added `AddPerson` to `C3Approvals.OperationType`, the submission POST will fail. The `AddPersonPanel` will display the error in its MessageBar.
- Email is not a field in `AddPersonPanel` (TD-24). If an email address is needed for a person, it must be stored outside of C3 until TD-24 is resolved.
- Contracts and Intelligence remain hidden in SP DSM (TD-22, TD-23). No change from S24.
- Parity harness `s18-parity-approvals.mjs` now covers AddPerson approval mapping (37 assertions, was 27 in S24).
