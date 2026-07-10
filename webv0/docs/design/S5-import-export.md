# S5 — Import / Export (Track A, the locked design)

**Status: SHIPPED** · gate 478 vitest green · 13/13 E2E · migration `0025`

The decision this sprint implements (C3-CONSOLIDATED-PLAN §0, owner-final):
no SharePoint connector, ever. Instead: **C3 provides an empty template, the
tenant fills it, imports it, and it lands governed.** This doc records how the
locked design became load-bearing law.

## The four laws

1. **EXPORT IS THE TEMPLATE.** Each register (people, credentials, agreements)
   exports as CSV in *exactly* the shape import accepts — same columns, same
   order. There is one format, so it cannot drift. The blank template is the
   degenerate export (headers only). Unit-tested as the round-trip law:
   `toCsv → parseCsv → toCsv` is byte-identical.

2. **ALL-OR-NOTHING validation.** Every row is validated through the *same*
   zod create schemas the API uses (`addPersonInputSchema` & co.) plus
   DB-aware cross-checks a file cannot do alone (referenced people/entities/
   agreements exist; personnelCode/agreementCode not already taken; in-file
   duplicates). One bad cell fails the whole file with a complete per-row
   error report (`422 IMPORT_INVALID`, `details.rows`, capped at 100 on the
   wire with an honest `errorCount`). Nothing is persisted for a dirty file —
   not even an approval.

3. **GOVERNANCE AT BATCH SCALE.** A clean file becomes **ONE `ImportBatch`
   approval** whose payload is the parsed batch — the immutable snapshot the
   owner reviews. Ops stages, the owner executes (requester ≠ approver, same
   as every governed write). Execution inserts every row in **one
   transaction** — a mid-batch fault rolls back wholly to a truthful
   `ExecutionFailed`; re-execute re-runs the batch.

4. **IDS ARE ALLOCATED BY C3.** The id columns (`personId`/`credentialId`/
   `agreementId`) exist in the export for fidelity and **must be empty on
   import** — the per-row error says exactly that. PER/CRED/AGR sequences
   stay C3's alone.

## Provenance without a per-row approval

`created_by_approval_id` on person/credential/agreement is now **NULLABLE**
(migration 0025). Imported rows carry NULL there; their provenance is the
batch approval, stamped into every per-row audit event
(`PersonCreated`/`CredentialCreated`/`AgreementCreated` with
`importedBy: APR-XXXX`). The `UNIQUE (tenant_id, created_by_approval_id)`
indexes survive untouched — Postgres UNIQUE ignores NULLs — so the
one-row-per-approval idempotency boundary for pipeline-created rows is
exactly as strong as before.

`targetPersonId` on the batch approval is the sentinel `N/A-IMPORT`
(member-ops precedent).

## Phasing and history

- **Phased by domain:** people first (C3 allocates PER ids), then credentials
  and agreements that reference those ids. Cross-file references are checked
  at staging; in-file `linkedAgreementId` links are *not* supported (import
  parents first — the error says so).
- **History imports honestly:** people/credentials take `isActive`
  (`true`/`false`/empty=true); agreements take `status`
  (`Active`/`Terminated`/empty=Active). A club can load its real past, not a
  fiction where everything is current.
- **The audit trail exports** alongside the registers
  (`at,entityType,entityId,action,actor,before,after`) — read-only history,
  deliberately not importable.
- Caps: 5 000 rows per file, 8 MB per upload.

## Gates

| Action | Who |
| --- | --- |
| Stage an import (`POST /api/v1/imports`) | owner / operations (`assertSubmitApproval`) |
| Execute the batch | owner (the approval pipeline's own gates) |
| Export a register (`GET /api/v1/exports/:domain`) | owner / operations — bulk data leaves the org |
| Export agreements | additionally `assertViewFinancials` (values ride along) |
| Template (`GET /api/v1/imports/templates/:domain`) | any authenticated identity (headers carry no data) |

## The CSV core

We own both sides: a strict RFC 4180 subset emitted (LF, quoted-when-needed,
doubled quotes) and parsed (CRLF/LF, embedded commas/newlines/quotes,
structural errors with 1-based line numbers via `CsvParseError`). Owning both
sides is what turns the round-trip law from a hope into a guarantee. No
third-party CSV dependency.

## A trap worth remembering

The create schemas are `.strict()`, so the first cut of the batch payload
schema — `addPersonInputSchema.and(z.object({ isActive: z.boolean() }))` —
could never accept a row: zod intersections parse the *whole* object against
*each* side, and the strict side refused the extra key. The fix
(`rowSchema()` in `importExport.ts`) splits each row, validates the parts
against their own schemas, and merges — the create schemas stay the single
source of truth. The domain test suite now pins the **approval snapshot
law**: `importBatchInputSchema` must accept exactly what `validateImportCsv`
produces, because the batch is re-parsed from the payload at execution.

## Surfaces

- **Settings → Import & export** (owner/ops): export buttons per register +
  audit trail; domain picker + blank template + upload. Staged banner names
  the APR and says plainly: *"Nothing lands until an owner executes it."*
  Dirty files render the per-row report (first 20 shown, honest count).
- **Approval detail**: `ImportBatch` subject reads
  `Import N {domain} from "{file}"`. Execution notification no longer says
  "Created undefined" for non-person operations (pre-existing defect fixed
  here because imports made an owner stare at it).

## Evidence

- `packages/domain/test/importExport.test.ts` — round-trip law, header
  contract, ids-allocated-by-C3, per-row schema errors, agreements
  anchor/date/duplicate rules, empty-file refusals, the approval snapshot law.
- `apps/api/test/imports.test.ts` — over HTTP: template → stage → owner
  executes → rows + `importedBy` audit; 422 report with **no approval
  created**; credentials-need-people cross-check then the fixed file lands;
  visitor 403s; export header identity; audit export.
- `apps/web/e2e/settings.spec.ts` — the human walk: template download, clean
  upload → staged APR (register unchanged), owner executes → people appear,
  dirty upload → report + nothing lands, export contains the imported rows.
