# Sprint 21 Closeout Report — Credential Recovery, Person-Centered Approval Visibility, and Runtime Automation
**C3 Contract Control Center**
**Sprint:** 21 — Credential Recovery, Approval Visibility, and Beta Tooling
**Closeout date:** 2026-07-01
**Status:** CLOSED
**Preceding sprint:** Sprint 20 CLOSED (Approval History, Partial Execution Recovery, Governed Credential Write Path)
**Validation baseline:** All parity harnesses pass, tsc clean, hosted SP DSM validation confirmed

---

## Closeout statement

Sprint 21 closes as:

> **"C3 now recovers from PartialCredentialExecutionError in-app: an Approved AddCredential card where a matching CRED row already exists is detected and resolved via a stamp-only recovery path, without creating a duplicate credential. PersonProfile now has a third tab — Approvals — that shows the complete approval history for a given person: active approvals needing attention alongside executed, rejected, and failed historical records. All payload summaries use human-readable credential type labels (e.g. 'League Registration' not 'LeagueRegistration'). An advisory date-order warning appears in AddCredentialPanel when expiry is before issue date. The runtime bundle build/copy workflow is now a single command (npm run beta:runtime) and SHA-256 verification is available (npm run verify:runtime). Induction is recorded as a planned post-beta capability with no implementation authorised. SP DSM remains the beta operational path. Mock DSM remains the demo and regression baseline."**

Sprint 21 does **not** close as:

> ~~"Journey lifecycle audit columns (SuspendedAt/CancelledAt) are provisioned."~~
> ~~"Credential deactivation is implemented."~~
> ~~"Server-side targetPersonId filter is added to listApprovals."~~
> ~~"Contracts/SP-02 are resolved."~~
> ~~"CI/CD pipeline is in place."~~
> ~~"Induction is implemented."~~

---

## Sprint objective

Five-phase sprint hardening the beta operational surface around credential governance, surfacing approval visibility at the person level, and reducing manual error surface in the runtime bundle workflow.

---

## Completed phases

### Phase 0 — Induction recorded as planned post-beta capability

**Commit:** `2d584ac` docs(backlog): Record Induction as planned post-beta capability

**Scope:** `docs/architecture/C3 Product Roadmap and Backlog Expansion Addendum.md`

- `INDUCTION-01` entry added to the backlog addendum
- Describes Induction as a guided orchestration workflow (not a screen replacement) — takes a person from intake to operational readiness by sequencing existing screens and services
- All dependencies listed (People, Credentials, Journeys, Readiness live in SP DSM)
- Explicitly states: no new SP lists, no schema changes, no bypass of ADR-013 approval loop
- Status: planning only; no implementation authorised

---

### Phase 1 — AddCredential partial execution recovery UX

**Commits:** `020279a` (source), `c82794d` (bundle)

**Scope:** New hook, ApprovalInbox extension

- `useRecoverCredentialExecutionStamp.ts` (new, 214 lines): stamp-only mutation hook for `PartialCredentialExecutionError` recovery
  - Pre-condition guards: `approvalStatus === 'Approved'`, `operationType === 'AddCredential'`, parseable `holderPersonId` and `credentialType` in payload
  - Safety re-check at stamp time: queries `C3Credentials` for a row matching `PersonID` + `CredentialType`
  - CRED row present → calls `stampExecution('Executed')` only; no new credential created
  - CRED row absent → throws `CredentialRecoveryTargetMissingError` (no write)
  - `onSuccess` invalidation: `approvals.all()`, `person.credentials`, `credentials.all`
  - Exported error classes: `CredentialRecoveryPreConditionError`, `CredentialRecoveryTargetMissingError`
- `ApprovalInbox.tsx` extended: for Approved + AddCredential cards, a credential existence check runs lazily; if a matching CRED row is detected, Execute button is replaced by "Recover Execution Stamp" (warning-coloured) with explanatory MessageBar
- Parallel to `useRecoverExecutionStamp` (journey recovery, S20-P2); same detection and stamp pattern adapted for credentials
- TD-13 caveat (no in-app credential recovery) resolved; PartialCredentialExecutionError recovery path now live

**Files changed:**
- `packages/c3/src/hooks/useRecoverCredentialExecutionStamp.ts` — new (214 lines)
- `packages/c3/src/screens/ApprovalInbox.tsx` — credential recovery candidate detection and UX (168 insertions, 16 deletions)

---

### Phase 2 — Person-scoped approval history in PersonProfile

**Commits:** `16c8b39` (source), `7a20cda` (bundle)

**Scope:** New hook, new utility, new component, PersonProfile tab

- `usePersonApprovals.ts` (new, 72 lines): fetches all 6 approval statuses (shared query key with ApprovalInbox), filters client-side by `targetPersonId`
  - Query key: `['approvals', 'all']` — shared with `ApprovalInbox` to avoid duplicate SP fetches when both screens are mounted
  - Returns `{ active, history }` partitioned views: `active` = Submitted / InReview / Approved / ExecutionFailed; `history` = Executed / Rejected
- `approvalPayloadUtils.ts` (new, 74 lines): `formatApprovalPayloadSummary(operationType, payload)` — safe parse of serialised payload JSON; returns a human-readable one-line summary for `InitiateJourney` and `AddCredential`; malformed JSON returns `'(malformed payload)'`
- `PersonApprovalHistoryCard.tsx` (new, 311 lines): read-only approval history component
  - Active / History section layout
  - Each row: title, operationType badge, status badge, formatted payload summary
  - Rejection reason, execution error, executedAt surfaced on relevant rows
  - No Approve / Reject / Execute / Recover action buttons — display only
- `PersonProfile.tsx` extended: third "Approvals" tab wired to `usePersonApprovals(person.PersonID)`; accessible to owner and operations roles

**Files changed:**
- `packages/c3/src/hooks/usePersonApprovals.ts` — new (72 lines)
- `packages/c3/src/utils/approvalPayloadUtils.ts` — new (74 lines)
- `packages/c3/src/components/shared/PersonApprovalHistoryCard.tsx` — new (311 lines)
- `packages/c3/src/screens/PersonProfile.tsx` — Approvals tab (10 insertions, 1 deletion)

---

### Phase 3 — Credential approval UX hardening and negative-path checklist

**Commits:** `d7068bd` (source + docs), `e226257` (bundle)

**Scope:** Label humanization, date-order warning, beta checklist and tech debt updates

- `approvalPayloadUtils.ts` extended: `formatApprovalPayloadSummary` now looks up `CREDENTIAL_TYPE_LABELS` for `credentialType` in `AddCredential` payloads — returns "League Registration" not "LeagueRegistration"; falls back to raw key for forward-compat safety
- `ApprovalInbox.tsx`: `handleExecute` success toast for AddCredential now uses the same label lookup — "League Registration credential registered for PER-XXXX"
- `AddCredentialPanel.tsx`: non-blocking advisory `MessageBar` added between Issue Date and Issued By fields — warns when expiry date is before issue date; submit is not blocked (intentional ordering is allowed)
- `C3 Beta Checkpoint — Sprint 20.md`: items 12.11–12.14 added (AddCredential execution negative paths); Part 15 added (PersonProfile Approvals Tab checklist, 15.1–15.6)
- `C3 Tech Debt Register.md`: TD-19 added (`$top=500` truncation risk in person-scoped approval history — latent, not a beta concern)

**Files changed:**
- `packages/c3/src/utils/approvalPayloadUtils.ts` — CREDENTIAL_TYPE_LABELS lookup (27 insertions, 3 deletions)
- `packages/c3/src/screens/ApprovalInbox.tsx` — execute toast humanization (9 insertions, 1 deletion)
- `packages/c3/src/components/shared/AddCredentialPanel.tsx` — date order warning (15 insertions)
- `docs/architecture/C3 Beta Checkpoint — Sprint 20.md` — items 12.11–12.14, Part 15 (65 insertions)
- `docs/architecture/C3 Tech Debt Register.md` — TD-19 (23 insertions)

---

### Phase 4 — Beta runtime automation

**Commit:** `22c9a5e` chore(s21-phase-4): Add beta runtime verification scripts

**Scope:** Root package.json scripts, new verification script, docs

- `beta:runtime` script added to root `package.json`: `npm run build:c3-runtime && npm run copy:c3-runtime` — replaces the two-step manual workflow with a single command
- `verify:runtime` script added: `node scripts/verify-c3-runtime.mjs`
- `scripts/verify-c3-runtime.mjs` (new, 126 lines): checks dist-runtime build output and tracked SPFx host asset
  - Both files must exist and be non-empty
  - SHA-256 hashes must match (computed via `node:crypto`)
  - Prints file sizes, modified timestamps (UTC), full SHA-256 hashes
  - Exits 0 on PASS, exits 1 on any failure
  - Uses `node:fs`, `node:path`, `node:crypto` only — no external dependencies
- `C3 Beta Checkpoint — Sprint 20.md`: Part 14 caveat row updated; Validation section prepended with runtime bundle steps (beta:runtime, verify:runtime, manual git commit)
- `C3 Tech Debt Register.md`: TD-15 annotated with S21-P4 partial mitigation; dual-commit pattern and tracked bundle remain open until TD-14 (CI/CD)

**Files changed:**
- `package.json` — 2 scripts added
- `scripts/verify-c3-runtime.mjs` — new (126 lines)
- `docs/architecture/C3 Beta Checkpoint — Sprint 20.md` — runtime caveat + validation commands
- `docs/architecture/C3 Tech Debt Register.md` — TD-15 partial mitigation note

---

## Commit summary

| Hash | Phase | Type | Description |
|------|-------|------|-------------|
| `2d584ac` | Phase 0 | docs | Record Induction as planned post-beta capability |
| `020279a` | Phase 1 | feat | Add AddCredential partial execution recovery UX |
| `c82794d` | Phase 1 | build | Update SPFx runtime bundle after credential recovery UX |
| `16c8b39` | Phase 2 | feat | Add person-scoped approval history to PersonProfile |
| `7a20cda` | Phase 2 | build | Update SPFx runtime bundle after profile approval history |
| `d7068bd` | Phase 3 | fix | Harden credential approval UX and beta checklist |
| `e226257` | Phase 3 | build | Update SPFx runtime bundle after credential UX hardening |
| `22c9a5e` | Phase 4 | chore | Add beta runtime verification scripts |

HEAD at time of closeout: `22c9a5e`
Preceding sprint (S20) HEAD: `b77c5d6`

---

## Validation summary

All validation performed at closeout (HEAD: `22c9a5e`).

| Validation | Result |
|------------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| `npm run beta:runtime` | ✓ 1,818 KB bundle built and copied |
| `npm run verify:runtime` | ✓ PASS — SHA-256: `9db652c0...` on both files |

Parity baselines unchanged from Sprint 20. No parity harnesses were modified in Sprint 21.

---

## Hosted SP DSM validation summary

All live validation performed against hosted workbench (same-origin fetch, SP DSM, `dataSrc=sharepoint`).

| Scenario | Result |
|----------|--------|
| AddCredential recovery candidate detected (Approved + existing CRED row) | ✓ "Recover Execution Stamp" button replaces Execute |
| AddCredential recovery — stamp path | ✓ Approval stamped Executed; no duplicate CRED row created |
| AddCredential recovery — CredentialRecoveryTargetMissingError | ✓ Toast shown; no write attempted |
| PersonProfile Approvals tab visible (owner/operations role) | ✓ Third tab renders |
| PersonProfile Approvals — Active section (pending approvals) | ✓ Submitted/InReview/Approved/ExecutionFailed cards shown |
| PersonProfile Approvals — History section | ✓ Executed/Rejected records shown with audit fields |
| PersonProfile Approvals — payload labels humanized | ✓ "League Registration" not "LeagueRegistration" |
| PersonProfile Approvals — no action buttons | ✓ Zero Approve/Reject/Execute/Recover buttons in tab |
| ApprovalInbox execute toast — humanized label | ✓ "League Registration credential registered for PER-XXXX" |
| AddCredentialPanel — date order warning | ✓ Advisory MessageBar shown when expiry < issue; submit not blocked |
| npm run beta:runtime | ✓ 1,818 KB bundle built; no error |
| npm run verify:runtime | ✓ SHA-256 match confirmed |
| All S20 paths (journey initiation, approval loop, lifecycle) | ✓ No regression |
| Mock DSM — all paths intact | ✓ Direct credential write unchanged |

---

## SharePoint lists involved

| List | Role in Sprint 21 | Schema change |
|------|-------------------|---------------|
| `C3Approvals` | Source for person-scoped approval history (usePersonApprovals); recovery detection | None |
| `C3Credentials` | Recovery detection: queried to check for existing CRED row before recovery stamp | None |
| `C3Journeys` | Read-only in Sprint 21 | None |
| `C3People` | Read-only in Sprint 21 | None |

**No SP schema changes were made in Sprint 21.**

---

## Governed operations now supported

| Operation | Trigger | SP write |
|-----------|---------|----------|
| Initiate Onboarding Journey | StartJourneyPanel → Submit for Approval | C3Approvals (APR-XXXX) → C3Journeys (JRN-XXXX) on execution |
| Add Credential | AddCredentialPanel → Submit for Approval | C3Approvals (APR-XXXX) → C3Credentials (CRED-XXXX) on execution |

Both operations:
- Follow `Submitted → InReview → Approved → Executed` lifecycle through C3Approvals
- Use POST-then-MERGE for atomic identifier generation
- Require Platform Owner approval before execution
- Appear in the Approval Inbox with `PayloadSummary` rendering human-readable payload fields
- Appear in PersonProfile Approvals tab with `PersonApprovalHistoryCard` rendering

---

## Recovery UX now supported

| Failure mode | Recovery path | Sprint delivered |
|---|---|---|
| Journey execution stamp failure (`PartialExecutionError`) | `useRecoverExecutionStamp` — stamp-only, no new journey created | S20 Phase 2 |
| Credential execution stamp failure (`PartialCredentialExecutionError`) | `useRecoverCredentialExecutionStamp` — stamp-only, no new credential created | S21 Phase 1 |

Both recovery paths:
- Replace the Execute button with a warning-coloured Recover button when the failure condition is detected
- Perform stamp-only writes — they never create new SP rows
- Guard against race conditions at stamp time (re-check before writing)
- Throw a `RecoveryTargetMissingError` variant if the target row disappears between detection and recovery

---

## PersonProfile surfaces (after Sprint 21)

| Tab | Content | Action surface |
|-----|---------|----------------|
| Profile | Person details, credentials, journey card | Lifecycle actions, Add Credential, Start Journey |
| Readiness | Obligation completion status | Resolve Obligation (Add Credential path) |
| Approvals | Active and historical approvals for this person | Read-only — no action buttons |

The Approvals tab is backed by `usePersonApprovals` (shared cache with ApprovalInbox) and renders via `PersonApprovalHistoryCard`. Visible to `owner` and `operations` roles.

---

## Runtime automation (after Sprint 21)

| Command | Purpose |
|---------|---------|
| `npm run beta:runtime` | Build runtime bundle + copy to SPFx host asset in one step |
| `npm run verify:runtime` | Confirm dist-runtime and SPFx asset exist, are non-empty, and have identical SHA-256 hashes |

Manual `git add .../c3-runtime.js && git commit` is still required after `beta:runtime`. Auto-commit is out of scope.

---

## Induction — planned post-beta capability

Recorded in `docs/architecture/C3 Product Roadmap and Backlog Expansion Addendum.md` as `INDUCTION-01`.

Induction is a guided orchestration workflow that sequences existing C3 screens (People, Contracts, Credentials, Readiness, Missions) in a defined operator flow from intake to operational readiness. It is UI-only orchestration — no new SP lists, no schema changes, no ADR-013 bypass.

**Status:** Planning only. No implementation authorised. All dependencies (Missions, Finance, Milestones live in SP DSM) must be in place before Induction can be built.

---

## Scope boundaries preserved

The following were not touched at any point during Sprint 21:

- No C3Approvals, C3Journeys, C3People, or C3Credentials schema changes
- No journey lifecycle transition changes
- No Contracts, Missions, Finance, Milestones, or credential deactivation
- No Power Automate flows
- No CI/CD pipeline
- No auto-commit scripts
- Mock DSM unchanged — all paths intact for demo/regression

---

## Tech debt items introduced in Sprint 21

| ID | Item | Status |
|----|------|--------|
| TD-19 | `$top=500` truncation risk in person-scoped approval history (`usePersonApprovals` client-side filter) | Open — latent risk; not a beta concern |

**TD-15 partial mitigation (S21-P4):** `beta:runtime` and `verify:runtime` reduce the manual error surface for runtime bundle management. The underlying debt (tracked bundle, repo bloat) remains open until TD-14 (CI/CD) is resolved.

---

## Remaining known limitations

| Limitation | Risk |
|------------|------|
| Manual runtime bundle commit still required | Medium — `beta:runtime` + `verify:runtime` reduce error surface but do not remove the requirement |
| No CI/CD (TD-14) | Medium — validation is manual throughout |
| Runtime build artifacts committed to git (TD-15) | Low — repo bloat; mitigated S21-P4 |
| `$top=500` truncation in person-scoped approval history (TD-19) | Latent — not a beta concern |
| `deactivateCredential` not implemented | Functional gap |
| Contracts/SP-02 not resolved | Functional gap |
| Missions/Finance not in SP DSM | Functional gap |
| Induction not implemented | Planned post-beta |
| Amendments hidden in SP DSM | Known — NavRail gate in place |
| No server-side TargetPersonID filter on `listApprovals` (TD-07) | Latent — client-side workaround in place |
| Journey lifecycle audit columns (SuspendedAt/CancelledAt) not provisioned | Notes-append remains audit trail |

---

## Recommended Sprint 22 focus

### Priority 1 — Credential deactivation

`deactivateCredential` is stub-throwing. The next natural governed write surface. ADR-013 gate applies; requires a `DeactivateCredential` operation type in `C3Approvals.OperationType`. Pattern mirrors `AddCredential` from Sprint 20.

### Priority 2 — Server-side TargetPersonID filter

Add `targetPersonId?: string` to `listApprovals` filter and implement OData `$filter=TargetPersonID eq '...'` in `SharePointApprovalsService`. Resolves TD-07 and closes the truncation risk introduced by S21-P2 (TD-19). No schema change required.

### Priority 3 — Journey lifecycle audit columns

Provision `SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` in `C3Journeys`. Update `SharePointJourneyService` to write structured fields. Requires IT provisioning and a schema change point.

### Non-priority (defer beyond S22)

- Contracts/SP-02 FK alignment
- ObligationAssignmentsJSON normalisation
- CI/CD pipeline (TD-14)
- Power Automate notification flows
- Induction (all dependencies must be live first)
