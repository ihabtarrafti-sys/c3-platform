/**
 * @c3web/test-support — provisions a REAL PostgreSQL for automated tests.
 *
 * Precedence:
 *   1. If DATABASE_ADMIN_URL + DATABASE_URL are set (Docker/CI), use them.
 *   2. Otherwise start an ephemeral embedded-postgres instance (no Docker),
 *      giving genuine role separation, RLS, and connection-pool semantics.
 *
 * Either way the schema is migrated from an empty database via the real
 * runMigrations, so migrations, constraints, RLS, roles and grants are all
 * exercised exactly as in production.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { runMigrations } from '@c3web/persistence';

const APP_ROLE = 'c3_app';
const APP_PW = 'c3_app_test_pw';
const AUTH_ROLE = 'c3_auth';
const AUTH_PW = 'c3_auth_test_pw';

export interface SeededUser {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
}

export interface SeededTenant {
  readonly tenantId: string;
  readonly slug: string;
  readonly users: Record<string, SeededUser>;
}

export interface TestDatabase {
  readonly adminUrl: string;
  readonly appUrl: string;
  /** SELECT-only membership-resolution role (c3_auth). */
  readonly authUrl: string;
  seedTenant(spec: {
    slug: string;
    name?: string;
    users?: Array<{ key: string; email: string; displayName: string; role: string }>;
  }): Promise<SeededTenant>;
  /** Remove all tenant data (keeps schema). */
  truncateAll(): Promise<void>;
  stop(): Promise<void>;
}

function randomPort(): number {
  return 55000 + Math.floor(Math.random() * 9000);
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const envAdmin = process.env.DATABASE_ADMIN_URL;
  const envApp = process.env.DATABASE_URL;

  let stopEmbedded: (() => Promise<void>) | null = null;
  let adminUrl: string;
  let appUrl: string;
  let authUrl: string;

  if (envAdmin && envApp) {
    adminUrl = envAdmin;
    appUrl = envApp;
    authUrl =
      process.env.DATABASE_AUTH_URL ?? envApp.replace(/\/\/[^:]+:[^@]+@/, `//${AUTH_ROLE}:${AUTH_PW}@`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'c3web-pg-'));
    const port = randomPort();
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'c3_admin',
      password: 'c3_admin_test_pw',
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    // Create the application database as UTF-8 explicitly (the Windows initdb
    // locale would otherwise default it to WIN1252, which cannot store
    // international names/UPNs). Docker/CI Postgres is already UTF-8.
    const bootstrap = new Client({ connectionString: `postgres://c3_admin:c3_admin_test_pw@localhost:${port}/postgres` });
    await bootstrap.connect();
    await bootstrap.query(`CREATE DATABASE c3web WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    await bootstrap.end();
    adminUrl = `postgres://c3_admin:c3_admin_test_pw@localhost:${port}/c3web`;
    appUrl = `postgres://${APP_ROLE}:${APP_PW}@localhost:${port}/c3web`;
    authUrl = `postgres://${AUTH_ROLE}:${AUTH_PW}@localhost:${port}/c3web`;
    stopEmbedded = async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  await runMigrations({
    adminConnectionString: adminUrl,
    appRole: APP_ROLE,
    appPassword: APP_PW,
    authRole: AUTH_ROLE,
    authPassword: AUTH_PW,
  });

  const adminQuery = async <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> => {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    await client.query("SET client_encoding TO 'UTF8'");
    try {
      const res = await client.query(text, params);
      return res.rows as T[];
    } finally {
      await client.end();
    }
  };

  return {
    adminUrl,
    appUrl,
    authUrl,

    async seedTenant(spec): Promise<SeededTenant> {
      const rows = await adminQuery<{ id: string }>(
        'INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id',
        [spec.slug, spec.name ?? spec.slug],
      );
      const tenantId = rows[0]!.id;
      const users: Record<string, SeededUser> = {};
      for (const u of spec.users ?? []) {
        const userRows = await adminQuery<{ id: string }>(
          `INSERT INTO app_user (email, display_name) VALUES ($1, $2)
           ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
           RETURNING id`,
          [u.email, u.displayName],
        );
        const userId = userRows[0]!.id;
        await adminQuery(
          'INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [tenantId, userId],
        );
        await adminQuery(
          'INSERT INTO role_assignment (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [tenantId, userId, u.role],
        );
        users[u.key] = { userId, email: u.email, displayName: u.displayName, role: u.role };
      }
      return { tenantId, slug: spec.slug, users };
    },

    async truncateAll(): Promise<void> {
      await adminQuery(`TRUNCATE
        audit_event, approval_event, person, approval, business_id_counter,
        role_assignment, tenant_membership, app_user, tenant RESTART IDENTITY CASCADE`);
    },

    async stop(): Promise<void> {
      if (stopEmbedded) await stopEmbedded();
    },
  };
}
