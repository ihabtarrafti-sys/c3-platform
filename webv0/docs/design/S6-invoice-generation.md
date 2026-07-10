# S6 — Invoice Generation (Track A)

**Status: SHIPPED** · migration `0026` · new dep `pdf-lib` (pure JS, no native
code) · replaces the GK-Core VBA generator

The GK-Core model, made law: an invoice is C3's **outward claim** for one
mission income line, issued by one of the tenant's own legal entities, with a
per-entity yearly series number, VAT, and a stored PDF artifact.

## The laws

1. **One income line, one invoice.** The line stays the SINGLE SOURCE of
   payment truth (S2's Expected → Invoiced → Received); the invoice is the
   document that requests the money, never a second ledger. Issuing flips the
   line to `Invoiced` in the same transaction; a partial-unique index (one
   LIVE invoice per line) makes double-billing impossible at the DB.
2. **Numbers are NEVER reused.** `{ENTITY.CODE}-INV-{YYYY}-{NNN}`
   (`GKA-INV-2026-001`), allocated race-safe per (entity, year) through the
   existing counter mechanism (`invoice-series:ENT-XXXX:YYYY` composite
   kinds). A voided invoice keeps its number — the gap IS the audit trail.
   Independent series per entity, rolling yearly.
3. **Void is honest, not destructive.** Reason mandatory, recorded; the line
   flips back to `Expected` so corrected paper gets a FRESH number. Refused
   once the line is `Received` — the money already moved; correct the line
   first. No DELETE grant exists.
4. **The PDF is immutable evidence.** Generated once at issue (pdf-lib,
   standard Helvetica, single A4: issuer entity block with Reg/VAT, the
   number, billed-to, the tournament reference `TR code — name`, type of
   income, Subtotal / VAT / TOTAL in the line's NATIVE currency — no FX on an
   outward claim). Stored through the S4 document path under a new
   **`Invoice` owner type whose read gate is `canViewFinancials`** (stricter
   than the mission's — the paper carries money). **No bank details by
   design**: C3 never stores account numbers (standing law), so the artifact
   carries none.
5. **VAT states no tax law.** A basis-point rate entered per invoice
   (0–10000), integer math, rounded HALF-UP to the minor unit.

## Posture

**Direct-but-audited** — the same standing as the S2 payment flip it
automates. Writes: `assertManageMissions + assertViewFinancials`. Reads
(register, detail, PDF): `assertViewFinancials`. Audit: `InvoiceIssued` /
`InvoiceVoided` on the invoice's own trail, plus `MissionLinePaymentSet` on
the mission trail naming the paper both ways.

## Transaction boundaries (the honest-failure design)

Issue = ONE tx: allocate series + internal id → insert → flip line → audit
both trails. The PDF happens AFTER (bytes go to object storage; external I/O
never rides a DB tx): build → put → register document (compensated delete on
failure) → link `document_id`. A failed artifact leaves an honest invoice
with `documentId = null`, a `pdfError` note in the 201, and an idempotent
retry endpoint (`POST /invoices/:id/document`) — never a lie, never an
orphan blob.

## Signals ship with features (standing law)

Two new Situation Room signals, firing ONLY in `PostMission` (they are
literally what blocks →Settled):

- **IncomeNotInvoiced** — active income lines still `Expected` after the
  mission ended (impact 2 × urgency 3 = immediate; amounts printed).
- **PaymentOutstanding** — lines `Invoiced` but not `Received`; the live
  invoice is named BY NUMBER in the reasons; urgency escalates 14 days past
  mission end ("chase the counterparty").

En route the engine gained a scope correction: **mission readiness no longer
nags about missions whose window already closed** (rosters are moot once the
event is over; the settlement signals own that phase). The cockpit ledger
grew to 9 checks and now derives its count instead of hardcoding "7".

## Surfaces

- **Invoices register** (`/invoices`, nav gated `canViewFinancials`): number,
  entity, mission link, billed-to, type of income, total, status
  (void reason on hover), PDF download / retry, Void… with reason.
- **Mission P&L**: income lines still `Expected` grow **Invoice…** — entity
  picker (its code numbers the series; a codeless entity is refused with
  directions), billed-to prefilled from the mission's organizer, VAT %,
  description. The toast names the number.
- Visitor: no nav, fail-closed register.

## Evidence

- `packages/domain/test/invoice.test.ts` — series format, per-(entity, year)
  counter kinds, VAT half-up (incl. the .5 boundary), input schemas, the
  issue/void invariants.
- `packages/domain/test/situation.test.ts` — the settlement signals fire only
  in PostMission with printed amounts and named invoices; quiet cases;
  readiness scope correction.
- `apps/api/test/invoices.test.ts` — over HTTP: issue → `GKA-INV-YYYY-001`,
  VAT math, line flip, both audit trails, `%PDF-` bytes behind the Invoice
  read gate (visitor 403); double-issue/expense/codeless refusals; GKEC's
  independent `-001`; the finance-stage walk to PostMission puts
  **PaymentOutstanding naming the number** in `/situation`; void → line
  `Expected` + IncomeNotInvoiced fires; re-issue = `-002`; void refused after
  `Received`; register gates.
- `apps/web/e2e/settlement.spec.ts` — the human walk: entity + finished
  mission + income line → Invoice… (prefill, VAT 5%) → toast names the
  number → cockpit chases it by number → register row `USD 8,400.00` → PDF
  download named `{number}.pdf` → void (reason) → line Expected → receipt
  recorded → **Settled** → cockpit quiet; visitor fail-closed.
