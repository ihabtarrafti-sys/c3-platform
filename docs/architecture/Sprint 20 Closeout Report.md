# Sprint 20 Closeout Report — Approval History, Recovery UX, and Governed Credential Writes
**C3 Contract Control Center**
**Sprint:** 20 — Approval History, Partial Execution Recovery, and Credential Write Path
**Closeout date:** 2026-07-01
**Status:** CLOSED
**Preceding sprint:** Sprint 19 CLOSED (Role Resolution, Journey Lifecycle, Sequence Hardening)
**Validation baseline:** All parity harnesses pass, tsc clean, hosted SP DSM validation confirmed

---

## Closeout statement

Sprint 20 closes as:

> **"C3 now surfaces the complete approval audit history — Executed, Rejected, and Failed records are visible and filterable in the Approval Inbox alongside the actionable queue. Operators can recover from partial execution failures (PartialExecutionError) through an in-app recovery path without manual SP intervention. The governed credential write path is live: AddCredential flows through the ADR-013 approval loop in SP DSM and creates C3Credentials rows on execution. CRED-XXXX identifiers are derived from SharePoint's atomic server-assigned item IDs. The beta operational path now covers both Journey initiation and Credential creation end-to-end."**

Sprint 20 does **not** close as:

> ~~"Credential deactivation is implemented."~~
> ~~"Contracts/SP-02 are resolved."~~
> ~~"Journey lifecycle audit columns (SuspendedAt/CancelledAt) are added."~~
> ~~"Power Automate notification flows are implemented."~~
> ~~"CI bundle pipeline is in place."~~
> ~~"In-app recovery UI for PartialCredentialExecutionError is implemented."~~

---

## Sprint objective

Four-phase sprint expanding the beta operational surface: hardening the UI for SP DSM stability (Phase 0), exposing the full approval audit trail in-app (Phase 1), adding a safe in-app recovery path for the known PartialExecutionError failure mode (Phase 2), and implementing the governed credential write path through ADR-013 (Phase 3).

---

## Completed phases

### Phase 0 — Beta surface hardening

**Commits:** `7c38da9` (source), `b2de84d` (bundle)

**Scope:** `ErrorBoundary.tsx`, `AppShell.tsx`, command-center hooks, `CommandCenter.tsx`, `NavRail`

- `ErrorBoundary` class component introduced: `getDerivedStateFromError` + `componentDidCatch`; C3-branded fallback with error title, detail block, and Reload button; inline token fallbacks so the boundary renders even if the token provider crashed
- `AppShell.tsx` wraps `renderScreen()` with `<ErrorBoundary>` inside `<main>` so NavRail remains functional on screen crash
- `useOperationalGaps`, `useMissions`, `useAllMilestones`, `useAllMissionParticipants`: `error` field added to each hook return; first-error-wins from internal `useQuery` error fields
- `useWorkItems`: `error` threaded through `UseWorkItemsResult` interface
- `CommandCenter`: destructures `error`; renders `EmptyState variant="error"` ("Queue unavailable") before the empty-queue check — eliminates false "All clear" when SP data sources fail in SP DSM
- `NavItem.visibleWhen` signature extended: `(role, caps, dataSourceMode) => boolean`
- Amendments NavRail entry gated: `visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint'` — hidden in SP DSM (Amendments not yet implemented for SP)

**Files changed:**
- `packages/c3/src/components/ErrorBoundary.tsx` — new
- `packages/c3/src/components/layout/AppShell.tsx` — ErrorBoundary wrap
- `packages/c3/src/hooks/useOperationalGaps.ts` — error field
- `packages/c3/src/hooks/useMissions.ts` — error field
- `packages/c3/src/hooks/useAllMilestones.ts` — error field
- `packages/c3/src/hooks/useAllMissionParticipants.ts` — error field
- `packages/c3/src/hooks/useWorkItems.ts` — error thread
- `packages/c3/src/screens/CommandCenter.tsx` — error EmptyState
- `packages/c3/src/components/layout/NavRail.tsx` — visibleWhen signature + amendments gate

### Phase 1 — Approval history filters and audit details

**Commits:** `688c065` (source), `6946dbc` (bundle)

**Scope:** `ApprovalInbox.tsx` only — no service, hook, or mapper changes

- Single `listApprovals` call fetches all statuses; client-side tab filtering eliminates extra SP round-trips on tab switch
- 6-tab filter bar: Pending / Approved / Executed / Rejected / Failed / All; tab counts in labels; Pending badge in header for actionable-queue signal
- `ApprovalCard` extended: `ReviewedAt` surfaced (previously missing from detail view); `RejectionReason` and `ExecutionError` rendered with danger colour when present
- `PayloadSummary` sub-component: safe parse of `InitiateJourney` payload — renders `journeyType`, `personId`, `assignedTo`, `initiationReason`, `notes`, `missionId`, obligation assignment count; malformed JSON renders a labelled error and collapsed raw-payload disclosure block; no crash path
- Tab-specific empty-state messages
- Action matrix, self-approval enforcement, owner-only gating: unchanged

**Files changed:**
- `packages/c3/src/screens/ApprovalInbox.tsx` — rewritten (374 insertions, 97 deletions)

### Phase 2 — Partial execution recovery UX

**Commits:** `cbf3200` (source), `3743fed` (docs)

**Scope:** `useActiveJourney.ts`, `useRecoverExecutionStamp.ts` (new), `ApprovalInbox.tsx`, `C3 Tech Debt Register.md`

- `useActiveJourney.ts`: optional `enabled` parameter added (default `true`, backward-compatible); allows callers to suppress the query until a condition is met
- `useRecoverExecutionStamp.ts` (new): stamp-only mutation hook — never calls `initiateJourney`
  - Pre-condition guards: `approvalStatus === 'Approved'`, `operationType === 'InitiateJourney'`, parseable `personId` in payload
  - Safety re-check at stamp time: `getActiveJourney(personId, 'Onboarding')` — guards against race where journey is cancelled between detection and operator clicking Recover
  - Journey missing at stamp time → throws `RecoveryTargetMissingError` (no write)
  - Journey present → calls `stampExecution('Executed')` only; no new journey created
  - `onSuccess` invalidation mirrors `useExecuteApproval`: `approvals.all()`, `journey.list`, `journey.active`, `journey.allActive`
  - Exported error classes: `RecoveryPreConditionError`, `RecoveryTargetMissingError`
- `ApprovalInbox.tsx`: `ApprovalCard` — for Approved + InitiateJourney cards, `useActiveJourney` query runs lazily (`enabled = isRecoveryCandidate`); if active journey detected, Execute button is replaced by "Recover Execution Stamp" (warning-coloured) with explanatory MessageBar; lightweight "Checking…" spinner while query in flight
- Tech Debt Register: TD-11 resolved (PartialExecution recovery → Resolved S20 Phase 2); beta caveat documented (manual SP row could cause false positive recovery detection)

**Files changed:**
- `packages/c3/src/hooks/useActiveJourney.ts` — `enabled` param
- `packages/c3/src/hooks/useRecoverExecutionStamp.ts` — new (181 lines)
- `packages/c3/src/screens/ApprovalInbox.tsx` — recovery candidate detection and UX
- `docs/architecture/C3 Tech Debt Register.md` — TD-11 resolved

### Phase 3 — Governed credential write path

**Commits:** `bdf716b` (source), `4e5045e` (fix), `b77c5d6` (bundle)

**Scope:** New types, new hook, service implementation, UI mode-branch, ApprovalInbox extension

**Core write path:**

```
SP DSM: AddCredentialPanel → useSubmitCredentialApproval
        → createApproval({ operationType: 'AddCredential', payload: JSON })
        → POST-then-MERGE → APR-XXXX (C3Approvals, status: Submitted)

Platform Owner: ApprovalInbox → Approve → Execute
        → useExecuteApproval dispatches AddCredential branch
        → SharePointCredentialService.addCredential (POST-then-MERGE → CRED-XXXX)
        → stampExecution('Executed')
        → invalidates person.credentials + credentials.all

Mock DSM: AddCredentialPanel → useSubmitCredentialApproval
        → useAddCredential.mutateAsync (direct write, unchanged)
```

**Key implementation decisions:**
- No duplicate guard: multiple credentials of the same type can coexist per person
- `PartialCredentialExecutionError`: thrown when CRED row created but Executed stamp fails; parallel to `PartialExecutionError` for journeys; no in-app recovery UX for this case (deferred post-S20, noted in TD-13)
- CRED-XXXX identifiers from POST-then-MERGE using SP auto-ID — same atomicity guarantee as APR/JRN
- Submit button label in SP DSM: "Submit for Approval"; success toast: "Credential approval submitted — [APR title]"
- `AddCredentialPanel` mode-branched on `config.dataSourceMode`; mock path and form structure unchanged

**Validation blocker fix (4e5045e):**
- `PeopleWorkspace.tsx` line 374: `String(person.Id)` → `person.PersonID` — `SharePointPersonService.getPerson` filters on `Title eq '...'` (canonical `PER-XXXX`); integer string found no record; mock worked because `MockPersonService.getPerson` uses OR lookup
- `PersonProfile.tsx`: replaced `!isSpReadOnly` with `canCreate` from `useCapabilities()` in all three Add Credential entry points (card action, empty-state action, Readiness tab `onResolveObligation`); `useSpReadOnly` returns `true` in SP DSM so `!isSpReadOnly` was always `false` — Add Credential was never visible in hosted validation

**Files changed (Phase 3 + fix):**
- `packages/c3/src/services/interfaces/approvalPayloads.ts` — `AddCredentialApprovalPayload` + widened `ApprovalPayload` union
- `packages/c3/src/services/interfaces/IApprovalsService.ts` — `operationType` union widened to include `'AddCredential'`
- `packages/c3/src/utils/spCredentialMapper.ts` — `VALID_CREDENTIAL_TYPES` exported
- `packages/c3/src/services/sharepoint/SharePointCredentialService.ts` — `addCredential` POST-then-MERGE implemented
- `packages/c3/src/hooks/useSubmitCredentialApproval.ts` — new (mode-branching hook)
- `packages/c3/src/hooks/useExecuteApproval.ts` — `AddCredential` dispatch branch + `PartialCredentialExecutionError`
- `packages/c3/src/components/shared/AddCredentialPanel.tsx` — SP/mock mode branch
- `packages/c3/src/screens/ApprovalInbox.tsx` — `AddCredential` `PayloadSummary` + `PartialCredentialExecutionError` handler
- `packages/c3/src/screens/PeopleWorkspace.tsx` — canonical `PersonID` routing fix
- `packages/c3/src/screens/PersonProfile.tsx` — `canCreate` guard replaces `!isSpReadOnly`
- `docs/architecture/C3 Tech Debt Register.md` — TD-13 resolved (with caveat)

---

## Commit summary

| Hash | Phase | Description |
|------|-------|-------------|
| `7c38da9` | Phase 0 | Harden beta surface before audit history |
| `b2de84d` | Phase 0 | Build: SPFx runtime bundle for Phase 0 |
| `688c065` | Phase 1 | Add approval history filters and audit details |
| `6946dbc` | Phase 1 | Build: SPFx runtime bundle after approval history |
| `cbf3200` | Phase 2 | Add partial execution recovery UX |
| `3743fed` | Phase 2 | Docs: Complete tech debt register archive |
| `bdf716b` | Phase 3 | Add governed credential write path |
| `4e5045e` | Phase 3 | Fix: Restore credential approval entry point in SP DSM |
| `b77c5d6` | Phase 3 | Build: SPFx runtime bundle after credential entry fix |

HEAD at time of closeout: `b77c5d6`

---

## Live validation summary

All validation performed against live SharePoint DSM (hosted-workbench, same-origin fetch).

| Validation | Result |
|------------|--------|
| ErrorBoundary renders on screen crash | ✓ NavRail remains functional; fallback renders correctly |
| CommandCenter error state (SP data source failure) | ✓ "Queue unavailable" EmptyState shown; no false "All clear" |
| Amendments hidden in SP DSM NavRail | ✓ Not visible in SP DSM; visible in mock DSM |
| Approval Inbox — Pending tab | ✓ Submitted/InReview cards listed; tab count correct |
| Approval Inbox — Executed/Rejected/Failed tabs | ✓ Historical records visible; audit fields shown |
| Approval Inbox — All tab | ✓ Complete list across all statuses |
| PayloadSummary — InitiateJourney | ✓ Payload fields rendered; malformed JSON handled gracefully |
| Recovery candidate detection (Approved + active journey) | ✓ "Recover Execution Stamp" button shown in place of Execute |
| Recovery stamp — success path | ✓ Executed stamped; no duplicate journey created |
| Recovery stamp — RecoveryTargetMissingError path | ✓ Error toast shown; no write attempted |
| PersonProfile loads from People flow (canonical PER-XXXX) | ✓ Person name, credentials, journey data all load correctly |
| Add Credential visible in SP DSM (owner role) | ✓ Button visible; panel opens |
| Add Credential visible in SP DSM (operations role) | ✓ Button visible; panel opens |
| Add Credential NOT visible (visitor role) | ✓ Button hidden; panel unreachable |
| Add Credential — Submit for Approval (SP DSM) | ✓ C3Approvals row created; toast: "Credential approval submitted" |
| Add Credential — Execute (Platform Owner) | ✓ C3Credentials row created (CRED-XXXX); Approval stamped Executed |
| AddCredential PayloadSummary in Approval Inbox | ✓ credentialType, referenceNumber, holderPersonId rendered |
| No TMP-* Title in C3Credentials after execution | ✓ CRED-XXXX canonical Title; POST-then-MERGE complete |
| Add Credential (mock DSM) — direct write | ✓ Credential registered immediately; no approval loop |
| Parity — `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| Parity — `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| Parity — `s15-parity-test.mjs` | ✓ 87/87 passed |
| Parity — `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| Mock mode regression | ✓ All existing paths intact; Add Credential direct-write unchanged |

---

## SharePoint lists involved

| List | Role in Sprint 20 | Schema doc |
|------|-------------------|------------|
| `C3Approvals` | `AddCredential` operation type now in use; APR rows created and stamped via Credential approval flow | `C3Approvals SP List Schema.md` |
| `C3Credentials` | New write surface: rows created on approval execution via POST-then-MERGE; CRED-XXXX Title | `C3Credentials SP List Schema.md` |
| `C3Journeys` | Read-only in Sprint 20 | `C3Journeys SP List Schema.md` |
| `C3People` | Read-only in Sprint 20 | `C3People SP List Schema.md` |

**No SP schema changes were made in Sprint 20.**

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
- Appear in the Approval Inbox with `PayloadSummary` rendering their respective payload fields

---

## Direct role-gated lifecycle actions (not governed by ADR-013)

| Action | Authorization | SP write |
|--------|--------------|----------|
| Complete journey | `owner` or `operations` | C3Journeys PATCH |
| Suspend journey | `owner` or `operations` | C3Journeys PATCH |
| Resume journey | `owner` or `operations` | C3Journeys PATCH |
| Cancel journey | `owner` or `operations` | C3Journeys PATCH |

These remain unchanged from Sprint 19. See `ADR-013 Addendum — Journey Lifecycle Transitions.md`.

---

## Scope boundaries preserved

The following were not touched at any point during Sprint 20:

- No C3Approvals, C3Journeys, C3People, or C3Credentials schema changes
- No journey lifecycle transition changes
- No Contracts, Missions, Finance, Milestones, or credential deactivation
- No Power Automate flows
- No `deactivateCredential` implementation
- Mock DSM unchanged — all paths intact for demo/regression; Add Credential mock path remains direct write

---

## Tech debt items resolved in Sprint 20

| ID | Item | Resolution |
|----|------|------------|
| TD-11 | PartialExecution recovery required manual SP edit | Resolved S20 Phase 2: `useRecoverExecutionStamp` + ApprovalInbox recovery UX |
| TD-13 | Credential write path not implemented in SP DSM | Resolved S20 Phase 3 (with caveat: no in-app recovery for `PartialCredentialExecutionError`) |

---

## Remaining known limitations

| Limitation | Risk |
|------------|------|
| Manual runtime bundle commit | Medium — every code change requires manual build + bundle commit |
| `PartialCredentialExecutionError` — no in-app recovery | Low — CRED row created but Executed stamp failed; operator manually sets C3Approvals to Executed |
| TMP-* orphan row on MERGE failure | Very low — error message names row and list |
| No dedicated audit columns for journey lifecycle transitions | Low — Notes append only; no structured SuspendedAt/CancelledAt |
| `deactivateCredential` not implemented | Functional gap — credentials cannot be deactivated via C3 in SP DSM |
| Contracts/SP-02 FK mismatch | Functional gap — separate workstream |
| ObligationAssignmentsJSON not normalised | Technical debt — deferred per ADR-003 |

---

## Recommended Sprint 21 scope

### Priority 1 — Journey lifecycle audit columns

Add `SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` to `C3Journeys`. Update `SharePointJourneyService` to write structured fields instead of Notes-append only. Requires IT provisioning.

### Priority 2 — Credential deactivation

`deactivateCredential` is stub-throwing. The natural next governed write surface after `addCredential`. Follow the ADR-013 gate pattern with a `DeactivateCredential` operation type.

### Priority 3 — PartialCredentialExecutionError recovery UX

Parallel to the journey recovery path implemented in S20 Phase 2. Detect Approved + AddCredential cards where a CRED row already exists; offer a stamp-only recovery action.

### Non-priority (defer beyond S21)

- Contracts/SP-02 FK alignment
- ObligationAssignmentsJSON child-list migration
- CI bundle build pipeline
- Power Automate notification flows
