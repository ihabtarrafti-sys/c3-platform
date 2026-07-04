# Sprint 30 Closeout Report — Mission Readiness Cockpit
**C3**
**Sprint:** 30 — Mission Readiness Cockpit (v1) + platform-wide ACL hardening (parallel security track)
**Closeout date:** 2026-07-04
**Status:** CLOSED — hosted Part 17 fully green + ACL Phase B PASS on all four lists
**Preceding sprint:** Sprint 29B CLOSED (Governed Participant Membership)
**Validation baseline:** nine parity harnesses pass (incl. new s30 59/59), tsc + strict build clean, verify:runtime PASS, hosted green
**Final runtime SHA-256:** `2a4a162dbfeda9411ccf9e9b12382a77f5c1d66c4291d99ff74eefcddfcf9be8`

---

## Closeout statement

Sprint 30 closes as:

> **"Every mission card now carries a truthful, computed readiness verdict. A two-axis
> model separates lifecycle applicability from evaluated severity; participants,
> compliance, and kit facets are computed in one pass from existing live data with
> per-source trust (a failed query surfaces Unknown, never an empty success); zero-roster
> committed missions — previously invisible to the work queue — now generate a
> MissionReadinessGap work item; and the four remaining core operational lists
> (C3People, C3Credentials, C3Journeys, C3Missions) carry verified unique least-privilege
> ACLs, closing the site-Members-Edit / Legal-Full-Control governance bypass."**

Sprint 30 does **not** close as:

> ~~"An apparel facet or apparel batch read exists (intentionally deferred by the primary lead architect)."~~
> ~~"Kit-generated work items exist (intentionally deferred; the trigger's facet union extends without renaming)."~~
> ~~"Milestone/finance facets or an overall readiness percentage exist (excluded from v1)."~~
> ~~"A new SP list, schema field, or screen was introduced (none were)."~~
> ~~"SituationRoom was modified (zero source changes; regression hosted-verified)."~~
> ~~"C3Contracts ACLs changed (deferred with the list's provisioning/activation decision)."~~

## What shipped

### Readiness model (approved semantics — `Mission Readiness Semantics — Sprint 30.md`)

- Two axes: `MissionEvaluationState` (NotApplicable | NotEvaluated | Evaluated | Unknown)
  × `MissionReadinessState` (Ready | Incomplete | AtRisk | Blocked; precedence worst-wins,
  applied ONLY when Evaluated). Lifecycle mapping restates ADR-002 — `useMissionGaps` and
  `MISSION_OBLIGATION_ACTIVE_STATUSES` untouched.
- Required-source failure rule: participant failure ≠ empty roster; kit failure ≠
  NotRecorded; credential/journey failure ≠ Clear. Untrusted required sources ⇒ evaluation
  Unknown, overall null. Pending approvals informational (failure nulls only the indicator).
- Facets: participants (active executed only; pending shown separately, never in the
  denominator; Empty ⇒ Incomplete), compliance (Critical ⇒ Blocked; High/Medium ⇒ AtRisk;
  zero participants ⇒ NoParticipants, never Clear; routing folded in as unroutedCount),
  kit (participant-aware denominator; uncovered participant prevents Fulfilled; Missing ⇒
  Exception ⇒ AtRisk, never Ready).

### Source (commits `79b7008` … `f252704`)

- `types/missionReadiness.ts` — mission-specific types (renamed from `readiness.ts` at
  review; proven disjoint from `usePersonReadiness`).
- `utils/missionReadiness.ts` — pure one-pass batch computation; protocols injected.
- `hooks/useMissionReadiness.ts` — composition over EXISTING query keys only (zero new
  network surface; every existing invalidation reaches the cockpit).
- `components/shared/ReadinessFacetStrip.tsx` — reusable truthful display; rendered on
  MissionWorkspace cards outside the screen's blocking isLoading (frame-zero preserved).
- `MissionReadinessGap` work item (`mrg-{missionId}-participants`): Confirmed/Active inside
  the 30-day window with zero active participants; Operations/ProtocolDefault; ≤7d
  Immediate else High; routes to the Missions workspace; mutually exclusive with
  MissionDeparturePressure by construction; facet union extends to 'Kit' without renaming.
- `scripts/s30-parity-readiness.mjs` — 59/59 compiled-from-source checks (lifecycle
  mapping, Unknown-vs-empty, denominators, precedence, work-item window/ID/dedupe).
- Hygiene: `.gitattributes` comment documents that the bare `c3-runtime.js -text` pattern
  already covers the legacy dist copy (verified via check-attr; no rule change needed).

### Security track (evidence: `C3 Platform ACL Review — Sprint 30.md`)

Phase A source audit → owner-confirmed matrices → rev 2 browser-console execution
(dry-run-first; dynamic principal/role resolution; unique-child-scope preflight;
`breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false)`; programmatic
inherited-posture verification; direct-endpoint after-state) → **PASS on all four lists**
with zero child scopes disturbed, Members-Edit and Legal-FC bypasses removed, Operations
journey-lifecycle and mission-authoring writes preserved and hosted-verified per role.

## Hosted validation (Part 17 — green 2026-07-04)

Readiness lifecycle truthfulness (NotEvaluated pre-confirmation; no strip for
Settled/Canceled; never-green empty states) · live facet correctness against list data ·
participant-aware kit coverage · compliance severity vs Situation Room mission scope ·
zero-roster work-item appearance/disappearance with no duplicates · cockpit performed no
writes · SituationRoom regression green · S29A/S29B write flows regression green ·
per-role ACL tests green on all four hardened lists.

## Error Library

No additions — the cockpit is read-only computed state; it introduces no new write paths,
no new error classes, and no new toasts beyond existing patterns. ERR-035 remains the
latest entry.

## Deferred (recorded; see semantics §8)

Intentionally deferred by the primary lead architect (do not restore to v1): apparel facet
+ apparel batch read; kit-generated MissionReadinessGap items. Also deferred:
kit-not-applicable marker, milestone/finance facets, overall percentage, per-participant
readiness chips.

## Sprint 31 recommendation (recorded, not designed)

Primary candidate: **Approvals scale hardening** — TD-19/TD-07 (server-side
`targetPersonId` filter + pagination before C3Approvals approaches the 500 cap; the only
monotonically growing operational risk) plus strict-gate automation, with **Readiness
v1.1** (apparel facet + batch read, kit work-item facet) as the product increment.
Alternatives: C3Contracts provisioning/activation (+ its ACL posture + TD-22 migration);
TD-26 governed mission-confirmation write design. Owner decision at Sprint 31 Phase 0.
