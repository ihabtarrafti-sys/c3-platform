# C3Contracts SP List Schema

**Sprint:** 24 Phase 0
**Status:** Proposed — Ready for provisioning
**Last updated:** 2026-07-01
**Author:** Engineering (C3 Platform)
**Purpose:** Define the SharePoint list schema for `C3Contracts` — the C3-native contract list
provisioned in Sprint 24. This document is the pre-condition for Phase 1 implementation and
IT/operator provisioning.
**Scope:** Read-only foundation. No contract write path in Sprint 24.

---

## 1. List Identity

| Property | Value |
|---|---|
| Display name | `C3Contracts` |
| Internal / API list title | `C3Contracts` |
| URL segment | `/Lists/C3Contracts` |
| Purpose | Contract records linked to C3People by canonical `PersonID` (PER-XXXX) |
| Naming convention | Follows C3 list convention: CamelCase, no underscore (matches `C3People`, `C3Credentials`, `C3Journeys`, `C3Approvals`) |

> **Important:** This is a new list, not a rename or migration of the legacy `C3_Contracts` list.
> `C3_Contracts` (underscore) remains in place as the legacy migration source. See [Out of Scope](#7-out-of-scope) and [Tech Debt TD-22](#future-notes--deferred-items).

---

## 2. Column Schema

| Internal Name | Display Name | SP Type | Required | Maps To (`Contract` field) | Notes |
|---|---|---|---|---|---|
| `Title` | Contract ID | Single line text | Yes | `ContractID` | Existing operational ID format (e.g. `GKE-PL-2026-003`). CTR-XXXX migration deferred. |
| `PersonID` | Person ID | Single line text | Yes | `PersonID` | PER-XXXX FK to `C3People.PersonID`. **Plain text — not an SP lookup column.** |
| `FullName` | Full Name | Single line text | Yes | `FullName` | Denormalized person display name. Avoids join overhead. |
| `DisplayName` | Display Name | Single line text | No | `DisplayName` | Optional IGN or short display name. |
| `ContractTypeName` | Contract Type | Single line text | Yes | `ContractTypeName` | Free text or constrained to known types (see [Choice Values](#4-choice-values)). |
| `AgreementCategory` | Agreement Category | Single line text | No | `AgreementCategory` | Optional classification within a contract type. |
| `ContractStage1` | Contract Stage | Choice | Yes | `ContractStage1` | Stage in the contract workflow (see [Choice Values](#4-choice-values)). Internal name uses `1` suffix for schema consistency with existing `Contract` type. |
| `Disposition1` | Disposition | Choice | No | `Disposition1` | Operational disposition of the contract (see [Choice Values](#4-choice-values)). Nullable — blank means undecided / active. Internal name uses `1` suffix for schema consistency. |
| `StartDate` | Start Date | Date and Time | No | `StartDate` | Contract commencement date. |
| `EndDate` | End Date | Date and Time | Yes | `EndDate` | Contract expiry date. **Used by app code to compute `OpsStatus`.** |
| `SignatureDate` | Signature Date | Date and Time | No | `SignatureDate` | Date the contract was signed. |
| `TerminationDate` | Termination Date | Date and Time | No | `TerminationDate` | Date of early termination, if applicable. |
| `HasSignedContract` | Has Signed Contract | Yes/No | No | `HasSignedContract` | Whether a signed document is on file. Defaults to `No` if blank. |
| `MonthlyCompensation` | Monthly Compensation | Currency | No | `MonthlyCompensation` | Base monthly compensation amount. |
| `CurrencyCode` | Currency Code | Single line text | No | `CurrencyCode` | ISO 4217 code: `AED`, `USD`, `SAR`, etc. |
| `PrizeSharePct` | Prize Share % | Number | No | `PrizeSharePct` | Prize pool share percentage (0–100). |
| `ContractOwnerEmail` | Contract Owner Email | Single line text | No | `ContractOwner.EMail` | Denormalized owner email. Avoids SP People/Group column complexity. |
| `ContractOwnerName` | Contract Owner Name | Single line text | No | `ContractOwner.Title` | Denormalized owner display name. |
| `IsActive` | Is Active | Yes/No | No | (internal filter) | Operational filter flag. Defaults to `Yes`. Not exposed on the `Contract` domain type — used for filtering in SP queries. |

### System / SP-managed columns (not provisioned manually)

| Column | Notes |
|---|---|
| `Id` | SP auto-incremented integer. Used internally by `$filter` queries. |
| `Created` | SP-managed creation timestamp. |
| `Modified` | SP-managed last-modified timestamp. |
| `Author` | SP-managed created-by person. |
| `Editor` | SP-managed last-modified-by person. |

---

## 3. SP List Settings

| Setting | Value |
|---|---|
| Content types | Disabled (single default content type is sufficient) |
| Versioning | Recommended: Major versions enabled, limit to 10 |
| Attachments | Disabled |
| Audience targeting | Disabled |
| Item-level permissions | Default (read all items, edit own) — adjust per security model |
| Indexing | Index `PersonID` and `EndDate` (see [Future Notes](#future-notes--deferred-items)) |

---

## 4. Choice Values

### `ContractStage1` — Contract Stage

| Value | Description |
|---|---|
| `Draft` | Contract is being drafted |
| `In Review` | Under internal review |
| `Pending Approval` | Awaiting formal approval |
| `Pending Signature` | Approved; awaiting counterparty signature |
| `Signed` | Fully executed |

Default: `Draft`

### `Disposition1` — Disposition

| Value | Description |
|---|---|
| `Active` | Contract is in active force |
| `Renewing` | Renewal process underway |
| `Terminated` | Contract terminated before natural expiry |
| `Archived` | Contract expired/concluded and archived |

Default: (none — leave blank for new contracts; set `Active` on first execution)

### `ContractTypeName` — Contract Type

Provisioned as **Single line text** (not Choice) to allow new contract types without SP list
schema changes. Operators enter values consistently. Recommended standard values:

| Value | Description |
|---|---|
| `Player` | Player contract |
| `Staff` | Non-player staff contract |
| `Coaching` | Coaching staff contract |
| `Management` | Management/executive contract |
| `Talent` | Content creator / talent contract |
| `Sponsorship` | Sponsorship agreement |

### `AgreementCategory` — Agreement Category

Provisioned as **Single line text** (not Choice). Recommended values:

| Value | Description |
|---|---|
| `Primary` | Main contract for the person |
| `Addendum` | Addendum to a primary contract |
| `Amendment` | Amendment to a primary contract (managed via Amendments module) |
| `NDA` | Non-disclosure agreement |
| `Secondment` | Secondment or loan agreement |

---

## 5. Relationship Model

### PersonID FK (C3 canonical pattern)

```
C3Contracts.PersonID  →  C3People.PersonID
```

`PersonID` is stored as a **plain text column** (`Single line text`) containing the PER-XXXX
canonical identifier (e.g. `PER-0001`).

This pattern is identical to all other C3 domain lists:

| List | FK to person |
|---|---|
| `C3Credentials` | `PersonID` (single line text, PER-XXXX) |
| `C3Journeys` | `PersonID` (single line text, PER-XXXX) |
| `C3Approvals` | `TargetPersonID` (single line text, PER-XXXX) |
| `C3Contracts` (new) | `PersonID` (single line text, PER-XXXX) ← this list |

**Why not an SP lookup column?**

The legacy `C3_Contracts` list used an SP lookup column (`Person`) that referenced the SP
User/Group store by numeric SP Id. This creates:

- Tight coupling to SP's internal user identity (breaks on user migration or site transfer)
- Inability to filter by C3's canonical `PersonID` (PER-XXXX) in OData queries
- Expansion overhead (`$expand=Person`) on every fetch
- A different FK model than every other C3 list

Using a plain text `PersonID` column:
- Matches C3's canonical FK model across all lists
- Enables simple OData filter: `$filter=PersonID eq 'PER-0001'`
- Survives SP user migration or tenant changes
- Is consistent with how the app layer is already built for credentials, journeys, and approvals

---

## 6. Computed Fields

The following fields are **NOT stored as SP columns**. They are derived in app code from stored values.

### `OpsStatus`

**Type in app:** `'Active' | 'Expiring30' | 'Expiring7' | 'Expired'`
**Derived from:** `EndDate`

Computation logic (in `contractMapper.ts` Phase 1 implementation):

```
daysToExpiry = Math.ceil((new Date(EndDate).getTime() - Date.now()) / 86_400_000)

daysToExpiry <= 0   →  'Expired'
daysToExpiry <= 7   →  'Expiring7'
daysToExpiry <= 30  →  'Expiring30'
else                →  'Active'
```

`computeDaysToExpiry()` already exists in `contractKpis.ts` and will be reused by the mapper.

**Rationale for not storing:** Storing `OpsStatus` in SP would create stale data risk (the
stored value would not update until someone edited the row). Computing from `EndDate` at read
time is always accurate.

---

## 7. Out of Scope

The following are explicitly deferred from Sprint 24 Phase 0 and Phase 1:

- **Contract creation** — no write path in this sprint
- **Contract update** — no MERGE or PATCH on C3Contracts in this sprint
- **Contract deactivation** — no `IsActive = false` write path in this sprint
- **Contract approval path** — ADR-013 governed contract write sprints are deferred
- **Contract amendments** — Amendments module is separate; deferred
- **Document management** — `PrimaryDocumentURL`, `DocumentCount`, `AmendmentCount` columns deferred
- **Team / GameTitle columns** — deferred; not part of the C3 canonical model for Phase 0
- **Manager / Reviewer / Approver columns** — deferred to contract write path sprint
- **Migration from `C3_Contracts`** — the legacy list is not migrated in this sprint. See TD-22.
- **ContractID format migration** — `GKE-PL-XXXX` → `CTR-XXXX` is deferred. `Title` holds the existing operational ID for now.
- **Mission / Finance / Induction integration** — deferred post-S24
- **Pagination / server-side cursor** — OData `$top=500` is acceptable for beta; pagination deferred

---

## 8. Provisioning Checklist

Steps for IT / SP Site Owner before Phase 1 implementation can be validated end-to-end in SP DSM.

```
[ ] 1. Create the list
        - Navigate to the SP site
        - Site Contents → New → List
        - Name: C3Contracts
        - Description: C3 contract records. Managed by C3 Platform.
        - Confirm internal list title is "C3Contracts" (no spaces, no underscores)

[ ] 2. Add columns (in order — SP preserves creation order in default view)
        - PersonID          Single line text        Required
        - FullName          Single line text        Required
        - DisplayName       Single line text        Optional
        - ContractTypeName  Single line text        Required
        - AgreementCategory Single line text        Optional
        - ContractStage1    Choice                  Required  (values: see §4)
        - Disposition1      Choice                  Optional  (values: see §4)
        - StartDate         Date and Time           Optional
        - EndDate           Date and Time           Required
        - SignatureDate     Date and Time           Optional
        - TerminationDate   Date and Time           Optional
        - HasSignedContract Yes/No                  Optional  (default: No)
        - MonthlyCompensation  Currency             Optional
        - CurrencyCode      Single line text        Optional
        - PrizeSharePct     Number                  Optional
        - ContractOwnerEmail Single line text       Optional
        - ContractOwnerName Single line text        Optional
        - IsActive          Yes/No                  Optional  (default: Yes)

[ ] 3. Configure Choice column values
        - ContractStage1: Draft / In Review / Pending Approval / Pending Signature / Signed
          Default: Draft
        - Disposition1: Active / Renewing / Terminated / Archived
          Default: (none)

[ ] 4. Add at least one test row
        - Use PersonID matching an existing PER-XXXX in C3People
        - See Sample Rows (§9) for an example
        - Set IsActive = Yes, EndDate to a future date

[ ] 5. Verify read permissions
        - C3 application pool account must have Read access to C3Contracts
        - Operations and Owner roles must have Read access

[ ] 6. Verify owner / operations edit access
        - Operations and Owner roles must have Contribute or Edit access
          (for future contract write path; no writes in Phase 0/1)

[ ] 7. Add SP indexes (recommended before Phase 1 smoke test)
        - Index: PersonID
        - Index: EndDate
        (Indexing guide: List Settings → Indexed columns)

[ ] 8. Smoke test after Phase 1 implementation
        - Open C3 in SP DSM
        - Navigate to a PersonProfile for a person whose PersonID matches the test row
        - Confirm the contract card appears in the Contracts section
        - Confirm ContractsList shows all C3Contracts rows
        - Confirm no console errors
```

---

## 9. Sample Rows

Use these rows as test data when provisioning. `PersonID` values must match existing records in `C3People`.

### Sample Row 1

| Column | Value |
|---|---|
| Title | `GKE-PL-2026-003` |
| PersonID | `PER-0001` |
| FullName | `Abdulaziz Alabdullatif` |
| DisplayName | `AbdulA` |
| ContractTypeName | `Player` |
| AgreementCategory | `Primary` |
| ContractStage1 | `Signed` |
| Disposition1 | `Active` |
| StartDate | `2026-01-01` |
| EndDate | `2026-12-31` |
| SignatureDate | `2026-01-02` |
| HasSignedContract | `Yes` |
| MonthlyCompensation | `1000` |
| CurrencyCode | `AED` |
| ContractOwnerEmail | `ihab@geekaygroupmea.com` |
| ContractOwnerName | `Ihab Tarrafti` |
| IsActive | `Yes` |

### Sample Row 2

| Column | Value |
|---|---|
| Title | `GKE-ST-2026-001` |
| PersonID | `PER-0002` |
| FullName | `Mohammed Al-Rashidi` |
| DisplayName | _(blank)_ |
| ContractTypeName | `Staff` |
| AgreementCategory | `Primary` |
| ContractStage1 | `Signed` |
| Disposition1 | `Active` |
| StartDate | `2026-03-01` |
| EndDate | `2026-07-15` |
| HasSignedContract | `Yes` |
| MonthlyCompensation | `1500` |
| CurrencyCode | `AED` |
| ContractOwnerName | `Ihab Tarrafti` |
| ContractOwnerEmail | `ihab@geekaygroupmea.com` |
| IsActive | `Yes` |

> Note: Sample Row 2's `EndDate` of `2026-07-15` is 14 days from today (2026-07-01). The app
> will compute `OpsStatus = 'Expiring30'` for this row.

---

## 10. Future Notes / Deferred Items

### TD-22 — Legacy `C3_Contracts` list migration deferred

The existing `C3_Contracts` list (underscore naming, SP lookup column FK model) is **not**
migrated in Sprint 24. It remains in place as a read-only historical reference. Migration
to `C3Contracts` is a separate planned effort.

Until migration is complete, `ContractsList` and `PersonProfile` contracts in SP DSM reflect
`C3Contracts` data only (new list, populated manually or via future import tooling). Historical
records in `C3_Contracts` are not visible through the C3 application after Phase 1.

### ContractID canonicalization deferred

`Title` stores the existing operational ID format (e.g. `GKE-PL-2026-003`). Migration to
`CTR-XXXX` format (consistent with `APR-XXXX`, `CRED-XXXX`, `JRN-XXXX`) is deferred to a
later sprint. When canonicalized, `Title` will store `CTR-XXXX` and the operational ID can
be stored in a separate `OperationalContractID` column.

### Contract write path deferred

Contract creation, update, and deactivation are deferred to a governed write sprint.
When implemented, they will follow the ADR-013 POST-then-MERGE pattern:
`POST` to create the SP row (receives SP auto-ID), derive `CTR-XXXX` from `Id`, `MERGE` canonical
title back. Write path will require a `C3Approvals` record for each mutation (same governance
pattern as credentials and journeys).

### Indexing recommendation

Before production load, add SP column indexes on `PersonID` and `EndDate`. SP list views with
`$filter` or `$orderby` on unindexed columns become slow above ~5,000 items and may trigger
throttling. `PersonID` is the primary FK filter; `EndDate` is the primary sort key for expiry
intelligence.

### Server-side pagination

Sprint 24 uses `$top=500`. For large rosters, add server-side OData pagination via `$skiptoken`
or increase the limit. Phase 1 `$top=500` is acceptable for beta.
