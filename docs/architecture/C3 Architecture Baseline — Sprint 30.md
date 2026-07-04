# C3 Architecture Baseline — Sprint 30

**Status:** Authoritative until Sprint 31 closeout
**Date:** 2026-07-04
**Supersedes:** C3 Architecture Baseline — Sprint 29B (preserved as historical)
**Head commits at baseline:** `79b7008` … `f252704` (runtime `3d55242`, SHA `2a4a162d…`)
**Hosted state:** S30 runtime deployed; hosted Part 17 fully green; ACL Phase B PASS on all four core lists

---

## Closeout statement

Sprint 30 delivered the Mission Readiness Cockpit v1 — a truthful, two-axis, computed
readiness verdict on every mission card, built entirely from existing live data with no
new list, schema field, or screen — plus the zero-roster work-item trigger, and completed
the platform-wide ACL hardening for C3People, C3Credentials, C3Journeys, and C3Missions.

---

## Section 1 — Architectural shifts introduced in Sprint 30

1. **The two-axis readiness pattern.** Lifecycle applicability (`MissionEvaluationState`)
   is separated from evaluated severity (`MissionReadinessState`); severity precedence
   (Blocked > AtRisk > Incomplete > Ready) is applied only to Evaluated missions. This is
   the template for any future aggregate-verdict surface.
2. **Source-trust as a first-class computation input.** `ReadinessSource<T>{data,trusted}`
   propagates per-query failure into explicit `Unknown` states — a failed query can never
   render as an empty success (extends the TD-02 lesson from hook-level errors to
   computed-aggregate semantics).
3. **Pure batch computation over shared caches.** `utils/missionReadiness.ts` computes all
   missions in one pass, reusing the exact `useMissionGaps` recipe for compliance;
   `useMissionReadiness` introduces ZERO new query keys — every existing mutation's
   invalidation reaches the cockpit for free, and mock/SP parity is inherited from the
   sources rather than re-implemented.
4. **Extensible facet-discriminated work items.** `MissionReadinessGap` carries a `facet`
   union ('Participants' now, 'Kit' later) so new trigger conditions extend the variant
   without renaming categories or breaking deterministic IDs
   (`mrg-{missionId}-{facetSlug}`). The zero-roster blind spot (no gaps ⇒ no MDP item) is
   closed; MDP and MRG are mutually exclusive by construction.
5. **Security boundary completed for the operational core.** Eight lists now carry
   verified unique least-privilege ACLs. The rev 2 hardening pattern adds: unique-child-
   scope preflight (fail closed), `clearSubscopes=false` always, programmatic
   inherited-posture verification, and post-mutation child-scope re-audit — this is the
   locked method for any future list hardening.

## Section 2 — Readiness model (locked v1 semantics)

See `Mission Readiness Semantics — Sprint 30.md` (authoritative). Summary:
Planning/FinancePending → NotEvaluated; Confirmed/Active/PostMission → Evaluated (or
Unknown on source failure); Settled/Canceled → NotApplicable. Facets: participants
(active executed only; pending separate), compliance (gap tiers; NoParticipants ≠ Clear;
unrouted count folds journeys in — no separate journey facet), kit (participant-aware
denominator; Missing ⇒ Exception; uncovered prevents Fulfilled). No percentage. Apparel,
milestones, finance, per-participant chips, kit work items: deferred (apparel + kit
trigger intentionally by the primary lead architect).

## Section 3 — Write capability matrix after Sprint 30

Unchanged from Sprint 29B — the cockpit is read-only computed state. (People governed
create; credentials governed add/deactivate; journeys governed initiate + S19 lifecycle;
participants governed add/remove/reactivate; kit + apparel per S29A exemption; approvals
Add-only submitters; missions/contracts/finance writes deferred, TD-26 intact.)

## Section 4 — Security posture (live, verified 2026-07-04)

| List | Unique ACL | Edit | Notes |
|---|---|---|---|
| C3MissionKitAssignments | ✅ S29A | Owners, Operations | |
| C3PersonApparelProfiles | ✅ S29A | Owners, Operations, HR | |
| C3MissionParticipants | ✅ S29B | Platform Owners only | governed requests only |
| C3Approvals | ✅ S29B | Owners lifecycle; Operations Add-only (`C3 Approval Submitter`) | rows immutable to creator |
| **C3People** | ✅ **S30** | **Platform Owners only** | owner approval executions only |
| **C3Credentials** | ✅ **S30** | **Platform Owners only** | owner approval executions only |
| **C3Journeys** | ✅ **S30** | **Owners + Operations** | S19 lifecycle runs in operator session — preserved, hosted-verified |
| **C3Missions** | ✅ **S30** | **Owners + Operations** | owner-confirmed: both roles legitimately author mission rows manually (no app write path; TD-26 intact) |
| C3Contracts | ❌ deferred | — | posture decided with provisioning/activation |

All hardened lists: HR/Legal/Finance/Management Read; site Members Read (Edit bypass
removed); C3 Legal Full Control bypass removed; zero child ACL scopes disturbed; evidence
in `C3 Platform ACL Review — Sprint 30.md`.

## Section 5 — Validation gate (Sprint 30 shape)

Nine parity harnesses: s15 87 · s16 220 · s17 51 · s18 55 · s27 28 · s28 35 · s29 38 ·
s29b 34 · **s30 59 (new — compiled-from-source readiness + work-item checks)** + tsc ×2 +
mandatory strict build (`beta:runtime`) + `verify:runtime` + NUL audit. Runtime SHA at
baseline: `2a4a162dbfeda9411ccf9e9b12382a77f5c1d66c4291d99ff74eefcddfcf9be8`.

## Section 6 — Tech debt state

**Resolved in S30:** TD-28 (inherited site ACLs on the four core lists — the standing
governance bypass; C3Contracts posture deferred to its activation decision).
**Open:** TD-19 (approvals top-500 — the leading operational risk; monotonic), TD-23,
TD-26, manual CI/CD + committed runtime (TD-14/15), C3Contracts provisioning + TD-22
migration, TD-24 (People Email), UpdateMissionParticipant / generic reactivation UI / kit
metadata edits, top-N inconsistencies, s15–s17 inline parity pattern, strict-gate
automation.

## Section 7 — Roadmap

**Sprint 31 candidates (recorded, not designed):** approvals scale hardening (TD-19/TD-07
+ pagination) with Readiness v1.1 (apparel facet + batch read; kit work-item facet) as
the product increment; alternatives: C3Contracts activation, TD-26 confirmation design.
All locked decisions honoured; SituationRoom untouched; Contracts/Amendments/Intelligence
guards unchanged; mock DSM remains the regression baseline.
