# Sprint 33 — Priority Correction Set: Cold-Load Recovery + Self-Approval Identity Hardening

Date: 2026-07-05 · Author: platform engineering (agent) · Status: **CLOSED
HOSTED-GREEN — 1.0.0.5 deployed (owner-authorized), cold-load acceptance 5/5,
identity drill green, integrity reconciled. TD-34 RESOLVED (see register).**

## Source / gate evidence

| Item | Value |
| --- | --- |
| Baseline pushed | origin/master = `eb1e7f0` (1.0.0.3, runtime 72c2f441) — verified via ls-remote before work began |
| fix(s33) correction set | `f52acc6` — cold-load recovery (TD-34), canonical self-approval identity, honest Activity tab |
| build 1.0.0.4 | `1689c6c` — sppkg SHA `57636001…`, 284,628 B; host `8b351e10` (3a1ef8f8), chunk `bd2f96fb` (d8d92575), runtime asset `174a8c47…` |
| fix(s33) root-cause containment | `b1c6120` — non-fatal Tabster pre-registration + foreign-instance probe |
| build 1.0.0.5 | `8cc587a` — sppkg SHA `13cced9330c35d48529e3cf0d69bff252afa1f99b8fa588d746023597e268a24`, 284,852 B; host `e3793cdb` (0b949897), chunk `56d7ab00` (3b86aa5d), runtime asset `63b9a05c…` |
| Gate | PASS both times — 22 steps: 17 parity scripts (2 new: s33-parity-cold-load-recovery, s33-parity-identity-hardening), 2× tsc, strict build, verify:runtime, NUL/truncation audit |
| Push state | origin/master = `8cc587a` (all four commits pushed) |

## Defect A — TD-34 (see the Tech Debt Register entry for the full narrative)

- Failure-class instrumentation shipped in 1.0.0.4: runtime root ErrorBoundary +
  FirstCommitSignal; host single bounded commit deadline + one-shot recovery +
  stages runtime-committed/runtime-error/recovering/recovered/recovery-failed.
- **Proven cause (hosted 1.0.0.4):** foreign older tabster instance created by the
  SP page shell is adopted by tabster 8.x; `useModalAttributes` at app init
  (S32 TD-33 fix) crashes the first render → React 18 unmounts the whole tree.
  3/3 instrumented loads (cold and warm) reproduced `runtime-error`
  `TypeError: … (reading 'set')`; the visible fail-closed fallback replaced the
  historical silent blank. Recovery correctly did NOT fire (this is the
  committed-error class, not the no-commit class).
- **Correction (1.0.0.5):** TabsterInitializerBoundary (non-fatal) +
  `__C3_TABSTER_PROBE`. A/B harness against the real built runtime assets under a
  simulated foreign instance: 1.0.0.4 → fallback, no app; 1.0.0.5 → full app
  renders, probe `{preExisting:true, foreign:true}`, sanitized non-fatal warning.

## Defect B — self-approval identity normalization (in 1.0.0.4, deployed)

- `packages/c3/src/utils/identity.ts`: `canonicalizeIdentity` (trim, case-fold,
  anchored `i:0#.f|membership|` strip only, plausible-UPN validation, null on
  anything else) + `checkSelfReview` (FAIL CLOSED on indeterminate reviewer or
  submitter; canonical equality blocks; no substring or cross-domain equating).
- Applied at BOTH guard sites: `usePatchApprovalStatus` (SelfApprovalError,
  indeterminate variant) and `MockApprovalsService` (DSM parity). The prior raw
  `===` failed OPEN on claims-vs-bare-email mismatch and empty current identity.
- Live relevance: legacy pending rows APR-0034 / APR-0045 carry bare-email
  SubmittedBy (`ihab@…`) while sessions carry claims format — previously
  self-approvable, now blocked. No legacy row was mutated; hosted UI exercise of
  the block is pending the 1.0.0.5 deployment (app must render first).
- Sweep: no other raw identity comparisons exist in approvals/delegation paths
  (only the two guard sites; enforced by parity check).

## Truthfulness — Contract Profile Activity tab (in 1.0.0.4, deployed)

"No activity yet" → "Activity not yet available … not yet supported" (both DSMs
return [] unconditionally; backend/schema deferred). No activity backend work.

## Hosted verification ledger (1.0.0.4)

| # | Load | Result | Diagnostics |
| --- | --- | --- | --- |
| 1 | Cold (fresh bundle URLs, post-deploy) | Visible fail-closed fallback (NOT blank) | stage runtime-error, TypeError reading 'set', commit 89 ms, import resolved, target connected |
| 2 | Cold (Ctrl+Shift+R hard reload) | Same | runtime-error, 27 ms |
| 3 | Warm (normal reload) | Same | runtime-error, 9 ms |

Conclusion: on current SP page composition the shell wins the tabster race on
every load — 1.0.0.4 cannot meet the five-cold-loads acceptance; 1.0.0.5 is the
required correction. Integrity baseline (captured pre-verification, unchanged by
this work): C3Approvals 35 items with pending APR-0034/APR-0045 untouched,
C3Contracts 1 (GKE-PL-2026-001, Id 49), C3Journeys 11, C3Missions 4, C3People 14,
C3_People 8, C3_Users 2. Deployment actions were catalog Add+Deploy only — no
retract, no per-site install, no list/ACL/schema/data operation.

## 1.0.0.5 hosted closure (2026-07-05, owner-authorized deployment)

**Pre-deploy artifact verification:** HEAD = origin = `34bcef8`, tracked tree
clean, version 1.0.0.5, runtime asset `63b9a05c…`, sppkg `13cced93…` 284,852 B —
all matched the recorded values byte-for-byte (committed asset = working asset);
no rebuild performed. Upload bytes re-hashed IN THE BROWSER before Add:
`13cced9330c35d48…`. Add 200 → Deploy 200 (skipFeatureDeployment), catalog
1.0.0.4 → **1.0.0.5 Deployed / Enabled / valid / "No errors."** No retract, no
per-site install. Live bundles re-fetched and hashed in-page: host
`0b949897…` (13,830 B), chunk `3b86aa5d…` — byte-match the package.

**Cold-load acceptance: 5/5 rendered — TD-34 acceptance met.**

| # | Isolation | Result | Stage | Commit | Recovery | Probe |
| - | --- | --- | --- | --- | --- | --- |
| 1 | Fresh 1.0.0.5 bundle URLs, first fetch (chunk 358,956 B over network) | APP RENDERED | runtime-committed | 27 ms | none | preExisting+foreign |
| 2 | Ctrl+Shift+R hard reload, tab 1 (host+chunk over network) | APP RENDERED | runtime-committed | 5 ms | none | preExisting+foreign |
| 3 | Separate tab, first load (fresh JS/render context) | APP RENDERED | runtime-committed | 24 ms | none | preExisting+foreign |
| 4 | Ctrl+Shift+R hard reload, tab 2 | APP RENDERED | runtime-committed | 11 ms | none | preExisting+foreign |
| 5 | Ctrl+Shift+R hard reload, tab 1 | APP RENDERED | runtime-committed | 6 ms | none | preExisting+foreign |

No blank, no root fallback, no Edit → Cancel, zero recovery remounts (single
mount every time), single application instance every time (one NavRail; the two
container markers = SPFx legacy root + runtime React 18 root, by architecture).
The foreign SP-shell tabster instance was PRESENT ON ALL FIVE LOADS and never
prevented rendering — the S32-era intermittency is fully explained: 1.0.0.4 and
earlier crashed whenever that instance existed pre-mount; 1.0.0.5 tolerates it.

**Functional regression:** Command Center (work queue 17 items), People (14),
Contracts (GKE-PL-2026-001 listed, New Contract absent), Contract Profile from
the register AND from the Person Profile (both resolve, correct fields, no
"Contract not found"), Activity tab shows the honest "Activity not yet
available … not yet supported" copy (old copy absent), NavRail navigation used
throughout, Fluent aria-live regions present.

**Identity + notification drill (zero-mutation, certification row preserved):**
APR-0034/0045 untouched. Created ONE labelled certification approval from the
Owner account: **APR-0054** (item Id 54, AddPerson, reason "DO NOT EXECUTE —
self-approval and hosted-feedback test… preserve"). Inline SUCCESS notification
rendered hosted ("Approval APR-0054 submitted…"; exactly one POST /items, 201).
Live format evidence: the stored SubmittedBy is **bare email/UPN** while the
session login is **claims format** — `rawStringsIdentical: false`,
`canonicalSamePerson: true` (computed in-page; no identity values exported).
Under the old raw `===` guard this row was self-approvable. UI Approve attempt:
inline refusal **"Self-approval not permitted"**, row remained Submitted, and
the network trace after the click contains ONLY GETs (freshness read of
items(54)) — zero POST/MERGE/PATCH. APR-0054 is preserved as evidence (do not
approve, execute, or recycle). Canonical matrix (claims↔bare, case, whitespace,
malformed → fail closed) remains parity-proven (s33-parity-identity-hardening).

**Integrity reconciliation (post-testing):** People 14, Credentials 18,
Journeys 11, Missions 4, MissionParticipants 4, KitAssignments 6,
ApparelProfiles 4, Contracts 1, C3_People 8, C3_Users 2 — all unchanged.
C3Approvals 36 = baseline 35 + exactly APR-0054. APR-0034 and APR-0045:
Submitted with byte-identical Modified timestamps. GKE-PL-2026-001 (Id 49):
Title and Modified unchanged.

**Residual (tracked with TD-33, follow-up):** on a foreign-instance session the
FIRST Fluent modal open after a cold load can crash once, bounded at the
screen-level ErrorBoundary (observed: People → Add Person → screen fallback;
navigate-away + retry immediately succeeded and the panel worked normally).
Real tabster interop fix needs its own hosted validation cycle.
