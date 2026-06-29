# Sprint 15 Proposal
## SharePoint Credential Integration

**Status:** PROPOSED  
**Follows:** Sprint 14 — Architecture Hardening and Production Readiness (v0.14.1-repo-normalization)  
**Version target:** v0.15.0-sp-credentials

---

## Framing Question

> Can C3 replace mock credentials with real SharePoint credential records while preserving readiness, gaps, ownership, and WorkItem behaviour?

Sprint 15 proves the first real-data bridge: SharePoint Credentials into the existing C3 reasoning engine. No other SP domain is touched. If credentials work end-to-end, the integration pattern is proven and every subsequent domain (People, Journeys, Missions) can follow the same path.

---

## Context

The credential pipeline already exists and works in mock mode:

```
SharePoint list
      ↓
SharePointCredentialService (currently a stub)
      ↓  listAllCredentials()
useOperationalGaps / useMissionGaps
      ↓  credentialsByPerson Map
computeGapsForPeople
      ↓
OperationalGap[]  →  WorkItem pipeline  →  Command Center
```

The stub returns empty arrays. Everything downstream handles empty arrays gracefully — it just produces no gaps. Sprint 15 replaces the stub with a real implementation while keeping mock mode fully functional and the rest of the stub services untouched.

The critical insight from the S14-7 risk assessment: credential data in SharePoint is far simpler to integrate than Missions or Journeys. Credentials are read-only in v1 (write path deferred), carry no cross-list relationships, and have a small, well-defined schema. The integration complexity is entirely in the type validation and date parsing layers.

---

## 1. Required SharePoint Credentials List Schema

**List name:** `C3Credentials`  
**Location:** Geekay Esports SharePoint site

| Column Name | SP Type | Required | Notes |
|---|---|---|---|
| `Title` | Single line of text | Yes | Stores `CredentialID` (e.g. `CRED-0001`). SP requires Title; repurpose it. |
| `HolderPersonID` | Single line of text | Yes | Our PersonID string (e.g. `PER-0001`). Plain text — not a SP Lookup. See §6. |
| `CredentialType` | Choice | Yes | 18 values (17 domain + `Other`). Must match `CredentialType` union exactly. See §5. |
| `ReferenceNumber` | Single line of text | Yes | Passport number, visa number, etc. |
| `IssuedBy` | Single line of text | No | Issuing authority. |
| `IssuedDate` | Date and Time | No | Date only mode (`DateOnly`). |
| `ExpiryDate` | Date and Time | No | Date only mode (`DateOnly`). Absent = non-expiring document. |
| `ValidFromDate` | Date and Time | No | For visas with future start dates. |
| `SubType` | Single line of text | No | Visa subtype, etc. |
| `Notes` | Multiple lines of text (plain) | No | Ops notes. |
| `IsActive` | Yes/No | Yes | Default: Yes. False = superseded or revoked. |
| `SupersedesCredentialID` | Single line of text | No | CredentialID of the document this replaces. |

SP built-in `ID` (integer) maps directly to `Credential.Id`.

**Column naming convention:** Use PascalCase matching the TypeScript interface exactly. This eliminates a translation layer and makes schema audits trivial.

**Required index:** Create an indexed column on `HolderPersonID` and `IsActive` to support efficient filtered queries (per-person credential fetch).

---

## 2. Field Mapping — SharePoint → `Credential`

The SP REST API returns list items as JSON objects. The mapping function `mapSpItemToCredential` in `utils/spCredentialMapper.ts` handles the translation:

| SP Field | TypeScript Field | Transform |
|---|---|---|
| `ID` | `Id` | Direct (integer) |
| `Title` | `CredentialID` | Direct string |
| `HolderPersonID` | `HolderPersonID` | Direct string — validated non-empty |
| `CredentialType` | `Type` | Type guard → `CredentialType` or `'Other'` with warning |
| `ReferenceNumber` | `ReferenceNumber` | Direct string |
| `IssuedBy` | `IssuedBy` | String or undefined |
| `IssuedDate` | `IssuedDate` | `normalizeSpDate()` → ISO date string or undefined |
| `ExpiryDate` | `ExpiryDate` | `normalizeSpDate()` → ISO date string or undefined |
| `ValidFromDate` | `ValidFromDate` | `normalizeSpDate()` → ISO date string or undefined |
| `SubType` | `SubType` | String or undefined |
| `Notes` | `Notes` | String or undefined |
| `IsActive` | `IsActive` | SP Yes/No → boolean. Default true if absent. |
| `SupersedesCredentialID` | `SupersedesCredentialID` | String or undefined |

SP REST API URL for all active credentials:

```
{siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items
  ?$select=ID,Title,HolderPersonID,CredentialType,ReferenceNumber,
           IssuedBy,IssuedDate,ExpiryDate,ValidFromDate,SubType,Notes,
           IsActive,SupersedesCredentialID
  &$filter=IsActive eq 1
  &$top=2000
```

`$filter=IsActive eq 1` keeps the payload small. Inactive credentials are never needed by the gap engine (protocol evaluation only considers active credentials). Inactive credential history is a future reporting concern.

---

## 3. Runtime Validation and Type Guards

All validation lives in `utils/spCredentialMapper.ts`. The mapper is a pure function with no React dependencies.

### 3.1 CredentialType

```typescript
const VALID_CREDENTIAL_TYPES = new Set<string>([
  'Passport', 'NationalID', 'EmiratesID', 'Iqama', 'ResidencePermit',
  'DriversLicense', 'Visa', 'EntryPermit', 'WorkPermit', 'LabourCard',
  'LeagueRegistration', 'FederationLicense', 'TransferClearance',
  'InsuranceCard', 'MedicalClearance', 'BankAccount', 'TaxNumber', 'Other',
]);

function isValidCredentialType(val: unknown): val is CredentialType {
  return typeof val === 'string' && VALID_CREDENTIAL_TYPES.has(val);
}
```

Guards against: SP choice field drift (e.g. "Work Permit" with a space, or a value added to SP but not yet in TypeScript), null, and empty string.

### 3.2 ExpiryDate

```typescript
function isValidIsoDate(val: unknown): val is string {
  if (typeof val !== 'string' || val.trim() === '') return false;
  const d = new Date(val);
  return !isNaN(d.getTime());
}
```

`ExpiryDate` is `undefined` (not `null`) when absent — undefined means the document does not expire, which is a valid and meaningful operational state (e.g. LeagueRegistration without a natural expiry). This matches the protocol evaluation: `daysUntilExpiry(undefined)` returns `null` → gap has no `daysToExpiry`.

### 3.3 HolderPersonID

```typescript
function isValidPersonId(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}
```

A credential with no HolderPersonID cannot be attributed to anyone — the record is rejected entirely. This is the only hard rejection; all other field failures degrade gracefully.

### 3.4 IsActive

SP Yes/No columns return as `true`/`false` booleans in REST responses. Guard:

```typescript
function parseIsActive(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 1 || val === '1' || val === 'Yes') return true;
  return false; // conservative default: treat unknown as inactive
}
```

### 3.5 CredentialID

`Title` doubles as CredentialID. If `Title` is empty or null (SP allows empty Title in some configurations), fall back to `CRED-${item.ID}`. This makes the mapper resilient to incomplete data entry:

```typescript
const credentialId = title?.trim() || `CRED-${item.ID}`;
```

---

## 4. Date Parsing Strategy and Invalid-Date Fallback

SP `DateOnly` columns return as `"2026-07-09T00:00:00Z"` (UTC midnight). The `Credential` interface stores dates as date-only strings (`"2026-07-09"`). The normaliser:

```typescript
function normalizeSpDate(val: unknown): string | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val !== 'string') return undefined;
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    logCredentialWarning(`Invalid date value: "${val}" — treating as absent`);
    return undefined;
  }
  return d.toISOString().split('T')[0]; // → "2026-07-09"
}
```

**Invalid date fallback decision:** Return `undefined`, not a sentinel date. Returning a sentinel (e.g. `"1970-01-01"`) would cause gap computation to see the credential as expired 56 years ago, generating false urgency. Returning `undefined` means the gap engine treats the document as non-expiring — a safer operational default. The diagnostic log records the anomaly for the ops team to correct.

---

## 5. Unknown CredentialType Handling

When `CredentialType` from SP does not match any known `CredentialType` value (18 values total — 17 domain types + `Other`):

1. **Log a warning** with the SP list item ID and the raw value:
   `[C3/Credential] Item {Id}: unknown CredentialType "{rawValue}" — mapped to Other`

2. **Map to `'Other'`** — `CREDENTIAL_CAPABILITIES['Other']` returns `[]`, so the credential satisfies no capability. It still appears in the person's credential list (AddCredentialPanel) but contributes nothing to gap resolution.

3. **Do not reject the record.** A credential with an unknown type is still a real document. Rejecting it would hide it from the ops team entirely. Mapping to `Other` preserves visibility while safely preventing it from satisfying any obligation.

This approach aligns with the SharePoint Risk Assessment (S14-7) finding that "choice field string matching fragility" is a High-risk item. The `'Other'` fallback is the blast radius containment: unknown types degrade to inert, never to incorrect.

---

## 6. HolderPersonID — Plain Text vs SharePoint Lookup

**Decision: plain text.**

A SP Lookup column stores an integer (`Id`) that references the People list's internal SP row ID. This is not the same as our application-layer `PersonID` string (`PER-0001`). A Lookup column would require:
- A join query (`$expand=HolderPersonID/PersonID`) or a second API call per credential
- The People list to be provisioned first (blocking dependency)
- Brittle mapping from SP item ID → PersonID string on every credential fetch

Plain text stores `"PER-0001"` directly. This matches the `HolderPersonID` field on the `Credential` interface exactly, requires no join, has no dependency on the People list being live, and survives People list schema changes without breaking credential reads.

**Risk:** Text is not referential — a typo in `HolderPersonID` will silently produce a credential that is never attributed to anyone. Mitigated by: (a) validation logs for PersonIDs that don't match any known Person, and (b) the fact that unattributed credentials simply don't appear in gap computation, they don't cause errors.

---

## 7. Mock and SharePoint Service Coexistence

The service registry switch is already implemented via `dataSourceMode` in the runtime context:

```typescript
// In the host's C3RuntimeLoader — already wired:
dataSourceMode: 'mock'       → createMockServiceRegistry()
dataSourceMode: 'sharepoint' → createSharePointServiceRegistry(siteUrl)
```

Sprint 15 only implements `SharePointCredentialService`. All other SP services remain stubs. This means in `'sharepoint'` mode:
- Credentials: real SP data ✅
- People, Missions, Journeys, Milestones, Finance: empty arrays from stubs

For the regression test scenario (§10), we run in `'sharepoint'` mode against a mirrored dataset. The fact that People and Journeys return empty from stubs means `computeGapsForPeople` receives `credentialsByPerson` from SP but an empty `people` list (since PeopleService is still a stub). This means we cannot run the full gap pipeline in pure SP mode yet.

**Workaround for Sprint 15 regression:** Implement a **mixed mode** flag for testing only — `dataSourceMode: 'sp-credentials-only'` — where the registry uses MockPersonService + MockJourneyService + SharePointCredentialService. This lets the gap pipeline run against real credential data without requiring all other SP services to be live.

If mixed mode adds too much complexity to the registry, the alternative is: run the comparison at the service layer only (call `listAllCredentials()` directly and diff the result) rather than through the full gap pipeline. This is simpler and adequate for Sprint 15.

**After Sprint 15:** once People SP service is live, the full gap pipeline can run in pure SP mode.

---

## 8. Diagnostic Logging for Rejected or Malformed Records

All diagnostic output uses a structured prefix for easy filtering in the browser console and future telemetry:

```
[C3/Credential] <message>
```

**Per-record warnings** (logged during `mapSpItemToCredential`):

```
[C3/Credential] Item 42: missing HolderPersonID — record rejected
[C3/Credential] Item 17: unknown CredentialType "Work Permit" (note space) — mapped to Other
[C3/Credential] Item 9: invalid ExpiryDate "not-a-date" — treated as non-expiring
[C3/Credential] Item 33: empty Title — CredentialID assigned as CRED-33
```

**Aggregate summary** (logged once per `listAllCredentials()` call):

```
[C3/Credential] listAllCredentials: fetched 47 SP records.
  Mapped:   44 credentials
  Rejected: 3 (missing HolderPersonID: 2, parse error: 1)
```

The aggregate summary uses `console.info` (not `console.warn`) so it appears in info-level logs even in production. Per-record warnings use `console.warn`.

**`SharePointDiagnosticsService`**: The existing diagnostics service should be extended to expose a `getCredentialLoadReport()` method returning the last-fetch aggregate so it can be surfaced in a future admin panel.

---

## 9. Minimum Test Dataset in SharePoint

Mirror the 7 mock credentials exactly. This allows a direct mock-vs-SP comparison in §10.

| SP ID | Title (CredentialID) | HolderPersonID | CredentialType | ReferenceNumber | IssuedDate | ExpiryDate | IsActive |
|---|---|---|---|---|---|---|---|
| 1 | CRED-0001 | PER-0001 | Passport | SA-G123456 | 2022-03-15 | 2032-03-14 | Yes |
| 2 | CRED-0002 | PER-0001 | Visa | UAE-VISA-889901 | 2025-07-10 | 2026-07-09 | Yes |
| 3 | CRED-0003 | PER-0001 | EmiratesID | 784-1990-1234567-1 | 2025-07-10 | 2027-07-09 | Yes |
| 4 | CRED-0004 | PER-0002 | Passport | JO-P456789 | 2021-11-01 | 2031-10-31 | Yes |
| 5 | CRED-0005 | PER-0003 | Passport | MA-AB789012 | 2023-05-20 | 2033-05-19 | Yes |
| 6 | CRED-0006 | PER-0003 | Visa | UAE-VISA-556677 | 2025-09-01 | 2027-08-31 | Yes |
| 7 | CRED-0007 | PER-0003 | EmiratesID | 784-1995-7654321-3 | 2025-09-01 | 2027-08-31 | Yes |

**Also add these validation stress records** (to test the type guard and logging paths):

| SP ID | Title | HolderPersonID | CredentialType | Notes |
|---|---|---|---|---|
| 8 | CRED-0008 | (empty) | Passport | → should be rejected (no HolderPersonID) |
| 9 | CRED-0009 | PER-0001 | Work Permit (space) | → should map to Other with warning |
| 10 | CRED-0010 | PER-0001 | LeagueRegistration | ExpiryDate: "invalid-date" | → should treat as non-expiring with warning |

Records 8–10 confirm the defensive layers work against real SP input.

---

## 10. Regression Plan — Mock vs SharePoint Mode

### Phase A: Service-layer parity test

Run both services against their data sources and compare raw output:

```typescript
// In a test harness or browser console:
const mockCreds    = await mockCredentialService.listAllCredentials();
const spCreds      = await spCredentialService.listAllCredentials();

// Group by HolderPersonID
const mockByPerson = groupBy(mockCreds, c => c.HolderPersonID);
const spByPerson   = groupBy(spCreds,   c => c.HolderPersonID);

// Compare counts per person
for (const personId of ['PER-0001', 'PER-0002', 'PER-0003']) {
  console.log(personId, {
    mock: mockByPerson[personId]?.length ?? 0,
    sp:   spByPerson[personId]?.length ?? 0,
  });
}
```

Expected result: identical counts per person.

### Phase B: Gap output parity test

Using mixed mode (MockPeople + MockJourneys + SharePointCredentials — see §7):

| Scenario | Mock mode | SP mode | Expected |
|---|---|---|---|
| All Gaps view | N gaps total | N gaps total | Identical |
| PER-0001 gap list | Visa expiring (At Risk) | Same | Identical |
| PER-0002 gap list | No Visa → Unsatisfied | Same | Identical |
| PER-0003 gap list | No gaps | Same | Identical |
| Command Center WorkItems | N items | N items | Identical |

Any divergence between mock and SP mode indicates either: (a) a data entry error in the SP test dataset, or (b) a bug in `mapSpItemToCredential`. The diagnostic logs from §8 will identify which.

### Phase C: Stress record validation

Confirm the diagnostic logs for records 8–10 (§9) appear as expected. Confirm no crash, no false gap, no silent data loss.

### Phase D: Full regression (post-comparison)

Once Phase A/B pass, run the standard Sprint 14 regression suite in SP mode to confirm no other surface is affected:
- All Gaps, TR/2026/006, SATR/2026/003, Command Center, Milestones, Finance, People Workspace, Add Credential, Start Journey.

---

## 11. Out of Scope for Sprint 15

The following are explicitly deferred:

- **SharePoint People service** — `MockPersonService` remains the source of truth for person metadata. Gap computation needs real persons; wiring People comes after credentials are proven.
- **SharePoint Journey service** — ownership state (Routed/Covered) requires the Journeys list and the `obligationAssignments` SP list (flagged Critical in S14-7). Deferred.
- **SharePoint Mission service** — Missions list design is pending.
- **SharePoint Finance, Milestones** — likewise deferred.
- **`addCredential` write path** — `SharePointCredentialService.addCredential` remains a stub. The AddCredentialPanel will continue calling mock write in SP mode in Sprint 15. This is safe because AddCredential is a separate workflow that the ops team can continue in mock mode while credential reads come from SP.
- **`deactivateCredential` write path** — same reasoning.
- **Credential history / inactive credentials** — `IsActive eq 0` records are not fetched in Sprint 15.
- **New protocol rules** — no changes to `credentialCapabilities.ts` unless a real-data issue proves a bug. The protocol layer is frozen.
- **UI changes** — credential display uses the same components. SP data will show up in the same panels without code changes.
- **PnP.js** — the SP fetch will use native `fetch()` against the SharePoint REST API (`_api/web/lists/...`). No new dependencies.
- **Pagination beyond 2000 items** — `$top=2000` covers Geekay's credential volume at launch. Cursor-based pagination is deferred until the dataset grows.
- **Multi-tenant / multi-site** — single siteUrl, single credentials list.

---

## Proposed Tasks

| ID | Task | Risk |
|---|---|---|
| S15-1 | Document `C3Credentials` SP list schema + create list | Low |
| S15-2 | Implement `utils/spCredentialMapper.ts` — type guards, date normaliser, mapper function | Medium |
| S15-3 | Implement `SharePointCredentialService` — `listAllCredentials`, `listCredentialsForPerson`, `getCredential` | Medium |
| S15-4 | Seed SP test dataset (7 mirror records + 3 stress records) | Low |
| S15-5 | Phase A regression — service-layer parity | Low |
| S15-6 | Phase B regression — gap output parity (mixed mode) | Medium |
| S15-7 | Phase C regression — stress record validation | Low |
| S15-8 | Phase D regression — full Sprint 14 suite in SP mode | Low |

**Sprint 15 rules:**
1. No new product features.
2. No UI changes.
3. Mock mode must remain fully working throughout.
4. SharePoint mode must fail safely — empty arrays, logged warnings, no crashes.
5. Protocol rules are frozen — no changes to `credentialCapabilities.ts` or `onboardingProtocol.ts` unless real data proves a bug.
6. Pause after S15-2 (mapper) for review before wiring it into the service.

---

## Definition of Done

Sprint 15 is complete when:

1. `SharePointCredentialService.listAllCredentials()` returns typed `Credential[]` from a real SharePoint list.
2. The 7 mirror credentials load without warnings in the diagnostic log.
3. The 3 stress records produce the expected per-record warnings and no crash.
4. Gap output in SP mode (mixed) is identical to mock mode for all three test persons.
5. Mock mode passes the full Sprint 14 regression suite unmodified.
6. `v0.15.0-sp-credentials` is tagged.
