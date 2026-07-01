# C3 Architecture Baseline — Sprint 23
**C3 Contract Control Center**
**Sprint:** 23 — Credential Lifecycle Hardening
**Baseline date:** 2026-07-01
**Status:** CLOSED — 2026-07-01

---

## Closeout statement

Sprint 23 closes as:

> **"C3 now supports three governed operational write paths through ADR-013: Journey initiation (live S18), credential creation (live S20), and credential deactivation (live S23). The complete credential lifecycle — add, recover-add, deactivate, recover-deactivate — is in-app and approval-governed in SP DSM. No credential write of any kind goes directly to SharePoint from the UI in SP DSM. PersonProfile is the lifecycle entry point for both credential creation (Add Credential panel) and credential deactivation (Deactivate button, owner/operations only). ApprovalInbox is the sole execution and recovery queue for all three ADR-013 operation types. TD-20 is resolved. Mock DSM remains the demo and regression baseline. SP DSM is the beta operational path."**

---

## Section 1 — Architectural shifts introduced in Sprint 23

### Before Sprint 23 (Sprint 21/22 baseline)

- `deactivateCredential` was a stub (TD-20). To deactivate a credential in beta, an operator had to manually set `IsActive = false` directly in the `C3Credentials` SP list. No approval trail was created.
- The ADR-013 governance matrix covered two write paths: `InitiateJourney` and `AddCredential`.
- PersonProfile had a credentials list with no deactivation entry point.
- `CredentialAlreadyInactiveError` and `PartialDeactivationExecutionError` had no class definitions or UX handling.

### After Sprint 23

**1. Third governed write path: DeactivateCredential**

`deactivateCredential` in `SharePointCredentialService` is now a live MERGE operation:
- Calls `this.getCredential(credentialId)` (no IsActive filter) to obtain the SP integer `Id`
- Fetches a fresh form digest
- Sends `POST + X-HTTP-Method: MERGE + IF-MATCH: *` to the list item URL; body: `{ IsActive: false }`
- SP MERGE returns 204 No Content — no new row, no identifier generation
- Distinct from `addCredential` (POST-then-MERGE sequence) — deactivation is a pure update

In SP DSM the UI does **not** call `deactivateCredential` directly. The PersonProfile Deactivate button submits a `C3Approvals` record (`OperationType: DeactivateCredential`). The actual MERGE fires only when an owner executes the approval in ApprovalInbox.

In Mock DSM the call is direct (same as `addCredential` in Mock DSM) — no approval submitted.

**2. Deactivation approval payload**

`DeactivateCredentialApprovalPayload` carries: `operationType: 'DeactivateCredential'`, `credentialId`, `holderPersonId`, `credentialType`, `referenceNumber`, `reason` (required), `requestedBy?`. The `reason` field is required at submission time and stored in the C3Approvals payload for audit.

**3. PersonProfile — deactivation entry point**

Each active credential DataRow in PersonProfile now has a "Deactivate" action button gated by `canManageJourneyLifecycle` (`owner` or `operations` role). Clicking opens a confirm dialog showing the credential label and reference number, with a required `reason` textarea. The confirm button is disabled until a non-blank reason is entered. "Go Back" dismisses without write.

**4. ApprovalInbox — DeactivateCredential handling**

- DeactivateCredential cards render a "Deactivation Payload" PayloadSummary section (credentialId, holderPersonId, humanized credentialType, referenceNumber, reason).
- `useGetCredential` (new single-credential query hook, no IsActive filter) runs lazily for Approved + DeactivateCredential recovery candidates to detect `PartialDeactivationExecutionError` state.
- When `deactivationTargetCredential.IsActive === false` (credential inactive but approval still Approved): Execute button replaced by amber "Recover Execution Stamp" MessageBar + button.
- Execute success toast: "Credential CRED-XXXX deactivated."

**5. CredentialAlreadyInactiveError defence**

If `useExecuteApproval` detects `credential.IsActive === false` **before** calling `deactivateCredential`, it throws `CredentialAlreadyInactiveError`. This is a hard block — the approval is **not** stamped ExecutionFailed. Approval remains Approved. ApprovalInbox detects this via the recovery candidate check and shows the recovery path.

This prevents double-execution from creating an audit trail that says the operation failed when the credential is actually already in the desired state.

**6. PartialDeactivationExecutionError recovery**

If `deactivateCredential` succeeds (MERGE 204) but `stampExecution` throws, `PartialDeactivationExecutionError` is raised. `useRecoverDeactivationExecutionStamp` stamps Executed without re-applying the MERGE. Safety re-check at stamp time: `getCredential` → confirmed inactive → stamp; still active (unexpected) → `DeactivationRecoveryTargetActiveError`; not found → `DeactivationRecoveryTargetMissingError`.

---

## Section 2 — New components delivered in Sprint 23

### useGetCredential.ts

`packages/c3/src/hooks/useGetCredential.ts`

TanStack Query `useQuery`. Fetches a single credential by ID string (e.g. `CRED-0004`) with **no IsActive filter**. Returns `Credential | null`. Query key: `queryKeys.credential.byId(credentialId)`. Enabled guard: `credentialId.trim().length > 0 && enabled`. Used by ApprovalInbox for deactivation recovery detection — necessary because `listCredentialsForPerson` filters `IsActive eq 1` and cannot find already-deactivated credentials.

### useSubmitDeactivationApproval.ts

`packages/c3/src/hooks/useSubmitDeactivationApproval.ts`

Mode-branching mutation hook. Input: `DeactivateCredentialInput` (`credentialId`, `holderPersonId`, `credentialType`, `referenceNumber`, `reason`). Returns `DeactivationSubmissionOutcome` — `{ mode: 'direct' }` (Mock DSM) or `{ mode: 'approval'; approvalTitle, approvalId }` (SP DSM). `isPending` via `useState` + `try/finally`. Follows `useSubmitCredentialApproval` pattern.

### useRecoverDeactivationExecutionStamp.ts

`packages/c3/src/hooks/useRecoverDeactivationExecutionStamp.ts`

TanStack Query `useMutation`. Stamp-only recovery for `PartialDeactivationExecutionError` cases. Never calls `deactivateCredential`. Pre-conditions at hook invocation: `Approved`, `DeactivateCredential`, parseable `credentialId` + `holderPersonId`. Safety re-check at stamp time: `getCredential` → inactive confirmed → stamp Executed. Exported error classes: `DeactivationRecoveryPreConditionError`, `DeactivationRecoveryTargetMissingError`, `DeactivationRecoveryTargetActiveError`. `onSuccess` invalidates `approvals.all()`, `person.credentials(holderPersonId)`, `credentials.all()`.

---

## Section 3 — Runtime architecture (confirmed state after Sprint 23)

### SharePoint service registry

| Service | SP mode behaviour | State after S23 |
|---------|-------------------|-----------------|
| Role resolution | `/_api/web/currentUser/groups` → C3 role at mount | Live (S19) |
| Approvals — `createApproval` | POST-then-MERGE → APR-XXXX; supports `InitiateJourney`, `AddCredential`, `DeactivateCredential` | Live (S18, extended S20, S23) |
| Approvals — `listApprovals` | Reads C3Approvals — all statuses; `$top=500` client-side filter in usePersonApprovals | Live (S18) |
| Approvals — `patchApprovalStatus` | MERGE Approve/Reject | Live (S18) |
| Approvals — `stampExecution` | MERGE Executed/ExecutionFailed | Live (S18) |
| Journeys (read) | Reads C3Journeys | Live (S17) |
| Journeys — `initiateJourney` | POST-then-MERGE → JRN-XXXX | Live (S18, hardened S19) |
| Journeys — lifecycle transitions | GET→guard→PATCH | Live (S19) |
| People | Reads C3People | Live (S16) |
| Credentials (read) | Reads C3Credentials | Live (S15) |
| Credentials — `addCredential` | POST-then-MERGE → CRED-XXXX | Live (S20) |
| Credentials — `getCredential` | Read single credential by ID; no IsActive filter | Live (S23) |
| Credentials — `deactivateCredential` | MERGE `IsActive = false` on existing CRED-XXXX item | Live (S23) |
| Contracts | Returns `[]` graceful stub | Deferred — SP-02 |
| Missions | Returns `[]` graceful stub | Deferred — future sprint |
| Milestones | Returns `[]` graceful stub | Deferred — future sprint |
| Finance | Returns `[]` graceful stub | Deferred — future sprint |

### Data source modes

**Mock DSM** — demo and regression baseline. All writes are direct in-memory. No approval gate for any operation. `canCreate` capability gate applies. `deactivateCredential` is called directly on confirm; no C3Approvals record created.

**SP DSM** — beta operational path. Journey initiation, credential creation, and credential deactivation all gated by ADR-013 approval loop. Journey lifecycle transitions are direct role-gated PATCH operations. Role resolved from SP security-group membership at mount.

### SP write patterns (all active patterns)

**Sequence-generating write (APR/JRN/CRED creation) — POST-then-MERGE:**
```
1. GET /_api/contextinfo → form digest (D1)
2. POST /_api/web/lists/getbytitle('LIST')/items   Title=TMP-<base36>
3. GET /_api/contextinfo → form digest (D2)
4. POST /_api/web/lists/getbytitle('LIST')/items(ID)
   + X-HTTP-Method: MERGE + IF-MATCH: *
   Title=APR-XXXX | JRN-XXXX | CRED-XXXX
```

**Lifecycle transition write — GET-then-MERGE (journeys only):**
```
1. GET item by Title → current Status, Notes
2. isValidTransition(currentStatus, action) — throw if invalid
3. GET /_api/contextinfo → form digest
4. PATCH (MERGE + IF-MATCH: *)  { Status, [CompletedAt], Notes: ... }
```

**Credential deactivation write — GET-then-MERGE (credentials, S23):**
```
1. getCredential(credentialId) → obtain credential.Id (SP integer)
2. GET /_api/contextinfo → form digest
3. POST /_api/web/lists/getbytitle('C3Credentials')/items(<Id>)
   + X-HTTP-Method: MERGE + IF-MATCH: *
   { __metadata: { type: LIST_ITEM_TYPE }, IsActive: false }
   → 204 No Content
```

**Stamp-only write (recovery path — approvals only):**
```
1. Pre-condition check at hook invocation
2. Safety re-check at stamp time (query for target row)
3. stampExecution('Executed') — MERGE ApprovalStatus only
No new row created. No primary write repeated.
```

All requests: `credentials: 'same-origin'`. No PnP.js.

---

## Section 4 — Governance model (confirmed after Sprint 23)

### Write category matrix

| Operation | Pattern | Gate |
|-----------|---------|------|
| Initiate journey | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Add credential | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Deactivate credential | ADR-013 approval loop | Submit → Review → Approved → Execute (S23) |
| Recover journey execution stamp | Stamp-only (no new row) | Approved + active journey pre-confirmed |
| Recover credential execution stamp (add) | Stamp-only (no new row) | Approved + existing CRED row pre-confirmed |
| Recover credential deactivation stamp | Stamp-only (no re-MERGE) | Approved + inactive CRED confirmed (S23) |
| Complete/Suspend/Resume/Cancel journey | Direct role-gated PATCH | `owner` or `operations` role only |

### Role capabilities

| Role | Submit approval | Manage journey lifecycle | Deactivate credential | Approve/Reject | Execute/Recover |
|------|----------------|--------------------------|----------------------|----------------|-----------------|
| `owner` | Yes | Yes | Yes | Yes | Yes |
| `operations` | Yes | Yes | Yes | No | No |
| `management` | No | No | No | No | No |
| `hr` / `legal` / `finance` | No | No | No | No | No |
| `visitor` | No | No | No | No | No |

### Identifier format

| Entity | Format | Source |
|--------|--------|--------|
| Approval | `APR-XXXX` | SP auto-ID (C3Approvals) — zero-padded to 4 digits |
| Journey | `JRN-XXXX` | SP auto-ID (C3Journeys) — zero-padded to 4 digits |
| Credential | `CRED-XXXX` | SP auto-ID (C3Credentials) — zero-padded to 4 digits |

### Audit trail (beta state)

- Journey initiation: `C3Approvals` row (permanent record of proposal, review, execution)
- Credential creation: `C3Approvals` row (same lifecycle)
- Credential deactivation: `C3Approvals` row (OperationType: DeactivateCredential, includes reason field; S23)
- Journey lifecycle transitions: `Notes` field append with `[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]`
- Person-scoped approval history: PersonProfile Approvals tab (read-only, backed by `usePersonApprovals`)
- Dedicated audit columns (`SuspendedAt`, `CancelledAt`, etc.) deferred to Sprint 24+ schema work

---

## Section 5 — Parity baselines (confirmed Sprint 23 closeout)

| Harness | Result |
|---------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| `npm run verify:runtime` | ✓ PASS — SHA-256: `f8d7bcb6c0e61b26f480163e46e605a5fcdefa57be642abe9bfe00e4f0d68a27` |

Parity baselines unchanged from Sprint 21. No parity harnesses were modified in Sprint 23.

---

## Section 6 — What is deferred to Sprint 24 and beyond

### Credential reactivation

No `reactivateCredential` path exists. Deactivated credentials must be re-activated manually in the C3Credentials SP list. A governed `ReactivateCredential` OperationType would mirror the `DeactivateCredential` pattern. Recommended Sprint 24 Priority 3.

### Inactive credential archive/history view

Deactivated credentials are hidden from the PersonProfile credentials list (filtered by `IsActive`). There is no in-app view of a person's credential history. Depends on design decisions about credential reactivation.

### Server-side TargetPersonID filter (TD-07 + TD-19)

`listApprovals` still has no server-side `targetPersonId` filter. `usePersonApprovals` (S21-P2) works around this with client-side filtering subject to `$top=500` truncation. Recommended Sprint 24 Priority 1.

### Journey lifecycle audit columns (TD-21)

`SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` not in `C3Journeys`. Notes-append is the beta audit bridge. Recommended Sprint 24 Priority 2.

### Contracts/SP-02 (separate workstream)

FK mismatch unresolved. Returns `[]` gracefully.

### CI/CD pipeline (ongoing, TD-14)

Manual `npm run beta:runtime` + `npm run verify:runtime` + bundle commit after every change.

### Induction (planned post-beta)

`INDUCTION-01` recorded in backlog addendum. All dependencies (Missions, Finance, Milestones live in SP DSM) must be live before Induction can be built.

---

## Section 7 — File inventory (Sprint 23 additions and modifications)

| File | Status | Notes |
|------|--------|-------|
| `packages/c3/src/services/interfaces/approvalPayloads.ts` | Modified | `DeactivateCredentialApprovalPayload` added; `ApprovalPayload` union widened |
| `packages/c3/src/services/interfaces/IApprovalsService.ts` | Modified | `operationType` union widened to include `DeactivateCredential` |
| `packages/c3/src/hooks/queryKeys.ts` | Modified | `credential.byId(credentialId)` query key group added |
| `packages/c3/src/services/sharepoint/SharePointCredentialService.ts` | Modified | `deactivateCredential` MERGE implementation; `getCredential` used by deactivation path |
| `packages/c3/src/hooks/useGetCredential.ts` | New | Single-credential query hook; no IsActive filter; recovery detection |
| `packages/c3/src/hooks/useSubmitDeactivationApproval.ts` | New | Mode-branching deactivation submission: Mock direct / SP ADR-013 |
| `packages/c3/src/hooks/useExecuteApproval.ts` | Modified | DeactivateCredential dispatch; `CredentialAlreadyInactiveError`; `PartialDeactivationExecutionError` |
| `packages/c3/src/hooks/useRecoverDeactivationExecutionStamp.ts` | New | Stamp-only recovery for `PartialDeactivationExecutionError` |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | Deactivate button on credential rows (owner/ops gate); confirm dialog with required reason |
| `packages/c3/src/screens/ApprovalInbox.tsx` | Modified | DeactivateCredential payload summary; recovery detection; recovery UX; execute toast |
| `packages/c3/src/utils/approvalPayloadUtils.ts` | Modified | `DeactivateCredential` case in `formatApprovalPayloadSummary` |
| `docs/architecture/C3 Error Library.md` | Modified | ERR-020 (`CredentialAlreadyInactiveError`), ERR-021 (`PartialDeactivationExecutionError`) added |
| `docs/architecture/C3 Tech Debt Register.md` | Modified | TD-20 resolved (S23-P1); Resolved Items table updated |
| `docs/architecture/C3 Architecture Baseline — Sprint 21.md` | Modified | S23-P1 amendment callout; Section 3/4/6/7 updated |
| `docs/architecture/C3 Beta Checkpoint — Sprint 21.md` | Modified | Part 14 caveat updated; Part 16 (deactivation checklist) added |
| `docs/architecture/Sprint 23 Closeout Report.md` | New | This sprint's closeout |
| `docs/architecture/C3 Architecture Baseline — Sprint 23.md` | New | This document |
| `docs/architecture/C3 Beta Checkpoint — Sprint 23.md` | New | Superseding Sprint 21 checkpoint |
