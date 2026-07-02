# Sprint 26 Closeout Report — Mission/Event Read Foundation
**C3 Platform**
**Sprint:** 26 — Mission/Event Read Foundation
**Closeout date:** 2026-07-02
**Status:** CLOSED
**Preceding sprint:** Sprint 25 CLOSED (Governed AddPerson Foundation)
**Validation baseline:** All parity harnesses pass, tsc clean, verify:runtime PASS

---

## Closeout statement

Sprint 26 closes as:

> **"C3 now exposes the mission domain that has been mature in mock mode since Sprints 10–14. A read-only Mission Workspace lists mission/event commitments as cards with a KPI strip. `SharePointMissionService.listMissions` and `getMission` are live native-fetch reads against the `C3Missions` list — 404-safe, mapped through the new `spMissionMapper` with hard rejects protecting the ADR-002 activation gate. The `C3Missions SP List Schema` provisioning doc is ready for IT, with `Title = MissionID` (business TR/SATR code) and a `MissionStatus` choice column avoiding the SP reserved-word rename. The Missions NavRail item is visible in Mock DSM and hidden in SP DSM until provisioning (TD-25). Mission writes, participants, finance, milestones, and logistics remain out of scope."**

Sprint 26 does **not** close as:

> ~~"Missions can be created, confirmed, or transitioned from the UI (writes remain stubs)."~~
> ~~"Mission participants have an SP read path (Sprint 27 scope)."~~
> ~~"The C3Missions SP list exists (IT provisioning pending — TD-25)."~~
> ~~"SituationRoom was modified (untouched, per locked scope boundary)."~~
> ~~"Contracts or Intelligence are re-enabled in SP DSM (no change from S24/S25 state)."~~

---

## Sprint objective

Expose the existing mission domain through a read-only workspace and implement the SharePoint
read path, without redesigning the mission model, adding writes, or touching SituationRoom.
Phase 0 (inspection) was completed before this session and confirmed the mission foundation
already exists in depth — Sprint 26 is exposure and SP read integration only.

---

## Pre-sprint work — environment integrity fix (commit `8537ad7`)

Before Phase 1, a Windows checkout defect was found and fixed: with global `core.autocrlf=true`
and no `.gitattributes`, git rewrote the committed `c3-runtime.js` to CRLF on checkout
(1,815,656 → 1,867,124 bytes), failing the `verify:runtime` SHA-256 gate and risking deployment
of a byte-different bundle. `.gitattributes` now marks `c3-runtime.js -text`. The git blob at
`e94fec8` was verified byte-identical to the documented Sprint 25 hash (`5168e36c…`) — the
repository was never corrupted; only Windows working trees were affected.

---

## Completed phases

### Phase 1 — C3Missions schema doc

- `docs/architecture/C3Missions SP List Schema.md` — NEW. List identity, full column mapping to
  the frozen `Mission` type, choice values matching the TypeScript unions exactly, business
  TR/SATR identity model (no POST-then-MERGE), provisioning checklist with a mandatory
  internal-name verification step (`MissionStatus`, not `Status`/`Status0`), sample rows
  mirroring the Mock DSM regression data, indexes (`MissionStatus`, `Entity`), out-of-scope
  register.

### Phase 2 — SharePoint read path

- `packages/c3/src/utils/spMissionMapper.ts` — NEW. Pure mapper following the
  spCredentialMapper/spPersonMapper/spJourneyMapper pattern. Hard rejects: missing MissionID
  (Title), missing Name, unknown Entity, unknown MissionStatus (ADR-002 gate integrity),
  missing StartDate/EndDate. Graceful degradation elsewhere. Span dates normalised date-only;
  `Mission.CreatedAt` maps from SP-managed `Created`. Batch diagnostics with `[C3/Mission]` prefix.
- `packages/c3/src/services/sharepoint/SharePointMissionService.ts` — REWRITTEN.
  `listMissions(filter?)` and `getMission(missionId)` live: native fetch,
  `credentials: 'same-origin'`, `odata=nometadata`, `$top=500`, `$orderby=StartDate asc`,
  404-safe (`[]` / `null`). MissionFilter applied client-side, mirroring MockMissionService
  semantics exactly. OData filter values URL-encoded (TR codes contain `/`). Stale
  "implement using PnP.js" comment removed. Participants reads and both writes remain
  explicit stubs.
- `packages/c3/src/hooks/useMissionService.ts` — now passes `config.spSiteUrl` to the SP factory.

### Phase 3 — Mission Workspace

- `packages/c3/src/screens/MissionWorkspace.tsx` — NEW. Read-only register: PageHeader, KPI
  strip (total / generating-obligations / finance-pending), mission cards (MissionID, Name,
  Game, Organizer, Entity, status badge, Jurisdiction, operational window, currency, notes).
  Loading skeleton, error state, empty state. No create/edit/confirm actions. Screen-local
  `MissionStatusBadge` maps the ADR-002 lifecycle to Fluent badge colours.

### Phase 4 — Routing and navigation

- `packages/c3/src/types/screens.ts` — `{ id: 'missions' }` added to the `C3Screen` union.
- `packages/c3/src/components/layout/AppShell.tsx` — `case 'missions'` route added.
- `packages/c3/src/components/layout/NavRail.tsx` — Missions item (TrophyRegular) with SP DSM
  guard `visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint'`, comment referencing TD-25;
  `toScreen` case added.

### Phase 5 — Validation and runtime

- Full gate run (see Validation summary). Runtime rebuilt and verified; committed blob
  confirmed byte-identical to the build output.

---

## Commit summary

| Commit | Purpose |
|---|---|
| `8537ad7` | `chore: Exempt runtime bundles from CRLF normalization` (pre-sprint environment fix) |
| `5cbef34` | `feat(s26): Add mission event read foundation` (Phases 1–5) |
| *(this commit)* | `docs(s26): Close mission event foundation sprint` |

---

## Files changed

| File | Change |
|---|---|
| `.gitattributes` | NEW — runtime bundles exempt from CRLF normalization |
| `docs/architecture/C3Missions SP List Schema.md` | NEW |
| `packages/c3/src/utils/spMissionMapper.ts` | NEW |
| `packages/c3/src/screens/MissionWorkspace.tsx` | NEW |
| `packages/c3/src/services/sharepoint/SharePointMissionService.ts` | Read path implemented |
| `packages/c3/src/hooks/useMissionService.ts` | spSiteUrl threading |
| `packages/c3/src/types/screens.ts` | `missions` union member |
| `packages/c3/src/components/layout/AppShell.tsx` | missions route |
| `packages/c3/src/components/layout/NavRail.tsx` | missions item + guard + toScreen |
| `docs/architecture/C3 Tech Debt Register.md` | TD-25 added; TD-24 truncation repaired |
| `docs/architecture/C3 Product Expansion Backlog.md` | Track 6 status updated |
| `packages/c3-spfx-host/.../c3-runtime.js` | Rebuilt bundle |

**Files explicitly NOT changed (locked scope boundaries):**
`SituationRoom.tsx`, `types/mission.ts`, `IMissionService.ts`, `MockMissionService.ts`,
mission finance/milestone hooks and services, approval operation types.

---

## Validation summary

| Gate | Result |
|---|---|
| `s15-parity-test.mjs` | ✅ 87 passed, 0 failed |
| `s16-parity-people.mjs` | ✅ 220 passed, 0 failed |
| `s17-parity-journeys.mjs` | ✅ 51 passed, 0 failed |
| `s18-parity-approvals.mjs` | ✅ 37 passed, 0 failed |
| `tsc packages/c3` | ✅ 0 errors |
| `tsc packages/c3-spfx-host` | ✅ 0 errors |
| `beta:runtime` | ✅ built (1,826.07 kB / gzip 405.19 kB) |
| `verify:runtime` | ✅ PASS |
| NUL byte audit (changed files) | ✅ CLEAN |
| Committed bundle blob vs build | ✅ byte-identical |

**Runtime bundle SHA-256:** `3431e6b6e19eaa48f0468dd6ddfc8de52174829669440e721c8ec29ad45e77b9`

---

## SharePoint lists involved

| List | S26 role |
|---|---|
| `C3Missions` | Schema defined; **not yet provisioned** — read path returns `[]` until IT provisions per the schema doc |
| `C3MissionParticipants` | Concept only — Sprint 27 |
| All other lists | Unchanged |

---

## Tech debt changes in Sprint 26

- **TD-25 added** — SP DSM missions nav hidden pending C3Missions provisioning (beta
  containment by design; re-enable criteria documented in the register).
- **TD-24 repaired** — the register entry had been truncated mid-sentence in commit `2020180`
  (S25 closeout) by the sandbox file-corruption issue; tail reconstructed and flagged with a
  repair note.

---

## Documentation corrections recorded at onboarding (lead-architect handover)

Cross-referencing the two handoff packages against code found contradictions; **code was
treated as ground truth** throughout Sprint 26:

1. Credential person FK column is `HolderPersonID` (the Senior Engineer package's C3Credentials
   table incorrectly says `PersonID`).
2. The Senior Engineer package's screen inventory matches code exactly; the Authoritative
   handoff's route list names standalone Journeys/Credentials screens that do not exist
   (they are PersonProfile sections).
3. Hosts directory contains `LocalHost.tsx` (not `MockHost.tsx` as the Senior package states).
4. ADR numbering collides across the two handoffs (each uses "ADR-001" for a different locked
   decision). A consolidated ADR index is recommended as future docs work.
5. The "Sprint 26 Phase 0 Inspection Report" cited in the Authoritative handoff's inventory was
   never committed to `docs/architecture/` — it existed only in the prior working session. Its
   conclusions (mission domain already mature; S26 is exposure, not redesign) are preserved in
   the handoff packages and validated by this sprint.

---

## Scope boundaries preserved

- No mission write path (create/confirm/updateStatus all still throw in SP DSM)
- No governed AddMission approval type
- No participant, finance, milestone, budget, jersey, or logistics SP implementation
- No Intelligence or Contracts SP DSM re-enable
- SituationRoom untouched
- Mission model unchanged — `MissionName` / `MissionType` / `RelatedTeam` / `PrimaryOwner`
  remain rejected

---

## Remaining known limitations

1. `C3Missions` is not provisioned — Missions remain invisible in SP DSM until TD-25 closes.
2. Mission writes are stubs; mission lifecycle management stays in Mock DSM (Situation Room
   confirm flow) until a governed write sprint.
3. `useMissions` exposes `isLoading` only (not `isPending`); MissionWorkspace follows the
   ContractsList pattern that passed hosted validation. If a cold-load flash is ever observed
   on the Missions screen in hosted SP DSM, apply the TD-23 `isPending` lesson.
4. Client-side MissionFilter is a deliberate choice at mission volume (tens/year); revisit if
   volume grows by an order of magnitude.
