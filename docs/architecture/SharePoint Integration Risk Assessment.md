# SharePoint Integration Risk Assessment

**Status:** Draft  
**Sprint:** Sprint 14 — Architecture Hardening  
**Date:** 2026-06-29  
**Purpose:** Document integration risks across all five service domains before a production pilot. Grounded in the current stub implementations, type definitions, and protocol code.

Risk levels: **Critical** (blocks correct operation) / **High** (produces wrong results silently) / **Medium** (degrades display or requires workaround) / **Low** (safe failure, acceptable default)

---

## Summary

Five service domains have graceful SharePoint stubs. None have been tested against real SP data. The first integration run will surface data quality issues that the mock data — carefully constructed, clean, and consistent — has never exposed.

The highest risks are not in the service layer. They are in the mapping between SharePoint's storage model and the assumptions baked into the protocol evaluation functions. A credential with an unexpected date format silently produces a wrong urgency result. A Journey status string that differs by a single character silently returns zero active journeys, collapsing all ownership to Unrouted. These failures are invisible without a comparison baseline.

---

## Domain 1: Credentials

**SP list:** Credentials list (not yet created)  
**Service stub:** `SharePointCredentialService` — returns `[]` for all reads; `null as unknown as Credential` for `getCredential` and `addCredential`

### Field-level risks

**`ExpiryDate?: string` — ISO 8601 date format** | Risk: **High**

The protocol function calls `computeDaysToExpiry(c.ExpiryDate)` which calls `new Date(c.ExpiryDate)`. ISO 8601 (`2026-12-31`) parses correctly in all environments. SharePoint date fields return ISO format by default via REST API, but locale settings on the SP site can affect rendering. If the C3 SharePoint adapter reads from a formatted view rather than the raw field value, regional date formats (`31/12/2026`, `12/31/2026`) may appear. `new Date('31/12/2026')` returns Invalid Date, which evaluates to `NaN` in date arithmetic. Result: credential treated as having no expiry — `Satisfied` when it should be `AtRisk`.

**Mitigation:** Ensure the SP REST query requests the raw ISO value via `$select`. Add a validation step in the SP service: if `new Date(ExpiryDate)` is Invalid Date, log an error and treat the credential as if `ExpiryDate` is absent (safe fallback — satisfies the obligation without expiry check).

---

**`Type: CredentialType` — 18-value union** | Risk: **High**

The protocol uses `credentialProvides(c.Type, capability)` from `credentialCapabilities.ts`. If SP returns a `Type` value not in the `CredentialType` union (e.g., a legacy value like `"ID Card"` or `"Passport (Expired)"` from before the current taxonomy), `credentialProvides` returns false for all capabilities. The credential exists in SP but produces no satisfaction. The person appears to have no qualifying credential for that capability — a silent wrong result producing spurious gaps.

TypeScript cannot catch this at runtime. The SP service maps raw SP text to the TypeScript union but will not catch unknown values.

**Mitigation:** Add a runtime type guard in the SP service layer: `if (!VALID_CREDENTIAL_TYPES.includes(rawType)) { console.error('[C3] Unknown CredentialType:', rawType); return null; }` — filter out unrecognised types rather than passing them through. Emit a Diagnostic entry for any filtered record so the team can identify legacy data.

---

**`IsActive: boolean` — SP Yes/No field** | Risk: **Low**

SP Yes/No fields return `true` or `false` via REST. Null is not possible for a Yes/No field unless the column allows blank values. If blank is allowed and a credential has no `IsActive` value, it evaluates as `null` (falsy), which correctly excludes it from evaluation. Safe default.

---

**`HolderPersonID: string` — lookup or text column** | Risk: **Medium**

If `HolderPersonID` is stored as a SP Lookup field (pointing to the People list), SP REST returns a lookup object (`{ Id: 3, Value: "PER-0001" }`) rather than a plain string. The service layer must extract the value. If `HolderPersonID` is a plain text column, this risk is absent. Decision on column type should be explicit in the schema design — the safer choice for v1 is plain text to avoid lookup mapping complexity.

---

**`CredentialID: string` vs `Id: number`** | Risk: **Medium**

`Credential.Id` is the SP auto-generated integer list item ID. `Credential.CredentialID` is the human-readable ID (`CRED-0042`), which must be stored as a custom column. If a credential is imported into SP without the `CredentialID` column populated, the field is empty string. The `useAddCredential` mutation returns a `Credential` with `CredentialID` set — but records imported by other means (bulk imports, manual SP entry) may not have it. The display in the Credential panel uses `CredentialID` for identification — empty string degrades display only, does not break gap computation.

---

**`SubType?: string`** | Risk: **Low** (currently)

`SubType` is not used in the current protocol evaluation. `credentialCapabilities.ts` maps `CredentialType → CredentialCapability` but does not read `SubType`. Unknown SubType values today have no effect. This will become a risk if future protocol logic uses SubType to distinguish visa categories (e.g., "Tourist" vs "Employment" visa for different capability mappings).

---

### Test data minimum for Credentials

- 6 credentials across 2–3 people
- At least one with a past `ExpiryDate` (expired — should produce Unsatisfied)
- At least one with `ExpiryDate` within 30 days (AtRisk)
- At least one with no `ExpiryDate` (non-expiring — Satisfied)
- At least one credential per capability (Identity, Travel, RightToWork)

---

## Domain 2: Journeys

**SP list:** Journeys list + JourneyObligationAssignments list (neither created)  
**Service stub:** `SharePointJourneyService` — reads return `[]` or `null`; writes throw

### Field-level risks

**`Status: JourneyStatus` — choice field filter** | Risk: **High**

`listAllActiveJourneys('Onboarding')` will query SP with `$filter=Status eq 'Active'`. If SP stores status values with different casing (`active`, `ACTIVE`) or includes a space (`In Progress` for something that should be `Active`), the filter returns zero results. All ownership collapses to `Unrouted` across the entire Situation Room. This failure is silent — no error, just incorrect gap display.

**Mitigation:** Validate SP choice field values at schema creation time against the `JourneyStatus` union. Test the filter with an exact match query before going live.

---

**`obligationAssignments` — not a native SP field** | Risk: **Critical**

`obligationAssignments` is a TypeScript array of `ObligationAssignment` objects. There is no native SP equivalent. It must be stored either as:

1. A related `JourneyObligationAssignments` list (recommended — see ADR-003)
2. A serialised JSON text column on the Journeys list (simpler but not editable in SP UI)

Until this schema is decided and implemented, the Covered ownership state is impossible in production. All gaps will be at most Routed. This is not a crash — the Situation Room still works — but it means a key accountability feature is invisible to operators until the schema is resolved.

**Mitigation:** Resolve the schema in ADR-003 before implementation begins. If JSON column is chosen for v1: the SP service must serialise on write and deserialise on read, with a try/catch on JSON.parse. If the column is empty or malformed JSON, return `obligationAssignments: []` (safe default — Routed instead of Covered).

---

**`Type: JourneyType` — filter by journey type** | Risk: **Medium**

`listAllActiveJourneys('Onboarding')` filters by type. Same case/spacing risk as Status. If SP stores `'Onboarding'` with a different case, zero active journeys are returned. The consequence is identical to the Status risk: all gaps Unrouted.

---

**`MissionID?: string` — informational FK** | Risk: **Low**

`Journey.MissionID` is informational. If the Missions list does not yet exist when Journeys are migrated, the MissionID column may contain TR codes with no SP list to validate against. This does not break Journey functionality — MissionID is not read by any hook that affects gap computation.

---

### Test data minimum for Journeys

- 1 Active Journey with `AssignedTo` set, no `obligationAssignments` → exercises Routed state
- 1 Active Journey with `AssignedTo` and one `obligationAssignment` for `Travel` → exercises Covered state (once schema is resolved)
- 1 person with no Journey → exercises Unrouted state

---

## Domain 3: Missions

**SP lists:** Missions list + MissionParticipants list (neither created)  
**Service stub:** `SharePointMissionService` — reads return `[]` or `null`; writes throw

### Field-level risks

**`Status: MissionStatus` — ADR-002 gate** | Risk: **High**

`useMissionGaps` checks `MISSION_OBLIGATION_ACTIVE_STATUSES.includes(mission.Status)`. If SP returns a status string that doesn't match exactly (`'confirmed'`, `'Confirmed '` with a trailing space), the mission is silently treated as inactive — zero gaps are generated. The Situation Room shows an empty gap list with no indication of why.

**Mitigation:** Validate SP choice values match the `MissionStatus` union exactly at schema creation. Trim whitespace in the SP service mapper.

---

**`Span.StartDate` / `Span.EndDate` — nested object, flat SP columns** | Risk: **Medium**

The C3 `Mission.Span` type is `{ StartDate: string; EndDate: string; SettlementDate?: string }`. In SP, these will be three separate date columns. The SP service must map `{ StartDate: row.StartDate, EndDate: row.EndDate, SettlementDate: row.SettlementDate }` to the nested `Span` object. The same date format risk from Credentials applies: ISO format required. The `Span.EndDate` is used as the urgency horizon in `useMissionGaps` — a wrong date here produces wrong urgency tiers across the entire Mission gap view.

---

**`ParticipantPersonIDs: string[]` — array with no SP equivalent** | Risk: **High**

`Mission.ParticipantPersonIDs` is a flat array of PersonID strings. SP has no native array column type. S14-2 proposes resolving this by making `MissionParticipant[]` authoritative and deriving the array. If S14-2 is complete before SP integration, `listMissionParticipants()` is the only source of truth and this risk is eliminated. If S14-2 is not complete, a JSON column on the Missions list is required.

---

**`MissionID: string` — custom TR code format** | Risk: **Medium**

`Mission.MissionID` uses the format `TR/2026/006` or `SATR/2026/003`. SP auto-generates integer list item IDs. The MissionID must be stored in a custom column (`Title` renamed, or a separate `MissionCode` column). If records are bulk-imported without the custom column, MissionID is empty. All FK lookups from Finance, Milestones, and Journeys fail silently (empty results).

---

**`OperatingCurrency?: string` — optional choice** | Risk: **Medium**

If the SP choice field has values `USD`, `AED`, `SAR`, `EUR` (matching the TypeScript union), no issue. If the SP site is configured with currency symbol variants (`US Dollar`, `USD ($)`), the field value doesn't match and defaults to `undefined`. The Finance section defaults to `'USD'` when currency is absent — cosmetically wrong but not a crash.

---

**Two new SP lists required** | Risk: **High** (operational)

Missions and MissionParticipants are two new lists with no existing SP equivalent. Schema design, IT provisioning, and initial data migration are all required before any integration test. This is the highest operational blocker for Mission integration.

---

### Test data minimum for Missions

- 1 Mission in `Confirmed` status with `StartDate` / `EndDate` in the future and 2 participants → exercises ADR-002 gate and mission gap computation
- 1 Mission in `FinancePending` status → exercises ADR-002 silent exclusion (zero gaps)
- 2 MissionParticipant records for the Confirmed mission, with PersonIDs matching real credential records

---

## Domain 4: Milestones

**SP list:** Milestones list (not yet created)  
**Service stub:** `SharePointMilestoneService` — reads return `[]`; `completeMilestone` throws

### Field-level risks

**`Status: MilestoneStatus` — WorkItem generation input** | Risk: **High**

`generateMilestoneWorkItems` reads `milestone.Status` to determine whether a milestone alert WorkItem should be generated. If SP returns a status string that doesn't match `'Upcoming' | 'InProgress' | 'Complete' | 'Overdue'`, the WorkItem generator silently produces no alert for that milestone. The Command Center shows fewer work items than it should — a silent wrong result that operators would not immediately notice.

---

**`PlannedDate: string` — ISO date** | Risk: **High**

`generateMilestoneWorkItems` computes `daysToMilestone` from `milestone.PlannedDate`. The WorkItem priority (Immediate / Soon / Upcoming) and urgency tier depend on this computation. Same date format risk as Credentials. An invalid date produces a `NaN` comparison, which evaluates to `false` for all threshold checks — the milestone gets treated as far in the future, producing a lower-priority WorkItem than warranted.

---

**`CompletedDate?: string`** | Risk: **Medium**

Completed milestones (where `CompletedDate` is set) produce no WorkItem — this is correct. If `CompletedDate` is set to an unexpected non-null value (e.g., `'0001-01-01'` as a SP default for date fields that aren't blank), a milestone that is not actually complete may be treated as complete. Result: a missing WorkItem in the Command Center.

**Mitigation:** In the SP service mapper, treat any `CompletedDate` ≤ `1990-01-01` as null (pre-modern dates as SP null sentinel).

---

**`MilestoneID` — custom ID format** | Risk: **Medium**

Same as `CredentialID` — custom format (`ML-002`) in a column that SP doesn't generate automatically. Must be in a custom column.

---

### Test data minimum for Milestones

- 2 milestones for a Confirmed mission: one Upcoming (PlannedDate > today + 14 days), one Overdue (PlannedDate < today, not Completed) → exercises both WorkItem priority tiers

---

## Domain 5: Finance

**SP list:** FinanceLines list (not yet created)  
**Service stub:** `SharePointFinanceService` — returns `[]` for all reads

### Field-level risks

**`Category: FinanceLineCategory` — 13-value union** | Risk: **High**

`FinanceSection` renders category labels via `CATEGORY_LABEL[line.Category]`, which is a TypeScript exhaustive `Record<FinanceLineCategory, string>`. In TypeScript strict mode, this is safe — but at runtime, if SP returns an unrecognised category value (e.g., `'Catering'` added to SP before the TypeScript type was updated), `CATEGORY_LABEL['Catering']` returns `undefined`. The category chip renders as blank or throws an error depending on the surrounding component.

**Mitigation:** Add a runtime fallback in the SP service mapper: `const category = VALID_FINANCE_CATEGORIES.includes(raw) ? raw : 'Contingency'` (or log and filter). This prevents a display crash at the cost of miscategorising unknown lines.

---

**`Direction: FinanceLineDirection` — 'Income' | 'Expense'** | Risk: **Medium**

The Finance section groups lines by direction. An unrecognised direction value causes a line to appear in neither group. The summary strip totals (plannedNet, etc.) are affected because they depend on the direction grouping in `computeMissionFinanceSummary`. A misclassified line produces a wrong net calculation without error.

---

**`PlannedAmount / ActualAmount: number` — numeric fields** | Risk: **Low**

SP Number or Currency fields return numeric values via REST. Parsing is reliable. The only risk is a null `ActualAmount` field returning `null` vs `undefined` — the type expects `ActualAmount?: number` (undefined when absent). SP REST may return `null` for nullable numeric columns. `line.ActualAmount !== undefined` would be true for null, treating null as a known actual.

**Mitigation:** In the SP service mapper: `actualAmount: row.ActualAmount !== null ? row.ActualAmount : undefined`.

---

**`IsSettled: boolean` — SP Yes/No field** | Risk: **Low**

Same analysis as `Credential.IsActive`. Safe default if null (treated as false = not settled).

---

**`LineID` — custom format** | Risk: **Medium**

`LineID` uses the format `fl-{missionId}-{seq}`. Custom column in SP. Same risk as other custom ID fields — may be absent on manually entered records.

---

### Test data minimum for Finance

- 4 finance lines for a Confirmed mission: 1 Income line (PlannedAmount set, no ActualAmount), 1 Income line (both set), 1 Expense line (PlannedAmount only), 1 Expense line (both set, actual > planned) → exercises summary strip, partial-actuals label, over-budget colouring

---

## Integration Sequence Recommendation

### Recommended order: Credentials → Journeys → Missions+Participants → Milestones → Finance

**1. Credentials first.**

Justification: The Credentials list is the smallest schema (one list, 12 columns), has the highest protocol coverage (every gap computation runs against credentials), and produces the most visible results (gap list in the Situation Room changes immediately). A working Credentials integration with a small set of real credential records is the fastest way to validate that the protocol evaluation logic behaves correctly against real data. The date format risk and CredentialType matching risk are both catchable in this phase before more complex domains are added.

Dependency: Credentials are consumed by `useOperationalGaps` and `useMissionGaps`. Both can be tested with mock People data while real credentials are in SP. No dependency on any other SP list.

**2. Journeys second.**

Justification: Gap ownership state depends on Journeys. A working Credential integration with all gaps showing Unrouted (because Journeys are still mock) is useful but incomplete. Journeys integrate naturally after Credentials. The main prerequisite is a schema decision on `obligationAssignments` (resolved in ADR-003).

Dependency: Journeys are consumed alongside Credentials in the same gap computation hooks. The integration test after this phase should show Covered and Routed gaps, not just Unrouted.

**3. Missions and MissionParticipants third (two lists together).**

Justification: `useMissionGaps` depends on Credentials, Journeys, and Missions being integrated. Testing Mission integration in isolation is not possible — all three must be in SP for the Mission scope view to show real data. The ADR-002 gate, span-aware urgency, and mission participant scoping can all be validated in a single integration test after this phase.

Dependency: This phase has the highest operational blocker risk — two new SP lists must be designed, provisioned, and populated. S14-2 (participant representation) should be complete before this phase begins.

**4. Milestones fourth.**

Justification: Milestones affect WorkItem generation in the Command Center. Integrating them after the core gap computation domains means WorkItems can be validated in a real context (real credentials and journeys, real mission) before milestone-based WorkItems are added to the picture.

Dependency: Requires Missions to be integrated (Milestones carry MissionID FK).

**5. Finance fifth (or parallel with Milestones).**

Justification: Finance is currently read-only in v1 and has no effect on gap computation or WorkItem generation. It is the lowest operational risk domain and can be integrated independently once the Missions list exists. Finance and Milestones can be integrated in parallel.

Dependency: Requires Missions (FinanceLines carry MissionID FK).

---

## Cross-Domain Risks

**PnP.js setup — not yet added to any SharePoint service.** All five stubs note "PnP.js setup in the services layer" as a blocker. A shared SP connection layer (auth, context, PnP.js setup) needs to be implemented once and shared across all five services. This is a Sprint-0 integration prerequisite that precedes all five domain implementations.

**SP list naming consistency.** Custom column names across all five lists must follow a consistent naming convention to avoid mapping errors. Recommended: use the exact TypeScript field names as SP column internal names (`ExpiryDate`, not `Expiry Date` or `expiry_date`).

**Null vs. empty string in SP text columns.** SP single-line text columns return `null` for blank values via REST, not empty string. Any SP mapper that assigns a text field to a required TypeScript `string` field (not `string | undefined`) must handle `null`. The current TypeScript types mark most ID fields as non-optional `string` — the SP mappers must either guarantee non-null or throw explicitly on null required fields.

**Date storage as UTC.** SP date/time columns default to local time if `storedWithDateOnly` is false. All dates in C3 are ISO strings treated as UTC-relative. SP columns that affect credential expiry and milestone planning must be stored as UTC date-only values (`2026-12-31`) or the SP query must request UTC format explicitly.

---

## Recommended Pre-Integration Validation Checklist

Before the first SP integration test, the following should be complete:

- [ ] S14-2 (participant representation) resolved — `MissionParticipant[]` is the single source of truth
- [ ] ADR-003 (Journey definition) — obligationAssignments schema decided (related list vs. JSON column)
- [ ] PnP.js connection layer implemented (shared auth and context across all service factories)
- [ ] SP column naming convention documented for each list
- [ ] Runtime type guard added to `SharePointCredentialService` for `CredentialType` validation
- [ ] Date format validation added to all SP service mappers (null/invalid date handling)
- [ ] SP choice field values verified to match TypeScript union values exactly (Status, Type, Category, Direction)
- [ ] Test data seeded in SP for the minimum scenario set defined above
- [ ] A baseline mock-data render saved (screenshot or test snapshot) to compare against after SP integration
