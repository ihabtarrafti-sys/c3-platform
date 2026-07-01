# Sprint 23 Closeout Report — Credential Lifecycle Hardening
**C3 Contract Control Center**
**Sprint:** 23 — Credential Lifecycle Hardening
**Closeout date:** 2026-07-01
**Status:** CLOSED
**Preceding sprint:** Sprint 21 CLOSED (Credential Recovery, Person-Centered Approval Visibility, and Runtime Automation) — Sprint 22 was docs/runbook only
**Validation baseline:** All parity harnesses pass, tsc clean, verify:runtime PASS, hosted SP DSM validation confirmed

---

## Closeout statement

Sprint 23 closes as:

> **"C3 now supports three governed operational write paths through ADR-013: Journey initiation (live S18), credential creation (live S20), and credential deactivation (live S23 Phase 1). The complete credential lifecycle — add, recover-add, deactivate, recover-deactivate — is now in-app and governed. No credential write of any kind goes directly to SharePoint from the UI in SP DSM; every write passes through C3Approvals. PersonProfile is the lifecycle entry point for deactivation (Deactivate button on each credential row, owner/operations only, with required reason). ApprovalInbox is the execution queue and recovery surface for all three operation types. TD-20 is resolved. ERR-020 (CredentialAlreadyInactiveError) and ERR-021 (PartialDeactivationExecutionError) are recorded in the Error Library. Mock DSM bypasses approval for rapid demo/regression. SP DSM is the beta operational path."**

Sprint 23 does **not** close as:

> ~~"Credential reactivation is implemented."~~
> ~~"Server-side TargetPersonID filter is added to listApprovals."~~
> ~~"Inactive credential archive or history view is built."~~
> ~~"Journey lifecycle audit columns (SuspendedAt/CancelledAt) are provisioned."~~
> ~~"Contracts/SP-02 are resolved."~~
> ~~"CI/CD pipeline is in place."~~
> ~~"Missions, Finance, or Induction are implemented."~~

---

## Sprint objective

Close the credential lifecycle loop. After S20-P3 (`addCredential`) and S21-P1 (credential partial-execution recovery), the only missing governed write path for credentials was deactivation. Sprint 23 Phase 1 delivers the full `DeactivateCredential` ADR-013 path from PersonProfile through ApprovalInbox, with partial-execution recovery and defence against double-click (CredentialAlreadyInactiveError).

---

## Completed phases

### Phase 1 — Governed credential deactivation

**Commit:** `294fd8f` feat(s23-phase-1): Implement governed credential deactivation

**Scope:** New hooks, SP service extension, UI updates, docs

#### Types and interfaces

- `approvalPayloads.ts` — `DeactivateCredentialApprovalPayload` added:
  - Fields: `operationType: 'DeactivateCredential'`, `credentialId`, `holderPersonId`, `credentialType`, `referenceNumber`, `reason` (required), `requestedBy?`
  - `ApprovalPayload` union widened to include `DeactivateCredentialApprovalPayload`
- `IApprovalsService.ts` — `operationType` union widened: `'InitiateJourney' | 'AddCredential' | 'DeactivateCredential'`
- `queryKeys.ts` — `credential.byId(credentialId)` group added for the new single-credential query hook

#### SharePoint service

- `SharePointCredentialService.deactivateCredential(credentialId)`:
  - Calls `this.getCredential(credentialId)` — no IsActive filter (must find deactivated credentials for recovery checks)
  - Credential not found → throws with message; prevents stale-ID write
  - Fetches fresh form digest via `fetchFormDigest(siteUrl)` (module-level helper)
  - Sends `POST + X-HTTP-Method: MERGE + IF-MATCH: *` to the list item URL constructed from `credential.Id` (SP integer ID from mapper)
  - Body: `{ __metadata: { type: LIST_ITEM_TYPE }, IsActive: false }`
  - SP MERGE returns 204 No Content — non-ok response throws
  - No new SP row created; existing CRED-XXXX row updated in place

#### New hooks

**`useGetCredential.ts`** — single-credential query hook
- Fetches by credential ID string (e.g. `CRED-0004`) with no IsActive filter
- Query key: `queryKeys.credential.byId(credentialId)`
- Enabled guard: `credentialId.trim().length > 0 && enabled`
- Used by ApprovalInbox to detect PartialDeactivationExecutionError recovery candidates

**`useSubmitDeactivationApproval.ts`** — mode-branching submission hook
- Input type `DeactivateCredentialInput`: `{ credentialId, holderPersonId, credentialType, referenceNumber, reason }`
- Outcome type `DeactivationSubmissionOutcome`: `{ mode: 'direct' }` (Mock DSM) | `{ mode: 'approval'; approvalTitle, approvalId }` (SP DSM)
- Mock DSM: calls `credentialService.deactivateCredential()` directly; invalidates `person.credentials(holderPersonId)` and `credentials.all()`
- SP DSM: submits `C3Approvals` record with `OperationType: DeactivateCredential`; no credential write
- `isPending` managed via `useState`; `try/finally` guarantees clear on error
- Follows `useSubmitCredentialApproval` mode-branch pattern

**`useRecoverDeactivationExecutionStamp.ts`** — stamp-only recovery hook
- Pre-conditions at hook invocation: `approvalStatus === 'Approved'`, `operationType === 'DeactivateCredential'`, parseable `credentialId` + `holderPersonId`
- Safety re-check at stamp time: calls `getCredential` → not found → `DeactivationRecoveryTargetMissingError` (no write); still active → `DeactivationRecoveryTargetActiveError` (no write); confirmed inactive → calls `stampExecution({ newStatus: 'Executed', executedAt: ... })`
- Never calls `deactivateCredential`; never stamps ExecutionFailed
- `onSuccess` invalidates `approvals.all()`, `person.credentials(holderPersonId)`, `credentials.all()`
- Exported error classes: `DeactivationRecoveryPreConditionError`, `DeactivationRecoveryTargetMissingError`, `DeactivationRecoveryTargetActiveError`

#### `useExecuteApproval.ts` — DeactivateCredential dispatch branch

New error classes:
- `CredentialAlreadyInactiveError` — thrown when getCredential returns `IsActive === false` before the MERGE attempt. Approval remains Approved (not stamped ExecutionFailed). Recovery path applies.
- `PartialDeactivationExecutionError` — thrown when MERGE succeeded (credential inactive) but stampExecution failed. Approval remains Approved. Recovery path (`useRecoverDeactivationExecutionStamp`) applies.

Dispatch branch:
1. Parse `credentialId` and `holderPersonId` from payload
2. Call `getCredential(credentialId)` — no IsActive filter
3. If credential not found → throw with message
4. If `credential.IsActive === false` → throw `CredentialAlreadyInactiveError`
5. Call `deactivateCredential(credentialId)` — MERGE IsActive = false
6. Call `stampExecution({ newStatus: 'Executed', executedAt })` — if this throws, `PartialDeactivationExecutionError` is raised
7. `onSuccess` invalidates `person.credentials(holderPersonId)` and `credentials.all()`
8. `onError` for `CredentialAlreadyInactiveError` and `PartialDeactivationExecutionError`: specific toast messages

#### PersonProfile UI changes

- State: `deactivateTarget: Credential | null`, `deactivateReason: string`
- Hook: `useSubmitDeactivationApproval` (replaces no previous hook)
- Handlers: `handleDeactivateDismiss()`, `handleDeactivateConfirm()` (async)
- Each credential DataRow gets an action prop: "Deactivate" button (danger colour), gated by `canManageJourneyLifecycle` (`owner` or `operations` role only)
- Confirm dialog: shows credential label + reference number; required `reason` textarea; confirm button disabled until non-blank reason entered; "Go Back" dismisses without write

#### ApprovalInbox UI changes

- `extractDeactivationRecoveryFields()` helper — extracts `{ credentialId, holderPersonId }` from payload JSON or returns null
- DeactivateCredential PayloadSummary section: "Deactivation Payload" with credentialId, holderPersonId, credentialType (humanized label), referenceNumber, reason
- `useRecoverDeactivationExecutionStamp` hook instantiated per ApprovalCard
- `deactivationRecoveryFields` memo + `isDeactivationRecoveryCandidate` flag
- `useGetCredential(credentialId, isDeactivationRecoveryCandidate)` — lazy single-credential query enabled only for recovery candidates
- `isPartialDeactivationExecutionRecovery` — true when candidate detected AND `deactivationTargetCredential?.IsActive === false`
- Recovery branch: amber Fluent UI MessageBar + "Recover Execution Stamp" button replaces normal action section
- `handleRecoverDeactivation()` with error-specific toasts for each recovery error class
- Execute success toast updated for DeactivateCredential: `"Credential CRED-XXXX deactivated."`
- Execute error handling for `CredentialAlreadyInactiveError` (informational toast, stay in Approved) and `PartialDeactivationExecutionError` (warning toast, recovery path shown)

#### `approvalPayloadUtils.ts` — DeactivateCredential case

- Adds `DeactivateCredential` arm to `formatApprovalPayloadSummary`
- Humanizes `credentialType` via `CREDENTIAL_TYPE_LABELS` (same map as AddCredential)
- Summary format: `Deactivate · <credType label> · <refNum> · <holderPersonId>`

---

## Commit summary

| Hash | Phase | Type | Description |
|------|-------|------|-------------|
| `294fd8f` | Phase 1 | feat | Implement governed credential deactivation |

HEAD at time of closeout: `294fd8f`
Preceding sprint (S21/S22 docs) HEAD: `3f88957`

Files changed: 16 (3 new source files, 9 modified source files, 4 modified doc files)

---

## Validation summary

All validation performed at closeout (HEAD: `294fd8f`).

| Validation | Result |
|------------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| `npm run verify:runtime` | ✓ PASS — SHA-256: `f8d7bcb6c0e61b26f480163e46e605a5fcdefa57be642abe9bfe00e4f0d68a27` on both files |

Parity baselines unchanged from Sprint 21. No parity harnesses were modified in Sprint 23.

---

## Hosted SP DSM validation summary

All live validation performed against hosted workbench (same-origin fetch, SP DSM, `dataSrc=sharepoint`).

| Scenario | Result |
|----------|--------|
| PersonProfile — Deactivate button visible (owner role) | ✓ Button renders on each credential DataRow |
| PersonProfile — Deactivate button absent (visitor role) | ✓ Button not rendered for visitor |
| PersonProfile — confirm dialog appears with credential details | ✓ Label + reference number shown |
| PersonProfile — confirm button disabled without reason | ✓ Submit blocked until reason entered |
| Mock DSM — direct deactivation (no approval) | ✓ Credential removed from list immediately |
| SP DSM — deactivation approval submission | ✓ C3Approvals row created (OperationType: DeactivateCredential, Submitted) |
| SP DSM — approval shows in ApprovalInbox (Submitted tab) | ✓ DeactivateCredential card visible |
| SP DSM — Approve → Execute path | ✓ IsActive = false in C3Credentials; approval Executed |
| PersonProfile — deactivated credential absent from credentials list | ✓ Credential no longer shown after execution |
| CredentialAlreadyInactiveError — execution blocked, approval stays Approved | ✓ Toast shown; no stamp written |
| PartialDeactivationExecutionError recovery — amber MessageBar + Recover button | ✓ Recovery path shown in ApprovalInbox |
| Recovery stamp — no re-MERGE, approval stamped Executed | ✓ Credential remains inactive; approval moves to Executed |
| DeactivateCredential payload summary in ApprovalInbox | ✓ Humanized label, all fields shown |
| All S21 paths (journey initiation, AddCredential, lifecycle, recovery) | ✓ No regression |
| Mock DSM — all paths intact | ✓ Direct credential write and journey creation unchanged |

---

## SharePoint lists involved

| List | Role in Sprint 23 | Schema change |
|------|-------------------|---------------|
| `C3Approvals` | New record per DeactivateCredential submission; MERGE on execute/recovery stamp | None — `DeactivateCredential` OperationType pre-provisioned |
| `C3Credentials` | MERGE `IsActive = false` on execution; read via `getCredential` for recovery detection | None |
| `C3Journeys` | Read-only in Sprint 23 | None |
| `C3People` | Read-only in Sprint 23 | None |

**No SP schema changes were made in Sprint 23.**

---

## Governed operations now supported

| Operation | Trigger | SP write |
|-----------|---------|----------|
| Initiate Onboarding Journey | StartJourneyPanel → Submit for Approval | C3Approvals (APR-XXXX) → C3Journeys (JRN-XXXX) on execution |
| Add Credential | AddCredentialPanel → Submit for Approval | C3Approvals (APR-XXXX) → C3Credentials (CRED-XXXX) on execution |
| Deactivate Credential | PersonProfile Deactivate → Submit for Approval (SP DSM) | C3Approvals (APR-XXXX) → C3Credentials MERGE IsActive=false on execution |

All three operations:
- Follow `Submitted → InReview → Approved → Executed` lifecycle through C3Approvals
- Require Platform Owner approval before execution (in SP DSM)
- Appear in the Approval Inbox with `PayloadSummary` rendering human-readable payload fields
- Appear in PersonProfile Approvals tab with `PersonApprovalHistoryCard` rendering

---

## Recovery UX now supported

| Failure mode | Recovery path | Sprint delivered |
|---|---|---|
| Journey execution stamp failure (`PartialExecutionError`) | `useRecoverExecutionStamp` — stamp-only, no new journey created | S20 Phase 2 |
| Credential execution stamp failure (`PartialCredentialExecutionError`) | `useRecoverCredentialExecutionStamp` — stamp-only, no new credential created | S21 Phase 1 |
| Credential deactivation stamp failure (`PartialDeactivationExecutionError`) | `useRecoverDeactivationExecutionStamp` — stamp-only, no re-MERGE | S23 Phase 1 |

All recovery paths:
- Replace the Execute button with a warning/amber-coloured Recover button when the failure condition is detected in ApprovalInbox
- Perform stamp-only writes — no new rows, no repeat of the primary write
- Guard against races at stamp time (safety re-check before writing)
- Throw a specific `RecoveryTargetMissing` or `RecoveryTargetActive` error if the target state has unexpectedly changed

---

## PersonProfile surfaces (after Sprint 23)

| Tab | Content | Action surface |
|-----|---------|----------------|
| Profile | Person details, credentials (active only), journey card | Lifecycle actions, Add Credential, **Deactivate Credential** (S23), Start Journey |
| Readiness | Obligation completion status | Resolve Obligation (Add Credential path) |
| Approvals | Active and historical approvals for this person | Read-only — no action buttons |

The Deactivate button is scoped to `owner` and `operations` roles via `canManageJourneyLifecycle`. It is not visible to `management`, `hr`, `legal`, `finance`, or `visitor`.

---

## Scope boundaries preserved

The following were not touched at any point during Sprint 23:

- No C3Approvals, C3Journeys, C3People, or C3Credentials schema changes
- No credential reactivation path
- No inactive credential archive or history view
- No server-side targetPersonId filter (TD-07 remains open)
- No journey lifecycle transition changes
- No Contracts, Missions, Finance, Induction, Milestones
- No Power Automate flows
- No CI/CD pipeline
- Mock DSM unchanged — all paths intact for demo/regression

---

## Tech debt items changed in Sprint 23

| ID | Item | Status change |
|----|------|---------------|
| TD-20 | `deactivateCredential` not implemented | 🟠 → ✅ Resolved S23-P1 |

No new tech debt items were introduced in Sprint 23.

---

## Error library additions in Sprint 23

| Error | Class | ERR ID |
|-------|-------|--------|
| Credential already inactive at execution time | `CredentialAlreadyInactiveError` | ERR-020 |
| Credential deactivated but stamp failed | `PartialDeactivationExecutionError` | ERR-021 |

---

## Remaining known limitations

| Limitation | Risk |
|------------|------|
| No credential reactivation | Functional gap — operator must manually set IsActive = true in C3Credentials SP list |
| No inactive credential archive/history view | Functional gap — deactivated credentials disappear from PersonProfile; no UI to view them |
| No server-side TargetPersonID filter on `listApprovals` (TD-07) | Latent — client-side workaround; `$top=500` truncation risk (TD-19) |
| Manual runtime bundle commit still required | Medium — `beta:runtime` + `verify:runtime` reduce error surface but do not remove the requirement |
| No CI/CD (TD-14) | Medium — validation is manual throughout |
| Runtime build artifacts committed to git (TD-15) | Low — repo bloat; mitigated S21-P4 |
| Amendments hidden in SP DSM (TD-03) | Known — NavRail gate in place |
| Contracts/SP-02 not resolved | Functional gap — separate workstream |
| Missions/Finance not in SP DSM | Functional gap — deferred |
| Induction not implemented | Planned post-beta |
| Journey lifecycle audit columns deferred (TD-21) | Notes-append remains audit trail |

---

## Recommended Sprint 24 focus

### Priority 1 — Server-side TargetPersonID filter (TD-07 + TD-19 closure)

Add `targetPersonId?: string` to `listApprovals` filter type and implement OData `$filter=TargetPersonID eq '...'` in `SharePointApprovalsService`. Resolves TD-07 and closes the truncation risk in TD-19. No schema change required — `TargetPersonID` column already exists in C3Approvals.

### Priority 2 — Journey lifecycle audit columns (TD-21)

Provision `SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` in `C3Journeys`. Update `SharePointJourneyService` lifecycle methods to populate the respective timestamp alongside each PATCH. Requires IT provisioning (schema change) and a migration plan if live data exists.

### Priority 3 — Credential reactivation

Implement `reactivateCredential` as a new governed write path (ADR-013). Mirror `DeactivateCredential` pattern: new `ReactivateCredential` OperationType, `useSubmitReactivationApproval`, `useExecuteApproval` branch, PersonProfile UI entry point (on inactive credential row, if/when an inactive credential view is built).

### Non-priority (defer beyond S24)

- Inactive credential archive/history view (depends on credential reactivation design decisions)
- Contracts/SP-02 FK alignment
- Missions/Finance in SP DSM
- CI/CD pipeline (TD-14)
- Power Automate notification flows
- Induction (all dependencies must be live first)
