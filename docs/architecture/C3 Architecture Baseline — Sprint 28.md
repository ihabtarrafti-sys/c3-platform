# C3 Architecture Baseline — Sprint 28

**Status:** Authoritative until Sprint 29 closeout
**Date:** 2026-07-03
**Supersedes:** C3 Architecture Baseline — Sprint 27
**Head commits at baseline:** `d04cd24` · `0461d45` · `fe2966f` (runtime SHA `703423d9…`)
**Hosted state:** S28 runtime deployed; hosted SP validation fully green

---

## Closeout statement

Sprint 28 delivered the Logistics Read Foundation: `C3PersonApparelProfiles` (stable person
apparel attributes) and `C3MissionKitAssignments` (issued mission kit per participant), both
provisioned and live; PersonProfile apparel + mission visibility with Situation Room
deep-links; Mission Workspace kit status with PersonProfile deep-links. Read-only throughout.

---

## Section 1 — Architectural shifts introduced in Sprint 28

1. **The logistics domain exists — with a hard boundary.** Kit assignments track
   participant-issued mission kit only: not inventory, not travel, not freight (those have
   different shapes/owners and remain future domains).
2. **Stable-vs-operational data separation.** Apparel sizing lives in a 1:1 optional person
   list, NOT on `C3People` — the frozen `Person` type, governed AddPerson flow, and s16
   parity surface stayed untouched. Mission-specific kit state lives in the join list.
3. **Operator-defined stable keys.** Kit identity is `MissionID + PersonID + ItemCategory +
   AssignmentKey`. This is the first C3 list whose identity includes an operator-authored
   key rather than only canonical IDs — `AssignmentKey` is required and stable;
   `ItemDescription` is editable display text and never identity; `Title` remains
   display-only everywhere.
4. **Cross-screen navigation loop closed.** PersonProfile → Situation Room (mission-scoped)
   and MissionWorkspace participant → PersonProfile. Both pure navigation on existing
   `C3Screen` members — no screens.ts changes.
5. **First PersonProfile change since S25** — strictly additive (two SectionCards, two hooks
   at the established top-of-component block); full hosted regression of
   credentials/contracts/readiness/approvals passed.
6. **Truthful-empty-state rule now spans three surfaces:** zero participants (S27), missing
   apparel profile, zero kit assignments — none implies error or readiness; fulfilled
   display (`Delivered`/`Confirmed`) requires ≥ 1 assignment.

---

## Section 2 — Data layer after Sprint 28

### SP lists read/written by C3 (SP DSM)

| List | Read | Write | Notes |
|---|---|---|---|
| `C3People` / `C3Credentials` / `C3Journeys` / `C3Approvals` | ✅ | ✅ governed | unchanged |
| `C3Contracts` | ✅ (guarded) | ❌ | unchanged |
| `C3Missions` | ✅ | ❌ (TD-26) | unchanged |
| `C3MissionParticipants` | ✅ | ❌ (S29) | unchanged |
| `C3PersonApparelProfiles` | ✅ **NEW (S28)** — live | ❌ (S29) | one active profile per person; 404-safe |
| `C3MissionKitAssignments` | ✅ **NEW (S28)** — live | ❌ (S29) | identity incl. AssignmentKey; 404-safe |

### Mapper / parity inventory

| Mapper | Since | Parity |
|---|---|---|
| spCredential / spPerson / spJourney / spApproval | S15–S18 | s15–s18 (inline-translation, legacy) |
| contractMapper | S24 | — |
| spMissionMapper | S26 | — (validated live at provisioning) |
| spMissionParticipantMapper | S27 | s27 (compiled-from-source) |
| **spApparelProfileMapper / spKitAssignmentMapper** | **S28** | **s28 (compiled-from-source, 35 checks)** |

### Service composition

- `IMissionService` now bundles missions + participants + kit assignments (mission-join data,
  by S27 precedent).
- `IApparelProfileService` is a new parallel-factory service (ADR-001) for person-stable data.

---

## Section 3 — NavRail visibility matrix (SP DSM) — unchanged from S27

Visible: Command Center, People, Renewals*, Inbox*, Situation Room, Missions, Approvals*,
Settings†, Diagnostics. Hidden: Contracts, Amendments, Intelligence. In-screen guard: Situation
Room mission confirmation (TD-26). (* non-visitor; † canManageSettings.)

---

## Section 4 — Capability model (documentation corrected to match code — S28)

`C3Capabilities` (`types/roles.ts`) — **the authoritative shape:**

| Capability | owner | operations | legal | finance | hr | management | visitor |
|---|---|---|---|---|---|---|---|
| `canCreate` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canEdit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canViewFinancials` | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| `canManageSettings` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `canUploadDocuments` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `canCaptureRenewal` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `isReadOnly` | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

> **Correction (S28):** earlier handoff documents described `canApprove` and `canViewFinance`
> capabilities — **neither exists in code**. Approval actions in `ApprovalInbox` gate directly
> on `currentUser.c3Role === 'owner'`, not on a capability. Journey lifecycle actions gate on
> `owner || operations` role checks. Any future capability-model change (e.g. introducing a
> real `canApprove`) is an explicit design decision, likely alongside the S29 write
> governance classification.

---

## Section 5 — Tech debt register state

| Item | State after S28 |
|---|---|
| TD-26 — SP mission confirmation write | Open — deferred; containment hosted-verified |
| Participant writes | Deferred → S29 governance design |
| **Kit writes / lifecycle transitions** | **Deferred → S29** |
| **Apparel profile writes** | **Deferred → S29** |
| Top-500 limits (TD-19 + service-wide caps) | Open — approvals is the monotonic-growth list |
| CI/CD absent; manual runtime workflow (TD-14/TD-15) | Open |
| TD-23 Intelligence SP cold-load | Open — contained |
| s15–s18 inline-translation parity drift | Open — migrate opportunistically to the compiled pattern |
| Dual participant/kit cache invalidation | Design item for S29 writes |

---

## Section 6 — Roadmap after Sprint 28

- **Sprint 29 — Governed Mission Operations Writes:** AddMissionParticipant,
  RemoveMissionParticipant, AddKitAssignment, kit lifecycle transitions, apparel profile
  edits. Governance NOT pre-locked — S29 Phase 0 classifies each operation
  (ADR-013 governed / documented lifecycle exemption / role-gated profile update /
  owner-only transition).
- **Sprint 30:** Mission readiness cockpit and/or Mission Budgeting, subject to S29.

## Section 7 — Locked decisions honoured in Sprint 28

Plain-text canonical FKs; no SP lookups; native fetch only; frozen types untouched; ADR-013
untouched (no writes at all); Mock DSM regression baseline (mock seeds mirror SP rows 1:1);
beta containment guards unchanged; SituationRoom/CommandCenter untouched; hosted validation
before closure.
