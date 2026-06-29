# C3 Architecture Baseline — Sprint 15
**C3 Contract Control Center**
**Sprint:** 15 — SharePoint Credential Integration
**Baseline date:** 2026-06-29
**Status:** CLOSED — 2026-06-29

---

## Closeout statement

Sprint 15 closes as:

> **"Live SharePoint credential fetch, mapping, diagnostics, and fail-safe behaviour validated."**

Sprint 15 does **not** close as:

> ~~"Live SharePoint credentials fully drive the C3 UI/gap pipeline."~~

This distinction is intentional and documented. The credential service is live-validated against real SharePoint data. Full UI and gap-pipeline validation is deferred to Sprint 16 because the SharePoint People service is not yet implemented (returns empty stub in SP mode). See §4 for full rationale.

### Live validation evidence (confirmed 2026-06-29)

- HTTP 200 on `GET .../C3Credentials/items?$select=...&$filter=IsActive eq 1&$top=2000`
- Console aggregate: `[C3/Credential] listAllCredentials: fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.`
- Stress record 8: hard reject fired (`missing HolderPersonID`)
- Stress record 9: unknown type warning fired (`Work Permit → Other`)
- Stress record 10: blank ExpiryDate → `null → undefined`, silent — confirmed as the live SP-supported absent-expiry path (SP rejects malformed date strings with HTTP 400)
- No crashes from mirror records 1–7
- People Workspace shows 0 people (expected — SP stub behaviour, not a regression)
- Mock-mode smoke test passed (all screens, no regressions)

---

## Section 1 — What Sprint 15 delivered

### S15-1: C3Credentials SP list schema
Formal schema document written: `docs/architecture/C3Credentials SP List Schema.md`. Defines all 12 columns with internal names, SP types, required flags, and the 18 CredentialType choice values. This document is the authoritative reference for list provisioning.

### S15-2: spCredentialMapper.ts
Pure mapping utility at `packages/c3/src/utils/spCredentialMapper.ts`. Converts raw SP REST list items to typed `Credential` objects. Key behaviours:

- **Hard reject** — missing `HolderPersonID` → record excluded, `rejectedCount++`
- **Soft warn** — unknown `CredentialType` → mapped to `'Other'`
- **Soft warn** — invalid or unparseable date string → `undefined` (non-expiring semantics, never a sentinel date)
- **Soft warn** — blank `Title` → fallback `CRED-{SP_ID}`
- **Aggregate log** — one `console.info` per batch: `fetched N SP records. Mapped: M. Rejected: R. Warnings: W.`

Validated against 87 test cases in the S15-5A local parity harness (0 failures).

### S15-3: SharePointCredentialService.ts
Live SP service at `packages/c3/src/services/sharepoint/SharePointCredentialService.ts`. Implements `ICredentialService` using native `fetch` with `credentials: 'same-origin'` and `Accept: application/json;odata=nometadata`. No PnP.js dependency.

Methods:
- `listAllCredentials()` — `$filter=IsActive eq 1`, `$top=2000`
- `listCredentialsForPerson(personId)` — adds `HolderPersonID eq '...'` filter with OData single-quote escaping
- `getCredential(credentialId)` — `$filter=Title eq '...'`, `$top=1`, no IsActive guard
- `addCredential()` / `deactivateCredential()` — stubs (write operations out of scope for S15)

Fails safely on every error path: network failure, non-2xx HTTP, unparseable JSON, missing `value` array — all return empty arrays with `console.error`, never throw.

### S15-4: Test dataset
10 test records defined (7 mirror + 3 stress) covering all mapper paths. Documented in `docs/architecture/S15 Live Validation Runbook.md` §3.

### S15-5A: Local parity harness
Script at `scripts/s15-parity-test.mjs`. Runs the mapper against the SP mirror records and stress records locally (no network). Result: 87 passed / 0 failed. Confirms mapper correctness before live SP fetch.

### S15-6: SPFx host wiring
`packages/c3-spfx-host` property pane updated to expose `spSiteUrl` (text field) and `dataSourceMode` (controlled dropdown: `mock` / `sharepoint`). Both values flow through `AppConfig` to all service hooks. Allows switching to SP mode without code changes — only property pane configuration.

### S15-7: disableToasts flag — SPFx-hosted Toaster mitigation (final)

**Root cause:** In the SPFx-hosted workbench, Fluent UI v9's `<Toaster>` crashes during its `useLayoutEffect` registration because `FluentProvider`'s `ToasterStoreContext` is not committed at the point the effect runs. This is a Fluent UI v9.74+ / SPFx workbench context-timing issue; it does not occur in the standalone Vite dev server.

**Mitigation history in Sprint 15:**

1. `ToasterGuard` (class-based error boundary, file: `packages/c3/src/components/ToasterGuard.tsx`) was implemented first. It catches the Toaster crash, renders `null`, and emits `console.warn`. However, React 18 emits a `console.error` for the original throw *before* the boundary activates — Gate 1 ("no uncaught TypeError") could not pass strictly with this approach alone.

2. `disableToasts?: boolean` host capability flag (final, 2026-06-29): a lightweight optional flag added to `HostContextValue`, `AppConfig`, and `PlatformContext`. When `true`, `App.tsx` skips rendering `<Toaster>` entirely. The SPFx host (`C3Host.tsx`) sets `disableToasts: true`. No crash, no console.error, clean console confirmed.

`ToasterGuard` is retained as defence-in-depth for any future host that attempts to mount the Toaster but encounters a context timing issue. It is not triggered in the SPFx path under the current implementation.

**Affected files (disableToasts chain):**
- `packages/c3/src/hosts/HostContext.tsx` — `disableToasts?: boolean` added to `HostContextValue`
- `packages/c3/src/config/AppConfig.ts` — `disableToasts?: boolean` added to `AppConfig`
- `packages/c3/src/hosts/LocalHost.tsx` — `disableToasts: host.disableToasts` threaded into `AppConfig`
- `packages/c3/src/App.tsx` — `{!config.disableToasts && <ToasterGuard><Toaster .../></ToasterGuard>}`
- `packages/c3-spfx-host/src/webparts/c3Host/runtime/C3RuntimeLoader.ts` — `disableToasts?: boolean` added to `PlatformContext`
- `packages/c3-spfx-host/src/webparts/c3Host/components/C3Host.tsx` — `disableToasts: true` passed in context

**Sprint 15 impact:** none. No S15 validation step dispatches toasts.

**Sprint 16 action:** investigate the FluentProvider context timing issue in SPFx. Once the root cause is resolved, `disableToasts: true` can be removed from the SPFx host and `ToasterGuard` can be deleted.

---

## Section 2 — Runtime architecture (confirmed)

### Service registry routing

When `dataSourceMode = 'sharepoint'`, the application switches **all** service domains to the SharePoint service registry:

```
useSP()
  → createSPService({ mode: 'sharepoint' })
  → createSharePointSPService(siteUrl)
  → createSharePointServiceRegistry(siteUrl)
  → { people: SharePointPersonService (stub), contracts: ..., journeys: ..., ... }
```

`useCredentialService()` is the **sole exception** — it is independently wired and does not route through `useSP()`:

```
useCredentialService()
  → config.dataSourceMode === 'sharepoint'
  → createSharePointCredentialService(config.spSiteUrl)   ← live in S15
```

This means:

| Service | SP mode behaviour | Implementation state |
|---|---|---|
| Credentials | Calls real C3Credentials SP list | ✅ Live (S15-3) |
| People | Returns `[]` (graceful stub) | ⏳ Sprint 16 |
| Contracts | Returns `[]` (graceful stub) | ⏳ Future |
| Journeys | Returns `[]` (graceful stub) | ⏳ Future |
| Missions | Returns `[]` (graceful stub) | ⏳ Future |
| Milestones | Returns `[]` (graceful stub) | ⏳ Future |
| Finance | Returns `[]` (graceful stub) | ⏳ Future |

### Consequence for UI in SP mode

Because `People` returns `[]` in SP mode:

- **People Workspace** — shows 0 people. This is correct stub behaviour, not a regression.
- **Person Profile** — not reachable (no person list to navigate from).
- **Readiness tab** — gap computation does not run (no people to compute gaps for).
- **Situation Room** — shows empty work queue (work items require people).

This is working as designed. The architecture routes cleanly; only the SP service implementations are incomplete.

---

## Section 3 — What was validated in mock mode

Mock-mode smoke test performed post-S15-6 (2026-06-29). All screens verified:

| Screen | Result |
|---|---|
| Command Center | 14 work queue items, all urgency bands rendered |
| People Workspace | 10 people, correct 3-card KPI strip |
| Person Profile | 3 credentials, expiry warning rendering correct |
| Readiness tab | Gap computation correct: 1 at risk, 2 satisfied |
| Situation Room | 21 Critical / 3 High / 0 Medium |
| Console | Zero errors |

**No regression was observed in mock mode.** Mock mode remains fully functional and is the authoritative demonstration path until SP People integration is complete in Sprint 16.

---

## Section 4 — What is deferred to Sprint 16 and why

### What is deferred

The following validations **cannot be performed in Sprint 15** because they require People data in SP mode:

- Person Profile → Credentials tab showing live SP credentials in the UI
- Readiness tab gap computation driven by SP credentials
- Situation Room work queue driven by SP credential urgency
- End-to-end parity: SP credentials + SP people → gap engine → UI

### Why

When `dataSourceMode = 'sharepoint'`, `usePeople()` calls `useSP()` → `createSharePointSPService()` → `SharePointPersonService.listPeople()` → `[]`. There are no people to attach credentials to, so the UI integration path is not exercisable.

This is not a defect in S15-3. The credential service is correctly implemented and live-validated at the service layer. The gap is that `SharePointPersonService` is a stub — it is out of scope for Sprint 15.

### What was not introduced

- **No mixed-mode shim** — no temporary patch to force mock people + SP credentials simultaneously. This would have been a non-production configuration requiring removal before Sprint 16, adding risk with no lasting value.
- **No extra code** to enable UI validation in S15. The service-layer evidence (HTTP 200, correct console aggregate, stress warnings, no crashes) is sufficient proof that S15-3 works.

### Sprint 16 entry condition

Full UI/gap validation becomes possible in Sprint 16 when `SharePointPersonService.listPeople()` is implemented against the C3People SharePoint list. Once People are live in SP mode, Person Profile → Credentials, Readiness, and Situation Room can all be validated against real data end-to-end.

---

## Section 5 — Sprint 15 close criteria (reference)

Eight hard gates from the Live Validation Runbook §4.8:

| Gate | Pass condition |
|---|---|
| HTTP 200 | GET to `C3Credentials/items` returns 200 with `value` array of 10 items |
| Console aggregate | `fetched 10 SP records. Mapped: 9. Rejected: 1. Warnings: 1.` |
| Stress warning — Record 9 | `unknown CredentialType "Work Permit" — mapped to Other` ✅ |
| Stress record 10 — silent path | Blank ExpiryDate → SP returns `null` → mapper: `null → undefined`, no warning. Confirmed live: SP rejects malformed date POST with HTTP 400; blank is the supported absent-expiry path. ✅ |
| Mirror records — no errors | Zero `console.error` from `[C3/Credential]` for records 1–7 ✅ |
| No crashes | All screens navigable without unhandled exceptions or React error boundaries ✅ |
| People Workspace — empty | Shows 0 people (confirms SP mode active, stub failing safely) ✅ |
| Mock mode — no regression | Mock-mode smoke test passed (confirmed 2026-06-29) ✅ |

**All gates passed. Sprint 15 is CLOSED (2026-06-29).**

---

## Section 6 — Deferred items and ADR notes

### ADR-003 — JourneyObligationAssignments
The Sprint 16 planning memo documents `ObligationAssignmentsJSON` as a **pilot simplification only**. The long-term target per ADR-003 is a normalised `JourneyObligationAssignments` child SP list. This must be revisited before write operations on Journeys are implemented. Pilot status must be clearly communicated to any operator using the v1 schema.

### Toaster root cause (Sprint 16 investigation)

Sprint 15 mitigation: `disableToasts: true` in the SPFx host prevents `<Toaster>` from mounting. `ToasterGuard` is retained as defence-in-depth. The root cause — Fluent UI v9 `<Toaster>` crashing because `FluentProvider`'s `ToasterStoreContext` is not committed when `useLayoutEffect` runs in the SPFx workbench — is documented in `ToasterGuard.tsx`.

Sprint 16 should investigate whether this is a Fluent UI version-specific regression, an SPFx effect-timing issue, or a missing provider wrapping. Once confirmed and fixed: remove `disableToasts: true` from `C3Host.tsx` and delete `ToasterGuard.tsx`.

### S15-5B (deferred)
Phase B of the parity harness — running `validateCredentialPersonIds` against live SP credentials cross-referenced with mock people — was scoped for S15 but is not executable until People are available in SP mode. Deferred to Sprint 16 post-People implementation.

### Git tag
`v0.15.0-sp-credentials` — ready to apply. All close criteria passed (2026-06-29). Tag from the monorepo root after final commit.

---

## Section 7 — File inventory (Sprint 15 additions and modifications)

| File | Status | Notes |
|---|---|---|
| `packages/c3/src/utils/spCredentialMapper.ts` | New | S15-2 |
| `packages/c3/src/services/sharepoint/SharePointCredentialService.ts` | New | S15-3 |
| `packages/c3/src/hooks/useCredentialService.ts` | Modified | S15-3 — SP branch added |
| `packages/c3-spfx-host/src/webparts/c3Host/C3HostWebPart.ts` | Modified | S15-6 — property pane wiring |
| `scripts/s15-parity-test.mjs` | New | S15-5A — local parity harness |
| `docs/architecture/C3Credentials SP List Schema.md` | New | S15-1 |
| `docs/architecture/S15 Live Validation Runbook.md` | New | S15 live validation guide |
| `docs/architecture/Sprint 16 Planning Memo.md` | New | S16 planning only |
| `docs/architecture/M365 SharePoint Access Readiness Matrix.md` | New | IT/access planning |
| `docs/architecture/C3 Architecture Baseline — Sprint 15.md` | New | This document |
| `packages/c3/src/components/ToasterGuard.tsx` | New | S15-7 — hosted-runtime Toaster error boundary |
| `packages/c3/src/App.tsx` | Modified | S15-7 — conditional Toaster mount via disableToasts; ToasterGuard kept as defence-in-depth |
| `packages/c3/src/hosts/HostContext.tsx` | Modified | S15-7 — disableToasts?: boolean added to HostContextValue |
| `packages/c3/src/config/AppConfig.ts` | Modified | S15-7 — disableToasts?: boolean added to AppConfig |
| `packages/c3/src/hosts/LocalHost.tsx` | Modified | S15-7 — disableToasts threaded from HostContextValue into AppConfig |
| `packages/c3-spfx-host/src/webparts/c3Host/components/C3Host.tsx` | Modified | S15-SPFx — remove webpackIgnore; use runtime.mount/unmount API; pass disableToasts: true |
| `packages/c3-spfx-host/src/webparts/c3Host/runtime/C3RuntimeLoader.ts` | Modified | S15-SPFx — align PlatformApplication interface; add disableToasts to PlatformContext |
| `packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js.d.ts` | Modified | S15-SPFx — align declarations to actual runtime exports |
