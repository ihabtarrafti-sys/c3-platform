# Mission Model — Architectural Analysis

**Status:** Conceptual — pre-implementation  
**Date:** 2026-06-28  
**Inputs:** Tournament & Campaign Codes Master, RLCS 2026 WC/EWC Budget Sheet, Pressure Test Scenario 1 ("Travel for what?")  
**Purpose:** Model the Mission concept before writing any code. Understand what Mission is, what it owns, what references it, and what operational questions it unlocks.

---

## The Evidence

Two spreadsheets. Studied not as finance documents but as operational records.

**Tournament & Campaign Codes Master** is a Mission registry. Every row is an organisational commitment: a code, a name, a game, a year, a jurisdiction, and a lifecycle status. The status vocabulary is small and precise: *Finance Confirmation Pending*, *Confirmed*, *CANCELED*. That's not a financial process — that's a commitment lifecycle.

**RLCS 2026 WC/EWC Budget Sheet** is a Mission workspace. Everything inside it exists because Geekay committed to participating in that event: who is going, when they fly, where they stay, what they earn per day, what the visa will cost, what prize money is expected, what the net result is. Finance is one consumer of this workspace. Operations is another. Content is another.

The same philosophical shift that moved C3 from "documents describe a person's status" to "operational truth is computed from evidence" applies here.

> The budget sheet does not define the Mission.  
> The Mission produces the budget sheet as one of its outputs.

---

## What Is a Mission?

A Mission is an organisational commitment to deploy people and resources to a defined operational event, within a specific time window and jurisdiction, with an expectation of a defined outcome.

It is the moment a calendar entry becomes real. It is what transforms "we might go to EWC" into "we are going to EWC — these people, these dates, this city, this legal entity."

A Mission is not a tournament. Tournaments are organised by others. A Mission is Geekay's response to a tournament: the decision to participate, the people selected, the resources allocated, and the obligations that follow from that decision.

**A Mission is confirmed before it is active.** The Finance Confirmation Pending → Confirmed transition is the activation gate. Everything downstream — operational obligations, logistics planning, budget allocation, credential requirements — begins at confirmation, not at the event start date.

---

## Mission Identity

The existing TR code system is already functioning as a Mission identifier.

```
TR/2026/006    — Geekay UAE entity, 2026, 6th commitment of the year
SATR/2026/001  — Geekay KSA entity, 2026, 1st commitment of the year
```

The prefix encodes the legal entity (UAE vs. KSA). The year and sequence together provide uniqueness. This is already used as a reference key in Finance systems (linked to Sales Orders). The platform should adopt it.

```
MissionID:   TR/2026/006
Name:        Rocket League Championship Series 2026 - World Championship & EWC
Game:        Rocket League
Organizer:   Psyonix / EWC
Year:        2026
Entity:      UAE  (from TR/ prefix)
```

---

## Mission Attributes

```
MissionID:          TR/2026/006
Name:               string
Game:               string  (maps to team/roster context)
Organizer:          string
Entity:             UAE | KSA | Multi
Status:             Planning | FinancePending | Confirmed | Active | PostMission | Settled | Canceled

Jurisdiction:       string  (e.g. "Paris, France")
  — determines which credential requirements apply to participants

Span:
  StartDate:        2026-07-08   (first operational day — flights, obligations begin)
  EndDate:          2026-08-16   (last operational day — credential validity must extend through this)
  SettlementDate:   2026-12-30   (financial closure — weeks or months after event end)

IncomeCurrency:     USD | AED | SAR | EUR
```

The three dates are distinct and important. `StartDate` is when obligations first apply. `EndDate` is the operational deadline — credential validity must cover through this date, not just through `StartDate`. `SettlementDate` is financial, not operational. A Mission is operationally closed on `EndDate` but financially open until `SettlementDate`.

---

## Mission Participants

Each Mission has a roster of participants. Participants have roles, and roles carry distinct operational implications: different per diem rates, potentially different credential requirements, different logistics.

The existing participant code system encodes role:

```
RL/PL/026  →  Game: Rocket League / Role: Player / Sequence: 026
RL/CH/004  →  Game: Rocket League / Role: Coach  / Sequence: 004
```

In C3 terms, a participant maps to a Person. The person code is an external reference.

```
MissionParticipant:
  MissionID:     TR/2026/006
  PersonID:      PER-0001               (C3 Person)
  ExternalCode:  RL/PL/026              (existing code system)
  Role:          Player | Coach | Manager | Analyst | Staff
  PerDiemRate:   25 USD | 35 USD | ...  (role-dependent)
```

The per diem rate is not a fixed global value. It is a function of participant role and possibly jurisdiction. The Config sheet already encodes this: 25 USD / 30 USD / 35 USD / 50 USD / 65 SAR / 100 SAR as selectable rate tiers.

---

## Mission Logistics

Each participant's logistics are per-Mission, per-person, with sub-trip granularity.

**Flights.** A participant may have multiple flight legs for a single Mission. This is real: RLCS WC has qualifier rounds before the main event. One player has three separate flights recorded.

```
MissionFlight:
  MissionID:     TR/2026/006
  PersonID:      PER-0001
  Origin:        Copenhagen, Denmark
  Destination:   Paris, France
  FlyingIn:      2026-07-08
  FlyingOut:     2026-07-13
  Cost:          353 USD
  BookingRef:    string
  Status:        Pending | Booked | Confirmed
```

**Accommodation.** Per participant, per check-in/check-out window.

```
MissionAccommodation:
  MissionID:     TR/2026/006
  PersonID:      PER-0001
  Destination:   Paris, France
  CheckIn:       2026-07-08
  CheckOut:      2026-08-10
  Cost:          8160 USD  (7030 + 1130 — split booking)
  BookingLink:   url
  Status:        Pending | Booked | Confirmed
```

**Per Diem.** Per participant, bounded by operational dates.

```
MissionPerDiem:
  MissionID:     TR/2026/006
  PersonID:      PER-0001
  StartDate:     2026-07-08
  EndDate:       2026-07-23
  DailyRate:     35 USD
  TotalDays:     16
  TotalAmount:   560 USD
```

---

## Mission Costs and Income

**Operational costs** aggregate from logistics plus additional items:

```
Flights total
Accommodation total
Per Diem total
Visa Fees             ← recorded as Actuals (important — see below)
Local Transportation  ← e.g. trains
SIM Cards             ← Actuals
Other                 ← Actuals
─────────────────
Total Mission Budget
```

**Visa Fees as a Mission cost** is a critical structural observation. In C3, a visa is a credential that satisfies a Travel obligation. In Finance, a visa is a cost line in a Mission budget. These are two views of the same object. When a participant's visa is obtained for a Mission, it has both a credential identity (satisfies the Travel obligation) and a cost (charged to the Mission). The Mission is the bridge between credential management and financial accounting. Currently these are disconnected systems; they should not be.

**Expected income:**

```
Reimbursement from Organisers    ← not always present
Prize Winnings                   ← formula-driven by placement projection
  RLCS WC: (66000 × 0.3) + (35000 × 0.3) = ~30,300 USD  (projected 8th place)
Other Income
─────────────────
Net Profit / (Loss) = Income − Total Budget
```

The placement projection (8th place) and prize formula already live in the spreadsheet. This is forward-looking financial reasoning — not just recording actuals.

---

## Mission Status Lifecycle

```
Planning
  ↓   (commitment under consideration)
FinancePending   ["Finance Confirmation Pending"]
  ↓   (green light from finance)
Confirmed        ["Confirmed"]
  ↓   (event start date reached)
Active
  ↓   (event end date reached)
PostMission
  ↓   (settlement date reached, accounts closed)
Settled

At any point before Active:
  → Canceled     ["CANCELED"]
```

**The Confirmed transition is the activation gate.** This is when the Mission becomes operationally real:
- Protocols activate for all participants (obligations evaluated against Mission span and jurisdiction)
- Logistics planning begins
- Budget allocation is committed
- Credential gaps become urgent relative to Mission.StartDate

A Mission in FinancePending status does not yet trigger obligations. A Mission in Confirmed status does. This prevents the platform from flagging credential gaps for events that have not yet been approved.

---

## What Mission Activates in C3

When a Mission reaches **Confirmed** status, the following should happen automatically:

1. **Protocol evaluation** runs for every participant with `ProtocolContext.span = { from: Mission.StartDate, to: Mission.EndDate }` and `ProtocolContext.mission = Mission`.

2. **Jurisdiction-aware obligations** are computed. Paris, France = Schengen jurisdiction. A Schengen visa satisfies Travel for this Mission. A UAE Residence Permit does not. The protocol evaluator should know which credential types satisfy obligations in the Mission's jurisdiction.

3. **Obligation urgency** becomes deadline-relative rather than rolling-window-relative. A credential expiring on 2026-08-17 (one day after Mission.EndDate) is Satisfied. A credential expiring on 2026-08-15 (one day before) is Unsatisfied — the participant cannot complete the Mission without a renewal.

4. **Journeys can be Mission-scoped.** "Start Visa Renewal Journey for PER-0001 — Mission TR/2026/006" carries operational context that "Start Visa Renewal Journey for PER-0001" does not. The journey knows why it was initiated, who authorized it, and what deadline it is working toward.

---

## What Mission References

| What | How it references Mission |
|---|---|
| Journey | `MissionID` — journey was initiated to satisfy an obligation for this Mission |
| Obligation | `span` — derived from `Mission.StartDate → Mission.EndDate` |
| Credential | `MissionID` — credential was obtained for this Mission (enables cost tracking) |
| Budget | Computed from Mission participants and logistics |
| Finance report | Filtered/aggregated view of Mission data |
| Logistics plan | Derived from MissionParticipants |

---

## What Closes a Mission

**Operationally:** `EndDate` passes. All participants are back. The event is over.

**Financially:** `SettlementDate` passes. Prize payments received. Reimbursements processed. Budget reconciled against actuals. The Mission is `Settled`.

These are distinct closures. A Mission can be operationally over but financially open for months. The RLCS WC example: event ends August 16; settlement expected December 30 — a four-month gap. The platform should model both states rather than collapsing them into a single "Completed" status.

---

## Operational Questions That Only Become Answerable with Mission

Currently the platform can answer:

- "Does this person have a Travel gap?"
- "Is this person ready?" (in general)
- "Who in the organisation has unresolved obligations?"

With Mission, the platform can answer:

- "Is this roster ready to travel to Paris for RLCS WC?"
- "Which participants have credential gaps that will expire before the event ends on August 16?"
- "What is the total operational cost of sending this roster to EWC?"
- "This player needs a France visa — is it for RLCS WC, another Mission, or general travel?"
- "Which Confirmed Missions in Q3 have participants with credential gaps?"
- "Which Missions are at highest operational risk right now?" (the future Mission Room)
- "Are all flight bookings confirmed for every RLCS WC participant?"
- "What is our expected prize return vs. confirmed spend for this Mission?"
- "Which journeys were initiated for Mission TR/2026/006?"
- "What will become a problem in the next 30 days?" (Mission deadlines as the horizon)

---

## What Belongs Where

| Domain | Owns | Produces |
|---|---|---|
| **Mission** | Identity, Span, Status, Jurisdiction, Participants, Participant Roles | The operational context everything else references |
| **C3 / Operations** | Obligations, Journeys, Readiness evaluation | Obligation spans anchored to Mission; Journeys scoped to Mission |
| **Finance** | Budget, P/L, Settlement tracking | Reads Mission logistics → generates cost summaries, net P/L, prize reconciliation |
| **Logistics** | Flight bookings, Accommodation, Per Diem | Reads Mission participants → generates per-person logistics plan |
| **Content / Media** | Event calendar, media opportunities | Reads Mission identity and span |

Mission does not own Finance, Logistics, or Content. It is the shared context they all reference. Each domain produces its own view of Mission data without Mission owning those outputs.

---

## What This Does Not Change in C3 Today

Nothing currently in C3 breaks when Mission is introduced. The architecture anticipated this:

- `ProtocolContext.span` (Sprint 6E) already exists exactly for Mission-anchored obligation evaluation.
- `ProtocolContext.mission` (Sprint 6E) already has a type stub (`Mission` interface).
- Journeys already have `InitiationReason` and `ContractID` — adding `MissionID` is additive.
- The Situation Room shows all gaps without Mission context — it will continue to work, and gains context when Mission data becomes available.

The current model is a valid subset of the Mission-aware model. Everything built so far remains correct.

---

## The Philosophical Parallel

When we moved from the PIF to operational truth, the insight was:

> The PIF described a person's status at a point in time.  
> C3 computes it continuously from evidence.

The same shift applies to the budget sheet:

> The budget sheet reconstructs the Mission from scattered records.  
> The Mission should be the source of truth, and the budget sheet becomes one output it generates.

Documents and spreadsheets become views of Mission data, not the inverse.

---

## What Mission Is Not

**Mission is not a project management tool.** It does not own tasks, timelines, or checklists. Those may emerge from it, but they are not its core.

**Mission is not a financial system.** It provides the data Finance needs, but does not own accounting, invoicing, or reporting.

**Mission is not a tournament record.** A tournament happens regardless of whether Geekay participates. A Mission is Geekay's participation commitment. They are related but distinct.

**Mission is not a Journey.** A Journey is a personal operational workflow for one person. A Mission is an organisational commitment involving multiple people. Multiple journeys may be initiated for a single Mission.

---

## Open Questions Before Implementation

1. **How do existing TR codes map to C3 Persons?** The budget sheet uses RL/PL/026, not PersonID. Is there a roster table that links player codes to C3 PersonIDs? Or does C3 need to import them?

2. **Does the entity prefix (TR/ vs. SATR/) affect which protocols apply?** UAE and KSA obligations may differ in jurisdiction-specific credential requirements.

3. **How granular is jurisdiction?** The current model has Mission.Jurisdiction as a string ("Paris, France"). Is city sufficient, or does the protocol evaluator need to reason about Schengen membership, visa-on-arrival eligibility, and similar factors?

4. **Who can confirm a Mission?** The Finance Confirmation Pending → Confirmed transition is currently done by updating the spreadsheet. In the platform, who has authority to trigger this state change? Finance? Operations management?

5. **How are cancelled missions handled?** A cancelled Mission should deactivate obligations that were Mission-specific. Obligations from other sources (general employment readiness) should remain.

6. **Does one person appear in multiple simultaneous Missions?** Almost certainly yes — a player might be in RLCS qualifiers and a Saudi eLeague simultaneously. The obligation model must handle span overlap correctly.

---

*Geekay Intelligence Platform · Mission Model Architectural Analysis · 2026-06-28*  
*Pre-implementation — do not code against this document until reviewed*
