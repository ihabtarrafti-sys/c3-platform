# Mission Readiness Semantics — Sprint 30

**Status:** Approved (owner decision, 2026-07-04) — implemented in Sprint 30 v1
**Scope:** Read-only Mission Readiness Cockpit over existing live data
**Module:** `packages/c3/src/utils/missionReadiness.ts` (pure, compiled-from-source parity)
**Parity:** `scripts/s30-parity-readiness.mjs`

---

## 1. Approved v1 scope

Included facets: **Participants**, **Compliance/operational gaps**, **Kit**.

Excluded from v1 (owner decision): Apparel facet; a separate Journey facet
(journey/routing information appears inside the compliance facet via the
existing gap ownership model); Milestones; Finance; any overall readiness
percentage; per-participant readiness chips; kit-generated Command Center
work items.

No new SharePoint list or schema field. No SituationRoom source changes. No
new screen. `useMissionGaps` and `MISSION_OBLIGATION_ACTIVE_STATUSES` are
untouched — the cockpit computes beside ADR-002, never through it.

## 2. Two-axis model

Lifecycle applicability is separated from evaluated severity.

**MissionEvaluationState:** `NotApplicable | NotEvaluated | Evaluated | Unknown`

**MissionReadinessState** (only meaningful when Evaluated):
`Ready | Incomplete | AtRisk | Blocked`

Lifecycle mapping (restates ADR-002; the activation gate is not modified):

| MissionStatus | Evaluation state |
|---|---|
| Planning | NotEvaluated |
| FinancePending | NotEvaluated |
| Confirmed | Evaluated |
| Active | Evaluated |
| PostMission | Evaluated |
| Settled | NotApplicable |
| Canceled | NotApplicable |

`Unknown` is a **trust failure**, not a lifecycle state: an evaluation-eligible
mission whose required facet sources could not be loaded or trusted.

## 3. Required-source failure rule

A failed or untrusted query must never become an empty successful state:

- participant query failure ≠ empty roster;
- kit query failure ≠ NotRecorded;
- credential/journey query failure ≠ Clear compliance.

When any required blocking facet source is untrusted, the mission's evaluation
is `Unknown` and no overall verdict is produced. Facets that DID load still
display their real state; the failed facet carries its own `Unknown` status.

Loading is distinct from loaded-but-Unknown: the hook exposes `isPending`
(frame-zero gate, TD-23 lesson) and the strip renders a loading affordance —
never a verdict — while pending.

Pending approvals are **informational**: an approval-query failure makes only
the pending-change indicator Unknown (null counts). It never invents executed
membership and never invalidates trusted operational evidence.

## 4. Facet semantics

### Participants

- Counts **active executed** participants only.
- Pending participant approvals display separately and never enter the
  denominator (pending ≠ executed).
- Zero active participants → facet `Empty` → overall `Incomplete`, never
  Ready. Copy stays truthful: "No participants assigned".

### Compliance (existing mission-gap semantics)

Computed with the exact `useMissionGaps` recipe: `computeGapsForPeople` +
participant-scoped credential/journey maps + mission span context +
mission-horizon urgency.

- Any Critical gap → `Blocked`.
- High/Medium gaps, no Critical → `AtRisk`.
- No gaps with all required sources trusted **and participants present** → `Clear`.
- Zero participants → `NoParticipants` ("no one to evaluate") — never Clear.
- Source failure → `Unknown`.
- Routing is folded in: `unroutedCount` surfaces gaps with no journey
  accountability. There is no separate journey facet.

### Kit (participant-aware denominator)

`Fulfilled` requires ALL of:

1. at least one active participant;
2. every active participant has ≥ 1 active kit assignment;
3. every active assignment is Delivered or Confirmed;
4. no active assignment is Missing.

Facet outcomes: `Unknown | NotRecorded | InProgress | Exception | Fulfilled`.
A participant with zero active assignments is **uncovered** and prevents
Fulfilled (surfaced via `uncoveredParticipants`). `Missing` produces
`Exception` and prevents Ready. Until an explicit kit-not-applicable model
exists, every active participant is assumed to require at least one active
assignment.

## 5. Overall precedence (Evaluated missions only)

```
Blocked > AtRisk > Incomplete > Ready
```

Facet contributions:

| Condition | Contribution |
|---|---|
| Critical compliance gap | Blocked |
| High/Medium compliance gaps | AtRisk |
| Kit Exception (Missing item) | AtRisk — never Ready |
| Zero participants | Incomplete |
| Uncovered participant / kit NotRecorded / InProgress | Incomplete |
| All evaluated blocking facets satisfied | Ready |

**Design decision (recorded):** a Missing kit item maps to AtRisk, not
Blocked — a missing physical item is a serious operational exception but does
not categorically block a mission the way an unsatisfied credential does.
Either way it can never produce Ready.

Precedence is never applied to NotEvaluated, NotApplicable, or Unknown
missions (`overall` is null; `facets` are null for NotEvaluated/NotApplicable).

## 6. Architecture

- **Pure module:** `utils/missionReadiness.ts` — one batch pass over all
  missions; no React, no fetch; protocols injected
  (`[evaluateOnboardingObligations]` from the composition hook).
- **Mission-specific types:** `types/readiness.ts`. Deliberately not shared
  with `usePersonReadiness`/`ObligationEvaluation` — Phase 0 inspection found
  no compatible axis; no generic readiness abstraction is introduced.
- **Composition hook:** `hooks/useMissionReadiness.ts` — reuses ONLY existing
  query keys (all-participants, all-kit, credentials-all, journeys-all-active,
  pending approvals). Zero new network surface; every existing mutation's
  invalidation reaches the cockpit automatically.
- **Display:** `components/shared/ReadinessFacetStrip.tsx`, rendered on
  MissionWorkspace cards. `showPendingChanges=false` there — the S29B
  card-level pending badges already display the same approvals (including for
  pre-confirmation missions, where the strip shows no facets).
- **Frame-zero behaviour preserved:** the readiness hook is not part of
  MissionWorkspace's blocking `isLoading`; the strip carries its own loading
  affordance.

## 7. MissionReadinessGap work item (v1: zero-roster only)

Closes the proven blind spot: MissionDeparturePressure requires open gaps and
zero participants produce zero gaps, so a committed mission with no roster
previously generated no work item anywhere.

| Contract element | Value |
|---|---|
| Trigger condition | Status Confirmed or Active, inside the existing departure-pressure window (Active always; Confirmed ≤ 30 days), zero active participants |
| Never fires for | PostMission, Planning, FinancePending, Settled, Canceled |
| Facet discriminator | `'Participants'` (union designed to add `'Kit'` without renaming the type/category) |
| Deterministic ID | `mrg-{missionId}-participants` |
| Owner / source | `Operations` / `ProtocolDefault` (roster assembly is an Operations function) |
| Title | `{Mission.Name} has no participants assigned` |
| Action label | "Assign Participants" |
| Severity | ≤ 7 days to departure → Immediate; else High (same shape as MDP) |
| Due date / urgency source | `Mission.Span.StartDate` |
| Navigation | Missions workspace (where "+ Add participant" lives) — not the Situation Room |
| Disappearance | Any participant executed onto the roster; mission leaves Confirmed/Active; Confirmed StartDate passes (drops out of window) |
| Deduplication | Deterministic ID; one item per mission per facet; **mutually exclusive with MissionDeparturePressure by construction** (MDP needs gaps → needs participants; this needs zero participants) |

## 8. Deferred to v1.1+ (owner decisions)

- Apparel facet (requires a batch `listAllApparelProfiles` service read —
  none exists today; informational-only per the locked S28 rule that a missing
  profile is never a readiness failure).
- Kit facet work-item trigger (type already extends).
- Explicit kit-not-applicable marker (schema change).
- Milestones/finance facets (mock-only domains; SP services are graceful
  stubs).
- Overall percentage (revisit only when facet denominators are homogeneous).
- Per-participant readiness chips (S27 deferral stands).
