# A-5 — Per-Organization Restore & Recoverability

**Gate item:** A-5 (recoverability / per-org restore), Stage-4 admission gate. **Author:** Architect-of-record · **Date:** 2026-07-07 · repo tip (this commit).
**Result: YELLOW — implemented + wired + tested; the end-to-end HOSTED composed drill is PENDING owner execution (needs the age private key) and owner acceptance.** No overclaim: A-5 does not go green on code alone.

## What is DONE (green sub-parts)

1. **Whole-DB restore** into a uniquely-named disposable database — **hosted-certified** (Phase 2D drill; PER-0001/APR-0001/APR-0002 verified, live proven unchanged, disposable dropped).
2. **`export:tenant`** organization-scoped logical export — **implemented + tested** (`packages/persistence/src/exportTenant.ts`, `npm run export:tenant`; 4 integration tests: tenant isolation, shared-user flag + identity withholding, manifest checksum/row-count integrity, unknown-slug refusal; real-CLI end-to-end smoke passed on disk before removal).
3. **Composition wired** into the restore drill — setting `RESTORE_EXPORT_TENANT=<slug>` runs the export against the disposable restored DB and logs redacted evidence before the drop (`apps/backup/src/restore-main.ts`; opt-in helper `resolveExportTenant` fails closed on a malformed slug, 3 unit tests).

## Why this is the whole answer to per-org restore

Per-org restore needs **no new backup infrastructure**: it is the already-certified whole-DB restore **composed with** `export:tenant`. Restore the newest encrypted backup into a disposable DB (proven), run the org-scoped export against it (tested), and the bundle is that org's point-in-time data. The composition is now a single owner-run command.

## What remains for GREEN

- **Run the hosted composed drill** ([runbooks/A5-per-org-restore-composed-drill.md](../runbooks/A5-per-org-restore-composed-drill.md)) — owner-run, needs `AGE_IDENTITY` + `RESTORE_ADMIN_URL` + R2 read + `RESTORE_EXPORT_TENANT=c3-internal` (the live staging org; verified slug); the host needs `age`/`pg_restore` on PATH (Railway has them; a local dev box does not — this cannot be self-certified from here).
- **Acceptance criteria** (from the runbook): exit 0 with `restore.tenant_export_verified`, non-zero consistent row counts for the target org, `schemaVersionCount` = applied-migration count, `restore.live_unchanged` confirmed.
- **Owner acceptance** of the posture for the external context (the gate requires sign-off, not just a green run).

## First drill attempt (2026-07-07, ~12:21 UTC) — whole-DB re-proven, composed step did not run, and a REAL FINDING

The owner ran the drill via `JOB_MODE=restore`. Results, honestly stated:
- **Whole-DB restore RE-CERTIFIED with fresh evidence:** `restore.success` + `restore.disposable_dropped` (disposable `c3_restore_drill_20260707122146_d`; PER-0001, APR-0001 Executed / APR-0002 Submitted, migrations 0001–0006, live unchanged).
- **The composed export step did NOT run** (no `restore.tenant_export_verified`, no `tenantExport` in evidence): the cron service was still running the Phase-2D image — a variables-only "Deploy changes" restarts the existing image and does not pick up new code. Remedied by the runbook prerequisite (redeploy code first). A-5 therefore **remains yellow**.
- **FINDING — silent backup-freshness gap:** the restored "newest" backup lacked APR-0003 (submitted 2026-07-06 22:49 UTC), proving the newest successful backup predated that — i.e. **the 2026-07-07 02:15 UTC nightly backup did not succeed, silently**. The stale-backup monitor that would have alerted is inactive pending the owner's R2-token move to GitHub secrets — this incident upgrades that action to URGENT. Recovery: the drill-cleanup redeploy at 12:25 UTC ran a backup that succeeded end-to-end (`backup.success`, `latest_success_written`, key `daily/2026/07/07/c3-staging-20260707T122549Z-4352d8a.dump.age`) — freshness restored as of 12:25 UTC. Root cause of the 02:15 miss: to be read from the pre-drill deployment's logs (owner dashboard); not yet established.

## Honesty note

Local Windows dev cannot exercise `pg_dump`/`pg_restore` (the embedded-postgres package ships the server only), which is exactly why the restore I/O is certified by the hosted drill rather than a local test. The composition logic that IS locally testable (export correctness, the opt-in guard) is covered; the hosted transport is owner-run. A-5 stays yellow until the hosted composed drill runs and the owner accepts.
