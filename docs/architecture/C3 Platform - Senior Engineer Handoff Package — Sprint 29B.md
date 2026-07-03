# C3 Platform — Senior Engineer Handoff Package — Sprint 29B

**Document type:** Authoritative technical memory — self-contained handoff for a fresh advanced-AI session with no prior context
**Prepared:** 2026-07-03, from direct inspection of the current source tree (source wins over every older document)
**Baseline commit:** `98bec97` — `docs(s29b): Close governed participant membership sprint`
**Sprint state:** Sprint 29B CLOSED and hosted-green · **Sprint 30 (Mission Readiness Cockpit) is the recorded next direction — Phase 0 not started**

> This package supersedes `C3_Authoritative_Project_Handoff_2026-07-02.md` and
> `C3 Platform - Senior Engineer Handoff Package.md` (both under `docs/fable/`). Known stale
> claims in those documents are corrected in §2/§3 notes below.

---

## 1. Repository state

| Item | Value |
|---|---|
| Working copy | `C:\Projects\c3-fable` (a second clone exists at `C:\Projects\c3-platform` — treat c3-fable as THE working copy; keep the other in sync or archive it) |
| Remote | `https://github.com/ihabtarrafti-sys/c3-platform` |
| Branch | `master` (only branch used; Claude commits directly, the user pushes) |
| Head at handoff | `98bec97` (S29B closeout) → handoff commit follows |
| Clean-tree expectation | Tracked tree clean after every commit; **`docs/fable/` is intentionally untracked** (onboarding material — do not stage, move, or delete without instruction) |
| Runtime bundle (committed) | `packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js` |
| Runtime build output (gitignored) | `packages/c3/dist-runtime/c3-runtime.js` |
| **Final runtime SHA-256** | `b29de64d1f976f4bbee090a9b98b42feb4e7078af284138fbfe9bac7c85fa6fd` (deployed + hosted-validated) |

**Build/deploy:** `npm run beta:runtime` (Vite build + copy into SPFx assets) →
`npm run verify:runtime` (SHA-256 dist-vs-asset) → commit both → user pushes → user rebuilds
the SPPKG and deploys via the App Catalog. There is no CI/CD (open debt).

**Full validation gate (ALL required before any source commit):**

```bash
node scripts/s18-parity-approvals.mjs      # 55/55
node scripts/s17-parity-journeys.mjs       # 51/51
node scripts/s15-parity-test.mjs           # 87/87
node scripts/s16-parity-people.mjs         # 220/220
node scripts/s27-parity-participants.mjs   # 28/28
node scripts/s28-parity-logistics.mjs      # 35/35
node scripts/s29-parity-kit-lifecycle.mjs  # 38/38
node scripts/s29b-parity-participant-writes.mjs  # 34/34
npx tsc --noEmit -p packages/c3/tsconfig.json
npx tsc --noEmit -p packages/c3-spfx-host/tsconfig.json
npm run beta:runtime     # MANDATORY — runs the STRICT `tsc -b` path
npm run verify:runtime
# plus: NUL-byte audit of every changed file (python binary read)
```

> **Strict-build warning:** plain `tsc --noEmit -p packages/c3/tsconfig.json` does NOT catch
> everything (`noUnusedLocals` and some structural errors surface only in the
> `tsc -b`/tsconfig.app.json path inside `beta:runtime`). It missed real failures twice in
> S29. Never trust noEmit alone.

**Windows environment notes:** global `core.autocrlf=true`; the repo-root `.gitattributes`
marks `c3-runtime.js -text` so the bundle checks out byte-identical (without it,
`verify:runtime` fails and a byte-different bundle could ship — this bit the project at S26
onboarding). Historical sandbox sessions truncated files mid-write (see
`C3Missions Provisioning Post-Mortem.md` §"what happened" and the TD-24 repair note) — run a
NUL/empty-file audit on all changed files before every commit. LF→CRLF warnings on commit are
normal and harmless.

## 2. Product and architectural identity

- **Brand:** C3 · **Domain:** `c3hq.org` · **Tagline:** *Control. Command. Coordinate.* ·
  **Expanded meaning:** **Control Command Center** (older docs saying "Contract Control
  Center" describe the project's origin, not its identity).
- **Principle:** Evidence → Reasoning → Operational Truth → Ownership → Action. C3 is
  governed operational intelligence for Geekay Esports (UAE/KSA), not generic CRUD.
- **Host:** SPFx web part on `https://geekaygames.sharepoint.com/sites/C3` (site regional
  timezone is the tenant default UTC-8 — **write SP dates as explicit UTC midnight** or
  dates shift a day).
- **Mock DSM** (LocalHost) is the demo AND regression baseline — mock services share the
  same pure guard modules as SP services; mock seeds mirror SP sample rows 1:1.
- **Native fetch only** (`credentials:'same-origin'`, `odata=nometadata` for reads,
  `odata=minimalmetadata` where ETags are needed). **No PnP.js, ever.**
- **Platform SDK v1.0 frozen** (ADR-012). Runtime bundle committed to git (accepted debt,
  `verify:runtime` mitigates).
- **ADR-013** governs operational-truth writes. Exact current exemptions: the S19 Journey
  Lifecycle Addendum (Complete/Suspend/Resume/Cancel — role-gated) and the S29A
  **Mission Kit Logistics Exemption** (`ADR-013 Addendum — Mission Kit Logistics
  Exemption.md` — kit create/transition/deactivate + apparel upsert, explicitly narrow).
  Note: the two pre-S26 handoffs number some ADRs inconsistently (both use "ADR-001" for
  different decisions); no consolidated ADR index exists — trust the per-decision documents
  and source comments.

## 3. Runtime and host architecture (verified against source)

- **Startup:** `packages/c3/src/bootstrap/mountC3.tsx` → `hosts/HostContext.tsx` →
  `hosts/SharePointHost.tsx` (SPFx: threads `spSiteUrl` + `loginName`, resolves role via
  `hosts/spRoleResolver.ts` against SP groups, fail-closed to `visitor`) or
  `hosts/LocalHost.tsx` (mock; older docs saying "MockHost.tsx" are wrong) →
  `contexts/AppContext.tsx` (currentUser, screen state, `navigate()`, config incl.
  `dataSourceMode` + `spSiteUrl`).
- **Services:** ServiceRegistry (`services/sharepoint/index.ts`) for
  contracts/people/credentials/journeys/users/diagnostics/amendments, PLUS parallel-factory
  hooks (ADR-001) for missions (`useMissionService` — missions, participants, kit),
  approvals (`useApprovalsService` — needs loginName), and apparel
  (`useApparelProfileService`).
- **Roles/capabilities** (`types/roles.ts` — the REAL model; older handoffs list
  nonexistent `canApprove`/`canViewFinance`): `canCreate` (owner, operations), `canEdit`,
  `canViewFinancials` (owner, finance, management), `canManageSettings` (owner),
  `canUploadDocuments`, `canCaptureRenewal`, `isReadOnly`. Approval actions gate directly on
  `c3Role === 'owner'`; journey lifecycle and S29 write UIs gate on explicit
  `owner||operations` (+`hr` for apparel) role checks.
- **Screens** (15 in `types/screens.ts`; 15 components in `src/screens/`):
  command-center, contracts, contract-profile, people, person-profile, renewals,
  amendments, amendment-profile, inbox, intelligence, situation-room, **missions**,
  settings, developer-diagnostics, approvals.
- **NavRail SP DSM guards (exactly three):** Contracts (S24 — list unprovisioned),
  Amendments (S20 — SP service stub), Intelligence (TD-23 cold-load). Missions is VISIBLE
  (S26-5). One in-screen guard: SituationRoom "Approve & Confirm Mission" hidden in SP DSM
  (TD-26).
- **ErrorBoundary** wraps `renderScreen()` with `key={screen.id}` (resets per navigation).
- **Cache:** TanStack Query v5; keys centralised in `hooks/queryKeys.ts`; use `isPending`
  for frame-zero gates (TD-23 lesson); default data at hook boundaries; hooks before early
  returns; writes invalidate BOTH per-entity and batch keys (e.g.
  `mission.participants(id)` + `mission.allParticipants()`).

## 4. Current domain inventory

| Domain | Type (authoritative) | Business ID | SP list | Read | Write | UI |
|---|---|---|---|---|---|---|
| People | `types/people.ts` `Person` | `PER-XXXX` (=Title) | C3People | ✅ | governed AddPerson (POST-then-MERGE PER id) | PeopleWorkspace, PersonProfile |
| Credentials | `types/credentials.ts` `Credential` (retains SP `Id`) | `CRED-XXXX` (=Title) | C3Credentials | ✅ | governed Add + Deactivate | PersonProfile |
| Journeys | `types/journeys.ts` `Journey` | `JRN-XXXX` (=Title) | C3Journeys | ✅ | governed Initiate + role-gated lifecycle | PersonProfile |
| Approvals | `utils/spApprovalMapper.ts` `C3Approval` | `APR-XXXX` (**derived from SP item Id since S29B**; legacy Titles pass through) | C3Approvals | ✅ | Add-only submitters; owner stamps | ApprovalInbox |
| Contracts | `types/contracts.ts` `Contract` | operational id (e.g. GKE-PL-2026-003) in Title | C3Contracts (**unprovisioned**) | code ✅ / **hidden in SP DSM** | ❌ | ContractsList/Profile, Renewals (mock) |
| Missions | `types/mission.ts` `Mission` (**frozen — never extend**) | business TR/SATR code (=Title, **never SP-generated**) | C3Missions (live; has `zzOLD *` residue columns awaiting user cleanup) | ✅ | ❌ (TD-26) | MissionWorkspace, SituationRoom |
| Mission participants | `MissionParticipant` (frozen: MissionID, PersonID, ExternalCode, Role, PerDiemRate?) | `MissionID+PersonID` | C3MissionParticipants (live; Title unique) | ✅ | **governed Add/Remove (S29B)** incl. reactivation | MissionWorkspace |
| Apparel profiles | `types/logistics.ts` `ApparelProfile` | `PersonID` (one active/person) | C3PersonApparelProfiles (live; Title unique; versions 50) | ✅ | role-gated upsert (owner/ops/**hr**) | PersonProfile |
| Kit assignments | `types/logistics.ts` `KitAssignment` | `MissionID+PersonID+ItemCategory+AssignmentKey` | C3MissionKitAssignments (live; Title unique; versions 50; StatusNotes audit) | ✅ | role-gated create/transition/deactivate (owner/ops) | MissionWorkspace |
| Intelligence | mock-complete | — | — | mock only | ❌ | hidden in SP DSM (TD-23) |
| Amendments | mock-complete | — | — | mock only (SP stub) | ❌ | hidden in SP DSM |

Names always resolve live from C3People by PersonID (`Unknown person (PER-XXXX)` fallback).
`IsActive` semantics everywhere: null→true; reads exclude explicit false; rows retained.
Truthful empty states are a locked pattern (zero participants/kit/profile never implies
readiness or error).

## 5. Governed operation inventory

| Operation | Class | Request | Approve | Execute/write | Audit | Recovery |
|---|---|---|---|---|---|---|
| AddPerson | ADR-013 | owner/ops | owner | POST TMP→MERGE PER-XXXX; TargetPersonID `PENDING-ADDPERSON`→backfilled | C3Approvals | stamp-recovery hook |
| AddCredential | ADR-013 | owner/ops | owner | POST-then-MERGE CRED | C3Approvals | recovery hook |
| DeactivateCredential | ADR-013 | owner/ops | owner | resolve by Title→MERGE IsActive=false | C3Approvals | recovery hook + already-inactive guard |
| InitiateJourney | ADR-013 | owner/ops | owner | POST-then-MERGE JRN; duplicate-journey guard | C3Approvals | PartialExecutionError + recovery |
| **AddMissionParticipant** | **ADR-013 (S29B)** | owner/ops | owner | idempotent contract: POST / reactivate inactive row (ETag) / already-applied / conflict | C3Approvals | **re-execute (idempotent)** |
| **RemoveMissionParticipant** | **ADR-013 (S29B)** | owner/ops | owner | IsActive=false (ETag); active-kit re-check; mandatory reason | C3Approvals | re-execute (already-inactive) |
| Journey lifecycle (Complete/Suspend/Resume/Cancel) | S19 exemption | — | — | role-gated (owner/ops); Notes audit line; MERGE by Title-resolved Id | Notes + versions | InvalidTransitionError guards |
| AddKitAssignment | S29A exemption | — | — | role-gated (owner/ops); participant guard; duplicate guard + unique Title; always NotOrdered | StatusNotes + versions (Editor) | duplicate-safe retry |
| UpdateKitStatus | S29A exemption | — | — | role-gated; transition matrix (`utils/kitLifecycle.ts`); reasons into Returned/Missing/Replaced; ETag | StatusNotes line per transition | 412→ConcurrencyError refresh/retry |
| DeactivateKitAssignment | S29A exemption | — | — | role-gated; mandatory reason; IsActive=false | StatusNotes | — |
| Apparel upsert | role-gated master data | — | — | owner/ops/hr; create-if-absent; ETag update | SP versions only (user Notes clean) | idempotent |
| Mission confirmation | **DEFERRED (TD-26)** | — | — | SP write is a throwing stub; UI hidden in SP DSM; Mock flow intact | — | future explicit governed design |

Invalidation per operation is implemented in `hooks/useExecuteApproval.ts` (onSuccess/
onError) and the mutation hooks — always both per-entity and batch keys.

## 6. Approval architecture

- **List:** C3Approvals. Fields: Title (display/correlation), OperationType (choice —
  exactly: InitiateJourney, CompleteJourney, SuspendJourney, CancelJourney, AddCredential,
  DeactivateCredential, AddPerson, AddMissionParticipant, RemoveMissionParticipant),
  TargetID, TargetPersonID, SubmittedBy/At, ApprovalStatus (Submitted/InReview/Approved/
  Rejected/Executed/ExecutionFailed), ReviewedBy/At, ExecutedAt, ExecutionError,
  DelegatedBy/To, Reason, RejectionReason, Payload (JSON).
- **Payload union:** `services/interfaces/approvalPayloads.ts` (6 payload types).
- **Submit hooks** (mode-branching mock-direct vs SP-approval):
  `useSubmitJourneyApproval`, `useSubmitCredentialApproval`, `useSubmitDeactivationApproval`,
  `useSubmitAddPersonApproval`, `useSubmitParticipantApproval` (add+remove, with
  duplicate-pending validation across Submitted/InReview/Approved).
- **Execution:** `hooks/useExecuteApproval.ts` — Approved guard → payload validation →
  authoritative checks → write → `stampExecution` (Executed / ExecutionFailed) → targeted
  invalidation. Partial errors are named per operation; participant recovery = re-execute.
- **Immutable submission (S29B):** `createApproval` = ONE requester POST (Title =
  `APR-PENDING-<ts>-<rnd>` correlation, never parsed); public APR derives from item Id via
  `deriveApprovalTitle` in `utils/spApprovalMapper.ts`; legacy `APR-XXXX` Titles pass
  through (schemes agree — both derive from the same Id). **Submitters have Add-only
  operational access; submitted rows are immutable to their creator** (hosted-verified 403s).
- **Self-approval** blocked in `usePatchApprovalStatus`. **Top-500:** `listApprovals` caps
  at 500 (TD-19 — approvals grow monotonically; first list that will hit the cap).
- ApprovalInbox: six tabs, per-operation PayloadSummary (participant summaries resolve
  names via `usePeople`), execution/recovery toasts.

## 7. SharePoint schemas and ACLs

Schema docs (all under `docs/architecture/`): `C3People/C3Credentials/C3Journeys/
C3Approvals/C3Contracts/C3Missions/C3MissionParticipants/C3PersonApparelProfiles/
C3MissionKitAssignments SP List Schema.md`. Universal rules: Title repurposed as canonical
ID **or** deterministic display key (never parsed for identity in the S27+ lists); plain-text
canonical FKs (`PER-XXXX`, TR/SATR codes); **no SP lookup columns; no SP numeric
cross-domain identity**; explicit internal names avoiding SP reserved words
(`MissionStatus`, `KitStatus`, `ParticipantRole`, `ItemCategory`, `JerseySize` — never
`Status/Role/Category/Size`); **verify internal names via REST after any provisioning**
(the S26 grid-import `field_N` incident is the cautionary tale — see the post-mortem);
never provision via grid/Excel import; unique-Title race guards on the three S27/S28 lists;
IsActive persistence semantics as §4.

**ACL reality (application role guards are UX; list ACLs are the security boundary):**

| List | Hardened? | Edit | Verified |
|---|---|---|---|
| C3MissionKitAssignments | ✅ unique | Owners, Operations | S29A hosted per-role |
| C3PersonApparelProfiles | ✅ unique | Owners, Operations, HR | S29A |
| C3MissionParticipants | ✅ unique | **Platform Owners only** | S29B hosted |
| C3Approvals | ✅ unique | Owners lifecycle; Operations = `C3 Approval Submitter` (Add-only custom level id 1073741926; WriteSecurity=2 defense-in-depth) | S29B hosted 403s |
| **C3People, C3Credentials, C3Journeys, C3Missions, C3Contracts** | ❌ **inherit site** | **site Members = Edit; C3 Legal = Full Control** | **platform-wide ACL review OUTSTANDING** — direct-edit ADR-013 bypass exists on these lists |

Evidence documents: `C3 Logistics List Permissions — Sprint 29A.md`,
`C3 Governance List Permissions — Sprint 29B.md` (method: export before-state by principal
ID → verify IsSiteAdmin → breakroleinheritance(no copy) → explicit grants → direct-endpoint
verification; note `HasUniqueRoleAssignments` via `$select` can return stale false — use the
direct endpoint).

## 8. Sprint chronology (authoritative baseline → now)

| Sprint | Outcome | Key commits |
|---|---|---|
| ≤S24 | Foundation → contracts read (native fetch, TD-04 resolved), ErrorBoundary reset, Intelligence contained | `e5a6304` `2fee558` `28b9d77` `cc88e92` `1f35cc0` |
| S25 | Governed AddPerson (+PENDING-ADDPERSON backfill, PersonnelCode) | `d8763ea` `1159290` `e94fec8` |
| S26 | Mission read foundation; C3Missions provisioned (first pass defective — remediated in place, post-mortem written); Missions activated in SP DSM; `.gitattributes` CRLF fix | `8537ad7` `5cbef34` `e4c9d98` `a7675e7` |
| S27 | Mission Participants read foundation; TD-26 containment (SP confirm hidden); truthful zero-participant copy; compiled-from-source parity pattern introduced | `f564588` `3275829` `d5c1025` |
| S28 | Apparel + kit read foundation; PersonProfile missions/apparel sections; both lists provisioned clean; capability-doc drift corrected | `d04cd24` `0461d45` `7b81c90` |
| S29A | Kit & apparel lifecycle WRITES (ADR-013 addendum; ETag concurrency standard; StatusNotes audit); logistics ACL hardening after the inherited-ACL finding | `8f80ec2` `a06e041` `53aae34` `ad59226` `6676f3b` |
| S29B | Governed participant membership (add/remove/reactivation, kit-block, pending UX, idempotent recovery); participants+approvals ACL hardening; **immutable Add-only approval submission** | `0f8d9ce` `a742eab` `0adbb63` `7b32fe6` `1cba607` `98bec97` |

Superseded runtime hashes (`3431e6b6` S26, `69479e04` S26-5, `703423d9` S28, `0295b3f8`
S29A, `2665fb07` pre-hardening S29B) are historical — **current is `b29de64d…`**.

## 9. Technical debt and known risks (classified)

**Blockers:** none.

**Next-sprint considerations:**
- **Platform-wide ACL review** — the five unhardened lists (§7) allow governance bypass by
  site Members/Legal; strongest candidate for an early S30-adjacent security pass (owner
  decision; method proven twice).
- Strict-build gate tooling — fold `tsc -b` into one gate command so it cannot be skipped.

**Deferred (tracked):** TD-26 (mission confirmation SP write — UI hidden, stub throws);
UpdateMissionParticipant (role/per-diem edits; workaround = governed remove+re-add);
generic reactivation UI; kit metadata edits (deactivate+re-add covers); legacy
`C3_Contracts` migration (TD-22) + C3Contracts provisioning/activation; TD-24 (no Email on
C3People); C3Missions `zzOLD *` residue columns (user cleanup); s15–s17 parity harnesses
still inline-translated (migrate opportunistically to the compiled-from-source pattern of
s27/s28/s29/s29b); approvals-submitter forms may need field-level review if SP list forms
are ever used directly.

**Operational monitoring:** TD-19 (approvals `$top=500` — monotonic growth; act before
~400 rows); TD-23 (Intelligence cold-load — contained by guard, root cause unresolved);
top-N inconsistencies (people/credentials 2000 vs others 500); manual runtime/deploy
workflow (TD-14/15); Windows NUL/truncation risk (audit every commit).

## 10. Sprint 30 launch point — Mission Readiness Cockpit (do NOT implement)

**Direction (approved):** transform mission data into a per-mission readiness cockpit —
facet statuses (readiness %, participants, kit fulfillment, milestones, finance) per the
"planning status layer" sketched in `Mission v2 — Operational Planning.md` (the key
historical design document, incl. the `MissionPlanningGap` work-item trigger concept).

**What is live:** people, credentials, journeys, approvals, missions, participants
(governed), apparel, kit (with lifecycle + `FULFILLED_KIT_STATUSES = Delivered|Confirmed`
as the current fulfilled interpretation), mission-scoped gaps, work items.
**Mock-only:** milestones (`useMissionMilestones`, `MockMilestoneService`), finance lines
(`useMissionFinanceLines/Summary`), Intelligence, Amendments, Contracts-in-SP.

**Data joins available today:** `useMissionGaps(missionId)` (participants × credentials ×
protocol via `utils/gapComputation.computeGapsForPeople`); `useAllMissionParticipants`
(`participantPersonIdsByMission`); `useAllKitAssignments` (group by mission/person);
`useWorkItems` → `utils/workItemGenerators/` (gap + mission-departure triggers).

**Likely extension points:** a pure `utils/missionReadiness.ts` computing facet statuses
from existing hooks (no schema needed for v1); MissionWorkspace card facet strip;
CommandCenter mission strip; possibly a third WorkItem trigger type. **Risks:** SituationRoom
is regression-sensitive (prefer computing beside it, not inside it); milestone/finance
facets are mock-only (decide: exclude, mock-badge, or provision lists); readiness copy must
follow the truthful-empty-state rule; TD-19 if the cockpit polls approvals.

**Candidate Phase 0 questions:** which facets ship in v1 (readiness/participants/kit only?);
facet thresholds (what makes kit "amber"?); cockpit location (MissionWorkspace cards vs new
screen vs CommandCenter); does the cockpit need milestones→provisioning; per-participant
readiness chips (deferred from S27) in or out.

**Read first:** `screens/SituationRoom.tsx`, `screens/MissionWorkspace.tsx`,
`hooks/useMissionGaps.ts`, `hooks/useOperationalGaps.ts`, `hooks/useWorkItems.ts`,
`utils/gapComputation.ts`, `utils/workItemGenerators/index.ts`, `utils/kitLifecycle.ts`,
`types/logistics.ts`, `types/mission.ts`, `Mission v2 — Operational Planning.md`,
`C3 Architecture Baseline — Sprint 29B.md`.

## 11. Non-negotiable guardrails

1. Source is ground truth where documentation conflicts.
2. Locked ADRs stay locked (ADR-002 activation gate, ADR-012 SDK freeze, ADR-013 +
   its two narrow addenda, native fetch, mission model frozen, TR/SATR identity).
3. No silent schema fields, dependencies, or major abstractions — propose explicitly.
4. No PnP.js. 5. No direct UI→SharePoint operational writes outside approved
   governance/exemptions. 6. No SP lookup relationships. 7. No SP numeric cross-domain
   identity (SP Id/ETag = internal persistence metadata only). 8. Actual-ETag concurrency
   for all new updates — `IF-MATCH: *` prohibited in new code (legacy S18/S23 writes still
   use it; migration candidate, not license). 9. Title is never parsed as business
   identity. 10. Mock DSM remains the regression baseline (shared pure guards; mirrored
   seeds). 11. Hosted SP validation before any sprint closure. 12. No destructive
   provisioning assumptions — existing-list detection, internal-name verification,
   duplicate audits before uniqueness, ACL before-state export, never delete rows/lists/
   groups without explicit approval. 13. Contracts/Amendments/Intelligence guards and the
   TD-26 confirmation guard remain unless explicitly approved. 14. Truthful empty states —
   zero data never implies readiness. 15. No silent mutation failures — every write
   surfaces success and every failure class via toast.

## 12. First-day checklist for a new advanced-AI session

1. `git -C C:\Projects\c3-fable status` + `git log --oneline -15` — confirm clean tree at/after `98bec97`; `docs/fable/` untracked is expected.
2. Read `C3 Architecture Baseline — Sprint 29B.md`, `Sprint 29B Closeout Report.md`,
   `C3 Beta Checkpoint — Sprint 29B.md`, `C3 Tech Debt Register.md`, and this package.
3. Read the §10 source files for the Sprint 30 domain.
4. Run the complete validation gate (§1) — expect exactly the recorded totals; investigate
   ANY deviation before proceeding.
5. Compare code to documentation; report discrepancies (code wins) before relying on either.
6. Report blockers, if any.
7. Produce a Sprint 30 Phase 0 proposal (inspection findings, facet model options, scope,
   risks, file list, commit plan) per the launch point in §10.
8. **Stop before implementation unless explicitly authorized.**
