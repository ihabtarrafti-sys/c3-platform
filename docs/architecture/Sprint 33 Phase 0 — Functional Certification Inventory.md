# Sprint 33 Phase 0 — Full Functional Certification Inventory

**Date:** 2026-07-05 · **Author:** engineering agent (read-only Phase 0 — no SharePoint mutation, no implementation)
**Purpose:** Definitive inventory of every intended Internal V1 function and its *current* evidence
state against the **deployed V1 build**, plus the hosted certification plan to reach controlled beta.

> **Classification rule (strict):** a function is **Hosted-green** ONLY if the *current deployed V1
> build (solution 1.0.0.2, runtime `bb2ffba3…`)* has actually exercised it end-to-end in hosted
> SharePoint. Unit tests, mocks, documentation, and prior-sprint hosted evidence on *earlier* runtimes
> do **not** qualify — those are **Source/test-green only**.

---

## 1. Verified repository & deployed baseline

| Item | Value |
|---|---|
| Repo / branch | `C:\Projects\c3-fable` / `master` |
| HEAD = origin/master | `a54e648` ✓ (matches expected) |
| Working tree | clean (only pre-existing untracked `docs/Handoff v2/`, `docs/fable/`) |
| SPFx solution version | **1.0.0.2** (tenant-deployed, enabled, no per-site install) |
| Deployed runtime SHA-256 | `bb2ffba3ce04b57fc7aae30dfa74997ca978c7b8a349b1b5b436ea9a29b0492b` |
| Live host bundle / runtime chunk | `8138ea6a…` / `dc718d6c…` — both match package |
| Full gate (`npm run gate`) | **PASS** — 14 parity harnesses, tsc×2, unpiped strict build, `verify:runtime` (asset `bb2ffba3…` **in sync with deployed**), NUL audit clean |
| Latest closeout | `Sprint 32 Closeout Report.md` — Internal V1.0 declared |
| Beta checkpoint | `C3 Beta Checkpoint — Sprint 32.md` — Part 19 complete |
| Baseline marker | `C3 Internal V1.0 Baseline Marker.md` |
| Tech Debt Register | current; TD-22/31/32/33/34 resolved, TD-29 retained, TD-23/26 contained |

**Consequence:** because `verify:runtime` proves the built source asset equals the deployed runtime,
source inspection in this report faithfully describes the deployed V1 behavior.

## 2. Architecture facts governing the matrix

- **Navigation is in-app state only** (`navigate(C3Screen)`); there are **no URL routes / deep links**
  — a whole class of "invalid-id route" states is N/A by construction.
- **Role model:** `spRoleResolver` maps 6 SP groups → roles by exact Title, priority
  owner > operations > hr > legal > finance > management, **fail-closed to `visitor`** on any error/no-match.
  Groups: `C3 Platform Owners / C3 Operations / C3 HR / C3 Legal / C3 Finance / C3 Management`.
- **Capabilities:** 7 flags × 7 roles (`useCapabilities`): `canCreate, canEdit, canViewFinancials,
  canManageSettings, canUploadDocuments, canCaptureRenewal, isReadOnly`.
- **NavRail gating (SP DSM):** Amendments **hidden** (SP service stub, TD-03); Intelligence **hidden**
  (cold-load crash, TD-23); Renewals/Inbox/Approvals require `role !== visitor`; Settings requires
  `canManageSettings` (owner); everything else visible.
- **Governed writes (ADR-013, 6 operation types)** flow submit → `C3Approvals` → owner Approve →
  Execute: **AddPerson, AddCredential, DeactivateCredential, InitiateJourney, AddMissionParticipant,
  RemoveMissionParticipant** (dispatched in `useExecuteApproval`).
- **Narrow write exemptions (direct SP writes, role-gated):** Journey lifecycle
  (complete/suspend/resume/cancel — S19 exemption, Operations Edit on C3Journeys); Kit lifecycle
  (create/deactivate/transition — S29A exemption); Apparel `upsertApparelProfile` (role-gated profile).
- **SP-stub surfaces (return empty / throw in SP DSM):** `SharePointAmendmentService` (all methods),
  `SharePointFinanceService.listMissionFinanceLines`, `SharePointMilestoneService` (list empty,
  complete throws), `SharePointMissionService.confirmMission` + `updateMissionStatus` (throw, TD-26),
  `SharePointContractService.listContractActivities` (throws — Activity tab shows honest error/empty).
- **⚠ Toasts are DISABLED in the hosted SPFx app** (`C3Host` passes `disableToasts:true`; `App.tsx`
  omits `<Toaster>`). All write-action confirmation toasts (e.g. "Approval APR-XXXX submitted") do
  **not** render hosted — feedback relies on panel close + cache refresh + inline state. **Must be
  verified during write certification** (see §5, RISK-1).

---

## 3. Complete functionality matrix

Evidence legend: **HG** Hosted-green (current V1 build) · **SG** Source/test-green only · **DEF** Defective ·
**DFR** Deferred · **MOCK** Mock/dev only · **UNV** Unverified (account/data limits) · **N/A**.

### 3.1 Shell / global
| Function | Type | SP-DSM behavior | Evidence |
|---|---|---|---|
| SPFx host mount + fail-closed error + `__C3_HOST_DIAGNOSTICS` | infra | mounts | **HG** (19.0/19.6) |
| App shell + NavRail render + user/role footer | infra | renders | **HG** (owner) |
| Role resolution owner path (group→owner) | access | owner | **HG** (owner; `["C3 Platform Owners"]`) |
| Role resolution operations/legal/finance/hr/management/visitor | access | per group | **UNV** (only owner account available) |
| Capability gating (buttons/sections per role) | access | per role | owner **HG**; other roles **UNV** |
| NavRail DSM gating (Amendments/Intelligence hidden) | access | hidden | **HG** |
| In-app navigation (state-based) | nav | works | **HG** (owner, many screens) |
| Toast feedback | UX | **disabled hosted** | **DEF/RISK** (see RISK-1) |

### 3.2 Command Center
| Function | Type | Evidence |
|---|---|---|
| Work queue render (gaps/missions/milestones/participants via `useWorkItems`) | read | **HG** (19.6 — 17 items, 2 immediate) |
| Work-item cards + severity banding | read | **HG** |
| Card actions (View Mission / Start Journey / Assign Owner → nav) | nav | **SG** (targets not re-cert on V1) |
| Error guard on data failure (TD-02) / "All clear" empty | state | contracts path **HG** (19.3); general **SG** |

### 3.3 Contracts / Contract Profile / Renewals
| Function | Type | Evidence |
|---|---|---|
| Contracts register read + filters + truthful metrics + empty state | read | **HG** (19.1) |
| Genuine row → Contract Profile nav | nav | **HG** (19.4) |
| New Contract control | — | **HG (absent — TD-31)** |
| Contract Profile Overview canonical values (ID/person/type/stage/dates/USD) | read | **HG** (19.4) |
| Canonical identity (`ContractID := Title`, no numeric Id) | read | **HG** (19.4) |
| "Contract not found" fail-closed | state | **HG** (19.3/19.4) |
| Contract Profile → Open Person nav | nav | **HG** (19.4) |
| Contract Profile Documents tab | read | **DFR** (honest "not yet available") |
| Contract Profile Activity tab (`listContractActivities` throws) | read | **DFR** (honest error/empty; no SP impl) |
| Contract Profile Amendments tab (SP stub) | read | **DFR/MOCK** (SP service stub) |
| Renewals center read + 30/60/90 windows + truthful empty/all-clear | read | **HG** (19.1/19.4) |
| Capture-renewal action (`canCaptureRenewal`) | write | **DFR/MOCK** (no SP renewal-write path) |

### 3.4 People / Person Profile / Credentials / Journeys
| Function | Type | Evidence |
|---|---|---|
| People register read + columns + filters | read | **HG** (19.4/19.6) |
| No stale TotalContracts column (TD-32) | read | **HG** |
| People cold-load safe (TD-33) | state | **HG** (19.6) |
| Add Person panel **opens** cold-safe | UX | **HG** (open only, 19.6) |
| Add Person governed chain (submit→approve→execute→`createPerson`) | gov-write | **SG** (not exercised on V1; creates test person) |
| Person Profile identity + canonical contract count (derived) | read | **HG** (19.4 — count 1) |
| Person Profile Contracts section | read | **HG** (19.4) |
| Credentials section read (`usePersonCredentials`) | read | **SG** |
| Add Credential panel + governed chain | gov-write | **SG** |
| Deactivate Credential governed chain | gov-write | **SG** |
| Recover credential/deactivation execution stamp | gov-write | **SG** |
| Start Journey panel + `InitiateJourney` governed chain | gov-write | **SG** |
| Journey lifecycle: complete/suspend/resume/cancel (exemption) | exempt-write | **SG** |
| Recover journey execution stamp (partial-execution) | gov-write | **SG** |
| Person Profile Approvals tab (person-scoped history) | read | **SG** |
| Person Profile Readiness tab (`usePersonReadiness`) | read | **SG** |
| Person Profile Missions section (`usePersonMissions`) | read | **SG** |
| Apparel section read + `upsertApparelProfile` (exemption) | read/exempt-write | **SG** |

### 3.5 Missions / Situation Room / Kits / Apparel
| Function | Type | Evidence |
|---|---|---|
| Mission workspace read (`listMissions`/`getMission`) | read | **SG** (SP has ~2 rows; not re-cert on V1) |
| Kit status display + readiness facet strip | read | **SG** |
| Add Mission Participant governed chain | gov-write | **SG** |
| Remove Mission Participant governed chain | gov-write | **SG** |
| Kit assignment create / deactivate / status transition (exemption) | exempt-write | **SG** |
| Apparel profile upsert (exemption) | exempt-write | **SG** |
| Situation Room readiness cockpit + gaps + zero-gap state | read | **SG** |
| Approve & Confirm Mission (TD-26) | write | **hidden in SP DSM**; write **DFR** |
| Mission finance lines (SP stub) | read | **DFR/MOCK** |
| Mission milestones + complete milestone (SP stub) | read/write | **DFR/MOCK** |

### 3.6 Approvals / Inbox / Diagnostics
| Function | Type | Evidence |
|---|---|---|
| Approvals inbox read + tabs (Pending/Approved/Executed/Rejected/Failed/All) | read | **SG** (owner-only) |
| Approve / Reject (`patchApprovalStatus`, self-approval guard) | approval-op | **SG** |
| Execute (`stampExecution`, all 6 op types) | approval-op | **SG** |
| Recover Execution Stamp (3 recovery paths) | approval-op | **SG** |
| Freshness read + real-ETag precondition (412 on stale) | conflict | **SG** (TD-29 residual race accepted) |
| Complete paged/exhaustive queries (no top-500 truncation, TD-19) | read | **SG** |
| Operational Inbox read (renewal aggregation, metric cards, cross-links) | read | **SG** |
| Developer Diagnostics (mode/adapter/read=Yes/write=No) | read | **HG** (19.0) |

### 3.7 Hidden / deferred / mock-only / N/A
| Function | State |
|---|---|
| Amendments workspace + Amendment Profile | **MOCK** (hidden SP DSM; SP service stub — TD-03) |
| Intelligence workspace | **MOCK/DFR** (hidden SP DSM; cold-crash — TD-23) |
| Settings screen (`canManageSettings`) | **SG/UNV** (owner-only; not cert on V1) |
| Mission finance / milestones | **DFR** (SP stubs) |
| Mission confirmation write (TD-26) | **DFR** (hidden SP DSM) |
| Legacy `C3_Contracts` → `C3Contracts` migration tool | **DFR** (post-V1, TD-22 remnant) |
| Contract/credential document upload | **DFR** (not yet available) |

---

## 4. Exact hosted evidence already available (current V1 build)

From Sprint 32 Part 19 + the 19.6 recovery session, all on solution **1.0.0.2 / `bb2ffba3…`**:

- **Deployment & host:** catalog 1.0.0.2 deployed/enabled/no per-site; live bundles match package;
  host reaches `mount-complete`; visible fail-closed + diagnostics (19.0/19.6).
- **Command Center:** renders with live Operations Work Queue (17 items, 2 immediate) — read path exercised (19.6).
- **Contracts:** truthful empty state (19.1); register renders the genuine row; **Contract Profile**
  GKE-PL-2026-001 opens from **both** the register and the People profile, canonical plain-text ID,
  values match SharePoint, Contracts rail highlighted (19.4).
- **Renewals:** truthful "All clear"/tracking-active with 30/60/90 windows (19.1/19.4).
- **People:** register renders, **no stale TotalContracts column**, cold-load safe; **Person Profile**
  canonical contract count = 1; **Add Person panel opens cold-safe** (19.4/19.6).
- **Failure drill:** injected contract-read fault → honest fail-closed "Could not load contracts" (19.3).
- **Cold modal safety (TD-33):** re-verified this session on People + Add Person (bb2ffba3).
- **Diagnostics screen:** Mode `sharepoint`, Adapter v1.0, Read=Yes / **Write=No** (19.0).
- **Owner role path** only (Ihab Tarrafti / `C3 Platform Owners`).

Everything above is **read/render/navigation** and the Contracts identity path. **No governed write,
no approval execution, and no per-role behavior has been exercised on the V1 build.**

## 5. Functionality still requiring hosted testing (the certification gap)

1. **All 6 governed write chains end-to-end** on V1: AddPerson, AddCredential, DeactivateCredential,
   InitiateJourney, AddMissionParticipant, RemoveMissionParticipant (submit → C3Approvals row → owner
   Approve → Execute → SP effect → cache refresh).
2. **All 4 approval operations:** Approve, Reject (reason required), Execute (each op type), Recover
   Execution Stamp (3 partial-execution paths); self-approval refusal; freshness/ETag 412 drill.
3. **Journey lifecycle** (complete/suspend/resume/cancel) + invalid-transition refusal, on V1.
4. **Kit lifecycle** (create/deactivate/transition) + duplicate/uniqueness enforcement, on V1.
5. **Apparel upsert** (create + edit) on V1.
6. **Missions workspace, participants, readiness cockpit (Situation Room), Person Profile
   Credentials/Journeys/Missions/Readiness/Approvals tabs, operational Inbox, Settings** — read
   render on V1 against live data.
7. **Per-role access matrix** for operations/legal/finance/hr/management/visitor (capability gating,
   read-only denials, financial visibility, write 403 truthful states) — **blocked on test accounts**.
8. **Toast-disabled write feedback** (RISK-1): confirm users get adequate non-toast feedback hosted.
9. **Empty/denied/degraded/failure states** on non-Contracts surfaces against live SP.
10. **Validation / duplicate / ETag / conflict** behaviors exercised hosted (currently jest/parity only).

## 6. Current defects & blockers

| # | Item | Severity | Disposition |
|---|---|---|---|
| RISK-1 | **Toasts disabled hosted** (`disableToasts:true`) — write confirmations/toasts suppressed; feedback via panel-close + cache only | 🟠 to verify | Verify during write cert; if inadequate, V1-blocking UX fix (inline confirmation) |
| RISK-2 | **Finance/Milestone sections in Situation Room** backed by SP stubs (return `[]`) — potential silent-empty (TD-02 class) if unguarded | 🟡 to verify | Confirm SituationRoom shows honest unavailable, not false "complete/zero" |
| TD-34 | Blank render recurs after rapid redeploys | 🟢 resolved w/ workaround | Edit→Cancel re-mount; avoid rapid redeploys |
| TD-23 | Intelligence cold-crash | 🟡 contained | Hidden in SP DSM (accepted for V1) |
| TD-26 | Mission confirmation write is a throwing stub | 🟡 contained | Action hidden in SP DSM (accepted for V1) |
| TD-03 | Amendments SP service stub | 🟡 contained | Hidden in SP DSM (accepted for V1) |
| TD-29 | Two-session approval execution race | 🟢 accepted | Single-owner execution |

**No new source defect found in Phase 0.** RISK-1 and RISK-2 are *verification items* that could become
V1 blockers depending on hosted behavior; everything else is a known, contained limitation.

## 7. Required test records & accounts

**Accounts (primary blocker for role certification):**
- ✅ Owner — Ihab Tarrafti (`C3 Platform Owners`) — available.
- ❌ One test account each in `C3 Operations`, `C3 Legal`, `C3 Finance`, `C3 HR`, `C3 Management`, plus
  a no-group account for `visitor`. **None currently available.** Minimum viable: **Operations** (governed
  submitter + journey/kit exemptions) and one **read-only** role (Finance or Management) to prove
  denial + financial gating. Full matrix needs all six.

**Test data (per domain, dedicated/synthetic, never the genuine row):**
- People: 1–2 disposable test persons (e.g. `PER-TEST-*`) for AddPerson/credential/journey cert.
- Credentials: created via governed chain on a test person.
- Journeys: initiated via governed chain, then lifecycle-transitioned.
- Missions: 1 test mission (or the existing non-genuine mission rows) for participant/kit/apparel.
- Approvals: generated by each submit; drive through Approve/Reject/Execute/Recover.
- Genuine contract **GKE-PL-2026-001 and real people must not be modified.**

## 8. Destructive-risk controls & cleanup plan

- **Isolation:** perform every write against **dedicated test persons/mission**, never genuine
  operational rows; tag test rows with a recognizable prefix.
- **No schema/ACL touch:** Phases 3C/3D are permanently closed — do **not** run their tooling; no
  provisioning, no field/ACL changes during certification.
- **Governed-write side effects create real rows** in C3Approvals + the target list (C3People,
  C3Credentials, C3Journeys, C3MissionParticipants, C3MissionKitAssignments, C3PersonApparelProfiles).
  **Cleanup:** after each drill, recycle the created test rows and set their approvals to a terminal
  state (or recycle), via owner ALM/REST reads-then-recycle — mirroring the Part 19.6 recycle pattern.
- **ETag/conflict drills** are non-mutating by design where possible; where they create an approval,
  include it in cleanup.
- **Reversibility:** prefer submit→reject (no downstream effect) to prove the pending path before
  submit→approve→execute; execute only on test targets.
- **Baseline protection:** capture a pre-cert snapshot of each touched list's item count; verify
  post-cleanup counts return to baseline (+0 net) before declaring cert complete.
- **Genuine-row guard:** re-assert GKE-PL-2026-001 and real C3People rows unchanged at cert close.

## 9. Recommended hosted certification sequence

Ordered to prove reads first, then reversible writes, then irreversible executes, cleaning up as it goes:

1. **Render/read sweep (owner):** Command Center, Contracts, Contract Profile (all tabs incl. honest
   deferred), Renewals, People, Person Profile (all tabs), Missions, Situation Room, Inbox, Approvals,
   Settings, Diagnostics — confirm each renders truthfully against live SP; capture RISK-2.
2. **Approval submit + reject (reversible):** submit one of each of the 6 op types on a test target →
   verify C3Approvals row + **RISK-1 feedback** → Reject with reason → confirm no downstream effect.
3. **Approval approve + execute (irreversible, test targets):** AddPerson → AddCredential →
   InitiateJourney → journey lifecycle → AddMissionParticipant → kit lifecycle → apparel upsert →
   DeactivateCredential → RemoveMissionParticipant; verify SP effect + cache refresh each.
4. **Recovery + conflict drills:** partial-execution recover ×3; self-approval refusal; stale-status
   refusal; ETag 412 on concurrent MERGE.
5. **Per-role matrix** (as accounts arrive): Operations (submit + exemptions), a read-only role
   (denials + financial gating), Legal, HR, Management, Visitor (fail-closed).
6. **Cleanup + baseline reconciliation**, then **genuine-row re-verification**.

## 10. Exact Sprint 33 implementation & validation scope

Sprint 33 is a **certification + blocker-fix sprint — no new major feature.** Scope:

- **Implement only what certification proves broken.** Pre-committed candidates:
  - **RISK-1 fix (conditional):** if hosted write feedback is inadequate with toasts disabled, add an
    inline/non-toast confirmation surface for governed submits/executes (small, gated).
  - **RISK-2 fix (conditional):** ensure Situation Room shows honest "unavailable" for stub-backed
    finance/milestones in SP DSM (guard or hide), never a false zero.
- **No schema, ACL, provisioning, or new-domain work.** Phases 3C/3D stay closed.
- **Validation:** every fix passes `npm run gate` (parity + tsc×2 + strict build + verify:runtime +
  NUL); any new behavior gets a parity check; re-cert the affected hosted path on the deployed build.
- **Version discipline:** bump SPFx `1.0.0.2 → 1.0.0.3` only if a runtime/host change ships; **one**
  clean deploy per change with propagation time (TD-34 lesson); no rapid redeploys.
- **Exit artifact:** a Hosted Functional Certification record (per-function HG evidence) + updated
  checkpoint/TD register + a beta-entry sign-off.

## 11. Beta entry criteria (after certification)

Enter controlled internal beta only when **all** hold:
1. Every **V1-intended** function is **Hosted-green on 1.0.0.x** (this report's matrix all HG, or
   explicitly accepted/deferred).
2. **All 6 governed write chains** and **all 4 approval operations** proven hosted end-to-end with cleanup.
3. **RISK-1 and RISK-2 resolved or accepted** with evidence.
4. **At least Operations + one read-only role** certified for access/denial/financial gating (full
   6-role matrix is the target; document any role deferred for lack of accounts).
5. Genuine-row integrity re-verified; touched lists reconciled to baseline counts.
6. Gate PASS; deployed runtime SHA == certified SHA; TD register current.
7. Rollback/support runbook (incl. TD-34 Edit→Cancel and clean retract+redeploy) published.

## 12. Explicitly excluded / deferred (not in V1 certification)

- Amendments workspace/profile (SP stub — mock only); Intelligence (cold-crash — hidden).
- Mission confirmation write (TD-26); mission finance lines; mission milestones (SP stubs).
- Contract/credential document upload; capture-renewal write path.
- Legacy `C3_Contracts` → `C3Contracts` data-migration tool (TD-22 remnant).
- Full 6-role matrix **if** accounts are unavailable — those roles are **UNV**, certified when accounts exist.
- Any new feature, screen, or domain. CI/CD (TD-14), license (TD-17), and standing quality gaps
  (TD-05/10/15/16/21) remain post-V1.

---

**Phase 0 stop point.** This is the decision-grade inventory and certification plan. No SharePoint was
mutated and no code was implemented. Await direction on account provisioning and go/no-go for the
hosted certification sequence (§9) before Sprint 33 execution.
