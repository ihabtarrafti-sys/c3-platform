# C3 Architecture Baseline — Sprint 19
**C3 Contract Control Center**
**Sprint:** 19 — Role Resolution, Journey Lifecycle Transitions, and Sequence Hardening
**Baseline date:** 2026-07-01
**Status:** CLOSED — 2026-07-01

---

## Closeout statement

Sprint 19 closes as:

> **"C3 now has real SP DSM role resolution from SharePoint security-group membership. C3 has governed operational writes through ADR-013 for journey initiation, and direct role-gated lifecycle transitions for existing journeys (Complete, Suspend, Resume, Cancel). APR-XXXX and JRN-XXXX identifiers are now derived from SharePoint's atomic server-assigned item IDs. Mock DSM remains the demo and regression baseline. SP DSM is the beta operational path and is now functionally complete for journey creation and lifecycle management."**

---

## Section 1 — Architectural shifts introduced in Sprint 19

### Before Sprint 19 (Sprint 18 baseline)

- `c3Role` was hardcoded `'owner'` in `SharePointHost.tsx`. All SP-mode users had Platform Owner permissions. This was a documented beta stub and a go-live blocker (B1).
- `completeJourney`, `suspendJourney`, `cancelJourney` were stub-throwing in `SharePointJourneyService`. No journey state transition was possible in SP mode (B6).
- `initiateJourney` and `createApproval` derived sequence identifiers by GETting the last list item and incrementing the counter. This was non-atomic and vulnerable to race conditions under concurrent submissions (B3).

### After Sprint 19

**1. Real role resolution (Phase 1)**

`spRoleResolver.ts` queries `/_api/web/currentUser/groups` at mount time. The SP group display names are mapped to C3 roles via a priority-ordered configuration. `c3Role` is now derived from actual SharePoint security-group membership. Users not in any configured group receive `visitor` (fail-close). The hardcoded stub is gone.

**2. Role-gated direct lifecycle transitions (Phase 2)**

Journey lifecycle transitions (Complete, Suspend, Resume, Cancel) are governed by ADR-013 Addendum: they are **direct role-gated operational actions, not subject to the ADR-013 approval gate**. The rationale is that the approval gate governs governance origination (creating a new journey), while lifecycle management governs the operational state of an already-authorized journey record. See `ADR-013 Addendum — Journey Lifecycle Transitions.md` for the full governance model.

The authorized roles are `owner` and `operations` (`canManageJourneyLifecycle` in `PersonProfile.tsx`). Visitor and management/hr/legal/finance roles are read-only on journey lifecycle.

**3. Atomic APR/JRN sequence generation (Phase 3)**

APR-XXXX and JRN-XXXX identifiers are now derived from SharePoint's SQL identity column. POST with a `TMP-*` placeholder → read server-assigned `ID` from response → MERGE canonical Title. This is atomic: SharePoint's database engine guarantees no two rows share the same ID. The old GET-last-then-increment pattern is removed.

---

## Section 2 — New components delivered in Sprint 19

### spRoleResolver.ts

`packages/c3/src/services/sharepoint/spRoleResolver.ts`

Queries `/_api/web/currentUser/groups` via same-origin fetch. Maps SP group display names to C3 role strings using a priority list (owner > operations > management > hr > legal > finance > visitor). Returns `C3Role` string. Used as a React hook (`useSPRoleResolver`) in `SharePointHost.tsx`.

### IJourneyService updates

`packages/c3/src/services/interfaces/IJourneyService.ts`

- `JourneyTransitionRequest` type: `{ journeyId: string; actorLoginName: string; reason?: string }`
- `completeJourney(req)`, `suspendJourney(req)`, `resumeJourney(req)`, `cancelJourney(req)` signatures updated
- Guard functions: `isValidTransition(from, action)` — state machine enforced before any write

### errors.ts

`packages/c3/src/services/errors.ts`

- `InvalidTransitionError` — thrown when a lifecycle transition is invalid for the current journey status (e.g. attempting to Complete an already-Completed journey). Thrown before any SP write.

### MockJourneyService updates

`packages/c3/src/services/mock/MockJourneyService.ts`

All four lifecycle transitions implemented in mock:
- Status transition check → throw `InvalidTransitionError` if invalid
- Notes append: `[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]`
- `CompletedAt` set on Complete transition only

### SharePointJourneyService updates

`packages/c3/src/services/sharepoint/SharePointJourneyService.ts`

Lifecycle transitions (`completeJourney`, `suspendJourney`, `resumeJourney`, `cancelJourney`) — each follows GET→guard→PATCH:
1. GET item by journeyId → current `Status` and `Notes`
2. `isValidTransition(currentStatus, action)` → throw `InvalidTransitionError` if invalid
3. Fail-close: throw if `actorLoginName` is empty
4. Build PATCH payload (Status, optional CompletedAt, Notes = currentNotes + audit line)
5. Fresh form digest
6. POST + MERGE + IF-MATCH: * 

Sequence hardening (Phase 3):
- `initiateJourney` now uses POST-then-MERGE: placeholder Title → server-assigned ID → MERGE canonical JRN-XXXX
- `deriveNextJourneySequence()` removed
- `mergeJourneyTitle(siteUrl, id, title)` — new module-level helper; fetches own fresh digest

### SharePointApprovalsService updates

`packages/c3/src/services/sharepoint/SharePointApprovalsService.ts`

Sequence hardening (Phase 3):
- `createApproval` now uses POST-then-MERGE: placeholder Title → server-assigned ID → MERGE canonical APR-XXXX
- `deriveNextSequenceNumber()` removed

### Mutation hooks

- `packages/c3/src/hooks/useCompleteJourney.ts` — TanStack Query `useMutation`
- `packages/c3/src/hooks/useSuspendJourney.ts` — TanStack Query `useMutation`
- `packages/c3/src/hooks/useResumeJourney.ts` — TanStack Query `useMutation`
- `packages/c3/src/hooks/useCancelJourney.ts` — TanStack Query `useMutation`

All four invalidate `queryKeys.journey.list(personId)`, `queryKeys.journey.active(personId, type)`, `queryKeys.journey.allActive(type)` on success.

### PersonProfile.tsx updates

`packages/c3/src/screens/PersonProfile.tsx`

Journey lifecycle UI:
- Action buttons (Complete / Suspend or Resume / Cancel) gated by `canManageJourneyLifecycle`
- Confirmation dialogs for each action; Suspend/Cancel include reason text field
- Dismiss button label: "Go Back" when `confirmAction === 'cancel'` (prevents confusion with the journey Cancel action)
- Confirm button uses `style={{ backgroundColor: 'var(--c3-critical, #DC2626)', color: '#ffffff', border: 'none' }}` to bypass Fluent UI v9 Dialog portal CSS scope issue (CSS tokens not resolved in `document.body` portal)

### ADR-013 Addendum

`docs/architecture/ADR-013 Addendum — Journey Lifecycle Transitions.md`

Governance model for lifecycle transitions: direct role-gated action, not subject to ADR-013 approval gate. Full rationale, valid transition state machine, SP write pattern, beta risk acknowledgement, deferred audit columns.

---

## Section 3 — Runtime architecture (confirmed state after Sprint 19)

### SharePoint service registry

| Service | SP mode behaviour | State after S19 |
|---------|-------------------|-----------------|
| Role resolution | `/_api/web/currentUser/groups` → C3 role at mount | Live (S19) |
| Approvals — `createApproval` | POST-then-MERGE → APR-XXXX via SP item ID | Live (S18, hardened S19) |
| Approvals — `listApprovals` | Reads C3Approvals | Live (S18) |
| Approvals — `patchApprovalStatus` | MERGE Approve/Reject | Live (S18) |
| Approvals — `stampExecution` | MERGE Executed/ExecutionFailed | Live (S18) |
| Journeys (read) | Reads C3Journeys | Live (S17) |
| Journeys — `initiateJourney` | POST-then-MERGE → JRN-XXXX via SP item ID | Live (S18, hardened S19) |
| Journeys — `completeJourney` | GET→guard→PATCH; `CompletedAt` + Notes | Live (S19) |
| Journeys — `suspendJourney` | GET→guard→PATCH; Notes | Live (S19) |
| Journeys — `resumeJourney` | GET→guard→PATCH; Notes | Live (S19) |
| Journeys — `cancelJourney` | GET→guard→PATCH; Notes | Live (S19) |
| People | Reads C3People | Live (S16) |
| Credentials (read) | Reads C3Credentials | Live (S15) |
| Credentials (write) | Stub-throwing | Deferred — Sprint 20+ |
| Contracts | Returns `[]` graceful stub | Deferred — SP-02 |
| Missions | Returns `[]` graceful stub | Deferred — future sprint |
| Milestones | Returns `[]` graceful stub | Deferred — future sprint |
| Finance | Returns `[]` graceful stub | Deferred — future sprint |

### Data source modes

**Mock DSM** — demo and regression baseline. All writes are direct in-memory. Journey lifecycle transitions implemented in MockJourneyService. No approval gate. All write surfaces visible.

**SP DSM** — beta operational path. Journey initiation gated by ADR-013 approval loop. Journey lifecycle transitions are direct role-gated PATCH operations (ADR-013 Addendum). Role resolved from SP security-group membership at mount.

### SP write patterns

**Sequence-generating write (APR/JRN creation) — POST-then-MERGE:**
```
1. GET /_api/contextinfo → form digest (D1)
2. POST /_api/web/lists/getbytitle('LIST')/items   Title=TMP-*  (creates row; server assigns ID)
3. GET /_api/contextinfo → form digest (D2, fresh — D1 consumed by POST)
4. POST /_api/web/lists/getbytitle('LIST')/items(ID)
   + X-HTTP-Method: MERGE + IF-MATCH: *
   Title=APR-XXXX or JRN-XXXX
```

**Lifecycle transition write — GET-then-MERGE:**
```
1. GET /_api/web/lists/getbytitle('C3Journeys')/items?$filter=Title eq 'JRN-XXXX'
   → current Status, Notes
2. isValidTransition(currentStatus, action) — throw if invalid
3. Fail-close: throw if actorLoginName empty
4. GET /_api/contextinfo → form digest
5. POST /_api/web/lists/getbytitle('C3Journeys')/items(ID)
   + X-HTTP-Method: MERGE + IF-MATCH: *
   { Status, [CompletedAt], Notes: currentNotes + audit line }
```

All requests: `credentials: 'same-origin'`. No PnP.js.

---

## Section 4 — Governance model (confirmed after Sprint 19)

### Write category matrix

| Operation | Pattern | Gate |
|-----------|---------|------|
| Initiate journey | ADR-013 approval loop | Submit → Review → Approved → Execute |
| Complete/Suspend/Resume/Cancel journey | Direct role-gated PATCH | `owner` or `operations` role only |
| Add credential (future) | ADR-013 approval loop (planned S20) | Same gate pattern |
| All other write surfaces | Stub-throwing | Not yet implemented |

### Role capabilities

| Role | Initiate journey | Lifecycle transitions | Approve/Reject | Execute approval |
|------|-----------------|----------------------|----------------|-----------------|
| `owner` | Via approval submission | Yes | Yes | Yes |
| `operations` | Via approval submission | Yes | No | No |
| `management` | No | No | No | No |
| `hr` / `legal` / `finance` | No | No | No | No |
| `visitor` | No | No | No | No |

### Audit trail (beta state)

- Journey initiation: `C3Approvals` row (permanent record of proposal, review, execution)
- Lifecycle transitions: `Notes` field append with `[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]`
- Dedicated audit columns (`SuspendedAt`, `CancelledAt`, etc.) deferred to Sprint 20 schema work

---

## Section 5 — Parity baselines (confirmed Sprint 19 closeout)

| Harness | Result |
|---------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |

Baselines unchanged from Sprint 18. No parity harnesses were modified in Sprint 19.

---

## Section 6 — What is deferred to Sprint 20 and beyond

### Journey lifecycle audit columns (Sprint 20, schema change)

`SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` columns do not exist in `C3Journeys`. Notes-append is the audit bridge for beta. Sprint 20 should provision these columns and update `SharePointJourneyService` to write structured fields.

### Approval history view (Sprint 20, UI)

Executed and Rejected approval records are not visible in the C3 `ApprovalInbox`. Operators must query SP directly. A history/archive section in `ApprovalInbox` is the natural next UI step.

### Credential writes (Sprint 20+)

`addCredential` and `deactivateCredential` are stub-throwing. Next governed write surface after journey lifecycle. ADR-013 approval gate pattern applies.

### Contracts/SP-02 (separate workstream)

FK mismatch (numeric SP IDs vs PER-NNNN strings) unresolved. Returns `[]` gracefully. Not in the C3 sprint sequence.

### CI bundle pipeline (ongoing)

Manual `npm run build:runtime` + bundle commit after every change. Wiring CI is a DevOps workstream, not a C3 feature sprint item.

---

## Section 7 — File inventory (Sprint 19 additions and modifications)

| File | Status | Notes |
|------|--------|-------|
| `packages/c3/src/services/sharepoint/spRoleResolver.ts` | New | SP group → C3 role resolver |
| `packages/c3/src/hosts/SharePointHost.tsx` | Modified | Hardcoded stub replaced with `useSPRoleResolver` |
| `packages/c3/src/services/errors.ts` | Modified | Added `InvalidTransitionError` |
| `packages/c3/src/services/interfaces/IJourneyService.ts` | Modified | `JourneyTransitionRequest` type; updated lifecycle signatures |
| `packages/c3/src/services/mock/MockJourneyService.ts` | Modified | All four lifecycle transitions implemented |
| `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` | Modified | Lifecycle transitions + sequence hardening (Phase 3) |
| `packages/c3/src/services/sharepoint/SharePointApprovalsService.ts` | Modified | Sequence hardening (Phase 3) — POST-then-MERGE |
| `packages/c3/src/hooks/useCompleteJourney.ts` | New | TanStack Query mutation hook |
| `packages/c3/src/hooks/useSuspendJourney.ts` | New | TanStack Query mutation hook |
| `packages/c3/src/hooks/useResumeJourney.ts` | New | TanStack Query mutation hook |
| `packages/c3/src/hooks/useCancelJourney.ts` | New | TanStack Query mutation hook |
| `packages/c3/src/screens/PersonProfile.tsx` | Modified | Journey action buttons, confirm dialogs, UX fixes |
| `docs/architecture/ADR-013 Addendum — Journey Lifecycle Transitions.md` | New | Governance model for lifecycle transitions |
| `docs/architecture/Sprint 19 Closeout Report.md` | New | Sprint closeout |
| `docs/architecture/C3 Architecture Baseline — Sprint 19.md` | New | This document |
| `docs/architecture/C3 Beta Release Candidate Checklist.md` | New | Beta RC go/no-go checklist |
| `packages/c3-spfx-host/src/.../c3-runtime.js` | Modified | Rebuilt after each phase |
