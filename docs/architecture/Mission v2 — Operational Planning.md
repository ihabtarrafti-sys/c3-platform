# Mission v2 — Operational Planning

**Status:** Design — pre-implementation  
**Date:** 2026-06-29  
**Prerequisite reading:** `docs/architecture/C3 Architecture Baseline — Sprint 11.md`

---

## The Gap This Document Addresses

Mission v1 established Mission as the shared operational context for compliance reasoning. It answers: *"Is this roster ready to travel?"*

It does not yet answer: *"Do we have everything arranged for this mission to succeed?"*

That is a different question — and a harder one. Credential readiness is binary: a person either has a valid Travel credential or they do not. Operational planning is multi-domain, multi-status, multi-deadline, and partially uncertain. It involves coordinating logistics, finances, accommodation, travel, and documentation across multiple stakeholders, some inside Geekay and some outside.

The spreadsheet that currently manages this work is not the architecture. It is evidence of the architecture that should exist. This document proposes that architecture.

---

## What Mission v1 Already Contains

Before adding anything, it is worth cataloguing what is already there:

| Field | Purpose |
|---|---|
| `MissionID` | TR code — cross-system linkage to Finance Sales Orders |
| `Name` | Display name |
| `Game` | Tournament game |
| `Organizer` | Tournament organiser |
| `Entity` | Legal entity fielding the mission (UAE / KSA / Multi) |
| `Status` | 7-state lifecycle: Planning → FinancePending → Confirmed → Active → PostMission → Settled |
| `Jurisdiction` | Where the mission takes place (stored, not yet used for credential discrimination) |
| `Span.StartDate` | First operational day |
| `Span.EndDate` | Last operational day (urgency horizon) |
| `Span.SettlementDate` | Financial closure date |
| `ParticipantPersonIDs` | Roster — the canonical participant list |
| `IncomeCurrency` | Currency for prize and reimbursements |
| `MissionParticipant.ExternalCode` | Cross-reference to Finance/Logistics systems |
| `MissionParticipant.Role` | Operational role at the event |
| `MissionParticipant.PerDiemRate` | Daily allowance rate |

The Mission v1 docstring reads: *"Finance and Logistics are consumers of Mission data. Mission does not own budget lines, flight bookings, or accommodation records — those domains produce their own views from Mission context."*

That assumption was correct at the time it was written. Sprint 12 should revisit it. The question is not whether Finance and Logistics are consumers — they are. The question is: where do the records live? The answer is: inside Mission, not alongside it.

---

## The Two Layers of Operational Reality

The platform now has two distinct operational layers. It is important to name them clearly before designing a third:

**Layer 1 — Compliance reasoning (Sprints 6–11)**
> "Is this person ready to participate in this mission?"
> Source: Credential model → Protocol evaluation → OperationalGap → WorkItem
> Character: Binary. A credential exists or it does not. Urgency is computable.

**Layer 2 — Operational planning (Mission v2)**
> "Have we arranged everything this mission requires to succeed?"
> Source: Travel records, accommodation bookings, budget lines, milestone tracking
> Character: Multi-status. Progress is tracked, not computed. Urgency is time-driven.

These layers are complementary. A person can be credential-compliant but have no flight booked. A flight can be booked but the visa not yet approved. The planning layer surfaces what the compliance layer cannot see.

A future Layer 3 — **operational execution** — will cover what happens during the mission: match results, on-site incidents, expense claims, real-time logistics. That is out of scope for Mission v2.

---

## The Hub-and-Spoke Model

Mission v2 should be a multi-facet operational hub. Each facet is a planning domain:

```
                          ┌─────────────────┐
                          │     MISSION      │
                          │   (the hub)      │
                          └────────┬─────────┘
                                   │
          ┌──────────┬─────────────┼─────────────┬──────────┐
          │          │             │             │          │
     Tournament  Participants   Finance       Travel   Accommodation
      Context                  (Budget)    Itineraries   Blocks
          │          │             │             │          │
     Event info  Roster +      Income +      Per-person  Hotel +
     Prize pool  Eligibility   Expenses      flights     Rooms
```

The Mission carries **headline status** for each facet — a single field that summarises whether the domain is planned, in progress, or confirmed. The facet records carry the detail.

This distinction matters architecturally. Loading a Mission overview does not require loading every flight itinerary. The Mission hub provides a status summary; the user drills into a facet to see the records.

---

## Facet Analysis

### 1. Tournament Context

**What Mission v1 has:** Name, Game, Organizer, Jurisdiction, Span  
**What it is missing:**

**Tournament tier** — not all missions are equal. A regional qualifier, an international LAN Major, and a world championship have very different planning implications (duration, visa lead time, prize pool scale, media obligations). Tier is an operational classification.

Proposed values: `Regional | International | Major | Championship | Invitational | Online`

**Tournament format** — affects how long participants may need to be present. A single-elimination event could end in one day; a double-elimination event with a lower-bracket run could extend the stay significantly. Accommodation and travel bookings depend on this.

Proposed values: `SingleElim | DoubleElim | Swiss | LeaguePlay | RoundRobin | Mixed`

**Organizer reference code** — the external identifier used by the tournament organizer for this team's registration. Separate from the TR code, which is Geekay's internal reference. Required for tournament registration communications.

**Prize pool structure** — the financial upside is not a single number. It is a placement-tiered schedule. This matters for financial planning because budgets are often scenario-based: "If we finish top 4, prize covers travel costs."

The prize pool is not a single field. It is a structure:
```
PrizePlacement: { placement: string; amount: number; currency: string }[]
Example:
  Champion:       $50,000
  Runner-up:      $25,000
  3rd/4th:        $12,500
  5th–8th:        $6,000
  9th–12th:       $3,000
```

**Appearance fee** — some invitational events pay a guaranteed appearance fee regardless of placement. This is guaranteed income and is treated differently from prize winnings in the financial model.

**Organizer travel stipend** — some tournament organizers cover or partially cover travel costs. When present, this offsets expenses and affects the budget ceiling.

**Publisher involvement** — distinguishes first-party events (organized by the game publisher: Psyonix, Riot, Valve) from third-party events. Publisher events often have specific roster eligibility requirements, media obligations, and different visa support processes.

**Venue city / venue name** — `Jurisdiction` captures country-level context for credential evaluation. The physical venue address is needed for accommodation proximity planning and ground transport.

**Minimum vs maximum stay duration** — the Span already covers the confirmed dates. But planning accommodation requires understanding the range: minimum (team exits in group stage) vs. maximum (team wins and stays for the entire event including closing ceremony). This drives contingency booking strategy.

---

### 2. Participant Planning

**What Mission v1 has:** `ParticipantPersonIDs[]`, `MissionParticipant` (role, external code, per diem rate)  
**What it is missing:**

**Home city / departure point** — each participant travels from a different origin. Some may be in-country, some international. Travel planning cannot begin without knowing departure points. This could be derived from the Person record if Person carries a home city field (it currently does not), or specified per-mission.

**Eligibility status** — distinct from credential readiness. Eligibility for this specific tournament is about:
- League registration status (is this player registered with the league's competitive system for this season?)
- Publisher registration (has the team submitted this player's participation to the organizer?)
- Transfer window compliance (is this player past any transfer restrictions?)

Values: `NotChecked | Pending | Eligible | Ineligible`

This is different from the Travel credential or RightToWork credential. It is competition-specific compliance, not general operational compliance.

**Substitution / reserve status** — not all participants in the `ParticipantPersonIDs` list are primary roster. Some are travelling reserves or substitutes. A substitute may or may not ultimately travel. This affects financial planning (do you book flights for them?) and credential planning (do you evaluate them?).

Values: `Primary | Reserve | Staff | NonTravelling`

Note: `NonTravelling` allows a participant to be linked to a Mission (for prize sharing, for example) without generating travel or accommodation planning requirements.

**Visa nationality** — the credential model tracks whether a Travel credential exists. But the planning model needs to know which passport the participant will use for visa applications. A dual national may use the passport that doesn't require a visa. This is planning intelligence, not credential compliance.

**Media / content obligations** — some players have content creation obligations at events (streaming, social posts, press availability). These are mission-specific obligations on participants that are not captured by the operational credential model.

---

### 3. Finance

**What Mission v1 has:** `IncomeCurrency`, `Span.SettlementDate`, `MissionParticipant.PerDiemRate`  
**What it is missing:** essentially everything structural about the financial lifecycle.

Finance is the most structurally complex facet. It has two distinct phases that require different data:

**Phase 1 — Budget (pre-Confirmed)**
The budget is Geekay's financial plan for the mission. It consists of:

*Expected income:*
- Prize pool scenario estimates (conservative / expected / optimistic based on placement probabilities)
- Appearance fee (if confirmed)
- Organizer travel stipend (if applicable)

*Planned expenses:*
- Flights (total estimated cost across all travellers)
- Accommodation (hotel nights × rooms × nightly rate)
- Per diems (total: all participants × daily rate × days)
- Ground transport (airport transfers, inter-venue)
- Freight / peripherals shipping
- Visa application fees (number of applications × fee per nationality)
- Tournament registration fees
- Contingency (typically a % of total expenses)

The budget is a planning document, not a ledger. It answers: "What are we committing to spend, and what is the financial exposure?"

**Phase 2 — Actuals (PostMission → Settled)**
Actuals are what happened. They include:
- Final prize placement and payout received
- Actual flight costs (may differ from estimate if routes changed)
- Actual accommodation costs (may differ if mission extended)
- Actual per diem disbursements
- Expense claims submitted by participants / staff
- Any organizer reimbursements received

**Settlement** is the reconciliation of planned vs. actual. The SettlementDate on Mission marks when this is complete. But the data needed to reach settlement — expense claims, receipts, payout confirmations — needs a home.

**The financial structure I'm proposing is NOT a full accounting system.** It is operational financial awareness: "What did we plan to spend? What did we actually spend? Are we settled?"

A full accounting integration (with SharePoint finance lists, Power Automate flows to Finance) is a larger project. What Mission v2 needs is the data shape that would feed that integration.

---

### 4. Travel

**What Mission v1 has:** nothing formal  
**What it is missing:** per-participant travel itinerary records

Travel planning for a mission is a multi-person, multi-leg logistics problem. Each participant has:
- An origin city
- A required arrival window at the venue
- A departure date (often not known precisely until placement is known)
- Potentially different return dates depending on how long they stay

A `MissionTravelRecord` would capture, per participant:
- Outbound journey: origin → destination, flight segments, departure/arrival datetime, booking reference, status
- Return journey: similar structure
- Total cost
- Booking status: `NotStarted | Searching | Booked | Ticketed | Cancelled`

At the Mission level, the travel facet status summarises across all participants:
- How many are booked (outbound and return)
- Whether all critical-path participants have confirmed flights

**Freight / equipment** is a related but separate concern. Team peripherals (mice, keyboards, headsets, monitors in some cases) may travel with participants as checked luggage, or be shipped separately. For shipped equipment:
- Shipment reference
- Contents declaration
- Departure / arrival courier
- Status: `NotShipped | InTransit | Delivered | Lost`
- Insurance coverage

Equipment shipping and freight is distinct from participant travel because it has a different timeline (equipment often needs to arrive before players do) and a different owner (typically ops / manager, not the player).

---

### 5. Accommodation

**What Mission v1 has:** nothing  
**What it is missing:** hotel block(s) and room assignments

Accommodation for a mission is typically:
- One or two hotel blocks for the duration of the event
- Rooms shared between two participants (or single rooms for management)
- Potentially extended blocks if the team advances

An `MissionAccommodationBlock` would capture:
- Hotel name and address
- Check-in date, check-out date
- Number of rooms reserved
- Room type (standard, twin, single)
- Nightly rate and total cost
- Booking reference / confirmation number
- Status: `NotStarted | Enquiring | Reserved | Confirmed | Cancelled`
- Contingency extension option (has an extension option been reserved?)

Room assignments would link `MissionParticipant` records to rooms. This is operational detail that affects both cost (who is paying which room) and logistics (who has access to which room key).

---

### 6. Milestones

This is the facet that currently exists nowhere in C3 or in the spreadsheet — but is arguably the most valuable thing Mission v2 could introduce.

A **milestone** is a named operational checkpoint with:
- A name (e.g. "Visa applications submitted")
- A planned date (when it should happen)
- An actual date (when it happened — null if not yet)
- An owner (who is responsible for this milestone)
- A status: `Upcoming | InProgress | Complete | Missed | Blocked`
- Dependencies (other milestones that must complete first)

Milestones make the planning layer operational — not just a set of records to fill in, but a sequenced chain of work that the platform can reason about.

The natural milestone chain for a travel mission (from T-30 to settlement):

```
T-45  Roster confirmed
T-40  Tournament registration submitted
T-35  Visa applications submitted
T-28  Flights booked
T-21  Accommodation confirmed
T-14  Equipment / freight shipped
T-7   Pre-departure briefing
T-3   Travel document pack ready
T-0   Departure
T+E   Event — match play
T+E+3 Return completed
T+14  Expense claims submitted
T+30  Organizer invoice / prize payout received
T+60  Settlement complete
```

The key insight about milestones: **a missed or blocked milestone should generate a WorkItem.** This is where planning gaps enter the work queue alongside compliance gaps.

"Visa applications for TR/2026/006 were due yesterday and are not marked complete" → WorkItem, `MissionPlanningGap` trigger type, `Immediate` priority if participants are affected.

Milestones are the bridge between the planning layer and the work queue.

---

### 7. Documents

**What Mission v1 has:** nothing  
**What it is missing:** document corpus management

A mission generates and requires a corpus of documents. Not all documents need to live in C3. Most will live in SharePoint. But C3 should know they exist and track their status.

Document types relevant to a Mission:
- Tournament registration confirmation
- Visa approval letters (per participant requiring a visa)
- Hotel booking confirmations
- Flight itineraries
- Tournament rulebook / participation agreement
- Insurance certificates
- Customs / freight documentation (for equipment shipping)
- Expense claim submissions

A `MissionDocument` record would track:
- Document type
- Name
- SharePoint URL or reference
- Related participant (if participant-specific)
- Status: `Required | Requested | Received | Verified | Archived`
- Due date (when it must be received by)

The documents facet is not about storing documents — it is about tracking that required documents have been received and are in order. The missing-document gap ("Visa approval letter for PER-0002 not yet received, mission departs in 12 days") should eventually generate a WorkItem.

---

## What the Spreadsheet Tells Us

The existing operational spreadsheet (currently the Logistics Intelligence Hub in Excel) has the following structure:
- **Dashboard** — headline summary
- **TRV** — travel records
- **EQP** — equipment/peripherals
- **SHP** — shipment/freight tracking

This tells us several things about current operational practice:

**The spreadsheet is the Mission Room.** Everything about a specific mission's logistics is tracked in one place. This is the right instinct — it confirms that Mission should be a hub, not a table row.

**Travel, equipment, and freight are already treated as distinct concerns.** The separate tabs confirm that participant travel logistics and equipment logistics have different owners, different timelines, and different status models.

**The spreadsheet has no connection to the person records.** When a flight is booked for "Alex Chen," the spreadsheet has no way to verify that Alex Chen has a valid Travel credential. C3 Mission v2 would make that connection live: a travel record references `PersonID`, which is directly connected to the credential model.

**The spreadsheet has no milestone structure.** It tracks current state, not the sequence of work needed to get there. This is the most significant limitation of the current approach and the strongest argument for milestones in Mission v2.

**The spreadsheet does not exist inside Mission.** It is a standalone document. This means cross-mission analysis is impossible: "Across all 2026 missions, how much did we spend on flights?" requires manual aggregation. If Mission carries the data, that aggregation becomes a query.

The objective for Mission v2 is not to recreate the spreadsheet inside C3. It is to absorb what the spreadsheet knows into the Mission model — so that Mission becomes the source of truth and the spreadsheet becomes, at most, a rendered report.

---

## The Planning Status Layer

One of the important additions Mission v2 needs is a headline planning status per facet. The Mission hub should be able to say:

```
TR/2026/006 — RLCS 2026 World Championship
Departs: 18 days

Readiness:     ████████░░  80%  (2 open gaps)
Finance:       Approved
Travel:        ██░░░░░░░░  3/5 participants booked
Accommodation: Confirmed
Milestones:    2 overdue
```

This summary requires each facet to maintain a computable status. That means:

- **Readiness status** — already computed from OperationalGaps. No change.
- **Finance status** — derived from whether a budget exists and is approved: `NoBudget | Pending | Approved | Reconciling | Settled`
- **Travel status** — derived from travel records: `NotStarted | InProgress | AllBooked | AllConfirmed`
- **Accommodation status** — derived from accommodation blocks: `NotStarted | Reserved | Confirmed`
- **Milestone status** — derived from milestone records: `OnTrack | AtRisk | Overdue | Complete`

These are summary values — computed from child records, not stored directly. They should live in a computed Mission view, not as fields on the Mission record itself. This prevents stale data.

The planning status layer is what transforms Mission from a record into a cockpit.

---

## The Planning Layer and the Work Queue

The most architecturally significant implication of Mission v2 is how it extends the work queue.

Currently, `WorkItemTrigger` is a union of two types:
- `OperationalGap` — person-level compliance trigger
- `MissionDeparture` — cross-person pressure trigger

Mission v2 introduces a third trigger type:

```typescript
| {
    type: 'MissionPlanningGap';
    missionId: string;
    facet: 'Finance' | 'Travel' | 'Accommodation' | 'Milestones' | 'Documents';
    detail: string;
    daysUntilDeparture: number;
  }
```

This means the work queue can surface planning gaps alongside compliance gaps. An operator arriving at the Command Center would see:

```
Immediate
  RLCS 2026 departs in 6 days with open compliance gaps
  Visa application milestone is 3 days overdue — TR/2026/006

High
  3/5 participants have no booked flights — TR/2026/006
  Budget not approved — TR/2026/007 departs in 24 days

Normal
  Equipment shipment not tracked — TR/2026/006
  Alex Chen's obligation unassigned
```

This is the vision: a single queue where compliance and planning gaps coexist, all routed to the correct resolution context.

The generation rule for planning WorkItems mirrors the compliance generation pattern: the generator asks "what is the planning state of each Mission facet?" and emits WorkItems for gaps above a threshold.

---

## What Does NOT Belong in Mission v2

It is as important to name what should not be added as what should.

**Financial accounting.** Mission v2 tracks budget plans and expense estimates. It does not replace the Finance department's accounting system. Prize payouts, VAT, inter-entity transfers, and audit trails belong in Finance systems, with Mission providing reference data (the TR code links them).

**Content management.** Geekay produces content around missions (social media, YouTube, streams). Content schedules, creator assignments, and media deliverables are not operational planning — they are a separate domain that happens to share the Mission timeframe.

**Match results and performance data.** In-event results (wins, losses, placements) are relevant to settlement (prize calculation) but not to operational planning. The Mission knows its `PrizePlacement` structure; it does not own the competitive results system.

**Granular expense receipts.** The planning layer tracks expense estimates. Individual receipts, reimbursement approvals, and audit-ready expense reports belong in a Finance system, not in C3. Mission v2 tracks "total accommodation cost: $12,400" — not individual receipts.

**Player contracts and compensation.** Mission participation may have financial implications for player contracts (prize splits, bonuses). Those are HR and Legal domain. Mission can reference a player's contract status (for eligibility); it does not own compensation terms.

---

## Mission Facets vs. Mission Fields

A design decision that must be made before Sprint 12: the distinction between what is a field ON Mission vs. what is a related record that references Mission.

**Guideline: a field belongs on Mission if:**
- It is always relevant regardless of mission type
- It is a single value (not a collection of records)
- It drives Mission-level behaviour (lifecycle, activation gate, currency)

**Guideline: a related record is correct if:**
- It can have zero, one, or many instances per Mission
- It has its own lifecycle (status, timestamps, owner)
- Different users may own different records for the same Mission

Applying this:

| Concept | Field on Mission? | Separate record? |
|---|---|---|
| Tournament tier | ✅ Field | |
| Prize pool structure | | ✅ `MissionPrizePlacement[]` |
| Appearance fee | ✅ Field (single value) | |
| Organizer stipend | ✅ Field (single value) | |
| Per-participant travel | | ✅ `MissionTravelRecord` per participant |
| Accommodation block | | ✅ `MissionAccommodationBlock` |
| Budget approval status | ✅ Field (summary) | |
| Budget line items | | ✅ `MissionBudgetLine[]` |
| Milestones | | ✅ `MissionMilestone[]` |
| Documents | | ✅ `MissionDocument[]` |

The Mission record grows modestly in Mission v2. The facet records carry the depth.

---

## Open Design Questions

These must be resolved before Sprint 12 implementation begins:

**1. Where does the participant home city live?**
Travel planning requires departure points. Does `Person` gain a `HomeCity` field? Or does `MissionParticipant` carry a `DepartureCity` per-mission? The latter is more accurate (a person might always travel from a specific hub regardless of their home).

**2. How are prize pool scenarios modelled?**
A `PrizePlacement[]` array captures the prize schedule. But financial planning requires scenario selection: "We're planning to finish top 4." Does the Mission carry a `PlanningPlacement` field? Or does the budget simply carry a scenario label?

**3. Is `MissionStatus` sufficient for the financial lifecycle, or does it need extension?**
Currently: `Planning → FinancePending → Confirmed → Active → PostMission → Settled`. The `PostMission → Settled` transition covers financial reconciliation. But what if reconciliation is blocked? Is there a `SettlementBlocked` state, or is that handled through milestones?

**4. How do milestones relate to the mission type?**
A regional online tournament has a very different milestone chain from an international LAN. Should milestones be templated per mission type, or freeform per mission? Templated milestones are more powerful (they enable automation) but require a template system. Freeform milestones are simpler but provide less structure.

**5. What does Sprint 12 actually build?**
Mission v2 is a large design surface. Sprint 12 should not attempt to build all of it. The question is: what is the minimum planning facet that provides the most operational value immediately?

Candidates:
- **Finance first** — budget approval is the gate to FinancePending → Confirmed. Formalising it in data would make the lifecycle meaningful.
- **Milestones first** — the most operationally visible gap. A mission with overdue milestones is a mission at risk, and milestones connect directly to the work queue.
- **Travel first** — the most immediate logistics concern and the most time-pressured. Connects to credential readiness: a booked flight with no valid Travel credential is the most dangerous combination.

Each option has a different risk profile and a different payoff. The recommendation belongs in the Sprint 12 proposal, not here.

---

## The Architectural Principle Mission v2 Locks

Mission v1 established: *"Mission is the shared operational context from which Obligations, Finance, Logistics, and Content derive meaning."*

Mission v2 should establish: **Mission is not just the context. It is the workspace.**

The context provided where other things got their meaning. The workspace is where the planning work gets done, tracked, and completed. Mission moves from being a reference object to being an operational hub — the place an Operations Manager lives when they are running a mission.

This is consistent with the platform's north star: C3 should be the intake system, not a reporting layer on top of spreadsheets.

The Mission that exists today is a calendar entry that knows its roster. The Mission that should exist is an operational command surface that knows its roster, its planning state, its financial position, its document status, and its work queue — and surfaces what needs action before it's too late.
