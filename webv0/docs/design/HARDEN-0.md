# HARDEN-0 — the three laws before S12 (second-eye audit response, part 1)

**Status: BUILT + CERTIFIED. No new migration.** Responds to
`webv0/docs/audit/C3-SECOND-EYE-REPORT.md` findings H-01, H-03, H-07, H-08 —
the subset that changes how new construction lands. The remainder (H-02,
H-04, H-05, H-06, mediums) is HARDEN-1, batched after the consolidated
external review per the owner's sequencing decision.

## H-08 — migrations are frozen by checksum

`_migrations` gains a `checksum` column (added idempotently by the runner).
A previously applied file whose content changes **fails the run loudly**;
corrections ship as new files. Rows applied before checksums (or via the
staging paste choreography) are adopted with the current hash on the next
run. Line endings are normalized before hashing (git CRLF). The db gate
proves the refusal fires. Fixing exposed a real rerun defect: the role
clamp stripped c3_backup's documented BYPASSRLS exception on reruns —
`runMigrations` now re-asserts it.

**Staging note:** staging applies migrations by owner paste, not the
runner, so its ledger adopts checksums the first time anything runs the
runner there; the repo-side freeze law protects regardless. S12's paste
will add the column so the staging ledger is shape-identical.

## H-03 — ONE tenant-table registry, catalog-enforced

`packages/persistence/src/tenantTables.ts` is the single truth consumed by
BOTH ceremonies (export order = registry order; exit order = `exitRank`,
children first). The gate test compares the registry against
`information_schema` — **every live table carrying `tenant_id` must be
registered, and every export projection must execute** — so a new domain
table failing to export/exit is unrepresentable, including S12's.

Repaired in the same pass: the nine stranded tables (document, invoice,
team, team_membership, distribution, distribution_share, claim,
notification, delegation) now export and erase; the mission projection
carries code/organizer/city/finance_stage/team_id. Document object BYTES
remain a HARDEN-1 item (streamed blob bundle + exit-time object deletion);
the rows including storage keys export today.

## H-01 — approval payloads are role-projected; the register is payload-free

Delegation grants standing to **decide**, never wider disclosure. At the
one wire boundary (`projectApprovalPayload`): identity patches lose
`dateOfBirth` without PII standing; agreements lose `valueUsdCents`,
terms lose `amountMinor/currency/percentBps`, import batches lose
agreement rows without financial standing. The approvals REGISTER returns
summaries with no payload at all — disclosure happens on the detail view
only. Proven over HTTP with a delegated visitor (sees the patch, not the
DOB) vs the owner (sees everything).

**Scope note (V1):** delegation remains operation-unscoped; the projection
makes what a delegate can SEE role-true, and H-07 makes what they cannot
see visible. Scoped delegation grants (per operation family) remain a
HARDEN-1 refinement if the owner wants them.

## H-07 — the reviewer sees what they decide

`ProposedChange` renders the decisive values of every operation type from
the immutable payload snapshot — amounts, windows, identity facts — and
prints an explicit *"withheld for your role"* where the projection removed
a value. A blind decision is at least a visible one.
