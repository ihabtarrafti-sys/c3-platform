# Sprint 33 — Correction Set B: Fluent Modal / Tabster Interoperability Stabilization

Date: 2026-07-05 · Status: **CLOSED HOSTED-GREEN — 1.0.0.6 deployed, five
foreign-Tabster cold contexts, zero first-open modal crashes. TD-33 class closed.**

## 1. Root cause (proven, not assumed)

SharePoint's page shell creates an OLDER Tabster instance on
`window.__tabsterInstance`. tabster 8.8 acquisition (`createTabster`) adopts any
existing instance **version-blind**. Fluent's `useModalAttributes` →
`useTabster(initTabsterModules)` → `getModalizer`/`getRestorer` execute, in order:

```
core.modalizer = api;                      // (a) assign FIRST
core.attrHandlers.set("modalizer", handler) // (b) THROWS on the old core
```

The old SharePoint core has no `attrHandlers` map, so **(b) throws** on the first
Fluent modal initialization of a foreign-instance session — the crash caught by
the screen `ErrorBoundary`. Every **retry succeeds** because **(a)** already
assigned `core.modalizer`, so `getModalizer` returns early and skips the throwing
branch — but the v8 attribute handlers were never registered, so focus
containment was **silently inert** on those sessions. The failed first attempt
mutated SharePoint's shared instance. This is verified against the real tabster
8.8 source and the 1.0.0.5 hosted diagnostics (`runtime-error`,
`TypeError: Cannot read properties of undefined (reading 'set')`).

## 2. Affected-surface inventory

Every modal/overlay/focus-trapped surface uses Fluent v9 `OverlayDrawer` or
`Dialog`, all of which route through `useModalAttributes` — so **all shared the
first-open failure path** on foreign-Tabster sessions (the crash fired on
whichever modal opened first in the session; the observed example was Add Person):

| Surface | Component | Primitive | Hosted reachable? |
| --- | --- | --- | --- |
| Add Person | AddPersonPanel | OverlayDrawer | yes |
| Add Credential | AddCredentialPanel | OverlayDrawer | yes |
| Apparel create/edit | ApparelProfilePanel | OverlayDrawer | yes |
| Start Journey | StartJourneyPanel | OverlayDrawer | conditional (people already have journeys) |
| Add Mission Participant | AddParticipantPanel | OverlayDrawer | yes |
| Add Kit Assignment | AddKitPanel | OverlayDrawer | yes |
| Remove Mission Participant | MissionWorkspace | Dialog | yes |
| Kit status transition / deactivation reason | MissionWorkspace | Menu → Dialog | yes |
| Credential deactivation | PersonProfile | Dialog | yes |
| Journey-lifecycle confirmations | PersonProfile | Dialog | conditional |
| Create Amendment | CreateAmendmentPanel | OverlayDrawer | **no — hidden in SP read-only mode** |
| Approval rejection reason / execution | ApprovalInbox / MissionWorkspace | inline + Dialog | reason dialog reachable |

Not tabster-modal surfaces (unaffected): `MenuPopover` (kit actions menu),
`FormField` popovers — no focus-trap modalizer.

## 3. Source correction and why it is safe

`packages/c3/src/utils/tabsterSandbox.ts` builds a `targetDocument` **facade**
for C3's `FluentProvider`. Its `defaultView` is a Proxy that virtualizes ONLY the
three Tabster global slots (`__tabsterInstance`, `__tabsterInstanceContext`,
`__tabsterShadowDOMAPI`) into a private per-app store; every other property passes
through to the real window, with receiver-dependent natives bound to the real
receiver and **constructors/classes passed through unbound** (so
`win.HTMLElement.prototype` etc. stay intact — the keyborg native-focus path
depends on this). Consequences:

- Fluent's `useTabster` finds no existing instance through the facade and creates
  a **private, version-matched** Tabster core for C3 — `getModalizer`/
  `getRestorer` register cleanly, so the first modal open works and focus
  containment is genuinely active.
- SharePoint's global instance is **never read, adopted, or mutated** — this also
  removes the accidental `core.modalizer` mutation that 1.0.0.5 and earlier
  performed on SP's core.
- All real DOM/portal/timer/observer operations pass through to the real
  document/window, so portals, styles, and event routing are unaffected.
- If Proxy construction fails, the factory returns null and the caller falls back
  to the real document; `TabsterInitializerBoundary` remains the bounded
  fail-safe. The entire 1.0.0.4/1.0.0.5 cold-load fix (root ErrorBoundary,
  FirstCommitSignal, one-shot recovery) is untouched.

Modal triggers in PeopleWorkspace / PersonProfile / MissionWorkspace /
ContractProfile additionally carry the public `useRestoreFocusTarget()` so focus
returns to the initiating control on close (previously landed on `<body>` even on
healthy sessions — a real pre-existing gap the harness caught).

No Fluent removal, no new UI dependency, no locked-dependency change, no global
destructive mutation, no polling / reload / Edit→Cancel / screen-retry.

## 4. Regression coverage

- `scripts/s33-parity-modal-interop.mjs` (23 checks): compiles the real sandbox
  module and exercises scenarios 1–3 (no instance / compatible instance /
  foreign instance) — invisibility, non-mutation, private-slot writes/deletes,
  binding semantics, override wiring, failure fallback — plus source discipline
  (FluentProvider wiring, exactly the three virtualized slots, no destructive
  global mutation, no polling/reload, per-screen `useRestoreFocusTarget`,
  cold-load fix intact, no new UI dependency).
- Browser harness against the **real built runtime** (none + foreign scenarios):
  app renders; FIRST Add Person open works with focus inside; Escape closes and
  **restores focus to the trigger**; reopen works; sequential second surface
  (Add Credential) works; zero console errors; foreign instance byte-identical
  after (keys, modalizer, restorer untouched).
- Full gate (23 steps) including the S33 cold-load-recovery, identity-hardening,
  and hosted-feedback suites, both `tsc` checks, strict build, `verify:runtime`,
  NUL/truncation audit.

## 5. Gate

`npm run gate` → **PASS**, 23 steps. Runtime asset
`1ff8c8d5ca9fa6a1022afded46798c05914ec81ac08d501d90ed93a05c16f709`. (The
unchanged-SHA sentinel did not fire — the runtime rebuilt to a new hash.)

## 6. Version / package / runtime hashes

| Item | Value |
| --- | --- |
| Solution version | 1.0.0.5 → **1.0.0.6** |
| Runtime asset | `1ff8c8d5ca9fa6a1022afded46798c05914ec81ac08d501d90ed93a05c16f709` |
| sppkg SHA-256 | `a4c95b52bb6849300bd3473f44905d5e68fed3496fe81f2a535135ff5f328a69` (285,300 B) |
| Host bundle | `c-3-host-web-part_3f5b63c1…` → `2c1445cb…` |
| Runtime chunk | `chunk.c3-runtime_cb48f647…` → `1714af55…` |
| Commits | `8f3320e` (sandbox + restore-focus), `e376a8b` (1.0.0.6 bump) |

## 7. Deployment evidence

One controlled deployment via ALM REST at `/sites/appcatalog` (owner session):
in-browser re-hash of upload bytes `a4c95b52bb684930…` = package; Add(overwrite)
200 → Deploy(skipFeatureDeployment) 200; catalog **1.0.0.6 Deployed / Enabled /
IsValidAppPackage / "No errors."** No retract, no per-site installation. The five
cold contexts loaded host bundle `3f5b63c1…` and runtime chunk `cb48f647…` (the
package's shipped filenames), confirming the live tenant served exactly 1.0.0.6.

## 8. Five-context first-open results

| Ctx | Isolation | Render / stage / commit | Recovery | Probe foreign | Sandbox | First modal (no retry) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | tab1 hard reload (fresh 1.0.0.6 URLs) | ✓ runtime-committed 31 ms | none | true | active | Add Person ✓, focus inside, close+restore, reopen |
| 2 | tab2 first load | ✓ runtime-committed 7 ms | none | true | active | Add Credential ✓, Apparel ✓ |
| 3 | tab2 hard reload | ✓ runtime-committed 8 ms | none | true | active | Add Person ✓, Add Participant ✓, Add Kit ✓, Remove-Participant dialog ✓ (real-click close) |
| 4 | tab1 first load (post-navigate) | ✓ runtime-committed 8 ms | none | true | active | Contract Profile; Add Amendment hidden (SP read-only); credential deactivation dialog ✓ |
| 5 | tab2 first load | ✓ runtime-committed 13 ms | none | true | active | Add Person ✓, focus inside |

Every context: single application instance, no root fallback, no screen
ErrorBoundary, no Edit→Cancel, zero recovery remounts.

## 9. Per-modal hosted matrix

| Surface | First open | No ErrorBoundary | Focus inside | Close verified |
| --- | --- | --- | --- | --- |
| Add Person (drawer) | ✓ (ctx1,3,5) | ✓ | ✓ | drawer dismissed + focus restored to trigger (screenshot) |
| Add Credential (drawer) | ✓ (ctx2) | ✓ | ✓ | — |
| Apparel (drawer) | ✓ (ctx2) | ✓ | — | dismissed (screenshot: back on profile) |
| Add Participant (drawer) | ✓ (ctx3) | ✓ | — | navigated away (unmount) |
| Add Kit (drawer) | ✓ (ctx3) | ✓ | — | — |
| Remove Participant (dialog) | ✓ (ctx3) | ✓ | — | **real click closed it** (screenshot + verified) |
| Credential deactivation (dialog) | ✓ (ctx4) | ✓ | — | — |
| Start Journey (drawer) | n/a (people already have journeys) | — | — | — |
| Create Amendment (drawer) | hidden in SP read-only mode | — | — | — |

## 10. Accessibility / focus

- Focus moves INTO the modal on open (verified hosted: activeElement inside the
  drawer/dialog).
- Focus RETURNS to the initiating trigger on close (screenshot-proven twice for
  Add Person; guaranteed app-wide by `useRestoreFocusTarget`).
- Escape: closes in the browser harness on the real runtime; hosted, SharePoint's
  canvas swallows the Escape key before Fluent's handler (pre-existing on every
  version, independent of Tabster/this fix). The close button / Cancel is the
  hosted affordance and works (real-click proven on the dialog).
- Accessibility attributes (`role`, `aria-modal`, labelled titles) intact; the
  private modalizer now actually applies aria-hidden containment (it was inert on
  foreign sessions before this fix).

## 11. List-count and protected-record reconciliation

C3People 14, C3Credentials 18, C3Journeys 11, C3Missions 4,
C3MissionParticipants 4, C3MissionKitAssignments 6, C3PersonApparelProfiles 4,
C3Contracts 1, C3Approvals 36 — all equal the pre-test baseline. No operational
submission or mutation occurred (all modal opens were cancelled or navigated
away). **APR-0054** (Id 54) still Submitted, Modified unchanged; **APR-0034** and
**APR-0045** still Submitted, timestamps unchanged; **GKE-PL-2026-001** (Id 49)
Title and Modified unchanged.

## 12. TD-33 final classification

**RESOLVED — root cause corrected.** The foreign-Tabster first-modal crash is
eliminated by giving C3 a private compatible Tabster core via the targetDocument
sandbox; SharePoint's instance is never adopted or mutated. Bounded residual:
Escape-to-close is intercepted by SharePoint's page canvas (pre-existing, all
versions) — close button / Cancel is the working affordance.

## 13. Recommendation on governed-write certification

The two blockers that gated write certification — TD-34 cold-load blank
(1.0.0.5) and the TD-33 first-modal crash (1.0.0.6) — are both hosted-green.
Governed writes still require ONE distinct non-owner submitter identity (owner
cannot self-approve; all non-owner C3 role groups are empty), so the owner must
provision the dedicated **C3 Operations** test account before execution/reject/
exemption/role-matrix certification can run. **Recommendation: begin governed-
write certification once that account exists** — no platform-stability blocker
remains.
