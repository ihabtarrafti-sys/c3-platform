# Sprint 28 Closeout Report — Logistics Read Foundation
**C3 Platform**
**Sprint:** 28 — PersonProfile Mission Visibility + Apparel Profile Read Foundation + Mission Kit Assignment Read Foundation
**Closeout date:** 2026-07-03
**Status:** CLOSED — hosted SP validation fully green
**Preceding sprint:** Sprint 27 CLOSED (Mission Participants Foundation)
**Validation baseline:** All six parity harnesses pass, tsc clean, verify:runtime PASS, hosted green

---

## Closeout statement

Sprint 28 closes as:

> **"C3 now reads and displays stable apparel attributes per person and issued mission kit per
> participant, in Mock DSM and SharePoint DSM. `C3PersonApparelProfiles` and
> `C3MissionKitAssignments` are provisioned and live with schema-exact internal names.
> PersonProfile gained two read-only sections — Apparel Profile and Missions (n), with mission
> rows deep-linking to the Situation Room pre-scoped to the mission. Mission Workspace shows
> per-participant kit summaries and per-item status, with participant names deep-linking to
> PersonProfile. All empty states are truthful and neutral. No writes of any kind were
> introduced."**

Sprint 28 does **not** close as:

> ~~"Apparel, kit, participant, or mission writes exist (all deferred — S29 governance design)."~~
> ~~"Kit tracking is an inventory ledger, travel-request list, or freight system (explicit domain boundary)."~~
> ~~"Situation Room or Command Center were modified (verified 0-line diffs)."~~
> ~~"Situation Room evaluates logistics readiness or Command Center raises kit work items (S29+)."~~
> ~~"Contracts, Amendments, or Intelligence were re-enabled in SP DSM (guards unchanged)."~~

---

## Sprint objective

Deliver the logistics read foundation: stable apparel attributes as person data (deliberately
NOT `C3People` columns), issued mission kit per participant as a join list, PersonProfile
mission/apparel visibility, and Mission Workspace kit visibility — read-only throughout, with
the S27 truthful-empty-state discipline.

---

## Data architecture (as shipped)

### Relationships — plain-text canonical FKs, no SP lookups, no SP numeric cross-domain identity

```
C3PersonApparelProfiles.PersonID → C3People.PersonID    (PER-XXXX)
C3MissionKitAssignments.MissionID → C3Missions.Title    (TR/SATR code)
C3MissionKitAssignments.PersonID  → C3People.PersonID   (PER-XXXX)
```

### Identity and uniqueness

- **Apparel:** one active profile per `PersonID`.
- **Kit:** `MissionID + PersonID + ItemCategory + AssignmentKey`. `AssignmentKey` is the
  stable operator-defined key (e.g. `HOME-2026`, `CONTROLLER-01`) — required, trimmed on
  read, casing preserved. **`ItemDescription` is editable display text, never identity**
  (parity case K9 proves a re-worded description keeps the same logical assignment).
- `Title` on both lists is display-only and **never parsed for identity**. No generated
  `MKA-XXXX`; SP integer `Id` remains transport metadata.

### Choice values (exact TS-union matches; explicit internal names)

- `JerseySize` (not `Size`): `XS / S / M / L / XL / XXL / 3XL`
- `ItemCategory` (not `Category`): `Jersey / Apparel / Equipment`
- `KitStatus` (not `Status`): `NotOrdered / Ordered / Shipped / Delivered / Confirmed /
  Returned / Replaced / Missing` — default `NotOrdered`. `Returned/Replaced/Missing` are
  provisioned now so the S29 lifecycle design needs no schema change.
- **Fulfilled for current read-only display: `Delivered`, `Confirmed`.** Ordered/NotOrdered
  remain incomplete. A complete visual state requires ≥ 1 assignment — zero rows never
  renders as complete.

### Read behaviour

- Native fetch, `odata=nometadata`, `$top=500` (documented scale note), **404-safe** — a
  missing list degrades to empty/null states, never a crash.
- Explicit `IsActive === false` rows are **excluded from active reads but retained in SP for
  history**; null/missing IsActive maps as true.
- Mappers: apparel rejects only on missing PersonID (unknown JerseySize warns and degrades —
  display-only attribute); kit hard-rejects missing MissionID/PersonID/AssignmentKey and
  unknown ItemCategory/KitStatus; JerseyNumber preserved as trimmed text; blank OwnerEmail
  silent, malformed warns but is preserved.

---

## Completed workstreams

1. **Domain/schemas** — `types/logistics.ts` (`ApparelProfile`, `KitAssignment`,
   `FULFILLED_KIT_STATUSES`); schema docs for both lists with domain-boundary and
   deliberately-omitted-fields sections.
2. **Services/mappers** — `IApparelProfileService` (+ Mock/SP; first-active-wins with
   duplicate warning); `IMissionService` extended with `listKitAssignments` /
   `listAllKitAssignments` (Mock + SP); `spApparelProfileMapper`; `spKitAssignmentMapper`.
3. **Hooks/keys** — `useApparelProfileService`, `useApparelProfile`, `useAllKitAssignments`
   (batch — no N+1), `usePersonMissions` (composition of existing cached queries);
   `apparel.byPerson/all`, `mission.kitAssignments/allKitAssignments`. `useKitAssignments(missionId)`
   deliberately not created (no consumer).
4. **Mock data** — mirrors SP sample rows exactly; PER-0004 has no apparel profile by design.
5. **PersonProfile** — Apparel Profile section (after Classification) and Missions (n)
   section (after Related Contracts); rows navigate `{id:'situation-room', missionId}`;
   empty states: *"No apparel profile on file."* / *"Not assigned to any missions."*;
   readiness/approvals tabs untouched; hooks added at the established top block.
6. **MissionWorkspace** — per-participant kit summary ("Kit: N items · M fulfilled") and
   per-item lines (category badge, description, #number, status badge, owner email);
   *"No kit assignments recorded."* for zero rows; participant names deep-link to
   PersonProfile.
7. **Provisioning** — hardened scripts for both lists archived under
   `docs/architecture/scripts/`; live provisioning executed via REST with internal-name
   verification (zero `field_N` residue on both lists, first pass).
8. **Parity** — `s28-parity-logistics.mjs` compiles both real mappers + the real OData helper
   via esbuild; 35 checks incl. mock-seed mirror parity and identity rules.

---

## Commit summary

| Commit | Purpose |
|---|---|
| `d04cd24` | `feat(s28): Add apparel profile and kit assignment read foundation` |
| `0461d45` | `feat(s28): Add person mission visibility and kit status UI` |
| `fe2966f` | `build(s28): Update SPFx runtime bundle` |
| `6db69f2` | `docs(s28): Prepare logistics hosted validation checkpoint` |
| *(this commit)* | `docs(s28): Close logistics read foundation sprint` |

**Explicitly NOT changed (verified 0-line diffs):** `SituationRoom.tsx`, `CommandCenter.tsx`,
`types/mission.ts`, `types/people.ts`, all guards, all write paths, C3People schema.

---

## Provisioning and hosted validation record

Both lists provisioned clean via REST (2026-07-03): schema-exact internal names
(`JerseySize`/`ItemCategory`/`KitStatus`/`AssignmentKey`), exact choice sets, defaults
verified (IsActive Yes; KitStatus NotOrdered), indexes (PersonID; MissionID+PersonID), zero
grid-import residue. Sample rows mirror mock seeds; service-equivalent queries verified;
live payloads through the real compiled mappers: **kit 4/4, apparel 2/2 — zero rejects, zero
warnings, exact mock parity.**

**Hosted SP DSM validation (deployed S28 runtime): fully green.** PersonProfile apparel and
mission sections render with live data and correct deep-links; missing apparel profile shows
the truthful neutral copy; existing PersonProfile credentials/contracts/readiness/approvals
remain stable (first PersonProfile touch since S25 — full regression passed); Mission
Workspace kit counts, categories, statuses, fulfilled counts, and deep-links all correct;
Situation Room and Command Center stable; core domains green; no mapper warnings; no
ErrorBoundary; Contracts/Amendments/Intelligence remain hidden.

---

## Validation record

```text
s15: 87/87
s16: 220/220
s17: 51/51
s18: 37/37
s27: 28/28
s28: 35/35
tsc c3: clean
tsc c3-spfx-host: clean
beta:runtime: pass
verify:runtime: pass
runtime SHA-256:
703423d983ea3a9a49d81feaf840f79c902fbea4656e4bada1dd022a7daa72b3
hosted SP validation: fully green
```

---

## Deferred / remaining

1. **Sprint 29 — Governed Mission Operations Writes:** AddMissionParticipant,
   RemoveMissionParticipant, AddKitAssignment, kit lifecycle transitions, apparel profile
   edits. **Governance is NOT pre-locked** — S29 Phase 0 classifies each operation as
   ADR-013 governed / documented lifecycle exemption / role-gated profile update /
   owner-only transition. The S29 write design must also cover dual participant-cache
   invalidation (`mission.participants` + `mission.allParticipants` + kit keys) and the
   error-surfacing sweep (useApproveMission onError pattern).
2. **Sprint 30:** Mission readiness cockpit and/or Mission Budgeting, subject to S29 results.
3. TD-26 (SP mission confirmation write) remains open/deferred; top-500 limits, manual
   CI/CD/runtime workflow, and TD-23 Intelligence cold-load remain open.
4. Travel and freight domains remain future work, outside the kit-assignment boundary.
