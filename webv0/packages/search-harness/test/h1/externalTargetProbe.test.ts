import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { sha256Hex } from '../../src/canonical.js';
import {
  H1_CLUSTER_IDENTITY_HASH_FRAMING,
  H1_OWNERSHIP_TABLE,
  H1_RETAINED_TRANSACTION_ISOLATION,
  H1_RETAINED_TRANSACTION_LOCK_MODE,
  H1ExternalTargetProbeError,
  assertRetainedSeedTransactionReady,
  consumeRetainedSeedTransaction,
  probeExternalOwnedDisposableTarget,
  type H1ExternalTargetProbeInput,
  type H1ExternalTargetProbeLedger,
} from '../../src/h1/externalTargetProbe.js';
import type {
  H1SqlClient,
  H1SqlQueryResult,
} from '../../src/h1/disposableDatabase.js';
import {
  attestH1ProfileExecution,
  buildH1ProfileDatabasePlan,
  prepareH1SourcePlan,
  resolveH1VerifiedH0GuardTableSet,
  resolveH1VerifiedSeedTableSet,
  type H1VerifiedProfileExecutionAttestation,
} from '../../src/h1/sourcePlan.js';
import {
  HEARTH_SEARCH_OWNERSHIP_MARKER,
  HEARTH_SEARCH_SEED_ACK,
} from '../../src/seederGuard.js';

const now = new Date('2026-07-26T12:00:00.000Z');
const databaseName = 'c3_hearth_search_probe_1';
const seedSecret = 'seed-secret-sentinel';
const seedUrl =
  `postgresql://seed:${seedSecret}@127.0.0.1:6543/${databaseName}`;
const systemIdentifier = '782349872349872349';

let verifiedD0: H1VerifiedProfileExecutionAttestation;
let exactD0Tables: readonly string[];
let h0GuardTables: readonly string[];

interface MockClientOptions {
  readonly runId: string;
  readonly existingCounts?: Readonly<Record<string, number>>;
  readonly observedDatabase?: string;
  readonly observedSystemIdentifier?: string;
  readonly queryFailureMatch?: string;
  readonly queryFailureMessage?: string;
  readonly connectFailureMessage?: string;
  readonly endFailureCount?: number;
  readonly rollbackFailureCount?: number;
  readonly requireLockBeforeRead?: boolean;
}

function result(
  rows: readonly Readonly<Record<string, unknown>>[],
): H1SqlQueryResult {
  return { rows, rowCount: rows.length };
}

function mockClient(input: MockClientOptions): {
  readonly sql: string[];
  readonly connect: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
  readonly value: H1SqlClient;
} {
  const sql: string[] = [];
  let transactionStarted = false;
  let lockAcquired = false;
  let remainingEndFailures = input.endFailureCount ?? 0;
  let remainingRollbackFailures =
    input.rollbackFailureCount ?? 0;

  const end = vi.fn(async () => {
    if (remainingEndFailures > 0) {
      remainingEndFailures -= 1;
      throw new Error('close-secret-sentinel');
    }
  });
  const value: H1SqlClient = {
    async query(text): Promise<H1SqlQueryResult> {
      sql.push(text);
      if (
        input.queryFailureMatch !== undefined &&
        text.includes(input.queryFailureMatch)
      ) {
        throw new Error(
          input.queryFailureMessage ?? 'query-secret-sentinel',
        );
      }
      if (
        text ===
        `BEGIN ISOLATION LEVEL ${H1_RETAINED_TRANSACTION_ISOLATION}`
      ) {
        transactionStarted = true;
        return result([]);
      }
      if (text === 'SET LOCAL search_path TO pg_catalog, public') {
        if (!transactionStarted) {
          throw new Error('search path set before transaction');
        }
        return result([]);
      }
      if (text.startsWith('LOCK TABLE ')) {
        if (!transactionStarted) {
          throw new Error('lock acquired before transaction');
        }
        lockAcquired = true;
        return result([]);
      }
      if (text === 'ROLLBACK') {
        if (remainingRollbackFailures > 0) {
          remainingRollbackFailures -= 1;
          throw new Error('rollback-secret-sentinel');
        }
        transactionStarted = false;
        lockAcquired = false;
        return result([]);
      }
      if (text === 'COMMIT') {
        transactionStarted = false;
        lockAcquired = false;
        return result([]);
      }
      if (
        text ===
        'SELECT pg_catalog.current_database()::text AS database_name'
      ) {
        return result([
          {
            database_name:
              input.observedDatabase ?? databaseName,
          },
        ]);
      }
      if (text.includes('FROM pg_catalog.pg_control_system()')) {
        return result([
          {
            system_identifier:
              input.observedSystemIdentifier ?? systemIdentifier,
          },
        ]);
      }
      if (
        text.includes(
          `FROM public."${H1_OWNERSHIP_TABLE}" FOR UPDATE`,
        )
      ) {
        if (
          input.requireLockBeforeRead === true &&
          !lockAcquired
        ) {
          throw new Error(
            'ownership read observed before exclusion lock',
          );
        }
        return result([
          {
            marker_kind: HEARTH_SEARCH_OWNERSHIP_MARKER,
            run_id: input.runId,
            database_created_at: '2026-07-26 11:59:00+00',
            marker_created_at: '2026-07-26 11:59:30+00',
          },
        ]);
      }
      const countTable =
        /^SELECT count\(\*\)::text AS row_count FROM public\."([a-z_][a-z0-9_]*)"$/u.exec(
          text,
        )?.[1];
      if (countTable !== undefined) {
        if (
          input.requireLockBeforeRead === true &&
          !lockAcquired
        ) {
          throw new Error(
            'emptiness read observed before exclusion lock',
          );
        }
        return result([
          {
            row_count: String(
              input.existingCounts?.[countTable] ?? 0,
            ),
          },
        ]);
      }
      return result([]);
    },
    end,
  };
  const connect = vi.fn(async (
    _exactSeedAdminUrl: string,
    _connectionTimeoutMs: number,
  ) => {
    if (input.connectFailureMessage !== undefined) {
      throw new Error(input.connectFailureMessage);
    }
    return value;
  });
  return { sql, connect, end, value };
}

function protectedInventory(
  protectedClusterIdentitySha256?: string,
): H1ExternalTargetProbeInput['protectedInventory'] {
  return {
    schemaVersion: 1,
    endpoints: [
      {
        label: 'development-shared',
        url: 'postgresql://x:y@dev.invalid/c3',
        clusterIdentitySha256:
          protectedClusterIdentitySha256 ?? '1'.repeat(64),
      },
      {
        label: 'staging',
        url: 'postgresql://x:y@staging.invalid/c3',
        clusterIdentitySha256: '2'.repeat(64),
      },
      {
        label: 'production',
        url: 'postgresql://x:y@prod.invalid/c3',
        clusterIdentitySha256: '3'.repeat(64),
      },
    ],
  };
}

function measuredEnvironment() {
  return {
    NODE_ENV: 'production',
    RATE_LIMIT_MAX: '100000',
    DATABASE_URL:
      `postgresql://app:app-secret@127.0.0.1:6543/${databaseName}`,
    DATABASE_AUTH_URL:
      `postgresql://auth:auth-secret@127.0.0.1:6543/${databaseName}`,
  };
}

function probeInput(
  database: ReturnType<typeof mockClient>,
  runId: string,
  overrides: Partial<H1ExternalTargetProbeInput> = {},
): H1ExternalTargetProbeInput {
  return {
    seedAdminUrl: seedUrl,
    acknowledgement: HEARTH_SEARCH_SEED_ACK,
    runId,
    protectedInventory: protectedInventory(),
    measuredEnvironment: measuredEnvironment(),
    probeTimeoutMs: 30_000,
    verifiedProfileExecution: verifiedD0,
    connect: database.connect,
    ...overrides,
  };
}

describe('H1 external-owned target probe', () => {
  beforeAll(() => {
    const source = prepareH1SourcePlan();
    const d0Plan = buildH1ProfileDatabasePlan(source, 'H3M.D0');
    verifiedD0 = attestH1ProfileExecution(d0Plan);
    exactD0Tables = resolveH1VerifiedSeedTableSet(verifiedD0);
    h0GuardTables =
      resolveH1VerifiedH0GuardTableSet(verifiedD0);
  }, 120_000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a SERIALIZABLE exclusion transaction across exact H0 checks and one-shot handoff', async () => {
    const runId = 'probe-run-handoff';
    const database = mockClient({
      runId,
      requireLockBeforeRead: true,
    });
    const ledger: H1ExternalTargetProbeLedger = {
      attemptedEvents: [],
    };
    const probed = await probeExternalOwnedDisposableTarget(
      probeInput(database, runId, { sideEffectLedger: ledger }),
    );

    expect(exactD0Tables).not.toContain('delegation');
    expect(h0GuardTables).toContain('delegation');
    expect(probed.transaction.lockedTables).toEqual(h0GuardTables);
    expect(
      ledger.attemptedEvents.map(({ capability }) => capability),
    ).toEqual([
      'database-probe-connect',
      'database-probe-identity',
      'database-probe-transaction',
      'database-probe-lock',
      'database-probe-read',
    ]);

    const databaseIdentityIndex = database.sql.indexOf(
      'SELECT pg_catalog.current_database()::text AS database_name',
    );
    const clusterIdentityIndex = database.sql.indexOf(
      'SELECT system_identifier::text AS system_identifier FROM pg_catalog.pg_control_system()',
    );
    const beginIndex = database.sql.indexOf(
      `BEGIN ISOLATION LEVEL ${H1_RETAINED_TRANSACTION_ISOLATION}`,
    );
    const searchPathIndex = database.sql.indexOf(
      'SET LOCAL search_path TO pg_catalog, public',
    );
    const statementTimeoutIndex = database.sql.indexOf(
      'SET LOCAL statement_timeout = 30000',
    );
    const lockTimeoutIndex = database.sql.indexOf(
      'SET LOCAL lock_timeout = 30000',
    );
    const lockIndex = database.sql.findIndex((sql) =>
      sql.startsWith('LOCK TABLE '),
    );
    const ownershipReadIndex = database.sql.findIndex((sql) =>
      sql.includes(
        `FROM public."${H1_OWNERSHIP_TABLE}" FOR UPDATE`,
      ),
    );
    expect(databaseIdentityIndex).toBeGreaterThanOrEqual(0);
    expect(clusterIdentityIndex).toBeGreaterThan(
      databaseIdentityIndex,
    );
    expect(beginIndex).toBeGreaterThan(clusterIdentityIndex);
    expect(searchPathIndex).toBeGreaterThan(beginIndex);
    expect(statementTimeoutIndex).toBeGreaterThan(searchPathIndex);
    expect(lockTimeoutIndex).toBeGreaterThan(statementTimeoutIndex);
    expect(lockIndex).toBeGreaterThan(lockTimeoutIndex);
    expect(ownershipReadIndex).toBeGreaterThan(lockIndex);
    expect(database.sql.slice(0, ownershipReadIndex)).not.toContain(
      'COMMIT',
    );
    expect(database.sql.slice(0, ownershipReadIndex)).not.toContain(
      'ROLLBACK',
    );
    expect(database.connect).toHaveBeenCalledWith(seedUrl, 30_000);

    const lockSql = database.sql[lockIndex];
    if (lockSql === undefined) {
      throw new Error('lock SQL was not recorded');
    }
    expect(lockSql).toContain(
      `public."${H1_OWNERSHIP_TABLE}"`,
    );
    for (const table of h0GuardTables) {
      expect(lockSql).toContain(`public."${table}"`);
    }
    expect(
      database.sql.filter((sql) =>
        sql.startsWith(
          'SELECT count(*)::text AS row_count FROM public."',
        ),
      ),
    ).toHaveLength(h0GuardTables.length);
    expect(database.sql).toContain(
      'SELECT system_identifier::text AS system_identifier FROM pg_catalog.pg_control_system()',
    );

    expect(() =>
      assertRetainedSeedTransactionReady(
        probed.transaction,
        verifiedD0,
      ),
    ).not.toThrow();
    const consumed = consumeRetainedSeedTransaction(
      probed.transaction,
      verifiedD0,
    );
    expect(consumed.client).toBe(database.value);
    expect(consumed.lockMode).toBe(
      H1_RETAINED_TRANSACTION_LOCK_MODE,
    );
    expect(
      ledger.attemptedEvents.map(({ capability }) => capability),
    ).toEqual([
      'database-probe-connect',
      'database-probe-identity',
      'database-probe-transaction',
      'database-probe-lock',
      'database-probe-read',
      'database-probe-handoff',
    ]);
    expect(() =>
      consumeRetainedSeedTransaction(
        probed.transaction,
        verifiedD0,
      ),
    ).toThrow(H1ExternalTargetProbeError);

    await probed.closeIfUnconsumed();
    expect(database.end).not.toHaveBeenCalled();
    await consumed.client.query('ROLLBACK');
    await consumed.client.end();
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('RED: a D0 execution still rejects a populated non-D0 delegation table', async () => {
    const runId = 'probe-run-overlay-red';
    const database = mockClient({
      runId,
      existingCounts: { delegation: 1 },
    });

    await expect(
      probeExternalOwnedDisposableTarget(
        probeInput(database, runId),
      ),
    ).rejects.toMatchObject({
      code: 'SEED_DATABASE_ALREADY_POPULATED',
    });
    expect(exactD0Tables).not.toContain('delegation');
    expect(h0GuardTables).toContain('delegation');
    expect(database.sql).toContain(
      'SELECT count(*)::text AS row_count FROM public."delegation"',
    );
    expect(database.sql).toContain('ROLLBACK');
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('RED: rejects a protected live cluster even when its URL differs', async () => {
    const runId = 'probe-run-cluster-red';
    const database = mockClient({ runId });
    const observedClusterIdentitySha256 = sha256Hex(
      `${H1_CLUSTER_IDENTITY_HASH_FRAMING}${systemIdentifier}`,
    );

    const ledger: H1ExternalTargetProbeLedger = {
      attemptedEvents: [],
    };
    await expect(
      probeExternalOwnedDisposableTarget(
        probeInput(database, runId, {
          protectedInventory: protectedInventory(
            observedClusterIdentitySha256,
          ),
          sideEffectLedger: ledger,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'SEED_TARGET_PROTECTED_ENDPOINT',
    });
    expect(database.sql).toEqual([
      'SELECT pg_catalog.current_database()::text AS database_name',
      'SELECT system_identifier::text AS system_identifier FROM pg_catalog.pg_control_system()',
    ]);
    expect(
      ledger.attemptedEvents.map(({ capability }) => capability),
    ).toEqual([
      'database-probe-connect',
      'database-probe-identity',
    ]);
    expect(database.sql).not.toContain(
      `BEGIN ISOLATION LEVEL ${H1_RETAINED_TRANSACTION_ISOLATION}`,
    );
    expect(
      database.sql.some((sql) => sql.startsWith('LOCK TABLE ')),
    ).toBe(false);
    expect(database.sql).not.toContain('ROLLBACK');
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('RED: rejects forged r6 readiness and static H0 failures before connect', async () => {
    const runId = 'probe-run-preconnect-red';
    const database = mockClient({ runId });
    const forgedAttestation = {
      ...verifiedD0,
    } as H1VerifiedProfileExecutionAttestation;

    await expect(
      probeExternalOwnedDisposableTarget(
        probeInput(database, runId, {
          verifiedProfileExecution: forgedAttestation,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'H1_EXTERNAL_TARGET_SOURCE_PLAN_INVALID',
    });
    expect(database.connect).not.toHaveBeenCalled();

    await expect(
      probeExternalOwnedDisposableTarget(
        probeInput(database, runId, {
          acknowledgement: 'not-authorized',
        }),
      ),
    ).rejects.toMatchObject({ code: 'SEED_ACK_REQUIRED' });
    expect(database.connect).not.toHaveBeenCalled();

    for (const probeTimeoutMs of [0, 300_001, 1.5]) {
      await expect(
        probeExternalOwnedDisposableTarget(
          probeInput(database, runId, {
            probeTimeoutMs,
          }),
        ),
      ).rejects.toMatchObject({
        code: 'H1_EXTERNAL_TARGET_INPUT_INVALID',
      });
    }
    expect(database.connect).not.toHaveBeenCalled();
  });

  it('never exposes connector or query error secrets', async () => {
    const connectRunId = 'probe-run-connect-secret';
    const connectDatabase = mockClient({
      runId: connectRunId,
      connectFailureMessage:
        `${seedSecret} postgresql://private:private@secret.invalid/db`,
    });
    const connectError = await probeExternalOwnedDisposableTarget(
      probeInput(connectDatabase, connectRunId),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(connectError).toBeInstanceOf(H1ExternalTargetProbeError);
    const connectRendered = String(
      (connectError as Error | undefined)?.message,
    );
    expect(connectRendered).not.toContain(seedSecret);
    expect(connectRendered).not.toContain('secret.invalid');

    const queryRunId = 'probe-run-query-secret';
    const queryDatabase = mockClient({
      runId: queryRunId,
      queryFailureMatch: 'pg_control_system',
      queryFailureMessage:
        `${seedSecret} postgresql://private:private@secret.invalid/db`,
    });
    const queryError = await probeExternalOwnedDisposableTarget(
      probeInput(queryDatabase, queryRunId),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(queryError).toBeInstanceOf(H1ExternalTargetProbeError);
    const queryRendered = String(
      (queryError as Error | undefined)?.message,
    );
    expect(queryRendered).not.toContain(seedSecret);
    expect(queryRendered).not.toContain('secret.invalid');
    expect(queryDatabase.sql).not.toContain('ROLLBACK');
    expect(queryDatabase.end).toHaveBeenCalledOnce();
  });

  it('allows an unconsumed close to retry after a sanitized driver failure', async () => {
    const runId = 'probe-run-close-retry';
    const database = mockClient({
      runId,
      endFailureCount: 1,
    });
    const probed = await probeExternalOwnedDisposableTarget(
      probeInput(database, runId),
    );

    const firstCloseError = await probed.closeIfUnconsumed().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(firstCloseError).toBeInstanceOf(
      H1ExternalTargetProbeError,
    );
    expect(String((firstCloseError as Error).message)).not.toContain(
      'close-secret-sentinel',
    );
    expect(
      database.sql.filter((sql) => sql === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(database.end).toHaveBeenCalledOnce();

    await expect(probed.closeIfUnconsumed()).resolves.toBeUndefined();
    expect(
      database.sql.filter((sql) => sql === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(database.end).toHaveBeenCalledTimes(2);
  });

  it('RED: a failed rollback is retryable but permanently closes the seed handoff path', async () => {
    const runId = 'probe-run-rollback-retry';
    const database = mockClient({
      runId,
      rollbackFailureCount: 1,
    });
    const probed = await probeExternalOwnedDisposableTarget(
      probeInput(database, runId),
    );

    const firstCloseError = await probed.closeIfUnconsumed().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(firstCloseError).toBeInstanceOf(
      H1ExternalTargetProbeError,
    );
    expect(String((firstCloseError as Error).message)).not.toContain(
      'rollback-secret-sentinel',
    );
    expect(database.end).not.toHaveBeenCalled();
    expect(() =>
      consumeRetainedSeedTransaction(
        probed.transaction,
        verifiedD0,
      ),
    ).toThrow(H1ExternalTargetProbeError);

    await expect(probed.closeIfUnconsumed()).resolves.toBeUndefined();
    expect(
      database.sql.filter((sql) => sql === 'ROLLBACK'),
    ).toHaveLength(2);
    expect(database.end).toHaveBeenCalledOnce();
  });
});
