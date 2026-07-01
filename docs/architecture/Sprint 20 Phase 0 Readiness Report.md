# Sprint 20 Phase 0 — Beta UX / Repo Readiness Reconciliation Report

**Date:** 2026-07-01
**HEAD at assessment:** `1ba0c83` — Sprint 19 closeout + Beta RC Baseline Marker
**Scope:** Planning only. No code changes made. Deliverable: Parts A–F.

---

## Part A — Beta RC Baseline Status

| Item | Status |
|------|--------|
| HEAD | `1ba0c83` — clean |
| Baseline marker doc | ✅ exists: `docs/architecture/C3 Beta RC Baseline Marker.md` |
| git working tree | 16 pre-existing CRLF/config unstaged files — NOT C3 source |
| Sprint 19 scope | Complete: Phase 1–3 + PersonProfile dialog fixes |

**Verdict:** Beta RC baseline is valid and clean. No new baseline marker needed. All S19 work is committed and the bundle is at `60e7be0`.

---

## Part B — Feature Readiness Matrix

All 11 NavRail screens assessed against Mock DSM and SP DSM.

| Screen | NavRail Condition | Mock DSM | SP DSM | Beta Rec | Notes |
|--------|------------------|----------|--------|----------|-------|
| CommandCenter | all | ✅ | ✅ | **Ship** | No error render on hook failure — shows "All clear" silently (TD-02) |
| ContractsList | all | ✅ | ✅ | **Ship** | SP adapter uses PnP.js (TD-04); reads only; has error render |
| RenewalsCenter | non-visitor | ✅ | ✅ | **Ship** | Same PnP.js; has error render |
| PersonProfile | (nav only) | ✅ | ✅ | **Ship** | Full S15–S19 implementation; lifecycle transitions live |
| Inbox | non-visitor | ✅ | ✅ | **Ship** | Read-only personal contract queue; has error render |
| SituationRoom | all | ✅ | ⚠️ | **Ship w/ caveat** | Missions deferred, Finance deferred — reduced data in SP DSM; has error render |
| Intelligence | all | ✅ | ⚠️ | **Ship w/ caveat** | Derived from PnP.js contracts; has error render |
| **Amendments** | all | ✅ | 🔴 | **Disclose or gate** | SP adapter is a complete stub — all 3 methods return empty/null silently (TD-03) |
| ApprovalInbox | non-visitor | ✅ | ✅ | **Ship** | Full S18 implementation; no history tab (deferred S20 Phase 1) |
| Settings | canManageSettings | ✅ | ✅ | **Ship** | Intentional EmptyState placeholder |
| DeveloperDiagnostics | all | ✅ | ✅ | **Ship** | SP diagnostic checks live; has error render |

### Critical Finding — Amendments SP DSM

`SharePointAmendmentService` is a complete stub. All three methods (`listAllAmendments`,
`listContractAmendments`, `getAmendment`) log a warning and return empty/null. No error is
thrown. In SP DSM, the Amendments screen silently shows "no data" with no indication that
it is unimplemented. This is a user-facing false positive — indistinguishable from "there are
no amendments."

**Required action before beta go-live:** Pick one resolution (see Phase 0.3 below).

---

## Part C — Error Boundary Assessment

**No React Error Boundary exists anywhere in the codebase.**

Confirmed:
- `AppShell.tsx`: `renderScreen()` is called directly inside a `<div>` with no boundary wrapper.
- No `ErrorBoundary.tsx` or equivalent component exists in `packages/c3/src/`.

### Risk Breakdown

| Error class | Current behavior | Beta risk |
|-------------|-----------------|-----------|
| Async hook errors (React Query) | Caught by RQ → component renders error state | Low — most screens handle this |
| Hook error with no `error` render | `isLoading: false`, empty data → silent incorrect state | **Medium — CommandCenter shows "All clear"** |
| Render-phase throws (TypeError, null deref) | **Full white screen — entire app crashes** | **High — no recovery path** |

### Verdict

Error Boundary must be **Phase 0.1** — implement before any other S20 feature work. It is a
~35-line class component plus a 3-line change to `AppShell.tsx`. The safety net it provides
is disproportionately high relative to its effort.

---

## Part D — Repo Hygiene Findings

| Finding | Status | Action |
|---------|--------|--------|
| `packages/runtime-sdk` workspace entry | ✅ Package exists with `src/` — not stale | None |
| Dual bundle tracking (dist + spfx-host copy) | ✅ Intentional deployment artifact — both files serve a purpose | Document as accepted |
| 16 unstaged CRLF/config files | ✅ Pre-existing, not C3 source | None for S20 |
| Package versions all `0.0.0` | ✅ Acceptable pre-release convention | Resolve at release prep |
| SharePointContractService uses PnP.js | ⚠️ Inconsistent with S15–S19 native-fetch services | Log as TD-04 — low risk (read-only), defer |

No blocking repo hygiene issues. The PnP.js inconsistency is logged tech debt but has no
runtime risk in SP DSM since the contract service is read-only and the PnP.js adapter was
validated in earlier sprints.

---

## Part E — React Query Config Assessment

```ts
// packages/c3/src/queryClient.ts
defaultOptions.queries: {
  staleTime: 2 * 60 * 1000,   // 2 min
  gcTime:    10 * 60 * 1000,  // 10 min
  retry: 1,
  refetchOnWindowFocus: false,
}
```

| Setting | Assessment |
|---------|-----------|
| `staleTime: 2min` | ✅ Appropriate for operational data. Fresh enough for beta ops usage without hammering SP. |
| `gcTime: 10min` | ✅ Reasonable. Data stays in cache 10min after last observer unmounts. |
| `retry: 1` | ✅ Correct for SP REST. One automatic retry avoids false failures on transient 503s without looping on auth failures. |
| `refetchOnWindowFocus: false` | ✅ Correct for SPFx embedded context — tab focus events are noisy inside SharePoint pages. |
| No global `refetchInterval` | ✅ Correct. Per-query `refetchInterval` on `useListApprovals` is the right granularity. |
| No `throwOnError` | ✅ Correct. Async errors remain as RQ error state, not render-phase throws. |

**Verdict:** QueryClient config is well-tuned for the beta deployment context. No changes needed.

---

## Part E — Tech Debt Reconciliation

| ID | Item | Stale / True | S20 Action |
|----|------|-------------|-----------|
| TD-01 | No React Error Boundary | 🔴 True — active crash risk | Phase 0.1: implement |
| TD-02 | CommandCenter no error render (silent "All clear" on SP failure) | 🔴 True — misleading UX | Phase 0.2: add error guard |
| TD-03 | SharePointAmendmentService all-stub, no gating | 🔴 True — false-positive in SP DSM | Phase 0.3: gate or disclose |
| TD-04 | SharePointContractService uses PnP.js (vs. native fetch) | 🟠 True — architectural inconsistency | Defer — read-only, no runtime risk |
| TD-05 | ObligationAssignmentsJSON not normalized | 🟠 True — ADR-003 deferred | Defer — no runtime risk in S20 |
| TD-06 | `getApproval` not implemented (throws in both services) | 🟡 Stale risk — not called anywhere currently | Note only; no S20 blocker |
| TD-07 | `listApprovals` missing `targetPersonId` filter | 🟠 True — needed for S20 Phase 1 | Phase 1.0: add with History tab |
| TD-08 | Approval History tab (Rejected/Executed/ExecutionFailed) not visible | 🟠 True — B7 beta gap | Phase 1: implement (S20 Phase 1) |
| TD-09 | No mode-aware NavRail gating (stub screens appear active in SP DSM) | 🟠 True — part of TD-03 | Resolved by Phase 0.3 |
| TD-10 | Package versions all `0.0.0` | 🟡 Acceptable pre-release | Resolve at release prep only |

**Stale items confirmed removed:** None of the previously noted tech debt items were
determined to be invalid. TD-06 is the only item with near-zero current risk.

---

## Part F — Recommended Sprint 20 Phase 0 Implementation Sequence

All items are planning-phase confirmed. No code written yet.

---

### Phase 0.1 — React Error Boundary

**Effort:** ~45 min | **Files:** 2

**New file:** `packages/c3/src/components/ErrorBoundary.tsx`
- Class component (required — function components cannot be error boundaries)
- Props: `children: ReactNode`, optional `fallback?: ReactNode`
- State: `{ hasError: boolean; error: Error | null }`
- `static getDerivedStateFromError()` → set `hasError: true`
- `componentDidCatch()` → `console.error('[C3/ErrorBoundary]', error)`
- Fallback render: full-width panel with `var(--c3-critical-bg)` border, error message, and "Reload" button (`window.location.reload()`)

**Edit:** `packages/c3/src/components/layout/AppShell.tsx`
- Wrap the `renderScreen()` call inside `<ErrorBoundary>`
- Import from relative path

**Constraints:**
- Do NOT touch routing or navigation logic
- Use `var(--c3-critical)` / `var(--c3-critical-bg)` design tokens
- Fallback must not crash (no hooks, no navigate calls)

---

### Phase 0.2 — CommandCenter Error Render

**Effort:** ~15 min | **Files:** 1

**Edit:** `packages/c3/src/screens/CommandCenter.tsx`
- Destructure `error` from `useWorkItems()` alongside `items`, `counts`, `isLoading`
- Add error guard after loading check:

```tsx
if (error) {
  return (
    <div style={{ padding: 'var(--c3-space-8)' }}>
      <EmptyState
        variant="error"
        title="Queue unavailable"
        description="Could not load the operations work queue. Please refresh the page."
      />
    </div>
  );
}
```

**Verify:** `useWorkItems` return type exposes `error`. If not, trace to the underlying hook and add it.

---

### Phase 0.3 — Amendments SP DSM Disclosure

**Effort:** ~25 min | **Files:** 1–2 | **Decision required**

**Option A (Recommended): NavRail mode-aware gate**
- Edit `NavRail.tsx`: wrap the `amendments` nav item with `config.dataSourceMode !== 'sharepoint' || false` gate
- This removes the item from the nav in SP DSM until the adapter is implemented
- Cleanest UX — no phantom screen

**Option B: In-screen banner**
- Edit `AmendmentsCenter.tsx`: add a `dataSourceMode === 'sharepoint'` check that renders an informational `EmptyState` with title "Amendments not yet available in live mode"
- Keeps the nav item but makes the state explicit

**Recommendation:** Option A. Amendments is not in scope for S20 beta. Showing a nav item that leads nowhere (silently) erodes operator trust. Remove it from SP DSM until the SP adapter is live.

**Constraint:** Do not touch the mock path — Amendments must remain fully functional in Mock DSM.

---

### Phase 0.4 — Tech Debt Register Doc

**Effort:** ~20 min | **Files:** 1 | **Docs-only**

Create `docs/architecture/C3 Tech Debt Register.md` capturing TD-01 through TD-10 with:
- Item ID, description, severity, sprint attributed, resolution path
- Clear "Stale" vs "Active" markers
- Cross-references to ADR-013, ADR-003, and sprint closeout docs

No code changes.

---

### Phase 0.5 — Closeout

After Phase 0.1–0.4 validated:
- Commit as: `feat(beta): S20 Phase 0 UX readiness — error boundary, CommandCenter error, Amendments gate`
- Update `docs/architecture/C3 Beta RC Baseline Marker.md` with Phase 0 completion note
- Tag HEAD: `s20-phase-0-complete`

Then proceed to **Sprint 20 Phase 1: Approval History Tab**.

---

## Answers to Brief Deliverables

| # | Question | Answer |
|---|----------|--------|
| 1 | Current HEAD / Beta RC baseline status | `1ba0c83` — clean, accepted |
| 2 | Baseline marker doc recommended? | Already exists — no new doc needed |
| 3 | Feature readiness matrix | Part B above — 9/11 ship-ready; Amendments is the gap |
| 4 | Repo hygiene status | 4/5 findings non-issues; PnP.js inconsistency logged as TD-04, not a blocker |
| 5 | React Query config assessment | Well-tuned; no changes |
| 6 | Tech debt reconciliation | 10 items (Part E) — 3 Phase 0 actionable, 4 deferred, 3 stale/note-only |
| 7 | Recommended Phase 0 sequence | 5 steps (Part F) — EB → CC error → Amendments gate → TD doc → commit |
| 8 | Error Boundary before Approval History? | **YES** — Phase 0.1 is the first implementation step |
| 9 | Immediate blockers | No crash blockers. Amendments stub is a UX risk, not a runtime blocker. |
| 10 | What to implement first | **Error Boundary (Phase 0.1)** — lowest effort, highest safety net, prerequisite for all S20 feature work |
