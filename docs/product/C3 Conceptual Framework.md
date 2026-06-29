# C3 Conceptual Framework

**Status:** Approved — guiding principle for all future C3 development  
**Date:** 2026-06-28  
**Companion document:** C3 Product Vision.md

---

## The Central Idea

C3 is moving from a system that **records what happened** to a system that **knows what should happen next**.

Status is past tense. Readiness is future tense. Journeys are the path between them.

Every product and architecture decision in C3 should be evaluated against this shift.

---

## Three Principles

### 1. The Person is Permanent. Journeys Are Temporary.

The Person is the enduring entity in C3. They exist before their first contract, across all their contracts, through every team transfer, and after their last contract ends.

Everything that happens to a person — Onboarding, Active Engagement, Visa Renewal, Team Transfer, Equipment Assignment, Contract Renewal, Offboarding — is a **Journey** that begins, progresses, and concludes while the Person persists.

A Journey has:
- A type (Onboarding, Renewal, Transfer, Offboarding, etc.)
- A status (Not Started · In Progress · Awaiting Review · Complete)
- An owner (the person responsible for moving it forward)
- A deadline or trigger (when does this need to be complete?)
- A set of checkpoints (what does "complete" mean for this journey?)

A Person is never "done" — they are always in some combination of active and pending journeys. What changes is which journeys are open, and what each one needs to proceed.

**Architectural implication:**  
When we add lifecycle tracking to Person, we are not adding a field. We are establishing the first instance of a Journey. The model should reflect this from the start, even if only one journey type exists initially.

**Design implication:**  
PersonProfile does not show "Onboarding Tab." It shows an open timeline of Journeys — past, current, and upcoming.

---

### 2. C3 Is a Collection of Workspaces, Not a Collection of Screens.

A screen is a view of data.  
A workspace is an operational environment that owns a domain, understands its entities, and can initiate actions on their behalf.

The difference is not visual. It is functional. A workspace knows things a screen does not:

- Which entities in this domain require attention right now?
- What journeys are currently open?
- Which entities are operationally ready, and which are not?
- What actions can be taken from here, and on whom?

**Current workspaces** (existing, to be deepened):  
People Workspace · Contract Workspace · Renewals Workspace · Amendment Workspace · Intelligence Workspace

**Future workspaces** (not yet built):  
Tournament Workspace · Team Workspace · Compliance Workspace · Travel Workspace

Each workspace follows a consistent internal structure:
1. **Situation layer** — what needs attention now
2. **Register layer** — the full list of entities in this domain
3. **Detail layer** — the individual entity profile (Person, Contract, etc.)
4. **Journey layer** — the ability to initiate, track, and complete journeys on those entities

The design system already supports this. PageHeader, SectionCard, DataRow, EmptyState, the panel pattern — these are the building blocks. The workspace concept gives them a higher-level organizing principle.

**Architectural implication:**  
Workspaces should own their navigation context. Moving from the People Workspace register to a PersonProfile and back is a single coherent experience, not a navigation event that loses context.

**Design implication:**  
The "Onboard New Team Member" button in People Workspace is not a create action. It is a **workspace initiating a journey on an entity it manages**. That framing changes how we think about what else the workspace can do.

---

### 3. Every Entity Should Be Able to Answer: "Are We Ready?"

Status tells you where something is. Readiness tells you whether something is complete enough to proceed.

These are different questions with different answers.

A player might be:
- ✓ **Ready for payroll** — contract active, bank details present, salary confirmed
- ✗ **Not ready for tournament submission** — visa expired, league registration incomplete
- ✓ **Ready for team assignment** — identity verified, role confirmed, equipment assigned
- ✗ **Not ready for offboarding** — exit documentation incomplete, equipment not returned

Readiness is **context-dependent**, **computed** (not stored), and **actionable** (each "not ready" item links to the journey or field that would resolve it).

A Readiness Profile defines what "ready" means in a given context:

```
Tournament Submission Readiness
  ✓ Identity — Full name, date of birth, nationality
  ✓ Contract — Active, not expired, covers tournament dates
  ✗ Travel — UAE visa: expired 2026-05-14
  ✗ Compliance — League registration: not submitted
  — Equipment — Not required for this context
```

The top-level answer: **Not Ready (2 of 4 requirements met).**  
The top-level action: *Resolve visa · Submit league registration*

**Architectural implication:**  
Readiness is not a field. It is a function: `evaluate(entity, context) → ReadinessResult`. It should be computed from the current state of an entity's record against a known, configurable set of requirements. The requirements may differ by league, tournament, or operational context.

**Design implication:**  
PersonProfile's completeness view is not an "Onboarding Checklist." It is an **Operational Readiness panel** showing readiness across multiple contexts simultaneously. Onboarding completeness is one context. Tournament eligibility is another. Payroll readiness is a third. The same fields feed into all of them.

---

## How These Three Principles Connect

They are one idea expressed at three levels:

| Level | Principle | The Question It Answers |
|---|---|---|
| Data | Entities + Journeys | What is this person, and what is happening to them? |
| Product | Workspaces | What can I do here, and for whom? |
| Operations | Readiness | Is this person ready for what we need them to do? |

Together: **C3 manages the readiness of persistent entities across their operational journeys, within purpose-built workspaces.**

---

## What This Does NOT Mean

**It does not mean we redesign everything now.**  
The current screen and component structure is correct. These principles should influence naming, framing, and the shape of new things — not require rebuilding things that already work.

**It does not mean we build a "Journey Engine."**  
Journeys start as simple status fields. They become structured workflows when the use case demands it. We do not build infrastructure ahead of need.

**It does not mean every workspace must be built this sprint.**  
Workspaces are deepened over time. People Workspace today is a list with a filter. In six months it may be a situation room. In a year it may manage open journeys. The concept does not require completeness to be useful.

**It does not mean readiness must be computed dynamically on day one.**  
Readiness starts as a manually-maintained checklist. It becomes a computed evaluation when the data model supports it. The UI pattern can precede the automation.

---

## How to Use This Document

When making a product decision, ask:

1. **Permanence:** Does this decision preserve the Person as the enduring entity, or does it conflate Person with Journey?
2. **Workspace:** Does this feature belong to a workspace, and does it fit the workspace's structural role?
3. **Readiness:** Does this feature move us toward being able to answer "are we ready?" — even if readiness is manually determined for now?

If a decision passes all three: build it.  
If a decision conflicts with one: reconsider the framing.  
If a decision conflicts with all three: it is the wrong thing to build.

---

*C3 Platform · Geekay Esports · 2026-06-28*
