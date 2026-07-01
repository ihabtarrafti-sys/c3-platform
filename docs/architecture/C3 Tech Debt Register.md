# C3 Tech Debt Register

**Last updated:** 2026-07-01 (Sprint 21 Phase 4)
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
**Severity:** 🟠 Latent risk
**Sprint attributed:** S13 (origin — predates native-fetch migration)
**File:** `packages/c3/src/services/sharepoint/SharePointContractService.ts`

All SP services written in S15–S19 use native `fetch` with `credentials: 'same-origin'`,
`X-RequestDigest`, and the `application/json;odata=verbose` pattern. `SharePointContractService`
predates this migration and uses `@pnp/sp` (PnP.js) with `spfi`. This creates:
- Bundle size overhead from the PnP.js package
- A different auth and error propagation model vs. all other SP services
- Risk of divergence when PnP.js upstream changes

**Risk level:** Low in beta — contract service is read-only; no writes go through PnP.js.

**Resolution:** Rewrite `SharePointContractService` using native fetch following the S15-S19
pattern. Not in S20 scope.

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
**Severity:** 🟡 Quality gap
**Sprint attributed:** S18 (stub placeholder)
**File:** `MockApprovalsService.ts`, `SharePointApprovalsService.ts`

Both `getApproval` implementations throw "not implemented". No screen or hook currently
calls this method, so there is no user-visible impact. If a future screen calls it, it will
crash.

**Resolution:** Implement when a consumer requires single-approval fetch (e.g., deep-link
to an approval by ID). Not in S20 scope.

---

### TD-07 — `listApprovals` missing `targetPersonId` filter
**Severity:** 🟠 Latent risk
**Sprint attributed:** S18 (interface as-built), S20 Phase 1 (planned resolution)
**File:** `IApprovalsService.ts`, `SharePointApprovalsService.ts`, `MockApprovalsService.ts`

`listApprovals(filter?: { status?: string[] })` has no `targetPersonId` parameter.
`PersonProfile` History tab (S20 Phase 1) needs to show approvals scoped to a single person.
Without this filter, either all approvals are fetched and client-filtered (inefficient) or
the history tab cannot be built.

**Resolution:** Add `targetPersonId?: string` to the filter type and implement OData
`$filter=TargetPersonID eq '${targetPersonId}'` in the SP service. Planned for S20 Phase 1.

---

### TD-08 — Approval History tab not visible (Rejected/Executed/ExecutionFailed)
**Severity:** 🟠 Latent risk — beta gap B7
**Sprint attributed:** S18 (deferred), S20 Phase 1 (planned)
**File:** `ApprovalInbox.tsx`

`ApprovalInbox` queries only `['Submitted', 'InReview', 'Approved']`. Rejected, Executed,
and ExecutionFailed records are invisible to all users. `ApprovalCard` already renders all
terminal-state fields. A History tab with two `useListApprovals` calls (terminal statuses)
is planned for S20 Phase 1.

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
**Severity:** 🟠 Latent risk — beta gap
**Sprint attributed:** S18 (deferred)

The `ReviewedBy` and `ReviewedAt` fields are written to SP on `patchApprovalStatus` but are
not surfaced in any screen except `ApprovalCard` (visible only to inbox users). No audit log
view exists for tracking who approved or rejected what, and when.

**Resolution:** Approval History tab (TD-08) will surface `ReviewedBy` / `ReviewedAt` fields
via the History tab. Full audit log is deferred post-beta.

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

**Resolution commit:** Sprint 20 Phase 3 source commit.

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
**Severity:** 🟠 Latent risk
**Sprint attributed:** S21 Phase 2 (identified at build time)
**File:** `packages/c3/src/services/sharepoint/SharePointApprovalsService.ts`, `packages/c3/src/hooks/usePersonApprovals.ts`

`listApprovals` SP query uses `$top=500`. `usePersonApprovals` (S21-P2) filters
client-side by `targetPersonId`. If C3Approvals exceeds 500 total records, the
PersonProfile Approvals tab will silently truncate results for any person whose
approvals fall outside the top 500 by submitted date.

**Risk level:** Not a concern in beta; becomes relevant at operational scale (~500+ total approval records).

**Recommended mitigation:**
- Add `targetPersonId?: string` to the `listApprovals` filter and implement
  OData `$filter=TargetPersonID eq '...'` in SP service (related to TD-07), or
- Add pagination support to `listApprovals`.

**Note:** TD-07 already tracks the missing `targetPersonId` filter on `listApprovals`
as a general latent risk. TD-19 specifically records the person-history truncation
consequence introduced by S21-P2's client-side filtering approach.

## Resolved Items (Sprint Archive)

| ID | Item | Resolution | Sprint |
|----|------|-----------|--------|
| ✅ | Derive-then-POST sequence number collision risk | Replaced with POST-then-MERGE (SP auto-ID) | S19 Phase 3 |
| ✅ | PersonProfile cancel confirm button invisible in dark/SP context | `var(--c3-critical, #DC2626)` inline fallback | S19 Phase 2 |
| ✅ | PersonProfile "Cancel" dismiss button confusing label | `'Go Back'` when action is cancel | S19 Phase 2 |
| ✅ | No SP role resolver (hardcoded mock roles in SP DSM) | `spRoleResolver.ts` queries SP groups | S19 Phase 1 |
| ✅ | Journey lifecycle transitions not gated by role | `canManageJourneyLifecycle` guard on all transition hooks | S19 Phase 2 |
| ✅ | No React Error Boundary | `ErrorBoundary.tsx` + AppShell wrap | S20 Phase 0 |
| ✅ | CommandCenter false "All clear" on SP failure | Error threaded through useWorkItems | S20 Phase 0 |
| ✅ | Amendments silent stub in SP DSM | NavRail mode gate | S20 Phase 0 |
