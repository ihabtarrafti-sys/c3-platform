# C3Credentials — SharePoint List Schema
## IT Provisioning Handover

**List internal name:** `C3Credentials`  
**List display title:** `C3 Credentials`  
**Sprint:** 15 — SharePoint Credential Integration  
**Status:** READY FOR PROVISIONING  

This document is the authoritative schema reference for provisioning the Credentials list in SharePoint. Column names, types, and choice values must be configured exactly as specified. Any deviation — including spacing in choice values — will cause the C3 runtime to log warnings and fall back to the `Other` catch-all capability, silently reducing a credential's operational contribution.

---

## List Settings

| Setting | Value |
|---|---|
| Title | C3 Credentials |
| Internal name | `C3Credentials` (no spaces) |
| Description | Operational credentials for all registered persons in the Geekay Esports C3 platform. |
| Versioning | Enable major versions. Set version limit to 10. |
| Audience | Site members (read/write). External sharing: Off. |
| Item-level permissions | Read all items. Edit only own items (ops staff enter their own records). |

---

## Required Column: Title (CredentialID)

The built-in `Title` column is **repurposed** to store the human-readable credential identifier.

| Property | Value |
|---|---|
| Column name | `Title` (existing — do not rename) |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Purpose | Human-readable credential ID, e.g. `CRED-0001`. C3 reads this as `CredentialID`. |
| Fallback | If left blank, C3 will auto-assign `CRED-{SP_Item_ID}` at runtime. Blank is permitted but discouraged. |

**Naming convention for ops staff:** `CRED-` followed by a zero-padded 4-digit number matching the SP item ID (e.g. item 42 → `CRED-0042`). This makes the column auditable by sorting.

---

## Custom Columns

Add the following columns in order. Column internal names must match the display names exactly (use identical casing — SharePoint preserves it).

### 1. HolderPersonID

| Property | Value |
|---|---|
| Display name | `HolderPersonID` |
| Internal name | `HolderPersonID` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 20 |
| Description | C3 application PersonID of the credential holder, e.g. `PER-0001`. Plain text — not a SharePoint Lookup. Must match exactly the PersonID stored in the People list. |
| Indexed | **Yes** — create an index on this column. C3 queries credentials by HolderPersonID. |
| Validation | No SP-level validation. C3 runtime validates and rejects records with a missing or blank value. |

### 2. CredentialType

| Property | Value |
|---|---|
| Display name | `CredentialType` |
| Internal name | `CredentialType` |
| Type | Choice |
| Required | Yes |
| Allow custom values | **No** — choice must be enforced |
| Default value | (none — force explicit selection) |

**Choice values** (enter exactly as shown, one per line, preserving casing and no extra spaces):

```
Passport
NationalID
EmiratesID
Iqama
ResidencePermit
DriversLicense
Visa
EntryPermit
WorkPermit
LabourCard
LeagueRegistration
FederationLicense
TransferClearance
InsuranceCard
MedicalClearance
BankAccount
TaxNumber
Other
```

**Total: 18 values** (17 domain-specific + `Other` catch-all). The TypeScript `CredentialType` union in C3 has exactly these 18 values. Any value not in this list will cause C3 to log a warning and map the credential to `Other`, effectively removing its operational capability contribution.

### 3. ReferenceNumber

| Property | Value |
|---|---|
| Display name | `ReferenceNumber` |
| Internal name | `ReferenceNumber` |
| Type | Single line of text |
| Required | Yes |
| Maximum characters | 100 |
| Description | The document's own reference number — passport number, visa number, Emirates ID number, etc. |

### 4. IssuedBy

| Property | Value |
|---|---|
| Display name | `IssuedBy` |
| Internal name | `IssuedBy` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 200 |
| Description | Issuing authority, e.g. `UAE General Directorate of Residency`, `Kingdom of Saudi Arabia`, `IESF`. |

### 5. IssuedDate

| Property | Value |
|---|---|
| Display name | `IssuedDate` |
| Internal name | `IssuedDate` |
| Type | Date and Time |
| Required | No |
| Date format | **Date Only** (no time component) |
| Description | ISO 8601 date the document was issued. Leave blank if unknown. |

### 6. ExpiryDate

| Property | Value |
|---|---|
| Display name | `ExpiryDate` |
| Internal name | `ExpiryDate` |
| Type | Date and Time |
| Required | No |
| Date format | **Date Only** |
| Indexed | **Yes** — C3 may query by expiry range in future sprints. |
| Description | ISO 8601 expiry date. **Leave blank for documents that do not expire** (e.g. some LeagueRegistrations, BankAccount). A blank ExpiryDate means the document is treated as perpetually valid by the C3 protocol engine. Do not enter a placeholder date — this causes false urgency. |

### 7. ValidFromDate

| Property | Value |
|---|---|
| Display name | `ValidFromDate` |
| Internal name | `ValidFromDate` |
| Type | Date and Time |
| Required | No |
| Date format | **Date Only** |
| Description | The date the document becomes valid. Use for visas or permits with a future start date. The gap engine uses this to suppress a credential from satisfying obligations until the ValidFromDate is reached (future sprint). Leave blank if the document is valid immediately upon issue. |

### 8. SubType

| Property | Value |
|---|---|
| Display name | `SubType` |
| Internal name | `SubType` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 100 |
| Description | Optional sub-variant discriminator. Examples: `Employment Visa`, `Visit Visa`, `Tourist` (for Visa); `Residence` (for EntryPermit). Free text — no controlled vocabulary in v1. |

### 9. Notes

| Property | Value |
|---|---|
| Display name | `Notes` |
| Internal name | `Notes` |
| Type | Multiple lines of text |
| Required | No |
| Text type | Plain text |
| Rows | 3 |
| Description | Free-text operational notes for ops staff. Not used by the C3 protocol engine. |

### 10. IsActive

| Property | Value |
|---|---|
| Display name | `IsActive` |
| Internal name | `IsActive` |
| Type | Yes/No (checkbox) |
| Required | Yes |
| Default value | **Yes** |
| Indexed | **Yes** — C3 queries `IsActive eq 1` to fetch only active credentials. |
| Description | Uncheck when a credential is superseded by a renewal, revoked, or expired and manually deactivated. C3 only evaluates active credentials for obligation satisfaction. Inactive credentials are retained as audit history but are invisible to the protocol engine. |

### 11. SupersedesCredentialID

| Property | Value |
|---|---|
| Display name | `SupersedesCredentialID` |
| Internal name | `SupersedesCredentialID` |
| Type | Single line of text |
| Required | No |
| Maximum characters | 20 |
| Description | CredentialID of the document this credential replaces (renewal chain). When renewing a passport, enter the old `CRED-xxxx` here and set the old record's `IsActive` to No. Used for audit trail only — the C3 engine does not currently traverse the renewal chain. |

---

## Index Summary

Create indexes on the following columns (list settings → Indexed columns):

| Column | Reason |
|---|---|
| `HolderPersonID` | C3 queries credentials by person. Index prevents full-list scans. |
| `IsActive` | `$filter=IsActive eq 1` is applied to every `listAllCredentials()` call. |
| `ExpiryDate` | Future sprint: expiry-window queries. Index proactively. |

SharePoint supports up to 20 indexes per list. Using 3 here.

---

## Views

Create a default view with the following columns, in order:

1. Title (CredentialID)
2. HolderPersonID
3. CredentialType
4. ReferenceNumber
5. IssuedDate
6. ExpiryDate
7. IsActive

Sort: `ExpiryDate` ascending (soonest expiry at top — ops staff need to see what expires next).

Add a second view `Inactive Credentials` filtered by `IsActive eq No`, sorted by `ExpiryDate` descending.

---

## Minimum Test Dataset

Provision these records before Sprint 15 regression testing. The CredentialIDs and HolderPersonIDs must match the mock service exactly.

### Mirror records (7) — for gap output parity test

| SP ID | Title | HolderPersonID | CredentialType | ReferenceNumber | IssuedDate | ExpiryDate | IsActive |
|---|---|---|---|---|---|---|---|
| 1 | CRED-0001 | PER-0001 | Passport | SA-G123456 | 2022-03-15 | 2032-03-14 | Yes |
| 2 | CRED-0002 | PER-0001 | Visa | UAE-VISA-889901 | 2025-07-10 | 2026-07-09 | Yes |
| 3 | CRED-0003 | PER-0001 | EmiratesID | 784-1990-1234567-1 | 2025-07-10 | 2027-07-09 | Yes |
| 4 | CRED-0004 | PER-0002 | Passport | JO-P456789 | 2021-11-01 | 2031-10-31 | Yes |
| 5 | CRED-0005 | PER-0003 | Passport | MA-AB789012 | 2023-05-20 | 2033-05-19 | Yes |
| 6 | CRED-0006 | PER-0003 | Visa | UAE-VISA-556677 | 2025-09-01 | 2027-08-31 | Yes |
| 7 | CRED-0007 | PER-0003 | EmiratesID | 784-1995-7654321-3 | 2025-09-01 | 2027-08-31 | Yes |

**Note on CRED-0002:** `ExpiryDate` 2026-07-09 is approximately 11 days from the Sprint 15 date. The C3 engine should classify this as `At Risk` (High urgency). Confirm this appears correctly in mixed-mode regression.

### Stress records (3) — for diagnostic validation test

Add these after the mirror records to verify defensive guards:

| SP ID | Title | HolderPersonID | CredentialType | Notes |
|---|---|---|---|---|
| 8 | CRED-0008 | *(leave blank)* | Passport | Tests: hard reject for missing HolderPersonID |
| 9 | CRED-0009 | PER-0001 | Work Permit | Tests: unknown CredentialType (note space) → maps to Other |
| 10 | CRED-0010 | PER-0001 | LeagueRegistration | ExpiryDate: enter `invalid-date` as free text in date field if possible; otherwise leave blank and set Notes to "stress-test: no expiry" |

**Expected diagnostic output for stress records:**
```
[C3/Credential] Item 8: missing HolderPersonID — record rejected
[C3/Credential] Item 9: unknown CredentialType "Work Permit" — mapped to Other
```

Record 10 may not produce a warning if the SP date field rejects non-date input — in that case, leave ExpiryDate blank and the test simply confirms that a credential without ExpiryDate is treated as non-expiring (no warning expected).

---

## Checklist Before Signoff

- [ ] List created at the correct site URL
- [ ] All 11 columns present with correct internal names (check via Site Settings → List Settings)
- [ ] `CredentialType` choice field has exactly 18 values, no extra spaces, matching TypeScript casing
- [ ] `IsActive` default = Yes
- [ ] Indexes created on `HolderPersonID`, `IsActive`, `ExpiryDate`
- [ ] Default view configured
- [ ] 7 mirror records entered
- [ ] 3 stress records entered
- [ ] Confirm site URL and list REST endpoint with the C3 development team before starting S15-3
