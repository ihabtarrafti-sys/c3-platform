# C3 Architecture Baseline — Sprint 24
**C3 Contract Control Center**
**Sprint:** 24 — Contracts / SP-02 Foundation
**Baseline date:** 2026-07-02
**Status:** CLOSED — 2026-07-02

---

## Closeout statement

Sprint 24 closes as:

> **"C3 has a native SharePoint contract read path. `C3Contracts` is a first-class SP list with a PersonID plain-text FK to `C3People`. `SharePointContractService` is a native-fetch implementation replacing the legacy PnP.js stub. TD-04 is resolved. The Intelligence screen is available in Mock DSM and hidden in SP DSM pending cold-load stabilization (TD-23). Contracts nav remains hidden in SP DSM pending IT provisioning. No contract writes or approvals. Read path only."**

---

## Section 1 — Architectural shifts introduced in Sprint 24

### Before Sprint 24 (Sprint 23 baseline)

- `SharePointContractService` returned `[]` (graceful PnP.js stub, TD-04)
- No `C3Contracts` schema document existed
- No contract types (`Contract`, `SPContractItem`) existed
- `contractMapper.ts` mapped the wrong SP list schema (legacy underscore columns)
- Intelligence screen existed but had never been validated against real SP contract data
- All intelligence metrics operated on `[]` (stub data) in SP DSM

### After Sprint 24

**1. C3Contracts SP list schema**

`docs/architecture/C3Contracts SP List Schema.md` defines the authoritative column set:
- `Title` — CON-XXXX identifier (auto-generated sequence, stored as SP Title column)
- `PersonID` — PER-XXXX plain text FK to C3People (no SP lookup column)
- `ContractStage1` — workflow stage: Draft / Active / Expired / Terminated
- `Disposition1` — operational state: Active / Inactive / On Hold / Cancelled
- `ContractType` — Player / Staff / Commercial / Sponsorship / Vendor / Other
- `StartDate`, `EndDate` — Date columns (normalised via `normalizeSpDate`)
- `Team`, `GameTitle` — plain text (NOT SP lookup columns)
- `Value`, `Currency` — contract financial metadata
- `Notes`, `AutoRenew`, `RenewalWindowDays`, `IsRenewalNotified` — operational fields

**FK relationship:** `C3Contracts.PersonID` → `C3People.PersonID` (PER-XXXX format, plain text join). No SP lookup column. Join is performed client-side by matching string values.

**2. SharePointContractService — native fetch**

`packages/c3/src/services/sharepoint/SharePointContractService.ts` replaces the PnP.js stub:

```
listContracts()        $select=*&$top=500&$orderby=EndDate asc
listRenewalContracts() $filter=EndDate ge [today] and Disposition1 eq 'Active'
getContract(id)        $filter=Title eq 'CON-XXXX'&$top=1
listContractActivities() stub → []
```

All error paths return `[]` or `null` (no throws). Network error, HTTP error, JSON parse error, and missing `value` array all degrade gracefully.

**3. contractMapper.ts — SPContractItem → Contract**

`packages/c3/src/mappers/contractMapper.ts` maps the C3Contracts SP REST response to the typed `Contract` interface:
- All date fields normalised via `normalizeSpDate`
- `OpsStatus` derived from `ContractStage1` + `EndDate` via `deriveOpsStatus`
- `SPContractItem` is typed permissively (all fields `unknown | null`) — type narrowing lives in the mapper

**4. Intelligence layer — cold-load safe**

`useIntelligence` was revised from `isLoading` (React Query v5 `isPending && isFetching`) to `isPending` (`status === 'pending'`):

```
Before:  isLoading = isPending && isFetching
         → false on first render (fetchStatus = 'idle' before effects run)
         → Intelligence renders full content → mounts Fluent UI Cards
         → effects start fetch → isLoading = true → skeleton → unmounts Cards
         → Cards' cleanup .set() call hits torn-down style-cache Map → crash

After:   isLoading = isPending
         → true from frame 0 regardless of fetchStatus
         → skeleton holds until queries resolve
         → no mount/unmount cycle during initial load
```

Data defaults moved to hook boundaries: `const { data: contracts = [] } = useContracts()`. `Array.isArray` guards added in `useMemo` for belt-and-suspenders safety.

**5. ErrorBoundary key prop**

`AppShell.tsx`: `<ErrorBoundary key={screen.id}>`. Resets the boundary on screen navigation, preventing a crash on one screen from permanently locking all subsequent screens.

**6. Intelligence hidden in SP DSM (TD-23 containment)**

Despite the `isPending` fix, the Intelligence first-click crash was not confirmed resolved in hosted SP DSM before the decision to contain and defer (TD-23). Intelligence is hidden in SP DSM via the same `visibleWhen` pattern used for Contracts and Amendments. Intelligence is fully functional in Mock DSM.

---

## Section 2 — Data layer after Sprint 24

### SP lists read by C3 (SP DSM)

| List | Read operations | Write operations | Sprint introduced |
|------|----------------|-----------------|-------------------|
| `C3People` | `listPeople`, `getPerson`, `listPersonContracts` | None | S16 |
| `C3Credentials` | `listCredentialsForPerson`, `getCredential` | `addCredential` (POST+MERGE), `deactivateCredential` (MERGE) | S20/S23 |
| `C3Approvals` | `listApprovals`, `getApproval` (stub) | `submitApproval` (POST), `approveApproval` (MERGE), `stampExecution` (MERGE) | S18 |
| `C3Journeys` | `listAllActiveJourneys`, `getJourney` | `createJourney` (POST), lifecycle transitions (MERGE) | S18/S19 |
| `C3Contracts` | `listContracts`, `listRenewalContracts`, `getContract` | **None** | **S24** |

### PersonID FK model

```
C3People.Title (PersonID)  ←──────────────────────────────────────────────────┐
C3Credentials.PersonID     (plain text FK, e.g. PER-0001)  ───────────────────┘
C3Approvals.TargetPersonID (plain text FK)  ───────────────────────────────────┘
C3Journeys.PersonID        (plain text FK)  ───────────────────────────────────┘
C3Contracts.PersonID       (plain text FK, NEW in S24)  ──────────────────────┘
```

All FKs are plain text (`PER-XXXX` format). No SP lookup columns. All joins are client-side string equality.

---

## Section 3 — NavRail visibility matrix (SP DSM)

| Screen | SP DSM | Mock DSM | Guard rationale |
|--------|--------|----------|-----------------|
| Command Center | ✅ | ✅ | Always visible |
| Contracts | ❌ | ✅ | Pending IT provisioning + smoke test (S24-P1 guard) |
| People | ✅ | ✅ | Live S16 |
| Renewals | ✅ (non-visitor) | ✅ | Live S24 (read only) |
| Amendments | ❌ | ✅ | SP service stub (S20 guard) |
| Inbox | ✅ (non-visitor) | ✅ | Live S18 |
| Situation Room | ✅ | ✅ | Live S17 |
| Intelligence | ❌ | ✅ | Cold-load crash containment (TD-23, S24-P1 guard) |
| Approvals | ✅ (non-visitor) | ✅ | Live S18 |
| Settings | ✅ (canManageSettings) | ✅ | Live S15 |
| Diagnostics | ✅ | ✅ | Always visible |

---

## Section 4 — Hook inventory after Sprint 24

### Contract hooks (new in S24)

| Hook | Source | Description |
|------|--------|-------------|
| `useContracts` | `@c3/hooks/useContracts` | All contracts: `listContracts()` |
| `useRenewalContracts` | `@c3/hooks/useRenewalContracts` | Renewal window contracts; EndDate guard |
| `useIntelligence` | `@c3/intelligence/useIntelligence` | Aggregates contracts/amendments/people into KPI and insight objects; `isPending`-based loading gate |

### Unchanged hooks (S23 baseline)

`useCredentials`, `useGetCredential`, `usePeople`, `useAmendments`, `useApp`, `useSP`, `useCapabilities`, `useSubmitCredentialApproval`, `useSubmitDeactivationApproval`, `useExecuteApproval`, `useRecoverCredentialExecutionStamp`, `useRecoverDeactivationExecutionStamp`, `usePersonApprovals`, `useMissions`, `useJourney`, `useStartJourney`, `useApproveApproval`, `useRejectApproval`

---

## Section 5 — Tech debt register state after Sprint 24

| ID | Item | Status |
|----|------|--------|
| TD-04 | SharePointContractService PnP.js | ✅ Resolved S24-P1 |
| TD-07 | No server-side TargetPersonID filter | Open |
| TD-13 | Credential write path not implemented | 🔵 Partial — AddCredential + DeactivateCredential live; reactivate pending |
| TD-14 | No CI/CD pipeline | Open |
| TD-15 | Runtime bundle committed to git | 🔵 Partial mitigation S21-P4 |
| TD-16 | ToasterGuard workaround | Open |
| TD-17 | No license file | Open |
| TD-19 | Approval list $top=500 truncation | Open |
| TD-21 | No journey audit timestamp columns | Open |
| TD-22 | Legacy C3_Contracts not migrated | Open / Deferred |
| TD-23 | Intelligence SP DSM cold-load crash | Open / Deferred (contained) |

---

## Section 6 — Runtime bundle state

| Attribute | Value |
|-----------|-------|
| Bundle SHA-256 | `21946b167d50ac047679221a19728da05d5aa39c1e0b87f0517f51a2065e9738` |
| Bundle size | 1,788.94 kB |
| Verified with | `npm run verify:runtime` |
| Built at HEAD | `cc88e92` |
