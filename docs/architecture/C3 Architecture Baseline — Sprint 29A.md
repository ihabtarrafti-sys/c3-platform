# C3 Architecture Baseline — Sprint 29A

**Status:** Authoritative until Sprint 29B closeout
**Date:** 2026-07-03
**Supersedes:** C3 Architecture Baseline — Sprint 28
**Head commits at baseline:** `8f80ec2` · `a06e041` · `53aae34` · `e8b4e59` (runtime SHA `0295b3f8…`) · `96366ee` · `ad59226`
**Hosted state:** S29A runtime deployed; hosted validation fully green incl. per-role checks

---

## Closeout statement

Sprint 29A delivered the first non-owner operational writes: kit assignment creation, a
validated kit fulfillment lifecycle, kit deactivation, and apparel profile maintenance —
under the narrow **ADR-013 Addendum — Mission Kit Logistics Exemption**, with ETag optimistic
concurrency, compound-key row resolution, dual-layer audit (StatusNotes + SP version
history), and list-level ACL hardening.

---

## Section 1 — Architectural shifts introduced in Sprint 29A

1. **The write-mechanics standard is set.** Every future C3 update write follows: resolve the
   exact row by canonical columns (0→RowNotFound, 2+→DataIntegrity) → capture SP `Id` +
   actual ETag as *internal* persistence metadata → MERGE with `IF-MATCH: <etag>` →
   412→ConcurrencyError. `IF-MATCH: *` is prohibited in new code. (Legacy S18/S23 writes
   still use `*` — migration candidate, not urgent.)
2. **Deterministic unique Titles as race guards.** `EnforceUniqueValues` on display Titles
   provides server-side duplicate protection for concurrent creates; SP unique-constraint
   failures are translated into domain duplicate errors. Titles remain display/constraint
   only — never parsed for identity.
3. **Three-layer authority is now explicit and enforced end-to-end:** UI role checks
   (affordance) → shared pure-module + service validation (authority) → SharePoint list ACLs
   (security boundary — hardened for the two logistics lists; site-wide review open).
4. **Dual-layer audit:** append-only `StatusNotes` lines (readable context) + SP version
   history at retention 50 with the authenticated `Editor` (authoritative attribution).
   Actor identity is AppContext-only, fail-closed.
5. **Shared pure lifecycle module** (`utils/kitLifecycle.ts`) drives UI menus, mock service,
   SP service, and parity from one transition matrix — the journey `canX` pattern, matured.
6. **First non-owner writes:** operations (kit + apparel) and HR (apparel) now have hosted-
   verified write capability, with read-only roles verified denied.

## Section 2 — Write capability matrix after Sprint 29A

| Domain | Create | Update | Deactivate | Governance |
|---|---|---|---|---|
| People | ✅ governed (AddPerson) | ❌ | ❌ | ADR-013 |
| Credentials | ✅ governed | ❌ | ✅ governed | ADR-013 |
| Journeys | ✅ governed | lifecycle ✅ | — | ADR-013 + S19 exemption |
| Approvals | ✅ (engine) | owner stamps | ❌ | ADR-013 core |
| **Kit assignments** | ✅ **role-gated (S29A)** | ✅ **lifecycle (S29A)** | ✅ **(S29A)** | **Kit Logistics Exemption** |
| **Apparel profiles** | ✅ **upsert (S29A)** | ✅ | ❌ (deferred) | **role-gated master data** |
| Mission participants | ❌ → **S29B (ADR-013, locked)** | ❌ | ❌ → S29B | |
| Missions / Contracts / Finance | ❌ | ❌ (TD-26) | ❌ | deferred |

## Section 3 — Security posture

- `C3MissionKitAssignments` / `C3PersonApparelProfiles`: unique role assignments
  (REST-verified `HasUniqueRoleAssignments=true`); Owners FC · Operations Edit ·
  (+HR Edit on apparel) · all others Read. Evidence: `C3 Logistics List Permissions —
  Sprint 29A.md`.
- **Open exposure (owner decision):** site-level Members=Edit and Legal=Full Control still
  apply to all *other* operational lists — direct-edit ADR-013 bypass remains there.
- S29B planned posture: `C3MissionParticipants` Platform-Owners-only edit; `C3Approvals`
  submitter hardening (see S29B security design).

## Section 4 — Error model additions (Error Library ERR-023…ERR-029)

RowNotFoundError · DataIntegrityError · ConcurrencyError · DuplicateKitAssignmentError ·
WritePermissionError · ParticipantNotActiveError · InvalidKitTransitionError — all
operator-surfaced via toast; none silent.

## Section 5 — Locked decisions honoured

Frozen domain types unchanged (persistence metadata never leaked); native fetch; canonical
plain-text identity; Mock DSM regression baseline (mock writes share the pure guards);
SituationRoom/CommandCenter untouched; Contracts/Amendments/Intelligence guards unchanged;
TD-26 intact; hosted validation before closure.

## Section 6 — Roadmap

**Sprint 29B (next, in flight):** governed participant membership — Add/RemoveMissionParticipant
as full ADR-013 operations, governed reactivation on re-add, pending-request visibility,
participants + approvals ACL hardening, OperationType schema delta.
**Sprint 30:** readiness cockpit and/or budgeting, subject to S29B.
