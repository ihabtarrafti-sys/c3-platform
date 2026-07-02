# C3 Architecture Baseline — Sprint 26

**Status:** Authoritative until Sprint 27 closeout
**Date:** 2026-07-02
**Supersedes:** C3 Architecture Baseline — Sprint 25
**Head commit at baseline:** `5cbef34` — `feat(s26): Add mission event read foundation`

---

## Closeout statement

Sprint 26 delivered the Mission/Event Read Foundation: the `C3Missions` provisioning schema,
a live native-fetch SP read path (`listMissions` / `getMission`), the read-only Mission
Workspace screen, and the `missions` route/nav with the SP DSM containment guard (TD-25).
The mission domain model (Sprints 10–14) was exposed, not redesigned. No writes were added.

---

## Section 1 — Architectural shifts introduced in Sprint 26

### Before Sprint 26 (Sprint 25 baseline)

- Mission domain fully modelled in mock mode; `SharePointMissionService` a graceful all-stub
- No mission screen — mission context visible only inside SituationRoom and CommandCenter work items
- No `C3Missions` schema doc; TR-code storage decision documented but unimplemented
- Runtime bundle vulnerable to CRLF normalization on Windows checkouts (no `.gitattributes`)

### After Sprint 26

1. **Mission SP read path is live.** `SharePointMissionService.listMissions/getMission` use the
   S15–S24 native-fetch pattern: `credentials: 'same-origin'`, `odata=nometadata`, 404-safe
   empty returns, mapping delegated to `spMissionMapper`. Participants reads and all writes
   remain explicit stubs.
2. **`spMissionMapper` protects the ADR-002 gate.** Unknown `MissionStatus` or `Entity` values
   hard-reject the record — a mission with an unrecognised status can never silently enter or
   bypass obligation computation. Missing MissionID/Name/StartDate/EndDate also hard-reject.
3. **Mission identity honoured end-to-end.** `Title = MissionID` = business TR/SATR code.
   No POST-then-MERGE for missions; SP integer `Id` is never a mission identifier. OData
   lookups URL-encode the TR code (contains `/`).
4. **Mission Workspace screen (read-only).** Cards + KPI strip; no write affordances. Deep
   mission operations (gaps, confirmation, finance context) intentionally remain in
   SituationRoom.
5. **NavRail containment extended.** Missions joins Contracts/Amendments/Intelligence behind an
   SP DSM `visibleWhen` guard until `C3Missions` is provisioned and smoke-tested (TD-25).
6. **Runtime bundle integrity on Windows.** `.gitattributes` marks `c3-runtime.js -text`;
   checkouts are byte-identical to the committed blob on every platform, keeping
   `verify:runtime` meaningful outside the original Linux build environment.

---

## Section 2 — Data layer after Sprint 26

### SP lists read/written by C3 (SP DSM)

| List | Read | Write | Notes |
|---|---|---|---|
| `C3People` | ✅ | ✅ governed (AddPerson) | unchanged |
| `C3Credentials` | ✅ | ✅ governed (Add/Deactivate) | unchanged |
| `C3Journeys` | ✅ | ✅ governed + role-gated lifecycle | unchanged |
| `C3Approvals` | ✅ | ✅ | unchanged |
| `C3Contracts` | ✅ (guarded) | ❌ | unchanged |
| `C3Missions` | ✅ **NEW (S26)** — pending provisioning | ❌ | 404-safe until provisioned; nav guarded (TD-25) |
| `C3MissionParticipants` | ❌ | ❌ | Sprint 27 |

### Mission identity model (locked, now implemented)

`MissionID` is the business TR/SATR code stored in `Title` (e.g. `TR/2026/006`). Codes are
business-assigned and cross-reference Finance Sales Orders. The status column's internal name
is `MissionStatus` (SP reserved-word avoidance, same pattern as `ApprovalStatus`).

### Mapper inventory

| Mapper | Location | Since |
|---|---|---|
| `spCredentialMapper` | `utils/` | S15 |
| `spPersonMapper` | `utils/` | S16 |
| `spJourneyMapper` | `utils/` | S17 |
| `spApprovalMapper` | `utils/` | S18 |
| `contractMapper` | `mappers/` | S24 |
| `spMissionMapper` | `utils/` | **S26** |

---

## Section 3 — NavRail visibility matrix (SP DSM)

| Item | SP DSM | Mock DSM | Guard reason |
|---|---|---|---|
| Command Center | ✅ | ✅ | — |
| Contracts | ❌ hidden | ✅ | S24-P1 — C3Contracts provisioning pending |
| People | ✅ | ✅ | — |
| Renewals | ✅ (non-visitor) | ✅ | role guard only |
| Amendments | ❌ hidden | ✅ | S20-P0-3 — SP service stub |
| Inbox | ✅ (non-visitor) | ✅ | role guard only |
| Situation Room | ✅ | ✅ | — |
| **Missions** | ❌ **hidden (TD-25)** | ✅ | **S26-4 — C3Missions provisioning pending** |
| Intelligence | ❌ hidden | ✅ | TD-23 — cold-load crash contained |
| Approvals | ✅ (non-visitor) | ✅ | role guard only |
| Settings | canManageSettings | canManageSettings | capability guard |
| Diagnostics | ✅ | ✅ | — |

---

## Section 4 — Screen and hook inventory after Sprint 26

### New screen (S26)

- `MissionWorkspace.tsx` — read-only mission register. `C3Screen` union gains `{ id: 'missions' }` (15 screens total).

### Updated (S26)

- `useMissionService` — threads `config.spSiteUrl` into the SP factory; memo deps extended.
- `NavRail` / `AppShell` — missions item, guard, route, `toScreen` case.

### Unchanged (S25 baseline)

All people/credential/journey/approval/contract hooks and services; all mission hooks
(`useMissions`, `useMissionGaps`, `useMissionParticipants`, etc.) — they now receive live SP
data through the same interface once provisioning completes.

---

## Section 5 — Tech debt register state

| ID | State after S26 |
|---|---|
| TD-05, TD-06, TD-07, TD-10, TD-14, TD-15, TD-16, TD-17, TD-19, TD-21, TD-22 | Open — unchanged |
| TD-23 | Open — Intelligence contained in SP DSM, unchanged |
| TD-24 | Open — register entry truncation **repaired** in S26; underlying email gap unchanged |
| **TD-25** | **NEW** — SP DSM missions nav hidden pending C3Missions provisioning |

---

## Section 6 — Locked decisions honoured in Sprint 26

- Mission model frozen — no new fields; rejected fields stayed rejected
- Native fetch only — stale PnP.js comment removed with the rewrite
- ADR-002 activation gate — mapper hard-rejects unknown statuses
- ADR-013 — no ungoverned writes introduced (no writes at all)
- Beta containment pattern — hidden-until-provisioned guard reused
- Mock DSM remains demo/regression baseline — MissionWorkspace fully functional in mock
- SituationRoom untouched
