# C3Journeys — SharePoint List Schema
## IT Provisioning Handover

**List internal name:** `C3Journeys`  
**List display title:** `C3 Journeys`  
**Sprint:** 16 — People Integration  
**Status:** READY FOR PROVISIONING  

This document is the authoritative schema reference for provisioning the Journeys list in SharePoint. A Journey is a tracked operational engagement record — evidence that Geekay Esports is actively working to get a person operationally ready. Column names, types, and choice values must be configured exactly as specified.

> **Read-only in Sprint 16.** The C3 platform will read from this list in Sprint 16 but will not write to it. Write operations (initiating, completing, suspending, cancelling journeys) are governed by ADR-013 and are planned for Sprint 18. For now, ops staff enter Journey records directly in SharePoint.

---

## List Settings

| Setting | Value |
|---|---|
| Title | C3 Journeys |
| Internal name | `C3Journeys` (no spaces) |
| Description | Operational engagement records tracking person readiness workflows in the Geekay Esports C3 platform. |
| Versioning | Enable major versions. Set version limit to 15. |
| Audience | Site members (read/write for ops). Site visitors (read-only). External sharing: Off. |
| Item-level permissions | Read all items. Edit only own items (ops staff manage records they initiate; admin manages all). |

---

## Required Column: Title (JourneyID)

The built-in `Title` column is **repurposed** to store the C3 journey identifier.

| Property | Value |
|---|---|
| Column name | `Title` (existing — do not rename) |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Purpose | Human-readable journey ID, e.g. `JRN-0001`. C3 reads this as `JourneyID`. |

**Naming convention for ops staff:** `JRN-` followed by a zero-padded 4-digit number (e.g. `JRN-0001`, `JRN-0042`). Assign sequentially. JourneyIDs are never reused — completed and cancelled journeys are retained as audit history.

---

## Custom Columns

Add the following columns in order.

### 1. PersonID

| Property | Value |
|---|---|
| Display name | `PersonID` |
| Internal name | `PersonID` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Description | C3 application PersonID of the person this journey is for, e.g. `PER-0001`. Plain text — not a SharePoint Lookup. Must exactly match the PersonID stored in the C3People list `Title` column. |
| Indexed | **Yes** — C3 queries journeys by PersonID. |
| Validation | No SP-level validation. C3 runtime validates FK integrity at read time and warns if PersonID does not resolve. |

### 2. JourneyType

| Property | Value |
|---|---|
| Display name | `Type` |
| Internal name | `JourneyType` |
| Type | Choice |
| Required | Yes |
| Allow custom values | **No** |
| Default value | `Onboarding` |
| Indexed | **Yes** — C3 queries `getActiveJourney(personId, type)` and `listAllActiveJourneys(type)` which filter by JourneyType. |

> **Critical — internal name must be `JourneyType`, not `Type`.** SharePoint treats `Type` as a reserved word in certain list contexts and may silently rename or conflict with built-in metadata. The internal name controls the REST API field name that C3 uses in `$select` and `$filter` clauses. The **display name** shown to ops staff in the list view remains `Type`. When provisioning via Site Settings → List Settings → Column, set the internal name field to `JourneyType`. Verify via the REST endpoint (`/_api/web/lists/getbytitle('C3 Journeys')/fields?$filter=Title eq 'Type'`) that `InternalName` equals `JourneyType` before signoff.

**Choice values** (enter exactly as shown, one per line, preserving casing):

```
Onboarding
VisaRenewal
TeamTransfer
ContractRenewal
Offboarding
```

**Total: 5 values.** The TypeScript `JourneyType` union in C3 has exactly these 5 values. Any value not in this list will cause the C3 service to log a parse warning and the Journey will be excluded from type-filtered queries.

### 3. Status

| Property | Value |
|---|---|
| Display name | `Status` |
| Internal name | `Status` |
| Type | Choice |
| Required | Yes |
| Allow custom values | **No** |
| Default value | `Active` |
| Indexed | **Yes** — C3 queries `Status eq 'Active'` on every `listAllActiveJourneys()` call. |

**Choice values** (enter exactly as shown):

```
Active
Completed
Suspended
Cancelled
```

**Total: 4 values.** State transitions:
- `Active → Completed` (normal completion — person is operationally ready)
- `Active → Suspended` (temporarily blocked, e.g. awaiting government document issuance)
- `Active → Cancelled` (abandoned)
- `Suspended → Active` (blocker resolved, journey resumed)
- `Suspended → Cancelled`

Completed and Cancelled journeys are never deleted. They form the audit history of engagement for each person.

### 4. InitiatedAt

| Property | Value |
|---|---|
| Display name | `InitiatedAt` |
| Internal name | `InitiatedAt` |
| Type | Date and Time |
| Required | Yes |
| Date format | **Date and Time** (full ISO 8601 datetime) |
| Description | UTC datetime the journey was initiated by ops staff. Enter as date + time when creating the record. C3 uses this for chronological ordering within `listJourneysForPerson()`. |

### 5. InitiatedBy

| Property | Value |
|---|---|
| Display name | `InitiatedBy` |
| Internal name | `InitiatedBy` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 200 |
| Description | Email address or display name of the staff member who initiated the journey, e.g. `ops.coordinator@geekay.gg`. Used for audit trail — not enforced against an Active Directory lookup. |

### 6. AssignedTo

| Property | Value |
|---|---|
| Display name | `AssignedTo` |
| Internal name | `AssignedTo` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Description | Overall governance owner for this journey. The person accountable for the subject reaching operational readiness. Email or display name, e.g. `ops.coordinator@geekay.gg`. This is the journey-level owner. Obligation-level execution owners are stored separately in `ObligationAssignmentsJSON`. Leave blank if not yet assigned — the journey is tracked but ownership is undeclared. |

### 7. InitiationReason

| Property | Value |
|---|---|
| Display name | `InitiationReason` |
| Internal name | `InitiationReason` |
| Type | Multiple lines of text |
| Required | No |
| Text type | Plain text |
| Rows | 3 |
| Description | Free-text reason for initiating the journey, e.g. `New season roster — UAE operations onboarding.` Used for audit trail context. Not used by the C3 protocol engine. |

### 8. ContractID

| Property | Value |
|---|---|
| Display name | `ContractID` |
| Internal name | `ContractID` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 50 |
| Description | ContractID this journey is linked to, e.g. `CTR-0001`. Typically set for `ContractRenewal` and `Offboarding` journey types. Plain text — not a SP Lookup. Leave blank for `Onboarding` journeys where no contract exists yet at initiation time. |

### 9. MissionID

| Property | Value |
|---|---|
| Display name | `MissionID` |
| Internal name | `MissionID` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 50 |
| Description | MissionID this journey was initiated in context of, e.g. `TR/2026/006`. Set when ops opens a journey from the Mission gap view. Informational only — the journey is not restricted to that mission. Leave blank for journeys initiated outside of a mission context. |

### 10. CompletedAt

| Property | Value |
|---|---|
| Display name | `CompletedAt` |
| Internal name | `CompletedAt` |
| Type | Date and Time |
| Required | No |
| Date format | **Date and Time** |
| Description | UTC datetime the journey reached `Completed` status. Set when the journey is manually completed by ops staff. Leave blank for Active and Suspended journeys. |

### 11. Notes

| Property | Value |
|---|---|
| Display name | `Notes` |
| Internal name | `Notes` |
| Type | Multiple lines of text |
| Required | No |
| Text type | Plain text |
| Rows | 4 |
| Description | Free-text operational notes, e.g. `All credentials verified and filed. Cleared for full operations.` Not used by the C3 protocol engine. |

### 12. ObligationAssignmentsJSON

| Property | Value |
|---|---|
| Display name | `ObligationAssignmentsJSON` |
| Internal name | `ObligationAssignmentsJSON` |
| Type | Multiple lines of text |
| Required | No |
| Text type | Plain text |
| Rows | 6 |
| Description | JSON serialization of per-obligation ownership declarations. Leave blank when no obligations are explicitly assigned. When a journey has obligation assignments, C3 uses this field to move specific gaps from `Routed` to `Covered` in the Situation Room. **Do not edit this field manually** — it is a structured field maintained by the C3 platform. |

**JSON format** (for reference — do not enter partial JSON):

```json
[
  {
    "obligationType": "Travel",
    "requirement": "Travel Authorization",
    "assignedTo": "pro.coordinator@geekay.gg",
    "assignedAt": "2026-01-10T09:30:00Z"
  }
]
```

**Field rules:**
- If blank or null: C3 treats the journey as having no explicit obligation assignments. All gaps for this person remain `Routed`.
- If valid JSON array: C3 parses each entry. Gaps whose `obligationType` matches an entry move to `Covered`.
- If malformed JSON: C3 logs a parse warning and treats the field as blank (no assignments). The journey remains functional — only the obligation assignment feature is lost.
- Valid `obligationType` values match the `CredentialCapability` union in the C3 codebase. Any unknown value is ignored with a warning.

> **Deferred: Normalization to a child list.** The `ObligationAssignmentsJSON` column (plain-text JSON) is accepted for the Sprint 16 read-only pilot. Before Journey write operations go live (Sprint 18), evaluate whether this column should be migrated to a normalized `C3ObligationAssignments` child list with a `JourneyID` foreign key. A child list is more queryable, auditable, and avoids JSON parse risk in a write context where malformed data would silently corrupt coverage state. The migration trigger, child list schema, and any required data backfill must be defined and agreed before Sprint 18 provisioning begins. This deferral is consistent with the ADR-003 approach to normalization decisions. See ADR-013 (Governance Approval Pattern) for write-path governance constraints.

---

## Index Summary

Create indexes on the following columns:

| Column | Reason |
|---|---|
| `PersonID` | `getActiveJourney()` and `listJourneysForPerson()` both filter by PersonID. Index prevents full-list scan. |
| `Status` | `listAllActiveJourneys()` filters `Status eq 'Active'` across all persons. Index is critical for list performance. |
| `JourneyType` | `getActiveJourney(personId, type)` filters by both PersonID and JourneyType. Index supports compound queries. Internal name is `JourneyType`; display name is `Type`. |

SharePoint supports up to 20 indexes per list. Using 3 here.

---

## Views

Create a default view with the following columns, in order:

1. Title (JourneyID)
2. PersonID
3. Type
4. Status
5. InitiatedBy
6. AssignedTo
7. InitiatedAt
8. CompletedAt

Sort: `InitiatedAt` descending (most recent at top).

Add a second view `Active Journeys` filtered by `Status eq Active`, sorted by `InitiatedAt` descending. This is the operational default view for ops staff monitoring open journeys.

Add a third view `Completed/Cancelled Journeys` filtered by `Status ne Active AND Status ne Suspended`, sorted by `CompletedAt` descending. This is the audit history view.

---

## Minimum Test Dataset

Provision these records before Sprint 16 regression testing. JourneyIDs and field values must match the mock service exactly. The C3 parity harness will compare SP output against mock output field by field.

### Mirror records (3) — for parity test

**JRN-0001** — Active Onboarding with obligation assignment (PER-0001, Abdulaziz)

| Field | Value |
|---|---|
| Title | `JRN-0001` |
| PersonID | `PER-0001` |
| Type | `Onboarding` |
| Status | `Active` |
| InitiatedAt | `2026-01-10 09:00` |
| InitiatedBy | `ops.coordinator@geekay.gg` |
| AssignedTo | `ops.coordinator@geekay.gg` |
| InitiationReason | `New season roster — UAE operations onboarding.` |
| ContractID | `CTR-0001` |
| ObligationAssignmentsJSON | `[{"obligationType":"Travel","requirement":"Travel Authorization","assignedTo":"pro.coordinator@geekay.gg","assignedAt":"2026-01-10T09:30:00Z"}]` |

**JRN-0002** — Active Onboarding with no obligation assignments (PER-0002, Mohammad)

| Field | Value |
|---|---|
| Title | `JRN-0002` |
| PersonID | `PER-0002` |
| Type | `Onboarding` |
| Status | `Active` |
| InitiatedAt | `2026-02-15 11:30` |
| InitiatedBy | `ops.coordinator@geekay.gg` |
| AssignedTo | `ops.coordinator@geekay.gg` |
| InitiationReason | `Transfer window acquisition — onboarding initiated.` |
| ObligationAssignmentsJSON | *(leave blank)* |

**JRN-0003** — Completed Onboarding (PER-0003, Diab)

| Field | Value |
|---|---|
| Title | `JRN-0003` |
| PersonID | `PER-0003` |
| Type | `Onboarding` |
| Status | `Completed` |
| InitiatedAt | `2025-09-01 08:00` |
| InitiatedBy | `ops.coordinator@geekay.gg` |
| AssignedTo | `ops.coordinator@geekay.gg` |
| InitiationReason | `Pre-season onboarding.` |
| ContractID | `CTR-0003` |
| CompletedAt | `2025-10-14 16:00` |
| Notes | `All credentials verified and filed. Cleared for full operations.` |
| ObligationAssignmentsJSON | *(leave blank)* |

> **Why these three:** JRN-0001 has an obligation assignment → PER-0001's Travel gap renders as `Covered`. JRN-0002 has none → PER-0002's gaps remain `Routed`. JRN-0003 is Completed → PER-0003 appears in the completed/historical view. Together these three seeds demonstrate all three ownership states (`Unrouted`, `Routed`, `Covered`) and both journey lifecycle states (`Active`, `Completed`) in the mock dataset.

### Stress records (3) — for diagnostic validation

| SP ID | Title | PersonID | Notes |
|---|---|---|---|
| 4 | *(blank)* | PER-0001 | Tests: hard reject for missing JourneyID (blank Title) |
| 5 | JRN-0005 | PER-XXXX | Tests: unknown PersonID — C3 should warn that FK does not resolve but retain the Journey |
| 6 | JRN-0006 | PER-0001 | Set the `JourneyType` field (display name: `Type`) to `UnknownType` (custom value). Tests: unknown JourneyType → hard reject, Journey excluded |

**Expected diagnostic output for stress records:**
```
[C3/Journey] Item 4: missing JourneyID — record rejected
[C3/Journey] Item 5: PersonID PER-XXXX does not resolve to a known person — Journey retained with unresolved FK
[C3/Journey] Item 6: unknown JourneyType "UnknownType" — Journey excluded from type-filtered queries
```

> Record 6 requires SP to allow custom choice values for the `JourneyType` field (internal name), which conflicts with the `Allow custom values: No` setting. If SP blocks the entry, note this in the test runbook and mark the stress test as environment-limited.

---

## Mapper Reference

When implementing `spJourneyMapper.ts` (future sprint, after S16), map SP fields to the `Journey` type as follows:

| SP Column / Property | C3 `Journey` field | Notes |
|---|---|---|
| `item.Id` | *(not mapped)* | SP item Id not used in Journey type |
| `item.Title` | `Journey.JourneyID` | Title = JourneyID |
| `item.PersonID` | `Journey.PersonID` | FK to C3People |
| `item.JourneyType` | `Journey.Type` | SP internal name is `JourneyType`; domain field is `Journey.Type`. Cast to `JourneyType` union; hard reject if unknown. |
| `item.Status` | `Journey.Status` | Cast to `JourneyStatus`; hard reject if unknown |
| `item.InitiatedAt` | `Journey.InitiatedAt` | Full ISO 8601 datetime string preserved as-is. Do **not** use `normalizeSpDate()` — it strips to date-only. Use private `normalizeSpDateTime()` in the mapper. |
| `item.InitiatedBy` | `Journey.InitiatedBy` | String |
| `item.AssignedTo` | `Journey.AssignedTo` | Optional string |
| `item.InitiationReason` | `Journey.InitiationReason` | Optional string |
| `item.ContractID` | `Journey.ContractID` | Optional string |
| `item.MissionID` | `Journey.MissionID` | Optional string |
| `item.CompletedAt` | `Journey.CompletedAt` | Full ISO 8601 datetime string preserved as-is. Same rule as InitiatedAt — use `normalizeSpDateTime()`, not `normalizeSpDate()`. |
| `item.Notes` | `Journey.Notes` | Optional string |
| `item.ObligationAssignmentsJSON` | `Journey.obligationAssignments` | Parse JSON array; warn and treat as `undefined` if blank or malformed |

**ObligationAssignmentsJSON parse logic:**
```typescript
function parseObligationAssignments(raw: string | null | undefined): ObligationAssignment[] | undefined {
  if (!raw || raw.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[C3/Journey] ObligationAssignmentsJSON is not an array — treated as empty');
      return undefined;
    }
    return parsed as ObligationAssignment[];
  } catch {
    console.warn('[C3/Journey] ObligationAssignmentsJSON parse failed — treated as empty');
    return undefined;
  }
}
```

---

## Checklist Before Signoff

- [ ] List created at the correct site URL (`https://geekaygames.sharepoint.com/sites/C3`)
- [ ] All 12 custom columns present with correct internal names (check via Site Settings → List Settings)
- [ ] `JourneyType` choice field (display name: `Type`) has exactly 5 values, matching TypeScript casing (`Onboarding`, `VisaRenewal`, etc.)
- [ ] `JourneyType` internal name verified via REST: `/_api/web/lists/getbytitle('C3 Journeys')/fields?$filter=Title eq 'Type'` → `InternalName` must equal `JourneyType`
- [ ] `Status` choice field has exactly 4 values, matching TypeScript casing
- [ ] `ObligationAssignmentsJSON` configured as plain text multiline (not Enhanced Rich Text)
- [ ] Indexes created on `PersonID`, `Status`, `JourneyType`
- [ ] Default view configured
- [ ] `Active Journeys` view configured
- [ ] `Completed/Cancelled Journeys` view configured
- [ ] 3 mirror records entered in order
- [ ] 3 stress records entered
- [ ] Confirm site URL and list REST endpoint with the C3 development team before starting S16-5
