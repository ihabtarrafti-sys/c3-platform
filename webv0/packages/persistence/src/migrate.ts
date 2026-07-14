/**
 * migrate.ts — apply the ordered SQL migrations as the PRIVILEGED admin role,
 * and ensure the least-privileged application role exists (separate from the
 * admin/migration connection). Migrations are tracked in `_migrations` and
 * applied at most once, each in its own transaction.
 *
 * HARDEN-0 (audit H-08): the ledger stores a SHA-256 of each applied file.
 * A previously applied migration whose file content later changes FAILS the
 * run loudly — applied migrations are FROZEN; corrections ship as NEW files.
 * Rows applied before checksums existed (or inserted manually by the staging
 * paste choreography) carry NULL and are adopted with the current hash on the
 * next run — the freeze protects from that moment forward.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
// R2-N04 (Batch D): a migration NNNN.sql MAY have a sibling preflights/NNNN.sql — an
// idempotent repair the runner executes in the migration's OWN transaction, immediately
// before its SQL, but only when the migration is pending. See runMigrations for why.
const PREFLIGHTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'preflights');
const ROLE_RE = /^[a-z_][a-z0-9_]*$/;
// R6-N03: the migrator's single-flight advisory-lock key (class), paired with
// hashtext(current_database()) so migrators of DIFFERENT databases on one cluster don't collide.
const MIGRATOR_LOCK_KEY = 928_340_015;

export interface MigrateConfig {
  /** Privileged connection (schema owner / superuser) used ONLY for migrations. */
  readonly adminConnectionString: string;
  /** Name of the least-privileged application role to ensure. */
  readonly appRole: string;
  /** Password to (re)set on the application role. */
  readonly appPassword: string;
  /** Name of the SELECT-only membership-resolution role (default c3_auth). */
  readonly authRole?: string;
  /** Password to (re)set on the auth role. */
  readonly authPassword?: string;
  /** Name of the read-only logical-backup role (default c3_backup). */
  readonly backupRole?: string;
  /** Password to (re)set on the backup role. */
  readonly backupPassword?: string;
  /**
   * H-01.1: FAIL-CLOSED. Explicit opt-IN to the dev/test convenience secrets.
   * When this is not exactly `true`, every role password must be explicit and
   * non-default (refused before the DB is touched) — an absent, mistyped, or
   * non-dev NODE_ENV must NEVER silently restore the published default onto the
   * BYPASSRLS backup role (it reads every tenant). Round-1's opt-IN-to-safety
   * (`requireStrongSecrets`, keyed on exact NODE_ENV==='production') is replaced
   * by this opt-IN-to-danger flag.
   */
  readonly allowDevSecrets?: boolean;
  /**
   * H-01.1: (ALTER) an EXISTING role's password. Ordinary schema migrations must
   * leave live role secrets untouched — rotating the backup credential is an
   * explicit, separate act, decoupled from applying schema. A role that does not
   * yet exist is always CREATEd with the supplied password regardless.
   */
  readonly rotateRoleSecrets?: boolean;
  readonly log?: (msg: string) => void;
  /**
   * TEST-ONLY: stop after processing the migration whose filename equals this value
   * (inclusive). Lets a test reproduce a REAL from-<N> replay — apply through 0047,
   * seed a pathological row, then resume the rest — rather than hand-fake schema state
   * that would drift from the true migration history. Never set on a production path.
   */
  readonly targetInclusive?: string;
  /**
   * TEST-ONLY: override the directory preflights are read from (default: the package's
   * `preflights/`). Lets a test point at a throwaway preflight it can edit, to prove the
   * ledger detects a preflight change. Never set on a production path.
   */
  readonly preflightsDir?: string;
  /**
   * TEST-ONLY: awaited immediately BEFORE a legacy-NULL preflight adoption write. Lets the
   * two-runner discriminator hold both runners inside the snapshot→adopt window at once (a
   * 2-party latch) — the exact overlap R6-N03 names. Never set on a production path.
   */
  readonly beforeAdoptHook?: (file: string) => Promise<void>;
}

/** Published dev/default role passwords that must never reach a real environment. */
const WEAK_SECRETS: ReadonlySet<string> = new Set([
  'c3_app_dev_pw',
  'c3_auth_dev_pw',
  'c3_backup_dev_pw',
  'c3_admin_dev_pw',
]);

/** H-01: refuse a missing or published-default secret when strong secrets are required. */
function assertStrongSecret(label: string, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Refusing to migrate: ${label} is required outside dev/test — set an explicit strong secret.`);
  }
  if (WEAK_SECRETS.has(value)) {
    throw new Error(`Refusing to migrate: ${label} is a PUBLISHED dev default — set an explicit strong secret (a BYPASSRLS role must never carry a known password).`);
  }
}

/**
 * H-01.1: fail-closed migrate secret mode. The dev/test convenience secrets are
 * permitted ONLY when NODE_ENV *explicitly* selects dev or test; every other
 * value — absent, mistyped, 'production', 'staging', … — requires strong
 * secrets. Rotation of existing role passwords is a separate explicit opt-in.
 */
export function resolveSecretMode(env: NodeJS.ProcessEnv): { allowDevSecrets: boolean; rotateRoleSecrets: boolean } {
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  const allowDevSecrets = nodeEnv === 'development' || nodeEnv === 'test';
  const rotateRoleSecrets = env.MIGRATE_ROTATE_ROLE_SECRETS === 'yes';
  return { allowDevSecrets, rotateRoleSecrets };
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureRestrictedRole(client: Client, role: string, password: string, rotate: boolean): Promise<void> {
  if (!ROLE_RE.test(role)) throw new Error(`Unsafe role name: ${role}`);
  const pw = quoteLiteral(password);
  // Create the role with its password if absent. If it ALREADY exists, only
  // reset the password when an explicit rotation was requested — an ordinary
  // schema migration must not reset (or silently downgrade) a live role secret
  // (H-01.1: backup-role lifecycle decoupled from schema application).
  const elseAlter = rotate ? `ELSE ALTER ROLE ${role} LOGIN PASSWORD ${pw};` : '';
  await client.query(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN
        CREATE ROLE ${role} LOGIN PASSWORD ${pw};
      ${elseAlter}
      END IF;
    END
    $do$;
  `);
  // Defense in depth: restricted roles never bypass RLS and are never superuser.
  await client.query(`ALTER ROLE ${role} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
}

/** SHA-256 of file content with line endings normalized (git may check out LF or CRLF). */
function sha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** A migration's sibling preflight (content + checksum), or null if it has none. */
function loadPreflight(dir: string, file: string): { sql: string; checksum: string } | null {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const sql = readFileSync(path, 'utf8');
  return { sql, checksum: sha256(sql) };
}

/**
 * R2-N04 (Batch D): run a migration's preflight SQL on the given client — which is ALREADY
 * inside the migration's BEGIN/COMMIT. Logs whether it repaired rows or was a no-op, so a DR
 * replay leaves an operator trail (log-on-repair). A preflight is plain multi-statement SQL;
 * node-pg returns one result per statement, so the UPDATE row counts are summed. If the
 * preflight RAISEs (an incoherent shape it refuses to guess at), the throw propagates and the
 * caller rolls the whole migration back.
 */
async function runPreflightSql(client: Client, file: string, sql: string, log: (msg: string) => void): Promise<void> {
  const res = (await client.query(sql)) as unknown as
    | { command?: string; rowCount?: number | null }
    | Array<{ command?: string; rowCount?: number | null }>;
  const repaired = (Array.isArray(res) ? res : [res])
    .filter((r) => r?.command === 'UPDATE')
    .reduce((n, r) => n + (r.rowCount ?? 0), 0);
  log(
    repaired > 0
      ? `  ↳ preflight ${file}: repaired ${repaired} row(s) before applying`
      : `  ↳ preflight ${file}: no-op (data already coherent)`,
  );
}

export async function runMigrations(config: MigrateConfig): Promise<string[]> {
  const log = config.log ?? (() => {});

  // H-01.1: fail closed BEFORE touching the database. Unless dev/test is
  // EXPLICITLY opted in, every role's resolved password must be explicit and
  // non-default — an absent/mistyped/non-dev environment can never reach the
  // published fallbacks below (which now apply ONLY under allowDevSecrets).
  const allowDevSecrets = config.allowDevSecrets === true;
  const rotateRoleSecrets = config.rotateRoleSecrets === true;
  if (!allowDevSecrets) {
    assertStrongSecret('appPassword (DATABASE_URL / APP_DB_PASSWORD)', config.appPassword);
    assertStrongSecret('authPassword (DATABASE_AUTH_URL / AUTH_DB_PASSWORD)', config.authPassword);
    assertStrongSecret('backupPassword (BACKUP_DB_PASSWORD)', config.backupPassword);
  }
  const appPassword = config.appPassword ?? 'c3_app_dev_pw';
  const authPassword = config.authPassword ?? 'c3_auth_dev_pw';
  const backupPassword = config.backupPassword ?? 'c3_backup_dev_pw';

  const client = new Client({ connectionString: config.adminConnectionString });
  await client.connect();
  // Force UTF-8: on Windows the server may default client_encoding to WIN1252,
  // which cannot represent the UTF-8 content of migration files.
  await client.query("SET client_encoding TO 'UTF8'");
  // R6-N03: SINGLE-FLIGHT — the entire run holds a session advisory lock keyed to this database,
  // so two concurrent migrators SERIALIZE by construction (the second WAITS — it does not fail).
  // Without this, two runners could snapshot the ledger concurrently and both pass the legacy
  // NULL-adoption check once. Released automatically when the session ends (the finally below).
  await client.query('SELECT pg_advisory_lock($1, hashtext(current_database()))', [MIGRATOR_LOCK_KEY]);
  const applied: string[] = [];
  try {
    log('↳ migrator single-flight lock acquired');
    await ensureRestrictedRole(client, config.appRole, appPassword, rotateRoleSecrets);
    // SELECT-only membership-resolution role for the API's auth boundary (the
    // running API never receives the privileged admin credentials).
    await ensureRestrictedRole(client, config.authRole ?? 'c3_auth', authPassword, rotateRoleSecrets);
    // Read-only logical-backup role (created here so 0006 can grant to it; the
    // documented BYPASSRLS exception is applied by migration 0006, not here).
    await ensureRestrictedRole(client, config.backupRole ?? 'c3_backup', backupPassword, rotateRoleSecrets);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // H-08: the checksum column arrives idempotently (the ledger predates it).
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text');
    // R4-N11: a preflight is part of a migration's replay identity, but was never recorded —
    // editing one changed future rebuilds invisibly. Record its checksum in its own nullable
    // column (legacy rows carry NULL and adopt on first sighting; migration checksums untouched).
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS preflight_checksum text');
    const ledger = new Map<string, { checksum: string | null; preflight: string | null }>(
      (await client.query('SELECT id, checksum, preflight_checksum FROM _migrations')).rows.map(
        (r: { id: string; checksum: string | null; preflight_checksum: string | null }) =>
          [r.id, { checksum: r.checksum, preflight: r.preflight_checksum }] as const,
      ),
    );
    const preflightsDir = config.preflightsDir ?? PREFLIGHTS_DIR;
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256(sqlText);
      const preflight = loadPreflight(preflightsDir, file); // { sql, checksum } | null

      if (ledger.has(file)) {
        const entry = ledger.get(file)!;
        const stored = entry.checksum;
        if (stored === null || stored === undefined) {
          // Applied before checksums existed (or via the manual staging paste):
          // adopt the current content as the frozen truth. R6-N03: adoption is EXACTLY-ONCE —
          // zero rows means another runner adopted between our snapshot and this write; re-read
          // and REFUSE unless the stored identity equals ours (never proceed on a silent no-op).
          const adopted = await client.query('UPDATE _migrations SET checksum = $2 WHERE id = $1 AND checksum IS NULL', [file, checksum]);
          if (adopted.rowCount === 1) {
            log(`↳ skip ${file} (already applied; checksum adopted)`);
          } else {
            const re = await client.query<{ checksum: string | null }>('SELECT checksum FROM _migrations WHERE id = $1', [file]);
            const now = re.rows[0]?.checksum ?? null;
            if (now !== checksum) {
              throw new Error(
                `Migration ${file}: a concurrent runner adopted checksum '${(now ?? 'NULL').slice(0, 12)}…' which differs from this runner's file ('${checksum.slice(0, 12)}…'). ` +
                  'Adopt-once is single-use — reconcile the two deployments before re-running.',
              );
            }
            log(`↳ skip ${file} (checksum adopted by a concurrent runner; verified equal)`);
          }
        } else if (stored !== checksum) {
          throw new Error(
            `Migration ${file} was EDITED after being applied (ledger ${stored.slice(0, 12)}… ≠ file ${checksum.slice(0, 12)}…). ` +
              'Applied migrations are frozen — ship the correction as a NEW migration file.',
          );
        } else {
          log(`↳ skip ${file} (already applied)`);
        }
        // R4-N11 / R5-N10: verify the preflight's identity (never clobbering the migration
        // checksum). "No preflight" is recorded as the explicit sentinel 'none' (NOT NULL), so a
        // preflight ADDED to a migration that had none is a mismatch — a NULL would have been
        // silently adopted. NULL only appears on legacy rows applied before this column existed.
        const storedPf = entry.preflight;
        const currentPf = preflight?.checksum ?? 'none';
        if (storedPf === null || storedPf === undefined) {
          // Legacy row (pre-sentinel): adopt the current identity ('none' or a checksum) ONCE.
          // R6-N03: exactly-once — a zero-row conditional write means a CONCURRENT runner adopted
          // first; re-read and REFUSE unless its adopted identity equals ours. Never proceed on a
          // silently-ignored no-op (two code versions must not both accept the same NULL state).
          if (config.beforeAdoptHook) await config.beforeAdoptHook(file); // TEST-ONLY latch (R6-N03)
          const adoptedPf = await client.query('UPDATE _migrations SET preflight_checksum = $2 WHERE id = $1 AND preflight_checksum IS NULL', [file, currentPf]);
          if (adoptedPf.rowCount === 1) {
            log(`↳ ${file}: preflight identity adopted (${currentPf === 'none' ? 'none' : currentPf.slice(0, 12) + '…'})`);
          } else {
            const re = await client.query<{ preflight_checksum: string | null }>('SELECT preflight_checksum FROM _migrations WHERE id = $1', [file]);
            const now = re.rows[0]?.preflight_checksum ?? null;
            if (now !== currentPf) {
              throw new Error(
                `Preflight for ${file}: a concurrent runner adopted identity '${(now ?? 'NULL').slice(0, 12)}…' which differs from this runner's ('${currentPf === 'none' ? 'none' : currentPf.slice(0, 12) + '…'}'). ` +
                  'Adopt-once is single-use — reconcile the two deployments before re-running.',
              );
            }
            log(`↳ ${file}: preflight identity adopted by a concurrent runner; verified equal`);
          }
        } else if (storedPf !== currentPf) {
          const change =
            storedPf === 'none' ? 'ADDED (none was recorded)' : currentPf === 'none' ? 'REMOVED (file now absent)' : 'EDITED';
          throw new Error(
            `Preflight for ${file} was ${change} after being applied (ledger '${storedPf === 'none' ? 'none' : storedPf.slice(0, 12) + '…'}' ≠ file '${currentPf === 'none' ? 'none' : currentPf.slice(0, 12) + '…'}'). ` +
              'A preflight (or its absence) is part of the migration\'s replay identity — restore it, or ship the change as a NEW migration file. ' +
              '(A deliberate change is a documented, explicit ledger update.)',
          );
        }
      } else {
        log(`↳ apply ${file}`);
        await client.query('BEGIN');
        try {
          // R2-N04: run this migration's preflight (if any) FIRST, in the SAME tx. It is
          // reached only when the migration is pending — a fresh replay / DR rebuild —
          // so on the live DB (migration already ledgered) it never runs. Atomic with the
          // migration: a later failure rolls the repair back too.
          if (preflight) await runPreflightSql(client, file, preflight.sql, log);
          await client.query(sqlText);
          await client.query('INSERT INTO _migrations (id, checksum, preflight_checksum) VALUES ($1, $2, $3)', [
            file,
            checksum,
            preflight?.checksum ?? 'none', // R5-N10: explicit 'none' sentinel, never NULL, on a fresh apply
          ]);
          await client.query('COMMIT');
          applied.push(file);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
      }

      // TEST-ONLY bounded replay: stop after the requested target (honored on both the
      // apply and the already-applied paths) so a test can seed state mid-history.
      if (config.targetInclusive !== undefined && file === config.targetInclusive) break;
    }

    // Rerun idempotence: ensureRestrictedRole clamps NOBYPASSRLS on every run
    // as defense in depth, but 0006 deliberately grants the backup role its
    // single documented BYPASSRLS exception. On a rerun (0006 already applied,
    // so it never re-grants) the clamp would silently strip it — re-assert it.
    if (ledger.has('0006_backup_role_grants.sql')) {
      const backupRole = config.backupRole ?? 'c3_backup';
      if (!ROLE_RE.test(backupRole)) throw new Error(`Unsafe role name: ${backupRole}`);
      await client.query(`ALTER ROLE ${backupRole} BYPASSRLS`);
    }
    return applied;
  } finally {
    await client.end();
  }
}
