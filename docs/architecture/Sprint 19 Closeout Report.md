# Sprint 19 Closeout Report — Role Resolution, Journey Lifecycle, and Sequence Hardening
**C3 Contract Control Center**
**Sprint:** 19 — Role Resolution, Journey Lifecycle Transitions, and Sequence Hardening
**Closeout date:** 2026-07-01
**Status:** CLOSED
**Preceding sprint:** Sprint 18 CLOSED (Governed SharePoint Write Operations)
**Validation baseline:** All parity harnesses pass, tsc clean, hosted SP DSM validation confirmed

---

## Closeout statement

Sprint 19 closes as:

> **"C3 now resolves real SharePoint security-group roles at mount time instead of using a hardcoded stub. Platform Owners and Operations staff can directly manage journey lifecycle (Complete, Suspend, Resume, Cancel) through role-gated SP PATCH operations. APR-XXXX and JRN-XXXX identifiers are now derived from SharePoint's server-assigned item ID, eliminating the GET-last-then-increment race condition. The beta operational path is now functionally complete for Onboarding Journey creation and lifecycle management."**

Sprint 19 does **not** close as:

> ~~"Credential writes are implemented."~~
> ~~"Contracts/SP-02 are resolved."~~
> ~~"Power Automate notification flows are implemented."~~
> ~~"CI bundle pipeline is in place."~~
> ~~"Dedicated audit columns for journey transitions are added."~~

---

## Sprint objective

Three-phase hardening sprint targeting the two remaining pre-go-live blockers from Sprint 18 (B1 role stub, B3 sequence race) and the functional gap (B6 lifecycle transitions), with hosted SP DSM validation confirming all three before closeout.

---

## Completed phases

### Phase 1 — Real SharePoint role resolution

**Commits:** `3d27fd5` (source), `f6a903e` (bundle)

- `spRoleResolver.ts` introduced: queries `/_api/web/currentUser/groups` at mount time; maps group display names to C3 roles via a configurable priority list
- `SharePointHost.tsx` updated: `useSPRoleResolver` replaces the `'owner'` hardcoded stub; role is resolved asynchronously at mount; C3 renders in loading state until role is resolved
- `c3Role` is now `'visitor'` (safest fallback) if no matching group is found — fail-close by default
- Hosted DSM validation confirmed: role correctly resolved from SP group membership; owner-only actions visible only to Platform Owner account

**Files changed:**
- `packages/c3/src/services/sharepoint/spRoleResolver.ts` — new
- `packages/c3/src/hosts/SharePointHost.tsx` — updated (stub replaced)

### Phase 2 — Role-gated journey lifecycle transitions

**Commits:** `f089cc0` (source), `14ebc18` (fix: cancel action wiring), `396b231` (fix: confirm button visibility), `392cca2` (bundle)

**Scope:** `IJourneyService`, `MockJourneyService`, `SharePointJourneyService`, four mutation hooks, `PersonProfile.tsx` UI, `ADR-013 Addendum — Journey Lifecycle Transitions.md`

- `InvalidTransitionError` class added to `packages/c3/src/services/errors.ts`
- `JourneyTransitionRequest` type added to `IJourneyService.ts`; `completeJourney`, `suspendJourney`, `resumeJourney`, `cancelJourney` signatures updated with `actorLoginName` and optional `reason`
- `MockJourneyService`: all four transitions guard-implemented (status check → `InvalidTransitionError` if invalid; Notes audit append: `[ISO] ACTION by LOGINNAME — reason`)
- `SharePointJourneyService`: all four transitions implemented as GET item → validate → fail-close actorLoginName check → PATCH via MERGE; `Notes` field appended (never overwritten); `CompletedAt` written on Complete only; fresh digest per write
- Four mutation hooks: `useCompleteJourney`, `useSuspendJourney`, `useResumeJourney`, `useCancelJourney` — TanStack Query mutations; each invalidates `journey.list`, `journey.active`, `journey.allActive` on success
- `PersonProfile.tsx`: journey action buttons (Complete / Suspend or Resume / Cancel) gated by `canManageJourneyLifecycle = currentUser.c3Role === 'owner' || currentUser.c3Role === 'operations'`; confirmation dialogs with reason field for Suspend/Cancel; dismiss button labels corrected ("Go Back" in cancel context); confirm button uses explicit inline style to resolve Fluent UI v9 Dialog portal CSS scope issue
- `ADR-013 Addendum — Journey Lifecycle Transitions.md` authored: governance model, rationale for ADR-013 exemption, SP write pattern, beta risk acknowledgement, deferred audit columns
- Hosted DSM validation confirmed: Active → Completed, Active → Suspended → Resumed, Active → Cancelled all working against live C3Journeys list; role guard confirmed (visitor cannot see action buttons)

**Files changed:**
- `packages/c3/src/services/errors.ts` — added `InvalidTransitionError`
- `packages/c3/src/services/interfaces/IJourneyService.ts` — `JourneyTransitionRequest`, updated signatures
- `packages/c3/src/services/mock/MockJourneyService.ts` — all four transitions implemented
- `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` — lifecycle transitions + Phase 3 sequence hardening
- `packages/c3/src/hooks/useCompleteJourney.ts` — new
- `packages/c3/src/hooks/useSuspendJourney.ts` — new
- `packages/c3/src/hooks/useResumeJourney.ts` — new
- `packages/c3/src/hooks/useCancelJourney.ts` — new
- `packages/c3/src/screens/PersonProfile.tsx` — lifecycle UI, confirm dialogs, button fixes
- `docs/architecture/ADR-013 Addendum — Journey Lifecycle Transitions.md` — new

### Phase 3 — APR/JRN sequence hardening

**Commits:** `48f21fc` (source), `60e7be0` (bundle)

**Scope:** `SharePointApprovalsService.ts`, `SharePointJourneyService.ts`

- **Old pattern (removed):** `deriveNextSequenceNumber()` (Approvals) and `deriveNextJourneySequence()` (Journeys) — both used GET-last-item-by-ID-desc, parsed the Title, incremented the counter. Non-atomic: two concurrent submissions could derive the same next ID.
- **New pattern (POST-then-MERGE):**
  1. POST with placeholder `Title = 'TMP-' + Date.now().toString(36)` (<=13 chars; within SP 20-char Title limit)
  2. Read `ID` from POST response — SharePoint's server-assigned SQL identity; atomic; no two rows can share the same ID
  3. Fetch fresh form digest (POST consumed the previous one)
  4. MERGE `Title = formatApprovalId(ID)` / `formatJourneyId(ID)` with `IF-MATCH: *`
- **MERGE failure behaviour:** throws with explicit message naming the orphan row Title, its SP item ID, and which list it is in. Does not silently continue.
- **`TitleItem`, `TitleResponse`, `TitleOnlyItem`, `TitleOnlyResponse` interfaces** — removed (only used by old `deriveNext*` functions)
- Hosted SP DSM validation confirmed: APR-XXXX and JRN-XXXX titles correctly generated from SP item IDs

---

## Commit summary

| Hash | Phase | Description |
|------|-------|-------------|
| `3d27fd5` | Phase 1 | Resolve SharePoint roles for SP DSM |
| `f6a903e` | Phase 1 | Build: SPFx runtime bundle after role resolution |
| `f089cc0` | Phase 2 | Add role-gated journey lifecycle transitions |
| `14ebc18` | Phase 2 | Fix: wire cancel journey lifecycle action |
| `396b231` | Phase 2 | Fix: make cancel journey confirm button visible |
| `392cca2` | Phase 2 | Build: SPFx runtime bundle after cancel dialog visibility fix |
| `48f21fc` | Phase 3 | Use SP auto-ID for atomic APR/JRN sequence generation |
| `60e7be0` | Phase 3 | Build: SPFx runtime bundle after sequence hardening |

HEAD at time of closeout: `60e7be0`

---

## Live validation summary

All validation performed against live SharePoint DSM (hosted-workbench, same-origin fetch).

| Validation | Result |
|------------|--------|
| SP role resolution (Platform Owner account) | ✓ `c3Role: 'owner'` resolved from SP group |
| SP role resolution (fallback — no matching group) | ✓ `c3Role: 'visitor'` |
| Journey Complete (Active → Completed) | ✓ SP PATCH confirmed; `CompletedAt` set; Notes appended |
| Journey Suspend (Active → Suspended) | ✓ SP PATCH confirmed; Notes appended |
| Journey Resume (Suspended → Active) | ✓ SP PATCH confirmed; Notes appended |
| Journey Cancel (Active → Cancelled) | ✓ SP PATCH confirmed; Notes appended |
| Journey Cancel (Suspended → Cancelled) | ✓ SP PATCH confirmed |
| Role guard — visitor cannot see lifecycle buttons | ✓ Buttons hidden for visitor role |
| Role guard — operations role can manage lifecycle | ✓ Buttons visible for operations role |
| Invalid transition guard (Completed → Complete) | ✓ `InvalidTransitionError` thrown; no SP write |
| APR sequence — POST-then-MERGE | ✓ APR-XXXX Title derived from SP item ID |
| JRN sequence — POST-then-MERGE | ✓ JRN-XXXX Title derived from SP item ID |
| Parity — `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| Parity — `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| Parity — `s15-parity-test.mjs` | ✓ 87/87 passed |
| Parity — `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| Mock mode regression | ✓ All four lifecycle transitions work in mock |

---

## SharePoint lists involved

| List | Role in Sprint 19 | Schema doc |
|------|-------------------|------------|
| `C3Journeys` | Receives PATCH writes for lifecycle transitions; `Status`, `CompletedAt`, `Notes` columns written | `C3Journeys SP List Schema.md` |
| `C3Approvals` | APR-XXXX Title now derived from SP item ID via POST-then-MERGE | `C3Approvals SP List Schema.md` |
| `C3People` | Read-only in Sprint 19 | `C3People SP List Schema.md` |
| SP Security Groups | Read via `/_api/web/currentUser/groups` for role resolution | SP built-in — no list schema |

**No SP schema changes were made in Sprint 19.**

---

## SP groups required for role resolution

| SP Group (display name) | C3 Role assigned |
|------------------------|------------------|
| `C3 Platform Owners` | `owner` |
| `C3 Operations` | `operations` |
| `C3 Management` | `management` |
| `C3 HR` | `hr` |
| `C3 Legal` | `legal` |
| `C3 Finance` | `finance` |

Users in none of the above groups resolve to `visitor` (fail-close).

---

## Sequence hardening decision record

### Problem

`deriveNextSequenceNumber()` (APR) and `deriveNextJourneySequence()` (JRN) used GET-last-item-by-ID-desc to find the current maximum Title, parsed the counter, and incremented. Concurrent submissions from two browser sessions would both GET the same maximum and produce identical Titles. SP does not enforce uniqueness on `Title` by default.

### Solution

Use SharePoint's SQL identity column. SP assigns an integer `ID` atomically to every list item at POST time. Deriving Title from `ID` is race-free by construction. A `TMP-*` placeholder satisfies SP's non-null Title requirement during the POST phase.

### Trade-off

A MERGE failure after POST leaves a `TMP-*` orphan row. Probability is very low (requires session expiry between POST and MERGE). Error messaging explicitly names the orphan and which list it is in for operator remediation.

---

## Scope boundaries preserved

The following were not touched at any point during Sprint 19:

- No C3Approvals, C3Journeys, C3People, or C3Credentials schema changes
- No Contracts, Missions, Finance, Milestones, or Credential writes
- No new C3Approvals operation types
- No ApprovalInbox changes
- Mock DSM unchanged — all paths intact for demo/regression

---

## Beta blockers — status after Sprint 19

| # | Blocker | Pre-S19 | Post-S19 | Notes |
|---|---------|---------|----------|-------|
| **B1** | `c3Role` hardcoded stub | 🔴 Critical | ✅ Resolved | Real SP group lookup via `spRoleResolver.ts` |
| **B2** | `loginName` empty edge case | 🟡 High | ✅ Addressed | Service throws before PATCH if `actorLoginName` empty |
| **B3** | APR/JRN sequence race | 🟡 Medium | ✅ Resolved | POST-then-MERGE; SP auto-ID is the sequence source |
| **B4** | Manual runtime bundle commit | 🟡 Medium | 🟡 Open | CI pipeline not in scope |
| **B5** | PartialExecutionError manual recovery | 🟡 Medium | 🟡 Open | Operator runbook documented |
| **B6** | No journey state transitions | 🟠 Gap | ✅ Resolved | All four lifecycle transitions live |
| **B7** | No Executed/Rejected records in C3 UI | 🟠 Gap | 🟠 Open | History view deferred |

---

## Validated SP DSM capabilities after Sprint 19

1. Role resolution — SP group membership → C3 role at mount
2. Approval submission — POST-then-MERGE → APR-XXXX
3. Approval review — Approve/Reject PATCH
4. Approval execution — five-step guard → Journey creation → Executed stamp
5. Journey creation — POST-then-MERGE → JRN-XXXX
6. Duplicate prevention — active journey check before execute
7. Journey Complete — GET→guard→PATCH
8. Journey Suspend — GET→guard→PATCH
9. Journey Resume — GET→guard→PATCH
10. Journey Cancel — GET→guard→PATCH
11. APR/JRN title generation from SP item ID (atomic, race-free)

---

## Remaining beta caveats

| Caveat | Risk |
|--------|------|
| Manual runtime bundle commit | Medium — every code change requires manual build + bundle commit |
| PartialExecutionError recovery | Low — very rare; operator manually stamps Executed in SP |
| TMP-* orphan row on MERGE failure | Very low — error message names row and list |
| No dedicated audit columns for lifecycle transitions | Low — Notes append only; no structured SuspendedAt/CancelledAt columns |
| Executed/Rejected approvals not visible in C3 UI | Functional gap — audit view only via SP directly |
| Credential writes not implemented | Functional gap — Sprint 20+ |
| Contracts/SP-02 FK mismatch | Functional gap — separate workstream |
| ObligationAssignmentsJSON not normalised | Technical debt — deferred per ADR-003 |

---

## Recommended Sprint 20 scope

### Priority 1 — Journey lifecycle audit columns

Add `SuspendedAt`, `SuspensionReason`, `CancelledAt`, `CancellationReason` to the `C3Journeys` SP list. Update `SharePointJourneyService` to write structured fields instead of appending to `Notes` only. Requires IT provisioning; plan schema change accordingly.

### Priority 2 — Approval history view

Add a history/archive section to `ApprovalInbox` showing Executed and Rejected records. Operators currently cannot see the audit trail from within C3.

### Priority 3 — Credential write path

`addCredential` and `deactivateCredential` are the next governed write surfaces. Follow the ADR-013 gate pattern. Requires a new `AddCredentialApprovalPayload` and new `OperationType` choice values in `C3Approvals`. No new SP lists needed.

### Non-priority (defer beyond S20)

- Contracts/SP-02 FK alignment
- ObligationAssignmentsJSON child-list migration
- CI bundle build pipeline
- Power Automate notification flows
