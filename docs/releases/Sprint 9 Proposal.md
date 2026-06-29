# Sprint 9 Proposal — Operational Gap Ownership

**Status:** Proposed  
**Date:** 2026-06-28  
**Preceded by:** Sprint 8 — Situation Room  
**Evidence:** C3 Operator Pressure Test — Sprint 8 Observations (10 scenarios)  
**Approved by:** Ihab Tarrafti

---

## The Operational Question

> "Who owns this operational problem?"

This question appeared in some form in six of ten pressure test scenarios. It was never answered by the platform. Every answer came from the operator's memory or from an external tool.

Sprint 9 exists to make that question answerable — from the Situation Room, without navigation.

---

## What the Pressure Test Proved

The platform crossed an important threshold during Sprint 8. The operator's first instinct before any planning work is now to open C3 rather than Excel. The reactive computation loop is trusted. The operational gaps are correct.

What the pressure test then consistently exposed was a transition the platform cannot yet make:

> From: "I know there is a problem."  
> To: "I know who owns solving it."

Every external reach — WhatsApp, Teams, email, spreadsheet — traced back to this gap. Not because C3 lacked information about what was wrong. But because it offered no way to route accountability for fixing it.

The three most important discoveries:

**Discovery 1 — Journey existence does not imply obligation coverage.** A Journey and a Gap can coexist in the platform with no declared relationship between them. An operator who knows this stops trusting the journey indicator within one session.

**Discovery 2 — Coverage needs three states, not two.** The operator independently derived: Unrouted (no Journey), Routed (Journey exists, coverage unknown), Covered (Journey explicitly owns this obligation). The platform currently conflates Routed with Covered. That conflation makes the ownership signal unreliable.

**Discovery 3 — Gap rows should be operational objects, not informational display.** Today, clicking a gap row opens a person. By the end of Sprint 9, opening a gap row should open an operational problem — with its own owner, its own coverage state, its own resolution path. That distinction determines whether the Situation Room is a monitoring surface or a coordination surface.

---

## The Architectural Principle

Sprint 9 extends the model in one direction:

> Obligations should be declarable as owned. Coverage should be explicit, not inferred.

This requires a small model extension and a significant display change. The architecture already partially supports it — `defaultOwner` is computed by every protocol evaluation and stored on every `ObligationEvaluation`. It has never been rendered. Sprint 9 surfaces it, and adds the ability for an operator to confirm or override it at Journey initiation.

This does not require Mission data. It does not require SharePoint. It does not require new credential types. It is entirely within the current architecture, fully implementable against mock data.

---

## Success Criterion

A single criterion defines whether Sprint 9 has succeeded:

**By the end of Sprint 9, an operator can answer "Who owns this operational problem?" from the Situation Room — without navigating to any other screen.**

If that answer is visible, confident, and accurate from the gap row alone, Sprint 9 is complete.

Everything beyond that is refinement.

---

## Deliverables

### S9-1 — Surface `defaultOwner` in ReadinessPanel

**What:** Render the suggested operational owner beneath each obligation row in ReadinessPanel.

**Why:** The protocol already computes `defaultOwner` for every obligation. "Identity → HR. RightToWork → Operations. Travel → PRO Team." This information is invisible today. In Scenario 4, the operator immediately wanted to see exactly this — not to blindly follow it, but to have the platform coordinate the conversation instead of leaving it to memory.

**Scope:**
- ReadinessPanel: add a muted "Suggested: [owner]" label beneath each obligation row
- Uses `ObligationEvaluation.defaultOwner` — no model change required
- Rendered for Unsatisfied and AtRisk obligations; omitted for Satisfied

**Design note:** This is a suggestion, not an assignment. The operator confirms or overrides at Journey initiation (S9-2). Displaying it here primes the coordination before the Journey is even started.

---

### S9-2 — Per-Obligation Assignment on Journey

**What:** Add `obligationAssignments` to the Journey model and surface assignment during Journey initiation.

**Why:** The operator described a two-level ownership model in Scenario 4: the Journey has an overall accountable owner (governance), while individual obligations have execution owners (delegation). Today only the first level exists. Sprint 9 adds the second.

**Model change:**
```typescript
// Addition to existing Journey interface
obligationAssignments?: ObligationAssignment[];

interface ObligationAssignment {
  obligationType: ObligationType;
  assignedTo: string;       // name or role
  assignedAt: string;       // ISO date
  notes?: string;
}
```

**Scope:**
- `StartJourneyPanel` extended: after AssignedTo (overall owner), show each open obligation with an optional "Assign to" field, pre-populated from `defaultOwner`
- The operator can accept suggestions, override them, or leave them blank (obligation remains Routed, not Covered)
- `useInitiateJourney` mutation updated to accept `obligationAssignments`
- Mock service updated accordingly

**Design note:** Assignment is optional per obligation. Not every obligation needs an explicit owner at journey start. An unassigned obligation within an active Journey is Routed. An assigned one is Covered. The operator decides which is which.

---

### S9-3 — Unrouted / Routed / Covered on Gap Rows

**What:** Replace the binary journey-indicator icon on `OperationalGapRow` with a three-state ownership badge.

**Why:** This is the single most operationally significant change in Sprint 9. In Scenario 6, the operator stopped trusting the journey indicator after five scenarios. The binary (journey / no journey) does not match operational reality. The three-state model the operator independently derived does.

**States:**
- **Unrouted** — No active Journey. Gap is clearly unowned. Rendered with a muted "Unrouted" badge. This is an action signal: someone needs to start a Journey.
- **Routed** — An active Journey exists for this person, but this obligation has no declared assignee within it. Someone is engaged with this person's readiness, but this specific problem may not be in scope. Rendered with an amber "Routed" badge.
- **Covered** — An active Journey exists and this obligation has an explicit `obligationAssignment` with an `assignedTo`. The gap is genuinely owned. Rendered with a green "Covered · [name]" badge.

**Computation:** `useOperationalGaps` extended to compute ownership state per gap:
```typescript
type OwnershipState =
  | { state: 'unrouted' }
  | { state: 'routed'; journeyId: string }
  | { state: 'covered'; journeyId: string; assignedTo: string };
```

**Impact on Situation Room:** The KPI strip gains meaning. Critical + Unrouted = needs a Journey started today. Critical + Routed = needs an assignment confirmed. Critical + Covered = monitor only. An operator can now triage the entire Situation Room without navigating to a single Person Profile.

---

### S9-4 — Gap Row Click-Through → Person Profile

**What:** Make `OperationalGapRow` clickable. Clicking a gap row navigates to the relevant Person Profile with the Readiness tab active.

**Why:** Every scenario in the pressure test required a navigation detour through the People workspace. This was the most consistent friction point across the entire test — appearing in Scenarios 1, 3, 4, 5, and 6.

**Scope:**
- `OperationalGapRow` receives an optional `onNavigate` callback
- `SituationRoom` passes a handler that calls the app navigator with `{ screen: 'person-profile', personId, tab: 'readiness' }`
- The nav system already supports deep-linking to tabs — this is wiring, not a new capability

**Design note:** The intention is not just navigation convenience. The framing matters. Clicking a gap row should feel like opening *this operational problem* — not opening *this person*. The Readiness tab opens directly, not the Profile tab. The gap is the entry point. The person is the context.

---

### S9-5 — Mock Mode Environment Banner

**What:** A persistent, non-intrusive banner visible on all screens when the platform is running in mock mode.

**Why:** Scenario 8 confirmed that data loss on refresh is silent. An operator who doesn't already know they're in mock mode experiences a refresh as the platform losing their work. This is a communication failure, not a technical one.

**Scope:**
- Small banner at the top of the shell (above NavRail, outside main content area)
- Text: "Running in demo mode · Changes are not persisted"
- Rendered only when `import.meta.env.MODE === 'development'` or when a `VITE_MOCK_MODE` flag is set
- Dismissible per session (localStorage flag)
- Disappears automatically when SharePoint data layer is wired

---

## What Sprint 9 Explicitly Excludes

**Mission** — The Mission Discovery Checklist has 23 open items. None are confirmed. Mission waits. The pressure test increased confidence in this sequencing — we now know precisely why Mission is needed and exactly what it will enable. That is a much better starting position than building it speculatively.

**Visa Renewal journey type** — Deferred. Obligation ownership (S9-2) makes it operationally clear when a renewal is needed and who should own it, without requiring a new journey type in the UI. The episodic Journey model is the right architectural foundation; the specific journey types follow from it.

**Credential history / renewal chain** — Deferred. Credential supersession is already in the type (`SupersedesCredentialID`). The UI surface for it follows credential lifecycle work in a later sprint.

**Situation Room grouping by Mission / owner** — Deferred. This requires Mission data. The three-state ownership badge (S9-3) partially addresses the grouping problem by making the ownership state scannable without regrouping.

**SharePoint data layer** — Blocked. IT access pending. Sprint 9 runs entirely against the mock service layer as before.

---

## What Sprint 9 Enables

**For Sprint 10 (Mission):** When Mission lands, the ownership layer is already in place. Mission-scoped gaps will slot into the Unrouted / Routed / Covered model immediately. The Covered state can extend to include Mission context: "Covered · PRO Team · RLCS WC." The model composes cleanly.

**For Sprint 10 (Episodic Journeys):** Per-obligation assignment (S9-2) establishes the pattern for declaring what a Journey covers. When Visa Renewal arrives as a distinct journey type, it already has a mechanism to declare which obligation it owns. The model is extensible rather than bolted-on.

**For the Situation Room's long-term role:** Sprint 8 made the Situation Room a monitoring surface. Sprint 9 makes it a coordination surface. Every sprint after this adds coordination capabilities rather than rebuilding the foundation.

---

## The Platform After Sprint 9

Before Sprint 9, an operator can say: "PER-0001 has a Travel gap expiring in 11 days."

After Sprint 9, an operator can say: "PER-0001 has a Travel gap expiring in 11 days. It is Covered — assigned to the PRO Team under the active Journey."

That is the transition from operational monitoring to operational coordination. Everything else is a refinement of that capability.

---

*C3 Platform · Sprint 9 Proposal · 2026-06-28*  
*Evidence: `docs/releases/C3 Operator Validation — Sprint 8 Observations.md`*  
*Scope governed by: `docs/releases/C3 Operator Pressure Test Plan.md`*
