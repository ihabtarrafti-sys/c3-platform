# Runbook — Composed Per-Organization Restore Drill (A-5 / B-5)

**Purpose:** prove **per-org restore = whole-DB restore ∘ `export:tenant`** on the real hosted backups, with no new backup infrastructure. Owner-run (needs the age private key). One-shot, disposable, live-safe.
**Prereq:** the Phase-2D whole-DB restore drill is already hosted-certified; this adds one step to it.

## What it does

The existing restore drill (`apps/backup/src/restore-main.ts`) restores the newest encrypted backup into a **uniquely-named disposable database**, verifies schema/migrations/fixtures, proves the live DB is untouched, and drops the disposable DB. This runbook sets one extra environment variable so that, **after** fixtures verify and **before** the drop, the drill also runs the organization-scoped export against the disposable DB and logs redacted evidence (row counts + SHA-256 per file — no PII).

## Preconditions (unchanged from the 2D restore drill)

Introduced only for this bounded run, never on the cron service:
- `AGE_IDENTITY` — the private decryption key (owner password-manager only; in-memory only during the run).
- `RESTORE_ADMIN_URL` — privileged connection able to `CREATE`/`DROP DATABASE` + `pg_restore`.
- `DATABASE_URL` — the read-only `c3_backup` connection (to read live counts and prove no change).
- `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — read access to the backup bucket.
- **New for the composed drill:** `RESTORE_EXPORT_TENANT=<slug>` — the tenant slug to export. On staging the live org is **`c3-internal`** (verified 2026-07-07: 1 person, 3 approvals; `certbeta` is the empty isolation fixture). Unset ⇒ the drill behaves exactly as the 2D whole-DB drill.
- **HARDEN-2 (H-02): `BACKUP_VERIFY_PUBKEY`** — the Ed25519 PUBLIC key that verifies the manifest's producer signature **before anything is decrypted or restored**. The drill REFUSES without it (see below). The org's pinned key (generated 2026-07-11, private half = `BACKUP_SIGNING_KEY` on the cron service + owner password manager):

  ```
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEAh3NCOtkyUnHMK9B2JIIDfPi1WsRg8s97jeM5wTuQewM=
  -----END PUBLIC KEY-----
  ```

  Copy the whole block (BEGIN/END lines included) into the variable. It is
  public by design — it can only VERIFY, never sign; it is pinned here so
  drills copy it from the repo and any tampering shows in git history.

  **Legacy artifacts:** a backup taken BEFORE the signing key was set has no
  `.sig` — verifying it fails honestly. For that one case only, set
  `RESTORE_ALLOW_UNSIGNED=yes-i-understand` (and remove it with the other
  temporary variables). Once a signed nightly exists, never use the override.

  **Rotation:** rerun `npm run keygen` in `apps/backup`, replace
  `BACKUP_SIGNING_KEY` on the cron service, replace the block above (one
  commit — the diff IS the rotation record). Older artifacts then verify only
  against the old key, so prefer rotating right after a fresh nightly.

The host must have `age`, `pg_restore`, and `pg_dump` on PATH (Railway does; a local Windows dev box does not — this is a hosted-only drill).

## Steps

The cron container only exists while a job runs (you cannot SSH into an exited cron service), and a local dev box lacks `age`/`pg_restore` — so the drill runs **as a one-shot job on the service itself**, via the image's `JOB_MODE` dispatch (`apps/backup/src/entrypoint.ts`).

**Prerequisite (learned 2026-07-07):** the service must be running an image built from code that includes the export step. "Deploy changes" after a variable edit **restarts the existing image** — it does not rebuild. If the service was last deployed before the composed-drill commit, first run `railway up --service c3-backup-cron` from `webv0/` at current HEAD (this also triggers an immediate normal backup run — harmless). The absence of `restore.tenant_export_verified` in an otherwise-green drill is the tell that the old image ran.

1. Railway dashboard → **c3-backup-cron** → **Variables**: add, temporarily —
   `JOB_MODE=restore`, `AGE_IDENTITY=<private key>`, `RESTORE_ADMIN_URL=<postgres admin URL>`, `RESTORE_EXPORT_TENANT=c3-internal`, `BACKUP_VERIFY_PUBKEY=<the pinned block above>`. (R2 access + the `c3_backup` `DATABASE_URL` are already on the service.)
2. Apply/deploy the staged variable changes — the service restarts and runs the drill once, then exits.
3. Watch the deployment **Logs** for the structured events, in order:
   - **`restore.manifest_signature_verified`** (H-02: producer authenticity BEFORE anything is trusted),
   - `restore.downloaded_verified` → `restore.decrypted_verified` (artifact integrity, hashes anchored to the signed manifest),
   - `restore.restored` (into the disposable DB),
   - `restore.fixtures_verified` (PER-0001, APR-0001/0002, migrations, counts),
   - `restore.live_unchanged` (live counts identical before/after),
   - **`restore.tenant_export_verified`** — the new step: `{ slug, rowsTotal, files:[{name,rows,sha256}], schemaVersionCount }`,
   - `restore.success` then `restore.disposable_dropped`.
4. Exit code `0` = pass. Any integrity, fixture, live-change, or unknown-tenant failure exits non-zero and the disposable DB is still dropped in `finally`.
5. **MANDATORY CLEANUP, same day:** delete the temporary variables (`JOB_MODE`, `AGE_IDENTITY`, `RESTORE_ADMIN_URL`, `RESTORE_EXPORT_TENANT`, `BACKUP_VERIFY_PUBKEY`, and `RESTORE_ALLOW_UNSIGNED` if it was used) and apply. If `JOB_MODE=restore` survives to the next 02:15 UTC cron tick, the nightly run performs a **drill instead of a backup** — a missed backup — and the private key must never persist in service config. The cleanup redeploy triggers one extra normal backup run, which is harmless.

## Acceptance (what makes A-5 green)

- The drill exits `0` with `restore.tenant_export_verified` present.
- `rowsTotal` and the per-file row counts are non-zero and consistent with the target org's known data (e.g. the Geekay tenant's People/approvals from staging).
- The exported `schemaVersionCount` equals the applied-migration count.
- `restore.live_unchanged` confirmed (the drill never touches live).
- **Owner acceptance** of this posture for the external context (per the gate, A-5 requires owner sign-off, not just a green run).

## Notes / honesty

- This drill **verifies the bundle is produced and internally consistent, then discards it** with the disposable DB — it proves the *capability*. Producing a **retained** org bundle for a real customer is the same `export:tenant` run with a real `--out` against a restore (or against live), documented separately.
- Residual-data facts (backups persist to lifecycle expiry, restore-must-reapply-exit) are unchanged and live in [B5-org-scoped-export-and-exit.md](../design/B5-org-scoped-export-and-exit.md).
- Until this drill is run hosted and owner-accepted, **A-5 remains yellow** — `export:tenant` is implemented and tested and the composition is wired, but the end-to-end hosted composition is not yet certified. No overclaim.
