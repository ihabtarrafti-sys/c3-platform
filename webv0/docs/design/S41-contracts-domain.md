# Sprint 41 — Contracts: the FULL Working Domain (Design & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-08 · **Owner direction:** no read-only stopgap — contracts ship working. This domain goes deliberately BEYOND the CP: the CP's contracts were read-only V1 and its capture-renewal write was a mock; webv0 ships governed contract creation, renewal, and termination.

## Entity

**Contract** — `CTR-XXXX` (allocated business id), belongs to a person:
- `personId` (PER-XXXX, composite FK authoritative)
- `contractCode` — optional human canonical code (e.g. "GKE-PL-2026-001", ≤60, unique per tenant when present; the CP's canonical-identity convention preserved as a first-class field)
- `contractType` (required ≤120, e.g. "Player", "Staff")
- `startsOn` / `endsOn` — plain ISO dates (the Credentials discipline), endsOn required (a term contract; renewal extends it), endsOn >= startsOn
- `valueUsdCents` — nullable integer cents (money is integers, never floats; wire + storage in cents, UI formats). **Financial field: role-gated read.**
- `notes`, `status: 'Active' | 'Terminated'`, `version`, timestamps
- Terminated is terminal and stored; **Expired is DERIVED, never stored** — `contractRenewalStateOn(contract, today)` → `Terminated | Expired | Due30 | Due60 | Due90 | Active` (read-side, no scheduler; the credentialStatusOn pattern). Boundary: endsOn == today → Due30.

## Mutation split (the certified doctrine)

**GOVERNED (approval pipeline, OPERATION_TYPES 10 → 13):**
- `AddContract` — targetPersonId = owning person; created CTR recorded at execute (targetId write-once).
- `RenewContract` — input {contractId, newEndsOn > current endsOn}; execute extends the term; audit images old → new endsOn. *The write the CP deferred forever.*
- `TerminateContract` — input {contractId, reason required}; terminal; audit carries the reason.
- Guards: submit-friendly + execute-authoritative (contract exists / is Active / newEndsOn still > stored endsOn at execute); duplicate-pending refusal per contract (open approval for the same contract blocks a second material request — the missions pair-guard pattern, keyed on targetId).

**DIRECT-BUT-AUDITED (version-guarded, changed-fields-only images):**
- `updateContract` — NON-MATERIAL fields only: contractCode, contractType, notes. Dates and value are material terms and move ONLY through the governed ops (value amendments = future scope, recorded here deliberately).

## Role gating (contracts = webv0's first role-differentiated READ domain — Set E posture rebuilt)

- **NEW `canReadContracts`**: owner, operations, legal, finance, management — **hr and visitor are DENIED entirely** (CP Set-E ACL parity: nav hidden, routes 403, no silent empty states — "unavailable for your role", fail closed).
- **NEW `canViewFinancials`**: owner, operations, finance, management — legal reads contracts **without** USD values (value absent from DOM, not masked). Server-side: the read model omits `valueUsdCents` for non-financial roles; never a client-side hide.
- Submits ride `canSubmitApproval` (owner/ops); review/execute unchanged (owner).

## Read surfaces

Contracts register (CTR, code, person, type, dates, renewal-state badge, value where permitted) + contract detail page (DefinitionList, governed Renew…/Terminate… + direct Edit…, audit history) + Renewals view (the 30/60/90 windows as filtered register views — derived, truthful empty states) + person-profile contracts section (lands with S42's profile depth if not here).

## Increments

- **C1 domain**: contract.ts (entity, schemas, `contractRenewalStateOn` matrix), OPERATION_TYPES +3, AUDIT_ACTIONS +4 (ContractCreated/Renewed/Terminated/Updated), +CTR ids, capabilities +2 (ripples: authz, wire, policy tests), ApprovalDetail subject rows, executeApproval fail-closed stub.
- **C2 persistence + application**: migration 0013 (contract table, tenant-scoped unique contractCode, RLS FORCE, cents as bigint, composite FKs person+approval), governed submit/execute ×3 with the guard battery, direct update, financial-omission read model, export/exit +1 table. Test heart: renewal-state matrix + role-gated financial omission + execute-time guards.
- **C3 API**: register/detail/renewals reads (canReadContracts; financial omission per role), submit routes ×3, direct update route. HTTP tests: hr/visitor 404-shaped denial vs legal-no-financials vs finance-full.
- **C4 web + E2E + deploy**: register + detail + renewals views, nav gated by capability (absent for hr/visitor), dialogs with honest governance copy; E2E spec incl. legal-sees-no-values and visitor-sees-nothing; staging deploy + owner smoke → certification.

## Claims note

Nothing here is publicly claimable; "contract management" wording routes through the truthfulness pass after hosted certification.
