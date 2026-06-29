# C3Approvals — SharePoint List Schema
## IT Provisioning Handover

**List internal name:** `C3Approvals`
**List display title:** `C3 Approvals`
**Sprint:** 18 — Governed Write Operations (Phase 1 pre-work)
**Status:** SCHEMA APPROVED — awaiting provisioning

This document is the authoritative schema reference for provisioning the `C3Approvals` list in SharePoint. It is the permanent audit store for all governed write operations in the C3 platform, as defined by ADR-013 (Governance Approval Pattern, approved 2026-06-29).

**Provisioning prerequisite:** This list must exist and be REST-verified before any Sprint 18 implementation code is written. No governed write path (`initiateJourney` or any other) can execute until this list is live and accessible from the SPFx context.

> **This list stores governance decisions, not operational data.** `C3Approvals` records are immutable audit entries — they are never deleted by C3 at any lifecycle stage. Rejected and ExecutionFailed records are as important to the audit trail as Executed records.

---

## Section 1 — Purpose

`C3Approvals` is the governance ledger for all write operations that C3 performs against production SharePoint data. Every proposed write — initiating a Journey, completing one, adding a credential — must create an entry in this list before any operational SharePoint write occurs.

The list serves three functions simultaneously:

**1. Approval queue.** Pending proposals (`Submitted`, `InReview`) are surfaced to the Platform Owner for review. No write executes until a proposal reaches `Approved`.

**2. Execution record.** When the Platform Owner approves, C3 executes the operational SharePoint write and transitions the record to `Executed` (success) or `ExecutionFailed` (write failed after approval). This makes the gap between approval decision and write outcome visible and explicit.

**3. Permanent audit trail.** Every record — including Rejected and ExecutionFailed — is retained for the lifetime of the platform. The record carries who submitted, who reviewed, when, and what the proposed operation contained (`Payload`). This satisfies the audit requirements in ADR-013 §Audit Trail Requirements.

---

## Section 2 — List settings

| Setting | Value |
|---|---|
| Title | C3 Approvals |
| Internal name | `C3Approvals` (no spaces) |
| Description | Governance approval records for all C3-initiated write operations. Permanent audit log — records are never deleted. |
| Versioning | Enable major versions. Set version limit to 50 (status transitions produce multiple versions per record). |
| Audience | Site members: read/write. Site owners: full control. External sharing: Off. |
| Item-level permissions | All members can read all items. Edit restricted to service account and Platform Owner. Ops staff should not be able to edit approval records directly after submission. |
| Attachments | Disabled. |

---

## Section 3 — Column definitions

### 3.1 Title (ApprovalID)

The built-in `Title` column is repurposed to store the approval identifier.

| Property | Value |
|---|---|
| Column name | `Title` (existing — do not rename the column) |
| Internal name | `Title` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Indexed | Yes |
| Purpose | Human-readable approval ID, e.g. `APR-0001`. C3 reads this as `ApprovalID`. |

**Naming convention:** `APR-` followed by a zero-padded 4-digit number matching the SP item ID (e.g. item 7 → `APR-0007`). Consistent with the `PER-`, `CRED-`, `JRN-` pattern across all C3 lists.

---

### 3.2 OperationType

| Property | Value |
|---|---|
| Display name | `OperationType` |
| Internal name | `OperationType` |
| Type | Choice |
| Required | Yes |
| Allow custom values | **No** |
| Default value | (none — force explicit selection) |
| Indexed | Yes — C3 queries pending approvals by OperationType |

**Choice values** (enter exactly as shown):

```
InitiateJourney
CompleteJourney
SuspendJourney
CancelJourney
AddCredential
DeactivateCredential
```

**Sprint 18 note:** Only `InitiateJourney` will be produced by C3 in Sprint 18. The remaining values are pre-provisioned to avoid list schema changes in Sprint 19.

---

### 3.3 TargetID

| Property | Value |
|---|---|
| Display name | `TargetID` |
| Internal name | `TargetID` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 20 |
| Indexed | No |
| Notes | FK to the target record being acted upon. For `InitiateJourney`, this is the new Journey ID to be assigned (e.g. `JRN-0004`). For state-transition operations (Complete, Suspend, Cancel), this is the existing Journey ID being transitioned. May be blank at submission time for new-record operations where the ID is assigned by the mapper at write time. |

---

### 3.4 TargetPersonID

| Property | Value |
|---|---|
| Display name | `TargetPersonID` |
| Internal name | `TargetPersonID` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Indexed | **Yes** — C3 queries pending approvals by PersonID to show the submitter which approvals are in flight for a given person |
| Notes | FK to `C3People.Title` (the `PER-NNNN` identifier). Plain text — not a SharePoint Lookup. |

---

### 3.5 SubmittedBy

| Property | Value |
|---|---|
| Display name | `SubmittedBy` |
| Internal name | `SubmittedBy` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 200 |
| Indexed | No |
| Notes | Login name or display name of the submitter. Populated by C3 from `PageContext.user.loginName` at submission time. Submission is permitted for any authorized C3Role (`operator`, `admin`, `owner`). This field does NOT restrict who may submit — restriction is enforced by C3 role check, not SP permissions. |

---

### 3.6 SubmittedAt

| Property | Value |
|---|---|
| Display name | `SubmittedAt` |
| Internal name | `SubmittedAt` |
| Type | Date and Time |
| Required | Yes |
| Format | Date and Time (not Date Only) |
| Indexed | No |
| Notes | UTC ISO 8601. Set by C3 at POST time. Used for timeout calculation (Q1: 3-business-day review window before admin escalation). |

---

### 3.7 ApprovalStatus

The status column uses a safe internal name (`ApprovalStatus`) to avoid the SharePoint reserved-word collision with `Status`. See Section 4 for detail.

| Property | Value |
|---|---|
| Display name | `ApprovalStatus` |
| Internal name | `ApprovalStatus` |
| Type | Choice |
| Required | Yes |
| Allow custom values | **No** |
| Default value | `Submitted` |
| Indexed | **Yes** — C3 queries pending approvals by ApprovalStatus |

**Choice values** (enter exactly as shown, in this order):

```
Submitted
InReview
Approved
Rejected
Executed
ExecutionFailed
```

**Critical:** The choice value strings must match the TypeScript `ApprovalStatus` union in `spApprovalMapper.ts` exactly — including casing. Any deviation causes the mapper to hard-reject the record.

| Value | Meaning |
|---|---|
| `Submitted` | Proposal submitted; awaiting Platform Owner review. No operational write has occurred. |
| `InReview` | Platform Owner has opened the proposal. No operational write has occurred. |
| `Approved` | Governance decision granted. C3 is executing the operational SharePoint write. `Approved` does NOT mean the write succeeded. |
| `Rejected` | Proposal declined. No operational write has occurred. Terminal and immutable. |
| `Executed` | Operational SharePoint write succeeded. `ExecutedAt` is set. Terminal. |
| `ExecutionFailed` | Approval was granted but the operational write failed. `ExecutionError` is populated. No operational record was created. Terminal — requires explicit Platform Owner resolution. |

---

### 3.8 ReviewedBy

| Property | Value |
|---|---|
| Display name | `ReviewedBy` |
| Internal name | `ReviewedBy` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Indexed | No |
| Notes | Identity of the approver or rejecter. Set by C3 at approval/rejection action time. Null until the proposal is reviewed. **C3 enforces that `ReviewedBy` ≠ `SubmittedBy` before advancing status to `Approved` or `Rejected`. If they match, the approval action fails and this field is not written.** |

---

### 3.9 ReviewedAt

| Property | Value |
|---|---|
| Display name | `ReviewedAt` |
| Internal name | `ReviewedAt` |
| Type | Date and Time |
| Required | No |
| Format | Date and Time |
| Indexed | No |
| Notes | UTC ISO 8601. Set by C3 at approval or rejection action time. Null until reviewed. |

---

### 3.10 ExecutedAt

| Property | Value |
|---|---|
| Display name | `ExecutedAt` |
| Internal name | `ExecutedAt` |
| Type | Date and Time |
| Required | No |
| Format | Date and Time |
| Indexed | No |
| Notes | UTC ISO 8601. Set by C3 when the operational SharePoint write completes successfully (`ApprovalStatus → Executed`). Null for all other states including `Approved`. The gap between `ReviewedAt` and `ExecutedAt` is the write execution latency. |

---

### 3.11 ExecutionError

| Property | Value |
|---|---|
| Display name | `ExecutionError` |
| Internal name | `ExecutionError` |
| Type | Multiple lines of text |
| Required | No |
| Allow rich text | No (plain text only) |
| Indexed | No |
| Notes | Error message and context populated when `ApprovalStatus = ExecutionFailed`. Includes HTTP status code, endpoint URL, and raw error if available. Null for all other states. Platform Owner uses this to diagnose the write failure. |

---

### 3.12 DelegatedBy

| Property | Value |
|---|---|
| Display name | `DelegatedBy` |
| Internal name | `DelegatedBy` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Indexed | No |
| Notes | Identity of the Platform Owner who authorised the delegation. Set at approval action time when a delegate is acting. Null for direct Platform Owner approvals. In Sprint 18, delegation is all-or-nothing — `DelegatedBy` and `DelegateTo` are set together or not at all. |

---

### 3.13 DelegateTo

| Property | Value |
|---|---|
| Display name | `DelegateTo` |
| Internal name | `DelegateTo` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Indexed | No |
| Notes | Identity of the delegate who performed the review and approval action. Null when the Platform Owner acts directly. The self-approval prohibition applies: `ReviewedBy` (= `DelegateTo` when delegation is in effect) must differ from `SubmittedBy`. |

---

### 3.14 Reason

| Property | Value |
|---|---|
| Display name | `Reason` |
| Internal name | `Reason` |
| Type | Multiple lines of text |
| Required | No |
| Allow rich text | No (plain text only) |
| Indexed | No |
| Notes | Optional context from the submitter explaining why this operation is being proposed. Shown to the Platform Owner in the ApprovalGatePanel. Not required for submission — required fields are enforced by the C3 UI, not SP column validation. |

---

### 3.15 RejectionReason

| Property | Value |
|---|---|
| Display name | `RejectionReason` |
| Internal name | `RejectionReason` |
| Type | Multiple lines of text |
| Required | No |
| Allow rich text | No (plain text only) |
| Indexed | No |
| Notes | Reason for rejection. Required in the C3 approval UI when the Platform Owner clicks Reject — the Platform Owner cannot submit a rejection without providing a reason. SP column is not marked Required (to avoid conflicts with other states), but C3 enforces it in the rejection action. Set at rejection time and immutable thereafter. |

---

### 3.16 Payload

| Property | Value |
|---|---|
| Display name | `Payload` |
| Internal name | `Payload` |
| Type | Multiple lines of text |
| Required | Yes |
| Allow rich text | No (plain text only) |
| Maximum characters | (SharePoint plain text multi-line: up to 63,999 characters — sufficient for any C3 operation payload) |
| Indexed | No |
| Notes | Serialised JSON of the proposed write input. The approver sees a human-readable summary in the ApprovalGatePanel; the raw JSON is stored here for service-layer execution. C3 reads this field to reconstruct the operation payload at execution time. **The Payload must be a valid JSON object.** Malformed Payload causes a hard mapper rejection — the approval record cannot be executed. |

**Payload format per OperationType:**

**`InitiateJourney` — Sprint 18:**

```json
{
  "operationType": "InitiateJourney",
  "personId": "PER-0003",
  "journeyId": "JRN-0004",
  "journeyType": "Onboarding",
  "initiatedBy": "ihab@geekayesports.com",
  "initiationReason": "New signing — credential establishment required before travel clearance.",
  "assignedTo": "ops-coordinator@geekayesports.com",
  "obligationAssignments": [
    {
      "obligationType": "Travel",
      "requirement": "Valid UAE residence visa required for KSA travel window",
      "assignedTo": "pro-coordinator@geekayesports.com",
      "assignedAt": "2026-06-29T10:00:00Z"
    }
  ]
}
```

All other `OperationType` values have no defined Payload schema for Sprint 18 — they will be specified in their respective sprint schema documents.

---

## Section 4 — Reserved-word and internal-name guidance

SharePoint reserves a number of common column names at the internal level. The most dangerous are `Status`, `Type`, `Title`, `Assigned`, `Author`, `Editor`, `Modified`, and `Created`. Using a reserved word as a custom column's internal name produces unpredictable behaviour — columns may silently store data under a different internal name, causing OData `$select` and `$filter` queries to return no data or HTTP 400.

**Critical naming decisions in this schema:**

| Column | Why NOT the obvious name | What to use instead |
|---|---|---|
| Approval status | `Status` is a SharePoint reserved metadata field | `ApprovalStatus` |
| Operation type | `Type` can collide in certain list contexts (see JourneyType correction in S17) | `OperationType` |

**Verification after provisioning:** After IT provisions each column, run the following REST query to confirm internal names:

```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$select=Title,InternalName,TypeAsString
```

For the two highest-risk columns, verify specifically:

```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$filter=Title eq 'ApprovalStatus'
```

Expected response: `InternalName: "ApprovalStatus"` — not `"ApprovalStatus0"` or any suffix. A suffix means SP silently renamed it to avoid a collision. If this occurs, the column must be deleted and re-created under a different display name before C3 can use it.

```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$filter=Title eq 'OperationType'
```

Expected response: `InternalName: "OperationType"`.

---

## Section 5 — Approval lifecycle state mapping

The full lifecycle for an `InitiateJourney` approval in Sprint 18:

```
[Submitter clicks "Start Onboarding Journey" in PersonProfile]
  │
  ▼
C3 role check passes (operator / admin / owner)
  │
  ▼
C3 POSTs to C3Approvals → ApprovalStatus: Submitted
SubmittedBy = current user; SubmittedAt = now; Payload = InitiateJourneyInput JSON
  │
  ▼
Platform Owner receives notification (in-app badge)
  │
  ▼
Platform Owner opens ApprovalGatePanel → C3 PATCHes ApprovalStatus: InReview
  │
  ├── [Platform Owner approves]
  │     C3 checks ReviewedBy ≠ SubmittedBy
  │     On match → approval blocked; ApprovalStatus stays InReview; error shown
  │     On pass  → C3 PATCHes ApprovalStatus: Approved; ReviewedBy = owner; ReviewedAt = now
  │                C3 POSTs to C3Journeys (the operational write)
  │                │
  │                ├── [Write succeeds]
  │                │     C3 PATCHes ApprovalStatus: Executed; ExecutedAt = now
  │                │     Journey card appears in Person Profile (next read cycle)
  │                │
  │                └── [Write fails]
  │                      C3 PATCHes ApprovalStatus: ExecutionFailed; ExecutionError = error detail
  │                      Platform Owner sees failure notification
  │                      No C3Journeys record exists
  │
  └── [Platform Owner rejects]
        C3 PATCHes ApprovalStatus: Rejected; RejectionReason required; ReviewedAt = now
        Submitter notified — no C3Journeys record created
        Record is immutable; re-submission creates a new APR-NNNN record
```

**Timeout path (Q1 resolution):**
- After 3 business days without any Platform Owner action on a `Submitted` record: admin role receives escalation notification (informational only — no approval authority granted)
- After 5 total business days without Platform Owner action: C3 auto-rejects with `RejectionReason: "Auto-rejected: approval timeout after 5 business days"`
- The timeout clock pauses once `ApprovalStatus` advances to `InReview`

---

## Section 6 — Payload format

The `Payload` column stores the complete, serialised proposed write input as a plain-text JSON object. The service deserialises this at execution time to construct the operational SharePoint POST body.

**Rules:**
- `Payload` must be a valid JSON object string. Malformed JSON causes hard mapper rejection.
- `Payload` must contain `operationType` matching the record's `OperationType` column value. Mismatch causes hard mapper rejection.
- `Payload` is immutable after submission. If a submitter realises the payload is wrong, they must reject the proposal themselves (if they are also the Platform Owner) or request rejection, then re-submit.
- `Payload` carries the full intent — not just the diff. The approver must be able to understand the complete proposed operation from the Payload alone, without referencing other SP lists.

**Payload schema version:** Sprint 18 defines v1 of the `InitiateJourney` payload (shown in Section 3.16). Future operation types will add their Payload schemas in their respective sprint documentation.

---

## Section 7 — Test dataset for provisioning

Before Sprint 18 implementation begins, the following rows should be created manually in `C3Approvals` to verify read paths work correctly. These are the same records that `s18-parity-approvals.mjs` will use as its SP-layer inputs.

### 7.1 Mirror records (mapper must accept)

**APR-0001 — Submitted InitiateJourney**

| Column | Value |
|---|---|
| Title | `APR-0001` |
| OperationType | `InitiateJourney` |
| TargetID | `JRN-0004` |
| TargetPersonID | `PER-0003` |
| SubmittedBy | `operator@geekayesports.com` |
| SubmittedAt | `2026-06-29T08:00:00Z` |
| ApprovalStatus | `Submitted` |
| ReviewedBy | (blank) |
| ReviewedAt | (blank) |
| ExecutedAt | (blank) |
| ExecutionError | (blank) |
| DelegatedBy | (blank) |
| DelegateTo | (blank) |
| Reason | `New signing PER-0003 requires Onboarding Journey before first travel window.` |
| RejectionReason | (blank) |
| Payload | `{"operationType":"InitiateJourney","personId":"PER-0003","journeyId":"JRN-0004","journeyType":"Onboarding","initiatedBy":"operator@geekayesports.com","initiationReason":"New signing — credential establishment required.","assignedTo":"ops@geekayesports.com","obligationAssignments":[]}` |

---

**APR-0002 — Approved but not yet Executed**

| Column | Value |
|---|---|
| Title | `APR-0002` |
| OperationType | `InitiateJourney` |
| TargetID | `JRN-0005` |
| TargetPersonID | `PER-0004` |
| SubmittedBy | `operator@geekayesports.com` |
| SubmittedAt | `2026-06-29T09:00:00Z` |
| ApprovalStatus | `Approved` |
| ReviewedBy | `owner@geekayesports.com` |
| ReviewedAt | `2026-06-29T09:30:00Z` |
| ExecutedAt | (blank) |
| ExecutionError | (blank) |
| DelegatedBy | (blank) |
| DelegateTo | (blank) |
| Reason | `PER-0004 is joining next roster cycle.` |
| RejectionReason | (blank) |
| Payload | `{"operationType":"InitiateJourney","personId":"PER-0004","journeyId":"JRN-0005","journeyType":"Onboarding","initiatedBy":"operator@geekayesports.com","initiationReason":"Roster cycle addition.","assignedTo":"ops@geekayesports.com","obligationAssignments":[]}` |

Purpose: Validates the service can detect an `Approved` record that needs its execution re-triggered (transient failure recovery path).

---

**APR-0003 — Executed (operational truth written)**

| Column | Value |
|---|---|
| Title | `APR-0003` |
| OperationType | `InitiateJourney` |
| TargetID | `JRN-0006` |
| TargetPersonID | `PER-0005` |
| SubmittedBy | `admin@geekayesports.com` |
| SubmittedAt | `2026-06-28T14:00:00Z` |
| ApprovalStatus | `Executed` |
| ReviewedBy | `owner@geekayesports.com` |
| ReviewedAt | `2026-06-28T15:00:00Z` |
| ExecutedAt | `2026-06-28T15:01:03Z` |
| ExecutionError | (blank) |
| DelegatedBy | (blank) |
| DelegateTo | (blank) |
| Reason | `Pre-tournament Onboarding for PER-0005.` |
| RejectionReason | (blank) |
| Payload | `{"operationType":"InitiateJourney","personId":"PER-0005","journeyId":"JRN-0006","journeyType":"Onboarding","initiatedBy":"admin@geekayesports.com","initiationReason":"Pre-tournament credential readiness.","assignedTo":"ops@geekayesports.com","obligationAssignments":[{"obligationType":"Travel","requirement":"Valid UAE residence visa","assignedTo":"pro@geekayesports.com","assignedAt":"2026-06-28T14:00:00Z"}]}` |

---

### 7.2 Stress records (mapper must handle gracefully)

**APR-S1 — Missing ApprovalID (blank Title)**

| Column | Value |
|---|---|
| Title | (blank) |
| OperationType | `InitiateJourney` |
| TargetPersonID | `PER-0006` |
| SubmittedBy | `operator@geekayesports.com` |
| SubmittedAt | `2026-06-29T10:00:00Z` |
| ApprovalStatus | `Submitted` |
| Payload | `{"operationType":"InitiateJourney","personId":"PER-0006","journeyId":"JRN-0007","journeyType":"Onboarding","initiatedBy":"operator@geekayesports.com","initiationReason":"Test.","assignedTo":"ops@geekayesports.com","obligationAssignments":[]}` |
| (all other fields) | (blank) |

**Expected mapper behaviour:** Hard reject — blank Title (ApprovalID) is required. Record excluded from results. `Rejected: 1` in aggregate log.

---

**APR-S2 — Invalid ApprovalStatus value**

| Column | Value |
|---|---|
| Title | `APR-S002` |
| OperationType | `InitiateJourney` |
| TargetPersonID | `PER-0007` |
| SubmittedBy | `operator@geekayesports.com` |
| SubmittedAt | `2026-06-29T10:05:00Z` |
| ApprovalStatus | `Pending` |
| Payload | `{"operationType":"InitiateJourney","personId":"PER-0007","journeyId":"JRN-0008","journeyType":"Onboarding","initiatedBy":"operator@geekayesports.com","initiationReason":"Test.","assignedTo":"ops@geekayesports.com","obligationAssignments":[]}` |
| (all other fields) | (blank) |

**Expected mapper behaviour:** Hard reject — `Pending` is not a valid `ApprovalStatus` value. `Rejected: 1` in aggregate log.

---

**APR-S3 — Malformed Payload**

| Column | Value |
|---|---|
| Title | `APR-S003` |
| OperationType | `InitiateJourney` |
| TargetPersonID | `PER-0008` |
| SubmittedBy | `operator@geekayesports.com` |
| SubmittedAt | `2026-06-29T10:10:00Z` |
| ApprovalStatus | `Submitted` |
| Payload | `{operationType: InitiateJourney, personId: PER-0008` |
| (all other fields) | (blank) |

**Expected mapper behaviour:** Soft warn — Payload present but not valid JSON. Record retained with `payload: undefined`. `Warnings: 1` in aggregate log. (Record is in `Submitted` state and cannot be executed — the Platform Owner will see it in the approval queue but execution will fail if attempted. The ExecutionFailed path handles this at execution time.)

---

## Section 8 — REST validation checklist

After IT provisions the `C3Approvals` list, perform the following verifications before declaring the list ready for Sprint 18 implementation.

**Step 1 — Confirm list exists:**
```
GET /_api/web/lists/getbytitle('C3 Approvals')
```
Expected: HTTP 200; `Title: "C3 Approvals"`, `BaseTemplate: 100`.

**Step 2 — Confirm all 16 columns present with correct InternalNames:**
```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$select=Title,InternalName,TypeAsString&$filter=Hidden eq false
```
Verify each column from Section 3 is present with the exact `InternalName` specified.

**Step 3 — Verify ApprovalStatus InternalName (highest-risk column):**
```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$filter=Title eq 'ApprovalStatus'
```
Expected: `InternalName: "ApprovalStatus"` — no suffix. If `"ApprovalStatus0"` or similar appears, the column must be deleted and re-created.

**Step 4 — Verify OperationType InternalName:**
```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$filter=Title eq 'OperationType'
```
Expected: `InternalName: "OperationType"` — no suffix.

**Step 5 — Verify ApprovalStatus choice values:**
```
GET /_api/web/lists/getbytitle('C3 Approvals')/fields?$filter=InternalName eq 'ApprovalStatus'&$select=Choices
```
Expected: `Choices: ["Submitted","InReview","Approved","Rejected","Executed","ExecutionFailed"]` — exact casing, exact order, no extras.

**Step 6 — Confirm indexes exist on TargetPersonID and ApprovalStatus:**
```
GET /_api/web/lists/getbytitle('C3 Approvals')/FieldIndexes
```
Expected: `TargetPersonID` and `ApprovalStatus` appear in the index list.

**Step 7 — Insert test record and read back:**
Manually create APR-0001 from Section 7.1. Then:
```
GET /_api/web/lists/getbytitle('C3 Approvals')/items?$select=Title,OperationType,TargetPersonID,ApprovalStatus,SubmittedBy,Payload&$filter=Title eq 'APR-0001'
```
Expected: HTTP 200; all selected fields present with correct values. Verify `ApprovalStatus` returns `"Submitted"` as a string (not a numeric SP choice ID).

**Step 8 — Confirm $filter on ApprovalStatus works:**
```
GET /_api/web/lists/getbytitle('C3 Approvals')/items?$filter=ApprovalStatus eq 'Submitted'
```
Expected: Returns APR-0001 (and APR-S003 if stress records are inserted). HTTP 400 here means the internal name is wrong — most likely `ApprovalStatus0`.

---

## Section 9 — Mapper and service notes (for Sprint 18 Phase 2)

These notes are for the implementation team and are not provisioning instructions.

**SpApprovalItem interface (to be defined in Phase 2):**

The raw SP REST response item will have these fields at the top level. The mapper (`spApprovalMapper.ts`) must handle all hard-reject and soft-warn cases consistently with the S15/S16/S17 mapper pattern.

```typescript
// Future: packages/c3/src/utils/spApprovalMapper.ts
interface SpApprovalItem {
  Id: number;
  Title: string | null;               // ApprovalID
  OperationType: string | null;
  TargetID: string | null;
  TargetPersonID: string | null;
  SubmittedBy: string | null;
  SubmittedAt: string | null;         // Date and Time — use normalizeSpDateTime
  ApprovalStatus: string | null;
  ReviewedBy: string | null;
  ReviewedAt: string | null;          // Date and Time — use normalizeSpDateTime
  ExecutedAt: string | null;          // Date and Time — use normalizeSpDateTime
  ExecutionError: string | null;
  DelegatedBy: string | null;
  DelegateTo: string | null;
  Reason: string | null;
  RejectionReason: string | null;
  Payload: string | null;             // JSON string — parse carefully; malformed = soft warn
}
```

**Hard-reject conditions (mapper returns null, increments `rejectedRef.count`):**
- Blank or null `Title` (ApprovalID)
- Blank or null `TargetPersonID`
- `OperationType` not in `ApprovalOperationType` union
- `ApprovalStatus` not in `ApprovalStatus` union

**Soft-warn conditions (mapper retains record, increments `warnRef.count`):**
- Malformed or non-object `Payload` — set `payload: undefined`
- `SubmittedAt` not a valid datetime string — set `submittedAt: undefined`

**Self-approval enforcement:** This is NOT the mapper's responsibility. The mapper is pure — it reads what is in SP. Self-approval enforcement is the service's responsibility at the approval action write path.

**DateTime fields:** `SubmittedAt`, `ReviewedAt`, `ExecutedAt` are all SP `Date and Time` columns. Use `normalizeSpDateTime()` (from `spJourneyMapper.ts` — promote to `dateUtils.ts` in Phase 2). Do NOT use `normalizeSpDate()` — that strips to date-only and corrupts the time component needed for timeout calculation.

**Aggregate diagnostic log pattern:**
```
[C3/Approval] listPendingApprovals: fetched N SP records. Mapped: M. Rejected: R. Warnings: W.
```

---

## Section 10 — Explicit out of scope for this document

This schema document defines the list structure only. The following are explicitly deferred:

- **Source code** — no TypeScript, no mapper, no service, no hooks, no UI components in this document
- **SharePoint provisioning** — this document is the handover brief; IT provisions the list separately
- **Approval UI** — `ApprovalGatePanel.tsx` and `StartJourneyPanel.tsx` modifications are Sprint 18 Phase 3
- **Power Automate flows** — notification mechanism is in-app badge for Sprint 18; PA email is Sprint 19+
- **Direct writes** — no C3 write may bypass ADR-013; this schema does not define any write shortcut
- **C3Journeys schema changes** — `C3Approvals` is a new list; no changes to existing lists in Phase 1
- **Batch approval schema** — deferred per ADR-013 Q2 resolution (individual-only for Sprint 18)
- **Scoped delegation schema** — deferred per ADR-013 Q4 resolution (Sprint 19+)

---

## Index summary

| Column | InternalName | Type | Required | Indexed |
|---|---|---|---|---|
| Title (ApprovalID) | `Title` | Single line text | Yes | Yes (built-in) |
| OperationType | `OperationType` | Choice | Yes | Yes |
| TargetID | `TargetID` | Single line text | No | No |
| TargetPersonID | `TargetPersonID` | Single line text | Yes | Yes |
| SubmittedBy | `SubmittedBy` | Single line text | Yes | No |
| SubmittedAt | `SubmittedAt` | Date and Time | Yes | No |
| ApprovalStatus | `ApprovalStatus` | Choice | Yes | Yes |
| ReviewedBy | `ReviewedBy` | Single line text | No | No |
| ReviewedAt | `ReviewedAt` | Date and Time | No | No |
| ExecutedAt | `ExecutedAt` | Date and Time | No | No |
| ExecutionError | `ExecutionError` | Multi-line text | No | No |
| DelegatedBy | `DelegatedBy` | Single line text | No | No |
| DelegateTo | `DelegateTo` | Single line text | No | No |
| Reason | `Reason` | Multi-line text | No | No |
| RejectionReason | `RejectionReason` | Multi-line text | No | No |
| Payload | `Payload` | Multi-line text | Yes | No |

**Indexed columns (4):** `Title` (built-in), `OperationType`, `TargetPersonID`, `ApprovalStatus`

**Provisioning order:** Create columns in the order listed in Section 3 (3.1 → 3.16). This ensures SP generates InternalNames without collision-avoidance suffixes.
