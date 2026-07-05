# C3 Tech Debt Register

**Last updated:** 2026-07-04 (Sprint 30)
**Maintained by:** Engineering (C3 Platform)
**Purpose:** Single-source list of known technical debts, design gaps, and deferred decisions.
Each item carries a severity, sprint attribution, and a clear resolution path.

Severity scale:
- 🔴 **Active risk** — may cause user-visible failure or data inconsistency in beta
- 🟠 **Latent risk** — will cause a problem when the related feature is built or load increases
- 🟡 **Quality gap** — no immediate runtime risk; reduces maintainability or confidence
- ✅ **Resolved** — included for audit trail; links to the commit/sprint that closed it

---

## Active Items

### TD-01 — No React Error Boundary
**Severity:** 🔴 → ✅ **Resolved in Sprint 20 Phase 0**
**Sprint attributed:** S19 (discovered), S20-P0 (resolved)
**File:** `packages/c3/src/components/ErrorBoundary.tsx` (new), `AppShell.tsx` (updated)

Prior to S20-P0-1, an uncaught render-phase throw anywhere inside a screen component would
crash the entire SPFx webpart to a blank white state with no recovery path. Resolved by adding
a class-component `ErrorBoundary` wrapping `renderScreen()` in `AppShell`. The fallback renders
a C3-branded error panel with "Reload C3" and full console logging for beta triage.

**Resolution commit:** S20-P0 chore commit.

---

### TD-02 — CommandCenter false "All clear" on SP data failure
**Severity:** 🔴 → ✅ **Resolved in Sprint 20 Phase 0**
**Sprint attributed:** S11 (origin), S20-P0 (resolved)
**File:** `CommandCenter.tsx`, `useWorkItems.ts`, and 4 data hooks

When SP data sources (people, credentials, journeys, missions, milestones, participants) fail
to load, `useWorkItems` returned `{ items: [], counts: { total: 0 }, isLoading: false }`.
`CommandCenter` interpreted this as a successful empty queue and rendered "All clear — No
operational work items." This is a false positive in SP DSM.

Resolved by:
- Adding `error: Error | null` to `useOperationalGaps`, `useMissions`, `useAllMilestones`,
  `useAllMissionParticipants`
- Threading `error` through `useWorkItems` (first non-null error wins)
- Adding an explicit `if (error)` guard in `CommandCenter` that renders an `EmptyState variant="error"`
  before the empty-queue check

**Resolution commit:** S20-P0 chore commit.

---

### TD-03 — SharePointAmendmentService all-stub (silent empty data in SP DSM)
**Severity:** 🔴 → ✅ **Mitigated in Sprint 20 Phase 0 (full resolution deferred)**
**Sprint attributed:** S15 (origin — stub placeholder), S20-P0 (mitigation)
**File:** `SharePointAmendmentService.ts`, `NavRail.tsx`

All three methods (`listAllAmendments`, `listContractAmendments`, `getAmendment`) log a
`console.warn` and return `[]` / `null`. In SP DSM, the Amendments screen silently shows
empty data — indistinguishable from "there are no amendments."

Mitigated by gating the Amendments NavRail item in SP DSM (`mode !== 'sharepoint'` guard
in `visibleWhen`). Amendments remain fully available in Mock DSM for demo/regression.

**Full resolution:** Implement `SharePointAmendmentService` against the `C3_Amendments` SP list
(deferred, not in S20 scope).

---

### TD-04 — SharePointContractService uses PnP.js (inconsistent with native-fetch services)
**Severity:** 🟠 → ✅ **Resolved in Sprint 24 Phase 1**
**Sprint attributed:** S13 (origin — predates native-fetch migration), S24-P1 (resolved)
**File:** `packages/c3/src/services/sharepoint/SharePointContractService.ts`

~~All SP services written in S15–S19 use native `fetch` with `credentials: 'same-origin'`,
`X-RequestDigest`, and the `application/json;odata=verbose` pattern. `SharePointContractService`
predates this migration and uses `@pnp/sp` (PnP.js) with `spfi`.~~

**Resolved (S24-P1):** `SharePointContractService` has been completely rewritten with native
`fetch`, `credentials: 'same-origin'`, and `Accept: application/json;odata=nometadata` —
consistent with all S15–S23 SP services. All `@pnp/sp` / `spfi` / `SPFI` imports removed.
The service now targets `C3Contracts` (new list) rather than the legacy `C3_Contracts` list.
`SPContractItem` in `contractMapper.ts` updated to match the flat C3Contracts schema (no SP
lookup column shapes). `OpsStatus` is now computed from `EndDate` in the mapper rather than
read from a stored SP column.

**Resolution commit:** S24-P1 source commit.

---

### TD-05 — ObligationAssignmentsJSON not normalised
**Severity:** 🟠 Latent risk
**Sprint attributed:** S18 (deferred per ADR-003)
**File:** `C3Journeys` SP list, `SharePointJourneyService.ts`, `spJourneyMapper.ts`

`ObligationAssignmentsJSON` is stored as a JSON-serialised string in the `C3Journeys` list
rather than a normalised sub-table. This is intentional for beta — the obligation assignment
structure is not yet stable. Post-beta, normalisation to a `C3JourneyAssignments` list is
planned.

**Resolution:** Design and provision `C3JourneyAssignments` list; migrate data at SP list
schema change point.

---

### TD-06 — `getApproval` not implemented (throws in both services)
**Severity:** 🟡 → ✅ **Resolved in Sprint 31**
**Sprint attributed:** S18 (stub placeholder), S31 (resolved)
**File:** `MockApprovalsService.ts`, `SharePointApprovalsService.ts`, `IApprovalsService.ts`

~~Both `getApproval` implementations throw "not implemented".~~

**Resolved (S31):** `getApproval(id)` is live in both services as a fresh single-row read
by the retained SP numeric item Id (never a parsed APR Title), returning the mapped row
plus its current ETag. null strictly means not-found; an existing-but-corrupt row raises
`ApprovalQueryIntegrityError` (ERR-036). Consumers: the S31 freshness preconditions for
execution, review (approve/reject), and all three stamp-recovery hooks, whose subsequent
MERGEs are ETag-bound. Hosted-verified 2026-07-05 (stale review/execution drills).

---

### TD-07 — `listApprovals` missing `targetPersonId` filter
**Severity:** 🟠 → ✅ **Resolved in Sprint 31**
**Sprint attributed:** S18 (interface as-built), S31 (resolved)
**File:** `IApprovalsService.ts`, `SharePointApprovalsService.ts`, `MockApprovalsService.ts`, `usePersonApprovals.ts`

~~`listApprovals(filter?: { status?: string[] })` has no `targetPersonId` parameter;
`usePersonApprovals` fetched all statuses and filtered client-side (see TD-19).~~

**Resolved (S31):** the dedicated `listApprovalsByPerson(personId)` method performs a
complete, exhaustively paged, server-side OData filter on the (now live-indexed)
`TargetPersonID` column with OData literal escaping, ordered by numeric Id desc.
`usePersonApprovals` was rewritten onto it — the client-side workaround is gone. The
legacy `listApprovals` remains contract-frozen with no production consumer; the person
filter was deliberately delivered as a semantic method rather than a filter widening.
Hosted-verified 2026-07-05 (person-history completeness vs direct SP filter).

---

### TD-08 — Approval History tab not visible (Rejected/Executed/ExecutionFailed)
**Severity:** 🟠 → ✅ **Resolved in Sprint 20 Phase 1**
**Sprint attributed:** S18 (deferred), S20-P1 (resolved)
**File:** `ApprovalInbox.tsx`

`ApprovalInbox` queries only `['Submitted', 'InReview', 'Approved']`. Rejected, Executed,
and ExecutionFailed records are invisible to all users. `ApprovalCard` already renders all
terminal-state fields.

**Resolution (S20-P1):** `ApprovalInbox` now fetches all statuses in a single `listApprovals`
call with client-side tab filtering. Six tabs: Pending / Approved / Executed / Rejected / Failed
/ All. `ReviewedAt`, `RejectionReason`, and `ExecutionError` are surfaced in card detail views.
See S20-P1 commit and Sprint 20 Closeout Report.

**S21-P2 extension:** `usePersonApprovals` extends the same all-status fetch to power the
PersonProfile Approvals tab (read-only person-scoped view, shared query cache with ApprovalInbox).

---

### TD-09 — No mode-aware NavRail gating (stub screens appear active in SP DSM)
**Severity:** 🔴 → ✅ **Partially resolved in Sprint 20 Phase 0 (Amendments only)**
**Sprint attributed:** S9 (NavRail origin), S20-P0 (partial mitigation)
**File:** `NavRail.tsx`

Prior to S20-P0, all NavRail items appeared in both Mock and SP DSM regardless of adapter
readiness. The `visibleWhen` predicate accepted only `(role, caps)` — no data source awareness.

Resolved for Amendments (TD-03) by extending `visibleWhen` to accept `dataSourceMode` as a
third argument. Other screens with stub or partial SP adapters (SituationRoom Missions,
Finance) are not suppressed because they degrade gracefully (return empty, show error states)
rather than silently returning false data.

---

### TD-10 — Package versions all `0.0.0`
**Severity:** 🟡 Quality gap
**Sprint attributed:** Project inception
**Files:** All `package.json` files: `@geekay/c3`, `@geekay/c3-runtime`, `c-3-spfx-host`

All workspace packages carry `0.0.0` versions. `@geekay/platform-sdk` is at `0.1.0`.
No published packages are consumed externally, so this has no functional impact for beta.

**Resolution:** Coordinate semantic versioning at release prep / public launch.

---

### TD-11 — PartialExecution recovery not implemented
**Severity:** 🟠 → ✅ **Resolved in Sprint 20 Phase 2**
**Sprint attributed:** S18 Phase 4 (known gap), S20-P2 (resolved)
**File:** `useRecoverExecutionStamp.ts` (new), `useActiveJourney.ts` (updated), `ApprovalInbox.tsx` (updated)

`PartialExecutionError` is thrown when a C3Journeys row is successfully created (Step 4) but
the C3Approvals stamp to Executed fails (Step 5). The journey is valid; the approval remains
at `Approved` with no `ExecutedAt`. Previously, there was no in-app recovery path — operators
had to manually edit the SP record.

**Resolution (S20-P2):**
- New hook `useRecoverExecutionStamp`: stamps the approval Executed without creating a new
  journey. Guards: approvalStatus must be `Approved`, operationType must be `InitiateJourney`,
  payload must contain a parseable `personId`, and an active Onboarding journey must be
  confirmed at stamp time via `getActiveJourney` (safety re-check).
- `ApprovalInbox` / `ApprovalCard`: for Approved + InitiateJourney cards only, a lazy
  `useActiveJourney` query checks whether an active Onboarding journey exists. If so, the
  Execute button is replaced by a "Recover Execution Stamp" button with a warning callout.
  Normal Execute behavior is unchanged.
- `useActiveJourney`: added optional `enabled` parameter (default `true`) so the journey check
  can be suppressed for non-recovery-candidate cards. All existing callers unchanged.
- No schema changes. No service interface changes.

**Known beta limitation:** If someone manually creates a C3Journeys row in SP after an approval
is set to Approved but before execution, the Recover button may appear incorrectly. In a
controlled beta environment where SP is not modified manually, this will not occur.

**Resolution commit:** Sprint 20 Phase 2 source commit.

---

### TD-12 — Approval audit visibility (who reviewed, when)
**Severity:** 🟠 → ✅ **Partially resolved — S20-P1 + S21-P2**
**Sprint attributed:** S18 (deferred), S20-P1 (ApprovalInbox history tabs), S21-P2 (PersonProfile Approvals tab)

The `ReviewedBy` and `ReviewedAt` fields are written to SP on `patchApprovalStatus` but were
not surfaced in any screen except `ApprovalCard` (visible only to inbox users). No audit log
view existed for tracking who approved or rejected what, and when.

**Resolution (S20-P1):** `ApprovalInbox` history tabs (Executed / Rejected / Failed) now surface
`ReviewedBy`, `ReviewedAt`, `RejectionReason`, and `ExecutionError` on audit cards.

**S21-P2 extension:** `PersonApprovalHistoryCard` in PersonProfile Approvals tab renders the same
audit fields in a person-scoped read-only view. Rejection reason, execution error, and executedAt
are surfaced for the specific person.

**Remaining gap:** No full cross-person audit log (all approvals by reviewer, all approvals in a
date range). Full audit log is deferred post-beta.

---

### TD-13 — Credential write path not implemented
**Severity:** 🟠 → ✅ **Resolved in Sprint 20 Phase 3 (with partial-execution caveat)**
**Sprint attributed:** Deferred per S20 scope boundary (origin), S20-P3 (resolved)
**File:** `SharePointCredentialService.ts`, `useSubmitCredentialApproval.ts` (new),
`useExecuteApproval.ts` (extended), `AddCredentialPanel.tsx` (updated), `ApprovalInbox.tsx` (updated)

`addCredential` and related write operations were not implemented for SP DSM. In SP DSM,
credential creation silently failed or threw. All credential views were read-only.

**Resolution (S20-P3):**
- `SharePointCredentialService.addCredential` implemented with POST-then-MERGE (same pattern
  as journey and approval services). POSTs to `C3Credentials` with a `TMP-<Date.now().toString(36)>`
  placeholder title, receives the SP integer ID, derives `CRED-XXXX`, and MERGEs the canonical
  title back. CredentialType is validated against `VALID_CREDENTIAL_TYPES` before the POST.
- **ADR-013 governance gate**: In SP DSM, `AddCredentialPanel` no longer calls
  `addCredential` directly. Instead, `useSubmitCredentialApproval` creates a `C3Approvals`
  record (`operationType: AddCredential`) and returns an approval title. No `C3Credentials`
  row is written from the UI in SP DSM.
- `useExecuteApproval` dispatches on `operationType`. The `AddCredential` branch validates
  the payload, calls `credentialService.addCredential`, then stamps the approval `Executed`.
  No duplicate guard (multiple credentials of the same type are valid per person).
- `PartialCredentialExecutionError` thrown when the credential row was created but the
  `Executed` stamp failed. Operator must manually update C3Approvals.
- Mock DSM behavior: `AddCredentialPanel` continues to call `addCredential` directly
  (bypasses approval). No change to mock workflow.
- No C3Credentials schema change. No C3Approvals schema change.

**Known gap — partial credential execution recovery:**
There is no in-app recovery UX for `PartialCredentialExecutionError` (analogous to TD-11
`PartialExecutionError` before S20-P2). If the credential write succeeds but the approval
stamp fails, `ApprovalInbox` shows a `PartialCredentialExecutionError` toast and the approval
remains at `Approved` status. Operator must manually set the approval to `Executed` in SP.
Credential recovery UX (equivalent to `useRecoverExecutionStamp` for credentials) is deferred
post-S20.

**S21-P1 update:** `useRecoverCredentialExecutionStamp` was implemented in Sprint 21 Phase 1,
providing an in-app Recover Execution Stamp button on AddCredential cards that remain in
`Approved` state. The hook confirms the credential row exists before stamping — stamp-only,
no new row created. Caveat: if the card has already transitioned out of the `Approved` state
(e.g., after a page reload between partial execution and recovery), recovery detection does
not trigger. Manual SP recovery (`ApprovalStatus = Executed`, `ExecutedAt` set manually)
remains the fallback in that case. See ERR-006 in C3 Error Library.

**Resolution commit:** Sprint 20 Phase 3 source commit (core); Sprint 21 Phase 1 source commit (recovery UX).

---

### TD-14 — No CI/CD pipeline
**Severity:** 🟡 Quality gap
**Sprint attributed:** Project inception (deliberate deferral)

No automated build, test, or deploy pipeline. Validation is manual (parity scripts + tsc +
build:runtime). Regression risk increases as the surface area grows.

**Resolution:** Set up GitHub Actions (or equivalent) with: tsc check, parity harness run,
build:runtime, and SPPKG bundle validation. Not in S20 scope.

---

### TD-15 — Runtime bundle committed to git (dual tracking)
**Severity:** 🟡 Quality gap
**Sprint attributed:** S15 (first bundle commit)

Two copies of `c3-runtime.js` are tracked:
- `packages/c3-runtime/dist/c3-runtime.js` (build output)
- `packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js` (SPFx deployment copy)

Committed bundles bloat the repo and create merge-conflict risk. The pattern was adopted
for deployment simplicity before CI/CD exists.

**Resolution:** Once CI/CD is in place (TD-14), bundles should be generated on deploy and
not committed. Until then, the dual-commit pattern is accepted. Bundle files are committed
on a separate source-agnostic commit to keep the diff reviewable.

**S21-P4 partial mitigation:** Added `npm run beta:runtime` to combine
`build:c3-runtime` + `copy:c3-runtime` into a single command, and
`npm run verify:runtime` (`scripts/verify-c3-runtime.mjs`) to confirm both the
dist-runtime build output and the tracked SPFx host asset exist, are non-empty,
and have identical SHA-256 hashes. Reduces the manual error surface without
removing the dual-commit pattern. The underlying tech debt (tracked bundle,
repo bloat) remains open until TD-14 (CI/CD) is resolved.

---

### TD-16 — ToasterGuard temporary workaround
**Severity:** 🟡 Quality gap
**Sprint attributed:** S18 (introduced)
**File:** Check `useToast` / toast provider implementation

A `ToasterGuard` (or equivalent) was introduced as a workaround for FluentUI v9 toaster
context availability. This is a temporary measure until the component lifecycle is clarified.

**Resolution:** Review FluentUI v9 `Toaster` provider placement and remove the guard once
the root cause is understood.

---

### TD-17 — No license file
**Severity:** 🟡 Quality gap
**Sprint attributed:** Project inception

No `LICENSE` file exists at the repo root. This is acceptable for a private internal tool
but should be resolved before any open-source release or third-party distribution.

**Resolution:** Add appropriate license (likely MIT or proprietary) at release prep.

---

### TD-18 — React Query config: reviewed and accepted
**Severity:** ✅ Reviewed and accepted (S20-P0)
**Sprint attributed:** S18 (configured), S20-P0 (reviewed)
**File:** `packages/c3/src/queryClient.ts`

Config reviewed in Sprint 20 Phase 0:
```
staleTime: 2min  — appropriate for operational data
gcTime: 10min    — acceptable cache retention
— correct for SP REST (avoids auth failure loops)
refetchOnWindowFocus: false — correct for SPFx embedded context
```
No changes required. Documented here for completeness.

---

---

### TD-19 — Approval list top-500 truncation risk in person-scoped history
**Severity:** 🟠 → ✅ **Resolved in Sprint 31 (approval surface only)**
**Sprint attributed:** S21 Phase 2 (identified), S31 Phase 0 (full consequence set found), S31 (resolved)
**File:** `SharePointApprovalsService.ts`, `usePersonApprovals.ts`, `useSubmitParticipantApproval.ts`, `ApprovalInbox.tsx`

~~`listApprovals` capped at `$top=500` with client-side person filtering.~~ S31 Phase 0
established the full consequence set: silent person-history truncation, inbox recovery
invisibility for actionable rows older than the newest 500 (incl. ExecutionFailed), and a
duplicate-pending guard that would FAIL OPEN past 500 pending-band rows.

**Resolved (S31):** all approval reads moved to complete, exhaustively paged, fail-closed
queries ordered by numeric Id desc (indexed): pending and actionable sets are complete at
any list size; person history is complete and server-filtered; terminal history is a
DELIBERATE, truthfully-labelled window; the duplicate guard fails closed. Live indexes
applied and verified 2026-07-05 (ItemCount 35, highest Id 52 at verification).
Hosted-verified via Part 18.1/18.2 completeness and ordering checks.

**Scope note:** this resolution covers exactly the implemented APPROVAL read surface.
Top-N patterns elsewhere (people/credentials $top=2000, missions/participants/kit
$top=500) remain tracked under "top-N cap inconsistencies" — NOT resolved here.

---

### TD-20 — `deactivateCredential` not implemented

**Severity:** 🟠 → ✅ **Resolved in Sprint 23 Phase 1**
**Sprint attributed:** S20-P3 (credential write path implemented; deactivation deferred)
**File:** `packages/c3/src/services/sharepoint/SharePointCredentialService.ts`

~~The `deactivateCredential` method is not implemented in the SP service (stub or not present).
Operators cannot deactivate credentials through the C3 UI. The credential `IsActive` flag
must be set manually in the `C3Credentials` SP list.~~

**Resolved (S23-P1):** `SharePointCredentialService.deactivateCredential` is now fully
implemented as a simple MERGE on the C3Credentials SP item setting `IsActive = false`.
No new SP list row is created — the existing CRED-XXXX row is updated in place.

The full governed path is live:
- SP DSM: PersonProfile "Deactivate" button (owner/operations only) → `useSubmitDeactivationApproval` → `C3Approvals` record (OperationType: DeactivateCredential, status: Submitted). Owner reviews and executes in ApprovalInbox. Execution calls `deactivateCredential` (MERGE IsActive = false) + stamps approval Executed.
- Mock DSM: direct `deactivateCredential` call (no approval submitted). Cache invalidated immediately.
- Partial execution recovery: `useRecoverDeactivationExecutionStamp` (S23-P1) stamps Executed without re-applying the MERGE. `ApprovalInbox` recovery detector uses `useGetCredential` to detect `IsActive = false` and shows the recovery path automatically.

Beta Checkpoint Part 14 caveat removed (S23-P1 update). ERR-020 and ERR-021 added to C3 Error Library.

---

### TD-21 — No audit timestamp columns for journey lifecycle transitions

**Severity:** 🟡 Quality gap
**Sprint attributed:** S20-P2 (lifecycle transitions implemented; audit timestamps deferred)
**File:** `C3Journeys` SP list, `packages/c3/src/services/sharepoint/SharePointJourneyService.ts`

Journey lifecycle transitions (Suspend, Cancel, Complete) are recorded via a Notes-append
pattern in the `C3Journeys` record, but there are no dedicated timestamp columns
(`SuspendedAt`, `CancelledAt`, `CompletedAt`) in the SP list schema. This means there is
no machine-readable record of when a specific lifecycle transition occurred — only the
narrative Notes append.

This gap is noted in Beta Checkpoint (Sprint 21) Part 14 as a known operational caveat.
It is a quality gap, not a blocking issue for beta.

**Resolution:** Add `SuspendedAt`, `CancelledAt`, `CompletedAt` (Date and Time columns)
to the `C3Journeys` SP list schema. Update `SharePointJourneyService` lifecycle methods
(`suspendJourney`, `cancelJourney`, `completeJourney`) to populate the respective timestamp
alongside the `Status` transition MERGE. Schema change required — plan with SP list
migration if live data already exists.



### TD-22 — Legacy `C3_Contracts` list not migrated to `C3Contracts`

**Severity:** 🟡 Quality gap
**Sprint attributed:** S24-P0 (identified at schema definition time)
**Files:** Legacy `C3_Contracts` SP list (SharePoint); `packages/c3/src/services/sharepoint/SharePointContractService.ts`

Sprint 24 Phase 1 targets the new `C3Contracts` list (CamelCase, PersonID FK model). The legacy
`C3_Contracts` list (underscore naming, SP lookup columns for `Person`, `Team`, `GameTitle`) is
left in place as a historical reference and is not migrated in this sprint.

Consequences:
- Contract history from `C3_Contracts` is not visible through the C3 application after S24-P1 implementation
- Any contracts entered in `C3_Contracts` must be manually re-entered in `C3Contracts` if needed in C3
- The legacy list can be decommissioned once migration is complete

**Resolution:** Build an import/export tool or migration script to transfer `C3_Contracts` rows
to `C3Contracts`, mapping SP lookup column values to plain-text `PersonID` (PER-XXXX) via the
`C3People` list. Assign to Import/Export track (Track 16 in Product Expansion Backlog). Not in S24 scope.

---

### TD-23 — Intelligence SP DSM cold-load crash

**Severity:** 🟠 Beta UX risk, contained
**Sprint attributed:** S24 Phase 1
**Status:** Open / Deferred
**Files:** `packages/c3/src/intelligence/useIntelligence.ts`, `packages/c3/src/components/layout/NavRail.tsx`

In hosted SP DSM, the first navigation into Intelligence after a hard refresh triggers an
ErrorBoundary with `Cannot read properties of undefined (reading 'set')`. The crash occurs during
the initial cold-load render cycle. ErrorBoundary reset (added in S24-P1 commit `28b9d77`)
prevents app-wide lockup, and a second navigation into Intelligence works correctly, but the
first-load crash remains unresolved after extensive investigation.

Root cause investigation summary:
- All Maps in `intelligenceMetrics.ts` are locally initialized (`new Map()`) — not the source
- React Query v5 `isLoading = isPending && isFetching`; on first render `fetchStatus` starts as
  `'idle'` before effects run, producing `isLoading = false` with `data = undefined`. This flash
  causes Intelligence to mount Fluent UI Card style-cache Maps then immediately unmount them
  when the fetch starts in effects — likely triggering the cleanup `.set()` call on a torn-down Map
- `isPending` fix applied (commit `46b193d`) addresses the flash hypothesis; result unconfirmed
  in hosted SP DSM due to decision to contain and defer rather than continue debugging loop

**Mitigation:** Intelligence is hidden in SP DSM NavRail via `visibleWhen` guard. Intelligence
remains fully visible and functional in Mock DSM. Data, contracts, people, credentials, and
all other screens are unaffected.

**Resolution:** Re-enable Intelligence in SP DSM after the following are confirmed:
1. Hard-refresh first-click into Intelligence in hosted SP DSM does not trigger ErrorBoundary
2. Verify against a provisioned `C3Contracts` list with real contract data
3. Investigate Fluent UI Card/Griffel style-cache teardown behavior if crash recurs after `isPending` fix
4. Remove `visibleWhen` guard from NavRail Intelligence item

### TD-24 — Email field missing from C3People SP list

**Severity:** 🟡 Quality gap
**Sprint attributed:** S25 (identified at AddPerson implementation time)
**File:** `docs/architecture/C3People SP List Schema.md`, `packages/c3/src/types/people.ts`, `packages/c3/src/components/shared/AddPersonPanel.tsx`

The `C3People` SP list — provisioned in Sprint 16 — has no `Email` column in its schema. The
`Person` TypeScript type and `CreatePersonInput` therefore omit an email field. `AddPersonPanel`
deliberately omits an Email input for this reason (noted in the panel's implementation comments).

> **S26 repair note:** this entry was truncated mid-sentence in commit `2020180` (S25 closeout)
> by the sandbox file-corruption issue documented in the handoff package (§9.4). The text from
> this point on was reconstructed in Sprint 26 from the S25 closeout context.

Consequences:
- No email-based duplicate detection at AddPerson time — duplicate protection relies on
  FullName/PersonnelCode review by the approving owner
- No email available for future notification flows (Power Automate approval notifications)

**Resolution:** Add an `Email` column to `C3People`, extend `Person` / `CreatePersonInput` and
the AddPerson form, and add a duplicate-email check to the governed AddPerson execution path.
Requires a schema change + provisioning coordination; assign to a post-beta hardening sprint.

---

### TD-25 — SP DSM missions nav hidden pending C3Missions provisioning

**Severity:** 🟡 Beta containment (by design)
**Sprint attributed:** S26 (Mission/Event Read Foundation)
**Status:** ✅ **Resolved — S26-5 (2026-07-02).** Guard removed; Missions visible in SP DSM.
**Files:** `packages/c3/src/components/layout/NavRail.tsx`, `packages/c3/src/services/sharepoint/SharePointMissionService.ts`, `docs/architecture/C3Missions SP List Schema.md`

Sprint 26 implemented the native-fetch SP read path (`listMissions` / `getMission`) and the
read-only Mission Workspace before the `C3Missions` list existed. The Missions NavRail item was
hidden in SP DSM (locked beta-containment pattern) until provisioning and verification.

**Resolution record (S26-5):**

1. `C3Missions` provisioned — but the first provisioning pass was **defective**: the list
   pre-existed the provisioning script (created via grid/Excel import), so 11 columns carried
   `field_1`–`field_14` internal names, `Entity` was missing `Multi`, `OperatingCurrency` had
   wrong choice values, and the three span-date columns (script-added, correctly named) were
   never populated. The mapper correctly hard-rejected both rows — the exact failure mode the
   internal-name verification step in the schema doc §8.3 exists to catch.
2. Remediated in place (non-destructively, user-approved): malformed columns display-renamed
   `zzOLD *`; 11 correctly-named columns created via `CreateFieldAsXml` (exact internal names,
   correct choice sets); row data copied across; span dates written as explicit UTC midnight
   (site regional timezone is UTC-8 — UI-local date entry risks off-by-one); Date-Only display
   format and Required flags set; `Title` display-named "Mission ID" and required.
3. Verified against the live list: internal names exact (`MissionStatus`, not `Status0`);
   `Entity`/`MissionStatus`/`OperatingCurrency` choice sets match the TypeScript unions;
   both service queries return correct data; real rows through the real `spMissionMapper`:
   **2 mapped, 0 rejected, 0 warnings**, dates exact.
4. NavRail guard removed (this change).

**Residual items:**
- The `zzOLD *` columns (field_1–field_14) remain on the list as deprecated duplicates —
  delete them in the SharePoint UI at leisure (no app dependency on them).
- Hosted MissionWorkspace / SituationRoom smoke test requires the S26 runtime to be deployed
  (the currently deployed S25 runtime still stubs missions). Run Beta Checkpoint — Sprint 26
  Part 12.3 with the first S26 deployment.

---

### TD-26 — SP mission confirmation write path deferred

**Severity:** 🟠 Beta safety risk — contained S27-1
**Sprint attributed:** S27 Phase 0 (hosted S26 validation observation)
**Status:** Open — write path deferred; action hidden in SP DSM
**Files:** `packages/c3/src/screens/SituationRoom.tsx`, `packages/c3/src/services/sharepoint/SharePointMissionService.ts`, `packages/c3/src/hooks/useApproveMission.ts`

The Situation Room "Approve & Confirm Mission" action bar (Sprint 13, S13-4) was gated only on
`Mission.Status === 'FinancePending'` — no data-source or capability check. When Sprint 26
enabled live SP mission reads, a FinancePending SP mission surfaced the button in SP DSM while
`SharePointMissionService.confirmMission` remains a **throwing stub**: clicking showed
"Confirming…", the stub threw, and the mutation error was never surfaced — a false affordance
with silent failure. No data was ever written (the throw precedes any network call).

**Containment (S27-1):** the action is **hidden** (not disabled) in SP DSM via a
`config.dataSourceMode !== 'sharepoint'` guard at the `onApprove` site. Mock DSM confirmation
behaviour is unchanged (demo/regression flow). The zero-gap empty-state copy was also corrected
so that zero participants no longer implies "all participants hold required credentials".
**Containment hosted-verified 2026-07-03** (S27 hosted validation: no confirm action in SP DSM,
Mock DSM flow intact).

**Resolution:** a future sprint must design the SP mission confirmation write explicitly —
either an ADR-013 governed operation (ConfirmMission approval type) or a documented role-gated
lifecycle exemption, decided deliberately. **No direct SP lifecycle write may be introduced
silently**, and the NavRail/action guard pattern applies until the write path exists and is
hosted-validated. Capability-gating the Mock DSM button (currently visible to all roles in
demo mode) can be considered in the same design pass.

---

### TD-27 — Mission-operations write paths deferred (Sprint 29 scope)

**Severity:** 🟡 Planned work, not a defect
**Sprint attributed:** S27/S28 (read foundations shipped write-free by design)
**Status:** ✅ **RESOLVED (S29B, 2026-07-03).** Kit writes (S29A), apparel writes (S29A),
and participant add/remove (S29B — full ADR-013 governed incl. reactivation, kit-dependency
blocking, and immutable Add-only approval submission) are all complete and hosted-validated.
Remaining adjacent items tracked separately: UpdateMissionParticipant, generic reactivation
UI, and kit metadata edits are **deferred** (workarounds documented); TD-26 (mission
confirmation) unchanged.
**Gate note (mandatory):** the strict build TypeScript path (`tsc -b` via `beta:runtime`)
is a required part of the validation gate — plain `tsc --noEmit` missed real build failures
twice during S29 (unused import; un-destructured props). Tooling improvement (folding the
strict path into a single gate command) remains an open item.
**S29B hardening patch:** approval submissions are now a single Add-only POST (no Title
MERGE); the ApprovalID derives from the SP item Id; the `C3 Approval Submitter` level
excludes EditListItems entirely — **submitted approval rows are immutable to their
creator** (the previously documented own-row tamper window is closed).
**Files:** `SharePointMissionService.ts`, `SharePointApparelProfileService.ts`, related hooks/UI

The S27/S28 read foundations deliberately shipped without writes. Until Sprint 29 delivers
them, the following operational-truth changes happen only by direct SharePoint list edits
(outside ADR-013 governance — the standing gap that motivates the S29 write sprint):

- **Participant writes** — AddMissionParticipant / RemoveMissionParticipant
- **Kit writes** — AddKitAssignment + KitStatus lifecycle transitions
  (Returned/Replaced/Missing states are provisioned but have no transition path)
- **Apparel profile writes** — create/edit/deactivate

**Resolution (S29):** Phase 0 must classify each operation individually — full ADR-013
approval / documented lifecycle exemption / role-gated profile update / owner-only transition
— before implementation. The write design must also cover: dual-cache invalidation
(`mission.participants(id)` + `mission.allParticipants()` + kit/apparel keys), MissionID+
PersonID(+AssignmentKey) uniqueness enforcement at write time, NameOnJersey/AssignmentKey
write-time validation, and the mutation error-surfacing sweep (no silent-failure mutations —
the useApproveMission onError gap is the known anti-pattern).

---

### TD-28 — Inherited site ACLs on core operational lists (ADR-013 governance bypass)

**Severity:** 🔴 → ✅ **Resolved in Sprint 30 (C3Contracts residual deferred)**
**Sprint attributed:** S29A (finding), S29B (partial — governance lists), S30 (resolved)
**Evidence:** `C3 Platform ACL Review — Sprint 30.md`

C3People, C3Credentials, C3Journeys, and C3Missions inherited site permissions: site
Members held Edit and C3 Legal held Full Control on operational-truth rows — a standing
bypass of every ADR-013 governed write path, and (from S30) a direct integrity risk to
the Mission Readiness Cockpit's computed verdicts.

**Resolved (S30, 2026-07-04):** all four lists hardened to verified unique
least-privilege ACLs via the rev 2 browser-console package (source write-path audit →
owner-confirmed matrices → unique-child-scope preflight →
`breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false)` → explicit grants
→ direct-endpoint verification → per-role hosted tests). Operations retain Edit on
C3Journeys (S19 lifecycle exemption) and C3Missions (owner-confirmed manual authoring);
all other non-owner roles and site Members are Read. Zero child ACL scopes disturbed.

**Residual (open):** C3Contracts still inherits site permissions — its ACL posture is
deliberately deferred to the C3Contracts provisioning/activation decision (see TD-22 and
Backlog Track 5). The rev 2 hardening package applies unchanged when that decision lands.

---

### TD-29 — Residual simultaneous-execution race on approvals

**Severity:** 🟡 Quality gap (bounded by S31 freshness + ETag stamps)
**Sprint attributed:** S31 (recorded at implementation of the freshness/ETag model)
**Files:** `hooks/useExecuteApproval.ts`, `hooks/usePatchApprovalStatus.ts`, recovery hooks,
`SharePointApprovalsService.ts`

Sprint 31 added a fresh single-row `getApproval` read before execution, review, and
stamp-recovery actions: the FRESH row drives the status precondition and its ETag
preconditions the subsequent MERGE (no new `IF-MATCH: *`). This eliminates STALE
SEQUENTIAL actions — a tab acting on a row whose live status changed gets a truthful
refusal or a 412, never a silent write.

It is deliberately NOT an atomic execution lock. Two sessions that both pass the
freshness read within the same window can both perform the OPERATIONAL write before
either stamps; the second stamp then 412s into the existing partial-execution recovery
path, but the duplicate operational effect may already exist (AddCredential has no
duplicate guard by design; participants/journeys are protected by their own idempotency
and duplicate checks). Source inspection (S31 Phase 0) confirmed no existing atomic
safeguard.

**Mitigation in place:** single-owner execution in practice; freshness refusal window;
ETag-412 surfacing; operation-level idempotency where it exists.
**Resolution path:** an explicit execution-claim design (e.g. a claimed-by MERGE with
ETag as an atomic take) or operation-level idempotency for the remaining unguarded
operations — a deliberate future owner decision, NOT to be introduced silently
(excluded from S31 scope by mandate). **Status at S31 closeout: OPEN by design.**

---

### TD-30 — Validation gate can mask a strict-build failure (piped exit codes)

**Severity:** 🟠 Process risk (occurred once during S31; caught before deployment)
**Sprint attributed:** S31 (consumer failure-state pass, 2026-07-05)
**Surface:** validation workflow (no product source involved)

During the S31 consumer pass, `npm run beta:runtime 2>&1 | tail -2` masked a nonzero
strict-build exit (the pipeline's exit code is `tail`'s), and `verify:runtime` then
PASSED against two matching but STALE bundles — producing an unchanged runtime SHA
after source changes. The failure (an unused local only the strict `tsc -b` path
catches — the project's third such catch) was detected only because an unchanged SHA
after source edits was treated as a warning signal.

**Operational rules (effective immediately):**
1. Never pipe `beta:runtime` (or any gate step) in a way that discards its exit code —
   run it unpiped or under `set -o pipefail` with the code checked.
2. An unchanged runtime SHA after source changes is a red flag: investigate before
   trusting `verify:runtime` (it proves dist/asset CONSISTENCY, not freshness).

**Resolution:** one canonical fail-fast validation command (script) that preserves every
exit code and runs, in order: all parity gates, both TypeScript checks, the strict
build, runtime verification, and the NUL audit. Owned as a process-hardening backlog
item (candidate to pair with the next sprint); NOT implemented during S31 closeout.
Related: TD-27 gate note (strict-build path mandatory).

---

## Sprint 32 review (2026-07-05)

### TD-30 — RESOLVED (S32 P1)

The canonical fail-fast gate exists: `scripts/validate-gate.mjs` (`npm run gate`) —
explicit ordered parity list (13 harnesses), both tsc checks, unpiped strict build,
runtime verification, NUL audit; shell-free spawns with full error/status/signal
inspection and a documented `--self-test-failure` proof. In mandatory use since
S32 P1; unchanged-SHA warning implemented as an investigation trigger.

### TD-29 — REVIEWED and RETAINED (explicit decision, S32 closeout review)

The residual two-session simultaneous-execution race on approvals stands as
accepted debt for Internal V1.0: freshness reads + actual-ETag preconditions bound
the window; the practical exposure (two owners executing the same approval within
the same seconds) is operationally negligible for the current single-owner
execution model. Revisit if a second executing owner is onboarded.

### TD-22 — hosted progress (S32; resolution pending Part 19.4)

Canonical C3Contracts provisioned + hosted-verified (Phase 3C, fingerprint
`3a13b28f…`); mock rows recycled and legacy schema remediated in place; read-only
contract service compatible and fail-closed; exact five-principal ACL hosted-green
(Phase 3D); hosted Contracts + Renewals truthful (Part 19.1/19.3). REMAINING for
resolution: hosted Contract Profile truthfulness against one real owner-authored
row (Part 19.4).

### TD-31 — Inert "New Contract" button on ContractsList

**Severity:** 🟢 Cosmetic/UX debt
**Sprint attributed:** S24 (mock-era header action), surfaced by S32 Part 19
**Files:** `packages/c3/src/screens/ContractsList.tsx` (~line 396)

The header action `<Button appearance="primary">New Contract</Button>` has no
onClick handler — hosted click produces no dialog, navigation, or network request
(Part 19 evidence). Not a write path (the contract service is read-only and s32
parity forbids mutation surfaces), but a dead primary button implies a capability
that does not exist. Remove or gate behind a real governed flow post-V1.

### TD-32 — Stale denormalized TotalContracts on the People register

**Severity:** 🟡 Truthfulness gap (non-Contracts surface)
**Sprint attributed:** S16 (people register column), surfaced by S32 Part 19
**Files:** `packages/c3/src/screens/PeopleWorkspace.tsx` (~line 230); C3_People list

The People register "Contracts" column renders the stored `TotalContracts` field
from C3_People — a mock-era denormalized count that now reads 2/1 while the
canonical C3Contracts list is empty. Replace with a live derivation from the
canonical list (or drop the column) so zero/missing canonical data is never
contradicted by a stale rollup.
