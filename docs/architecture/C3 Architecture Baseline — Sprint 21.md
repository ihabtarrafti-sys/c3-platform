# C3 Architecture Baseline — Sprint 21
**C3 Contract Control Center**
**Sprint:** 21 — Credential Recovery, Approval Visibility, and Beta Tooling
**Baseline date:** 2026-07-01
**Last updated:** 2026-07-01 (S23-P1 amendment)
**Status:** CLOSED — 2026-07-01 (amended S23-P1)

---

## Closeout statement

Sprint 21 closes as:

> **"C3 now supports two governed operational write paths through ADR-013: Journey initiation (live since Sprint 18) and Credential creation (live Sprint 20). Both write paths have in-app partial execution recovery UX (S20-P2 for journeys, S21-P1 for credentials). C3Approvals is both the governance trail for ADR-013 operations and the person-scoped audit source — PersonProfile now surfaces the complete approval history for a given individual in a read-only Approvals tab. ApprovalInbox remains the sole action surface; PersonProfile Approvals tab is display-only. Payload summaries use human-readable labels throughout (CREDENTIAL_TYPE_LABELS). The runtime bundle workflow is now a single combined build/copy command (beta:runtime) with SHA-256 hash verification (verify:runtime). SP DSM is the beta operational path. Mock DSM remains the demo and regression baseline."**

---

> **Sprint 23 Phase 1 amendment (2026-07-01):** Credential deactivation (previously deferred) is now live. `deactivateCredential` is implemented as a governed ADR-013 path (Sections 3, 4, 6 and 7 updated below). TD-20 resolved. ERR-020 and ERR-021 added to C3 Error Library. Beta Checkpoint Part 14 caveat updated.

---

## Section 1 — Architectural shifts introduced in Sprint 21

### Before Sprint 21 (Sprint 20 baseline)

- `PartialCredentialExecutionError` (CRED row created, Executed stamp failed) required manual SP intervention — there was no in-app recovery path. This was the open caveat noted in TD-13 (S20) and the S20 Beta Checkpoint.
- PersonProfile had two tabs: Profile and Readiness. There was no person-scoped approval history surface. To see approval activity for a given person, an operator had to scan the entire ApprovalInbox.
- `formatApprovalPayloadSummary` rendered credential type as the raw SP choice key (e.g. `LeagueRegistration`). Human-readable labels were available in `CREDENTIAL_TYPE_LABELS` but not applied.
- `AddCredentialPanel` did not warn when expiry date was earlier than issue date.
- Runtime bundle build and copy were two separate manual commands; no verification step existed.

### After Sprint 21

**1. Credential partial execution recovery (Phase 1)**

`useRecoverCredentialExecutionStamp` is a stamp-only mutation hook parallel to `useRecoverExecutionStamp` (S20-P2 for journeys). It never calls `addCredential`. Pre-condition guards run at hook invocation; a safety re-check of `C3Credentials` (by PersonID + CredentialType) runs at stamp time to guard against races.

`ApprovalInbox` detects Approved + AddCredential cards lazily: a credential existence query runs only for recovery candidates. If a matching CRED row is found, the Execute button is replaced by "Recover Execution Stamp" (warning-coloured) with an explanatory MessageBar. Normal Execute behaviour is unchanged for non-recovery-candidate cards.

If the CRED row is absent at stamp time, `CredentialRecoveryTargetMissingError` is thrown and no write is attempted. This mirrors `RecoveryTargetMissingError` for the journey recovery path.

**2. Person-scoped approval history in PersonProfile (Phase 2)**

`usePersonApprovals` fetches all 6 approval statuses using the same `['approvals', 'all']` query key as ApprovalInbox. This means a single SP fetch is shared between both surfaces when they are mounted simultaneously. Client-side filtering by `targetPersonId` partitions results into `{ active, history }`:

- `active`: Submitted, InReview, Approved, ExecutionFailed — records that need attention
- `history`: Executed, Rejected — terminal records for audit

`PersonApprovalHistoryCard` renders both sections with title, operationType badge, status badge, and formatted payload summary. Rejection reason, execution error, and executedAt are surfaced on relevant rows. No action buttons are rendered — ApprovalInbox remains the sole action surface.

PersonProfile now has three tabs: Profile, Readiness, Approvals. The Approvals tab is accessible to `owner` and `operations` roles.

**3. Credential type label humanization (Phase 3)**

`approvalPayloadUtils.ts` — `formatApprovalPayloadSummary` — now looks up `CREDENTIAL_TYPE_LABELS` for `credentialType` in `AddCredential` payloads. The raw SP choice key is the fallback for forward-compat safety (unknown types are not silently dropped). The same lookup is applied in `ApprovalInbox.handleExecute` success toast.

**4. Date-order advisory warning (Phase 3)**

`AddCredentialPanel` computes `isDateOrderWarning = expiryDate.length > 0 && issueDate.length > 0 && expiryDate < issueDate` (string comparison valid for ISO YYYY-MM-DD). When true, a Fluent UI `MessageBar` with `intent="warning"` is rendered between the Issue Date and Issued By fields. Submit is not blocked — intentional ordering is allowed.

**5. Runtime bundle automation (Phase 4)**

`npm run beta:runtime` combines `build:c3-runtime` and `copy:c3-runtime` into a single command. `npm run verify:runtime` runs `scripts/verify-c3-runtime.mjs`, which:
- Confirms `packages/c3/dist-runtime/c3-runtime.js` and `packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js` both exist and are non-empty
- Computes SHA-256 of each file via `node:crypto` and confirms they match
- Exits 0 on PASS, exits 1 on any failure

Manual `git add ... && git commit` is still required. No auto-commit.

---

## Section 2 — New components delivered in Sprint 21

### useRecoverCredentialExecutionStamp.ts

`packages/c3/src/hooks/useRecoverCredentialExecutionStamp.ts`

TanStack Query `useMutation`. Stamp-only recovery for `PartialCredentialExecutionError` cases. Never creates a new credential. Pre-conditions: `approvalStatus === 'Approved'`, `operationType === 'AddCredential'`, parseable `holderPersonId` + `credentialType` in payload. Safety re-check: queries `C3Credentials` for a row matching `PersonID` + `CredentialType` at stamp time. Exported error classes: `CredentialRecoveryPreConditionError`, `CredentialRecoveryTargetMissingError`. `onSuccess` invalidates `approvals.all()`, `person.credentials`, `credentials.all`.

### usePersonApprovals.ts

`packages/c3/src/hooks/usePersonApprovals.ts`

TanStack Query `useQuery`. Fetches all 6 approval statuses under query key `['approvals', 'all']` (shared with ApprovalInbox). Filters client-side by `targetPersonId`. Returns `{ approvals, active, history, isLoading, error }` where `active` = actionable statuses and `history` = terminal statuses.

### approvalPayloadUtils.ts

`packages/c3/src/utils/approvalPayloadUtils.ts`

Pure utility module. `formatApprovalPayloadSummary(operationType, payloadJson)` — safely parses serialised payload JSON and returns a compact human-readable summary string. Handles `InitiateJourney` and `AddCredential` operation types. Malformed JSON returns `'(malformed payload)'`. For `AddCredential`, `credentialType` is looked up in `CREDENTIAL_TYPE_LABELS`; falls back to raw key.

### PersonApprovalHistoryCard.tsx

`packages/c3/src/components/shared/PersonApprovalHistoryCard.tsx`

Read-only React component. Renders approval history for a given person in two sections — Active (needs attention) and History (terminal). Each row: title, operationType chip, status badge, formatted payload summary. Rejection reason, execution error, and executedAt surfaced on relevant rows. Zero action buttons — display only. Consumed by PersonProfile Approvals tab.

### scripts/verify-c3-runtime.mjs

`scripts/verify-c3-runtime.mjs`

Node.js ESM script (no external dependencies). Reads both bundle files, computes SHA-256 via `node:crypto`, compares hashes. Prints file sizes (KB/MB), modified timestamps (UTC), full SHA-256 hashes, and a PASS/FAIL banner. Exits 0 on PASS, exits 1 on any failure.

---

## Section 3 — Runtime architecture (confirmed state after Sprint 21)

### SharePoint service registry

| Service | SP mode behaviour | State after S21 |
|---------|-------------------|-----------------|
| Role resolution | `/_api/web/currentUser/groups` → C3 role at mount | Live (S19) |
| Approvals — `createApproval` | POST-then-MERGE → APR-XXXX; supports `InitiateJourney` + `AddCredential` | Live (S18, extended S20) |
| Approvals — `listApprovals` | Reads C3Approvals — all statuses; `$top=500` client-side filter in usePersonApprovals (S21-P2) | Live (S18) |
| Approvals — `patchApprovalStatus` | MERGE Approve/Reject | Live (S18) |
| Approvals — `stampExecution` | MERGE Executed/ExecutionFailed | Live (S18) |
| Journeys (read) | Reads C3Journeys | Live (S17) |
| Journeys — `initiateJourney` | POST-then-MERGE → JRN-XXXX | Live (S18, hardened S19) |
| Journeys — lifecycle transitions | GET→guard→PATCH | Live (S19) |
| People | Reads C3People | Live (S16) |
| Credentials (read) | Reads C3Credentials | Live (S15) |
| Credentials — `addCredential` | POST-then-MERGE → CRED-XXXX | Live (S20) |
| Credentials — `deactivateCredential` | MERGE `IsActive = false` on existing CRED-XXXX item | Live (S23-P1) |
| Contracts | Returns `[]` graceful stub | Deferred — SP-02 |
| Missions | Returns `[]` graceful stub | Deferred — future sprint |
| Milestones | Returns `[]` graceful stub | Deferred — future sprint |
| Finance | Returns `[]` graceful stub | Deferred — future sprint |

### Data source modes

**Mock DSM** — demo and regression baseline. All writes are direct in-memory. No approval gate. All write surfaces visible (role-gated only). `canCreate` capability gate applies.

**SP DSM** — beta operational path. Journey initiation, credential creation, and credential deactivation gated by ADR-013 approval loop. Journey lifecycle transitions are direct role-gated PATCH operations. Role resolved from SP security-group membership at mount. PersonProfile Approvals tab powered by `usePersonApprovals` (shared cache with ApprovalInbox).

### C3Approvals — dual role

After Sprint 21, `C3Approvals` serves two distinct purposes:

1. **ADR-013 governance trail** — each approval record represents a governed operation proposal, its review, and its execution outcome. Consumed by `ApprovalInbox` (action surface).
2. **Person-scoped audit source** — `usePersonApprovals` filters by `targetPersonId` client-side; `PersonApprovalHistoryCard` renders the person's complete approval history in read-only form. No action buttons.

These two surfaces share the same TanStack Query cache (`['approvals', 'all']`) to avoid duplicate SP fetches.

### SP write patterns

Unchanged from Sprint 20:

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

**Stamp-only write (recovery path — approvals only):**
```
1. Pre-condition check at hook invocation
2. Safety re-check at stamp time (query for target row)
3. stampExecution('Executed') — MERGE ApprovalStatus only
No new row created.
```

All requests: `credentials: 'same-origin'`. No PnP.js.

---

## Section 4 — Governance model (confirmed after Sprint 21)

### Write category matrix

| Operation | Pattern | Gate |
|-----------|---------|------|
| Initiate journey | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Add credential | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Recover journey execution stamp | Stamp-only (no new row) | Approved + active journey pre-confirmed |
| Recover credential execution stamp | Stamp-only (no new row) | Approved + existing CRED row pre-confirmed |
| Complete/Suspend/Resume/Cancel journey | Direct role-gated PATCH | `owner` or `operations` role only |
| Deactivate credential | ADR-013 approval loop | Submit → Review → Approved → Execute (S23-P1) |

### Role capabilities

| Role | Submit approval | Manage journey lifecycle | Approve/Reject | Execute/Recover |
|------|----------------|--------------------------|----------------|-----------------|
| `owner` | Yes (`canCreate`) | Yes | Yes | Yes |
| `operations` | Yes (`canCreate`) | Yes | No | No |
| `management` | No | No | No | No |
| `hr` / `legal` / `finance` | No | No | No | No |
| `visitor` | No | No | No | No |

### Identifier format

| Entity | Format | Source |
|--------|--------|--------|
| Approval | `APR-XXXX` | SP auto-ID (C3Approvals) — zero-padded to 4 digits |
| Journey | `JRN-XXXX` | SP auto-ID (C3Journeys) — zero-padded to 4 digits |
| Credential | `CRED-XXXX` | SP auto-ID (C3Credentials) — zero-padded to 4 digits |

### Audit trail (beta state)

- Journey initiation: `C3Approvals` row (permanent record of proposal, review, execution)
- Credential creation: `C3Approvals` row (same lifecycle)
- Credential deactivation: `C3Approvals` row (OperationType: DeactivateCredential, S23-P1)
- Journey lifecycle transitions: `Notes` field append with `[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]`
- Person-scoped approval history: PersonProfile Approvals tab (read-only, backed by `usePersonApprovals`)
- Dedicated audit columns (`SuspendedAt`, `CancelledAt`, etc.) deferred to Sprint 22+ schema work

---

## Section 5 — Parity baselines (confirmed Sprint 21 closeout)

| Harness | Result |
|---------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| `npm run beta:runtime` | ✓ 1,818 KB bundle |
| `npm run verify:runtime` | ✓ PASS — SHA-256 match |

Parity baselines unchanged from Sprint 20.

---

## Section 6 — What is deferred to Sprint 22 and beyond

### ~~Credential deactivation (Sprint 22)~~ — DELIVERED in Sprint 23 Phase 1

`deactivateCredential` is live. MERGE pattern on existing CRED-XXXX row. Full ADR-013 approval loop: PersonProfile Deactivate button → C3Approvals (DeactivateCredential) → ApprovalInbox Execute → IsActive MERGE + stamp. Partial execution recovery via `useRecoverDeactivationExecutionStamp`. See TD-20 (resolved).

### Server-side TargetPersonID filter (Sprint 22)

`listApprovals` has no server-side `targetPersonId` filter. `usePersonApprovals` (S21-P2) works around this with client-side filtering but is subject to the `$top=500` truncation risk (TD-19). Resolving TD-07 closes TD-19.

### Journey lifecycle audit columns (Sprint 22, schema change)

`SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` not in `C3Journeys`. Notes-append is the beta audit bridge.

### Contracts/SP-02 (separate workstream)

FK mismatch unresolved. Returns `[]` gracefully.

### CI/CD pipeline (ongoing)

TD-14. Manual `npm run beta:runtime` + `npm run verify:runtime` + bundle commit after every change. Not in sprint sequence.

### Induction (planned post-beta)

`INDUCTION-01` recorded in backlog addendum. All dependencies (Missions, Finance, Milestones live in SP DSM) must be live before Induction can be built.

---

## Section 7 — File inventory (Sprint 21 additions and modifications)

| File | Status | Notes |
|------|--------|-------|
| `packages/c3/src/hooks/useRecoverCredentialExecutionStamp.ts` | New | Stamp-only recovery for PartialCredentialExecutionError |
| `packages/c3/src/screens/ApprovalInbox.tsx` | Modified (major) | Credential recovery candidate detection + UX; execute toast humanization |
| `packages/c3/src/hooks/usePersonApprovals.ts` | New | Person-scoped approval history hook |
| `packages/c3/src/utils/approvalPayloadUtils.ts` | New + extended | formatApprovalPayloadSummary; CREDENTIAL_TYPE_LABELS lookup (S21-P3) |
| `packages/c3/src/components/shared/PersonApprovalHistoryCard.tsx` | New | Read-only approval history component |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | Third Approvals tab |
| `packages/c3/src/components/shared/AddCredentialPanel.tsx` | Modified | Date-order advisory MessageBar |
| `package.json` (root) | Modified | beta:runtime + verify:runtime scripts |
| `scripts/verify-c3-runtime.mjs` | New | SHA-256 bundle verification script |
| `docs/architecture/C3 Beta Checkpoint — Sprint 20.md` | Modified | Items 12.11–12.14, Part 15, Part 14 caveat, validation commands |
| `docs/architecture/C3 Tech Debt Register.md` | Modified | TD-19 added; TD-15 S21-P4 annotation; header date |
| `docs/architecture/C3 Product Roadmap and Backlog Expansion Addendum.md` | Modified | INDUCTION-01 recorded |
| `docs/architecture/Sprint 21 Closeout Report.md` | New | Sprint closeout |
| `docs/architecture/C3 Architecture Baseline — Sprint 21.md` | New | This document |
| `docs/architecture/C3 Beta Checkpoint — Sprint 21.md` | New | Active beta validation checklist (supersedes Sprint 20) |
| `packages/c3-spfx-host/src/.../c3-runtime.js` | Modified | Rebuilt after Phase 1, Phase 2, and Phase 3 |

### Sprint 23 Phase 1 additions and modifications

| File | Status | Notes |
|------|--------|-------|
| `packages/c3/src/services/interfaces/approvalPayloads.ts` | Modified | `DeactivateCredentialApprovalPayload` + widened `ApprovalPayload` union |
| `packages/c3/src/services/interfaces/IApprovalsService.ts` | Modified | `operationType` union widened to include `DeactivateCredential` |
| `packages/c3/src/hooks/queryKeys.ts` | Modified | `credential.byId(credentialId)` query key group added |
| `packages/c3/src/services/sharepoint/SharePointCredentialService.ts` | Modified | `deactivateCredential` MERGE implementation (TD-20 resolved) |
| `packages/c3/src/hooks/useGetCredential.ts` | New | Single-credential query hook; no IsActive filter; used for deactivation recovery detection |
| `packages/c3/src/hooks/useSubmitDeactivationApproval.ts` | New | Mode-branching submission hook: Mock DSM direct / SP DSM approval |
| `packages/c3/src/hooks/useExecuteApproval.ts` | Modified | DeactivateCredential dispatch branch; `CredentialAlreadyInactiveError`; `PartialDeactivationExecutionError` |
| `packages/c3/src/hooks/useRecoverDeactivationExecutionStamp.ts` | New | Stamp-only recovery for `PartialDeactivationExecutionError` |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | Deactivate button on credential rows (owner/ops gate); confirm dialog with required reason |
| `packages/c3/src/screens/ApprovalInbox.tsx` | Modified | DeactivateCredential payload summary; recovery detection; recovery UX; execute toast |
| `packages/c3/src/utils/approvalPayloadUtils.ts` | Modified | `DeactivateCredential` case in `formatApprovalPayloadSummary` |
| `docs/architecture/C3 Error Library.md` | Modified | ERR-020, ERR-021 added |
| `docs/architecture/C3 Tech Debt Register.md` | Modified | TD-20 resolved (S23-P1) |
| `docs/architecture/C3 Beta Checkpoint — Sprint 21.md` | Modified | Part 14 caveat updated; Part 16 added |
