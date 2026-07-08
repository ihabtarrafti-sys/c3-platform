# Sprint 41 — Agreements: the FULL Working Domain (Design & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-08 (renamed from "Contracts" same day on owner direction) · **Owner direction:** no read-only stopgap — and the domain is **AGREEMENTS**, not just contracts: player contracts, NDAs, addendums, MOUs share one governed lifecycle. This domain goes deliberately BEYOND the CP: the CP's contracts were read-only V1 and its capture-renewal write was a mock; webv0 ships governed creation, renewal, and termination.

## Entity

**Agreement** — `AGR-XXXX` (allocated business id), belongs to a person:
- `personId` (PER-XXXX, composite FK authoritative)
- `agreementCode` — optional human canonical code (e.g. "GKE-PL-2026-001", ≤60, unique per tenant when present; the CP's canonical-identity convention preserved as a first-class field)
- `agreementType` — free text ≤120 ("Player Contract", "NDA", "Addendum", "MOU", …) — free text keeps the owner's "etc. etc." open
- `linkedAgreementId` — **optional parent agreement (AGR-XXXX)**: what makes an addendum or side letter a first-class relationship instead of a naming convention. Settable at creation and via the direct patch (organizational metadata, not a financial term); self-linkage refused by the use-case; existence enforced friendly + composite FK authoritative.
- `startsOn` / `endsOn` — plain ISO dates (the Credentials discipline), endsOn required (a term agreement; renewal extends it), endsOn >= startsOn
- `valueUsdCents` — nullable integer cents (money is integers, never floats; an NDA usually carries none). **Financial field: role-gated read.**
- `notes`, `status: 'Active' | 'Terminated'`, `version`, timestamps
- Terminated is terminal and stored; **Expired is DERIVED, never stored** — `agreementRenewalStateOn(agreement, today)` → `Terminated | Expired | Due30 | Due60 | Due90 | Active` (read-side, no scheduler; the credentialStatusOn pattern). Boundary: endsOn == today → Due30.

## Mutation split (the certified doctrine)

**GOVERNED (approval pipeline, OPERATION_TYPES 10 → 13):**
- `AddAgreement` — targetPersonId = owning person; created AGR recorded at execute (targetId write-once).
- `RenewAgreement` — input {agreementId, newEndsOn > current endsOn}; execute extends the term; audit images old → new endsOn. *The write the CP deferred forever.*
- `TerminateAgreement` — input {agreementId, reason required}; terminal; audit carries the reason.
- Guards: submit-friendly + execute-authoritative (agreement exists / is Active / newEndsOn still beats the stored endsOn at execute); duplicate-pending refusal per agreement (an open approval for the same agreement blocks a second material request — the missions guard pattern, keyed on targetId).

**DIRECT-BUT-AUDITED (version-guarded, changed-fields-only images):**
- `updateAgreement` — NON-MATERIAL fields only: agreementCode, agreementType, linkedAgreementId, notes. Dates and value are material terms and move ONLY through the governed ops (value amendments = future scope, recorded here deliberately — an "Amendment" today is an addendum agreement linked to its parent).

## Role gating (agreements = webv0's first role-differentiated READ domain — Set E posture rebuilt)

- **NEW `canReadAgreements`**: owner, operations, legal, finance, management — **hr and visitor are DENIED entirely** (CP Set-E ACL parity: nav hidden, routes 403, no silent empty states — "unavailable for your role", fail closed).
- **NEW `canViewFinancials`**: owner, operations, finance, management — legal reads agreements **without** USD values (value absent from the payload, not masked). Server-side omission; never a client-side hide.
- Submits ride `canSubmitApproval` (owner/ops); review/execute unchanged (owner).

## Read surfaces

Agreements register (AGR, code, person, type, dates, renewal-state badge, value where permitted, linked-agreement column) + agreement detail page (DefinitionList incl. parent/child links, governed Renew…/Terminate… + direct Edit…, audit history) + Renewals view (the 30/60/90 windows as filtered register views — derived, truthful empty states) + person-profile agreements section (lands with S42's profile depth if not here).

## Increments

- **C1 domain** ✅ (built as Contracts at `e06b6d0`, renamed to Agreements + `linkedAgreementId` added before anything shipped): agreement.ts, OPERATION_TYPES +3, AUDIT_ACTIONS +4, +AGR ids, capabilities +2, all ripples, fail-closed executor stub.
- **C2 persistence + application**: migration 0013 (agreement table, tenant-scoped unique agreementCode, RLS FORCE, cents as bigint, composite FKs person + approval + self-reference for linkage), governed submit/execute ×3 with the guard battery, direct update (self-link refusal), financial-omission read model, export/exit +1 table. Test heart: renewal-state matrix + role-gated financial omission + execute-time guards + linkage integrity.
- **C3 API**: register/detail/renewals reads (canReadAgreements; financial omission per role), submit routes ×3, direct update route. HTTP tests: hr/visitor denial, legal-no-financials, finance-full.
- **C4 web + E2E + deploy**: register + detail + renewals views, nav gated by capability (absent for hr/visitor), dialogs with honest governance copy; E2E incl. legal-sees-no-values and visitor-sees-nothing; staging deploy (0013 paste → API → web) + owner smoke → certification.

## Claims note

Nothing here is publicly claimable; "agreement management" wording routes through the truthfulness pass after hosted certification.
