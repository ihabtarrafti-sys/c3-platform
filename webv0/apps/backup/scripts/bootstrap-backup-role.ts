/**
 * bootstrap-backup-role.ts — targeted, idempotent creation of the read-only
 * c3_backup identity + application of migration 0006 to an EXISTING database.
 *
 * Deliberately does NOT run the full migrate — this is a ONE-ROLE tool that
 * must not demand (or even see) the c3_app / c3_auth secrets the full migrator
 * requires. (An earlier version of this comment claimed the full migrate would
 * rotate live passwords; that stopped being true when rotation became opt-in
 * via MIGRATE_ROTATE_ROLE_SECRETS. The narrow-scope reason stands.) It only:
 *   1. ensures the c3_backup LOGIN role (restricted; password from env);
 *   2. applies 0006_backup_role_grants.sql;
 *   3. records 0006 in _migrations if not already present;
 *   4. verifies the resulting privilege posture.
 *
 * Requires (one-shot, admin): DATABASE_ADMIN_URL, C3_BACKUP_PASSWORD.
 * The password is never printed and never written to source.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const ROLE = 'c3_backup';
const MIGRATION_ID = '0006_backup_role_grants.sql';

function quoteLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const password = process.env.C3_BACKUP_PASSWORD;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required.');
  if (!password || password.length < 16) throw new Error('C3_BACKUP_PASSWORD (>=16 chars) is required.');

  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'persistence', 'migrations');
  const sql = readFileSync(join(migrationsDir, MIGRATION_ID), 'utf8');

  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    // 1. Ensure the restricted role (create or reset password only).
    //
    // ⛔ THIS BRANCH IS A ROTATION SITE, AND IT NOW SAYS SO. The ELSE arm resets a
    // LIVE role's password unconditionally — this script is the documented H-01
    // rotation tool for c3_backup, so the capability stays. What was missing is
    // what the migrate seam was missing: which branch ran was reported nowhere,
    // and the consumer that reads this credential (Railway c3-backup-cron,
    // variable DATABASE_URL) is not updated by anything this script does. The
    // 2026-08-05 incident was exactly that gap: password rotated in Postgres,
    // cron stranded on the old value, nightly backup down with a green log.
    const existed =
      ((await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])).rowCount ?? 0) > 0;
    const pw = quoteLiteral(password);
    await c.query(`DO $do$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(ROLE)}) THEN
        CREATE ROLE ${ROLE} LOGIN PASSWORD ${pw};
      ELSE
        ALTER ROLE ${ROLE} LOGIN PASSWORD ${pw};
      END IF;
    END $do$;`);
    await c.query(`ALTER ROLE ${ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    console.log(JSON.stringify({ event: 'bootstrap.role_ensured', role: ROLE, action: existed ? 'password-ROTATED' : 'created' }));

    // ⛔ LAW 34 — the applied secret must AUTHENTICATE, or this run fails rather
    // than reporting a rotation the database refuses. Same subject the consumers
    // dial: host/port/db from the admin URL, credentials the ones just applied.
    const admin = new URL(adminUrl);
    const probe = new Client({
      connectionString: `${admin.protocol}//${encodeURIComponent(ROLE)}:${encodeURIComponent(password)}@${admin.host}${admin.pathname}`,
    });
    try {
      await probe.connect();
      await probe.query('SELECT 1');
    } finally {
      await probe.end().catch(() => {});
    }
    console.log(JSON.stringify({ event: 'bootstrap.role_connect_back_ok', role: ROLE }));
    if (existed) {
      // The one store this script cannot reach, named so the operator updates it
      // NOW rather than at the next failed 02:15Z run.
      console.log(
        JSON.stringify({
          event: 'bootstrap.rotation_consumer_reminder',
          role: ROLE,
          warning:
            'The live password was ROTATED. This proves the DATABASE accepts it — it does NOT update the consumer: ' +
            'Railway service c3-backup-cron, variable DATABASE_URL must carry the same value before the next scheduled run.',
        }),
      );
    }

    // 2. Apply the grants migration (idempotent).
    await c.query('BEGIN');
    await c.query(sql);
    // 3. Record in _migrations if the table exists and the row is absent.
    await c.query(
      `INSERT INTO _migrations (id) VALUES (${quoteLiteral(MIGRATION_ID)}) ON CONFLICT (id) DO NOTHING`,
    );
    await c.query('COMMIT');
    console.log(JSON.stringify({ event: 'bootstrap.migration_applied', id: MIGRATION_ID }));

    // 4. Verify posture (no secrets printed).
    const posture = await c.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
         FROM pg_roles WHERE rolname = ${quoteLiteral(ROLE)}`,
    );
    console.log(JSON.stringify({ event: 'bootstrap.verified', role: ROLE, posture: posture.rows[0] }));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({ level: 'error', event: 'bootstrap.failed', message: (err as Error).message }));
    process.exit(1);
  },
);
