/**
 * ⚖️ ADOPTED FROM CRUCIBLE'S RED PROOFS AT 1ce4529 (CR-034 + CR-035), WITH ONE
 * ADAPTATION, DECLARED: the pg mock now answers the `pg_control_system()`
 * fingerprint query, returning an identifier derived from the HOSTNAME the
 * client connected to.
 *
 * ⛔ WHY THE ADAPTATION IS REQUIRED AND NOT A WEAKENING. The CR-035 fix asks each
 * cluster for its initdb-stamped identity and refuses on mismatch. Crucible's
 * mock throws on any query it does not recognize — written against the unfixed
 * code, which never asked. Unadapted, the BASELINE control would fail on the
 * fingerprint query's error path (fail-closed firing on a fixture gap), and the
 * misbinding test would pass for the wrong reason. Per-host identifiers make the
 * fixture answer the way real clusters do: same host → same identifier,
 * different host → different identifier. Every assertion is Crucible's,
 * unchanged; the forbidden configurations are unchanged.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEmitter as NodeEventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serializeManifest, type BackupManifest } from '../src/manifest';
import { writeAndVerifyExportBundle } from '../../../packages/persistence/src/exportBundle';

const state = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  migrations: ['0104_platform_principal_registry.sql'],
  exportResult: null as null | Record<string, unknown>,
  events: [] as Array<Record<string, unknown>>,
  errors: [] as Array<Record<string, unknown>>,
}));

vi.mock('@aws-sdk/client-s3', () => {
  class GetObjectCommand {
    constructor(readonly input: { Bucket: string; Key: string }) {}
  }
  class S3Client {
    async send(command: GetObjectCommand) {
      const bytes = state.objects.get(command.input.Key);
      if (!bytes) throw new Error(`fixture object missing: ${command.input.Key}`);
      return {
        Body: {
          transformToByteArray: async () => bytes,
        },
      };
    }
    destroy() {}
  }
  return { GetObjectCommand, S3Client };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  const { writeFileSync } = await import('node:fs');
  return {
    ...actual,
    spawn: (command: string, args: string[]) => {
      const child = new EventEmitter() as ReturnType<typeof actual.spawn>;
      (child as unknown as { stderr: NodeEventEmitter }).stderr = new EventEmitter();
      queueMicrotask(() => {
        if (command === 'age') {
          const out = args[args.indexOf('-o') + 1];
          if (!out) throw new Error('age fixture received no output path');
          writeFileSync(out, Buffer.from('plain-dump'));
        }
        child.emit('close', 0);
      });
      return child;
    },
  };
});

vi.mock('pg', () => {
  class Client {
    readonly connectionString: string;
    constructor(config: { connectionString: string }) {
      this.connectionString = config.connectionString;
    }
    async connect() {}
    async end() {}
    async query(sql: string, params?: unknown[]) {
      if (/pg_control_system/.test(sql)) {
        // The adaptation (see header): a cluster's identity is a fact about the
        // HOST the connection terminated at, exactly as in real PostgreSQL.
        const host = new URL(this.connectionString).hostname;
        return { rows: [{ id: `sysid-${host}` }], rowCount: 1 };
      }
      if (/SELECT count\(\*\)::int AS n FROM (tenant|app_user|external_identity|person|approval)/.test(sql)) {
        // Stable, genuine counts from whichever live database the caller selected.
        return { rows: [{ n: 0 }], rowCount: 1 };
      }
      if (/SELECT datname FROM pg_database/.test(sql)) {
        return { rows: [{ datname: 'postgres' }], rowCount: 1 };
      }
      if (/SELECT 1 FROM pg_database WHERE datname/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/^\s*(CREATE|DROP) DATABASE/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT id FROM _migrations/.test(sql)) {
        return { rows: state.migrations.map((id) => ({ id })), rowCount: state.migrations.length };
      }
      if (/SELECT slug FROM tenant/.test(sql)) return { rows: [{ slug: 'alpha' }], rowCount: 1 };
      if (/SELECT person_id FROM person/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT approval_id, status FROM approval/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`unhandled fixture query (${params?.length ?? 0} params): ${sql}`);
    }
  }
  return { Client };
});

vi.mock('../../../packages/persistence/src/exportTenant', () => ({
  exportTenant: async () => state.exportResult,
}));

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const encrypted = Buffer.from('encrypted-dump');
const plain = Buffer.from('plain-dump');
const objectKey = 'daily/2026/08/c3-production-20260805.dump.age';
const manifestKey = `${objectKey}.manifest.json`;
const fullExportDir = mkdtempSync(join(tmpdir(), 'c3-crucible-full-export-'));

const backupManifest: BackupManifest = {
  schema: 'c3-backup-manifest/1',
  environment: 'production',
  createdAtUtc: '2026-08-05T00:00:00.000Z',
  mode: 'daily',
  classes: ['daily'],
  objectKey,
  sourceCommit: 'f5175d9',
  serverVersion: 'PostgreSQL 18.0',
  migrations: state.migrations,
  encryptedSha256: sha(encrypted),
  encryptedBytes: encrypted.length,
  plaintextSha256: sha(plain),
  plaintextBytes: plain.length,
  pgDumpVersion: 'pg_dump 18.0',
  ageRecipientFingerprint: 'age1abcdefg…xyzuvw',
  blobInventory: {
    document: { count: 0, sample: null },
    photo: { count: 0, sample: null },
    intake: { count: 0, sample: null },
  },
  blobArchive: null,
};

const tenantRow = JSON.stringify({ id: '11111111-2222-3333-4444-555555555555', slug: 'alpha', name: 'Alpha' }) + '\n';
const rowOnlyExport = {
  manifest: {
    tenant: { id: '11111111-2222-3333-4444-555555555555', slug: 'alpha', name: 'Alpha' },
    exportedAt: '2026-08-05T00:10:00.000Z',
    schemaVersion: state.migrations,
    files: [{ name: 'tenant.jsonl', rows: 1, sha256: sha(tenantRow) }],
    blobs: [],
    note: 'genuine database row export; object-store subject not inspected',
    mode: 'full' as const,
  },
  files: [{ name: 'tenant.jsonl', content: tenantRow, rows: 1, sha256: sha(tenantRow) }],
  blobs: [],
};

interface ExitSpy {
  readonly mock: { readonly calls: unknown[][] };
  mockClear(): unknown;
  mockRestore(): void;
}

let exitSpy: ExitSpy;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

interface ScenarioResult {
  readonly exitCode: unknown;
  readonly events: Array<Record<string, unknown>>;
  readonly errors: Array<Record<string, unknown>>;
}

let baseline: ScenarioResult;
let exportMisbinding: ScenarioResult;
let databaseMisbinding: ScenarioResult;

async function runScenario(
  name: 'baseline' | 'export-misbinding' | 'database-misbinding',
  args: { liveHost: string; adminHost: string; exportTenant: boolean },
): Promise<ScenarioResult> {
  state.events.length = 0;
  state.errors.length = 0;
  exitSpy.mockClear();

  Object.assign(process.env, {
    R2_BUCKET: 'fixture-backups',
    R2_ENDPOINT: 'https://r2.example.invalid',
    R2_ACCESS_KEY_ID: 'fixture-read',
    R2_SECRET_ACCESS_KEY: 'fixture-secret',
    AGE_IDENTITY: 'AGE-SECRET-KEY-fixture',
    RESTORE_ADMIN_URL: `postgres://admin:pw@${args.adminHost}/postgres`,
    DATABASE_URL: `postgres://backup:pw@${args.liveHost}/live`,
    RESTORE_MANIFEST_KEY: manifestKey,
    RESTORE_ALLOW_UNSIGNED: 'yes-i-understand',
  });
  if (args.exportTenant) process.env.RESTORE_EXPORT_TENANT = 'alpha';
  else delete process.env.RESTORE_EXPORT_TENANT;

  vi.resetModules();
  await import('../src/restore-main');

  const deadline = Date.now() + 10_000;
  while (!exitSpy.mock.calls.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!exitSpy.mock.calls.length) throw new Error(`restore fixture '${name}' did not reach a verdict`);
  return {
    exitCode: exitSpy.mock.calls.at(-1)?.[0],
    events: state.events.map((event) => ({ ...event })),
    errors: state.errors.map((error) => ({ ...error })),
  };
}

beforeAll(async () => {
  state.exportResult = rowOnlyExport;
  state.objects.set(manifestKey, Buffer.from(serializeManifest(backupManifest)));
  state.objects.set(objectKey, encrypted);

  logSpy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
    if (typeof line !== 'string') return;
    try {
      state.events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // The entrypoint's evidence lines are JSON; unrelated output is irrelevant.
    }
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
    if (typeof line !== 'string') return;
    try {
      state.errors.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // same boundary as console.log above
    }
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never) as unknown as ExitSpy;

  baseline = await runScenario('baseline', {
    liveHost: 'cluster-b.invalid',
    adminHost: 'cluster-b.invalid',
    exportTenant: false,
  });
  exportMisbinding = await runScenario('export-misbinding', {
    liveHost: 'cluster-b.invalid',
    adminHost: 'cluster-b.invalid',
    exportTenant: true,
  });
  databaseMisbinding = await runScenario('database-misbinding', {
    liveHost: 'cluster-a.invalid',
    adminHost: 'cluster-b.invalid',
    exportTenant: false,
  });
}, 30_000);

afterAll(() => {
  exitSpy?.mockRestore();
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
  rmSync(fullExportDir, { recursive: true, force: true });
});

describe('restore certification binds each accepted result to its required subject', () => {
  it('positive control: the harness completes when both database selectors agree and no wider export is claimed', () => {
    expect(baseline.exitCode).toBe(0);
    expect(baseline.errors).toEqual([]);
    expect(baseline.events.some((entry) => entry.event === 'restore.success')).toBe(true);
  });

  it('CR-SWEEP-05: does not call a DB-only row export the full tenant bundle verified', async () => {
    // Independent S1 oracle: the real full export path refuses the same genuine
    // database result because no object-store reader exists, even with zero DB-known blobs.
    await expect(
      writeAndVerifyExportBundle(fullExportDir, rowOnlyExport, null, { skipDocBytes: false }),
    ).rejects.toThrow(/MUST read the object store|EXPORT REFUSED/i);

    const event = exportMisbinding.events.find((entry) => entry.event === 'restore.tenant_export_verified');
    expect(
      { exitCode: exportMisbinding.exitCode, event },
      'row evidence S2 must not certify the full row+blob bundle S1',
    ).toEqual({ exitCode: 1, event: undefined });
  });

  it('CR-SWEEP-05: does not prove cluster B unchanged with counts read from cluster A', () => {
    const event = databaseMisbinding.events.find((entry) => entry.event === 'restore.live_unchanged');
    expect(
      { exitCode: databaseMisbinding.exitCode, event },
      'valid unchanged counts from S2 cannot prove the required restore cluster S1',
    ).toEqual({ exitCode: 1, event: undefined });
  });

});
