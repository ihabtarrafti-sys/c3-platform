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
import {
  BLIND_SWEEP_AGE_MS,
  DATA_DIR_PREFIX,
  STARTUP_RACE_GRACE_MS,
  planPgDirSweep,
  planPgProcessSweep,
  type ObservedDir,
  type ObservedProcess,
} from './pgSweep';
export {
  BLIND_SWEEP_AGE_MS,
  DATA_DIR_PREFIX,
  EMBEDDED_PG_MARKER,
  STARTUP_RACE_GRACE_MS,
  isParentAlive,
  planPgDirSweep,
  planPgProcessSweep,
  type ObservedDir,
  type ObservedProcess,
  type PgProcessSweepPlan,
} from './pgSweep';

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

/** Reads a Win32_Process projection as JSON; `null` means the listing failed. */
function readProcessTable<T>(
  execSync: typeof import('node:child_process').execSync,
  selection: string,
  filter = '',
): T[] | null {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process${filter} | Select-Object ${selection} | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
  } catch {
    return null; // caller must fall back conservatively — see BLIND_SWEEP_AGE_MS
  }
}

/**
 * A calculated property, kept in one place because it is easy to get subtly
 * wrong: some system processes have a null CreationDate, and letting that throw
 * inside the projection loses the whole listing. `0` is the safe substitute —
 * it reads as "started at the epoch", which makes a parent look ALIVE, and
 * protecting something we cannot date is the correct direction to fail.
 */
const START_MS_PROJECTION =
  "@{n='StartMs';e={if ($_.CreationDate) {[int64](($_.CreationDate.ToUniversalTime()-[datetime]'1970-01-01').TotalMilliseconds)} else {0}}}";

/**
 * Best-effort janitor for Windows embedded-PG leakage (QA-sweep hardening).
 * On Windows, stop()/rmSync can fail with EBUSY, deliberately leaving temp
 * dirs (see removeDirWithRetry) — and occasionally the postgres process
 * itself. Across many gate runs these pile up (observed: 38 live postgres.exe
 * + 256 c3web-pg-* dirs) until unrelated tests flake on timeouts.
 *
 * ⚖️ REWRITTEN 2026-07-30 (Neural's ruling) — liveness is decided by PARENT
 * LIVENESS, never by a directory's age. The reasoning, the PID-recycling guard
 * and the two measured defects this replaces are documented in `pgSweep.ts`;
 * this function is only the effects. In short:
 *   - it now sweeps orphaned `--forkchild` CHILDREN, which carry no data-dir
 *     token and therefore survived every previous sweep — they are what blocks
 *     `npm ci` with `EPERM: unlink … postgres.exe`;
 *   - it NEVER touches a process whose parent is alive, at any age, so a
 *     neighbouring lane's long-running preview cluster is safe;
 *   - a real PostgreSQL on this machine is still unkillable by it, now via the
 *     `@embedded-postgres` binary marker instead of the data-dir token.
 *
 * Unchanged guarantees: every swept dir/process is LOGGED — no silent cleanup;
 * and it never throws, because a janitor must not fail a run.
 *
 * Called once per gate run (scripts/gate.mts); also exported for manual use.
 */
export async function sweepStaleEmbeddedPg(): Promise<void> {
  const now = Date.now();
  const log = (line: string) => console.log(`[pg-sweep] ${line}`);
  try {
    const { execSync } = await import('node:child_process');
    const { readdirSync, statSync } = await import('node:fs');

    // 1. Orphaned embedded-postgres processes (Windows-only leak).
    const activeTokens = new Set<string>();
    let processTableRead = false;
    if (process.platform === 'win32') {
      const pgRows = readProcessTable<{
        ProcessId?: number;
        ParentProcessId?: number;
        CommandLine?: string | null;
        StartMs?: number;
      }>(
        execSync,
        `ProcessId,ParentProcessId,CommandLine,${START_MS_PROJECTION}`,
        ` -Filter \\"Name='postgres.exe'\\"`,
      );
      const allRows = readProcessTable<{ ProcessId?: number; StartMs?: number }>(
        execSync,
        `ProcessId,${START_MS_PROJECTION}`,
      );

      if (pgRows && allRows) {
        processTableRead = true;
        const startedMsByPid = new Map<number, number>();
        for (const row of allRows) {
          if (typeof row.ProcessId === 'number' && typeof row.StartMs === 'number') {
            startedMsByPid.set(row.ProcessId, row.StartMs);
          }
        }
        // A row we cannot date is DROPPED, never killed: without a start time
        // the PID-recycling guard cannot run, and an undatable process would
        // otherwise look parentless and be swept.
        const undatable = pgRows.filter(
          (row) => typeof row.ProcessId === 'number' && !(typeof row.StartMs === 'number' && row.StartMs > 0),
        ).length;
        if (undatable > 0) log(`skipped ${undatable} postgres.exe with no readable start time`);

        const processes: ObservedProcess[] = pgRows
          .filter(
            (row): row is { ProcessId: number; ParentProcessId?: number; CommandLine?: string | null; StartMs: number } =>
              typeof row.ProcessId === 'number' && typeof row.StartMs === 'number' && row.StartMs > 0,
          )
          .map((row) => ({
            pid: row.ProcessId,
            parentPid: typeof row.ParentProcessId === 'number' ? row.ParentProcessId : -1,
            startedMs: row.StartMs,
            commandLine: row.CommandLine ?? '',
          }));

        const tokenByPid = new Map<number, string>();
        for (const proc of processes) {
          const token = /c3web-pg-[A-Za-z0-9]+/.exec(proc.commandLine)?.[0];
          if (token) tokenByPid.set(proc.pid, token);
        }

        const plan = planPgProcessSweep(processes, startedMsByPid);
        for (const token of plan.activeTokens) activeTokens.add(token);
        if (plan.foreign.length > 0) log(`left ${plan.foreign.length} non-embedded postgres.exe untouched`);
        if (plan.activeTokens.length > 0) log(`protected in-use cluster(s): ${plan.activeTokens.join(', ')}`);

        // Announce the whole plan BEFORE acting. `taskkill /T` reaps a tree, so
        // the per-pid lines below under-report: killing an orphaned postmaster
        // takes its children with it and their own taskkill then finds nothing
        // to do. Without this line the log reads "killed 1" when nine died,
        // which quietly breaks this janitor's no-silent-cleanup promise.
        if (plan.kill.length > 0) log(`sweeping ${plan.kill.length} orphaned process(es): ${plan.kill.join(', ')}`);

        for (const pid of plan.kill) {
          const token = tokenByPid.get(pid);
          try {
            // /T takes the process tree: belt-and-braces with the plan's own
            // propagation, so a postmaster never dies leaving children behind.
            execSync(`taskkill /PID ${pid} /F /T`, { timeout: 15_000, stdio: 'ignore' });
            log(`killed orphaned postgres.exe pid=${pid}${token ? ` (${token})` : ' (forkchild)'}`);
          } catch {
            // Already gone with its parent's tree, or unkillable. If it owned a
            // data dir, protect that dir rather than delete it out from under a
            // process that is somehow still running.
            if (token) {
              activeTokens.add(token);
              log(`could not kill pid=${pid} (${token}) — keeping its dir`);
            }
          }
        }
      } else {
        log('process listing unavailable — falling back to the conservative age sweep');
      }
    }

    // 2. Leaked data dirs. Age is ONLY the startup-race guard; a live cluster's
    //    dir is protected by its token above, at any age. Without a readable
    //    process table there are no tokens, so the old conservative hour is the
    //    only safe gate — see BLIND_SWEEP_AGE_MS.
    const minAgeMs = processTableRead ? STARTUP_RACE_GRACE_MS : BLIND_SWEEP_AGE_MS;
    const dirs: ObservedDir[] = [];
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(DATA_DIR_PREFIX)) continue;
      try {
        dirs.push({ name, ageMs: now - statSync(join(tmpdir(), name)).mtimeMs });
      } catch {
        /* stat raced with another sweep — skip it */
      }
    }
    for (const name of planPgDirSweep(dirs, activeTokens, minAgeMs)) {
      const ageMs = dirs.find((dir) => dir.name === name)?.ageMs ?? 0;
      try {
        await removeDirWithRetry(join(tmpdir(), name));
        log(`removed unreferenced data dir ${name} (age ${Math.round(ageMs / 60000)}min)`);
      } catch {
        /* remove raced or failed — leave it for the next sweep */
      }
    }
  } catch {
    /* the janitor never fails a run */
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
