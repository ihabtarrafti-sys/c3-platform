# C3 Operator Pressure Test Plan

**Version:** Sprint 8 Baseline  
**Date:** 2026-06-28  
**Environment:** Mock data (in-memory — mutations reset on page refresh)  
**Objective:** Use C3 like a real operator. Find where the model holds, where it feels awkward, and where operational work escapes the platform entirely. Every friction point is a candidate for Sprint 9.

---

## How to Use This Document

Run each scenario in sequence. After each one, record:

- Did C3 behave as expected?
- Was anything missing, unclear, or harder than it should be?
- Did you reach for an external tool (Slack, WhatsApp, spreadsheet, email) to complete the task?

Those observations — not theoretical feature priority — will define Sprint 9.

---

## Mock Data Reference

| Person ID | State | Detail |
|---|---|---|
| PER-0001 | AtRisk | Visa (Travel) expires in ~11 days. Onboarding journey active. |
| PER-0002 | Unsatisfied | No Travel Authorization, no RightToWork credential. No active journey. |
| PER-0003 | Satisfied | All Onboarding obligations met. |
| PER-0004 | No journey | Person exists but Onboarding journey has not been started. |

---

## Scenario 1 — New Player, Missing Travel Authorization

**Operational question:** *Is this new signing ready to travel to the next event?*

**Starting state:** PER-0002. Credentials tab is empty. No journey. Situation Room shows Critical gap for Travel Authorization and RightToWork.

**What the operator should do:**
1. Open Situation Room. Identify PER-0002 as Critical.
2. Navigate to PER-0002 → Person Profile.
3. Start an Onboarding Journey (Readiness tab → Start Journey).
4. Register a Work Permit credential (Readiness → Resolve RightToWork obligation).
5. Register a Visa credential (Readiness → Resolve Travel obligation).
6. Return to Situation Room. Verify PER-0002 gaps have closed.

**What C3 should show:**
- Before: Two Critical gaps for PER-0002 (Unsatisfied + no journey).
- After step 3: Both gaps shift from Critical → High (Unsatisfied + active journey).
- After steps 4–5: Gaps close entirely; PER-0002 disappears from Situation Room.

**Friction to watch for:**
- Is the path from Situation Room → Person Profile obvious? (Gap rows are not yet clickable.)
- After registering credentials, does the operator know to re-check Situation Room, or does the loop feel incomplete?
- Is the journey status visible from the Situation Room row? Can the operator tell whether someone has already started working on this?

**Model verdict:** Partially handles. The urgency pipeline and resolution loop work. **Navigation is the gap** — the operator must manually find PER-0002 rather than clicking through from the gap row.

---

## Scenario 2 — Valid Identity, No Right-to-Work

**Operational question:** *This player has a passport. Why can't they start working?*

**Starting state:** PER-0002 (or manually simulate: register a Passport for PER-0002 but not a Work Permit).

**What the operator should do:**
1. Register a Passport for PER-0002 (Credentials tab → Add Credential, type: Passport).
2. Navigate to Readiness tab.
3. Observe that Identity is now Satisfied but RightToWork remains Unsatisfied.
4. Resolve RightToWork by registering a Work Permit.

**What C3 should show:**
- After Passport registration: Identity obligation → Satisfied. RightToWork → still Unsatisfied.
- The Readiness panel should make it clear *which* obligations remain open and *why*.
- Situation Room: Identity gap should close; RightToWork gap should remain.

**Friction to watch for:**
- Does the obligation label "Right to Work" map clearly to the credential the operator needs to obtain? Or does the operator need to already know that a Work Permit satisfies it?
- Is the `statusReason` string informative enough? ("No active credential satisfying RightToWork" versus "Work Permit or Labour Card required.")
- Does the credential type grouping in AddCredentialPanel make the right answer obvious?

**Model verdict:** Handles. This is the core capability loop. **Label clarity is the likely friction point** — whether the obligation requirement text guides the operator toward the right credential type without domain knowledge.

---

## Scenario 3 — Expiring Visa, Journey Already Active

**Operational question:** *Someone flagged this player's visa expiry. Is anyone already on it?*

**Starting state:** PER-0001. Visa expires in ~11 days. Onboarding journey is active (assigned to someone).

**What the operator should do:**
1. Open Situation Room. Observe PER-0001 at High urgency (AtRisk ≤ 30 days, journey active).
2. Navigate to PER-0001 → Person Profile → Journeys tab.
3. Verify journey is active and assigned.
4. Note the visa expiry date from the Credentials tab.
5. Decide: does this require a new Visa Renewal journey, or is the Onboarding journey covering it?

**What C3 should show:**
- Situation Room: PER-0001 at High (not Critical — journey exists, operator isn't flying blind).
- Journey indicator on the gap row confirms someone is already working on this.
- Credentials tab: Visa record with expiry date visible.
- Journeys tab: Onboarding journey with AssignedTo field populated.

**Friction to watch for:**
- The gap row shows a journey indicator, but does it tell the operator *who* the journey is assigned to? Or do they have to navigate to Person Profile to find out?
- Is the distinction between "Onboarding journey covering this" and "dedicated Visa Renewal journey needed" surfaced anywhere? Or must the operator reason about it manually?
- What does the operator do next? There is no Visa Renewal journey type surfaced in the UI. Is that a missing protocol or a missing journey initiation path?

**Model verdict:** Partially handles. Urgency tier correctly distinguishes covered vs. uncovered gaps. **Assignment visibility and journey-type routing are the gaps** — the operator can see *that* someone is working on it but not *who*, and cannot initiate a VisaRenewal journey from this context.

---

## Scenario 4 — Multiple Gaps, Different Suggested Owners

**Operational question:** *This person has three open obligations. Who is responsible for each one?*

**Starting state:** PER-0002 with no credentials registered. Three Unsatisfied obligations: Identity (HR), RightToWork (Visa Officer), Travel (Visa Officer or Team Manager).

**What the operator should do:**
1. Open PER-0002 Readiness tab.
2. Read each obligation and its suggested owner (defaultOwner field).
3. Determine whether to assign all obligations to one journey or split them across roles.
4. Initiate journey(s) accordingly.

**What C3 should show:**
- ReadinessPanel: three obligations, each with a requirement label and statusReason.
- Each obligation should ideally show a `defaultOwner` hint so the operator knows who should own resolution.
- StartJourneyPanel: AssignedTo field for routing accountability.

**Friction to watch for:**
- Does the Readiness panel currently surface `defaultOwner` per obligation? (It does not — this field exists in the type but is not rendered.)
- With three open obligations suggesting two different owners, how does the operator decide whether to create one journey or two?
- If two people need to act (HR and Visa Officer), where is that coordination recorded? Inside C3, or in WhatsApp?

**Model verdict:** **Gap exposed.** `defaultOwner` is computed by the protocol but never rendered. Multiple-owner scenarios have no routing surface. This coordination currently escapes to external tools.

---

## Scenario 5 — Completed Onboarding, Later Credential Risk

**Operational question:** *This player was fully onboarded. Why are they showing up in Situation Room now?*

**Starting state:** PER-0001. Onboarding journey is active. Visa expires in ~11 days, placing them in Situation Room at High.

**What the operator should do:**
1. Open PER-0001 Situation Room gap. See: AtRisk (Travel), 11 days remaining.
2. Navigate to Person Profile → Credentials.
3. Identify the expiring Visa.
4. Understand: onboarding completed, but the visa has since moved into the risk window.
5. Determine next action: renew the visa (but no Visa Renewal journey type exists in current UI).

**What C3 should show:**
- Situation Room: AtRisk gap with days remaining.
- Credentials tab: Visa with expiry date and IsActive status.
- Readiness tab: Travel obligation showing AtRisk with statusReason "Visa expires in 11 days."
- Journey tab: Onboarding journey — but this is a *renewal* problem, not an onboarding problem.

**Friction to watch for:**
- The operator can see the problem but cannot take action. There is no "Start Visa Renewal Journey" path — only "Start Onboarding Journey."
- Is the distinction between obligation types and journey types clear to the operator? Or does it feel like C3 has identified a problem without providing a resolution path?
- Does the credential history (IsActive, SupersedesCredentialID) give the operator enough context to understand the renewal chain?

**Model verdict:** **Gap exposed.** The Onboarding protocol correctly identifies credential risk after onboarding. But the only journey available is Onboarding — there is no VisaRenewal protocol or journey type wired to the UI. The platform surfaces the problem without providing the resolution path.

---

## Scenario 6 — Situation Room: Covered vs. Uncovered Gaps

**Operational question:** *Looking at the full organisation, which gaps are owned and which aren't?*

**Starting state:** Default mock data — PER-0001 (AtRisk + active journey = High), PER-0002 (Unsatisfied + no journey = Critical).

**What the operator should do:**
1. Open Situation Room.
2. Read the KPI strip: Critical count vs. High count.
3. Scan the gap list. Identify which rows have the journey indicator (covered) and which do not (uncovered).
4. Use this to triage: which persons need a journey started today?

**What C3 should show:**
- KPI strip: Critical = 2 (PER-0002's two uncovered Unsatisfied gaps), High = 1 (PER-0001's expiring visa with active journey).
- PER-0002 rows: no journey indicator → these are uncovered.
- PER-0001 row: journey indicator present → someone is on it.
- Clear visual distinction between the two states.

**Friction to watch for:**
- Does the journey indicator icon communicate clearly that "someone is working on this"?
- Can the operator, from the Situation Room alone, determine *who* is assigned to a covered gap without navigating away?
- Is the absence of a journey indicator conspicuous enough to read as "this is unowned" rather than just a missing UI element?
- With only 3 persons in mock data, the scan is trivial. Would the same layout hold for 30 persons with 80 gaps?

**Model verdict:** Handles the covered/uncovered distinction visually. **Scale and assignee visibility are open questions** — the current layout has not been tested at realistic roster sizes.

---

## Scenario 7 — Credential Added from Readiness: Effect on Situation Room

**Operational question:** *I just registered a credential. Is the gap closed platform-wide?*

**Starting state:** PER-0002 showing Critical in Situation Room. No credentials.

**What the operator should do:**
1. From Situation Room, note PER-0002 Critical — 2 gaps.
2. Navigate to PER-0002 → Readiness tab.
3. Resolve "Right to Work" → register Work Permit.
4. Observe ReadinessPanel: RightToWork → Satisfied.
5. Navigate back to Situation Room.
6. Verify: PER-0002 RightToWork gap is gone. Travel gap remains.

**What C3 should show:**
- ReadinessPanel updates immediately after credential registration (TanStack Query invalidation).
- Situation Room: on next load, PER-0002 shows 1 gap (Travel) at Critical, 1 fewer than before.
- KPI strip counts update accordingly.

**Friction to watch for:**
- The operator must manually navigate back to Situation Room to see the effect. There is no notification or "return to Situation Room" affordance.
- Does the Situation Room feel like a live view, or a snapshot? The operator should understand it reflects current state on each load but does not update in real time while they are on another screen.
- Is the relationship between a credential registration on Person Profile and the Situation Room gap closing intuitive, or does it feel like two disconnected systems?

**Model verdict:** Handles technically. **Feedback loop and mental model are the friction** — the operator acts in Person Profile and must trust that the Situation Room will reflect it. There is no visible connection between the two.

---

## Scenario 8 — Refresh and Reset Behaviour (Mock Mode)

**Operational question:** *What happens if I accidentally refresh the page?*

**Starting state:** PER-0002 with credentials registered and journey started during the session.

**What the operator should do:**
1. Register two credentials for PER-0002 (Work Permit + Visa).
2. Start an Onboarding Journey for PER-0002.
3. Verify Situation Room: PER-0002 gaps closed.
4. Refresh the browser (F5 or Ctrl+R).
5. Return to Situation Room and PER-0002 Person Profile.

**What C3 should show:**
- After refresh: all in-session mutations are gone. PER-0002 reverts to Unsatisfied with no credentials, no journey. Situation Room shows Critical gaps again.
- This is expected and documented. The platform is in mock mode.

**Friction to watch for:**
- Is the mock mode clearly communicated in the UI? If an operator forgets they are in mock mode and acts on data, the data loss is silent.
- Is there a visible indicator anywhere that the current session's data is not persisted?
- Does the DeveloperDiagnostics screen surface mock mode status clearly enough?

**Model verdict:** Expected behaviour — documented in Known Limitations. **Communication of mock mode to operators is the question.** No current screen warns that data will not survive a refresh.

---

## Scenario 9 — What Still Escapes the Platform

**Operational question:** *After running all scenarios above, what did you still reach for outside C3?*

This is not a scenario to run in the UI. It is a reflection checklist after completing Scenarios 1–8.

**Prompts for the operator:**

After each scenario, ask:

- Did you need to tell anyone about this gap via WhatsApp or Slack?
- Did you need to check a spreadsheet to know which credential to obtain or who issues it?
- Did you open email to follow up with a visa officer, HR contact, or government authority?
- Did you write a note anywhere outside C3 to remember what needs to happen next?
- Did you feel uncertain about what "the system" expected you to do next?

**What to record:**

Each "yes" is a platform gap. Categorise by type:

| Type | Description | Example |
|---|---|---|
| **Routing gap** | C3 identified the problem but couldn't route it to the right person | "I had to WhatsApp the visa officer because C3 has no owner assignment on the gap" |
| **Context gap** | C3 showed a status but not enough context to act | "I had to check the spreadsheet to know what document a LabourCard is" |
| **Communication gap** | C3 can't record or trigger follow-up actions | "I sent a reminder email that C3 has no equivalent for" |
| **History gap** | The operator needed to know something that happened before this sprint | "I needed to know when the visa was last renewed" |
| **Authority gap** | C3 couldn't tell the operator who has authority to act | "I didn't know whether Visa Renewal is HR or Operations" |

---

## Scenario 10 — Operating at Scale

**Operational question:** *Three days before a major event — can an Operations Manager comfortably run the organisation from the Situation Room?*

This scenario is not executed in the UI. It is a mental simulation. Place yourself in the role of an Operations Manager with 30+ active players across multiple teams, many simultaneous journeys, and a hard deadline in 72 hours. Do not think about what the platform does. Think about what you need to know and whether you can know it fast enough.

**The conditions to imagine:**

- 30 people. Perhaps 20 have obligations evaluated by the Onboarding protocol.
- 8 are AtRisk (visa or permit expiring within 30 days).
- 3 are Unsatisfied with no journey in progress.
- 12 have active journeys at various stages.
- Some gaps belong to players travelling to different jurisdictions — different credentials apply.
- Some journeys are assigned. Some are not. Some were assigned but the assignee has since changed roles.
- Two players share the same visa officer. One is Critical, one is High.

**Questions to sit with:**

*Scanability* — Can you read the Situation Room gap list in under 60 seconds and know what requires your attention today versus this week? Or does reading each row require context you don't have on screen?

*Prioritisation* — Critical and High are the urgency tiers. Within Critical, is there a meaningful difference between "Unsatisfied, no journey, 3 days to event" and "Unsatisfied, no journey, 45 days to event"? Does the current model distinguish them?

*Grouping* — Gaps are currently sorted by tier, then person ID. At scale, would you rather see gaps grouped by event, by team, by assigned owner, or by jurisdiction? Does alphabetical person ID serve operational triage?

*Ownership visibility* — Across 30+ gaps, how many are unowned? The journey indicator tells you a journey exists, but not who is responsible. If you needed to send a single message to the Visa Officer covering 6 players, can C3 give you that list? Or do you reconstruct it from memory and a spreadsheet?

*Information density* — Each `OperationalGapRow` shows urgency, person ID, requirement, status reason, days remaining, and journey indicator. At 30+ rows, does that feel like enough to act, or too little to act without navigating away? What is missing from the row that would prevent you from navigating to Person Profile at all?

*Absence of information* — The Situation Room shows gaps. It does not show people with no gaps. If PER-0003 (fully Satisfied) is scheduled to travel and you want to confirm their credentials are valid for the specific destination jurisdiction, where do you look? The Situation Room is silent about people who are fine.

*Coordination surface* — Two players share a visa officer. Both have open gaps. Inside C3, there is no way to say "these two go to the same person." The operator mentally groups them, switches to WhatsApp, and coordinates externally. How often does that happen? How much of the pre-event coordination still lives in messaging apps rather than the platform?

**What to record:**

After the mental simulation, note:

- The first thing you would need to know that the Situation Room does not tell you.
- The first action you would take that C3 does not support.
- The moment at which you would open a different tool — and which tool, and why.

**Model verdict:** Unknown until simulated. This scenario exists specifically to expose whether the current Situation Room layout is a triage tool or a reference tool, and whether the gap between those two things is where Sprint 9 lives.

---

## Pressure Test Scorecard

After completing all scenarios, complete this summary:

| Scenario | Model verdict | Key friction | Sprint 9 candidate? |
|---|---|---|---|
| 1 · Missing travel auth | Handles except navigation | Gap rows not clickable | Yes — Situation Room routing |
| 2 · Valid identity, no RTW | Handles | Label clarity | Maybe — obligation description quality |
| 3 · Expiring visa, active journey | Partial | Assignee not visible; no Visa Renewal journey | Yes — journey type expansion |
| 4 · Multiple gaps, multiple owners | Gap exposed | defaultOwner not rendered; no multi-owner routing | Yes — ownership surface |
| 5 · Post-onboarding credential risk | Gap exposed | No VisaRenewal protocol or journey path | Yes — protocol expansion |
| 6 · Covered vs. uncovered scan | Handles | Scale and assignee visibility untested | Maybe — after roster size confirmed |
| 7 · Credential → Situation Room effect | Handles | No return affordance; feedback loop invisible | Maybe — UX polish |
| 8 · Refresh behaviour | Expected | Mock mode not communicated | Low — deferred to SP layer |
| 9 · What escapes the platform | Observation | TBD from actual run | Defines Sprint 9 |
| 10 · Operating at scale | Mental simulation | Scanability, grouping, ownership, density at 30+ gaps | Defines Sprint 9 layout direction |

---

## How Sprint 9 Gets Decided

After the pressure test is complete, the three or four items that produced the most friction — or the most escapes to external tools — define the operational question Sprint 9 should answer.

The candidates already visible from analysis:

- **"Who is responsible for this gap?"** → Surface `defaultOwner` per obligation; add owner assignment to gap rows
- **"This player needs a visa renewal. How do I start that?"** → VisaRenewal protocol + journey type; Situation Room gap row initiates the correct journey
- **"Is this player ready for EWC?"** → Mission/event scoping; obligation spans aligned to a specific tournament window
- **"Which journeys are stalled?"** → Journey health surface; Suspended journeys with no recent activity flagged

The pressure test will confirm which of these matters most in practice.

---

*C3 Platform · Operator Pressure Test Plan · 2026-06-28*
