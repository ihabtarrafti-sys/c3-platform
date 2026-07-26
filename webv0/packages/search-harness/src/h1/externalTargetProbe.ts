import { sha256Hex } from '../canonical.js';
import {
  assertSeedMeasuredCredentialConfiguration,
  assertSeedMeasuredCredentialSeparation,
  type MeasuredCredentialAttestation,
  type MeasuredProcessEnvironment,
} from '../credentials.js';
import {
  assertDisposableSeedTarget,
  assertDisposableSeedTargetStatic,
  createSeederGuardPolicy,
  isTrustedDisposableSeedTargetAttestation,
  SeederGuardError,
  type DisposableSeedTargetAttestation,
  type ProtectedDatabaseEndpoint,
} from '../seederGuard.js';
import type { H1SqlClient, H1SqlQueryResult } from './disposableDatabase.js';
import {
  resolveH1VerifiedH0GuardTableSet,
  type H1VerifiedProfileExecutionAttestation,
} from './sourcePlan.js';

export const H1_OWNERSHIP_TABLE =
  'c3_hearth_search_seed_ownership' as const;
export const H1_CLUSTER_IDENTITY_HASH_FRAMING =
  'C3_HEARTH_POSTGRES_SYSTEM_IDENTIFIER_V1\0' as const;
export const H1_RETAINED_TRANSACTION_ISOLATION =
  'SERIALIZABLE' as const;
export const H1_RETAINED_TRANSACTION_LOCK_MODE =
  'SHARE ROW EXCLUSIVE' as const;

export type H1ExternalTargetProbeFailureCode =
  | 'H1_EXTERNAL_TARGET_CLIENT_CLOSE_FAILED'
  | 'H1_EXTERNAL_TARGET_CLUSTER_IDENTITY_INVALID'
  | 'H1_EXTERNAL_TARGET_COUNT_INVALID'
  | 'H1_EXTERNAL_TARGET_DATABASE_MISMATCH'
  | 'H1_EXTERNAL_TARGET_INPUT_INVALID'
  | 'H1_EXTERNAL_TARGET_OWNERSHIP_INVALID'
  | 'H1_EXTERNAL_TARGET_PROBE_FAILED'
  | 'H1_EXTERNAL_TARGET_PROBE_NOT_CONSUMED'
  | 'H1_EXTERNAL_TARGET_SOURCE_PLAN_INVALID'
  | 'H1_EXTERNAL_TARGET_TRANSACTION_INVALID';

export class H1ExternalTargetProbeError extends Error {
  constructor(
    readonly code: H1ExternalTargetProbeFailureCode,
    readonly stage: string,
  ) {
    super(`${code}: external target probe stopped during ${stage}`);
    this.name = 'H1ExternalTargetProbeError';
  }
}

export interface H1ProtectedEndpointInventory {
  readonly schemaVersion: 1;
  readonly endpoints: readonly ProtectedDatabaseEndpoint[];
}

export interface H1ExternalTargetProbeEvent {
  readonly sequence: number;
  readonly capability:
    | 'database-probe-connect'
    | 'database-probe-identity'
    | 'database-probe-transaction'
    | 'database-probe-lock'
    | 'database-probe-read'
    | 'database-probe-handoff';
}

export interface H1ExternalTargetProbeLedger {
  readonly attemptedEvents: H1ExternalTargetProbeEvent[];
}

export interface H1ExternalTargetProbeInput {
  readonly seedAdminUrl: string;
  readonly acknowledgement: string | undefined;
  readonly runId: string;
  readonly protectedInventory: H1ProtectedEndpointInventory;
  readonly measuredEnvironment: MeasuredProcessEnvironment;
  /**
   * One bounded budget for connection establishment and every probe statement,
   * including table-lock acquisition.
   */
  readonly probeTimeoutMs: number;
  /**
   * Opaque token issued only from a fully verified r6 source/profile plan.
   * The probe resolves the exact bidirectionally reconciled table set from it;
   * callers cannot author or narrow a list.
   */
  readonly verifiedProfileExecution:
    H1VerifiedProfileExecutionAttestation;
  readonly connect: (
    exactSeedAdminUrl: string,
    connectionTimeoutMs: number,
  ) => Promise<H1SqlClient>;
  readonly sideEffectLedger?: H1ExternalTargetProbeLedger;
}

export interface H1RetainedSeedTransaction {
  readonly clientProvider: 'external-owned-postgresql';
  readonly databaseName: string;
  readonly targetIdentitySha256: string;
  readonly runId: string;
  readonly isolationLevel: typeof H1_RETAINED_TRANSACTION_ISOLATION;
  readonly lockMode: typeof H1_RETAINED_TRANSACTION_LOCK_MODE;
  readonly lockedTables: readonly string[];
  readonly ownershipMarkerLocked: true;
}

export interface H1ConsumedRetainedSeedTransaction {
  readonly client: H1SqlClient;
  readonly databaseName: string;
  readonly targetIdentitySha256: string;
  readonly runId: string;
  readonly isolationLevel: typeof H1_RETAINED_TRANSACTION_ISOLATION;
  readonly lockMode: typeof H1_RETAINED_TRANSACTION_LOCK_MODE;
  readonly lockedTables: readonly string[];
  readonly ownershipMarkerLocked: true;
  readonly measuredCredentials: MeasuredCredentialAttestation;
}

export interface H1ProbedExternalTarget {
  readonly transaction: H1RetainedSeedTransaction;
  /**
   * Rolls back and closes the probe connection only if the retained
   * transaction was not handed to the seeder. Rollback and close are
   * independently retryable after a failure.
   */
  closeIfUnconsumed(): Promise<void>;
}

interface RetainedTransactionState {
  readonly client: H1SqlClient;
  readonly seedAdminUrl: string;
  readonly measuredEnvironment: MeasuredProcessEnvironment;
  readonly seedTargetAttestation: DisposableSeedTargetAttestation;
  readonly verifiedProfileExecution:
    H1VerifiedProfileExecutionAttestation;
  readonly ledger: H1ExternalTargetProbeLedger | undefined;
  transactionOpen: boolean;
  clientClosed: boolean;
  consumed: boolean;
  cleanupRequested: boolean;
}

const retainedTransactions = new WeakMap<
  H1RetainedSeedTransaction,
  RetainedTransactionState
>();
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;

function fail(
  code: H1ExternalTargetProbeFailureCode,
  stage: string,
): never {
  throw new H1ExternalTargetProbeError(code, stage);
}

function event(
  ledger: H1ExternalTargetProbeLedger | undefined,
  capability: H1ExternalTargetProbeEvent['capability'],
): void {
  if (ledger === undefined) return;
  ledger.attemptedEvents.push({
    sequence: ledger.attemptedEvents.length + 1,
    capability,
  });
}

function quotePublicTable(table: string): string {
  if (!IDENTIFIER.test(table)) {
    fail('H1_EXTERNAL_TARGET_SOURCE_PLAN_INVALID', 'verified-table-set');
  }
  return `public."${table}"`;
}

function oneString(
  rows: readonly Readonly<Record<string, unknown>>[],
  key: string,
  stage: string,
): string {
  const value = rows.length === 1 ? rows[0]?.[key] : undefined;
  if (typeof value !== 'string' || value.length === 0) {
    fail('H1_EXTERNAL_TARGET_PROBE_FAILED', stage);
  }
  return value;
}

function parseCount(value: unknown, stage: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[0-9]+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail('H1_EXTERNAL_TARGET_COUNT_INVALID', stage);
  }
  return parsed;
}

function databaseNameFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.slice(1);
    if (
      (url.protocol !== 'postgres:' &&
        url.protocol !== 'postgresql:') ||
      url.hostname.length === 0 ||
      url.username.length === 0 ||
      url.password.length === 0 ||
      path.length === 0 ||
      path.includes('/') ||
      path.includes('%') ||
      [...url.searchParams].length > 0
    ) {
      throw new Error('invalid target');
    }
    return path;
  } catch {
    fail('H1_EXTERNAL_TARGET_INPUT_INVALID', 'seed-admin-url');
  }
}

function exactVerifiedH0GuardTables(
  verifiedProfileExecution: H1VerifiedProfileExecutionAttestation,
): readonly string[] {
  try {
    const tables = resolveH1VerifiedH0GuardTableSet(
      verifiedProfileExecution,
    );
    if (
      tables.length === 0 ||
      new Set(tables).size !== tables.length ||
      tables.some((table) => !IDENTIFIER.test(table))
    ) {
      fail(
        'H1_EXTERNAL_TARGET_SOURCE_PLAN_INVALID',
        'verified-table-set',
      );
    }
    return Object.freeze([...tables].sort());
  } catch (error) {
    if (error instanceof H1ExternalTargetProbeError) throw error;
    fail(
      'H1_EXTERNAL_TARGET_SOURCE_PLAN_INVALID',
      'verified-profile-execution',
    );
  }
}

async function safeConnect(
  input: H1ExternalTargetProbeInput,
): Promise<H1SqlClient> {
  try {
    return await input.connect(
      input.seedAdminUrl,
      input.probeTimeoutMs,
    );
  } catch {
    fail('H1_EXTERNAL_TARGET_PROBE_FAILED', 'database-probe-connect');
  }
}

function assertObservedClusterIsNotProtected(
  observedClusterIdentitySha256: string,
  inventory: H1ProtectedEndpointInventory,
): void {
  const protectedEndpoint = inventory.endpoints.find(
    ({ clusterIdentitySha256 }) =>
      clusterIdentitySha256 === observedClusterIdentitySha256,
  );
  if (protectedEndpoint !== undefined) {
    throw new SeederGuardError(
      'SEED_TARGET_PROTECTED_ENDPOINT',
      'Seeder target resolves to a protected database endpoint',
      { protectedEndpoint: protectedEndpoint.label },
    );
  }
}

async function safeQuery(
  client: H1SqlClient,
  text: string,
  stage: string,
): Promise<H1SqlQueryResult> {
  try {
    return await client.query(text);
  } catch {
    fail('H1_EXTERNAL_TARGET_PROBE_FAILED', stage);
  }
}

function retainedState(
  transaction: H1RetainedSeedTransaction,
  verifiedProfileExecution: H1VerifiedProfileExecutionAttestation,
): RetainedTransactionState {
  const state = retainedTransactions.get(transaction);
  if (
    state === undefined ||
    state.verifiedProfileExecution !== verifiedProfileExecution ||
    state.consumed ||
    state.cleanupRequested ||
    state.clientClosed ||
    !state.transactionOpen ||
    !isTrustedDisposableSeedTargetAttestation(
      state.seedTargetAttestation,
    )
  ) {
    fail(
      'H1_EXTERNAL_TARGET_TRANSACTION_INVALID',
      'retained-transaction',
    );
  }
  const verifiedTables = exactVerifiedH0GuardTables(
    verifiedProfileExecution,
  );
  if (
    verifiedTables.length !== transaction.lockedTables.length ||
    verifiedTables.some(
      (table, index) => table !== transaction.lockedTables[index],
    )
  ) {
    fail(
      'H1_EXTERNAL_TARGET_TRANSACTION_INVALID',
      'retained-table-set',
    );
  }
  return state;
}

export function assertRetainedSeedTransactionReady(
  transaction: H1RetainedSeedTransaction,
  verifiedProfileExecution: H1VerifiedProfileExecutionAttestation,
): void {
  retainedState(transaction, verifiedProfileExecution);
}

/**
 * Consumes the opaque retained transaction exactly once. Credential
 * separation is revalidated and consumes the one-shot H0 grant immediately
 * before the seeder receives the already-open transaction.
 */
export function consumeRetainedSeedTransaction(
  transaction: H1RetainedSeedTransaction,
  verifiedProfileExecution: H1VerifiedProfileExecutionAttestation,
): H1ConsumedRetainedSeedTransaction {
  const state = retainedState(transaction, verifiedProfileExecution);
  const measuredCredentials =
    assertSeedMeasuredCredentialSeparation({
      seedAdminUrl: state.seedAdminUrl,
      seedTargetAttestation: state.seedTargetAttestation,
      measured: state.measuredEnvironment,
    });
  state.consumed = true;
  event(state.ledger, 'database-probe-handoff');
  return Object.freeze({
    client: state.client,
    databaseName: transaction.databaseName,
    targetIdentitySha256: transaction.targetIdentitySha256,
    runId: transaction.runId,
    isolationLevel: transaction.isolationLevel,
    lockMode: transaction.lockMode,
    lockedTables: transaction.lockedTables,
    ownershipMarkerLocked: true,
    measuredCredentials,
  });
}

async function cleanupFailedProbe(
  client: H1SqlClient | undefined,
  transactionOpen: boolean,
): Promise<void> {
  if (client === undefined) return;
  let cleanupFailed = false;
  if (transactionOpen) {
    try {
      await client.query('ROLLBACK');
    } catch {
      cleanupFailed = true;
    }
  }
  try {
    await client.end();
  } catch {
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    fail(
      'H1_EXTERNAL_TARGET_CLIENT_CLOSE_FAILED',
      'failed-probe-cleanup',
    );
  }
}

/**
 * Performs every static H0, credential, and verified-source-plan check before
 * connecting. The live probe reads immutable database/cluster identity before
 * any transaction or lock, then begins one bounded SERIALIZABLE transaction,
 * pins search_path, takes write-excluding locks on the exact verified public
 * table set and ownership table, and retains them through seeder handoff.
 */
export async function probeExternalOwnedDisposableTarget(
  input: H1ExternalTargetProbeInput,
): Promise<H1ProbedExternalTarget> {
  if (
    input.protectedInventory.schemaVersion !== 1 ||
    !Array.isArray(input.protectedInventory.endpoints) ||
    typeof input.seedAdminUrl !== 'string' ||
    input.seedAdminUrl.length === 0 ||
    typeof input.runId !== 'string' ||
    input.runId.length === 0 ||
    input.runId !== input.runId.trim() ||
    !Number.isSafeInteger(input.probeTimeoutMs) ||
    input.probeTimeoutMs < 1 ||
    input.probeTimeoutMs > 300_000
  ) {
    fail('H1_EXTERNAL_TARGET_INPUT_INVALID', 'input');
  }
  const tables = exactVerifiedH0GuardTables(
    input.verifiedProfileExecution,
  );
  const expectedDatabaseName = databaseNameFromUrl(input.seedAdminUrl);
  const policy = createSeederGuardPolicy({
    protectedEndpoints: input.protectedInventory.endpoints,
  });

  // All checks that can run without a live observation are mandatory here.
  assertDisposableSeedTargetStatic(
    {
      targetDatabaseUrl: input.seedAdminUrl,
      acknowledgement: input.acknowledgement,
      runId: input.runId,
    },
    policy,
  );
  assertSeedMeasuredCredentialConfiguration({
    seedAdminUrl: input.seedAdminUrl,
    measured: input.measuredEnvironment,
  });

  let client: H1SqlClient | undefined;
  let transactionOpen = false;
  try {
    event(input.sideEffectLedger, 'database-probe-connect');
    client = await safeConnect(input);

    event(input.sideEffectLedger, 'database-probe-identity');
    const databaseName = oneString(
      (
        await safeQuery(
          client,
          'SELECT pg_catalog.current_database()::text AS database_name',
          'current-database',
        )
      ).rows,
      'database_name',
      'current-database',
    );
    if (databaseName !== expectedDatabaseName) {
      fail(
        'H1_EXTERNAL_TARGET_DATABASE_MISMATCH',
        'current-database',
      );
    }

    const systemIdentifier = oneString(
      (
        await safeQuery(
          client,
          'SELECT system_identifier::text AS system_identifier FROM pg_catalog.pg_control_system()',
          'cluster-identity',
        )
      ).rows,
      'system_identifier',
      'cluster-identity',
    );
    if (!/^[0-9]+$/u.test(systemIdentifier)) {
      fail(
        'H1_EXTERNAL_TARGET_CLUSTER_IDENTITY_INVALID',
        'cluster-identity',
      );
    }
    const observedClusterIdentitySha256 = sha256Hex(
      `${H1_CLUSTER_IDENTITY_HASH_FRAMING}${systemIdentifier}`,
    );
    assertObservedClusterIsNotProtected(
      observedClusterIdentitySha256,
      input.protectedInventory,
    );

    event(input.sideEffectLedger, 'database-probe-transaction');
    await safeQuery(
      client,
      `BEGIN ISOLATION LEVEL ${H1_RETAINED_TRANSACTION_ISOLATION}`,
      'transaction-begin',
    );
    transactionOpen = true;
    await safeQuery(
      client,
      'SET LOCAL search_path TO pg_catalog, public',
      'search-path',
    );
    await safeQuery(
      client,
      `SET LOCAL statement_timeout = ${input.probeTimeoutMs}`,
      'statement-timeout',
    );
    await safeQuery(
      client,
      `SET LOCAL lock_timeout = ${input.probeTimeoutMs}`,
      'lock-timeout',
    );

    const lockedTables = Object.freeze([...tables]);
    const lockTargets = [
      H1_OWNERSHIP_TABLE,
      ...lockedTables,
    ]
      .filter((table, index, all) => all.indexOf(table) === index)
      .sort()
      .map(quotePublicTable);
    event(input.sideEffectLedger, 'database-probe-lock');
    await safeQuery(
      client,
      `LOCK TABLE ${lockTargets.join(', ')} IN ${H1_RETAINED_TRANSACTION_LOCK_MODE} MODE`,
      'table-lock',
    );

    event(input.sideEffectLedger, 'database-probe-read');
    const ownership = (
      await safeQuery(
        client,
        `SELECT marker_kind::text AS marker_kind, ` +
          `run_id::text AS run_id, ` +
          `database_created_at::text AS database_created_at, ` +
          `marker_created_at::text AS marker_created_at ` +
          `FROM ${quotePublicTable(H1_OWNERSHIP_TABLE)} FOR UPDATE`,
        'ownership-marker',
      )
    ).rows;
    if (ownership.length !== 1) {
      fail(
        'H1_EXTERNAL_TARGET_OWNERSHIP_INVALID',
        'ownership-marker',
      );
    }
    const markerKind = oneString(
      ownership,
      'marker_kind',
      'ownership-marker',
    );
    const markerRunId = oneString(
      ownership,
      'run_id',
      'ownership-marker',
    );
    const databaseCreatedAt = oneString(
      ownership,
      'database_created_at',
      'ownership-marker',
    );
    const markerCreatedAt = oneString(
      ownership,
      'marker_created_at',
      'ownership-marker',
    );

    let existingSeedRecordCount = 0;
    for (const table of lockedTables) {
      const result = await safeQuery(
        client,
        `SELECT count(*)::text AS row_count FROM ${quotePublicTable(table)}`,
        `empty-readback:${table}`,
      );
      existingSeedRecordCount += parseCount(
        result.rows.length === 1
          ? result.rows[0]?.['row_count']
          : undefined,
        `empty-readback:${table}`,
      );
    }

    const seedTargetAttestation = assertDisposableSeedTarget(
      {
        targetDatabaseUrl: input.seedAdminUrl,
        acknowledgement: input.acknowledgement,
        runId: input.runId,
        databaseCreatedAt,
        existingSeedRecordCount,
        ownershipMarker: {
          markerKind,
          runId: markerRunId,
          createdAt: markerCreatedAt,
        },
        observedClusterIdentitySha256,
      },
      policy,
    );

    const transaction: H1RetainedSeedTransaction = Object.freeze({
      clientProvider: 'external-owned-postgresql',
      databaseName: seedTargetAttestation.databaseName,
      targetIdentitySha256:
        seedTargetAttestation.targetIdentitySha256,
      runId: seedTargetAttestation.runId,
      isolationLevel: H1_RETAINED_TRANSACTION_ISOLATION,
      lockMode: H1_RETAINED_TRANSACTION_LOCK_MODE,
      lockedTables,
      ownershipMarkerLocked: true,
    });
    const state: RetainedTransactionState = {
      client,
      seedAdminUrl: input.seedAdminUrl,
      measuredEnvironment: input.measuredEnvironment,
      seedTargetAttestation,
      verifiedProfileExecution: input.verifiedProfileExecution,
      ledger: input.sideEffectLedger,
      transactionOpen: true,
      clientClosed: false,
      consumed: false,
      cleanupRequested: false,
    };
    retainedTransactions.set(transaction, state);

    return Object.freeze({
      transaction,
      async closeIfUnconsumed(): Promise<void> {
        if (state.consumed || state.clientClosed) return;
        state.cleanupRequested = true;
        if (state.transactionOpen) {
          try {
            await state.client.query('ROLLBACK');
            state.transactionOpen = false;
          } catch {
            fail(
              'H1_EXTERNAL_TARGET_CLIENT_CLOSE_FAILED',
              'unconsumed-transaction-rollback',
            );
          }
        }
        try {
          await state.client.end();
          state.clientClosed = true;
        } catch {
          fail(
            'H1_EXTERNAL_TARGET_CLIENT_CLOSE_FAILED',
            'unconsumed-client-close',
          );
        }
      },
    });
  } catch (error) {
    try {
      await cleanupFailedProbe(client, transactionOpen);
    } catch (cleanupError) {
      throw cleanupError;
    }
    if (error instanceof H1ExternalTargetProbeError) throw error;
    throw error;
  }
}
