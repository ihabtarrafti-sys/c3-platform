# The Geekay Operational Model

*A Philosophy for Building and Using Software at Geekay Esports*  
*Version 2 — Revised and Deepened*

---

## Prologue: The Night Before

The night before a tournament submission deadline, someone somewhere in esports operations is cross-referencing three spreadsheets, two email threads, and a shared drive full of PDFs. They're checking whether five players are eligible to compete: valid visas, current league registrations, contracts that cover the tournament dates.

Then they find that one player's visa expires the week of the tournament. Another isn't registered with the league. The submission window closes in ninety minutes.

This is not a crisis. This is Tuesday.

We built the Geekay Intelligence Platform because we believe operational software can be categorically better than this. Not prettier, not faster, but different in kind. The platform should have known about the expiring visa thirty days ago. It should have initiated a renewal journey automatically. It should have flagged the missing league registration the day the roster was confirmed. By the time Tuesday arrives, the answer to "are we ready?" should already be known — maintained continuously, not assembled frantically.

This document describes how we build software that works that way. It is not a specification. It is the philosophy from which every specification should emerge.

---

## The Wrong Question

Most operational software begins with the wrong question.

The wrong question is: *What information do we need to capture?*

This question leads, logically and inevitably, to forms. Forms for data capture. Dashboards to display the captured data. Reports to summarize the dashboards. The loop closes neatly. Nothing operational has happened.

The right question is: *What is the gap between the organization's current state and the state it needs to be in — and what work must happen to close it?*

This question produces different software. It produces a platform that knows what must be true, evaluates what is currently true, and surfaces the gap between them clearly enough that the people responsible for closing it can act without having to first assemble the picture themselves.

We call this the **gap** — the precise, continuously maintained distance between what is and what must be. Every concept in this model exists in service of measuring, communicating, and closing the gap. When the gap is zero, the organization is operationally ready. The job of this platform is to make that state achievable through work rather than luck.

A second principle follows: **operations work happens in time, not in data.** Operators think in deadlines, consequences, and proximity — not in records and fields. Software that does not understand time is not operational software. It is a database wearing a uniform.

---

## The Operational Cycle

Before unpacking each concept in depth, it helps to see them as a system. This is the cycle the platform continuously executes:

**Mission** declares what the organization will do.  
**Context** identifies which rules apply to this endeavor.  
**Protocols** define what must be true within that context.  
**Obligations** are the specific requirements Protocols produce for specific entities.  
**Entities and Credentials** are evaluated against those Obligations.  
**Readiness** measures the gap between what is and what must be.  
**Journeys** are the work that closes the gap.  
Journeys change reality. Reality is re-evaluated. The cycle continues.

This is not a workflow diagram. It is the underlying logic of every operational decision this platform supports. Each concept earns its place by being indispensable to this cycle.

---

## On Entities: The Things That Persist

An entity is a thing that exists in the world across time.

A person is an entity. They were here before their first contract and they exist in the organization's memory after their last one. Their passport expires and gets renewed. Their contract ends and sometimes begins again. They leave and, occasionally, return.

Most software does not honor this. Most software treats a person as a row in a table — a snapshot of their current state, last updated whenever someone remembered to update it. When a contract ends, the row is archived. When a player leaves, the record is marked inactive. When they return two years later, a new record is sometimes created, and now two entries exist for the same human being, and nobody is certain which one is authoritative.

This is not a database problem. It is a philosophical problem. The software was not built with a clear answer to a fundamental question: *What is a person, in the context of our organization?*

The answer is: a person is permanent. Not their contract. Not their role. Not their team. The person.

**Entities in this model do not get deleted.** They do not get archived into obscurity. They may become inactive. Their journeys may end. But they persist. They accumulate history. They can be found years later when a question arises about what agreements were in force, what decisions were made, what obligations were satisfied.

Permanence is not only a data modeling choice. It is a statement of organizational respect — for the people who have worked here, for the agreements that governed those relationships, for the operational decisions that shaped the organization. The platform is a record of how Geekay has conducted itself. Records of that kind should not evaporate.

The permanent entities in this platform are: **Person, Contract, Team, Tournament.** Everything else — every journey, every credential, every obligation — belongs to one of these entities. They are the load-bearing structures around which everything else is organized.

---

## On Credentials: The Things That Authorize

A document is a file. A credential is a statement of authorization.

Most operational software treats these as the same thing. A passport is stored as an attachment or a set of date fields on a person record. When someone needs to check whether the passport is valid for a tournament, they look at the expiry date, compare it to the tournament date, and make a manual judgment. The platform stores the document. The human does the reasoning.

This is the wrong allocation of labor.

A **Credential** is a first-class operational entity. It has a type — passport, visa, Emirates ID, league registration, equipment assignment record. It has a holder — the person or entity to whom it belongs. It has a validity span — the period during which it is operationally active. And it has a coverage definition — what it authorizes, what obligations it satisfies when valid.

The difference between a document and a credential is the difference between a file cabinet and a system of knowledge. A file cabinet stores things. A system of knowledge understands what they mean.

When the platform models credentials properly, it can reason about them. A UAE visa that expires on July 10th does not satisfy the travel obligation for a tournament that runs July 14th through July 18th — even if the visa exists, even if it hasn't expired yet at the time of the check. The platform knows this not because someone told it, but because it understands the visa's validity span, the obligation's required span, and the gap between them.

Credential renewal is not triggered by someone noticing a date. It is triggered by the platform identifying that a credential will cease to satisfy an obligation before that obligation's deadline. The renewal journey begins before the gap opens, not after it is discovered in crisis.

**Credentials are Entities with authorization semantics.** They are permanent in structure — a renewed visa creates a new credential record, it does not overwrite the old one — and they accumulate on the entities that hold them, building a history of how a person's authorizations have evolved over their relationship with the organization.

The credentials this platform manages include: employment contracts, travel documents (passports, visas), identity registrations (Emirates IDs, national IDs), league registrations, and over time, equipment records and certifications. Each type has its own validity logic, its own renewal journey type, its own set of obligations it can satisfy.

---

## On Protocols and Obligations: The Rules and Their Claims

Entities hold the record of what is. Credentials authorize what entities can do. But neither of these tells the platform what *must* be true. That is the role of Protocols and Obligations.

### Protocols

A **Protocol** is the encoded operational knowledge of the organization — a named, configurable set of requirements that defines what "ready" means in a specific operational context.

The operational problem they solve: in most organizations, the rules about what constitutes readiness live in experienced people's heads and in institutional memory. When a tournament has specific eligibility requirements, someone adapts manually. When a jurisdiction changes its document requirements, the checklist gets updated in a shared document somewhere. The rules are implicit. They get reinvented slightly differently each time, enforced inconsistently, and lost when the person who carried them moves on.

A Protocol makes those rules explicit, queryable, and platform-enforced.

A "UAE Tournament Submission Protocol" specifies: active employment contract covering the tournament dates, valid passport with at least thirty days remaining beyond the tournament's final date, valid UAE visa covering the full tournament span, current league registration, at least one assigned equipment item. These requirements are not hardcoded into a feature. They are expressed as a Protocol that the platform applies when the relevant context is active.

Protocols are owned by the domain that understands them. The Talent & Contracts domain owns employment and document protocols. The Tournaments domain owns eligibility and registration protocols. The Operations & Logistics domain owns equipment and travel protocols. Protocols from multiple domains can be combined to evaluate cross-domain readiness for a single entity.

In the first implementation, Protocols are defined by engineers as structured configuration. Within a year, they become configurable by operations managers — a tournament coordinator can modify eligibility requirements for a specific event without engineering involvement. Within three to five years, Protocols can be sourced externally: league APIs publish their eligibility requirements, and the platform imports and applies them automatically. The architecture stays the same. The intelligence grows.

### Obligations

When a Protocol is applied to a specific entity in a specific context, it produces **Obligations**.

An Obligation is a concrete, named requirement on a specific entity, in a specific context, with a specific span and a specific deadline. Obligations are not abstract rules. They are claims: *this* entity must satisfy *this* condition *throughout this period*.

A single Protocol applied to a single player for a single tournament might produce five Obligations:

> Player X must hold an active contract covering July 14–18, 2026.  
> Player X must hold a valid passport with expiry no earlier than August 17, 2026.  
> Player X must hold a valid UAE visa covering July 14–20, 2026.  
> Player X must be registered in ESL Pro League as of July 12, 2026.  
> Player X must have at least one equipment item assigned as of July 14, 2026.

Each of these is distinct. Each has a precise condition. Each has a deadline. Each can be evaluated independently against the credentials and entity state of Player X.

Obligations have five properties that matter operationally:

**Source** — which Protocol created this Obligation?  
**Target** — which entity must satisfy it?  
**Condition** — what must be true?  
**Span** — during what period must the condition hold?  
**Status** — Satisfied, At Risk, or Unsatisfied.

That third status — At Risk — is what most systems miss, and it is the most operationally valuable. A credential that exists today but will lapse before the obligation's span ends is not a future problem. It is a present problem that has not yet become visible. The platform should surface it now, when there is still time to act.

### On Span: Obligations Are Not Moments

This deserves specific emphasis because it is the point where most operational software fails silently.

An obligation is not evaluated at a point in time. It is evaluated across a span of time. "Valid visa" does not mean "visa is valid today." It means "visa is valid throughout the period this obligation covers." The submission deadline might be July 12th, but if the tournament runs through July 18th, the visa must cover July 18th — not just the submission date.

When the platform understands spans, it can answer questions that point-in-time evaluation cannot:

- Which players will have obligations lapse during the active period of Tournament X?
- Which credentials need renewal before the contract's start date?
- Which obligations are currently satisfied but will become unsatisfied within thirty days?

This last question defines the "At Risk" state, and it is where the platform becomes genuinely proactive rather than merely reactive. Identifying a problem before it becomes critical is the difference between operational intelligence and operational documentation.

---

## On Journeys: The Work That Changes Reality

If Obligations define what must be true, Journeys are the work that makes it so.

A Journey is a bounded operational period during which specific work is done to move an entity's state — or the state of its credentials — from unsatisfied to satisfied. It begins with a trigger and ends when the destination is reached. The entity that the Journey belongs to persists before, during, and after it.

The relationship between Journeys and Obligations gives the platform its operational coherence. Unsatisfied Obligations surface gaps. Journeys exist to close them. When a visa renewal Journey is completed, the Obligation it targeted transitions from Unsatisfied to Satisfied, and the player's readiness in the relevant context improves accordingly.

Journeys are not workflows in the mechanical sense — fixed sequences of steps applied identically to every instance. They are structured passages that know their destination but whose path varies with circumstance. The onboarding Journey for a player arriving from outside the UAE is different from the onboarding Journey for a locally-contracted coach who already has residency. The platform knows the destination: all onboarding Obligations satisfied. How the Journey gets there depends on the entity, the context, and the work required.

**Journeys are the organizational memory of how gaps were closed.** A player's record, viewed across time, shows every Journey they have passed through: onboarding, team transfers, visa renewals, contract renewals, equipment assignments, offboarding. This is not administrative record-keeping. It is accumulated operational intelligence — the history of how the organization has fulfilled its obligations to the people who have worked here.

A Journey has four essential properties: a **type** (what kind of work is this?), a **status** (where is it in its progression?), an **owner** (who is responsible?), and a **destination** (what does complete look like in terms of Obligations satisfied?).

**Journey Playbooks** are the evolution of Journeys as the platform matures. A Playbook is a codified, configurable template for a Journey type — the standard approach to onboarding a player from outside the GCC, or renewing a UAE visa, or executing a team transfer. Playbooks encode organizational knowledge: the steps, the dependencies, the common variations, the edge cases. When a Playbook is applied, it creates a Journey instance — but the Playbook is what ensures consistency, completeness, and organizational learning across every instance.

---

## On Readiness: The Measure of the Gap

Readiness is the continuously maintained evaluation of whether a given entity, in a given context, has all its Obligations satisfied across all required spans.

It is not a field. It is not manually maintained. It is not an assessment done once and stored. It is a live measurement, updated whenever entity state changes, whenever a credential is updated, whenever a Journey completes, whenever an Obligation's span becomes active. The platform computes it. The operator reads it.

Readiness has three states that matter operationally:

**Ready** — all Obligations for this entity in this context are satisfied across their full required spans.

**At Risk** — all Obligations are currently satisfied, but one or more will lapse before their span ends, and the deadline for resolution is approaching.

**Not Ready** — one or more Obligations are currently unsatisfied.

These three states are not equally important to the operator. "Not Ready" tells you about a problem that already exists. "At Risk" tells you about a problem you can still prevent. The most valuable readiness signal the platform can produce is identifying At Risk states early enough that action is still low-cost.

Readiness is **context-dependent**. A player's readiness for payroll (contract active, bank details on file, salary confirmed) is different from their readiness for tournament submission (contract active, passport valid, visa valid, registered with the league, equipment assigned). The same player, the same week, with different answers depending on the context. The platform evaluates readiness in context; it does not produce a single universal readiness score that collapses these distinctions.

Readiness is **actionable**. Every unsatisfied or at-risk Obligation should be directly actionable: the operator can initiate the Journey that would resolve it, navigate to the credential that needs renewal, or understand the specific gap without having to investigate further. The platform does not just describe the gap — it enables the first step toward closing it.

Readiness is not a gate. It is a signal. An operations team may choose to proceed with a player who is assessed as Not Ready — because they have context the platform does not, because a waiver exists, because the situation has changed. The platform's job is to make the state visible and the risk clear. The judgment belongs to the human. The platform records the decision and its outcome, making the organizational history richer for the next time a similar situation arises.

---

## On Workspaces: Where Work Gets Done

A screen shows you information. A workspace lets you do work.

A workspace is an operational environment organized around a **domain** of work. It knows what it owns. It understands the entities within that domain. It surfaces which of those entities have open or at-risk Obligations. It can initiate Journeys on their behalf. It maintains context within a working session — navigating from a register to an entity detail and back is not an interruption, it is a continuation of the same operational engagement.

**A workspace is organized around work, not around data.** The same data may be visible in multiple workspaces, because the same entity can be relevant to multiple operational domains. What changes is the framing — what aspects of the entity matter here, what actions are available, what readiness context applies.

Each workspace follows a consistent structure:

- A **situation layer** — what needs attention right now, surfaced without being asked for
- A **register layer** — the full list of entities in this domain, filterable by readiness state, urgency, and context
- A **detail layer** — the individual entity: its full record, its open Journeys, its Obligations and their current status
- A **journey layer** — the ability to initiate, track, and complete work from within the domain

### Domain Modules, Not Silos

Workspaces present information. Domain modules own it.

This distinction is architecturally important. A domain module owns a set of entity types, credential types, protocol definitions, and journey types. The Talent & Contracts module owns Person and Contract entities, employment document credential types, employment and contract protocols, and onboarding, renewal, and amendment journey types. The Operations & Logistics module owns Equipment and Travel credential types, assignment and travel protocols, and equipment and travel journey types.

But workspaces are not confined to a single module. A workspace is assembled from whatever modules are relevant to the operational role it serves.

The People Workspace draws from the Talent & Contracts module for person records, contracts, and employment credentials — and from Operations & Logistics for equipment assignments — and from Tournaments for league registrations. It does not care which module the data comes from. It presents what an operations coordinator needs to manage a person's full operational state, and it evaluates readiness across all of that data simultaneously.

This is the cross-module readiness capability. Not a feature — a structural principle. The question "Is this player ready for Tournament X?" requires data from multiple modules. The player should never have to assemble that answer by visiting multiple workspaces or cross-referencing multiple systems. The platform assembles it. The operator reads it. The platform enables the action.

Module boundaries define **data and protocol ownership**. Workspace boundaries define **the operational experience**. These are different concerns, and conflating them produces software that is either a silo — each hub a separate application, unable to answer cross-domain questions — or a monolith — everything everywhere, with no coherent ownership of domain knowledge.

The correct model: modules own deeply, workspaces present broadly.

---

## On Mission: An Evaluation

Every model has concepts that are clearly essential, and concepts that are clearly peripheral. Mission sits in an interesting third position: it is clearly real, clearly useful — and already present in the model, just unnamed.

The chain the user proposed: *Mission declares what the organization will do → Context identifies which protocols apply → Protocols generate Obligations → Obligations evaluate against Entities and Credentials → Readiness measures the gap → Journeys close it.*

This chain is correct. And it describes something that the platform already does, implicitly.

When a Tournament entity is created with a submission deadline and a squad, it creates operational context. That context activates the tournament eligibility Protocol. That Protocol generates Obligations for every player on the squad. The platform evaluates Readiness. Gaps surface. Journeys begin.

The Tournament entity is playing the Mission role. The onboarding Journey initiation plays the Mission role for onboarding protocols. The team transfer decision plays the Mission role for transfer protocols. Mission, in the current model, is **embodied by the events and entities that activate context** — not yet a named entity in its own right.

**The evaluation:** Mission belongs in the model. It does not need to be a product feature yet.

Naming Mission explicitly does two things that matter even before it is built:

First, it explains why certain entities and events are operationally significant. A Tournament entry is not just a record — it is a declaration that the organization will compete, which has specific operational consequences that the platform must support. When we understand that the Tournament is playing a Mission role, we design it differently: it owns the Protocol selection for tournament readiness, it defines the squad that Obligations apply to, it carries the timeline that Obligations must cover.

Second, it guides the platform's evolution. As the organization grows — competing in multiple tournaments simultaneously, onboarding multiple players at once, managing team transfers in parallel — the implicit Mission model that works today will need to become explicit. The platform will need to manage multiple concurrent Missions, each selecting its own Protocols, each generating its own set of Obligations against potentially overlapping sets of entities. When that time comes, Mission is already the right concept. The platform just needs to surface it.

For now: Mission is the activating intent. It is currently expressed as entity creation and journey initiation. Future versions of the platform will make Mission explicit — a named operational commitment with defined scope, participants, protocols, and timeline. When that happens, it will not require redesigning the model. It will require surfacing what the model has always described.

---

## What We Reject

Good philosophy knows what it does not believe as clearly as what it does. These are the patterns we have deliberately rejected, expanded to reflect what we now understand more precisely.

**We reject spreadsheet thinking.** Spreadsheets are powerful tools for ad hoc analysis. They are not operational platforms. When a spreadsheet is the system, every new requirement means a new column. Every new team member means copying the spreadsheet and hoping it stays synchronized. Every audit means reconciling versions that have quietly diverged. Spreadsheet thinking produces systems that appear to function until the moment of critical need — when a visa has been expiring for three weeks and nobody noticed because they forgot to check the tab. By the time it is discovered, it is Tuesday night and there are ninety minutes left.

**We reject form-centric design.** A form is a mechanism for data capture. It is not an answer to an operational question. When software is built around forms — when the dominant interaction is "fill this out to complete that action" — the cognitive burden of operation has been transferred to the human. The system collects. The human assembles, interprets, and acts. We want the opposite: the system assembles and interprets; the human decides and acts. Forms will always exist in operational software. They should never be the organizing principle.

**We reject status theater.** Status fields that nobody maintains, dropdown options that nobody agrees on the definition of, records that nobody consults because everyone trusts the spreadsheet instead — this is operational decoration. Every status field on this platform must earn its place. Who changes it? What causes it to change? What is different in the world — in what gets surfaced, what gets triggered, what becomes possible — in each state? If those questions have no clear answers, the field should not exist.

**We reject point-in-time evaluation.** A credential that is valid today but will lapse before the period it needs to cover is not a future problem. It is a present problem that has not yet become visible. Evaluating readiness at a moment in time — rather than across the span that matters — produces false confidence and late discoveries. The platform evaluates obligations across their full required span, not at the moment of inspection.

**We reject siloed readiness.** Readiness that can only be evaluated within a single domain, by a single module, for a single context — is not the readiness that operations actually cares about. The question "is this player ready for tournament submission?" is a cross-domain question. It requires data from contracts, from travel documents, from league registrations, from equipment. If the platform cannot assemble and answer that question from one place, it has not solved the operational problem. It has organized the operational problem into separate folders.

**We reject duplicate data entry.** When the same fact lives in three systems — the contract database, the PIF document, the payroll sheet — you do not have three sources of information. You have three competing sources of uncertainty. They will eventually disagree, and when they do, nobody knows which is authoritative. The platform is the intake system. When information enters here, it does not need to be entered anywhere else.

**We reject workflow for its own sake.** Automation is not inherently virtuous. An automated process that does not solve a clearly understood operational problem is friction dressed in technical clothing — invisible until it breaks, disruptive when it does, harder to remove than to build. Before any automation is created on this platform, the questions must have answers: what decision does this support, who acts on the output, and what happens differently because of it?

**We reject building technology before understanding the problem.** The most expensive mistakes in operational software are made early, when the problem is still blurry. The platform ships, the team adapts their workflow to its constraints rather than their operational reality, and years later everyone maintains workarounds around a system that was built to eliminate them. The cost of restraint is paid once. The cost of premature technology is paid in every use of the system, indefinitely.

**We reject tacit knowledge as a foundation.** When the rules about what constitutes readiness exist only in experienced people's heads, the organization is one departure away from operational fragility. Protocols are how the platform codifies that knowledge — makes it explicit, queryable, consistently applied, and surviving the people who originally carried it.

---

## A Note on Technology

This document has said almost nothing about technology. That is deliberate.

Philosophy precedes implementation. When engineers understand the *why*, they make better decisions about the *how*. They know when to introduce abstraction and when to resist it. They know when a technical pattern serves the operational model and when it is cleverness in search of a problem.

What we can say about technology is simple: it should serve the operational model, not define it. When the technology we choose prevents span-aware obligation evaluation, or prevents cross-module readiness composition, or makes Protocol configuration impractical — we should reconsider the technology before we compromise the model.

Specific technologies will change. Frameworks are replaced. Languages evolve. The operational reality of a professional esports organization — the players who need to be documented, the contracts that need to be managed, the tournaments that need to be won — does not.

Build for that reality. Use the technology that best serves it at the time. Hold the philosophy constant.

The code should conform to this document. Not the other way around.

---

## Closing: What We Are Computing

Beneath all of this — the entities, the credentials, the protocols, the obligations, the journeys, the workspaces, the readiness evaluations — the platform is doing one thing continuously:

It is computing the gap.

The gap between what is true about the organization's operational state and what must be true for the organization to do what it has committed to doing. Every entity is a node in that computation. Every credential is a fact the computation uses. Every Protocol is a rule the computation applies. Every Obligation is a specific claim the computation is checking. Every Journey is work that changes the inputs. Every Readiness evaluation is the computation's output, expressed clearly enough for a human to act on it.

When the gap is zero, the organization is operationally ready. The player is cleared for tournament submission. The squad is eligible to compete. The contract is ready to execute. The onboarding is complete.

That state — zero gap, clear readiness, no surprises at 11pm — is what this platform is being built to make normal. Not exceptional. Not the result of an experienced ops coordinator who remembers to check everything. Normal. The expected outcome of a well-functioning operational intelligence system.

The night before the tournament, someone should be able to open the platform, confirm that all obligations are satisfied, and go to sleep.

That is the platform we are building.

---

*The Geekay Operational Model — Version 2*  
*Geekay Esports · 2026*  
*Companion documents: C3 Product Vision · C3 Conceptual Framework*
