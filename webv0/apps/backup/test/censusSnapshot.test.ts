/**
 * censusSnapshot.test — R3-N06's ACHIEVABLE-REAL half, against a REAL PostgreSQL
 * (Neural-sanctioned, HARDEN-3.4 close-out): the blob census is pinned to the SAME
 * MVCC snapshot that `pg_export_snapshot()` hands to pg_dump, as the REAL c3_backup
 * role, through the REAL `coherentDumpAndCensusFlow` and the REAL `enumerateBlobsInTx`
 * SQL. A write committed by another connection AFTER the snapshot export but BEFORE
 * the census read must be INVISIBLE to the census (and visible to any fresh reader) —
 * that is the same-snapshot coherence the whole backup design rests on.
 *
 * What this deliberately does NOT cover (drill-certified per the Neural+owner B+ ruling,
 * 2026-07-14): the pg_dump half itself (`--snapshot` threading is unit-proven in
 * coherentFlow.test.ts; the binary does not exist in this gate environment) and the
 * weekly-restore path. See C3-HARDEN-3.4-EVIDENCE.md, "three items BLOCKED".
 *
 * RED-proof (discrimination): neuter `CENSUS_TX_BEGIN` in adapters.ts to plain 'BEGIN'
 * (READ COMMITTED) → every census statement takes a FRESH snapshot, the concurrently
 * committed photo appears in the census, and the not-in-census assertion fails.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { CENSUS_TX_BEGIN, createBackupDeps, enumerateBlobsInTx } from '../src/adapters';
import { coherentDumpAndCensusFlow, type CoherentIo } from '../src/coherentFlow';
import type { BackupEnv } from '../src/env';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('R3-N06 (achievable-real half) — the census reads INSIDE the exported snapshot', () => {
  it('a photo committed after pg_export_snapshot() is INVISIBLE to the census, visible to a fresh reader', async () => {
    const t = await db.seedTenant({ slug: 'census-snap' });
    const preKey = `${t.tenantId}/photos/pre-existing`;
    const raceKey = `${t.tenantId}/photos/raced-in`;
    await db.adminQuery(
      `INSERT INTO person (tenant_id, person_id, full_name, photo_storage_key, photo_sha256)
       VALUES ($1, 'PER-PRE', 'Pre Existing', $2, $3)`,
      [t.tenantId, preKey, SHA_A],
    );

    // The census connection is the REAL backup role (BYPASSRLS read-only) — this test is
    // also the grants proof: c3_backup can read person/document/intake_submission across
    // tenants and may pg_export_snapshot().
    const census = new Client({ connectionString: db.backupUrl });
    await census.connect();
    let exportedSnapshotId = '';
    let blobs: Awaited<ReturnType<typeof enumerateBlobsInTx>> = [];
    try {
      const io: CoherentIo = {
        // The REAL adapter statement (imported, not copied) — neutering it in adapters.ts
        // to READ COMMITTED is exactly what turns this test RED.
        begin: async () => { await census.query(CENSUS_TX_BEGIN); },
        exportSnapshot: async () => {
          const id = String((await census.query('SELECT pg_export_snapshot() AS id')).rows[0].id);
          exportedSnapshotId = id;
          // THE RACE, at the only point it can exist: the snapshot is now pinned (and is
          // what pg_dump would be handed); another connection lands + COMMITS a new photo
          // BEFORE the census reads. Same-snapshot coherence says the census must not see it.
          await db.adminQuery(
            `INSERT INTO person (tenant_id, person_id, full_name, photo_storage_key, photo_sha256)
             VALUES ($1, 'PER-RACE', 'Raced In', $2, $3)`,
            [t.tenantId, raceKey, SHA_B],
          );
          return id;
        },
        enumerate: () => enumerateBlobsInTx(census), // the REAL census SQL, in the pinned tx
        runDump: async (snapshotId) => {
          // pg_dump itself is drill-certified (binary absent here); the flow still threads
          // the id — assert it is the exact exported snapshot, not a re-derived one.
          expect(snapshotId).toBe(exportedSnapshotId);
        },
        commit: async () => { await census.query('COMMIT'); },
        rollback: async () => { await census.query('ROLLBACK'); },
        dumpBytes: async () => 0,
      };

      const res = await coherentDumpAndCensusFlow(io);
      blobs = res.blobs;
    } finally {
      await census.end();
    }

    expect(exportedSnapshotId).not.toBe(''); // c3_backup CAN export a snapshot (no special priv)
    const keys = blobs.map((b) => b.storageKey);
    // The pre-snapshot photo is enumerated with its class + sha…
    expect(keys).toContain(preKey);
    expect(blobs.find((b) => b.storageKey === preKey)).toMatchObject({ cls: 'photo', sha256: SHA_A });
    // …and the raced-in commit is NOT in the census (pinned snapshot — RED under READ COMMITTED).
    expect(keys).not.toContain(raceKey);

    // Sanity for the discriminator: the raced row IS committed and visible to a fresh reader —
    // its absence above is snapshot-coherence, not a failed insert.
    const fresh = await db.adminQuery<{ n: string }>(
      `SELECT count(*) AS n FROM person WHERE tenant_id = $1 AND photo_storage_key = $2`,
      [t.tenantId, raceKey],
    );
    expect(Number(fresh[0]!.n)).toBe(1);
  });
});

describe('HARDEN-3.8 H3 / U5 — the production snapshot session is runbook-observable', () => {
  it('createBackupDeps defeats a hostile URL application_name and exposes the exact exporter blocker PID', async () => {
    const tenant = await db.seedTenant({ slug: 'u5-observer' });
    await db.adminQuery(
      `INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, 'PER-U5', 'Observer Probe')`,
      [tenant.tenantId],
    );
    const hostileDatabaseUrl = new URL(db.backupUrl);
    hostileDatabaseUrl.searchParams.set('application_name', 'evil');
    const env: BackupEnv = {
      databaseUrl: hostileDatabaseUrl.toString(),
      r2Endpoint: 'http://127.0.0.1:1',
      r2Bucket: 'unused',
      r2AccessKeyId: 'unused',
      r2SecretAccessKey: 'unused',
      ageRecipient: 'age1unused',
      sourceCommit: 'u5test',
      mode: 'manual',
      environmentLabel: 'test',
      signingKeyPem: null,
      allowUnsigned: true,
    };
    const deps = createBackupDeps(env);
    const ddl = new Client({ connectionString: db.adminUrl });
    const observer = new Client({ connectionString: db.adminUrl });
    const temp = mkdtempSync(join(tmpdir(), 'c3-u5-observer-'));
    const oldPause = process.env.BACKUP_PAUSE_AFTER_CENSUS;
    process.env.BACKUP_PAUSE_AFTER_CENSUS = '3';
    let openPause!: () => void;
    const pauseOpened = new Promise<void>((resolve) => { openPause = resolve; });
    const warn = vi.spyOn(console, 'warn').mockImplementation((msg?: unknown) => {
      if (String(msg).includes('backup.census_pause') && !String(msg).includes('pause_end')) openPause();
    });
    let ddlPid: number | null = null;
    let ddlRun: Promise<unknown> | undefined;
    let flow: Promise<unknown> | undefined;

    try {
      await ddl.connect();
      await observer.connect();
      ddlPid = Number((await ddl.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      flow = deps.coherentDumpAndCensus(join(temp, 'dump.pgc'));
      await Promise.race([
        pauseOpened,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('production census pause never opened')), 5_000)),
      ]);

      // The runbook's S2 statement, deliberately queued behind the open census snapshot.
      ddlRun = ddl.query('ALTER TABLE person ADD COLUMN u5_observer_probe boolean');
      type ObserverRow = { pid: number; state: string; holds_snapshot: boolean };
      let observed: ObserverRow[] = [];
      await vi.waitFor(async () => {
        // Exact R4-N09 observer predicate: named session AND in-tx state AND a member of the
        // DDL backend's real pg_blocking_pids set.
        observed = (await observer.query<ObserverRow>(
          `SELECT a.pid, a.state,
                  a.backend_xid IS NOT NULL OR a.backend_xmin IS NOT NULL AS holds_snapshot
             FROM pg_stat_activity AS a
            WHERE a.application_name = 'c3-backup-exporter'
              AND a.state IN ('idle in transaction','active')
              AND a.pid = ANY(pg_blocking_pids($1))`,
          [ddlPid],
        )).rows;
        expect(observed).toHaveLength(1);
      }, { timeout: 2_000, interval: 25 });

      expect(observed[0]).toMatchObject({ holds_snapshot: true });
      // RED: remove the post-connect authoritative set_config in createBackupDeps. The hostile
      // URL then overrides the explicit Client option, so this exact observer returns [] even
      // though the DDL remains genuinely blocked.
      expect(observed[0]!.pid).not.toBe(ddlPid);

      // Cancel only the drill DDL after observing it. This keeps the test independent of whether
      // pg_dump happens to be installed on the host and prevents the adapter's bounded retry path.
      await observer.query('SELECT pg_cancel_backend($1)', [ddlPid]);
      await ddlRun.catch(() => undefined);
      await flow.catch(() => undefined); // binary absent is allowed; U5 certifies the live session.
    } finally {
      if (oldPause === undefined) delete process.env.BACKUP_PAUSE_AFTER_CENSUS;
      else process.env.BACKUP_PAUSE_AFTER_CENSUS = oldPause;
      warn.mockRestore();
      if (ddlPid !== null) {
        await observer.query('SELECT pg_cancel_backend($1)', [ddlPid]).catch(() => undefined);
      }
      await ddlRun?.catch(() => undefined);
      await flow?.catch(() => undefined);
      await ddl.end().catch(() => undefined);
      await observer.end().catch(() => undefined);
      await deps.close();
      rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);
});
