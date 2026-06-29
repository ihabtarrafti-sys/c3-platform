# C3 Operator Validation — Sprint 8 Observations

**Phase:** Pre-Sprint 9 Pressure Test  
**Date:** 2026-06-28  
**Environment:** Mock data (in-memory)  
**Method:** Live operator walkthrough, 10 scenarios  

Observations recorded as they arise. No solutions proposed during the exercise. Every friction point, hesitation, context switch, or external tool reach is a signal.

---

## Recording Format

Each observation uses one of these markers:

- ✅ **Holds** — C3 answered the operational question clearly
- ⚠️ **Friction** — C3 answered but the path was harder than it should be
- ❌ **Gap** — C3 did not answer the question; operator had to act outside the platform
- 💡 **Signal** — A hypothesis or pattern worth tracking across scenarios

---

## Scenario 1 — New Player, Missing Travel Authorization

*Is this new signing ready to travel to the next event?*

### Observations

✅ **Situation Room as instinctive entry point.** First instinct was not to search for a person but to look for operational risk. The Situation Room was the right place to start. PER-0002's gaps and blocking reasons were immediately legible. Triage worked.

✅ **Readiness → Resolve is a strong flow.** Once in Person Profile, the obligation structure was clear and the capability-driven credential panel required no domain knowledge. Operator thought "I need to satisfy Right to Work" — not "I need to find the correct document type." The capability abstraction did its job.

⚠️ **Gap rows are not clickable — operator remembered, then adapted.** Natural first action was to click the gap row in Situation Room. Nothing happened. The constraint was intentional (Sprint 8 decision), but the desire to drill from gap → person was instinctive and immediate. Navigation required a detour through People workspace.

❌ **"Travel for what?" — Mission context is absent.** The gap showed a Travel Authorization obligation but carried no information about the operational commitment behind it. The operator's mind went immediately to the question the platform couldn't answer: is this for EWC, BLAST, a bootcamp, a visa appointment? That context does not exist in the model. The reach was toward a calendar or WhatsApp — not to fill a form gap, but to understand *why* the gap mattered right now.

💡 **Signal — The first missing piece wasn't a document. It was a Mission.** The obligation is correctly identified. The credential type is correctly surfaced. But the urgency of the gap is disconnected from the operational commitment that creates it. Without Mission context, every gap looks equally urgent regardless of whether the event is in 14 days or 6 months. This is the "Travel for what?" problem.

---

## Scenario 2 — Valid Identity, No Right-to-Work

*This player has a passport. Why can't they start working?*

### Observations

✅ **Identity → Satisfied after Passport registration is immediately legible.** No ambiguity. The operator understood which obligation the Passport solved without needing to reason about it.

✅ **"Right to Work" reads as a capability, not a document.** The label did not trigger a specific document name. The operator did not think "Emirates ID" or "UAE document." The capability abstraction held.

✅ **Resolve panel correctly narrows the decision space.** Recommended credential types removed the need for the operator to recall every valid document. The platform made the decision surface smaller, not larger. This is one of the strongest UX patterns in the product.

⚠️ **Obligation says what is missing. Not why it is required.** "Right to Work" is understood as a concept, but the platform does not explain the operational reason the requirement exists for this person right now. Is it because of a jurisdiction? Because of their contract type? Because of a specific event? The operator already knew this was an employment onboarding context — but that knowledge came from outside C3, not from C3 itself.

💡 **Signal — Same pattern as Scenario 1, different angle.** Scenario 1: "Travel for what?" Scenario 2: "Right to Work for what operational reason?" Both are asking the same underlying question. The platform computes what is missing. It does not yet explain why the obligation applies. The "why" — the operational commitment, jurisdiction, or mission context — lives outside the model in both cases.

---

## Scenario 3 — Expiring Visa, Active Journey

*Someone flagged this player's visa expiry. Is anyone already on it?*

### Observations

✅ **Situation Room surfaces the risk legibly.** PER-0001's Travel AtRisk gap was immediately understandable — the blocking reason (visa expiring soon) was readable without any navigation.

❌ **Ownership not visible from Situation Room.** The immediate follow-on question was "is somebody already handling this?" — and that answer was not available without navigating away. The gap row shows that a journey exists (the indicator icon) but not who holds it.

⚠️ **Journey existence ≠ Journey coverage.** Navigating to Person Profile and finding an active Onboarding Journey assigned to someone only partially answered the question. The real question — does this Onboarding Journey *own* this specific visa renewal work, or does it simply happen to exist? — the platform cannot answer. An active Journey and an active Gap coexist with no declared relationship between them.

❌ **No path to initiate a Visa Renewal Journey.** The operator's instinct was "this probably needs a dedicated Visa Renewal Journey" — not because Onboarding is wrong, but because renewal is a distinct operational commitment with its own owner, timeline, and completion criteria. No such journey type exists in the current UI.

💡 **Architectural discovery — Journey Type becomes operationally significant.** A Journey should explicitly declare which obligations it owns. Without that declared coverage relationship, the platform cannot confidently tell an operator whether an active Journey is addressing an active Gap, or whether the two simply coexist. This is not a missing button. It is a gap in the data model.

💡 **Signal — "Journey ownership does not imply obligation coverage."** This is the third consecutive scenario where the platform correctly identifies a problem but cannot tell the operator whether the problem is already owned. Scenario 1: is this covered? Scenario 2: is there a reason? Scenario 3: does this Journey actually address this Gap? Same structural hole from three angles.

---

## Scenario 4 — Multiple Gaps, Different Suggested Owners

*This person has three open obligations. Who is responsible for each one?*

### Observations

✅ **Three Unsatisfied obligations read naturally.** The Readiness tab correctly presented what must become true. Identity, RightToWork, Travel — the model is right.

💡 **Architectural discovery — The operator's mental model immediately became parallel work streams.** Identity involves the player or HR. RightToWork involves Operations. Travel involves the PRO/Visa Officer. The moment the operator read three obligations, they stopped thinking about one person's readiness and started thinking about multiple concurrent accountability threads.

💡 **Architectural discovery — One Journey per Person is correct as history, but insufficient as coordination.** Three separate Journeys fragments the person's operational record. One Journey with a single owner cannot express that different people own different parts of the work. This is not a UI problem — it is a model gap.

💡 **Architectural discovery — Two-level ownership model.** The operator arrived at this independently: a Journey has an overall accountable owner (responsible for the person being ready); individual obligations have operational owners (responsible for satisfying specific requirements). These are different accountability relationships. One is governance; the other is execution.

❌ **`defaultOwner` is computed but invisible.** The operator's instinct was to see "Identity → Suggested Owner: Player / HR · RightToWork → Suggested Owner: Operations · Travel → Suggested Owner: PRO Team" directly in the Readiness panel. This information exists in the protocol. It is not rendered anywhere. The coordination hint the platform could provide is currently silent.

❌ **Multi-owner coordination immediately escapes to WhatsApp.** The moment two different people become responsible for different obligations, there is no surface inside C3 to record, route, or track that. The operator reached for messaging not because they needed data, but because they needed collaboration — and C3 has no collaboration layer.

💡 **Signal — Journey as umbrella, obligations as assignable work items.** The operator's proposed model: Journey remains the single operational history for a Person; individual obligations become assignable beneath it. This preserves historical coherence while distributing execution responsibility. This is not a task or ticket system — it is accountability at the obligation level.

💡 **Signal — Scenarios 3 and 4 converge on the same missing layer.** Scenario 3: "Does this Journey actually cover this Gap?" Scenario 4: "Who owns each specific obligation?" Both resolve if obligations can declare coverage and ownership. A Journey that owns obligations explicitly, with per-obligation assignees, answers both questions simultaneously.

---

## Scenario 5 — Post-Onboarding Credential Risk

*This player was fully onboarded. Why are they showing up in Situation Room now?*

### Observations

✅ **Situation Room correctly detects operational decay.** A previously onboarded player appearing back in the gap list because their visa is expiring is exactly the surveillance function the platform should perform. This works.

✅ **Readiness explains the decay clearly.** Travel obligation AtRisk, statusReason tied to the expiry date, days remaining visible. The platform's reasoning remains strong after onboarding.

⚠️ **The active Onboarding Journey no longer fits the problem.** The player is not being onboarded. They are maintaining operational readiness. An "active" Onboarding Journey that was started during initial setup is not the correct operational container for renewal work. Its continued presence feels like an artefact, not a signal.

❌ **No distinct operational response for maintenance.** After correctly identifying the renewal problem, C3 offers nothing. The only journey initiation path is still onboarding. The platform detects the problem, accepts the credential registration at the end, but has no support for steps 1–4 of the real-world response: notify the PRO, initiate renewal, track it, receive outcome.

❌ **Credential history is absent.** The operator immediately wanted to know: when was this visa issued? Has it been renewed before? How many renewals has this player had? Is renewal already in progress? The credential record shows today's state. It does not surface the operational story of that credential over time.

💡 **Architectural discovery — Journeys are episodic, not permanent.** This is a foundational principle the operator arrived at independently: the Person is permanent, readiness is continuously computed, but Journeys come and go as discrete operational commitments arise throughout a person's lifecycle. Onboarding. Visa Renewal. Contract Renewal. Team Transfer. Offboarding. Each one temporarily restores or changes operational readiness. Journeys are not the container for a person's history — they are episodes within it.

💡 **Signal — Three missing layers now visible across five scenarios.** Scenarios 1–2: Mission context ("for what?"). Scenarios 3–4: Obligation ownership ("is this covered, and by whom?"). Scenario 5: Journey episodicity ("what is the correct operational response now?"). These are three distinct architectural gaps, not one. They are additive, not the same problem from different angles.

---

## Scenario 6 — Covered vs. Uncovered Gap Scan

*Looking at the full organisation, which gaps are owned and which aren't?*

### Observations

⚠️ **The covered/uncovered model did not hold — not because it broke, but because the operator's interpretation changed.** Before running this scenario, the expected read was PER-0001 → Covered, PER-0002 → Uncovered. After Scenarios 3–5, the operator no longer reads "Journey exists" as "Covered."

💡 **Architectural refinement — Three-state ownership model.** The operator independently derived a more precise vocabulary than the current binary:

- **Unrouted** — No Journey exists. Clearly unowned. C3 can express this today.
- **Routed** — A Journey exists, but coverage is not explicitly declared. Ownership unknown. C3 currently treats this as "Covered."
- **Covered** — A Journey explicitly declares responsibility for this obligation. Truly owned. C3 cannot express this yet.

The platform currently conflates Routed with Covered. An operator who has used the platform for more than one session will stop trusting that conflation.

✅ **Gap detection remains trustworthy.** The Situation Room's core function — surface operational gaps ranked by urgency — is not undermined by the ownership ambiguity. The gaps themselves are correct. What degrades is the operator's ability to act confidently on the ownership signal.

💡 **Signal — "The gaps are trustworthy. The ownership signal needs one more layer."** This is the cleanest summary of the Sprint 8 validation finding. The platform has a strong foundation. The missing layer is not more gaps — it is the ability to say which gaps are genuinely owned vs. merely associated with an existing Journey.

---

## Scenario 7 — Credential Added from Readiness: Effect on Situation Room

*I just registered a credential. Is the gap closed platform-wide?*

### Observations

✅ **The feedback loop is one of the strongest parts of the platform.** Resolve obligation → register credential → Readiness updates → Situation Room reflects the change. The operator never had to trigger recalculation manually, never wondered whether the platform had "caught up." The operational state recomputed itself.

✅ **It felt like one continuous system.** Not multiple disconnected screens. The platform's core thesis — documents are evidence, evidence changes, readiness is recomputed, nothing is manually updated — is now believable as a lived experience, not just an architectural principle.

---

## Scenario 8 — Refresh and Reset Behaviour

*What happens if I accidentally refresh the page?*

### Observations

✅ **Mock mode behaved exactly as expected technically.** After refresh, everything reverted to the seeded state.

⚠️ **Mock mode is not communicated to operators.** The issue is not functionality — it is communication. An operator who didn't already know they were in mock mode would experience a refresh as silent data loss. No visible indicator warns that changes are temporary, persistence is absent, or the session is in-memory. For developers this is obvious. For operators it isn't. A small environment banner would eliminate the confusion entirely. Product polish, not architectural work.

---

## Scenario 9 — What Still Escapes the Platform

*After running all scenarios: what did you still reach for outside C3?*

### External tool reaches recorded during walkthrough

| Scenario | Tool reached for | Why | Type |
|---|---|---|---|
| 1, 3, 4 | WhatsApp / Teams | Notify PRO / Visa Officer of gap — C3 identifies the problem but doesn't route accountability | Routing gap |
| 1, 2, 3, 5 | Tournament spreadsheet | Which tournament? What's the deadline? Which country? Which budget code? Mission context is absent | Context gap |
| 3, 5 | Email / external authorities | Once renewal is decided, the operational work (embassy, government portal, HR) leaves the platform entirely | Communication gap |
| 3, 5 | Personal notes (minimal) | Journey progress notes — waiting on embassy, player travelling tomorrow, passport collected | History gap |
| 3, 4, 5 | Memory | Who owns this? Which Visa Officer? What's the right next action? Uncertainty about next response, not about what's wrong | Authority gap |

### Escape type summary

**Routing gap (highest frequency):** Delegation. C3 identifies who has a problem but cannot name who should fix it. Every accountability handoff escapes to messaging. This is not an information gap — the operator already knows what's wrong. It is a delegation gap.

**Context gap (highest impact):** Mission. The spreadsheet is reached not to understand credentials but to understand operational deadlines — which tournament, which jurisdiction, which date matters. Every "Travel for what?" reach is this gap.

**Communication gap:** Once C3 names the problem and the operator decides on the response, the execution work leaves the platform. Embassy contacts, visa applications, HR processes — all external. C3 detects and closes the loop (credential registration) but has no surface for the middle.

**History gap (low, but growing):** Credential history doesn't exist yet. Journey progress notes escape. As renewals accumulate, the gap between "what exists today" and "the operational story of how we got here" will widen.

**Authority gap (medium):** Uncertainty about next operational response. The platform computes the truth confidently. The hesitation appears around Mission context, ownership, coverage, and renewal workflows — consistently, across scenarios.

---

## Scenario 10 — Operating at Scale

*Three days before a major event — can an Operations Manager comfortably operate from the Situation Room?*

### Cognitive load questions

| Question | Answer |
|---|---|
| Can you read all critical gaps in under 60 seconds? | Yes — gaps identified quickly. Cannot determine whether they require action *today* without navigating away. |
| Does urgency remain the primary organiser, or does something else emerge? | Urgency first fails at scale. Operational thinking naturally organises as Mission → Team → Person → Obligation. |
| First thing the Situation Room doesn't tell you | Mission / Event context. Which commitment is this gap blocking? What is the real deadline? |
| First action C3 doesn't support | Consolidated owner message — "send one instruction to the Visa Officer covering all 6 players they own." |
| First moment you'd open a different tool — and which one | Excel — financial planning. WhatsApp — delegation. But C3 is now opened *first* to establish operational truth. |
| Is the Situation Room a triage surface or a reference list? | Triage surface. But triage is incomplete without Mission deadline and ownership state. |

### Observations

✅ **C3 is now opened first.** This is the most significant finding of the entire pressure test. At the start of the project, the first tool opened was Excel. After Sprint 8, the operator's genuine instinct is to open C3 first to establish operational truth before doing anything else. Excel becomes financial planning. WhatsApp becomes delegation. C3 is now the operational source of truth.

⚠️ **Urgency-first sorting does not scale.** At 30+ gaps, Urgency → Person ID does not match how operational work is actually organised. The natural mental order is Mission → Team → Person → Obligation. This grouping dimension doesn't exist in the current layout.

❌ **Mission deadline is absent from urgency calculation.** "Critical, no journey, 3 days to event" and "Critical, no journey, 45 days to event" are indistinguishable in the current model. Mission context is not merely a display enhancement — it is a missing input to the urgency computation itself.

❌ **Ownership lives in the operator's memory, not the platform.** Identifying all players assigned to the same Visa Officer — to send one coordinated message — cannot be done from C3. That reconstruction happens in the operator's head and is executed in WhatsApp. At scale, this is where coordination breaks down.

💡 **Signal — "The biggest friction is no longer missing CRUD screens."** Every remaining limitation now comes from missing operational concepts: Mission, Ownership, Coverage, Episodic Journeys. Everything else is an implementation of those four concepts. The platform has crossed the threshold from "can it compute operational state?" to "does it compute the right operational meaning?" That is a categorically different class of problem.

---

## Pattern Summary

### Consistent friction points

**Navigation** — Gap rows are not clickable. Every scenario required a detour through People workspace to reach the Person the operator was already looking at in Situation Room. Appeared in Scenarios 1, 3, 4, 5, 6. High frequency, low severity.

**Ownership visibility** — Who owns a gap, is it covered, and who to notify. Appeared in Scenarios 3, 4, 6, 9, 10. The dominant friction pattern of the entire test.

**Missing operational response** — The platform identifies the problem but offers no matching action path. Most acute in Scenario 5 (visa renewal has no journey type). Appeared in Scenarios 3, 5, 9.

### Consistent gaps

**Mission context** — "For what? By when? In which jurisdiction?" Appeared in Scenarios 1, 2, 9, 10. Every routing gap eventually resolves to a missing Mission deadline.

**Obligation ownership / Coverage state** — The three-state model (Unrouted / Routed / Covered) does not exist. The platform conflates Routed with Covered. Appeared in Scenarios 3, 4, 6.

**Episodic Journey model** — Journeys are currently typed by trigger (Onboarding) rather than purpose (resolve specific obligations). An expired visa during a live employment is not an onboarding problem. Appeared in Scenarios 3, 5.

### Signals that appeared in multiple scenarios

- **"Journey exists ≠ obligation covered"** — Scenarios 3, 4, 6
- **"The operational context is outside the platform"** — Scenarios 1, 2, 9, 10
- **"The gaps are trustworthy. The ownership signal isn't yet."** — Scenarios 3, 4, 6, 10
- **"Delegation escapes to WhatsApp"** — Scenarios 3, 4, 9, 10
- **"C3 is now opened first"** — Scenario 10 (the positive signal)

---

## Sprint 9 Brief — Draft

### The operational question Sprint 9 should answer

*"Is this gap owned — and by whom?"*

### Evidence

Every scenario in which the operator hesitated or reached for an external tool traced back to the same structural absence: the platform can surface a gap but cannot say whether it is genuinely owned, who owns it, or whether an existing Journey is actually covering it.

The journey indicator on a gap row signals "a Journey exists." The operator learned — across Scenarios 3, 4, and 6 — that this signal is insufficient. A Journey may be dormant, misscoped, or completely unrelated to the specific obligation it appears alongside. The conflation of Routed with Covered is the most operationally consequential gap in the current model.

Resolving this does not require Mission. It does not require new journey types. It requires making obligation ownership explicit — a capability the architecture already partially supports (`defaultOwner` is computed by the protocol but never rendered) and that the operator independently described as exactly what they needed.

### The smallest Sprint 9 that meaningfully advances the platform

**Sprint 9 — Obligation Ownership**

Five implementable items, fully within the existing architecture:

**S9-1: Surface `defaultOwner` per obligation in ReadinessPanel.** The protocol already computes suggested ownership. Render it. "Identity → Suggested: HR · RightToWork → Suggested: Operations · Travel → Suggested: PRO Team." No model change — display change only.

**S9-2: Add per-obligation assignment to Journey.** `Journey.obligationAssignments: { obligationType: ObligationType, assignedTo: string }[]`. When a Journey is initiated, the operator can assign individual obligations to different owners. Journey retains its single umbrella accountable owner. Obligations gain execution owners beneath it. This is the architectural realisation of the two-level ownership model the operator described in Scenario 4.

**S9-3: Render Unrouted / Routed / Covered on gap rows.** Replace the binary journey-indicator icon with the three-state model the operator independently derived in Scenario 6. Unrouted: no Journey. Routed: Journey exists, obligation not explicitly assigned. Covered: Journey exists, this obligation has a declared assignee. This is the single change that makes the Situation Room's ownership signal operationally reliable.

**S9-4: Gap row click-through → Person Profile.** The most consistent navigation friction across the entire test. Every scenario required a detour. This is a one-sprint navigation fix that every future scenario will benefit from.

**S9-5: Mock mode environment banner.** A small persistent UI indicator that the session is running in-memory and changes will not survive a refresh. Low effort. Eliminates silent data loss confusion for any non-developer user.

### What this Sprint does not include

- Mission entity or UI (Discovery Checklist gates this — no confirmed answers yet)
- Visa Renewal journey type (deferred — obligation ownership first makes clear *which* journey is needed even without creating one)
- Credential history / renewal chain (deferred)
- Multi-grouping in Situation Room by Mission or owner (deferred — requires Mission data)
- SharePoint data layer (blocked — IT access pending)

### Why this is the right Sprint 9

Obligation ownership is the load-bearing missing piece across six of ten scenarios. It is entirely within the existing architecture. It does not depend on Mission data, external discovery, or IT access. It transforms the Situation Room from a scan surface into a coordination surface. And it validates the three-state ownership model before Mission context arrives — so when Mission does land, the ownership layer is already in place to receive it.

---

*C3 Platform · Operator Validation · 2026-06-28*
