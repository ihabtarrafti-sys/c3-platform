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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ROLE_RE = /^[a-z_][a-z0-9_]*$/;

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
   * H-01: in production the caller MUST supply explicit strong secrets for every
   * role — a missing or published-default password is refused before the DB is
   * touched. The backup role in particular is BYPASSRLS (it reads every tenant),
   * so a default password there exposes all data. Dev/test leave this false and
   * keep the convenience fallbacks.
   */
  readonly requireStrongSecrets?: boolean;
  readonly log?: (msg: string) => void;
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
    throw new Error(`Refusing to migrate: ${label} is required in production — set an explicit strong secret.`);
  }
  if (WEAK_SECRETS.has(value)) {
    throw new Error(`Refusing to migrate: ${label} is a PUBLISHED dev default — set an explicit strong secret (a BYPASSRLS role must never carry a known password).`);
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureRestrictedRole(client: Client, role: string, password: string): Promise<void> {
  if (!ROLE_RE.test(role)) throw new Error(`Unsafe role name: ${role}`);
  const pw = quoteLiteral(password);
  await client.query(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN
        CREATE ROLE ${role} LOGIN PASSWORD ${pw};
      ELSE
        ALTER ROLE ${role} LOGIN PASSWORD ${pw};
      END IF;
    END
    $do$;
  `);
  // Defense in depth: restricted roles never bypass RLS and are never superuser.
  await client.query(`ALTER ROLE ${role} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
}

export async function runMigrations(config: MigrateConfig): Promise<string[]> {
  const log = config.log ?? (() => {});

  // H-01: fail closed BEFORE touching the database when strong secrets are
  // required — every role's resolved password must be explicit and non-default.
  const authPassword = config.authPassword ?? 'c3_auth_dev_pw';
  const backupPassword = config.backupPassword ?? 'c3_backup_dev_pw';
  if (config.requireStrongSecrets) {
    assertStrongSecret('appPassword (DATABASE_URL / APP_DB_PASSWORD)', config.appPassword);
    assertStrongSecret('authPassword (DATABASE_AUTH_URL / AUTH_DB_PASSWORD)', config.authPassword);
    assertStrongSecret('backupPassword (BACKUP_DB_PASSWORD)', config.backupPassword);
  }

  const client = new Client({ connectionString: config.adminConnectionString });
  await client.connect();
  // Force UTF-8: on Windows the server may default client_encoding to WIN1252,
  // which cannot represent the UTF-8 content of migration files.
  await client.query("SET client_encoding TO 'UTF8'");
  const applied: string[] = [];
  try {
    await ensureRestrictedRole(client, config.appRole, config.appPassword);
    // SELECT-only membership-resolution role for the API's auth boundary (the
    // running API never receives the privileged admin credentials).
    await ensureRestrictedRole(client, config.authRole ?? 'c3_auth', authPassword);
    // Read-only logical-backup role (created here so 0006 can grant to it; the
    // documented BYPASSRLS exception is applied by migration 0006, not here).
    await ensureRestrictedRole(client, config.backupRole ?? 'c3_backup', backupPassword);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // H-08: the checksum column arrives idempotently (the ledger predates it).
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text');
    const ledger = new Map<string, string | null>(
      (await client.query('SELECT id, checksum FROM _migrations')).rows.map(
        (r: { id: string; checksum: string | null }) => [r.id, r.checksum] as const,
      ),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      // Normalize line endings before hashing: git may check the same file out
      // as LF or CRLF depending on platform; the CONTENT is what is frozen.
      const checksum = createHash('sha256').update(sqlText.replace(/\r\n/g, '\n')).digest('hex');

      if (ledger.has(file)) {
        const stored = ledger.get(file);
        if (stored === null || stored === undefined) {
          // Applied before checksums existed (or via the manual staging paste):
          // adopt the current content as the frozen truth.
          await client.query('UPDATE _migrations SET checksum = $2 WHERE id = $1 AND checksum IS NULL', [file, checksum]);
          log(`↳ skip ${file} (already applied; checksum adopted)`);
        } else if (stored !== checksum) {
          throw new Error(
            `Migration ${file} was EDITED after being applied (ledger ${stored.slice(0, 12)}… ≠ file ${checksum.slice(0, 12)}…). ` +
              'Applied migrations are frozen — ship the correction as a NEW migration file.',
          );
        } else {
          log(`↳ skip ${file} (already applied)`);
        }
        continue;
      }

      log(`↳ apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query('INSERT INTO _migrations (id, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
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
