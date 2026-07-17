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
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { runMigrations } from '@c3web/persistence';

export { instrumentPool, type QueryRecorder, type QueryStats } from './queryStats';

const APP_ROLE = 'c3_app';
const APP_PW = 'c3_app_test_pw';
const AUTH_ROLE = 'c3_auth';
const AUTH_PW = 'c3_auth_test_pw';
const BACKUP_ROLE = 'c3_backup';
const BACKUP_PW = 'c3_backup_test_pw';

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
  /** Read-only logical-backup role (c3_backup; BYPASSRLS). */
  readonly backupUrl: string;
  seedTenant(spec: {
    slug: string;
    name?: string;
    users?: Array<{ key: string; email: string; displayName: string; role: string; entra?: { tid: string; oid: string } }>;
  }): Promise<SeededTenant>;
  /** Remove all tenant data (keeps schema). */
  truncateAll(): Promise<void>;
  /** One-shot superuser query — for test arrangements and constraint probes. */
  adminQuery<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  stop(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * HARDEN-3 Batch F: ask the OS for a free ephemeral port instead of guessing a
 * random one — random guesses collide across the projects that run in parallel,
 * and each collision forced an expensive initialise() retry that stacked toward
 * the 180s hook timeout (the credentialsV2 flake). A tiny TOCTOU window remains
 * (covered by the bounded retry at the call site).
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('could not obtain a free port'))));
    });
  });
}

/** Bound a possibly-hanging async op so a stuck initdb is retried, not timed out
 *  by the whole beforeAll (HARDEN-3 Batch F). */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * HARDEN-3 Batch F: on Windows the embedded-Postgres process holds file locks
 * for a short moment AFTER stop() returns, so an immediate rmSync races the OS
 * and throws EBUSY/ENOTEMPTY — turning a green run red on a teardown-only issue.
 * Retry with backoff; if the directory still won't go, LEAVE it for the OS temp
 * cleaner rather than fail the suite (cleanup must never fail a passing run).
 */
async function removeDirWithRetry(dir: string): Promise<void> {
  const transient = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES']);
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (!transient.has((err as { code?: string }).code ?? '')) throw err;
      await sleep(100 * (attempt + 1));
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* leave the temp dir for the OS cleaner — never fail a passing run on cleanup */
  }
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const envAdmin = process.env.DATABASE_ADMIN_URL;
  const envApp = process.env.DATABASE_URL;

  let stopEmbedded: (() => Promise<void>) | null = null;
  let adminUrl: string;
  let appUrl: string;
  let authUrl: string;
  let backupUrl: string;

  if (envAdmin && envApp) {
    adminUrl = envAdmin;
    appUrl = envApp;
    authUrl =
      process.env.DATABASE_AUTH_URL ?? envApp.replace(/\/\/[^:]+:[^@]+@/, `//${AUTH_ROLE}:${AUTH_PW}@`);
    backupUrl = envApp.replace(/\/\/[^:]+:[^@]+@/, `//${BACKUP_ROLE}:${BACKUP_PW}@`);
  } else {
    // HARDEN-3 Batch F: vitest runs test files in parallel, so randomPort() can
    // collide across concurrently-starting instances — the loser's start() throws
    // and (as a beforeAll failure) skips the whole file + marks it failed. Retry
    // on a FRESH port + dir; surface a real error if it ultimately can't start.
    let pg!: EmbeddedPostgres;
    let dir!: string;
    let port!: number;
    const ATTEMPTS = 3;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      dir = mkdtempSync(join(tmpdir(), 'c3web-pg-'));
      port = await freePort();
      const candidate = new EmbeddedPostgres({
        databaseDir: dir,
        user: 'c3_admin',
        password: 'c3_admin_test_pw',
        port,
        persistent: false,
      });
      try {
        // Per-attempt cap (< the 180s hook timeout / ATTEMPTS) so a hung initdb
        // is retried on a fresh port+dir rather than failing the whole beforeAll.
        await withTimeout(
          (async () => {
            await candidate.initialise();
            await candidate.start();
          })(),
          50_000,
          'embedded postgres start',
        );
        pg = candidate;
        break;
      } catch (err) {
        await withTimeout(candidate.stop(), 10_000, 'embedded postgres stop').catch(() => {});
        await removeDirWithRetry(dir);
        if (attempt === ATTEMPTS - 1) throw new Error(`embedded postgres failed to start after ${ATTEMPTS} attempts: ${String(err)}`);
        await sleep(250 * (attempt + 1));
      }
    }
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
    backupUrl = `postgres://${BACKUP_ROLE}:${BACKUP_PW}@localhost:${port}/c3web`;
    stopEmbedded = async () => {
      try {
        await pg.stop();
      } catch {
        /* already stopped / crashed — still attempt cleanup below */
      }
      await removeDirWithRetry(dir);
    };
  }

  await runMigrations({
    adminConnectionString: adminUrl,
    appRole: APP_ROLE,
    appPassword: APP_PW,
    authRole: AUTH_ROLE,
    authPassword: AUTH_PW,
    backupRole: BACKUP_ROLE,
    backupPassword: BACKUP_PW,
    // Disposable embedded test database: dev/convenience secrets are intentional
    // (H-01.1 fail-closed requires this to be an EXPLICIT opt-in).
    allowDevSecrets: true,
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
    backupUrl,
    adminQuery,

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
        if (u.entra) {
          await adminQuery(
            `INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id)
             VALUES ('entra', $1, $2, $3)
             ON CONFLICT (provider, issuer_tenant_id, subject) DO NOTHING`,
            [u.entra.tid, u.entra.oid, userId],
          );
        }
        users[u.key] = { userId, email: u.email, displayName: u.displayName, role: u.role };
      }
      return { tenantId, slug: spec.slug, users };
    },

    async truncateAll(): Promise<void> {
      // HARDEN-1 M-06: the append-only streams now carry BEFORE TRUNCATE deny
      // triggers (0034). The harness reset is the one legitimate truncation —
      // SET LOCAL replica mode (superuser-only) skips triggers for exactly
      // this transaction, on exactly this connection (single query() call).
      await adminQuery(`BEGIN;
        SET LOCAL session_replication_role = 'replica';
        TRUNCATE
          erased_tenant_prefix, audit_event, approval_event, person, approval, business_id_counter,
          role_assignment, tenant_membership, external_identity, app_user, tenant RESTART IDENTITY CASCADE;
        COMMIT`);
    },

    async stop(): Promise<void> {
      if (stopEmbedded) await stopEmbedded();
    },
  };
}
