# C3 Architecture Baseline — Sprint 27

**Status:** Authoritative until Sprint 28 closeout
**Date:** 2026-07-03
**Supersedes:** C3 Architecture Baseline — Sprint 26
**Head commits at baseline:** `f564588` (TD-26 containment) · `3275829` (participants read foundation)
**Hosted state:** S27 runtime deployed; hosted SP validation fully green

---

## Closeout statement

Sprint 27 delivered the Mission Participants Foundation: the `C3MissionParticipants` join
list (provisioned and live), a native-fetch SP participant read path, Mission Workspace and
Situation Room participant visibility with live name resolution from C3People, and containment
of the SP mission-confirmation false affordance (TD-26). Read-only throughout — no participant
writes, no mission writes, no PersonProfile changes.

---

## Section 1 — Architectural shifts introduced in Sprint 27

### Before Sprint 27 (Sprint 26 baseline)

- Participant domain mock-only; SP participant reads were warning stubs returning `[]`
- Situation Room participant count was always 0 in SP DSM; zero-gap copy claimed credential
  readiness even with nobody assigned
- "Approve & Confirm Mission" rendered in SP DSM against a throwing stub (exposed by S26's
  live mission reads)

### After Sprint 27

1. **Participant SP read path is live.** `listMissionParticipants` /
   `listAllMissionParticipants` follow the established native-fetch pattern: 404-safe `[]`,
   mapping delegated to `spMissionParticipantMapper`, OData-escaped + URL-encoded TR/SATR
   filters, `$top=500` (documented scale note).
2. **The join-list relationship model is now implemented end-to-end:**
   `C3MissionParticipants.MissionID → C3Missions.Title` and
   `C3MissionParticipants.PersonID → C3People.PersonID` — plain-text canonical FKs, no SP
   lookups, no SP numeric cross-domain identity, no participant arrays in mission rows.
   One row per person per mission (conceptual key `MissionID + PersonID`);
   `Title = <MissionID>|<PersonID>` is display-only and never parsed for identity.
3. **Persistence-vs-domain separation for IsActive.** `IsActive` exists only at the SP/mapper
   layer (`MappedMissionParticipant.isActive`) — the frozen `MissionParticipant` domain type
   is unchanged. Explicit-false rows are excluded from all reads but retained in SP for
   history; null defaults true.
4. **Live cross-domain name resolution.** Mission Workspace resolves participant names from
   C3People by PersonID at render time (single cached people query; `Unknown person
   (PER-XXXX)` fallback). No name snapshots are stored — one source of truth.
5. **Consumers went live without modification.** Situation Room participant counts, ADR-002
   mission gap computation, and Command Center work-item generation now evaluate real SP
   assignments purely through the shared `IMissionService` interface.
6. **SP mission confirmation contained (TD-26).** The Situation Room approve action is hidden
   in SP DSM; Mock DSM confirmation is unchanged. Future SP confirmation requires an
   explicitly designed governed write path — never a silent direct lifecycle write.
7. **Parity harness pattern upgraded.** `s27-parity-participants.mjs` compiles the actual
   production mapper via esbuild instead of inline-translating it — no manual-sync drift.
   s15–s18 retain the legacy inline pattern (candidate for future migration).

---

## Section 2 — Data layer after Sprint 27

### SP lists read/written by C3 (SP DSM)

| List | Read | Write | Notes |
|---|---|---|---|
| `C3People` | ✅ | ✅ governed (AddPerson) | unchanged |
| `C3Credentials` | ✅ | ✅ governed | unchanged |
| `C3Journeys` | ✅ | ✅ governed + lifecycle | unchanged |
| `C3Approvals` | ✅ | ✅ | unchanged |
| `C3Contracts` | ✅ (guarded) | ❌ | unchanged |
| `C3Missions` | ✅ | ❌ (TD-26) | unchanged from S26 |
| `C3MissionParticipants` | ✅ **NEW (S27)** — provisioned + live | ❌ | 3 seed rows mirror mock; hosted green |

### Mapper inventory

| Mapper | Location | Since |
|---|---|---|
| `spCredentialMapper` / `spPersonMapper` / `spJourneyMapper` / `spApprovalMapper` | `utils/` | S15–S18 |
| `contractMapper` | `mappers/` | S24 |
| `spMissionMapper` | `utils/` | S26 |
| `spMissionParticipantMapper` | `utils/` | **S27** |

### Parity harness inventory

| Script | Pattern | Coverage |
|---|---|---|
| `s15` / `s16` / `s17` / `s18` | inline translation (legacy) | credentials / people / journeys / approvals |
| `s27-parity-participants.mjs` | **compiled-from-source (esbuild)** | participant mapper + OData escaping helper |

---

## Section 3 — NavRail visibility matrix (SP DSM) — unchanged from S26-5

Visible: Command Center, People, Renewals*, Inbox*, Situation Room, Missions, Approvals*,
Settings†, Diagnostics. Hidden: Contracts (S24-P1), Amendments (S20-P0-3), Intelligence
(TD-23). (* non-visitor; † canManageSettings.)

In-screen SP DSM guard added this sprint: Situation Room "Approve & Confirm Mission" action
(TD-26).

---

## Section 4 — Screen and hook inventory after Sprint 27

### Updated (S27)

- `MissionWorkspace.tsx` — participant counts + expandable read-only assignment detail;
  consumes `useAllMissionParticipants` (one batch query, grouped locally) and `usePeople`
  (name map).
- `SituationRoom.tsx` — TD-26 guard + truthful zero-participant/zero-gap copy. No other
  changes.
- `SharePointMissionService` — participant reads live; `encodeODataLiteral` exported.

### Unchanged

`PersonProfile.tsx` (verified 0-line diff), all people/credential/journey/approval/contract
hooks and services, mission model and mock services, all participant hooks (they now receive
live data through the unchanged interface).

---

## Section 5 — Tech debt register state

| ID | State after S27 |
|---|---|
| TD-05…TD-22 (open items) | Open — unchanged |
| TD-23 | Open — Intelligence contained, unchanged |
| TD-24 | Open — email gap unchanged |
| TD-25 | ✅ Resolved (S26-5) |
| **TD-26** | **Open — contained.** SP confirm action hidden; hosted-verified. Write path deferred to an explicit governed-write design |

---

## Section 6 — Locked decisions honoured in Sprint 27

- Frozen `MissionParticipant` type — no new domain properties
- Plain-text canonical FKs; no SP lookups; SP `Id` = transport metadata only
- Native fetch only; no PnP.js
- ADR-002 — participant assignments now drive the live activation-gated gap computation
- ADR-013 — no writes introduced anywhere; TD-26 defers mission confirmation to an explicit
  governed design
- Beta containment pattern — extended to in-screen actions (TD-26 guard)
- Mock DSM remains demo/regression baseline; mock behaviour unchanged and green
- SituationRoom not redesigned — two surgical, hosted-validated edits only
