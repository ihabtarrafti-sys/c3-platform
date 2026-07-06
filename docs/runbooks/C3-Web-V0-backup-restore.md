# C3 Web V0 — staging backup & restore runbook (Sprint 34 Phase 2D)

**Why this exists:** Railway **Hobby** does not provide native PostgreSQL
backup controls or PITR in the owner's hosted account. This is an INDEPENDENT
daily **logical** backup (pg_dump), client-side encrypted with **age** and
stored in a private **Cloudflare R2** bucket. It is a logical backup, **not
PITR** — recovery is to the last successful daily/manual snapshot.

## Architecture
- **Backup job** (`webv0/apps/backup`, image `apps/backup/Dockerfile`) runs as
  a Railway **cron** service `c3-backup-cron` at **`15 2 * * *`** (02:15 UTC),
  one-shot (exits each run).
- Connects to PostgreSQL ONLY as the read-only **`c3_backup`** role
  (private network). `pg_dump -Fc -Z6 --no-owner --no-privileges` → SHA-256 →
  **age encrypt** (public recipient only on the cron) → upload to R2 → verify
  → write `status/latest-success.json`. Plaintext dump is deleted before
  upload; latest-success is written ONLY after full success.
- **Object layout** in bucket `c3-web-v0-staging-backups` (private, no public
  access, WEUR):
  - `daily/YYYY/MM/DD/c3-staging-<UTC>-<sha>.dump.age` (+ `.manifest.json`)
  - `weekly/…` (Sunday runs are additionally copied here)
  - `manual/…` (explicit `BACKUP_MODE=manual`)
  - `status/latest-success.json`
- **Lifecycle** (R2 bucket rules): daily 15d · weekly 90d · manual 180d ·
  status never expires.
- **Encryption**: age X25519. Public recipient
  (`AGE_RECIPIENT`) lives on the cron + is baked into each backup. The PRIVATE
  identity is in the owner's password manager ONLY — never in the repo, R2,
  cron service, or logs.
- **Monitor**: GitHub Actions `webv0-backup-monitor` (daily 06:30 UTC +
  manual) reads `status/latest-success.json` with a READ-ONLY R2 credential;
  opens/updates one `backup-stale` issue if the newest success is > 36h old;
  closes it on recovery. Never downloads/decrypts a dump.

## Credential separation
| Principal | Where | Scope |
| --- | --- | --- |
| `c3_backup` DB role | cron `DATABASE_URL` | read-only, BYPASSRLS (backup exception), private network |
| R2 **writer** token | cron `R2_ACCESS_KEY_ID/SECRET` | Object R+W, this bucket only |
| R2 **monitor** token | GitHub Actions secrets | Object **Read only**, this bucket only |
| age **recipient** (public) | cron `AGE_RECIPIENT` | encrypt only |
| age **identity** (private) | owner password manager | restore only |
The cron service must NEVER hold: `DATABASE_ADMIN_URL`, `c3_app`/`c3_auth`
creds, the age identity, or the monitor token.

## Manual backup
Set `BACKUP_MODE=manual` on `c3-backup-cron`, then `railway up --service
c3-backup-cron` (from `webv0/`). Object lands under `manual/`. Reset
`BACKUP_MODE=daily` afterward.

## Restore drill / real restore
1. Owner temporarily sets on `c3-backup-cron` (staging): `AGE_IDENTITY` =
   private key (from the password manager) and `JOB_MODE=restore`. Engineer
   sets `RESTORE_ADMIN_URL` = the privileged internal admin URL (one-shot).
2. `railway up --service c3-backup-cron` → the restore job: reads
   `status/latest-success.json`, downloads + SHA-256-verifies the newest
   encrypted object, decrypts with the identity, creates a UNIQUELY-NAMED
   DISPOSABLE database (`c3_restore_drill_<ts>_<salt>`), `pg_restore --no-owner
   --no-privileges`, verifies migrations + tenant + fixtures (PER-0001,
   APR-0001, APR-0002) + counts, proves the LIVE DB is unchanged, then DROPS
   the disposable DB and wipes key + temp material.
3. Cleanup (MANDATORY): owner deletes `AGE_IDENTITY`; engineer deletes
   `RESTORE_ADMIN_URL` + `JOB_MODE`; set `BACKUP_MODE=daily`. The daily backup
   FAILS CLOSED if `AGE_IDENTITY` is present (guard).
4. A real recovery restores into a NEW database, verifies, then the owner
   repoints the API `DATABASE_URL`/admin as a deliberate cutover — never
   restore over the live DB in place.

## Key custody
- The age identity is the ONLY thing that can decrypt backups. Store it in the
  password manager; if lost, existing backups are unrecoverable (rotate: new
  keypair, new recipient on cron, old backups become undecryptable as they age
  out).
- Never commit / upload / log it. Generate via
  `node webv0/apps/backup/scripts/keygen.mjs <path>` (prints the public
  recipient; writes the private identity to `<path>` for you to store + delete).

## Failure / incident procedure
- **Monitor issue opened** (`backup-stale`): check `c3-backup-cron` deploy
  logs (Railway). Common causes: R2 writer token invalid, `c3_backup` password
  drift, `AGE_IDENTITY` accidentally present (fail-closed), DB unreachable.
  Fix, run a manual backup, confirm the monitor closes the issue.
- **Restore fails fixture/count checks**: do NOT cut over; investigate the
  source backup integrity (manifest SHA-256) and the migration set.

## Disable / rollback
- Disable schedule: clear the Cron Schedule field on `c3-backup-cron` (or
  delete the service). Removing the service stops all backup cost.
- The bucket + lifecycle persist independently; delete the bucket to stop
  storage. The `c3_backup` role + migration 0006 are harmless read-only and
  may remain.

## Cost
R2 storage + operations within the free tier (**$0**); Railway cron ~seconds/
day (**~$0.02–0.05/mo**). Total additional **< $0.10/month**.
