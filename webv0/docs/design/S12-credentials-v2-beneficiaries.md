# S12 — Credentials v2 + the Beneficiary registry

**Status: IN BUILD. Migration 0033.** First sprint on the HARDEN-0 rails:
every new table is registry-enforced from birth (H-03 gate), every new
payload rides the role projection (H-01), migrations are frozen (H-08).

## Two spec-level laws locked at build (owner may veto with one line)

1. **Credential-edit split** (plan open question #6, same shape as the
   ratified person C2): dates and documentNumber are **GOVERNED** — they
   are compliance facts the readiness engine depends on; a quiet edit
   could fake a visa. Issuer, notes and display label are direct-audited.
2. **Beneficiary mutations are GOVERNED** (create / update / retire):
   beneficiary rows are payment-ROUTING facts — changing where money goes
   deserves dual control even though no account number ever exists here.

## Credentials v2

- **Typed taxonomy**: `kind` ∈ Passport | NationalID | Visa | License |
  Other (existing free-text `credential_type` stays as the display label;
  legacy rows default kind='Other').
- **documentNumber** — joins the PII tier (owner-ratified C1: owner/ops/hr;
  structural omission elsewhere), projected out of approval payloads for
  non-PII viewers (H-01 projector).
- **issuingCountry** — plain fact, visible to all.
- **Multiple passports per person** are already representable (credentials
  are many-per-person); the taxonomy makes them queryable.
- **Credential EDIT** (missing entirely today):
  - `UpdateCredentialFacts` (GOVERNED pipeline op): issuedOn / expiresOn /
    documentNumber / issuingCountry / kind — sparse patch snapshot,
    re-read + applied at execute, one open credential op per credential.
  - Direct-audited patch: issuer / notes (`CredentialDetailsUpdated`),
    version-guarded.

## Beneficiary registry

**THE STANDING LAW: no account numbers, no IBANs, no card numbers — ever.**
The registry stores only what routing needs to be *named*, not executed:

| Field | Notes |
|---|---|
| beneficiaryId | BEN-XXXX |
| personId | the person paid |
| label | nickname the org uses ("ESA main", "ADCB personal") |
| bankName + bankCountry | names only |
| currency | ISO code |
| paymentType | e.g. SWIFT / local / exchange-house — a label, not credentials |
| registeredWithEntityId | which org legal entity's bank holds the registration |
| status | Draft → Registered → Retired (+ statusDate) |

- Mutations governed (`AddBeneficiary` / `UpdateBeneficiary` /
  `RetireBeneficiary`); reads gated by `canViewFinancials` (list + person
  panel); S8 payouts keep referencing **labels**.
- **Bank-form generation**: C3 emits the bank's registration XLSX from the
  registry with the sensitive columns (account/IBAN) **blank** — filled by
  hand outside C3. The plan's default (open question #5) stands: losing a
  filled form means asking the person again; no encrypted-storage law
  change without an explicit owner decision. (A transient "sandbox intake →
  generate → wipe" ceremony is a possible fast-follow, priced separately.)

## Migration 0033 (also carries two housekeeping items)

1. `ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text` —
   staging ledger becomes shape-identical with the H-08 runner.
2. credential: `kind` (CHECK enum, default 'Other'), `document_number`,
   `issuing_country`.
3. `beneficiary` table (RLS, no DELETE, one ACTIVE label per person via
   partial unique on (tenant, person, lower(label)) WHERE status <> 'Retired').
4. Approval op whitelist + business_id_counter kind `beneficiary`.

## What S12 does NOT do

- No account-number storage in any form (including "encrypted for later").
- No payout execution changes — S8 flows keep working on labels.
- No new signal kinds. (Beneficiary-missing-for-rostered-player is a
  plausible future check — parked, not smuggled.)

## Evidence plan

- api: credentialsV2.test.ts (taxonomy; documentNumber PII omission incl.
  approval payloads; governed facts-edit end to end + one-open-op; direct
  issuer/notes edit + 409; multi-passport) + beneficiaries.test.ts
  (governed lifecycle; label-uniqueness 409; finance-gated reads; xlsx
  generation has BLANK sensitive columns; export/exit registry gate covers
  the new table automatically).
- e2e: credentialsV2.spec.ts (facts change through pipeline; hr sees
  document number, finance does not) + beneficiary flow inside it.
