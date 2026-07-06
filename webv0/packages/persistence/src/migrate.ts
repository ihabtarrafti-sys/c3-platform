/**
 * migrate.ts — apply the ordered SQL migrations as the PRIVILEGED admin role,
 * and ensure the least-privileged application role exists (separate from the
 * admin/migration connection). Migrations are tracked in `_migrations` and
 * applied at most once, each in its own transaction.
 */
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
  readonly log?: (msg: string) => void;
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
    await ensureRestrictedRole(client, config.authRole ?? 'c3_auth', config.authPassword ?? 'c3_auth_dev_pw');
    // Read-only logical-backup role (created here so 0006 can grant to it; the
    // documented BYPASSRLS exception is applied by migration 0006, not here).
    await ensureRestrictedRole(client, config.backupRole ?? 'c3_backup', config.backupPassword ?? 'c3_backup_dev_pw');
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const done = new Set(
      (await client.query('SELECT id FROM _migrations')).rows.map((r: { id: string }) => r.id),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (done.has(file)) {
        log(`↳ skip ${file} (already applied)`);
        continue;
      }
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      log(`↳ apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query('INSERT INTO _migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}
