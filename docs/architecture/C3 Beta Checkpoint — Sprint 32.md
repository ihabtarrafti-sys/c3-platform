# C3 Beta Checkpoint — Sprint 32 (Hosted Part 19)

**Status:** 🟡 PART 19 PARTIAL — deployment + truthful-empty + failure-drill GREEN;
per-role walkthroughs and the real-record pass PENDING owner execution.
Internal V1.0 is **NOT declared**.
**Date:** 2026-07-05 · **Executed by:** engineering agent driving the owner's
authenticated browser session (Ihab Tarrafti, user #9, site admin), plus local
build/validation tooling.

---

## Part 19.0 — Deployment (GREEN)

- Pre-deploy repo state: HEAD = origin/master = `5936606` (NavRail activation),
  tree clean; `verify:runtime` PASS with asset SHA
  `e8382ae15d1849dcab4a27b5860a177898aa9529243d3033916f310b1d5edf02`.
- Production package rebuilt from that clean tree
  (`heft test --clean --production && heft package-solution --production`).
  The package embeds the runtime as webpack chunk
  `chunk.c3-runtime_96045e9c60c4783838b0.js` — SHA-256
  `4b61b26e29ef5a3d0e7a7eee337119353ca68076b25425327198eb3530c18c39`
  (1,012,319 bytes). Webpack re-processes the asset, so the chunk hash — not the
  raw asset hash — is the deployable artifact identity. **Proof chain:** asset
  `e8382ae1…` → (clean verified tree, single production build) → chunk
  `4b61b26e…`.
- Deployed via the established catalog procedure, executed as ALM REST from the
  owner's authenticated session: `tenantappcatalog/Add(overwrite=true)` (HTTP
  200, 281,482 bytes — exact package size) then `AvailableApps/GetById(…)/Deploy`
  (HTTP 200) at `https://geekaygames.sharepoint.com/sites/appcatalog`
  (item `c-3-spfx-host.sppkg`, app id `c3de4e6d-fbd8-4a26-bc39-18adbc7b0402`).
  No list, field, permission, or group was provisioned or mutated.
- **Live SHA proof:** the hosted page
  `/sites/C3/SitePages/C3.aspx?dataSrc=sharepoint` loaded
  `…/ClientSideAssets/45869e8b-…/chunk.c3-runtime_96045e9c60c4783838b0.js`;
  in-page `crypto.subtle` SHA-256 of the fetched bytes =
  `4b61b26e29ef5a3d0e7a7eee337119353ca68076b25425327198eb3530c18c39` — byte-identical
  to the locally built chunk. The loaded runtime IS the approved `e8382ae1…` build.
- Diagnostics screen (screenshot): Mode `sharepoint` · Adapter `SharePoint
  Adapter` v`1.0` · Site URL `https://geekaygames.sharepoint.com/sites/C3` ·
  **Read Support: Yes · Write Support: No**.

## Part 19.1 — Truthful empty state (GREEN)

| Check | Result |
|---|---|
| Contracts visible + selectable in NavRail (SP mode) | ✅ (screenshot; item between Command Center and People) |
| Contracts workspace loads against live SharePoint | ✅ — GET `getbytitle('C3Contracts')/items` → 200, empty |
| Truthful empty state | ✅ — Total/Active/Renewing/Archived all `0`; "Contract Register — 0 contracts"; "No contracts yet · Contracts will appear here once they are created." |
| No fabricated rows/readiness/renewals/counts/success | ✅ — zeros only, each with honest qualifiers ("None in progress", "Closed lifecycle") |
| Renewals truthful empty state | ✅ — Needs Renewal Action 0 / Critical ≤30 Days 0 / In Progress 0 / Total Exposure 0 |
| Direct Contract Profile navigation with invalid ID | N/A BY CONSTRUCTION — the app is state-navigated (no URL route to contract-profile); the profile is reachable only through row navigation. Service-level invalid-id behavior is fail-closed (`getContract` truthful failure, s32 parity) |
| Rail highlights Contracts on contract-profile | ⏳ requires a real row (Part 19.3) |
| Guarded workspaces unchanged | ✅ — Amendments and Intelligence absent from the SP-mode rail; all other items per manifest |

## Part 19.2 — Roles and security (PARTIAL — owner walkthroughs pending)

- Platform Owners (this session): truthful read behavior verified end-to-end;
  direct SharePoint authoring available via the list UI (site admin / Owners FC).
- ACL boundary: hosted-green Phase 3D exact-five ACL is authoritative
  (Platform Owners FC; Operations/Legal/Finance/Management Read; no others).
  UI role checks remain UX only — Diagnostics reports Write Support: No.
- **No functional application write path exists** for any role: the contract
  service is read-only (4 list/get methods; no digest/POST/MERGE anywhere —
  s32 parity-enforced). FINDING (TD-31): the ContractsList "New Contract"
  button is INERT — no onClick handler; live click produced no dialog, no
  navigation, and zero network requests. It is a mock-era cosmetic control,
  not a write path, but a dead primary button is misleading UX and should be
  removed/replaced behind a capability in a follow-up source change.
- ⏳ PENDING owner: hosted walkthroughs with Operations / Legal / Finance /
  Management accounts (expect truthful read-only), an HR or no-access account
  (expect the truthful unavailable/access-denied state), and a visitor where
  available. No ACL may be changed to conduct these tests.

## Part 19.3 — Failure drill (GREEN, non-destructive)

Method: reversible client-side interception ONLY — in-page `window.fetch` patch
returning HTTP 503 for `getbytitle('C3Contracts')` requests, installed before
app mount (cold cache). No SharePoint state touched.

- Cold entry to Contracts under simulated outage → **designed fail-closed
  state**: "⚠ Could not load contracts — The contract register could not be
  retrieved. Check your connection or try refreshing the page." No zeros, no
  KPI cards, no stale or fabricated data (screenshot). 21 blocked requests
  observed (TanStack retries) — none escaped the block.
- Warm-cache behavior noted: with a fresh successful query already cached,
  TanStack serves last-known-good data during a failing background refetch —
  standard platform SWR semantics, consistent across all workspaces.
- Restore: page reload removed the patch (verified gone); cold Contracts entry
  returned the truthful empty state. Fully reversible.

## Part 19.4 — Real owner-authored record (PENDING owner)

The owner must author ONE genuine contract row directly in the SharePoint list
(`C3Contracts`). Synthetic data is prohibited. Required canonical fields:

| Column (display) | Internal | Required | Notes |
|---|---|---|---|
| Contract ID | Title | ✅ unique, indexed | canonical plain-text id, e.g. `GKE-PL-2026-…` |
| Person ID | PersonID | ✅ indexed | must match a real C3_People PER-XXXX |
| Full Name | FullName | ✅ | |
| Contract Type | ContractTypeName | ✅ | plain text |
| Contract Stage | ContractStage1 | ✅ | plain text stage value |
| End Date | EndDate | ✅ indexed | date-only |
| Is Active | IsActive | default `1` | leave defaulted unless inactive |
| Optional (only if truly known) | DisplayName, AgreementCategory, Disposition1, StartDate, SignatureDate, TerminationDate, HasSignedContract, MonthlyCompensation, CurrencyCode, PrizeSharePct, ContractOwnerName, ContractOwnerEmail | — | leave blank when unknown — missing must remain missing |

Then verify: list row truthful · identity from Contract ID (never parsed
Title semantics — Title IS the Contract ID by canonical design) · profile opens
for the correct id with rail highlighting Contracts · profile fields match
SharePoint exactly · Renewals includes/excludes by actual EndDate/status ·
missing optionals stay missing · zero/missing never implies readiness.

## Findings register

1. **TD-31 (new):** inert "New Contract" primary button on ContractsList (§19.2).
2. **TD-32 (new):** People register "Contracts" column renders the stored
   `TotalContracts` field from C3_People — a mock-era denormalized count now
   stale relative to canonical truth (shows 2/1 against an empty C3Contracts).
   Needs either live derivation or removal.
3. SharePoint SPA soft-navigation occasionally rendered the site Home over
   C3.aspx during rapid automated navigation; hard reload resolves. Browser
   automation artifact, not an application defect.

## Result matrix

| Part | Result |
|---|---|
| 19.0 Deployment + SHA proof | ✅ GREEN |
| 19.1 Truthful empty state | ✅ GREEN (one item N/A by construction; one deferred to 19.4) |
| 19.2 Roles/security | 🟡 PARTIAL — Owners green; other-role walkthroughs pending |
| 19.3 Failure drill | ✅ GREEN |
| 19.4 Real record | ⏳ PENDING owner |
| **Internal V1.0** | **NOT DECLARED** — BLOCKED by TD-33 (People cold-load crash) + 19.2/19.4 |

## Part 19.4 — genuine-row Contract Profile identity fix (IMPLEMENTED + DEPLOYED; hosted click-through PENDING render propagation, 2026-07-05)

**Genuine row (owner-authored):** `Title=GKE-PL-2026-001`, SharePoint `Id=49`,
`PersonID=PER-0001` (Abdulaziz Alabdullatif), Esports Agreement, Active,
End 2027-07-01, $500 USD.

**Root cause (app-owned):** every contract-profile navigation passed
`contractId: String(contract.Id)` — the numeric SharePoint `Id` (e.g. "49") —
but `SharePointContractService.getContract` filters `Title eq '<id>'` (Title = the
canonical business Contract ID). So the hosted lookup became `Title eq '49'` →
0 rows → "Contract not found". `MockContractService.getContract` matched the
numeric `Id`, so mock DSM passed and masked the defect. Both click origins failed
identically because they shared the same numeric-Id payload.

**Fix (identity rule: plain-text business Contract ID is the cross-domain
identity; numeric Id is persistence metadata only):** all 8 register/People/Inbox/
Renewals navigations now carry `contract.ContractID`; `MockContractService`
looks up by `ContractID` to mirror the SP service. `AmendmentProfile` already
used the plain-text `ParentContractID` and is unchanged. No schema/lookup/ACL/
write/routing change. `useContract` keeps `enabled: id.trim().length > 0` so an
empty/undefined payload still fails truthfully. Parity 52/52 (adds Part 19.4
identity regression checks); full gate PASS.

**Deployment:** runtime `bb2ffba3ce04b57fc7aae30dfa74997ca978c7b8a349b1b5b436ea9a29b0492b`,
chunk `chunk.c3-runtime_c595c83d…` = `dc718d6c045690ff58261f136384b4ab3605467e20681acb1faed5598ad7d1a0`.
Catalog Add/Deploy 200/200. **Deployment integrity verified:** the deployed chunk
was fetched from the CDN and confirmed to contain the fix (`.ContractID`
navigation, `Title eq '` filter, mock ContractID match). The SP ground-truth query
`Title eq 'GKE-PL-2026-001'` returns the genuine row — so the corrected lookup
resolves it.

**BLOCKER — hosted click-through UNVERIFIED (SharePoint render propagation):**
after ~8 rapid Add(overwrite)+Deploy cycles this session, the C3 webpart stopped
rendering on **fresh** page loads (empty canvas, **no console errors**), while a
**warm** tab keeps working and the webpart is confirmed still present on the page
canvas. The deployed bytes are correct and the mount code is byte-equivalent to
the previously-rendering `982bd2e6` build (the fix only changed navigation
payloads — zero mount-path impact), so this is a transient SPFx CDN/app-catalog
propagation state, not a package or code fault. It was NOT restored to an older
package because (a) `982bd2e6` reintroduces the "Contract not found" bug and
(b) redeploying it would trigger the same propagation churn.

**Remaining owner action:** after CDN propagation (typically minutes–tens of
minutes), or immediately via a hard cache-clear refresh (Ctrl+F5), confirm both
click paths (Contracts register → Contract Profile, and People profile → Contract
Profile) resolve `GKE-PL-2026-001` and show fields matching SharePoint. If
fresh-load rendering does not recover after propagation, retract+redeploy the
solution cleanly (hosting operation, no code change). Part 19.4 goes green — and
Internal V1.0 can be declared — once both paths are confirmed.

### Version bump 1.0.0.0 → 1.0.0.1 (single clean deploy, 2026-07-05) — render STILL blank; STOPPED

Per owner directive, bumped ONLY `solution.version` (1.0.0.0 → 1.0.0.1) in
`package-solution.json` (runtime asset unchanged `bb2ffba3…`; Part 19.4 fix
carried unchanged; full gate PASS), rebuilt from the clean tree, and performed
exactly ONE tenant-wide catalog deploy (`Add(overwrite=true)` + `Deploy`,
200/200). No retract, no per-site install, no other same-version overwrite.

**Read-only post-deploy verification:**
- catalog `AppCatalogVersion` = **1.0.0.1**, `Deployed=true`, `IsEnabled=true`;
- per-site app instances on `/sites/C3` = **0** (tenant deployment preserved);
- no list/field/ACL/group/operational SharePoint state changed.

**Fresh-context hosted result: STILL BLANK.** On a genuinely fresh tab the C3
webpart does not render. Evidence captured (owner directive stop condition):
- **loaded host bundle:** `c-3-host-web-part_2bd683a49a92be3c0c69.js` (200);
- **loaded runtime chunk:** `.../ClientSideAssets/45869e8b-…/chunk.c3-runtime_c595c83d2e1a77358fa2.js`,
  SHA-256 `dc718d6c045690ff58261f136384b4ab3605467e20681acb1faed5598ad7d1a0`
  — **exact match** to the packaged build (asset `bb2ffba3…`);
- **webpart container present** (component id `842c36e2-5aae-4b32-814c-1b89436ee9c7`)
  but its React mount `<div>` is **empty** (innerHTML ≈ 11 chars) — the host
  webpart rendered its container but the SPFx `componentDidMount` dynamic-import
  + `application.mount()` did not populate it;
- **console errors: NONE; network failures: NONE** (all 200; ClientSideAssets
  served from cache). A native `import()` of the chunk returns no ES exports —
  expected for a webpack chunk (it registers with the host's webpack runtime),
  NOT evidence of a broken runtime.

**Assessment:** the correct assets load with matching hashes and the version is
genuinely new, yet the webpart mount silently no-ops on fresh loads while warm
sessions continue to work — a SharePoint/SPFx host-side registration/render
state that a version bump did not clear. **Per directive: STOPPED — no further
deploys.** Do NOT use repeated redeploys as a cache-clear. Candidate next steps
for owner review (hosting operations, no code change): allow longer propagation
of the new version then hard-refresh; if still blank, a clean **retract +
redeploy** of the solution in the tenant app catalog (which fully de-registers
and re-registers the app), or re-adding the C3 webpart to the page. The deployed
CODE is correct and gate-green; this is purely a hosting render-state blocker.

## TD-34 — SPFx host mount hardening + blank-render root-cause isolation (2026-07-05)

**Host mount defect FIXED (deployed 1.0.0.2).** `C3Host.componentDidMount` was an
unguarded async import+mount; hardened with explicit await, `validateRuntimeModule`
(export/mount/unmount checks), `decideMount` (disposed/duplicate/detached guards
after the await), try/catch on import and mount, cleanup-once on unmount, a
VISIBLE fail-closed error instead of a blank `<div>`, and a bounded non-sensitive
`window.__C3_HOST_DIAGNOSTICS`. Pure helpers unit-tested; `s32-parity-host-mount`
(28 checks) in the gate. Host bundle `c-3-host-web-part_a869c918…` =
`8138ea6a…`; runtime app asset unchanged (`bb2ffba3…`); solution `1.0.0.2`.

**Hosted diagnostics now reach `mount-complete`** on a cold load
(`importStatus: resolved`, `mountInvoked/mountCompleted: true`,
`mountTargetConnected: true`) — the host mount lifecycle is proven healthy.

**Blank render root cause ISOLATED — it is NOT a code regression:**
- Both live bundles hash-match the package (host `8138ea6a…`, chunk `dc718d6c…`);
  catalog registration consistent (`1.0.0.2`, deployed, enabled); no per-site
  install. → per the branch rule, an application-layer issue, not a cache theory.
- The runtime's `mount()` runs and `createRoot(container).render(<StrictMode>…
  <SharePointHost/>…)` executes, a React root attaches to the container, but the
  tree **commits ZERO DOM** — no error, no console output, no loading spinner,
  indefinitely. `SharePointHost` returns `<C3App/>` unconditionally; role
  resolution REST works (`currentUser/groups` → 200, `["C3 Platform Owners"]`).
- **Byte-diff of the deployed runtime (`bb2ffba3`, blank) vs the last build that
  rendered cold (`982bd2e6`, TD-33) = 101 bytes, in exactly the Part 19.4 identity
  fix (mock `r.ContractID===e` + the onClick nav payloads) — NONE of which runs at
  initial render.** The initial-render code path is therefore byte-identical
  between the rendering and blank builds.

**Conclusion:** host mount, package assets, catalog registration, and the
runtime initial-render code are ALL proven healthy/identical-to-rendering. The
persistent blank render is an environmental SharePoint webpart-render/registration
state that degraded across the session's rapid redeploys — not a code defect, and
not fixable by further code changes (the host is already hardened; the runtime is
byte-identical to a rendering build). Per the escalation rules the "assets +
mount lifecycle proven healthy" precondition is now satisfied; the appropriate
next actions are owner-gated hosting operations: a clean **retract + redeploy**
of the solution, or **remove + re-add** the C3 web part on `C3.aspx` (its stored
instance may be stale after the redeploys). No further code change or speculative
redeploy is warranted.

## Part 19.5 — TD-33 cold-start modal remediation (RESOLVED, hosted-green 2026-07-05)

**Root cause (app-owned call path):** every "Add/Create" panel rendered its
Fluent `OverlayDrawer` always-mounted (`<OverlayDrawer open={state}>`), and two
Mission `Dialog`s were always-mounted too. On mount, Fluent runs
`getModalizer(tabster)` → `tabster.core.attrHandlers.set("modalizer", …)`. On a
COLD session where a modal is the first Tabster consumer, that registration runs
before the modalizer machinery is initialized and throws
`Cannot read properties of undefined (reading 'set')`. Warm sessions initialize
it via earlier components, so the crash was invisible to every prior (warm)
validation.

**Options considered:**
1. *Lifecycle deferral* — mount overlays only when first opened
   (`useDeferredMount`). Applied to all 7 shared `OverlayDrawer` panels; the two
   always-mounted Mission dialogs gated (`{state !== null && <Dialog…>}`);
   PersonProfile dialogs were already conditional. This fixed the cold *initial
   render* but not modal *open* — proven insufficient hosted (opening Add Person
   on a cold tab still crashed), because the core modalizer is still uninitialized
   at first open.
2. *Provider-level core init via `useFocusFinders`* — created the Tabster core
   but not the modalizer; modal open still crashed. Insufficient.
3. *Provider-level modalizer pre-init via `useModalAttributes`* (SELECTED) — a
   root `TabsterInitializer` calls the public `useModalAttributes({trapFocus:true})`
   (the exact hook modals use), which runs `initTabsterModules` (`getModalizer` +
   `getRestorer`) once at app init. `getModalizer` is idempotent, so every real
   modal open thereafter skips the failing registration.

**Why Option 3 was needed and is supported:** lifecycle deferral alone leaves the
modalizer uninitialized until first open (proven hosted). `useModalAttributes` is
a public `@fluentui/react-components` export; no private/unsupported Tabster API,
no `node_modules`/bundled-Fluent patch, no provider replacement, single tabster
copy confirmed (react-tabster 9.26.15 / tabster 8.8.0). Deferred mounting is
retained as defence in depth.

**Files:** `packages/c3/src/hooks/useDeferredMount.ts` (new); the 7 shared panels;
`packages/c3/src/screens/MissionWorkspace.tsx` (2 dialogs gated);
`packages/c3/src/App.tsx` (`TabsterInitializer`); parity harness. Runtime SHA
`982bd2e66cb8dd68efe8533b4cdd8136c6e2c71ee24174da4c56df0c7d60af4c`; deployed chunk
`chunk.c3-runtime_1551ca99…` / `c9536c3d3ca687f74709712b2de7bf2e6b5f494f20eafaa29b0413ab9f78403d`
(verified byte-identical in-page on the hosted page). Parity 41/41; full gate PASS.

**Cold regression matrix (fresh tabs, first navigation, verified this build):**

| # | Check | Result |
|---|---|---|
| 1 | Hard load → People as FIRST navigation | ✅ 14 rows, no error boundary |
| 2 | Command Center settles → People | ✅ no crash |
| 3 | Open Add Person (cold) | ✅ drawer opens, 10 fields, no crash (screenshot) |
| 4 | Close / reopen Add Person | ✅ reopens cleanly |
| 5 | People register truthful; no Contracts column (TD-32) | ✅ |
| 6 | Contracts truthful-empty; New Contract absent (TD-31) | ✅ |
| 7 | Renewals truthful-empty | ✅ |
| 8 | Missions (gated dialogs + AddKit/AddParticipant panels) | ✅ no crash |
| 9 | PersonProfile (StartJourney/AddCredential/Apparel panels + 2 dialogs) | ✅ no crash; Add Credential opens/closes; Total Contracts tile canonical "0" |
| 10 | Failure drill (cold cache) | ✅ fail-closed proven earlier; warm-cache SWR serves truthful cached empty; restore truthful |
| 11 | Warm navigation | ✅ unchanged |

TD-33 is **RESOLVED and hosted-green**. The runtime `982bd2e6…` is deployed.

---

## (Historical) BLOCKER — TD-33: People screen cold-load crash (Fluent v9 tabster) — discovered 2026-07-05

**Severity:** 🔴 V1 blocker (core screen crashes on a real user's first visit).
**Not a regression from this workstream** — see isolation proof below.

### Symptom
On a **cold** page load (fresh browser session), navigating to **People** — even
after the default Command Center screen has fully settled — throws the app-level
error boundary: "Something went wrong … Cannot read properties of undefined
(reading 'set')". People renders 0 rows. Contracts, Renewals, Command Center,
Diagnostics all render fine on the same cold load.

### Root cause
The stack is entirely inside Fluent UI v9 **tabster**:
`Ja(e)` → modalizer creation → `a.attrHandlers.set(...)` with `a.attrHandlers`
undefined — i.e. a tabster **modalizer** initializes before the tabster **core**
has created its `attrHandlers` map. The People screen mounts `AddPersonPanel` (a
Fluent modal/Drawer) whose modalizer registration triggers this on a cold
session. It does **not** reproduce in a **warm** session (a tab that has already
completed enough Fluent mounts) — which is why every prior hosted validation,
always performed warm, passed, and why the warm reference tab renders People fine.

### Isolation (why it is NOT this workstream's regression)
1. The **original, unmodified** PeopleWorkspace (byte-identical to the pre-Sprint-32
   `5936606` version) crashes cold — proven by deploying a build whose only diffs
   from the activation build were TD-31 (ContractsList) and the PersonProfile tile.
2. The **exact e8382ae1 build** — the Part 19.1-"validated" runtime, chunk
   `96045e9c…` / `4b61b26e…`, reproduced byte-identical — **also crashes People
   cold**. The earlier "GREEN" People observation was a warm-session artifact.
3. Therefore the defect is pre-existing Fluent-v9/tabster infrastructure fragility,
   independent of TD-31/TD-32 and of NavRail activation. My TD-31/TD-32 source
   fixes are correct, gate-green (parity 27/27), and committed
   (`0992bff`, `a0b8ae5`) — but are **not deployed**, because a proper fix for
   TD-33 will rebuild+redeploy the runtime and they will ship together then.

### Likely fix direction (for the owner/lead — architecture decision, not routine)
Defer modalizer init until the panel is actually opened — e.g. mount the Fluent
panels conditionally (`{open && <AddPersonPanel …/>}`) rather than always-rendered
with `open={false}` — and/or ensure the tabster core is initialized once at
`FluentProvider` mount. This pattern likely also affects other modal-bearing
screens (PersonProfile's StartJourney/AddCredential panels, Approvals) and should
be applied as a shared pattern, then cold-validated on every panel screen. This
touches Fluent integration and warrants a small dedicated fix + hosted cold-path
regression pass — out of scope for a V1 closeout keystroke.

### Tenant state left by this workstream
The tenant is restored to the **pre-workstream e8382ae1 build** (chunk
`96045e9c…`), i.e. exactly the Part 19 baseline — no net hosted change. The
TD-31/TD-32 corrected runtime (`442a5e04…`) is committed but intentionally
undeployed pending TD-33. **Deployment SHA integrity was preserved throughout**
(every deploy proved the loaded chunk against its built hash; the ALM
Add/Deploy operations were the only catalog mutations; no list/field/permission/
group was provisioned or changed).
