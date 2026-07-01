# C3 Product Roadmap — Backlog Expansion Addendum

**C3 Contract Control Center**
**Date:** 2026-06-29
**Status:** Planning document — no implementation authorised
**Baseline:** Sprint 15 CLOSED at commit `63782b3`, tag `v0.15.0-sp-credentials`

---

## Baseline Reference

Sprint 15 delivered and closed:
> "Live SharePoint credential fetch, mapping, diagnostics, and fail-safe behaviour validated."

What is live as of this document:
- **Credentials** — live from SharePoint (`C3Credentials`)
- **Mock mode** — fully functional; the stable demo and regression baseline

What is not live and is not claimed:
- People, Journeys, Missions, Milestones, Finance, Contracts, Amendments, Command Center, Situation Room, Users/Roles — all remain mock or stubbed
- Full SharePoint-mode UI/gap validation deferred

This document does not alter the Sprint 15 baseline. It expands the backlog horizon from Sprint 16 to productization.

---

## Strategic Vision

C3 is progressing through three distinct phases. Naming them clearly matters because each phase has different risk tolerance, success criteria, and sequencing logic.

**Phase 1 — Proof of Operation (now through Sprint 20)**
C3 works against real SharePoint data. One operator can run one real person through the complete credential → readiness → gap → work item pipeline using live data. No manual spreadsheet required for that workflow.

**Phase 2 — Operator Platform (Sprint 21 onwards)**
C3 governs the full operational lifecycle for all people, journeys, missions, and finances at Geekay. The spreadsheet is fully retired. Multiple operators use C3 with role-appropriate permissions. All write operations are governed through the submission/review/approval pattern.

**Phase 3 — Tournament Operating System / SaaS (future)**
C3 is deployable by any esports organisation. Multi-tenant, configurable, commercially licensed, with onboarding, support, and release cadences.

**This document addresses all three phases. Implementation is currently at the start of Phase 1.**

---

## Track 1 — Core Live Platform

The foundation. Every other track depends on this completing first.

### Subtrack 1A: People

**What it is:** `SharePointPersonService` reading from a provisioned `C3People` SP list. Once live, People Workspace, Person Profile, gap computation, and Situation Room work items all function in SP mode with real data. This is the highest-leverage integration because People is the root entity for every other domain.

**Schema:** Fully specified in `Sprint 16 Planning Memo.md` §1.
**Mapper design:** Documented ibid. Follows S15 credential mapper pattern.
**Dependencies:** `C3People` SP list provisioned by IT. `spPersonMapper.ts` written. People parity harness (local + real SP fetch).

**Classification: NOW (Sprint 16)**

---

### Subtrack 1B: Users and Roles

**What it is:** The `C3_Users` SharePoint list (defined in the S10 baseline as `SP-01`, still outstanding), implementation of `AuthService` against it, and the role-based capability model (`owner / operations / legal / finance / hr / management / visitor`).

**This is not People.** `C3People` holds operational personnel (players, coaches, staff with contracts and credentials). `C3_Users` holds system operators — the humans who log into C3 and need role-differentiated permissions. A person in `C3People` may or may not have a `C3_Users` entry.

**Dependencies:** `C3_Users` list provisioned by IT (SP-01). AuthService implementation. Role-gated capability model wired into AppContext.

**Sequencing note:** Users/Roles is a cross-cutting concern — once implemented, it changes what every screen renders and what every button does. It should be implemented before any write operations are exposed in the UI. However, it does not block read-only service integration (People, Journeys). Implementing it concurrently with Journeys (Sprint 17) rather than in Sprint 16 is safer.

**Classification: NEXT (Sprint 17)**

---

### Subtrack 1C: Journeys

**What it is:** `SharePointJourneyService` (read-only first) reading from `C3Journeys`. Once live, Journey ownership states in Situation Room (`Unrouted / Routed / Covered`) are driven by real data. Journey write operations (initiate, complete, suspend, cancel) go through Power Automate flows and are a separate subtrack.

**Schema:** Fully specified in `Sprint 16 Planning Memo.md` §2. Includes `ObligationAssignmentsJSON` pilot approach and ADR-003 normalisation deferred note.
**Dependencies:** People live (1A). `C3Journeys` SP list provisioned. `spJourneyMapper.ts` written.
**Journey writes:** Deferred to Sprint 17+ and must not be implemented before the Governance/Approval Layer is designed (see Track 2).

**Classification: NEXT (Sprint 17 reads; Sprint 18 writes)**

---

### Subtrack 1D: Live Gap Pipeline

**What it is:** Gap computation running in SP mode with real People and Credentials, extended to full operational coverage once Journeys are live.

**Two-layer readiness model:**

**Layer 1 — Credential eligibility (People + Credentials, available at Sprint 16 close):**
- Gap computation runs with real people and real credentials
- Work items generated for credential gaps (missing Travel Auth, expiring Visa, etc.)
- Command Center and Situation Room show real credential-driven urgency
- Mission participants can be evaluated for basic eligibility: does this person hold the required credentials?

**Layer 2 — Full operational coverage (People + Credentials + Journeys, available at Sprint 17 close):**
- Situation Room ownership state (`Unrouted / Routed / Covered`) reflects real Journey assignments
- Mission readiness can be fully claimed: not just "is this credential valid?" but "is this gap being actively managed?"
- End-to-end Mission validation becomes meaningful
- Journey-assigned ownership and governance accountability are visible

**Important architectural clarification:** This is not a separate sprint deliverable. Both layers emerge automatically from whatever the service layer returns — no new code is required for the views. SP-mode integration tests confirm correctness at each layer.

**The dedicated validation sprint for this should be Sprint 21** (full operator pilot), not a separate implementation sprint.

**Classification: NEXT — emerges from 1A + 1C; validated in Sprint 21**

---

### Subtrack 1E: Contracts and Amendments

**What it is:** `SharePointContractService` reading from the existing `C3_Contracts` SP list. This list already exists (unlike C3People and C3Journeys, which require provisioning).

**Outstanding blockers:**
- BG-02: Disposition null vs empty — incomplete
- BG-06: ContractOwner email format — incomplete
- SP-02: PersonIDId FK population via data migration (PersonID is a Lookup column with numeric ID; listPersonContracts requires `personId: number`, not a text PersonnelCode)

Contracts carry write operations (create contract, renewal, amendment). These require Power Automate flows and the governance pattern (Track 2).

**Classification: NEXT (Sprint 18+, after BG-02 / BG-06 / SP-02 resolved)**

---

## Track 2 — Governance and Approval Layer

**This is the most structurally underestimated track on the roadmap.**

### What it is

A first-class submission/review/approval pattern that applies uniformly across every write operation in C3. The pattern is:

```
Draft → Submitted → In Review → Approved → Operational Truth
                              → Rejected → (back to Draft with notes)
```

"Operational truth" means the approved state is what the system acts on for gap computation, readiness reporting, and work item generation. An unapproved submission does not change the system's view of a person's compliance state.

### Where it applies

Every write path in C3 must go through this pattern:

| Write operation | Submitter | Reviewer/Approver | Operational effect on approval |
|---|---|---|---|
| Admin onboarding (new operator account) | System admin | Platform Owner | User gains system access |
| Person onboarding (new C3People record) | Operations | Platform Owner / HR | Person appears in People Workspace |
| Credential submission (new credential) | Operations / HR | Platform Owner / Legal | Credential counts toward gap computation |
| Journey initiation | Operations | Assigned Journey Owner | Journey status becomes Active |
| PIF / document submission | HR | Legal / Platform Owner | Fields pre-fill Person or Credential record |
| Budget option submission | Owner (researcher) | Platform Owner / Finance | Option flows into Mission Finance budget |
| Mission creation | Operations | Platform Owner | Mission becomes plannable |
| Finance entries (expenses / income) | Finance | Platform Owner | Entry counts toward mission P&L |
| Jersey / logistics requests | HR / Ops | Platform Owner / Logistics | Request enters fulfilment queue |

### Platform Owner concept

The Platform Owner is the single accountable role that holds final approval authority on writes that affect operational truth. This is the governance equivalent of "king approval" in the internal product language. In the system, this maps to the `owner` C3Role in `C3_Users`.

Product wording throughout the UI: **"Pending approval"**, **"Approved"**, **"Rejected"**, **"Submit for review"**. Never expose internal role names in the UI.

### Architectural implications

This pattern cannot be retrofitted cheaply. If Journey write operations are implemented (Sprint 17+) before the governance pattern is designed and locked, two things happen: the first Power Automate flows are built without approval gates, and every flow will need to be rebuilt or extended when governance is added. The same applies to Finance entries, Mission creation, and credential submissions.

**The governance ADR must be written and locked before Sprint 17 starts any write-path implementation.**

### What this requires technically

- A `SubmissionState` field on every write-path entity (`C3Journeys`, `C3Credentials` write side, `C3Missions`, etc.)
- Power Automate flows that gate promotion from Submitted → Approved
- An In-Review screen or panel in C3 where Platform Owners see pending submissions
- Notification flows (email or Teams message) to notify the reviewer
- Audit trail: who submitted, who approved/rejected, when, with what notes

**Classification: NEXT — design ADR in Sprint 16; implement pattern in Sprint 17 before any write operations go live**

---

## Track 3 — Document Intelligence

### What it is

An intelligent document processing pipeline, not a file storage feature. The distinction matters.

Current state: The system can store a document link (PIF URL). That is storage, not intelligence.

Target future flow:

```
Upload document (PIF / Passport / Visa / Emirates ID / Bank Letter)
  → Document Classification (what type of document is this?)
  → Field Extraction (OCR: name, DOB, issue date, expiry, document number)
  → Conflict Detection (does extracted name match C3People.FullName?)
  → Pre-fill (populate Credential or Person record fields from extracted data)
  → Human Review (operator sees extracted fields vs document side-by-side)
  → Approval (governance pattern — Track 2)
  → Approved data becomes Operational Truth
```

### Why "Document Intelligence" and not "OCR"

OCR (optical character recognition) is one low-level capability inside this pipeline. The value of the system is not in reading text from images — it is in classifying what document this is, knowing which fields to extract from which document type, detecting discrepancies with existing records, and routing the result through the governance pattern. "Document Intelligence" names the system for what it does.

### Realistic scope and dependencies

This is a 6–10 sprint programme on its own, not a feature added to another sprint. Dependencies:

1. The governance/approval layer (Track 2) must exist — Document Intelligence is one of its most important input channels.
2. Azure AI Document Intelligence (or equivalent) must be selected, licensed, and integrated. This is a new external dependency with its own auth, rate limits, and cost model.
3. A document storage model in SharePoint (or Azure Blob) must be designed.
4. A review UI must be designed from scratch — this screen does not exist in any current C3 design.
5. A document type taxonomy must be built and maintained (what fields does a UAE Employment Visa have vs a Passport vs an Emirates ID?).

### What should not be done yet

Do not begin Document Intelligence implementation until:
- The governance pattern is live (Track 2)
- A dedicated architecture design sprint has produced a Document Intelligence ADR
- The external AI service has been selected and access provisioned

**Classification: LATER — requires its own planning sprint before any implementation begins**

---

## Track 4 — Tournament Operating System (Mission Layer)

C3's Mission model is already architected for this. The mapping from the Tournament/Event concept to the existing Mission architecture is direct:

| Tournament concept | C3 Mission concept |
|---|---|
| Tournament / Event / Bootcamp | Mission |
| Roster + Staff | Mission Participants |
| Checklist | Mission Milestones |
| Credential readiness check | Mission readiness view (gap pipeline) |
| Budget sheet | Mission Finance (MissionFinanceLine) |
| Expected prize / appearance fee | Mission Finance Income lines |
| Travel / accommodation | Mission Finance Expense lines (per-participant) |
| Situation Room risks | Work items surfaced from Mission context |

The `Mission Finance v1 — Design.md` and `Mission v2 — Operational Planning.md` documents already define the data model and hub-and-spoke facet architecture for this track in full. This document does not redesign them. It sequences their implementation.

### What "Tournament Operating System" means operationally

The full TOS workflow, once implemented:

1. Create Mission (Tournament context: name, game, tier, organiser, prize pool structure, span, jurisdiction)
2. Add Mission Participants (roster + staff from C3People; assign operational roles)
3. Check credential eligibility per participant — Layer 1 readiness (gap pipeline — already exists in mock mode; live in SP mode at Sprint 16 close with People + Credentials)
4. Check full operational readiness per participant — Layer 2 coverage (Routed/Covered state, requires Journeys live at Sprint 17 close)
5. Surface Situation Room work items for credential gaps (already exists in mock mode)
6. Track travel itineraries per participant (Mission v2 Travel facet)
7. Track accommodation blocks (Mission v2 Accommodation facet)
8. Track milestones: visa submission, flight booking, hotel confirmation, tournament registration, etc.
9. Track budget: expected expenses (travel, hotel, per diem, fees), expected income (prize, appearance, stipend)
10. Track actuals vs planned (post-mission settlement)
11. Track expected vs actual income (prize pool realisation)
12. Surface financial risk in Situation Room (e.g., "budget approval required", "prize uncollected")
13. Generate work items for unresolved Milestone items

### Budget Options sub-feature

An assigned owner researches options (flights, hotels, bootcamp venues) and submits them with a link and cost estimate. If the Platform Owner approves the option, it flows into the Mission Finance budget as a confirmed line. This is the planning phase of Mission Finance, not a separate track. It should be designed as part of Mission Finance (Sprint 19) and must go through the governance pattern (Track 2).

### Income tracking

Prize pool realisation is tracked post-mission: expected placement → actual placement → prize received (date, amount, currency). Appearance fees tracked separately (guaranteed amount, payment status). This feeds the Settled state of Mission.Status.

**Classification:**
- Mission creation: NEXT (Sprint 18)
- Mission Participants: NEXT (Sprint 18)
- Mission readiness + Milestones: NEXT (Sprint 19)
- Mission Finance + Budget options: NEXT (Sprint 20)
- Income tracking + Settlement: LATER (Sprint 21+)

---

## Track 5 — Logistics and Jersey Tracking

### What it is

Tracking physical fulfilment for new joiner onboarding: jersey size, jersey status (Ordered / Shipped / Delivered / Not Started), shipping tracking, and who has received what.

### Architectural boundary question

The Logistics Intelligence Hub (an Excel workbook with Dashboard/Log/TRV/EQP/SHP sheets) is a parallel system that already partially models logistics data. Before building logistics tracking into C3, the boundary between C3 and the Logistics Hub must be defined:

- **C3's role:** Surface logistics gaps as work items. Know that a jersey is outstanding. Generate a "Send jersey" work item. Know whether the work item has been actioned.
- **Logistics Hub's role (proposed):** Own the physical fulfilment records — what was ordered, from whom, at what cost, current shipping status, delivery confirmation.

C3 should not own the logistics data — it should consume a status from the Logistics Hub or from a SP list that the Logistics Hub maintains. If C3 and the Logistics Hub both track jersey status independently, data quickly diverges.

**Recommendation:** Design the C3/Logistics Hub boundary as a shared SP list (`C3LogisticsRequests` or similar) that C3 reads for work item generation and the Logistics Hub writes to as fulfilment progresses. This avoids duplication and keeps C3 as the intelligence layer, not the execution layer.

**Classification: LATER (Sprint 22+) — boundary design required first**

---

## Track 6 — Automated Recommendations Engine

### What it is

C3 suggests specific actions based on operational state. The human decides whether to act.

**Distinction from Work Items:** Work Items in the current Situation Room are reactive — they surface gaps that already exist. Recommendations are proactive — they surface actions that should be taken before a gap appears, or that address operational signals not covered by the credential gap model.

**Important reframing:** This track should not be called "AI Recommendations" at this stage. The first 2–3 years of this capability will be rules-based, not ML-based. Rules-based recommendations have the advantage of being explainable, auditable, and trustworthy — which is essential for operations that affect people's visas, employment, and travel.

### Recommendation tiers

**Tier 1 — Rules-based (near-term, achievable now):**
- "CRED-0042 Work Permit expires in 23 days. Initiate renewal journey."
- "PER-0017 has no active Journey. Consider onboarding."
- "Mission TR/2026/009 roster has 2 unresolved credential gaps. Cannot confirm readiness."
- "Prize pool for TR/2026/006 marked expected. Settlement date passed 14 days ago. Follow up."
- "3 jerseys in 'Ordered' status for >30 days. Check shipping status."

**Tier 2 — Configurable rules (admin can define thresholds, Sprint 23+):**
Admin sets: "Warn at 60 days, escalate at 30 days, critical at 14 days" per credential type.

**Tier 3 — AI/ML-assisted (long-term, not before Platform phase):**
Pattern recognition, anomaly detection, suggested action prioritisation based on historical resolution times. This requires 12–18 months of real operational data before it is meaningful.

**Classification:**
- Tier 1 (rules-based recommendations as enhanced Work Items): NEXT (Sprint 22+)
- Tier 2 (configurable rules engine): LATER
- Tier 3 (AI/ML): PRODUCTIZATION

---

## Track 7 — Diagnostics, Error Library, and Admin Health

### What it is

A structured system for operators to understand what is wrong with C3 and how to fix it — without raising a support ticket.

### Components

**Error Library:** Documented codes (like `CRED-XXXX` in the credential mapper) with: error message, root cause, fix steps, SharePoint health check instructions, and links to relevant documentation.

**Setup Validation:** On first load in SP mode, C3 checks whether the required SP lists exist, have the expected columns, and return valid data shapes. Validation results are surfaced in a Diagnostics screen, not buried in `console.error`.

**SharePoint Health Monitor:** Periodic checks that SP lists are accessible (HTTP 200), column names match expected internal names, record counts are non-zero (catches provisioning issues).

**Admin Diagnostics Panel:** Accessible to `owner` role only. Shows: current data source mode, SP site URL, last successful fetch timestamps per service, any active service errors, and SP list column audit results.

**Support Knowledge Base:** In-app help content explaining common setup mistakes, permission errors, and known SP issues. Eventually, searchable.

**Classification: NEXT — basic Diagnostics panel in Sprint 20; full Error Library and Health Monitor in Sprint 22+**

---

## Track 8 — Setup Wizard, Import/Export, and SharePoint Portability

### What it is

Making C3 deployable to a new SharePoint site without requiring a developer.

### Components

**Provision Wizard:** Step-by-step UI or Power Automate script that creates all required SP lists with the correct columns, internal names, and indexes. Currently this is a manual IT task guided by the schema documents.

**Tenant Readiness Validator:** Checks that the target SharePoint site has the necessary permissions, lists, and column configurations before C3 switches to SP mode.

**Schema Export/Import:** Export a C3 schema definition (list names, column specifications) as a portable JSON/YAML file. Import it on a new tenant to provision the same structure.

**Data Export:** Export the full C3 dataset (People, Credentials, Journeys, Missions, Finance) as CSV or JSON for backup, migration, or auditing.

**Site Portability:** Switch C3 to a different SharePoint site without losing data — requires an export from the old site and an import to the new site, validated before switching.

**Classification: LATER (Sprint 23+) — required before any external deployment**

---

## Track 9 — SaaS / Productization

**This track is Phase 3 and should not appear on the near-term roadmap.** It is documented here to ensure the architecture does not inadvertently close off the productization path, but implementation is at minimum 18 months away from the current baseline.

### What productization requires (summary)

- **Multi-tenancy:** Complete tenant isolation in SharePoint (each org on its own tenant or site collection), no shared data between tenants, per-tenant configuration.
- **Branding:** Organisation-configurable branding, logos, colour schemes. Requires a theming system not yet designed.
- **License tiers:** Free / Professional / Enterprise, with feature gating. Requires a billing and entitlement system.
- **Client onboarding:** Self-service or assisted setup. Requires the Setup Wizard (Track 8) to be complete and hardened.
- **Legal and compliance:** Privacy policy, terms of service, data processing agreements. SOC 2 or ISO 27001 if targeting enterprise clients.
- **Support infrastructure:** Ticketing, SLA commitments, 24/7 monitoring.
- **Release cadence:** Quarterly releases with change communications and client-facing release notes.
- **Client feedback loop:** Structured feedback collection, satisfaction reporting, NPS tracking.

**Architecture decisions that affect productization readiness:**
- C3 is already deployment-agnostic (AppConfig injected by host) — this is a good foundation.
- The SPFx host is Geekay-specific. A productized version would need a generic web host (iframe embed, standalone web app, or a configurable SPFx solution deployable to any tenant).
- All hardcoded references to `geekaygames.sharepoint.com` must be parameterised.

**Classification: PRODUCTIZATION — not before Phase 2 pilot validation complete**

---

## Master Classification Table

| Track / Item | Classification | Earliest Sprint | Hard Blocker |
|---|---|---|---|
| People SP integration (`spPersonMapper`, `SharePointPersonService`) | **NOW** | S16 | `C3People` provisioned |
| People schema doc (IT handover) | **NOW** | S16 pre-work | — |
| Journeys schema doc (IT handover) | **NOW** | S16 pre-work | — |
| Governance ADR (design only, no impl) | **NOW** | S16 | — |
| Users/Roles (`C3_Users`, `AuthService`, capability model) | **NEXT** | S17 | SP-01 provisioned |
| Journey SP reads (`spJourneyMapper`, `SharePointJourneyService`) | **NEXT** | S17 | People live; `C3Journeys` provisioned |
| Journey write ops (initiate, complete, suspend — Power Automate) | **NEXT** | S18 | Governance ADR locked; Users/Roles live |
| In-Review screen (pending approvals queue) | **NEXT** | S18 | Governance ADR locked |
| Contracts SP integration | **NEXT** | S18 | BG-02, BG-06, SP-02 resolved |
| Mission creation | **NEXT** | S19 | Journeys live; Governance pattern live |
| Mission Participants | **NEXT** | S19 | Mission creation; People live |
| Mission Milestones | **NEXT** | S19 | Mission creation |
| Basic Diagnostics panel (admin health) | **NEXT** | S20 | Users/Roles live |
| Mission Finance + Budget Options | **NEXT** | S20 | Mission live; Governance pattern live |
| Full SP-mode operator pilot validation | **NEXT** | S21 | People + Journeys + Missions live |
| Income tracking + Mission settlement | **LATER** | S22 | Mission Finance live |
| Enhanced Situation Room (SP-driven) | **LATER** | S21 | People + Credentials + Journeys live — emerges automatically |
| Tier 1 rules-based recommendations | **LATER** | S22 | Full SP pipeline live |
| Full Error Library + Health Monitor | **LATER** | S22 | Basic Diagnostics live |
| Logistics / Jersey tracking (C3 side) | **LATER** | S22 | Boundary design with Logistics Hub |
| C3/Logistics Hub boundary design | **LATER** | S21 | — |
| Document Intelligence architecture ADR | **LATER** | S22 | Governance live; external AI service selected |
| Document Intelligence implementation | **LATER** | S23+ | Architecture ADR approved |
| Setup Wizard + Provision scripts | **LATER** | S23 | Full SP list schema stable |
| Schema export/import | **LATER** | S23 | Setup Wizard done |
| Configurable rules engine (Tier 2 recommendations) | **LATER** | S24 | Tier 1 live and validated |
| Tenant branding/theming | **PRODUCTIZATION** | — | Full pilot complete |
| Multi-tenancy | **PRODUCTIZATION** | — | Track 8 complete |
| License tiers / billing | **PRODUCTIZATION** | — | Multi-tenancy complete |
| SaaS client onboarding | **PRODUCTIZATION** | — | All prior productization items |
| AI/ML recommendations (Tier 3) | **PRODUCTIZATION** | — | 12–18 months of real operational data |

---

## Recommended Sprint Sequence

The following is my recommendation, not a restatement of the proposed sequence. Differences from the proposal are explained in the critique section below.

### Sprint 16 — People Integration + Governance ADR

**Deliverables:**
- S16-1: C3People SP list schema document (IT handover format)
- S16-2: C3Journeys SP list schema document (IT handover format)
- S16-3: `spPersonMapper.ts` — pure utility, no SP access, 87+ test cases
- S16-4: `SharePointPersonService` reads — `listAllPeople`, `getPerson`
- S16-5: People local parity harness (mirror + stress)
- S16-6: Real SP fetch parity (People) — gate for sprint close
- S16-7: Governance ADR — written and locked; no implementation

**Sprint 16 does not include:** Users/Roles implementation, Journey writes, Approval gate UI.

**What Sprint 16 delivers operationally:** Layer 1 mission readiness — credential eligibility checks against real People and Credential data. Gap computation, work items, and basic Mission participant readiness all function in SP mode. Ownership state (Routed/Covered) requires Journeys and is not available until Sprint 17.

**Rationale:** People integration is the critical path. Users/Roles adds significant complexity (new SP list, AuthService, capability model refactor) and is not needed for read-only People integration. Trying to do both in S16 creates scheduling risk for the People gate.

---

### Sprint 17 — Journey Reads + Users/Roles

**Deliverables:**
- S17-1: `spJourneyMapper.ts` — includes `ObligationAssignmentsJSON` parsing
- S17-2: `SharePointJourneyService` reads only
- S17-3: Journey parity harness
- S17-4: Real SP fetch parity (Journeys) — gate for sprint close
- S17-5: `C3_Users` SP list provisioned (SP-01)
- S17-6: `AuthService` implementation against `C3_Users`
- S17-7: Role-based capability model wired into AppContext and screens

**At S17 close:** Both readiness layers are live. Layer 1 (credential eligibility) was already live at S16 close. Layer 2 (full operational coverage — Routed/Covered ownership, Journey-based accountability) is now live. Gap computation, Situation Room ownership state, and role-gated UI all reflect real SP data. End-to-end Mission validation is now possible.

---

### Sprint 18 — Write Operations + Governance Implementation

**Deliverables (governed by ADR from S16-7):**
- S18-1: Journey initiation (Power Automate flow + C3 trigger)
- S18-2: Journey completion / suspension / cancellation flows
- S18-3: In-Review screen (pending approvals queue for Platform Owner)
- S18-4: Credential submission write path + approval flow
- S18-5: Notification flows (email/Teams for pending approvals)
- S18-6: Contracts SP integration (if BG-02/BG-06/SP-02 are resolved)

**Do not start S18 write implementations until the Governance ADR from S16-7 is locked.**

---

### Sprint 19 — Mission Creation + Participants + Milestones

**Deliverables:**
- S19-1: Mission creation (SP list + write flow)
- S19-2: Mission Participants (roster + staff assignment)
- S19-3: Mission Milestones (checklist, status tracking)
- S19-4: Mission readiness view wired to live People + Credential data
- S19-5: Mission-scoped work items in Situation Room

---

### Sprint 20 — Mission Finance + Basic Diagnostics

**Deliverables:**
- S20-1: `MissionFinanceLine` SP schema + service
- S20-2: Budget options submission + approval (governance pattern)
- S20-3: Mission Finance UI (income, expenses, planned vs actual)
- S20-4: Basic Diagnostics panel (admin only: service health, list validation)

---

### Sprint 21 — Operator Pilot Validation

**This sprint produces no new features. It validates the entire platform against real operational data and a real operator walkthrough.**

Deliverables:
- S21-1: Full SP-mode walkthrough with a real Geekay operator (not test data)
- S21-2: End-to-end validation: onboard a person → enter credentials → initiate journey → confirm mission → check readiness → surface work items → resolve items → complete journey
- S21-3: Stress test: edge cases, permission errors, missing SP columns, unsupported CredentialTypes
- S21-4: C3/Logistics Hub boundary design document
- S21-5: Document Intelligence ADR scope and planning document

**Sprint 21 is the gate between Phase 1 (Proof of Operation) and Phase 2 (Operator Platform).**

---

### Sprint 22+ — Income Tracking, Recommendations, Logistics, Error Library

Exact sprint boundaries depend on pilot validation findings. These items are confirmed for sequencing but not sprint-assigned.

### Sprint 23+ — Document Intelligence, Setup Wizard

Depends on Architecture ADRs produced in S21–22.

### Productization Track — Not before S21 pilot complete

---

## Critique of the Proposed Roadmap

The proposed sequence was: S16 People + Users/Roles + Approval Gate → S17 Mission/Tournament → S18 Readiness + Milestones → S19 Finance → S20 Command Center/Situation Room live.

### What the proposed sequence gets right

- The overall directionality is correct: People → Missions → Finance → live pipeline.
- Identifying Users/Roles as early work is correct — the sooner role-gated UI is live, the safer the write operations that follow.
- The finance sequencing after Mission creation is correct.

### What the proposed sequence gets wrong or underestimates

**1. Sprint 16 is overloaded.**

People integration alone (spPersonMapper + SharePointPersonService + parity harness + real SP validation) is a full sprint that includes IT dependencies. Adding Users/Roles (SP-01, AuthService, capability model refactor) and Approval Gate planning to the same sprint creates a scheduling scenario where an IT provisioning delay on either `C3People` or `C3_Users` blocks the entire sprint. These are serial dependencies on an external team.

**Recommendation:** People in S16. Users/Roles concurrent with Journeys in S17. Governance ADR design (documentation only) in S16.

**2. Journey integration is missing from the proposed sprint sequence.**

The proposed roadmap jumps from People (S16) to Mission creation (S17) without an explicit Journey integration sprint. Journeys are a hard dependency for Mission readiness — a Mission without Journey data cannot show ownership state, Routed status, or gap coverage. Building Mission creation before Journeys are live in SP mode means the Mission readiness view will show empty data, and the Sprint 17 work cannot be validated against real end-to-end data.

**Recommendation:** Journey reads (S17) before Mission creation (S18/S19).

**3. "Approval Gate planning" in S16 is not enough.**

The governance pattern touches every write operation the platform will ever have. Calling it "planning" suggests it can be deferred or done partially. If Journey write operations begin in Sprint 18 without the governance ADR locked, the first Power Automate flows will be built without approval gates and will need to be rebuilt. This is avoidable.

**Recommendation:** The governance ADR must be fully written, reviewed, and locked in Sprint 16 — not just "planned". Implementation begins in Sprint 18 with the first write operations.

**4. "Command Center / Situation Room live from SharePoint data" is not a sprint — it is a test.**

The Command Center and Situation Room do not require new implementation when People + Credentials + Journeys are live. They consume `useWorkItems()` which calls `computeGapsForPeople()` which uses whatever the services return. Once the three service integrations are complete and validated, these screens automatically reflect real data. Assigning them a dedicated sprint implies there is implementation work — there is not.

**Recommendation:** Remove S20 "Command Center/Situation Room" as a standalone sprint. Replace it with Mission Finance (S20) and designate S21 as the Operator Pilot validation sprint, which includes confirming that Command Center and Situation Room show correct data end-to-end.

**5. Missions before Journeys gives only partial readiness.**

Mission readiness has two layers. People + Credentials (available at Sprint 16 close) already enable Layer 1: credential eligibility checks per participant, gap computation, and basic "does this person hold the required credentials?" answers. That is genuinely useful and can be demoed.

However, Layer 2 — full operational readiness, including Situation Room ownership state (`Unrouted / Routed / Covered`) — is determined by active Journey data. If Missions are built before Journeys are live in SP mode, the ownership view will show all participants as Unrouted regardless of reality. You can demo Mission creation and credential eligibility, but you cannot demo or validate end-to-end Mission readiness.

**Recommendation:** This does not change the sequencing. Journey reads (S17) should still precede Mission creation (S18/S19). The clarification is that Sprint 16+Mission demos can be conducted with Layer 1 readiness only, and the team should be explicit with stakeholders about what "readiness" means at each stage.

**Recommendation:** Journey reads live (S17) before Mission creation (S18/S19).

**6. The PIF / Document Intelligence track is severely underestimated.**

Listing it as "Later" without a time estimate or dependency chain implies it could begin in Sprint 22–23. In reality, Document Intelligence requires: a governance layer (Track 2), an external AI service selection and provisioning, a document storage model design, a review UI design (the screen does not exist), and a document type taxonomy. This is a 6–10 sprint programme that requires its own architecture planning sprint before any implementation begins. It should not appear on the near-term roadmap as an implementable item.

**Recommendation:** Create a Document Intelligence ADR planning item in Sprint 21 after the operator pilot reveals what the actual document processing pain points are.

**7. AI Recommendations is mischaracterised.**

"AI Recommendations" implies ML-based predictions. The operational value deliverable for the next 2–3 years is rules-based proactive suggestions: "visa expires in 23 days — initiate renewal". This is achievable, auditable, and trustworthy. ML-based recommendations require historical data the system does not yet have and would not be trustworthy without it.

**Recommendation:** Rename to "Automated Recommendations Engine" and explicitly split into Tier 1 (rules-based, Sprint 22+) and Tier 3 (AI/ML, Productization phase).

---

## What Should Explicitly Not Be Built Yet

The following items should not enter implementation scope until specific conditions are met. Building them early would either create architectural debt, block integration testing, or produce features that cannot be validated.

| Item | Why not yet | Condition to unlock |
|---|---|---|
| Journey write operations | Governance ADR not locked; retrofitting approval gates is expensive | Governance ADR locked (S16) |
| Finance write operations | Same as Journey writes | Governance ADR locked; Mission creation live |
| Credential submission write path | Same | Governance ADR locked |
| Document Intelligence | Architecture not designed; external service not selected | Document Intelligence ADR complete (S21 output) |
| `spPersonMapper.ts` and `SharePointPersonService` | Already unlocked — can begin now | — |
| AI/ML recommendations (Tier 3) | No historical data to train on; operations not yet running from SP | 12–18 months of real operational data post-pilot |
| Multi-tenancy | Internal pilot not yet validated; SPFx host is Geekay-specific | Full Phase 2 pilot complete |
| License tiers / billing | No external clients yet | Productization track prerequisites met |
| SaaS branding/theming | No design spec; no external clients | Productization track prerequisites met |
| `ObligationAssignmentsJSON` → normalised child list migration | Pilot data volume is manageable as JSON; migration before write operations are implemented is premature | Journey write operations in production and showing scale limitations |
| Contracts SP integration | BG-02, BG-06, SP-02 outstanding; without these, wrong data will be returned silently | All three blockers resolved |

---

## Open Decisions Required Before Sprint 16 Begins

The following decisions must be made before implementation starts. They are not implementation tasks — they are design choices with architectural consequences.

**1. Who is the Governance Approver in the system?**
The `owner` C3Role is proposed as the Platform Owner with final approval authority. Is there ever a case where `legal` or `finance` approves something without `owner` involvement? The ADR must specify the approval authority model unambiguously.

**2. What is the ObligationAssignmentsJSON migration trigger?**
ADR-003 defers the normalised child list until the JSON approach shows limitations. What is the explicit trigger? A count of journey obligation assignments per record? A write operation that requires querying assignments independently? Define the trigger in the Governance ADR so there is no ambiguity later.

**3. What is the C3 / Logistics Hub boundary?**
Before jersey tracking enters C3, the boundary with the Logistics Intelligence Hub must be documented. Who owns the physical fulfilment record? Who surfaces the gap? Who marks the item resolved? This decision should be in a boundary design document before Sprint 22.

**4. Is the `C3_Users` list separate from `C3People`?**
The architecture baseline assumes yes. Confirm that a Geekay employee who is both a C3 operator (has a `C3_Users` entry) and a managed person (has a `C3People` entry) will have two separate SP records with a defined cross-reference, and that there is no plan to merge these lists.

**5. Is the SPFx host the permanent deployment model?**
For the internal pilot, yes. For productization, a generic web application host is more likely. The architecture already separates runtime from host, so this is not a blocking decision for Sprint 16. But it should be recorded as a pending productization decision so the SPFx-specific code paths (property pane, `disableToasts` flag) are not hardened as permanent architecture.

---

*This document supersedes the roadmap section of the Sprint 16 Planning Memo. The Sprint 16 Planning Memo remains authoritative for the technical schema and mapper specifications for People and Journeys.*

---

## Post-Beta Foundation Capabilities

> **Status:** Documentation only. None of the items in this section are authorised for implementation.
> **Recorded:** 2026-07-01 (Sprint 20 closeout)

---

### INDUCTION-01 — Induction

**Title:** Induction
**Priority:** P1 / Post-beta foundation
**Status:** Planned — not implemented, no UI, no schema

#### Definition

Induction is the guided C3 operational workflow that takes a person from intake to operational readiness. It is an orchestration layer, not a replacement for Journey or Mission.

| C3 concept | Role |
|-----------|------|
| **Journey** | Tracks onboarding/governance work — the what and who of the compliance record |
| **Mission** | Tracks operational commitment/event participation — the where and when |
| **Induction** | Guides the operator through setting up the person, contract, credentials, readiness, and mission linkage in a single coherent flow |

#### Conceptual flow

```
Person intake
  → Contract details (C3 contract record)
  → Credential submission (through ADR-013 approval loop)
  → Readiness / Journey initiation
  → Link to existing Mission  OR  Create new Mission with this person included
  → Generate missing obligations / operational gaps
  → Done (person is operationally ready)
```

#### Backlog description

A guided operational workflow that converts a person into an operationally ready participant by collecting contract details, submitting credentials through the ADR-013 governed approval loop, confirming onboarding/readiness, and linking the person to an existing or new mission. The operator is walked through each stage with pre-validation, progress tracking, and resolution of gaps before the next stage begins.

Induction is not a screen replacement — it is an orchestrated step sequence that calls the existing screens and services in a defined order. No new SP lists or schema changes are introduced by Induction itself.

#### Dependencies (all must be live before Induction can be implemented)

| Dependency | Status |
|-----------|--------|
| Person write path (C3People governed write) | Not yet implemented |
| Contract/SP-02 FK alignment | Not yet implemented |
| Credential governed write path | ✅ Live (Sprint 20 Phase 3) |
| Mission participant write path | Not yet implemented |
| Mission creation/linking | Not yet implemented |
| Operational gap generation (SP mode, live people + credentials) | Partial (credentials live S15; People live S16) |
| Approval history / audit visibility | ✅ Live (Sprint 20 Phase 1) |

**Minimum unlocked when:** Person write path + Contract/SP-02 + Mission participant write path are all live.

#### Positioning boundaries

- Induction does not replace Journey. Journey creation remains a governed ADR-013 operation triggered independently.
- Induction does not replace Mission. Mission creation remains a separate governed operation.
- Induction does not bypass the ADR-013 approval loop for any write operation. Credential submissions made during Induction still create C3Approvals records and require Platform Owner approval.
- Induction is UI-only orchestration — no new service interfaces, SP lists, or schema columns.

#### Recommended Sprint

Not before Sprint 23. Blocked by Person write path (post-beta), Contract/SP-02, and Mission participant write path.

