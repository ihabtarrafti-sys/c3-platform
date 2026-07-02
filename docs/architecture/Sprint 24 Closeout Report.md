# Sprint 24 Closeout Report — Contracts / SP-02 Foundation
**C3 Contract Control Center**
**Sprint:** 24 — Contracts / SP-02 Foundation
**Closeout date:** 2026-07-02
**Status:** CLOSED
**Preceding sprint:** Sprint 23 CLOSED (Credential Lifecycle Hardening)
**Validation baseline:** All parity harnesses pass, tsc clean, verify:runtime PASS, hosted SP DSM validation confirmed

---

## Closeout statement

Sprint 24 closes as:

> **"C3 now has a native SharePoint contract read path. `C3Contracts` is a first-class SP list with a PersonID plain-text FK to `C3People`. The full contract list is fetched and displayed in PersonProfile's contract card. `SharePointContractService` is a native-fetch implementation replacing the legacy PnP.js stub. `C3Contracts.PersonID` maps to `C3People.PersonID` (PER-XXXX format) — no SP lookup column, no numeric SP Id dependency. TD-04 is resolved. The Contracts nav item remains hidden in SP DSM pending IT list provisioning and full smoke test. Intelligence is temporarily hidden in SP DSM due to a contained cold-load crash (TD-23 / ERR-022); it is fully visible in Mock DSM. No contract writes, no contract approvals, no schema changes beyond the read foundation."**

Sprint 24 does **not** close as:

> ~~"Contract writes are implemented."~~
> ~~"Contract approval workflows are implemented."~~
> ~~"Contract screen is visible in SP DSM."~~
> ~~"Intelligence is stable in SP DSM cold-load."~~
> ~~"Legacy C3_Contracts migration is complete."~~
> ~~"Missions, Finance, Induction, or Productization work was done."~~

---

## Sprint objective

Deliver the Contracts / SP-02 read foundation: native SP fetch from the `C3Contracts` list, PersonID linkage to `C3People`, and contract display in PersonProfile. No writes. No approvals. Read path only.

---

## Completed phases

### Phase 0 — C3Contracts SP list schema documentation

**Commit:** `e5a6304` docs(s24-p0): Define C3Contracts SP list schema

- Created `docs/architecture/C3Contracts SP List Schema.md`
- Documents the full `C3Contracts` SP column set: Title (CON-XXXX), PersonID (PER-XXXX FK), ContractStage1, Disposition1, ContractType, StartDate, EndDate, Team, GameTitle, Value, Currency, Notes, AutoRenew, RenewalWindowDays, IsRenewalNotified
- Documents FK relationship: `C3Contracts.PersonID` → `C3People.PersonID` (plain text, not SP lookup column)
- Added TD-22: legacy `C3_Contracts` list (underscore naming, SP lookup columns) is not migrated in S24 scope

---

### Phase 1 — Native C3Contracts read path with PersonID linkage

**Commits:**
- `2fee558` feat(s24-p1): Add native C3Contracts read path with PersonID linkage
- `c866410` fix(s24-p1): Stabilize contract read path validation
- `28b9d77` fix(s24-p1): Stabilize Intelligence screen in SP DSM (ErrorBoundary key prop + useRenewalContracts EndDate guard)
- `46b193d` fix(s24-p1): Stabilize Intelligence cold-load path (isPending fix)
- `cc88e92` fix(s24-p1): Hide Intelligence in SP DSM pending cold-load stabilization

#### New types

- `packages/c3/src/types/contract.ts` — `Contract` type: all C3Contracts SP columns, fully typed and nullable-safe
- `packages/c3/src/types/index.ts` — `Contract` exported from types barrel

#### Mapper

- `packages/c3/src/mappers/contractMapper.ts` — `mapContract(item: SPContractItem): Contract`
  - Maps all SP REST column names to typed `Contract` fields
  - Normalizes date fields via `normalizeSpDate`
  - Derives `OpsStatus` from `ContractStage1` and `EndDate` via `deriveOpsStatus`
  - `SPContractItem` shape defined inline — permissive SP REST response type

#### SharePoint contract service

- `packages/c3/src/services/sharepoint/SharePointContractService.ts` — full native-fetch implementation:
  - `listContracts()`: `$select=*&$top=500&$orderby=EndDate asc`; returns `[]` on any network/HTTP/JSON/missing-value error
  - `listRenewalContracts()`: `$filter=EndDate ge ... and Disposition1 eq 'Active'`; EndDate window computed from today
  - `getContract(contractId)`: single-item fetch by Title (CON-XXXX); returns `null` if not found
  - `listContractActivities()`: stub returning `[]` (activity log out of scope)
  - Replaces legacy `SharePointContractService` which used PnP.js (TD-04 resolved)

#### Hooks

- `packages/c3/src/hooks/useContracts.ts` — `useQuery` wrapping `sp.listContracts()`
- `packages/c3/src/hooks/useRenewalContracts.ts` — `useQuery` wrapping `sp.listRenewalContracts()`, with EndDate guard before `computeDaysToExpiry`
- `packages/c3/src/hooks/usePeople.ts` — unchanged; PersonID is the join key
- `packages/c3/src/hooks/queryKeys.ts` — `contracts` group added: `all()`, `renewal()`, `byId(contractId)`

#### Intelligence layer

- `packages/c3/src/intelligence/contractKpis.ts` — `getContractKpis`, `isRenewalWindow`, `isCriticalRenewal`, `isNeedsAttention`, `isActiveDisposition`; all guards for missing EndDate
- `packages/c3/src/intelligence/intelligenceMetrics.ts` — `getWorkflowBreakdown`, `getDispositionBreakdown`, `getAmendmentBreakdown`, `getGameBreakdown`, `getTeamBreakdown`; all use locally-initialized Maps
- `packages/c3/src/intelligence/operationalInsights.ts` — `getOperationalInsights`; all filters guard missing EndDate
- `packages/c3/src/intelligence/useIntelligence.ts` — `useIntelligence` hook: `isPending` (not `isLoading`) used for the loading gate; data defaults at hook boundary (`data: X = []`); `Array.isArray` guards in useMemo
- `packages/c3/src/intelligence/index.ts` — barrel re-export (not used directly; all consumers use direct subpaths)

#### UI components

- `packages/c3/src/components/intelligence/ExecutiveKpiStrip.tsx` — KPI strip: Total Contracts, Active Contracts, In Renewal Window, Critical Renewals (≤30 days)
- `packages/c3/src/components/intelligence/RenewalHealthCard.tsx` — Renewal health summary card
- `packages/c3/src/components/intelligence/WorkflowBreakdownCard.tsx` — Workflow stage breakdown
- `packages/c3/src/components/intelligence/AmendmentHealthCard.tsx` — Amendment status summary
- `packages/c3/src/components/intelligence/PortfolioBreakdownCard.tsx` — Portfolio breakdown (game / team)
- `packages/c3/src/components/intelligence/OperationalInsightsPanel.tsx` — Sorted insight rows with severity dots
- `packages/c3/src/screens/Intelligence.tsx` — Intelligence screen: uses `useIntelligence`; skeleton on `isLoading`; error fallback; full dashboard on data

#### AppShell / NavRail

- `packages/c3/src/components/layout/AppShell.tsx` — `ErrorBoundary key={screen.id}` added; prevents stale error boundary on screen navigation
- `packages/c3/src/components/layout/NavRail.tsx`:
  - Contracts nav item: `visibleWhen: mode !== 'sharepoint'` (pre-existing S24-P1 guard, unchanged — pending IT provisioning)
  - Intelligence nav item: `visibleWhen: mode !== 'sharepoint'` (new S24-P1 guard, TD-23 containment)

#### ContractsList screen

- `packages/c3/src/screens/ContractsList.tsx` — list view of all contracts; displayed in Mock DSM

#### PersonProfile contract card

- Contract card added to PersonProfile showing active contracts for the selected person via `PersonID` linkage

---

## Commit summary

| Hash | Phase | Type | Description |
|------|-------|------|-------------|
| `e5a6304` | P0 | docs | Define C3Contracts SP list schema |
| `2fee558` | P1 | feat | Add native C3Contracts read path with PersonID linkage |
| `c866410` | P1 | fix | Stabilize contract read path validation |
| `28b9d77` | P1 | fix | Stabilize Intelligence screen in SP DSM (ErrorBoundary + EndDate guard) |
| `46b193d` | P1 | fix | Stabilize Intelligence cold-load path (isPending fix) |
| `cc88e92` | P1 | fix | Hide Intelligence in SP DSM pending cold-load stabilization |

HEAD at closeout: `cc88e92`
Preceding sprint HEAD: `c446230` (docs(s23))

---

## Validation summary

All validation performed at closeout (HEAD: `cc88e92`).

| Validation | Result |
|------------|--------|
| `s18-parity-approvals.mjs` | ✓ 27/27 passed |
| `s17-parity-journeys.mjs` | ✓ 51/51 passed |
| `s15-parity-test.mjs` | ✓ 87/87 passed |
| `s16-parity-people.mjs` | ✓ 220/220 passed |
| `tsc --noEmit` — `packages/c3` | ✓ Clean |
| `tsc --noEmit` — `packages/c3-spfx-host` | ✓ Clean |
| `npm run verify:runtime` | ✓ PASS — SHA-256: `21946b167d50ac047679221a19728da05d5aa39c1e0b87f0517f51a2065e9738` |

---

## Hosted SP DSM validation summary

| Scenario | Result |
|----------|--------|
| Intelligence nav item hidden in SP DSM | ✓ Not visible |
| Contracts nav item hidden in SP DSM | ✓ Not visible |
| Situation Room loads | ✓ |
| People loads | ✓ |
| Approvals loads | ✓ |
| PersonProfile loads | ✓ |
| No ErrorBoundary on any navigation | ✓ |
| Mock DSM — Intelligence visible and functional | ✓ |
| Mock DSM — Contracts visible and functional | ✓ |
| All S23 paths (credential lifecycle, journeys, approvals) | ✓ No regression |

---

## SharePoint lists involved

| List | Role in Sprint 24 | Schema change |
|------|-------------------|---------------|
| `C3Contracts` | New: read via `listContracts`, `listRenewalContracts`, `getContract` | None — read only; list must be provisioned by IT per schema doc |
| `C3People` | FK join target via PersonID | None |
| `C3Approvals` | No change in S24 | None |
| `C3Credentials` | No change in S24 | None |
| `C3Journeys` | No change in S24 | None |

**No SP schema changes were made in Sprint 24.** `C3Contracts` list provisioning is an IT prerequisite; the schema is documented in `docs/architecture/C3Contracts SP List Schema.md`.

---

## Tech debt changes in Sprint 24

| ID | Item | Status change |
|----|------|---------------|
| TD-04 | SharePointContractService used PnP.js | 🟡 → ✅ Resolved S24-P1 |
| TD-22 | Legacy `C3_Contracts` list not migrated | New — Open / Deferred |
| TD-23 | Intelligence SP DSM cold-load crash | New — Open / Deferred (contained) |

---

## Error library additions in Sprint 24

| Error | ERR ID |
|-------|--------|
| Intelligence SP DSM cold-load crash | ERR-022 |

---

## Scope boundaries preserved

The following were not touched at any point during Sprint 24:

- No contract writes implemented
- No contract approval workflows
- No ADR-013 `AddContract` operation
- No C3Approvals, C3Credentials, C3Journeys schema changes
- No Missions, Finance, or Induction work
- No credential/journey behavior changes
- No CI/CD pipeline
- Mock DSM unchanged — all credential, approval, and journey paths intact

---

## Remaining known limitations

| Limitation | Risk |
|------------|------|
| `C3Contracts` not yet provisioned in SP DSM | Contracts and Intelligence remain hidden in SP DSM until IT provisions the list and smoke test passes |
| Intelligence cold-load crash in SP DSM (TD-23) | Intelligence hidden in SP DSM; fully functional in Mock DSM |
| Legacy `C3_Contracts` data not migrated (TD-22) | Historical contracts not visible in C3 until migration tooling is built |
| No contract writes | Operators must enter contracts directly in SP; C3 reads only |
| Amendments hidden in SP DSM (stub service) | Pre-existing; unchanged |
| No CI/CD (TD-14) | Validation is manual throughout |

---

## Recommended Sprint 25 focus

### Priority 1 — Provision C3Contracts in SP DSM and smoke test

IT provisions `C3Contracts` per schema doc → hosted hard-refresh smoke test passes → remove Contracts nav guard → unhide Contracts in SP DSM.

### Priority 2 — Re-evaluate Intelligence SP DSM stability (TD-23)

After C3Contracts is live with real data, re-run the Intelligence cold-load test. The `isPending` fix (`46b193d`) addresses the leading hypothesis; if the hosted first-click passes cleanly, remove the Intelligence NavRail guard.

### Priority 3 — Contract write path (governed AddContract)

Implement `AddContract` as an ADR-013 governed write path, mirroring `AddCredential`. Requires IT-provisioned `C3Contracts` list and a contract entry UI (ContractsList or a new AddContractPanel).

### Non-priority (defer)

- Legacy `C3_Contracts` migration tooling (TD-22)
- Mission / Event Foundation (Track 6 in Product Expansion Backlog)
- Amendments SP adapter (stub service)
- CI/CD (TD-14)
