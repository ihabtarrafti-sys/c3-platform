# Sprint 16 Planning Memo
**C3 Contract Control Center**
**Date:** 2026-06-29
**Status:** Planning only — no implementation authorised
**Sprint 15 status:** Implementation complete; live SharePoint validation pending IT provisioning

---

## Context

Sprint 15 delivered the credential integration layer: schema document, mapper utility, `SharePointCredentialService`, SPFx host wiring, and a local parity harness. The service pattern it established — native fetch, OData query builder, fail-safe empty returns, pure mapper utility — is the template for every subsequent SP service.

Sprint 16 is the logical next integration wave: People, Journeys, and the transition from a pure demo system to a real operator pilot. This memo covers what can be safely prepared before Sprint 15 closes.

No implementation is authorised until:
1. S15 real SP fetch parity test passes against the live `C3Credentials` list
2. Sprint 15 is formally closed and tagged `v0.15.0-sp-credentials`

---

## 1. People SP Schema — `C3People`

### Design rationale

People is the foundational entity. Every other list (Credentials, Journeys, Contracts) references PersonID as a foreign key. The SP list must be provisioned and stable before any join-dependent service can be tested against real data.

The `Person` type is intentionally lean: it holds identity and classification data only. Contract history fields (`FirstContractDate`, `LatestContractDate`, `TotalContracts`) are computed projections from the Contracts list in the full implementation, but for the SP people service they are stored denormalised on C3People to avoid a cross-list join on every People query. This is an accepted tradeoff documented here so it is not revisited per sprint.

### Column specification

| Internal name | Display name | SP column type | Required | Notes |
|---|---|---|---|---|
| `Title` | Person ID | Single line of text | Yes | Must match pattern `PER-NNNN`. This is the SP `Title` field — used as the lookup key by all other lists |
| `FullName` | Full Name | Single line of text | Yes | |
| `IGN` | In-Game Name (IGN) | Single line of text | No | Blank for non-player roles |
| `Nationality` | Nationality | Single line of text | No | Free text; country name as used on travel documents |
| `PrimaryRole` | Primary Role | Single line of text | Yes | e.g. Player, Head Coach, Graphic Designer |
| `PersonnelCode` | Personnel Code | Single line of text | Yes | Pattern: `DEPT/ROLE/NNN` e.g. `FN/PL/001` |
| `CurrentTeam` | Current Team | Single line of text | No | e.g. GKE Fortnite, GKA Apex Legends |
| `CurrentGameTitle` | Current Game Title | Single line of text | No | Blank for non-esports staff |
| `PrimaryDepartment` | Primary Department | Choice | Yes | Values: Esports, Operations, Creative, Management, Finance, Legal, HR |
| `IsActive` | Is Active | Yes/No | Yes | Default: Yes |
| `FirstContractDate` | First Contract Date | Date and Time | No | Denormalised from Contracts list |
| `LatestContractDate` | Latest Contract Date | Date and Time | No | Denormalised from Contracts list |
| `TotalContracts` | Total Contracts | Number | No | Denormalised from Contracts list. Integer. Default: 0 |

**List name:** `C3People`
**SP internal list title string (used in OData queries):** `C3People`

### Query pattern (anticipated)

```
GET {siteUrl}/_api/web/lists/getbytitle('C3People')/items
  ?$select=Title,FullName,IGN,Nationality,PrimaryRole,PersonnelCode,
           CurrentTeam,CurrentGameTitle,PrimaryDepartment,IsActive,
           FirstContractDate,LatestContractDate,TotalContracts,ID
  &$filter=IsActive eq 1
  &$top=500
```

`listAllPeople()` fetches all active people in a single call (500 cap is safe given org size). No pagination anticipated for the pilot.

`getPerson(personId)` queries `$filter=Title eq 'PER-NNNN'&$top=1`.

### Mapper design

Follows the S15 credential mapper pattern exactly:
- Hard reject: missing `Title` (PersonID) → item skipped, warning logged
- Soft warn: blank `FullName` → substitute `"Unknown (PER-NNNN)"`
- Soft warn: blank `PrimaryDepartment` → substitute `"Unknown"`
- `IsActive` absence → default `false` (safe fail)
- Date fields: same `parseISODate()` guard used in `spCredentialMapper.ts` — invalid → `undefined`

A standalone `spPersonMapper.ts` utility should be written (mirroring `spCredentialMapper.ts`) before implementing the service.

---

## 2. Journey SP Schema — `C3Journeys`

### Design rationale

Journeys are the operational workflow layer on top of People and Credentials. A Journey is owned by one person, has one type, has a lifecycle status, and optionally carries per-obligation ownership assignments (`ObligationAssignments`).

The non-trivial design question is how to store `ObligationAssignments`. See section 5 (Travel vs SP People/Journeys tradeoff) for the full analysis. The recommendation here is JSON blob serialisation into a `Multiple lines of text` column on C3Journeys.

Unlike Credentials, Journeys have **write operations** (initiate, complete, suspend, cancel). The write path in SP mode will go through Power Automate flows, not direct REST POST/PATCH, per the existing ADR. Reads use SP REST directly. This means Sprint 16 Journey implementation covers read-only SP integration first; write operations remain Power Automate stubs.

### Column specification

| Internal name | Display name | SP column type | Required | Notes |
|---|---|---|---|---|
| `Title` | Journey ID | Single line of text | Yes | Pattern: `JRN-NNNN`. SP `Title` field — primary lookup key |
| `PersonID` | Person ID | Single line of text | Yes | FK to `C3People.Title` (PersonID). Not an SP Lookup column — stored as text to avoid Lookup column cascading issues |
| `JourneyType` | Journey Type | Choice | Yes | Values: Onboarding, VisaRenewal, TeamTransfer, ContractRenewal, Offboarding |
| `Status` | Status | Choice | Yes | Values: Active, Completed, Suspended, Cancelled |
| `InitiatedAt` | Initiated At | Date and Time | Yes | ISO 8601 datetime |
| `InitiatedBy` | Initiated By | Single line of text | Yes | Email or display name of initiating operator |
| `AssignedTo` | Assigned To | Single line of text | No | Governance owner email |
| `InitiationReason` | Initiation Reason | Multiple lines of text | No | Plain text. Free form. |
| `ContractID` | Contract ID | Single line of text | No | FK to C3Contracts |
| `MissionID` | Mission ID | Single line of text | No | FK to C3Missions. e.g. `TR/2026/006` |
| `CompletedAt` | Completed At | Date and Time | No | Null if not completed |
| `Notes` | Notes | Multiple lines of text | No | Plain text |
| `ObligationAssignmentsJSON` | Obligation Assignments (JSON) | Multiple lines of text | No | Serialised `ObligationAssignment[]`. See section 5. |

**List name:** `C3Journeys`
**SP internal list title string:** `C3Journeys`

> **Pilot decision — `ObligationAssignmentsJSON`:**
> Using a JSON blob in a Multi-line text column is accepted as a Sprint 16 read-integration simplification only. ADR-003 identifies a normalised child list (`JourneyObligationAssignments`) as the preferred long-term model. JSON is acceptable for the pilot because: volume is low (2–5 assignments per journey), assignments are always read with their parent Journey (no independent query need), join complexity is avoided during first SP integration, and write/update surfaces are not yet implemented. Long-term target remains a normalised child list unless operator validation proves the JSON approach is sufficient at scale. This decision must be revisited before Journey write operations are implemented.

### Query patterns (anticipated)

**listAllActiveJourneys():**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items
  ?$select=Title,PersonID,JourneyType,Status,InitiatedAt,InitiatedBy,
           AssignedTo,InitiationReason,ContractID,MissionID,
           CompletedAt,Notes,ObligationAssignmentsJSON,ID
  &$filter=Status eq 'Active'
  &$top=500
```

**listJourneysForPerson(personId):**
```
&$filter=PersonID eq 'PER-NNNN'
&$orderby=InitiatedAt desc
```

**getActiveJourney(personId, type):**
```
&$filter=PersonID eq 'PER-NNNN' and JourneyType eq 'Onboarding' and Status eq 'Active'
&$top=1
```

### Mapper design

- Hard reject: missing `Title` (JourneyID) or missing `PersonID` → skip, warn
- `ObligationAssignmentsJSON`: `JSON.parse()` in a try/catch — parse failure → `undefined` with warn, never throws
- `JourneyType` unknown value → warn and skip item (unlike Credentials where unknown CredentialType soft-maps to 'Other' — an unknown JourneyType cannot be safely substituted)
- `Status` unknown value → warn and skip item

---

## 3. Next Integration Sequence

The current SP service stubs, in priority order for Sprint 16 and beyond:

### Sprint 16 scope (proposed)

| Task | Service | Dependency | Notes |
|---|---|---|---|
| S16-1 | Schema doc: C3People | None | This memo is the draft; IT needs the formal column-by-column doc (same format as C3Credentials SP List Schema.md) |
| S16-2 | Schema doc: C3Journeys | None | Same |
| S16-3 | `spPersonMapper.ts` | C3People schema finalised | Pure utility, no SP access |
| S16-4 | `SharePointPersonService` reads | C3People provisioned + S16-3 | `listAllPeople`, `getPerson` only |
| S16-5 | `spJourneyMapper.ts` | C3Journeys schema finalised | Includes `ObligationAssignmentsJSON` parse |
| S16-6 | `SharePointJourneyService` reads | C3Journeys provisioned + S16-5 | Read-only: `listAllActiveJourneys`, `listJourneysForPerson`, `getActiveJourney` |
| S16-7 | Parity harness: People + Journeys | S16-3 + S16-5 | Mirror + stress test, same pattern as S15-5A |
| S16-8 | Real SP fetch parity (People) | IT provisioning | Gate for Sprint 16 close |
| S16-9 | Real SP fetch parity (Journeys) | IT provisioning | Gate for Sprint 16 close |

### Deferred to Sprint 17+

- **Contracts** (`SharePointContractService`) — more complex; many fields; write operations needed early; depends on SP-02 PersonIDId migration
- **Amendments** — depends on Contracts being stable
- **Users/Auth** — depends on C3_Users list existing (SP-01 still outstanding per architecture baseline)
- **Journey write operations** (initiate, complete, suspend, cancel) — Power Automate flows; separate from read integration
- **Mission list** — not currently in `ServiceRegistry`; would be a new service addition

---

## 4. Operator Pilot Checklist

Before switching any production C3 instance to `dataSourceMode: sharepoint`, the following must all be true. This checklist covers the state after Sprint 16 closes, assuming S15 + S16 complete successfully.

### Data readiness
- [ ] `C3Credentials` list provisioned, all required columns created with exact internal names
- [ ] `C3People` list provisioned, all required columns created
- [ ] `C3Journeys` list provisioned, all required columns created
- [ ] At least one person's full credential set entered (real data, not test records)
- [ ] At least one active Journey entered for that person
- [ ] Cross-list FK consistency verified: PersonID values match exactly between C3People titles and C3Credentials `HolderPersonID` values

### Service validation
- [ ] `SharePointCredentialService` real fetch parity test passed (S15 real S15-5)
- [ ] `SharePointPersonService` real fetch parity test passed (S16-8)
- [ ] `SharePointJourneyService` real fetch parity test passed (S16-9)
- [ ] All three mappers produce zero hard-rejects against the seed data
- [ ] Console clean (no warn logs) for a full Situation Room load in SP mode

### SPFx deployment
- [ ] SPFx solution deployed to the target SharePoint site
- [ ] Web part property pane confirms `dataSourceMode` dropdown renders correctly
- [ ] Toggle from `Mock` to `SharePoint` confirmed functional without page reload errors
- [ ] `spSiteUrl` auto-populated from `pageContext.web.absoluteUrl` (no manual config required)

### Operational readiness
- [ ] At least one operator has completed a full walkthrough in SP mode: People Workspace → Person Profile → Readiness tab → Situation Room
- [ ] Gap computation in SP mode matches expected state given the entered credential data
- [ ] Situation Room ownership states (Unrouted / Routed / Covered) correct given entered Journey data
- [ ] No crashes or blank screens on any supported screen in SP mode

### Rollback plan
- [ ] Confirmed that switching property pane back to `Mock` immediately returns the app to mock data (no state leak)
- [ ] IT aware of how to toggle mode if SP mode causes issues during pilot

---

## 5. Travel vs SP People/Journeys — Tradeoff Analysis

### The question

The C3 travel credential ecosystem (Employment Visa, Travel Authorization, Passport, Emirates ID, Residence Permit, Work Permit) is the primary driver of operational gaps in the Situation Room. These credentials are already in scope for S15 via `C3Credentials`. The question is whether **People** and **Journey** data should also live in SharePoint, or whether a dedicated travel/HR system should be the source of truth for person records and workflow state.

### Option A: SharePoint as single source of truth (recommended)

People and Journey data live in C3People and C3Journeys SP lists. C3 reads all data from the same SP site via the same REST API pattern.

**Advantages:**
- Consistent access model — one site URL, one auth context, one set of IT permissions to manage
- No cross-system identity resolution (no need to reconcile PersonID between two systems)
- No dependency on a third-party system's API availability, schema stability, or access controls
- The SP REST + native fetch pattern from S15 is proven (once S15 real validation passes) — replicating it for People/Journeys is low-risk
- IT can manage all C3 data from the SharePoint admin panel they already use for contracts and documents

**Disadvantages:**
- IT must manually maintain people records in C3People; there is no automatic sync from HR/payroll
- Person records can become stale (e.g., role or team changes not reflected) unless an update process is defined
- If an org-wide HR system exists (e.g., Workday, BambooHR), this creates a second copy of person data to maintain

### Option B: Hybrid — SP for Credentials and Journeys; HR system for People

People records come from an existing HR or payroll system via API. C3People list is removed or used only as a cache/override layer. Credentials and Journeys remain in SharePoint.

**Advantages:**
- Person data stays in sync with the authoritative HR system automatically
- No double-entry for people records

**Disadvantages:**
- Requires integrating a second system with its own auth, schema, and SLA
- PersonID FK must be resolved between the HR system's person identifiers and the values stored in `C3Credentials.HolderPersonID` and `C3Journeys.PersonID` — this is a non-trivial mapping problem
- The HR system may not model esports-specific fields (IGN, CurrentTeam, CurrentGameTitle, PersonnelCode) — those would still need to come from somewhere
- Adds an external dependency that can fail independently of SharePoint
- Significantly increases implementation and testing scope

### Recommendation

**Maintain SharePoint as the single source of truth for all C3 data through the pilot phase.** The org is small enough (10 people in current mock set; unlikely to exceed 50 in the near term) that manual maintenance of C3People is practical. The consistency and simplicity benefits of Option A outweigh the sync advantages of Option B at this scale.

If the org grows or an HR system is formally adopted, a sync layer can be introduced later without changing the C3 service architecture — only the SP list population mechanism changes, not the service interface.

**The specific Travel credential concern** is already addressed by S15. Travel Authorization, Employment Visa, and Passport are stored in `C3Credentials` and evaluated by the gap computation engine. The gap engine does not need to know whether People data came from SharePoint or an HR system — it only needs the resolved `Credential[]` for a given `PersonID`.

---

## 6. What Waits on S15 Real Validation

The following Sprint 16 tasks cannot begin until S15 real fetch parity passes:

| Blocked task | Why it waits |
|---|---|
| `SharePointPersonService` implementation (S16-4) | The SP REST error handling, JSON parsing, and `$filter` OData escaping patterns from S15 are the template. If S15 reveals a bug in any of these patterns, all subsequent services need the fix before they're written. |
| `SharePointJourneyService` implementation (S16-6) | Same reason. Also: if `ObligationAssignmentsJSON` blob approach is validated by seeing how S15 multi-value fields behave in real SP REST responses, schema design can be confirmed. |
| Real parity harnesses (S16-8, S16-9) | Cannot test against real SP until lists exist. |
| Operator pilot checklist items marked with SP validation | All SP-mode checklist gates above depend on at least one service having passed real fetch validation. |

The following Sprint 16 tasks **can proceed now** while waiting on IT provisioning:

| Unblocked task | Notes |
|---|---|
| S16-1: C3People schema document | Formal IT handover doc (same format as C3Credentials SP List Schema.md) |
| S16-2: C3Journeys schema document | Formal IT handover doc |
| Operator pilot checklist refinement | Expand and validate the checklist in section 4 above |
| IT handover notes | Cover provisioning steps, column naming, and test dataset expectations for C3People and C3Journeys |

> **Not yet authorised:** `spPersonMapper.ts`, `spJourneyMapper.ts`, `SharePointPersonService`, `SharePointJourneyService`, or any local parity harness for People/Journeys. Reason: the S15 live SharePoint fetch may reveal issues in REST response shape, date field encoding, Choice field serialisation, or diagnostics that should inform the People/Journey mapper pattern before it is written. Copying the S15 pattern before it has been validated against real data risks propagating an unfixed assumption into two additional services.

---

## Summary

Sprint 16 is ready to be scoped once Sprint 15 closes. The most productive pre-closure work is the two schema documents (C3People, C3Journeys) and the two mapper utilities. These are entirely documentation- and utility-layer work — no SP access required, no risk of touching live data, fully reversible, and they directly unblock the Sprint 16 service implementations.

The SP-as-single-source recommendation removes the Travel/HR hybrid complexity from the near-term roadmap. The operator pilot checklist provides a concrete gate to keep the team honest about what "ready for real users" actually means before the mode switch is made.

**Approved parallel work while Sprint 15 remains open:** C3People and C3Journeys schema handover documents, IT handover notes, and operator pilot checklist refinement. Mapper utilities, SP services, and parity harnesses for People/Journeys are not authorised until S15 live fetch validation confirms the SP REST pattern is sound.

**Next action on our side:** await IT provisioning of `C3Credentials`. Once S15 real validation passes and the sprint closes, Sprint 16 implementation begins — with schema docs and IT handover notes already in hand.
