# C3 Beta Checkpoint — Sprint 30

**Sprint:** 30 — Mission Readiness Cockpit (v1)
**Status:** Source complete · validation gate green · AWAITING deploy + hosted Part 17 + ACL track hosted-green
**Prepared:** 2026-07-04
**Semantics:** `Mission Readiness Semantics — Sprint 30.md` (approved)
**Security track:** `C3 Platform ACL Review — Sprint 30.md` (Phase A complete; Phase B owner-executed)

Sprint 30 is NOT closed until hosted validation (Part 17) and the ACL track
are both green.

---

## Part 17 — Hosted validation (user executes on the deployed runtime)

### 17.0 Deploy

- [ ] `git push origin master`; rebuild SPPKG; deploy via App Catalog; hard refresh.
- [ ] Verify deployed runtime SHA-256 matches the Sprint 30 build:
      `2a4a162dbfeda9411ccf9e9b12382a77f5c1d66c4291d99ff74eefcddfcf9be8`

### 17.1 Readiness strip — lifecycle truthfulness (MissionWorkspace)

- [ ] Every mission card shows the readiness strip; "Computing readiness…"
      appears at most briefly and never a verdict while loading.
- [ ] A **Planning or FinancePending** mission shows exactly
      "Readiness: not evaluated (pre-confirmation)" — no facet chips, never green.
- [ ] A **Settled or Canceled** mission shows no readiness strip at all.
- [ ] A **Confirmed/Active/PostMission** mission shows the overall chip plus
      three facet chips (participants, gaps, kit).

### 17.2 Truthful empty and zero states

- [ ] A confirmed mission with zero participants reads
      "No participants assigned" + "No participants to evaluate" + overall
      **Incomplete** — never Ready, never "Gaps clear".
- [ ] A participant with zero kit rows keeps the kit chip out of Fulfilled
      (uncovered count shown); zero kit rows overall reads "No kit recorded".

### 17.3 Live facet correctness (spot-check against list data)

- [ ] Gap counts on the strip match the Situation Room mission scope for the
      same mission (both compute from the same shared caches).
- [ ] Kit chip counts match the card's expanded kit rows
      (fulfilled = Delivered + Confirmed; Missing shows as "Kit: N missing"
      with overall At risk).
- [ ] Transition a kit item (e.g. Delivered → Confirmed) → strip updates
      without reload (shared query invalidation).
- [ ] Execute a participant add approval → roster count and facets update;
      pending badge clears.

### 17.4 MissionReadinessGap work item (Command Center)

- [ ] A Confirmed mission inside 30 days with zero participants produces
      "…has no participants assigned" (Immediate when ≤ 7 days, else High);
      button label "Assign Participants" navigates to Missions.
- [ ] After adding a participant (governed execution), the item disappears on
      the next queue recompute.
- [ ] No such item for Planning/FinancePending/PostMission/Settled/Canceled
      missions; no duplicate alongside a MissionDeparturePressure item for the
      same mission.

### 17.5 Read-only + regression guards

- [ ] The cockpit performs **no writes**: browser dev tools show no new
      POST/MERGE traffic from rendering MissionWorkspace beyond the S29B
      baseline (readiness reuses existing GET caches).
- [ ] SituationRoom behaves byte-identically (zero source changes).
- [ ] S29B participant add/remove flows and S29A kit flows regress green.
- [ ] NavRail guards unchanged (Contracts/Amendments/Intelligence hidden in SP
      DSM; TD-26 confirmation still hidden).
- [ ] No milestone or finance facet appears anywhere in the cockpit.

### 17.6 ACL track (closure rule — `C3 Platform ACL Review — Sprint 30.md` §7)

- [ ] **C3People, C3Credentials, C3Journeys:** Phase B applied and per-role
      hosted tests green — REQUIRED before Sprint 30 closure (matrices are
      unambiguous per the Phase A audit).
- [ ] Operations journey-lifecycle transition verified green AFTER hardening.
- [ ] **C3Missions:** EITHER (a) manual authoring role confirmed → Phase B
      applied + validated, OR (b) authorship unresolved → controlled deferral
      recorded per ACL doc §7 (owner-approved deferral + risk re-entered in
      Tech Debt Register/backlog + permissions untouched + required evidence
      documented). No partial hardening; no silent open item.

---

## Validation gate at source completion (2026-07-04)

| Check | Result |
|---|---|
| s15 / s16 / s17 / s18 | 87/87 · 220/220 · 51/51 · 55/55 |
| s27 / s28 / s29 / s29b | 28/28 · 35/35 · 38/38 · 34/34 |
| **s30 (new)** | **59/59** |
| tsc no-emit (c3 + spfx) | clean |
| beta:runtime strict build | pass |
| verify:runtime | pass (SHA recorded at build commit) |
| NUL/truncation audit | pass (all changed files) |

## Deferred v1.1 items

See `Mission Readiness Semantics — Sprint 30.md` §8. The apparel facet
(+ batch read) and kit-generated MissionReadinessGap work items were
**intentionally deferred by the primary lead architect** at Sprint 30 v1
authorization and must not be restored to v1. Also deferred:
kit-not-applicable marker, milestones/finance facets, overall percentage,
per-participant chips.
