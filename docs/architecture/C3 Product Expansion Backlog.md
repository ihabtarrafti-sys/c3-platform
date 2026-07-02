# C3 Product Expansion Backlog
**C3 Contract Control Center**
**Created:** 2026-07-01
**Status:** Living document — planning only. No implementation authorised from this document alone.
**Baseline:** Sprint 25 CLOSED (HEAD: `d8763ea`)
**See also:** C3 Architecture Baseline — Sprint 25.md, Sprint 25 Closeout Report.md, C3 Tech Debt Register.md, C3 Product Roadmap and Backlog Expansion Addendum.md (Sprint 15 era, historical)

> **Purpose:** Single-source register of planned C3 capability tracks beyond the current beta sprint sequence. Each entry records what the capability is, what it depends on, and when it is expected relative to the current sprint cadence. This document is a backlog and planning reference only — individual sprint scopes are authorised separately. Nothing in this document implies implementation is authorised or imminent.

---

## Track index

| # | Capability | Track | Timing |
|---|-----------|-------|--------|
| 1 | Beta Operational Readiness | Beta hardening | Sprint 22 |
| 2 | Error Library | Beta hardening | Sprint 22–23 |
| 3 | Admin Recovery Tools | Beta hardening / production readiness | Beta hardening |
| 4 | User/Admin Onboarding Approvals | Governance | Before wider rollout |
| 5 | Contracts / SP-02 | Core platform | After beta readiness |
| 6 | Mission / Event Foundation | Core platform | After Contracts |
| 7 | Mission Participants | Core platform | After Mission foundation |
| 8 | Jersey / Logistics Tracking | Operations | After Mission Participants |
| 9 | Mission Budgeting | Finance | After Mission foundation |
| 10 | Budget Sheet Approval Workflow | Finance / Governance | After Mission Budgeting |
| 11 | Mission Finance / Income | Finance | After Mission Budgeting |
| 12 | Operational Gaps | Intelligence | After Missions + Contracts + Credentials stable |
| 13 | AI Recommendations | Intelligence | After enough operational data |
| 14 | Player/Staff Readiness Recommendations | Intelligence | After Operational Gaps |
| 15 | Induction | Orchestration | After Contracts + Missions + Gaps |
| 16 | SharePoint Import / Export | Data management | Before production scale |
| 17 | Standalone SaaS Path | SaaS / productization | Later |
| 18 | C3 SaaS Admin Console | SaaS / productization | Later |
| 19 | Productization / Distribution Expansion | SaaS / productization | Later |

---

## Sequencing summary

```
Sprint 22  — Beta Operational Readiness + Error Library basics
Sprint 23  — Credential Lifecycle Hardening (DeactivateCredential, recovery) ✅ CLOSED
Sprint 24  — Contracts / SP-02 Foundation (read path, PersonID FK) ✅ CLOSED
Sprint 25  — Governed AddPerson Foundation (ADR-013 approval path for C3People writes) ✅ CLOSED
Sprint 26  — Mission / Event Foundation (shifted from S25)
Sprint 27  — Mission Participants + Jersey / Logistics Tracking
Sprint 28  — Mission Budgeting + Budget Sheet Approval Workflow
Sprint 29  — Operational Gaps + Readiness Recommendations
Sprint 30  — Induction

Later      — SharePoint Import/Export
           — AI Recommendations expansion
           — Standalone SaaS Path
           — C3 SaaS Admin Console
           — Productization / Distribution Expansion
```

This sequence is indicative. Sprint scopes are confirmed separately at sprint planning time. Individual tracks may be split across multiple sprints or reordered as dependencies resolve.

---

## Capability tracks

---

### 1 — Beta Operational Readiness

**Track:** Beta hardening
**Timing:** Sprint 22 candidate
**Type:** Process and documentation

#### Description

Formalise the end-to-end operational process for deploying and running C3 in a new SharePoint environment. Currently the deployment process, smoke-test process, and go/no-go criteria exist only in informal knowledge and the Sprint 21 Beta Checkpoint. This track converts that knowledge into repeatable, auditable artefacts.

#### Scope

- Release checklist: steps from clean repo to deployed SPFx webpart in a target SP environment
- Deployment process: step-by-step guide for IT/admin to provision lists, groups, and deploy the SPPKG
- SP permissions checklist: required lists, columns, groups, and access levels confirmed before go-live
- Smoke-test process: minimal end-to-end validation for a freshly deployed environment (subset of Beta Checkpoint)
- Go/no-go criteria: binary gate checklist for declaring the environment ready for operator use
- Runtime process: day-to-day operational guide (how to run a weekly validation pass, how to triage alerts, how to escalate)
- Timing guidance: what to do before a beta session, after a session, before a sprint update

#### Dependencies

- Beta Checkpoint — Sprint 21 (complete)
- At least one real beta deployment completed (to validate the process against reality)

#### Not in scope

- CI/CD automation (TD-14)
- Power Automate notification flows
- Any source code changes

---

### 2 — Error Library

**Track:** Beta hardening
**Timing:** Sprint 22–23 candidate
**Type:** Documentation and operator support

#### Description

A structured, searchable catalogue of every known error class, toast message, and exception that C3 can surface — with cause, fix, and recovery steps for each. Currently, error handling knowledge lives in code comments, PR descriptions, and informal team knowledge.

#### Scope

- All known error classes and toast messages (source: `useExecuteApproval`, `useRecoverExecutionStamp`, `useRecoverCredentialExecutionStamp`, journey transition guards, SP service errors)
- For each error: error name / class, when it occurs, root cause, operator-visible message, recovery steps, whether manual SP intervention is required
- Admin/owner notes: which errors require a Platform Owner to act vs. which are self-service
- Severity rating for each error (user error / recoverable / requires admin / data risk)
- Organised by surface: Approval Inbox, PersonProfile, Journey lifecycle, Credential write path, SP connectivity

#### Known errors to cover (initial list)

| Error | Surface | Notes |
|-------|---------|-------|
| `PartialExecutionError` | ApprovalInbox | Journey created, stamp failed — recovery UX live (S20-P2) |
| `PartialCredentialExecutionError` | ApprovalInbox | CRED created, stamp failed — recovery UX live (S21-P1) |
| `RecoveryTargetMissingError` | ApprovalInbox | Journey missing at stamp time — no write |
| `CredentialRecoveryTargetMissingError` | ApprovalInbox | CRED missing at stamp time — no write |
| `RecoveryPreConditionError` | ApprovalInbox | Pre-condition guard failed before recovery attempted |
| `CredentialRecoveryPreConditionError` | ApprovalInbox | Same, credential path |
| `PayloadValidationError` | ApprovalInbox | Corrupt/missing payload — execution blocked |
| `DuplicateJourneyError` | ApprovalInbox | Second journey for same person — stamps ExecutionFailed |
| `InvalidTransitionError` | PersonProfile | Invalid journey lifecycle transition |
| Form digest errors | Any SP write | Expired digest — transient, retry |
| SP connectivity errors | Any SP fetch | Network / auth failure in SP DSM |
| TMP-* orphan row | C3Approvals / C3Credentials | POST succeeded, MERGE failed |

#### Dependencies

- Beta Checkpoint — Sprint 21 (for error surface reference)
- Error classes in source code (packages/c3/src/hooks/, packages/c3/src/services/)

---

### 3 — Admin Recovery Tools

**Track:** Beta hardening / production readiness
**Timing:** Beta hardening phase; before production scale
**Type:** Tooling and process

#### Description

A set of documented and (where appropriate) scripted recovery procedures that a C3 admin or Platform Owner can use to repair stuck, inconsistent, or corrupted records in SharePoint without needing to write raw SP REST calls from scratch. Complements the Error Library by providing the operational tooling, not just the description.

#### Scope

- Approval record repair: script/runbook for setting ApprovalStatus on a stuck record (e.g. setting Approved → ExecutionFailed when execution never ran)
- Failed execution repair: runbook for confirming whether a partial execution left orphan rows, and how to clean them up
- TMP-* orphan row cleanup: script to identify and remove TMP-* titled rows in C3Approvals and C3Credentials
- Bad mapping / data recovery: process for correcting a CRED-XXXX or APR-XXXX row where the payload or TargetPersonID was set incorrectly
- Recovery validation checklist: after any manual repair, confirm the record state is consistent before resuming operations
- Access requirements: documents what SP permissions the admin needs to run each recovery procedure

#### Dependencies

- Error Library (Track 2) — admin tools reference specific error classes
- Beta Checkpoint — Sprint 21 (for list schema reference)

#### Not in scope

- Automated repair scripts (require CI/CD — TD-14)
- Any source code changes to C3 itself

---

### 4 — User/Admin Onboarding Approvals

**Track:** Governance
**Timing:** Before wider rollout (before non-beta users are added)
**Type:** Process and (optionally) tooling

#### Description

A governed process for adding new users to C3 and assigning them roles. Currently, C3 role assignment is managed by directly adding users to SharePoint security groups (`C3 Platform Owners`, `C3 Operations`). There is no formal approval workflow for granting C3 access. Before C3 is rolled out beyond the initial beta cohort, this gap should be closed.

#### Scope

- Approval workflow: how a request to add a user to a C3 role is submitted, reviewed, and approved
- Role assignment: who can grant each role (owner, operations, management, hr, legal, finance, visitor), with what approval
- Admin access setup: documented process for IT to add users to SP security groups after approval
- Access governance: periodic review process (who has what role, when was it last reviewed)
- Offboarding: process for removing a user from C3 roles when they leave or change position

#### Implementation options (planning only)

- Option A: Process-only (documentation + existing SP group management, no code changes)
- Option B: Light tooling (a form or checklist in SP that records the approval request and outcome)
- Option C: ADR-013 governed operation (a new `GrantCXXXRole` operation type through C3Approvals — highest governance rigour, highest implementation cost)

#### Dependencies

- SP security group structure (already in place)
- Access governance policy decision (who owns this process)

---

### 5 — Contracts / SP-02

**Track:** Core platform
**Timing:** S24 delivered read foundation. Contract writes and approval workflow are Sprint 25+ scope.
**Status:** 🔵 Partial — read path live in Mock DSM; SP DSM pending C3Contracts provisioning
**Type:** Feature — data foundation

#### Description

SharePoint-backed contract records for people managed in C3. Currently `SharePointContractService` returns `[]` (graceful stub). Contracts are a foundational dependency for the readiness model: a person's operational gap state includes "missing contract", and Induction requires a contract before it can proceed.

#### Scope

- Provision `C3Contracts` SP list (or resolve FK mismatch on existing SP-02 contract list)
- Implement `SharePointContractService` using native-fetch pattern (replacing the existing PnP.js version — see TD-04)
- Contract record: person linkage (PersonID), contract type, start date, end date, status
- Contract read path: display on PersonProfile (contract card)
- Contract write path: governed ADR-013 operation (`AddContract` or equivalent)
- Operational gap integration: "missing contract" gap fires when a person has no active contract

#### Dependencies

- IT provisioning: `C3Contracts` SP list (or SP-02 FK alignment)
- `C3People` live (Sprint 16 — complete)
- PersonProfile (Sprint 20 — complete)

#### Not in scope (this track)

- Contract amendment tracking (separate track — currently stub)
- Multi-contract management (phase 2)

---

### 6 — Mission / Event Foundation

**Track:** Core platform
**Timing:** Sprint 26 — **read foundation delivered**; write path deferred to a future sprint
**Type:** Feature — data foundation

#### Description

SharePoint-backed records for tournaments, events, and operational missions. Missions are the
organisational anchor for participants, budgets, logistics, and finance. Nothing in the
Mission/Finance tracks can be built until Mission foundation is live.

#### Scope / Status (updated S26)

- ✅ `C3Missions` SP list schema defined (`docs/architecture/C3Missions SP List Schema.md`) — IT provisioning pending
- ✅ `SharePointMissionService` read path (`listMissions` / `getMission`) — native fetch, 404-safe, `spMissionMapper`
- ✅ Mission Workspace screen — read-only register (cards + KPI strip); visible in Mock DSM, hidden in SP DSM until provisioning (TD-25)
- ✅ Mission record uses the existing frozen business model (`MissionID` TR/SATR code, Name, Game, Organizer, Entity, Status, Jurisdiction, Span, OperatingCurrency) — the generic fields originally sketched here (type/owner) were superseded by the existing mission model
- ⬜ Mission write path: create mission (governed ADR-013 or direct role-gated, TBD at sprint planning) — deferred
- ⬜ Mission linkage to people: groundwork for Mission Participants (Track 7) — Sprint 27

#### Dependencies

- ~~Contracts / SP-02 (Track 5)~~ — met (S24)
- IT provisioning: `C3Missions` SP list (schema doc ready; still the blocker for SP DSM visibility)

---

### 7 — Mission Participants

**Track:** Core platform
**Timing:** After Mission / Event Foundation; Sprint 27 target
**Type:** Feature

#### Description

Link people to missions/events. Track who is assigned to each mission, their assigned role within the mission, and their readiness state relative to mission requirements.

#### Scope

- `C3MissionParticipants` SP list (or junction in `C3Missions.ObligationAssignmentsJSON` — decision at sprint planning)
- Add participant to mission: governed write or direct role-gated (TBD)
- Remove participant from mission
- Mission view: participant list with readiness indicators (credentials, journey, contract status)
- PersonProfile: "Missions" section showing missions this person is assigned to

#### Dependencies

- Mission / Event Foundation (Track 6)
- PersonProfile (Sprint 20 — complete)
- Operational readiness state per person (Credentials live S15/S20, Journey live S18)

---

### 8 — Jersey / Logistics Tracking

**Track:** Operations
**Timing:** After Mission Participants; Sprint 27 target (alongside Track 7 or Sprint 28)
**Type:** Feature

#### Description

Track physical logistics items (jerseys, equipment, credentials documents) per person per mission. Record sizes, shipment state, and delivery confirmation.

#### Scope

- Jersey size per person: stored on person record or as a logistics record
- Shipment/delivery state: enum (Not ordered / Ordered / Shipped / Delivered / Confirmed)
- Logistics ownership: who is responsible for ordering and confirming
- Event/person linkage: logistics record tied to a Mission Participant record
- Logistics write path: governed write or direct operations-role write (TBD)
- Logistics view: logistics section on Mission view, logistics column on Mission Participants list

#### Dependencies

- Mission Participants (Track 7)
- PersonProfile (Sprint 20 — complete)

---

### 9 — Mission Budgeting

**Track:** Finance
**Timing:** After Mission / Event Foundation; Sprint 26 target
**Type:** Feature

#### Description

Track planned and actual budget per mission/event. Each mission has an associated budget record with planned spend, actual spend, and variance. Budget records are the foundation for budget sheet approval workflow (Track 10) and mission finance/income reporting (Track 11).

#### Scope

- `C3MissionBudgets` SP list (or budget columns on `C3Missions`)
- Budget record: mission linkage, budget owner, currency, planned total, actual total, variance
- Budget line items: categories (travel, accommodation, logistics, entry fees, other)
- Budget write path: governed ADR-013 operation (`SetMissionBudget` or equivalent)
- Budget read path: budget section on Mission view

#### Dependencies

- Mission / Event Foundation (Track 6)

---

### 10 — Budget Sheet Approval Workflow

**Track:** Finance / Governance
**Timing:** After Mission Budgeting; Sprint 26 target (alongside Track 9 or Sprint 27)
**Type:** Feature

#### Description

Upload or import a budget sheet for a mission and route it through an approval workflow before the budget is activated. Ensures budget spend authority is governed before operational commitments are made.

#### Scope

- Budget sheet submission: upload/import a budget summary (SP document library or structured form)
- Approval routing: budget sheet creates an ADR-013 approval record (`ApproveBudgetSheet` or equivalent)
- Budget approval status: Submitted → Reviewed → Approved; tracked on Mission view
- Budget owner: who submitted and who approved
- Approved budget: once approved, locks planned spend figures for variance tracking

#### Dependencies

- Mission Budgeting (Track 9)
- ADR-013 approval loop (Sprint 18 — complete)

---

### 11 — Mission Finance / Income

**Track:** Finance
**Timing:** After Mission Budgeting; Sprint 27 target
**Type:** Feature

#### Description

Record the financial outcome of a mission: prize money received, income from other sources, total costs incurred, and net financial result. Provides a post-mission finance summary.

#### Scope

- Income records: prize money, sponsorship income, other income per mission
- Cost reconciliation: actual spend vs. approved budget
- Financial outcome: net result per mission (income minus costs)
- Finance view: financial summary section on Mission view; finance workspace for cross-mission reporting
- Write path: governed write or finance-role direct write (TBD)

#### Dependencies

- Mission Budgeting (Track 9)
- Mission / Event Foundation (Track 6)

---

### 12 — Operational Gaps

**Track:** Intelligence
**Timing:** After Missions + Contracts + Credentials are stable; Sprint 27 target
**Type:** Feature — cross-domain intelligence

#### Description

Automated detection and surfacing of operational gaps for people and missions. A "gap" is a condition where a person is expected to be operationally ready for a mission but is missing one or more requirements. C3 already has a partial gap model (credential gaps, journey gaps) but it does not cover contracts, logistics, or budget approval.

#### Scope

- Gap types to detect and surface:
  - Missing or expired contract (depends on Track 5)
  - Missing or expired credential (currently partial — live for credentials)
  - Incomplete journey / no active journey
  - Missing mission assignment (person expected in mission but not linked)
  - Missing logistics assignment (no jersey/logistics record for mission)
  - Missing budget approval for mission (budget sheet not yet approved)
- Gap severity: blocking (person cannot participate) vs. advisory (action recommended)
- Gap surface: CommandCenter work items; PersonProfile Readiness tab; Mission Participants view
- Gap resolution paths: direct link to the action that resolves each gap type

#### Dependencies

- Contracts / SP-02 (Track 5): contract gap
- Mission Participants (Track 7): mission assignment gap
- Jersey / Logistics Tracking (Track 8): logistics gap
- Budget Sheet Approval Workflow (Track 10): budget gap
- Credentials (Sprint 15/20 — complete): credential gap (already partial)
- Journey (Sprint 18 — complete): journey gap (already partial)

---

### 13 — AI Recommendations

**Track:** Intelligence
**Timing:** After enough reliable operational data exists (post-production scale)
**Type:** Feature — AI-augmented intelligence

#### Description

Surfacing suggested next actions, risk flags, and decision-support recommendations based on C3 operational data. Intended to reduce the cognitive load on Platform Owners and Operations staff.

#### Scope (initial ideas — not finalised)

- Suggested next actions: "PER-0004 has an upcoming mission but no active journey — start one?"
- Risk flags: "3 people assigned to Mission X have expired credentials"
- Missing document/credential recommendations: "PER-0012 is missing a credential that all other participants in this mission category have"
- Approval bottleneck recommendations: "5 approvals have been in Submitted state for more than 7 days — escalate?"
- Readiness pattern recognition: which combinations of credential/contract/journey state correlate with successful mission participation

#### Dependencies

- Operational Gaps (Track 12): gap data as input
- Mission Participants (Track 7): mission linkage
- All write paths live and stable (to have meaningful operational history)
- Several months of real operational data at production scale

#### Note

AI Recommendations require sufficient operational data to be meaningful. This track should not begin until C3 has been in production use for several months with real data across multiple missions.

---

### 14 — Player/Staff Readiness Recommendations

**Track:** Intelligence
**Timing:** After Operational Gaps (Track 12)
**Type:** Feature

#### Description

Readiness scoring and mission readiness suggestions for individual people based on their credential, contract, journey, and gap state relative to mission requirements. Provides an at-a-glance readiness signal for each person and specific recommendations for resolving readiness blockers before a mission.

#### Scope

- Readiness score or status per person: derived from gap state + credential state + journey state + contract state
- Mission readiness indicator: given a specific mission, is this person ready? What is blocking them?
- Recommendations: ordered list of actions to bring a person to readiness for a specific mission
- Surface: PersonProfile Readiness tab (extend existing); Mission Participants view (per-participant readiness column)

#### Dependencies

- Operational Gaps (Track 12)
- Mission Participants (Track 7)
- Credentials, Journey, Contracts all live

---

### 15 — Induction

**Track:** Orchestration
**Timing:** After Contracts + Missions + Operational Gaps; Sprint 28 target
**Type:** Feature — UI orchestration

#### Description

A guided operational workflow that takes a person from intake to operational readiness in a single coherent flow. Induction is an orchestration layer — it sequences existing C3 screens and services in a defined operator flow. It does not replace Journey, Mission, or any other governed operation.

#### Operator flow

```
Person intake
  → Contract details (C3 contract record)
  → Credential submission (through ADR-013 approval loop)
  → Readiness / Journey initiation
  → Link to existing Mission  OR  Create new Mission with this person included
  → Generate missing obligations / operational gaps
  → Done (person is operationally ready)
```

#### Positioning

- Induction does not replace Journey. Journey creation remains a governed ADR-013 operation.
- Induction does not replace Mission. Mission creation remains a separate governed operation.
- Induction does not bypass the ADR-013 approval loop. Credential submissions during Induction still create C3Approvals records and require Platform Owner approval.
- Induction is UI-only orchestration — no new SP lists, no schema changes.

#### Dependencies

| Dependency | Status |
|-----------|--------|
| Contracts / SP-02 (Track 5) | Not yet implemented |
| Mission / Event Foundation (Track 6) | Not yet implemented |
| Mission Participants (Track 7) | Not yet implemented |
| Operational Gaps (Track 12) | Not yet implemented |
| Credential governed write path | ✅ Live (Sprint 20) |
| Approval history / audit visibility | ✅ Live (Sprint 20) |
| PersonProfile | ✅ Live (Sprint 20–21) |

**Minimum unlocked when:** Contracts, Mission foundation, Mission Participants, and Operational Gaps are all live.

---

### 16 — SharePoint Import / Export

**Track:** Data management
**Timing:** Before production scale; after core platform tracks are stable
**Type:** Feature — data operations

#### Description

Tools to import legacy data from SharePoint lists or Excel exports into C3's data model, and to export C3 data for backup, migration, or audit purposes.

#### Scope

- Import: bulk-load people, credentials, and contracts from existing SharePoint data or Excel files; map columns to C3 schema
- Export: export C3 data (people, approvals, credentials, journeys, missions) to structured formats (Excel, CSV) for backup or audit
- Migration templates: Excel/CSV templates pre-formatted to match C3 SP list schemas for initial data load
- Validation: import preview showing what would be created/updated and highlighting conflicts or missing required fields
- History: log of import/export operations (what was imported, by whom, when)

#### Dependencies

- All core SP lists live and stable (people, credentials, journeys, approvals, contracts, missions)
- C3 schema stable (no pending schema changes that would invalidate import templates)

---

### 17 — Standalone SaaS Path

**Track:** SaaS / productization
**Timing:** Later — after internal beta proves operating model
**Type:** Strategic / architectural

#### Description

Decouple C3 from the SharePoint/SPFx-only runtime model so it can operate as a standalone product — accessible outside SharePoint and deployable for other organisations. This is a strategic direction, not a near-term implementation.

#### Scope (planning only)

- Architecture assessment: what in C3's current architecture is SharePoint-specific vs. portable
- Authentication strategy: replace SPFx context auth with a standalone auth model (Azure AD / OAuth / other)
- Data storage strategy: what replaces SharePoint lists as the data layer (database, Dataverse, other)
- Hosting strategy: where does the application run outside SPFx
- Tenant / company model: how does C3 support multiple organisations
- Security and permissions model: equivalent to SP security groups but independent
- Configuration model: how does an admin configure a C3 instance for their organisation

#### Dependencies

- Internal beta stable and running (Sprint 22+ target)
- Internal production launch
- Several months of real operational usage to validate the operating model
- Commercial/licensing decision

#### Note

This track should not begin until C3 has proven its value in internal production. Starting too early risks building SaaS infrastructure before the product model is validated.

---

### 18 — C3 SaaS Admin Console

**Track:** SaaS / productization
**Timing:** After Standalone SaaS Path (Track 17)
**Type:** Feature — administration

#### Description

An administrative console for configuring and managing a C3 SaaS instance. Separate from the operational UI — intended for IT administrators and C3 tenant managers, not everyday operators.

#### Scope (planning only)

- Tenant setup: provision a new C3 organisation instance
- Module configuration: enable/disable capability modules per tenant (e.g. enable Missions, disable Finance)
- Role / config management: manage roles, approval workflows, and capability gates per tenant
- Licensing / admin controls: seat counts, licence status, feature flags
- Usage monitoring: high-level usage metrics per tenant (not operational data)

#### Dependencies

- Standalone SaaS Path (Track 17)
- Commercial / licensing model decision

---

### 19 — Productization / Distribution Expansion

**Track:** SaaS / productization
**Timing:** Later productization track — after internal production and SaaS path are validated
**Type:** Strategic

#### Description

After C3 is finalised, launched internally, and tested for several months in real operations, evaluate extending C3 beyond the current SharePoint/SPFx-hosted model into additional distribution forms.

#### Potential future distribution forms (planning only)

- Dedicated web application (hosted outside SharePoint)
- Desktop application (`.exe` / Electron or equivalent)
- Mobile application (iOS / Android)
- App Store / Play Store distribution
- Standalone packaged product
- SaaS/commercial edition

#### Dependencies before any distribution expansion

| Dependency | Notes |
|-----------|-------|
| Internal beta stability | Confirmed across multiple real sprint cycles |
| Internal production launch | C3 running for real operations, not just beta testing |
| Several months of real operational usage | To validate the product model before distribution |
| Authentication strategy outside SharePoint/SPFx | Required for any non-SPFx distribution |
| Hosting/backend strategy | Required for web, mobile, desktop |
| Tenant/company model | Required for multi-org distribution |
| Security and permissions model | Must not depend on SP security groups |
| Data storage model | Must not depend on SharePoint lists |
| L