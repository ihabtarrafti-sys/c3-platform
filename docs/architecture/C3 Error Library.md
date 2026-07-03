# C3 Error Library
**C3 Contract Control Center**
**Status:** BETA — Sprint 23
**Last updated:** 2026-07-01
**See also:** C3 Beta Operational Runbook.md, C3 Beta Checkpoint — Sprint 21.md, C3 Tech Debt Register.md

> **Purpose:** Single-source catalog of all known C3 errors, failure modes, and operational issues. Each entry carries a stable ERR-XXX ID for cross-referencing from the runbook, sprint docs, and operator notes. Entries are grouped by category: Active Runtime Errors, SP Environment Issues, Deployment and Tooling Issues, and Latent / Future Risks.

---

## Quick Reference

| ID | Name | Category | Toast / Signal |
|----|------|----------|---------------|
| ERR-001 | DuplicateJourneyError | Active Runtime | "Execution blocked — duplicate journey…" |
| ERR-002 | SelfApprovalError | Active Runtime | "Self-approval not permitted…" |
| ERR-003 | PayloadValidationError | Active Runtime | "Execution blocked — invalid payload…" |
| ERR-004 | ApprovalStatusGuardError | Active Runtime | Console only (not normally user-facing) |
| ERR-005 | PartialExecutionError | Active Runtime | "Partial execution — manual resolution required" |
| ERR-006 | PartialCredentialExecutionError | Active Runtime | "Partial execution — credential created…" |
| ERR-007 | InvalidTransitionError | Active Runtime | Toast: transition blocked message |
| ERR-008 | Stamp-only safety re-check failure | Active Runtime | Toast: recovery blocked |
| ERR-009 | getApproval not implemented | Latent | Console throw if called |
| ERR-010 | Runtime bundle SHA mismatch | Deployment / Tooling | `verify:runtime` FAIL |
| ERR-011 | TMP-* orphan row | Deployment / Tooling | Silent (visible in SP only) |
| ERR-012 | NUL byte in source file | Deployment / Tooling | tsc / parity failure |
| ERR-013 | Git index corruption | Deployment / Tooling | `git add` fatal error |
| ERR-014 | C3Approvals list inaccessible | SP Environment | Error state / empty queue |
| ERR-015 | loginName empty / role resolution failure | SP Environment | `c3Role: 'visitor'` unexpectedly |
| ERR-016 | OperationType missing AddCredential | SP Environment | SP 400 on credential submission |
| ERR-017 | `$top=500` approval history truncation | Latent | Silent data gap in PersonProfile |
| ERR-018 | C3Credentials missing required column | SP Environment | SP 400 on credential execution |
| ERR-019 | ToasterGuard / Toaster context unavailable | Active Runtime | No toasts appear |
| ERR-020 | CredentialAlreadyInactiveError | Active Runtime | "Execution blocked — credential already inactive…" |
| ERR-021 | PartialDeactivationExecutionError | Active Runtime | "Partial execution — credential deactivated…" |
| ERR-022 | Intelligence SP DSM cold-load crash | Active Runtime | ErrorBoundary on first entry (contained — TD-23) |
| ERR-023 | RowNotFoundError | Active Runtime (S29A) | "No active row found… refresh and verify" |
| ERR-024 | DataIntegrityError | Active Runtime (S29A) | "N active rows match… expected exactly one. No write performed." |
| ERR-025 | ConcurrencyError | Active Runtime (S29A) | "Another operator changed… refresh and retry" |
| ERR-026 | DuplicateKitAssignmentError | Active Runtime (S29A) | "A kit assignment already exists…" |
| ERR-027 | WritePermissionError | Active Runtime (S29A) | "SharePoint denied the write… contact the platform owner" |
| ERR-028 | ParticipantNotActiveError | Active Runtime (S29A) | "…not an active participant of…" |
| ERR-029 | InvalidKitTransitionError | Active Runtime (S29A) | "Cannot move … from 'X' to 'Y'. Valid transitions…" |
| ERR-030 | ParticipantConflictError | Active Runtime (S29B) | "…exists with DIFFERENT fields… No write performed." |
| ERR-031 | DuplicateParticipantError | Active Runtime (S29B) | "…already an active participant of…" |
| ERR-032 | ActiveKitDependencyError | Active Runtime (S29B) | "Cannot remove… active kit assignments exist. Deactivate first." |
| ERR-033 | DuplicatePendingRequestError | Active Runtime (S29B) | "…request… already pending (APR-XXXX)…" |
| ERR-034 | PartialParticipantAddExecutionError | Active Runtime (S29B) | "Partial — re-execute to repair" (idempotent) |
| ERR-035 | PartialParticipantRemovalExecutionError | Active Runtime (S29B) | "Partial — re-execute to repair" (idempotent) |

---

## Category A — Active Runtime Errors

These errors are observable in the current beta runtime. Each has a defined recovery path.

---

### ERR-023 … ERR-029 — S29A logistics write errors

Thrown by `SharePointMissionService` / `SharePointApparelProfileService` (and their mocks via
the shared pure guards in `utils/kitLifecycle.ts`); defined in `services/errors.ts`; always
surfaced via toast — no silent mutation failures.

- **ERR-023 RowNotFoundError** — compound-key resolution matched zero active rows. Recovery:
  refresh; the record may have been deactivated/removed by another operator.
- **ERR-024 DataIntegrityError** — multiple active rows matched a must-be-unique key.
  **No write occurs.** Recovery: owner cleans up duplicates in SharePoint (Title uniqueness
  prevents new occurrences).
- **ERR-025 ConcurrencyError** — MERGE returned HTTP 412 (actual-ETag mismatch): another
  operator changed the row between read and write. Recovery: refresh, re-check, retry.
  Newer data is never overwritten.
- **ERR-026 DuplicateKitAssignmentError** — active row already exists for
  `MissionID+PersonID+ItemCategory+AssignmentKey` (pre-check, or Title unique-constraint
  translation on a concurrent create). Recovery: different AssignmentKey or update existing.
- **ERR-027 WritePermissionError** — SharePoint ACL denied the write (HTTP 403). Recovery:
  verify group membership against `C3 Logistics List Permissions — Sprint 29A.md`.
- **ERR-028 ParticipantNotActiveError** — kit targets a non-participant. Recovery: add the
  participant first (governed, S29B).
- **ERR-029 InvalidKitTransitionError** — transition outside the approved matrix. The UI
  offers valid targets only; seeing this implies a stale view — refresh.

---

### ERR-030 … ERR-035 — S29B governed participant membership errors

Defined in `services/errors.ts` and `hooks/useExecuteApproval.ts`; surfaced via toast.

- **ERR-030 ParticipantConflictError** — an active row exists with different fields than
  the approved payload. Execution stamps ExecutionFailed. Recovery: reconcile the existing
  row or submit a matching request.
- **ERR-031 DuplicateParticipantError** — the person is already an active participant
  (submission-time guard).
- **ERR-032 ActiveKitDependencyError** — removal blocked (submission AND execution) while
  active kit assignments exist. Recovery: deactivate the kit items (S29A action) first.
- **ERR-033 DuplicatePendingRequestError** — one in-flight request per
  operationType+MissionID+PersonID across Submitted/InReview/Approved. Recovery: wait for
  the referenced APR to be executed or rejected.
- **ERR-034/035 PartialParticipant(Add|Removal)ExecutionError** — the participant write
  applied but the approval stamp failed. **Recovery: execute the approval again** — the
  idempotent already-applied/already-inactive detection repairs only the stamp; no
  duplicate rows are possible.

---

### ERR-001 — DuplicateJourneyError

**Type:** Active Runtime
**Symptom:** Toast: "Execution blocked — duplicate journey. An active Onboarding journey already exists for this person. Approval has been marked ExecutionFailed."
**Cause:** `useExecuteApproval` (InitiateJourney branch) queries `C3Journeys` before writing. If a row with `Status = Active` already exists for `TargetPersonID`, execution is blocked. `C3Journeys` row is NOT created. `C3Approvals` is stamped `ExecutionFailed`.
**Detection:**
- Toast text as above
- SP confirm: `C3Approvals.ApprovalStatus = ExecutionFailed`; `ExecutionError` contains duplicate message
- SP confirm: `C3Approvals.ExecutedAt` is null (ExecutionFailed must not set a timestamp — discriminant check)
- SP confirm: no new `C3Journeys` row for the person

**User Impact:** The InitiateJourney operation is blocked. The ExecutionFailed approval record is terminal — it cannot be re-executed. A new approval must be submitted if the operation should proceed.

**Recovery:** See Runbook §7.1. If the existing active journey should be superseded, close it in SP (`Status = Closed`), then re-submit and re-execute.

**Prevention:** Check PersonProfile Readiness tab for an active Onboarding journey before submitting a new approval.

**Related files:** `useExecuteApproval.ts`, `SharePointJourneyService.ts`

---

### ERR-002 — SelfApprovalError

**Type:** Active Runtime
**Symptom:** Toast: "Self-approval not permitted — You cannot approve your own submission." `ApprovalStatus` unchanged.
**Cause:** `usePatchApprovalStatus` (Approve path) compares `currentUser.loginName` to `approval.submittedBy`. If equal, throws `SelfApprovalError` before any SP write. Governed by ADR-013.
**Detection:**
- Toast text as above
- SP confirm: `C3Approvals.ApprovalStatus` still `Submitted` or `InReview` — unchanged

**User Impact:** The approval cannot be self-approved. A different account must perform the Approve action.

**Recovery:** See Runbook §7.3. Use a second account for the Approve action.

**Prevention:** In a multi-user beta, the submitter and approver must be different accounts. In single-operator beta, this is a known limitation — document that the same user performed both actions and accept in the trusted beta environment.

**Related files:** `usePatchApprovalStatus.ts`, ADR-013

---

### ERR-003 — PayloadValidationError

**Type:** Active Runtime
**Symptom:** Toast: "Execution blocked — invalid payload. The approval payload is missing or malformed. No journey/credential was created." `ApprovalStatus` unchanged.
**Cause:** `useExecuteApproval` parses `approval.payload` (a JSON string in the `Payload` column). If null, empty, or unparseable, throws `PayloadValidationError` before any SP write.
**Detection:**
- Toast text as above
- SP confirm: `C3Approvals.ApprovalStatus` still `Approved` — unchanged
- SP confirm: `C3Approvals.Payload` is null or corrupt — inspect the column value

**User Impact:** Execution blocked. No data was written. The Approved approval remains in the inbox. The operation must be re-submitted.

**Recovery:** See Runbook §7.2. Inspect and correct `Payload` in SP if recoverable; otherwise submit a new approval.

**Prevention:** Payloads are generated by C3 submission forms (`useSubmitJourneyApproval`, `useSubmitCredentialApproval`). Malformed payloads should not occur from normal C3 use. Avoid manually editing the `Payload` column in SP.

**Related files:** `useExecuteApproval.ts`, `approvalPayloadUtils.ts`, `useSubmitJourneyApproval.ts`, `useSubmitCredentialApproval.ts`

---

### ERR-004 — ApprovalStatusGuardError

**Type:** Active Runtime
**Symptom:** No toast appears. Console: "Only approved approvals can be executed. Current status: <X>." No SP write occurs.
**Cause:** `useExecuteApproval` mutationFn first guard: `if (approval.approvalStatus !== 'Approved') throw`. Fires before any SP write. In normal UI operation, the Execute button is only rendered for Approved cards, so this fires only if the card state is stale or if a hook is called directly.
**Detection:** DevTools console error. No SP change.

**User Impact:** None in normal operation. This guard is intentional and defensive.

**Recovery:** Refresh the inbox (polling or manual reload). Confirm the approval's current `ApprovalStatus` in SP. Re-evaluate whether the approval is in a state that permits execution.

**Prevention:** No action needed. The guard is correct behavior.

**Related files:** `useExecuteApproval.ts`

---

### ERR-005 — PartialExecutionError (InitiateJourney)

**Type:** Active Runtime
**Symptom:** Toast: "Partial execution — manual resolution required." `C3Journeys` row exists and is `Active`. `C3Approvals` remains `Approved` with no `ExecutedAt`. ApprovalInbox card shows **Recover Execution Stamp** button.
**Cause:** `useExecuteApproval` (InitiateJourney): Step 4 — C3Journeys POST-then-MERGE — succeeded. Step 5 — stamp `C3Approvals → Executed` — failed (SP write timeout, 429, network drop). Journey is valid; approval stamp is missing.
**Detection:**
- Toast text as above
- SP confirm: `C3Journeys` has new `Active` row for `TargetPersonID`
- SP confirm: `C3Approvals.ApprovalStatus` still `Approved`; `ExecutedAt` is null

**User Impact:** Journey is active and valid in SP. ApprovalInbox shows the card in an incorrect `Approved` state with a recovery prompt. No data is lost; the approval needs a stamp-only recovery.

**Recovery:** See Runbook §7.4.
- In-app: click **Recover Execution Stamp** — `useRecoverExecutionStamp` confirms the journey exists, then stamps the approval without creating a new row.
- Manual: set `ApprovalStatus = Executed` and `ExecutedAt = <ISO timestamp>` in SP.

**Prevention:** SP reliability; no preventive action possible in beta.

**Related files:** `useExecuteApproval.ts`, `useRecoverExecutionStamp.ts`, `useActiveJourney.ts`, `ApprovalInbox.tsx`

---

### ERR-006 — PartialCredentialExecutionError (AddCredential)

**Type:** Active Runtime
**Symptom:** Toast: "Partial execution — credential created but approval stamp failed." `C3Credentials` row exists. `C3Approvals` remains `Approved` with no `ExecutedAt`. ApprovalInbox card may show **Recover Execution Stamp** button.
**Cause:** `useExecuteApproval` (AddCredential): `credentialService.addCredential` POST-then-MERGE succeeded (credential exists in SP). Approval stamp to `Executed` failed.
**Detection:**
- Toast text as above
- SP confirm: `C3Credentials` has new row for `HolderPersonID`
- SP confirm: `C3Approvals.ApprovalStatus` still `Approved`; `ExecutedAt` is null

**User Impact:** Credential is created and active in SP. ApprovalInbox shows card in incorrect `Approved` state. Recovery button may or may not appear depending on card state at reload.

**Recovery:** See Runbook §7.5.
- In-app: click **Recover Execution Stamp** if visible — `useRecoverCredentialExecutionStamp` confirms the credential exists, then stamps the approval.
- Manual fallback: set `ApprovalStatus = Executed` and `ExecutedAt` in SP. Manual path is required if the card no longer shows the Recover button (e.g., after page reload with stale cache).

**Caveat (TD-13 / S21-P1):** `useRecoverCredentialExecutionStamp` was implemented in S21-P1. However, recovery detection in the inbox does not trigger if the card has already transitioned out of the `Approved` state (e.g., due to a page reload between the partial execution and the recovery attempt). Manual SP recovery is always available as a fallback.

**Prevention:** SP reliability; no preventive action possible in beta.

**Related files:** `useExecuteApproval.ts`, `useRecoverCredentialExecutionStamp.ts`, `SharePointCredentialService.ts`, `ApprovalInbox.tsx`

---

### ERR-007 — InvalidTransitionError

**Type:** Active Runtime
**Symptom:** Toast: journey lifecycle transition blocked (e.g., "Cannot complete a cancelled journey"). The lifecycle action is not applied.
**Cause:** Journey lifecycle hooks (`useCompleteJourney`, `useSuspendJourney`, `useCancelJourney`) validate the requested transition against the current `Status` before writing. Throws `InvalidTransitionError` if the transition is not permitted. Valid transitions: `Active → Completed`, `Active → Suspended`, `Active/Suspended → Cancelled`.
**Detection:**
- Toast with transition blocked message
- SP confirm: `C3Journeys.Status` unchanged

**User Impact:** The requested lifecycle action is blocked. No data is written.

**Recovery:** Check the journey's current `Status` in PersonProfile Readiness tab or via SP REST. Perform only valid transitions. If the journey is in a terminal state (Completed, Cancelled), it cannot be transitioned further.

**Prevention:** Confirm the journey's current status before initiating a lifecycle action.

**Related files:** Journey lifecycle hooks, `SharePointJourneyService.ts`, `ADR-013 Addendum — Journey Lifecycle Transitions.md`

---

### ERR-008 — Stamp-only Safety Re-check Failure

**Type:** Active Runtime
**Symptom:** **Recover Execution Stamp** clicked; toast: recovery blocked (target journey/credential not found). No stamp written. `C3Approvals.ApprovalStatus` remains `Approved`.
**Cause:** `useRecoverExecutionStamp` or `useRecoverCredentialExecutionStamp` performs a safety re-check at stamp time — queries for the target journey or credential. If the target does not exist (manual SP deletion, race condition, or the row was never created), the stamp is blocked. This prevents a stamp-without-target write, which would create a false `Executed` record.
**Detection:** Toast indicates recovery blocked. `C3Approvals.ApprovalStatus` still `Approved`.

**User Impact:** Recovery attempt blocked. Data integrity preserved (no false stamp). The underlying cause (missing journey/credential) needs investigation.

**Recovery:** Investigate whether the target row was deleted or was never successfully created. If the `C3Journeys` or `C3Credentials` row was deleted manually, either re-execute the original approval (if possible — only if status is still `Approved` and the journey/credential was fully deleted) or manually resolve the SP records and stamp the approval manually.

**Prevention:** Do not manually delete `C3Journeys` or `C3Credentials` rows that have associated pending `C3Approvals` records.

**Related files:** `useRecoverExecutionStamp.ts`, `useRecoverCredentialExecutionStamp.ts`

---

### ERR-019 — Toaster Context Unavailable (ToasterGuard)

**Type:** Active Runtime
**Symptom:** C3 operations complete (approvals process, journeys create) but no toast notifications appear. No console error.
**Cause:** FluentUI v9 `Toaster` context is not available at render time. `ToasterGuard` (TD-16) is the current workaround; if it is not correctly in place, toast calls fail silently.
**Detection:** Perform an action that should produce a toast (e.g., approve a submission). If no toast appears, check the React component tree for the Toaster provider placement. Check TD-16 for the current state of the workaround.

**User Impact:** Operations succeed but operator receives no confirmation feedback. Risk of unintentionally repeating an action that already completed.

**Recovery:** Verify `ToasterGuard` is present and correctly positioned in the component tree (wrapping the screens that trigger toasts). See TD-16 for investigation guidance.

**Prevention:** Do not remove `ToasterGuard` without fully resolving the underlying FluentUI Toaster provider placement issue.

**Related files:** Toast provider, `AppShell.tsx` or equivalent, TD-16

---

### ERR-020 — CredentialAlreadyInactiveError

**Type:** Active Runtime
**Symptom:** Executing an Approved + DeactivateCredential approval returns "Execution blocked — credential already inactive". No SP writes occur. No approval stamp is written.
**Cause:** The target credential already has `IsActive = false` in C3Credentials. This is the expected outcome of a partial execution failure where Step 4 (the IsActive MERGE) succeeded but Step 5 (stampExecution) failed.
**Detection:** Toast: "Execution blocked — credential already inactive." Approval card shows Execute button active (approval remains Approved). ApprovalInbox recovery detector should have flagged this card — if the Execute button is still showing, the lazy `useGetCredential` query may not have settled yet.

**User Impact:** Operator clicks Execute and sees the error toast. The approval remains Approved. The credential is already inactive (correct state). No data is changed.

**Recovery:**
1. Wait a moment for the recovery detector to settle — the card should automatically switch to "Recover Execution Stamp" with a warning MessageBar.
2. If the recovery button does not appear after a reload, use `useRecoverDeactivationExecutionStamp` (Sprint 23 Phase 1): stamp the approval Executed without re-applying the MERGE.
3. If the button appears, click "Recover Execution Stamp". This stamps the approval Executed without re-running deactivateCredential.

**Prevention:** Avoid clicking Execute rapidly on DeactivateCredential cards. Wait for the existence check spinner to clear. The recovery path is safe — no SP data is modified.

**Related files:** `useExecuteApproval.ts` (`CredentialAlreadyInactiveError`), `useRecoverDeactivationExecutionStamp.ts`, `ApprovalInbox.tsx`

---

### ERR-021 — PartialDeactivationExecutionError

**Type:** Active Runtime
**Symptom:** Toast: "Partial execution — credential deactivated but the approval record could not be stamped Executed." The credential `IsActive` flag is now `false` in C3Credentials, but the C3Approvals record remains in Approved status.
**Cause:** Step 4 of the DeactivateCredential execution path (`deactivateCredential` SP MERGE) succeeded; Step 5 (`stampExecution`) failed. This is a partial write failure — network interruption, SP throttle, or form digest expiry between the two steps.
**Detection:** Toast as above. Credential appears inactive in PersonProfile (correct state). ApprovalInbox card still shows Approved status.

**User Impact:** Credential is correctly inactive. The approval audit record does not reflect Executed status until resolved.

**Recovery:**
1. In ApprovalInbox, reload. The recovery detector (`useGetCredential`) should detect `IsActive = false` and replace the Execute button with "Recover Execution Stamp" (amber).
2. Click "Recover Execution Stamp". The recovery hook stamps the approval Executed without re-applying the MERGE.
3. If the card is no longer Approved (e.g. manually updated in SP), use `useRecoverDeactivationExecutionStamp` directly.

**Prevention:** Retry at a low-traffic time. Ensure network is stable between execution steps. If error recurs, examine SP throttle logs.

**Related files:** `useExecuteApproval.ts` (`PartialDeactivationExecutionError`), `useRecoverDeactivationExecutionStamp.ts`, `ApprovalInbox.tsx`

---

## Category B — SP Environment Issues

These errors indicate a SharePoint configuration or provisioning problem. They prevent C3 from functioning correctly and must be resolved by the operator before use.

---

### ERR-014 — C3Approvals List Inaccessible

**Type:** SP Environment
**Symptom:** ApprovalInbox shows error state or empty queue when approvals should be present. Console: SP REST 404 or 403 on `C3Approvals` endpoint.
**Cause:** The list does not exist at the expected internal name; SP permissions are misconfigured; or the list was renamed.
**Detection:**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')
```
- 200 = accessible
- 404 = list not found (not provisioned or wrong name)
- 403 = permissions insufficient

**User Impact:** Approval workflow entirely unavailable. No approvals can be viewed or processed.

**Recovery:** Provision or repair the `C3Approvals` list per `S18 C3Approvals SP List Schema.md`. Verify SP list permissions — the workbench user needs at least Read access; owners need Write access.

**Related files:** `SharePointApprovalsService.ts`, `S18 C3Approvals SP List Schema.md`

---

### ERR-015 — loginName Empty / Role Resolution Failure

**Type:** SP Environment
**Symptom:** `[C3]` console log shows `currentUser.loginName: ''`. Role resolves to `visitor` regardless of SP group membership. Approvals inbox may be hidden from an owner account.
**Cause:** `pageContext.user.loginName` is empty for the current user. This can occur with guest accounts, external users, or certain AAD configurations that do not populate the SPFx page context `loginName`. The C3 role resolver fail-closes to `visitor` when `loginName` is empty.
**Detection:** DevTools console → `[C3]` log → look for `currentUser.loginName: ''`.

**User Impact:** Role-gated features (Approvals inbox, Execute buttons, Add Credential) are unavailable even for a Platform Owner account. Self-approval guard is also unreliable when `loginName` is empty.

**Recovery:** Use a standard Microsoft 365 member account (not a guest or external account) for all beta testing. Verify that `pageContext.user.loginName` is populated for the account type in use.

**Related files:** `SharePointHost.tsx`, `spRoleResolver.ts`

---

### ERR-016 — OperationType Choice Column Missing AddCredential

**Type:** SP Environment
**Symptom:** Submitting a credential approval returns SP 400. `C3Approvals` row is not created. `useSubmitCredentialApproval` errors.
**Cause:** The `OperationType` Choice column in `C3Approvals` does not include `AddCredential` as a valid choice value. The S18-era list provisioning may have only included `InitiateJourney`. The SP service sends `OperationType = AddCredential` in the POST body; SP rejects it with 400 because the value is not in the column's choice list.
**Detection:** SP REST 400 response body. Check `C3Approvals` list settings → `OperationType` column → Edit → Choices.

**User Impact:** All credential approval submissions fail. The credential governance workflow is unavailable.

**Recovery:** In SP list settings, edit the `OperationType` Choice column and add `AddCredential` to the choices. Confirm both `InitiateJourney` and `AddCredential` are present. Refer to Beta Checkpoint Part 0.2 for the full required choice set.

**Related files:** `SharePointApprovalsService.ts`, `S18 C3Approvals SP List Schema.md`

---

### ERR-018 — C3Credentials Missing Required Column

**Type:** SP Environment
**Symptom:** Credential execution returns SP 400. `C3Credentials` row is not created.
**Cause:** The `C3Credentials` list is missing a required column — most commonly `HolderPersonID`, `CredentialType`, `ReferenceNumber`, or `IsActive`. SP rejects the POST body because the field does not exist on the list.
**Detection:** SP REST 400 response body. Check `C3Credentials` list settings and compare against the required columns listed in `C3 Beta Operational Runbook.md §2.3`.

**User Impact:** Credential execution fails. No `C3Credentials` row is created. `C3Approvals` record remains `Approved`.

**Recovery:** Add the missing column(s) per the schema in `C3 Beta Operational Runbook.md §2.3`. Reattempt execution after the column is added.

**Related files:** `SharePointCredentialService.ts`, S21 C3Credentials SP List Schema.md

---

## Category C — Deployment and Tooling Issues

These errors affect the development/deployment workflow. They do not surface in the production workbench unless a broken build was deployed.

---

### ERR-010 — Runtime Bundle SHA Mismatch

**Type:** Deployment / Tooling
**Symptom:** `npm run verify:runtime` fails with `SHA mismatch` or `FAIL`. One of: the dist build and SPFx host asset have different hashes; or one file is missing or empty.
**Cause:** `npm run copy:c3-runtime` was not run after the build, or `beta:runtime` was partially interrupted. The two copies of `c3-runtime.js` are out of sync.
**Detection:** `npm run verify:runtime` output.

**User Impact (if deployed in this state):** Hosted workbench may load a stale C3 runtime — source behavior and deployed behavior diverge. parity harnesses and tsc will still pass (they test source), but the workbench test is invalid.

**Recovery:** Run `npm run beta:runtime` (build + copy), then `npm run verify:runtime`. Expect PASS. Commit updated bundle (Runbook §4.3). If `verify-c3-runtime.mjs` itself fails with a syntax error, the mnt filesystem may have truncated the script file — restore via `git show HEAD:scripts/verify-c3-runtime.mjs`.

**Prevention:** Always use `npm run beta:runtime` (never `build:c3-runtime` alone). Never manually edit runtime bundle files.

**Related files:** `scripts/verify-c3-runtime.mjs`, `package.json` (beta:runtime, verify:runtime scripts), TD-15

---

### ERR-011 — TMP-* Orphan Row

**Type:** Deployment / Tooling (SP write failure)
**Symptom:** A `C3Approvals` or `C3Credentials` row exists with a `Title` matching `TMP-<base36>`. The row has no canonical APR-XXXX or CRED-XXXX identifier. Silent — no toast in C3.
**Cause:** The POST to create the row succeeded (SP assigned an integer ID). The MERGE to update the `Title` to the canonical identifier failed (SP timeout, 429, or network drop). The TMP placeholder was not overwritten.
**Detection:**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$filter=startswith(Title,'TMP-')
GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=startswith(Title,'TMP-')
```

**User Impact:** The orphan row may appear in the C3 UI with an incorrect title. The operation that created it did not fully complete.

**Recovery:** See Runbook §7.6. Delete the TMP-* row from SP. Re-submit the operation from C3.

**Prevention:** SP reliability; the POST-then-MERGE pattern is required for SP auto-ID atomicity. No preventive action in beta.

**Related files:** `SharePointApprovalsService.ts`, `SharePointJourneyService.ts`, `SharePointCredentialService.ts`

---

### ERR-012 — NUL Byte in Source File

**Type:** Deployment / Tooling (developer environment issue)
**Symptom:** `tsc` fails with "Invalid or unexpected token" at a specific line. Parity harness outputs garbled characters or fails unexpectedly. NUL byte audit returns non-zero count.
**Cause:** File write via the Write or Edit tool on Windows/mnt paths sometimes inserts NUL bytes (0x00) into file content, particularly in large Markdown or TypeScript files. The resulting file appears valid but contains embedded NUL characters that TypeScript and Node cannot parse.
**Detection:**
```bash
python3 -c "
files = ['packages/c3/src/...']
for f in files:
    d = open(f,'rb').read()
    n = d.count(b'\x00')
    print(f'{f}: {n} NUL bytes' + (' ⚠' if n else ' ✓'))
"
```

**User Impact:** TypeScript compilation fails; parity harnesses fail. Beta build is broken until fixed.

**Recovery:** Restore the affected file from git: `git show HEAD:<path>` then write back via Python subprocess with explicit UTF-8 encoding. Re-run NUL audit to confirm zero bytes. Re-run `tsc` and parity harnesses.

**Prevention:** For files > ~50 lines, always write via a Python script (Write tool creates `.py` in outputs directory; bash executes it). Never write large content files directly via Edit/Write tool to mnt paths.

**Related files:** Any source or doc file on the mnt filesystem.

---

### ERR-013 — Git Index Corruption

**Type:** Deployment / Tooling (developer environment issue)
**Symptom:** `git add` returns: `error: bad signature 0x00000000` / `fatal: index file corrupt`. Staging is blocked.
**Cause:** The mnt filesystem (Windows host, accessed from the Linux sandbox) intermittently corrupts the `.git/index` file during `git add` operations.
**Detection:** `git add` error output as above.

**User Impact:** Cannot stage or commit until the index is repaired.

**Recovery:**
```bash
export GIT_INDEX_FILE=/tmp/c3-git-index
git read-tree HEAD
git add <files>
git commit -m "..."
```
Keep `GIT_INDEX_FILE` exported for all subsequent git operations in the same shell session.

**Prevention:** Always use `GIT_INDEX_FILE=/tmp/c3-git-index` for all git staging operations in the mnt-mounted sandbox. Do not attempt to repair `.git/index` directly.

**Related files:** `.git/index` on mnt filesystem.

---

## Category D — Latent / Future Risks

These are known issues that do not cause observable failures in the current beta environment but will cause problems at scale or when related features are built.

---

### ERR-009 — getApproval Not Implemented

**Type:** Latent
**Symptom:** Any code path calling `approvalsService.getApproval(id)` throws immediately with "not implemented". No SP call is made.
**Cause:** Both `MockApprovalsService.getApproval` and `SharePointApprovalsService.getApproval` throw "not implemented". No current screen or hook calls this method. See TD-06.
**Detection:** Console: "not implemented". Only observable if new code calls `getApproval`.

**User Impact:** Zero in current beta. Any future screen requiring single-approval fetch by ID will crash on first use.

**Recovery (when triggered):** Implement `getApproval` in both service classes before building any consumer. See TD-06.

**Related files:** `MockApprovalsService.ts`, `SharePointApprovalsService.ts`, `IApprovalsService.ts`

---

### ERR-017 — $top=500 Approval History Truncation

**Type:** Latent
**Symptom:** PersonProfile Approvals tab shows incomplete approval history for a person even though more records exist in SP. No error; data is silently truncated.
**Cause:** `listApprovals` SP query uses `$top=500`. `usePersonApprovals` (S21-P2) filters client-side by `targetPersonId`. If `C3Approvals` total record count exceeds 500, earlier records fall outside the fetch window and are invisible to person-scoped filtering.
**Detection:** Cross-reference PersonProfile Approvals tab count against a direct SP query filtered by `TargetPersonID`. Discrepancy indicates truncation. See TD-19.

**User Impact (when triggered):** Approval history for high-volume persons may appear incomplete. Display-only gap; no action-blocking.

**Risk level:** Not a concern in beta. Becomes relevant at ~400–500 total `C3Approvals` records.

**Mitigation (future):** Implement OData `$filter=TargetPersonID eq '...'` in SP service (TD-07), or add pagination support to `listApprovals`. See TD-19.

**Related files:** `SharePointApprovalsService.ts`, `usePersonApprovals.ts`

---

### ERR-022 — Intelligence SP DSM Cold-Load Crash

**Type:** Runtime / First-load
**Symptom:** In hosted SP DSM, first navigation into Intelligence (immediately after a hard refresh, with no query cache) triggers an ErrorBoundary with: `Cannot read properties of undefined (reading 'set')`. Navigating away and returning to Intelligence works correctly on the second visit.
**Cause:** Under investigation. Leading hypothesis: React Query v5 `isLoading = isPending && isFetching`. On the first render frame (before effects run), `fetchStatus` starts as `'idle'`, producing `isLoading = false` with `data = undefined`. Intelligence briefly renders full content — mounting Fluent UI Card Griffel style-cache Maps — then switches to skeleton one tick later when the fetch starts in effects. The unmount cleanup's `.set()` call hits a partially torn-down style-cache Map. The `isPending` fix in commit `46b193d` addresses this hypothesis; result remains unconfirmed in hosted SP DSM.
**Data impact:** None. All contract, people, credentials, and approvals data is unaffected.
**Detection:** Hard refresh in SP DSM → click Intelligence nav item → ErrorBoundary triggers with `Cannot read properties of undefined (reading 'set')`.
**Mitigation:** Intelligence is hidden from the SP DSM NavRail via a `visibleWhen` guard (S24-P1). Intelligence remains fully visible and functional in Mock DSM.
**Resolution path:** See TD-23. Re-enable after hosted hard-refresh first-click passes cleanly. If crash recurs after `isPending` fix, investigate Fluent UI Card/Griffel `stylesInsertion` cache teardown at unmount time.

**Related files:** `packages/c3/src/intelligence/useIntelligence.ts`, `packages/c3/src/components/layout/NavRail.tsx`, `packages/c3/src/components/intelligence/OperationalInsightsPanel.tsx`
