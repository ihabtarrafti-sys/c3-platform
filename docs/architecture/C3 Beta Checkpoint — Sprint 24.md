# C3 Beta Checkpoint — Sprint 24
**C3 Contract Control Center**
**Status:** BETA CHECKPOINT — Sprint 24 validated
**Baseline date:** 2026-07-02
**Supersedes:** C3 Beta Checkpoint — Sprint 23
**See also:** Sprint 24 Closeout Report.md, C3 Architecture Baseline — Sprint 24.md, C3Contracts SP List Schema.md

> **Purpose:** This checklist is the operator's guide for confirming the complete S24 beta operational path is working correctly in a given SP environment. It supersedes the Sprint 23 checkpoint. Run all parts in order. A failure at any step is a blocker — do not proceed to the next section until resolved.
>
> **S24 scope note:** Sprint 24 delivered a contract read foundation only. No contract writes, no contract approval workflow. The Contracts and Intelligence nav items are hidden in SP DSM at closeout — see Part 0.3 and Part 7 for re-enable criteria.

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `git log --oneline -6` shows:
  ```
  cc88e92 fix(s24-p1): Hide Intelligence in SP DSM pending cold-load stabilization
  46b193d fix(s24-p1): Stabilize Intelligence cold-load path
  28b9d77 fix(s24-p1): Stabilize Intelligence screen in SP DSM
  c866410 fix(s24-p1): Stabilize contract read path validation
  2fee558 feat(s24-p1): Add native C3Contracts read path with PersonID linkage
  e5a6304 docs(s24-p0): Define C3Contracts SP list schema
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
  # SHA-256 (S24): 21946b167d50ac047679221a19728da05d5aa39c1e0b87f0517f51a2065e9738
  ```

### 0.2 SharePoint list readiness (S23 baseline — unchanged in S24)

- [ ] `C3Approvals` list exists and accessible
- [ ] `C3Approvals.OperationType` choice includes `InitiateJourney`, `AddCredential`, `DeactivateCredential`
- [ ] `C3Credentials` list exists and accessible with all required columns
- [ ] `C3Journeys` list exists and accessible
- [ ] `C3People` list exists and accessible; at least one PER-XXXX person record present

### 0.3 C3Contracts list readiness (NEW in S24 — required for Contracts screen and Intelligence in SP DSM)

- [ ] `C3Contracts` list provisioned per `docs/architecture/C3Contracts SP List Schema.md`
- [ ] Required columns confirmed: `Title` (CON-XXXX), `PersonID` (PER-XXXX), `ContractStage1`, `Disposition1`, `ContractType`, `StartDate`, `EndDate`, `Team`, `GameTitle`
- [ ] Optional columns confirmed (if in use): `Value`, `Currency`, `Notes`, `AutoRenew`, `RenewalWindowDays`, `IsRenewalNotified`
- [ ] At least one test contract record exists with a valid `PersonID` matching a C3People record
- [ ] **NOTE:** Until this checklist item passes, leave Contracts and Intelligence NavRail guards in place (S24-P1 `visibleWhen: mode !== 'sharepoint'`)

### 0.4 SP security group provisioning

- [ ] `C3 Platform Owners` group exists; test Platform Owner account is a member
- [ ] `C3 Operations` group exists; test Operations account is a member
- [ ] At least one non-owner test account available (not in any C3 group — resolves to `visitor`)

### 0.5 Identity check

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
- [ ] Contracts: **hidden** (pending provisioning — see 0.3)
- [ ] People: **visible**
- [ ] Renewals: **visible** (non-visitor)
- [ ] Amendments: **hidden** (stub service)
- [ ] Inbox: **visible** (non-visitor)
- [ ] Situation Room: **visible**
- [ ] Intelligence: **hidden** (TD-23 containment — see Part 7 for re-enable criteria)
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
- [ ] PersonProfile — contract card visible (requires C3Contracts provisioned per 0.3)

---

## Part 5 — Credential lifecycle paths (SP DSM)

All paths unchanged from Sprint 23 baseline.

### 5.1 AddCredential path

- [ ] AddCredentialPanel opens from PersonProfile
- [ ] Submission creates `C3Approvals` record (OperationType: AddCredential, Submitted)
- [ ] ApprovalInbox — Submitted tab shows the new record
- [ ] Approve → Execute path: CRED-XXXX created in C3Credentials; approval Executed
- [ ] PersonProfile — new credential appears in Credentials tab

### 5.2 DeactivateCredential path

- [ ] Deactivate button visible on credential row (owner/operations role)
- [ ] Confirm dialog shows credential label + reference number; requires reason
- [ ] Submission creates `C3Approvals` record (OperationType: DeactivateCredential, Submitted)
- [ ] Approve → Execute: C3Credentials row MERGE IsActive = false; approval Executed
- [ ] PersonProfile — deactivated credential removed from Credentials tab

### 5.3 Recovery paths

- [ ] PartialCredentialExecutionError recovery: amber MessageBar + Recover button in ApprovalInbox
- [ ] PartialDeactivationExecutionError recovery: amber MessageBar + Recover button in ApprovalInbox
- [ ] Recovery stamp writes Executed without re-applying primary write

---

## Part 6 — Journey lifecycle paths (SP DSM)

All paths unchanged from Sprint 19/23 baseline.

- [ ] StartJourneyPanel opens from PersonProfile
- [ ] Submission creates `C3Approvals` record (OperationType: InitiateJourney, Submitted)
- [ ] Approve → Execute: JRN-XXXX created in C3Journeys; approval Executed
- [ ] Journey card visible on PersonProfile
- [ ] Suspend / Cancel / Reactivate lifecycle transitions work as expected

---

## Part 7 — Contracts and Intelligence (SP DSM re-enable criteria)

These two screens are hidden in SP DSM at S24 closeout. Remove the NavRail guards **only after** all criteria in this section pass.

### 7.1 Contracts re-enable (remove Contracts guard from NavRail)

- [ ] C3Contracts list provisioned per 0.3
- [ ] Hard refresh SP DSM → click Contracts nav item → list loads with real contract data
- [ ] PersonProfile contract card shows contracts linked by PersonID
- [ ] No ErrorBoundary on Contracts screen
- [ ] After passing: remove `visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint'` from the `contracts` nav item in `NavRail.tsx`

### 7.2 Intelligence re-enable (remove Intelligence guard from NavRail)

- [ ] C3Contracts provisioned per 0.3 (Intelligence metrics need real contract data)
- [ ] Hard refresh SP DSM → **first** navigation to Intelligence → no ErrorBoundary
- [ ] Repeat 3× from hard refresh to confirm stability
- [ ] KPI strip renders with real data (not all zeros)
- [ ] No crash in browser console
- [ ] After passing: remove `visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint'` from the `intelligence` nav item in `NavRail.tsx`; close TD-23

---

## Part 8 — Mock DSM regression (all screens)

Hard refresh Mock DSM. Verify every screen in the nav renders without errors.

- [ ] Command Center: renders
- [ ] Contracts: renders with mock contract list
- [ ] People: renders with mock person list
- [ ] Renewals: renders
- [ ] Amendments: renders
- [ ] Inbox: renders
- [ ] Situation Room: renders
- [ ] Intelligence: renders with mock KPIs and insights (no ErrorBoundary)
- [ ] Approvals: renders
- [ ] Settings: renders (owner)
- [ ] Diagnostics: renders

---

## Part 9 — ErrorBoundary reset validation

- [ ] In SP DSM: navigate to a screen that would trigger an error (if any) → ErrorBoundary shows
- [ ] Navigate to a different screen → ErrorBoundary resets; new screen renders cleanly
- [ ] Confirm the `key={screen.id}` behaviour on `AppShell.tsx` is working

---

## Notes

- Intelligence is hidden in SP DSM (TD-23). The `isPending` fix (`46b193d`) addresses the leading hypothesis (React Query v5 first-render flash unmounting Fluent UI style-cache Maps). This fix was not confirmed in hosted SP DSM before the containment decision. Re-run Part 7.2 after C3Contracts is provisioned to determine if the fix resolved the crash.
- No contract writes are in scope for S24. If an operator needs to add or edit a contract, they must enter the record directly in the C3Contracts SP list.
- Parity harnesses (s15–s18) cover people, credentials, approvals, and journeys. There is no S24 contract parity harness — the contract read path is covered by hosted validation only.
