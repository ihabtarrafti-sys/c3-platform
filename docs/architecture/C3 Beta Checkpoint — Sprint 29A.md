# C3 Beta Checkpoint — Sprint 29A

**Status:** Prepared — ACL remediation ✅ COMPLETE (Part 15.0); hosted validation PENDING S29A runtime deployment
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 28
**Head commits:** `8f80ec2` (ADR addendum + deltas) · `a06e041` (lifecycle services) · `53aae34` (action UI) · `e8b4e59` (runtime)

Parts 0–14 of the Sprint 28 checkpoint carry over as regression items. Part 15 is new.
**Do not mark Sprint 29A closed until the runtime is deployed, the ACL gaps are remediated,
and Part 15 passes.**

---

## Part 15.0 — ⚠ SharePoint list permissions (REQUIRED BEFORE HOSTED VALIDATION)

**Finding (REST ACL verification, 2026-07-03):** all C3 lists **inherit site permissions**
(`HasUniqueRoleAssignments = false`). The inherited ACL does NOT match the application role
model:

| Group | Current (inherited) | Required (S29A design) |
|---|---|---|
| C3 Platform Owners | Full Control | ✅ ok |
| **C3 Operations** | **Read only** | **Edit on `C3MissionKitAssignments` + `C3PersonApparelProfiles`** — without this, every operations-role kit/apparel write fails with 403 (surfaced as WritePermissionError) |
| **C3 HR** | **Read only** | **Edit on `C3PersonApparelProfiles`** |
| **C3 Legal** | **Full Control** (!) | Read — currently Legal can edit *every* operational list directly |
| **Site "Members" group** | **Edit on everything** | Review — any site Member can today bypass ADR-013 by editing operational lists directly (pre-existing exposure, applies to People/Credentials/Journeys/Approvals too) |
| C3 Finance / Management / Visitors | Read | ✅ ok |

**✅ REMEDIATED 2026-07-03 (controlled, user-approved; two logistics lists only).**
Full before/after evidence, principal IDs, method, and decisions:
`C3 Logistics List Permissions — Sprint 29A.md`.

- [x] `C3MissionKitAssignments`: inheritance broken (no copy); Owners groups = Full Control,
      C3 Operations = Edit, all other groups (incl. HR/Legal/Finance/Management/site
      Visitors+Members) = Read. `HasUniqueRoleAssignments = true` verified via direct endpoint.
- [x] `C3PersonApparelProfiles`: identical, plus C3 HR = Edit.
- [x] Site-level and unrelated-list permissions untouched (verified: site web still shows
      the old Members/Legal grants — divergence proves list-level isolation).
- [ ] Practical per-role write/deny checks — pending role sessions; folded into Part 15.4.
- [ ] SITE-WIDE REVIEW (separate owner decision): site Members Edit + C3 Legal Full Control
      still apply to all OTHER operational lists — ADR-013 bypass exposure remains there.
- [ ] (S29B, apply with the governed-write implementation) C3MissionParticipants:
      Platform Owners = Edit only; everyone else Read.

## Part 15.1 — Schema delta verification — ✅ applied via REST (2026-07-03)

- [x] Duplicate-Title audit on all three lists: **zero duplicates**
- [x] `StatusNotes` (plain Note) created on `C3MissionKitAssignments` — internal name verified
- [x] Major-version retention 50 on `C3MissionKitAssignments` and `C3PersonApparelProfiles`
- [x] `EnforceUniqueValues` + index on `Title` for kit, apparel, **and participants (S29B
      schema prep only — no write behavior change)**

## Part 15.2 — Pre-flight

- [ ] HEAD at or after `e8b4e59`; pushed; SPPKG rebuilt/deployed
- [ ] `verify:runtime` PASS (S29A bundle SHA-256 `0295b3f840489a1770f9ab208a09585ace6011629e2f6ebe2c51e28f66bc91d7`)
- [ ] All seven parity scripts pass (87/220/51/37/28/35/38, 0 failures)

## Part 15.3 — Mock DSM regression

- [ ] Add kit item (Apparel/TRACKSUIT-01) → appears as NotOrdered; duplicate key rejected
      with a clear error; non-participant rejected
- [ ] Update menu shows only valid targets per status; Ordered → Confirmed absent;
      Delivered → Confirmed present
- [ ] Returned/Missing/Replaced and Deactivate demand a reason; reasonless Confirm disabled
- [ ] Deactivated item leaves active views
- [ ] Apparel: Add profile for PER-0004 → sections update; Edit changes size; single active
      profile retained
- [ ] Visitor/finance/legal/management roles see NO kit/apparel action affordances
- [ ] S28 read regression: counts, fulfilled counts, deep links unchanged

## Part 15.4 — SP DSM hosted smoke (after deployment + Part 15.0)

- [ ] As **owner**: full kit lifecycle walk on a test item
      (create → Ordered → Shipped → Delivered → Confirmed): toasts on every step;
      `StatusNotes` shows one `[ISO] KITSTATUS …` line per step with the correct actor;
      SP version history shows one version per step with the operator as Editor
- [ ] Returned-with-reason path: reason appears in the audit line
- [ ] Deactivate-with-reason: row remains in SP with `IsActive = false`; gone from C3 views
- [ ] Duplicate create against an existing key → domain duplicate error toast (unique
      constraint translated, not a raw SP error)
- [ ] **Concurrency drill:** open the same item in two sessions; transition in one, then in
      the other → ConcurrencyError toast ("refresh and retry"), no silent overwrite
- [ ] As **operations** (after ACL fix): create + transition succeed; as **hr**: apparel
      edit succeeds, kit actions absent; as **finance/legal**: no action affordances
- [ ] Apparel upsert round-trips (create-if-absent on PER-0004; edit on PER-0001);
      user Notes carries no audit text; version history captures prior values
- [ ] Core regression: People/AddPerson, Approvals, Credentials, Journeys, Missions,
      Participants, Situation Room (TD-26 guard intact), Command Center — all green;
      no ErrorBoundary; no mapper warnings

### 15.5 Deferred (recorded)

- Sprint 29B: governed Add/RemoveMissionParticipant (full ADR-013) — starts only after
  S29A closes
- Reactivation paths, kit metadata edits, UpdateMissionParticipant — deferred
- Site-wide permissions hardening — owner decision (Part 15.0 finding)
