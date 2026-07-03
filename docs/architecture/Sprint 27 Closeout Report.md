# Sprint 27 Closeout Report — Mission Participants Foundation
**C3 Platform**
**Sprint:** 27 — Mission Participants Foundation
**Closeout date:** 2026-07-03
**Status:** CLOSED — hosted SP validation fully green
**Preceding sprint:** Sprint 26 CLOSED (Mission/Event Read Foundation; SP DSM missions activated)
**Validation baseline:** All parity harnesses pass (incl. new s27), tsc clean, verify:runtime PASS, hosted green

---

## Closeout statement

Sprint 27 closes as:

> **"C3 now reads and displays which people are assigned to each mission, in Mock DSM and
> SharePoint DSM. `C3MissionParticipants` is provisioned and live with schema-exact internal
> names. `SharePointMissionService.listMissionParticipants/listAllMissionParticipants` are
> native-fetch, 404-safe reads mapped through `spMissionParticipantMapper`. Mission Workspace
> shows participant counts and read-only assignment detail with names resolved live from
> C3People. Situation Room participant counts, mission gap computation, and Command Center
> work items consume live participant assignments. The SP DSM 'Approve & Confirm Mission'
> false affordance is contained (TD-26). Zero-participant empty states are truthful."**

Sprint 27 does **not** close as:

> ~~"Participants can be added, removed, or edited from the UI (no participant writes exist)."~~
> ~~"Mission confirmation or status writes exist in SP DSM (TD-26 — deferred)."~~
> ~~"PersonProfile shows a person's missions (deferred to Sprint 28)."~~
> ~~"Jersey/logistics, budgeting, finance, or milestones gained SP implementations."~~
> ~~"Contracts, Amendments, or Intelligence were re-enabled in SP DSM (unchanged)."~~

---

## Sprint objective

Implement the Mission Participants Foundation: participant schema, SP read path,
person/mission relationship, and Mission Workspace / Situation Room participant visibility —
read-only, with safe empty states — plus immediate containment of the SP mission-confirmation
safety risk found during Sprint 26 hosted validation.

---

## Phase 0 — Inspection and safety finding

Phase 0 confirmed the authoritative `MissionParticipant` type (MissionID, PersonID,
ExternalCode, Role, PerDiemRate?), the mock seed data (one row per person per mission,
single role), and all participant consumers (SituationRoom count, useMissionGaps,
useWorkItems/workItemGenerators).

**Safety finding:** the Situation Room "Approve & Confirm Mission" action (S13-4) was gated
only on `Status === 'FinancePending'` — no data-source or capability check. Sprint 26's live
SP mission reads exposed it in SP DSM against a throwing stub: clicking showed "Confirming…"
then silently reverted (no error surfaced; no data ever written). Recorded as TD-26.

---

## Completed phases

### Phase 1 — Safety containment (commit `f564588`)

- "Approve & Confirm Mission" **hidden in SP DSM** (`config.dataSourceMode !== 'sharepoint'`
  guard at the `onApprove` site; action omitted, not disabled). Mock DSM flow unchanged.
- No mission write path implemented; no approval operation added. Future SP confirmation must
  be an explicitly designed governed write (TD-26).
- Zero-gap empty-state copy corrected: zero participants → *"No participants are assigned to
  this mission yet."*; participants present → *"No obligation gaps detected for this mission.
  All assigned participants currently meet the evaluated requirements."* The readiness claim
  can no longer render with zero participants.

### Phase 2 — Schema and provisioning artifacts

- `C3MissionParticipants SP List Schema.md` — NEW.
- `scripts/Create-C3MissionParticipants.ps1` — NEW; hardened per the S26 post-mortem
  (existing-list stop, internal-name verification, `field_N` residue refusal, choice/default
  validation, internal-name report).

### Phase 3 — Mapper and SP read path (commit `3275829`)

- `spMissionParticipantMapper.ts` — hard-rejects missing MissionID/PersonID and unknown
  ParticipantRole; blank ExternalCode → warn + `''`; PerDiemRate safe-parsed (string numerics
  tolerated) → warn + `undefined` on invalid; `IsActive` null defaults true; `Title` never
  parsed for identity; no FK validation (established mapper contract).
- `SharePointMissionService.ts` — `listMissionParticipants(missionId)` (OData
  `$filter=MissionID eq '…'`, TR/SATR codes OData-escaped and URL-encoded) and
  `listAllMissionParticipants()`; native fetch, `$top=500` (documented scale note), 404-safe
  `[]`; **explicit `IsActive === false` rows excluded from both reads but retained in SP for
  history**; S26 mission reads preserved exactly; mission writes remain throwing stubs.
  `encodeODataLiteral` exported for the parity harness.

### Phase 4 — Mission Workspace participant UI

- Participant count per card; read-only expandable assignment detail: resolved person name,
  PersonID, role badge, ExternalCode, PerDiemRate with `Mission.OperatingCurrency`.
- **One** batch `useAllMissionParticipants()` query grouped locally by MissionID (no per-card
  N+1); **one** `usePeople()` query building `Map<PersonID, Person>`.
- Unknown PersonID renders `Unknown person (PER-XXXX)`.
- No participant write controls of any kind.

### Phase 5 — Situation Room live behaviour (no code beyond Phase 1)

Participant counts, mission-scoped gap computation, and Command Center work-item generation
consume live SP participant rows automatically through the shared service interface.

### Phase 6 — Participant parity gate

- `scripts/s27-parity-participants.mjs` — NEW pattern: **compiles the actual production
  mapper and the actual `encodeODataLiteral` via esbuild** (from the existing Vite toolchain;
  no new packages; temp bundles removed after run). 28 checks: all five roles, TR/SATR codes,
  hard rejects, ExternalCode/PerDiemRate degradation, IsActive semantics and active-filtering,
  Title-not-identity, OData escaping, batch with malformed row, and mock-seed mirror parity.
  Eliminates the inline-translation drift carried by s15–s18.

### Phase 7 — Provisioning and hosted validation

`C3MissionParticipants` provisioned live via REST (2026-07-03):

- Created clean (existing-list check first; no grid import) — internal names exact, **zero
  `field_N` residue**: `MissionID`, `PersonID`, `ExternalCode`, `ParticipantRole`,
  `PerDiemRate`, `IsActive`.
- `ParticipantRole` choices exactly `Player / Coach / Manager / Analyst / Staff`.
- `IsActive` default Yes proven (rows posted without the field read back `true`).
- Indexes on `MissionID` and `PersonID`.
- 3 sample rows mirroring the Mock DSM seeds; service-equivalent queries verified
  (all-rows = 3; TR/2026/006 filter = exactly PER-0001 + PER-0002).
- Live payload through the real compiled mapper: **3 mapped, 0 rejected, 0 warnings — exact
  match with mock seeds.**

**Hosted SP DSM validation (deployed runtime): fully green.** Mission Workspace loads with no
ErrorBoundary; TR/2026/006 shows 2 participants, SATR/2026/003 shows 1; names resolve from
C3People; PersonID/role/ExternalCode/PerDiemRate render correctly with the mission operating
currency; no write controls; Situation Room counts correct with truthful zero-participant
copy; "Approve & Confirm Mission" hidden; Command Center stable; People/AddPerson, Approvals,
Credentials, Journeys green; Contracts/Amendments/Intelligence remain hidden; no mapper
warnings.

---

## Relationship model (as documented and shipped)

```
C3MissionParticipants.MissionID → C3Missions.Title    (business TR/SATR code)
C3MissionParticipants.PersonID  → C3People.PersonID   (canonical PER-XXXX)
```

- Plain-text canonical foreign keys — no SharePoint lookup columns.
- SP numeric item IDs are never cross-domain identity.
- **One row per person per mission** (single role); conceptual key `MissionID + PersonID`.
- `Title = <MissionID>|<PersonID>` is a display convenience only — never parsed for identity.
- PerDiemRate is denominated in `Mission.OperatingCurrency` (no participant CurrencyCode).
- Person names resolve live from C3People; no duplicated names stored.

---

## Commit summary

| Commit | Purpose |
|---|---|
| `f564588` | `fix(s27): Guard mission confirmation in SharePoint DSM` (TD-26 containment + truthful copy) |
| `3275829` | `feat(s27): Add mission participants read foundation` (Phases 2–6) |
| `b2706c6` | `docs(s27): Prepare hosted validation checkpoint` |
| *(this commit)* | `docs(s27): Close mission participants foundation sprint` |

## Files changed (source sprint)

`SituationRoom.tsx` (containment + copy only) · `C3MissionParticipants SP List Schema.md` ·
`scripts/Create-C3MissionParticipants.ps1` · `spMissionParticipantMapper.ts` ·
`SharePointMissionService.ts` · `MissionWorkspace.tsx` · `s27-parity-participants.mjs` ·
Tech Debt Register (TD-26) · Product Expansion Backlog (Track 7) · rebuilt runtime bundle.

**Explicitly NOT changed:** `PersonProfile.tsx` (0-line diff, verified), `types/mission.ts`,
mock services, Contracts/Amendments/Intelligence guards, any write path.

---

## Validation record

```text
s15: 87/87
s16: 220/220
s17: 51/51
s18: 37/37
s27: 28/28
tsc c3: clean
tsc c3-spfx-host: clean
beta:runtime: pass
verify:runtime: pass
runtime SHA-256:
faf8c961e70bd5300adbf3b4ebc580b873e3ecee931c00561c31c5b9ab596558
hosted SP validation: fully green
```

---

## Deferred / remaining

1. **TD-26 (open):** SP mission confirmation write path — action hidden in SP DSM; future
   sprint must design the governed write explicitly.
2. **PersonProfile "Missions" section** → Sprint 28 (alongside jersey/logistics, which touches
   the same section).
3. **Participant writes** (add/remove/update; governed vs role-gated TBD) → future
   governed-write sprint. Until then, assignment changes are made directly in SP by operators,
   and the MissionID+PersonID uniqueness rule is operator discipline, not enforced.
4. Participant readiness indicators in mission views → future UI work (gap computation
   already consumes real participants).
5. `$top=500` scale note on participant reads (schema doc §10).
