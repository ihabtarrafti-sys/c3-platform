import {
  canonicalJson,
  canonicalSha256,
  sha256Hex,
} from '../canonical.js';
import {
  type H1SqlClient,
  type H1SqlQueryResult,
} from './disposableDatabase.js';
import {
  assertRetainedSeedTransactionReady,
  consumeRetainedSeedTransaction,
  type H1ConsumedRetainedSeedTransaction,
  type H1RetainedSeedTransaction,
} from './externalTargetProbe.js';
import {
  resolveH1VerifiedPrimaryKeysByTable,
  resolveH1VerifiedSeedTableSet,
  type H1VerifiedProfileExecutionAttestation,
} from './sourcePlan.js';

export type H1TenantSlot = 'T01' | 'T02';
export type H1CorpusProfileId =
  | 'H3M.D0'
  | 'H3M.D1'
  | 'H3M.D2'
  | 'H3M.D3'
  | 'H3M.D4'
  | 'H3M.E1'
  | 'H3M.E2'
  | 'H3M.E3'
  | 'H3M.E4'
  | 'H3M.P1';

/**
 * Deliberately structural: the corpus planner and the authority validator can
 * both supply this shape without the database layer depending on either one.
 */
export interface H1DatabaseSeedRow {
  readonly rowId: string;
  readonly phase: number;
  readonly table: string;
  readonly tenantSlot: H1TenantSlot | null;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface H1MigrationPin {
  readonly path: string;
  readonly sha256: string;
}

export interface H1ExpectedSeedCount {
  readonly table: string;
  readonly tenantSlot: H1TenantSlot | null;
  readonly rowCount: number;
}

export type H1PrimaryKeysByTable = Readonly<
  Record<string, readonly string[]>
>;

export interface H1DatabaseSideEffectEvent {
  readonly sequence: number;
  readonly capability:
    | 'database-retained-transaction-consume'
    | 'database-commit';
}

export interface H1DatabaseSideEffectLedger {
  readonly attemptedEvents: H1DatabaseSideEffectEvent[];
}

export interface H1DatabaseSeedInput {
  /**
   * Opaque source-plan attestation and its already-open, one-shot retained
   * SERIALIZABLE transaction. The probe owns BEGIN/search_path/locks; this
   * layer owns the terminal COMMIT or ROLLBACK and client close.
   */
  readonly verifiedProfileExecution:
    H1VerifiedProfileExecutionAttestation;
  readonly retainedTransaction: H1RetainedSeedTransaction;
  readonly corpusProfileId: H1CorpusProfileId;
  /** Exact authority order; the seeder never sorts or groups these rows. */
  readonly authorityRows: readonly H1DatabaseSeedRow[];
  /**
   * Exact planner-supplied overlay order for one, and only one, profile.
   */
  readonly profileRows: readonly H1DatabaseSeedRow[];
  /**
   * Planner order, with nondecreasing phases after their dependencies. Rows are
   * batched only when adjacent phase/table/column shapes are equal.
   */
  readonly bulkRows: readonly H1DatabaseSeedRow[];
  readonly expectedCounts: readonly H1ExpectedSeedCount[];
  readonly migrationPins: readonly H1MigrationPin[];
  readonly statementTimeoutMs: number;
  readonly sideEffectLedger?: H1DatabaseSideEffectLedger;
}

export interface H1DatabaseSeedReceipt {
  readonly artifactKind: 'hearth-search-h1-database-seed-receipt';
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly corpusProfileId: H1CorpusProfileId;
  readonly profilePlanSha256: string;
  readonly authorityRowCount: 692;
  readonly profileRowCount: 0 | 2 | 14 | 16;
  readonly bulkRowCount: number;
  readonly totalRowCount: number;
  readonly reconciledCountPartitionCount: number;
  readonly targetBindingSha256: string;
  readonly authorityRowsSha256: string;
  readonly profileRowsSha256: string;
  readonly profileReadbackSha256: string;
  readonly framedReadbackSha256: string;
  readonly readbackRowCount: number;
  readonly bulkRowsSha256: string;
  readonly migrationLedgerSha256: string;
  readonly reconciledCountsSha256: string;
  readonly corpusSha256: string;
}

export type H1DatabaseSeedFailureCode =
  | 'H1_DATABASE_AUTHORITY_ROW_COUNT_INVALID'
  | 'H1_DATABASE_COUNT_MISMATCH'
  | 'H1_DATABASE_EXPECTED_COUNTS_INVALID'
  | 'H1_DATABASE_IDENTIFIER_INVALID'
  | 'H1_DATABASE_INSERT_COUNT_MISMATCH'
  | 'H1_DATABASE_INPUT_INVALID'
  | 'H1_DATABASE_MIGRATION_LEDGER_MISMATCH'
  | 'H1_DATABASE_OPERATION_FAILED'
  | 'H1_DATABASE_PROFILE_INVALID'
  | 'H1_DATABASE_READBACK_MISMATCH'
  | 'H1_DATABASE_RECEIPT_UNTRUSTED'
  | 'H1_DATABASE_STATEMENT_TIMEOUT_57014';

export class H1DatabaseSeedError extends Error {
  constructor(
    readonly code: H1DatabaseSeedFailureCode,
    readonly stage: string,
    readonly sqlState: string | null = null,
    readonly rolledBack: boolean | null = null,
  ) {
    super(`${code}: database seed stopped during ${stage}`);
    this.name = 'H1DatabaseSeedError';
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MIGRATION_ID = /^[0-9]{4}_[a-z0-9_]+\.sql$/u;
const MAX_AUTHORITY_ROWS = 692;
const EXPECTED_MIGRATION_COUNT = 95;
const MAX_PARAMETERS_PER_INSERT = 60_000;
const MAX_ROWS_PER_INSERT = 500;
const PROFILE_TABLE_PRIMARY_KEYS = Object.freeze({
  delegation: Object.freeze(['id']),
  tenant_module_entitlement: Object.freeze([
    'tenant_id',
    'module_key',
  ]),
  comms_thread_participant: Object.freeze([
    'tenant_id',
    'thread_id',
    'user_id',
  ]),
} satisfies Readonly<Record<string, readonly string[]>>);
const PROFILE_TABLES = new Set(
  Object.keys(PROFILE_TABLE_PRIMARY_KEYS),
);
const CORPUS_PROFILE_IDS = new Set<H1CorpusProfileId>([
  'H3M.D0',
  'H3M.D1',
  'H3M.D2',
  'H3M.D3',
  'H3M.D4',
  'H3M.E1',
  'H3M.E2',
  'H3M.E3',
  'H3M.E4',
  'H3M.P1',
]);
const trustedH1DatabaseSeedReceipts = new WeakMap<
  H1DatabaseSeedReceipt,
  {
    readonly snapshot: string;
    readonly verifiedProfileExecution:
      H1VerifiedProfileExecutionAttestation;
    readonly retainedTransaction: H1RetainedSeedTransaction;
  }
>();
const RECEIPT_KEYS = Object.freeze(
  [
    'artifactKind',
    'measurementStatus',
    'corpusProfileId',
    'profilePlanSha256',
    'authorityRowCount',
    'profileRowCount',
    'bulkRowCount',
    'totalRowCount',
    'reconciledCountPartitionCount',
    'targetBindingSha256',
    'authorityRowsSha256',
    'profileRowsSha256',
    'profileReadbackSha256',
    'framedReadbackSha256',
    'readbackRowCount',
    'bulkRowsSha256',
    'migrationLedgerSha256',
    'reconciledCountsSha256',
    'corpusSha256',
  ].sort(),
);
const RECEIPT_HASH_KEYS = Object.freeze([
  'profilePlanSha256',
  'targetBindingSha256',
  'authorityRowsSha256',
  'profileRowsSha256',
  'profileReadbackSha256',
  'framedReadbackSha256',
  'bulkRowsSha256',
  'migrationLedgerSha256',
  'reconciledCountsSha256',
  'corpusSha256',
] satisfies readonly (keyof H1DatabaseSeedReceipt)[]);

/**
 * Hard trust boundary for consumers that can emit PASS. Structural lookalikes,
 * JSON round-trips, and frozen clones are rejected: only the exact object
 * created after a successful COMMIT is branded.
 */
export function assertTrustedH1DatabaseSeedReceipt(
  value: unknown,
): asserts value is H1DatabaseSeedReceipt {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail('H1_DATABASE_RECEIPT_UNTRUSTED', 'receipt-brand');
  }
  const receipt = value as H1DatabaseSeedReceipt;
  const state = trustedH1DatabaseSeedReceipts.get(receipt);
  if (state === undefined) {
    fail('H1_DATABASE_RECEIPT_UNTRUSTED', 'receipt-brand');
  }
  const keys = Object.keys(receipt).sort();
  const expectedProfileRows =
    receipt.corpusProfileId === 'H3M.D0'
      ? 0
      : receipt.corpusProfileId.startsWith('H3M.D')
        ? 14
        : receipt.corpusProfileId.startsWith('H3M.E')
          ? 2
          : receipt.corpusProfileId === 'H3M.P1'
            ? 16
            : -1;
  if (
    !Object.isFrozen(receipt) ||
    keys.length !== RECEIPT_KEYS.length ||
    keys.some((key, index) => key !== RECEIPT_KEYS[index]) ||
    receipt.artifactKind !==
      'hearth-search-h1-database-seed-receipt' ||
    receipt.measurementStatus !== 'NOT_YET_MEASURED' ||
    !CORPUS_PROFILE_IDS.has(receipt.corpusProfileId) ||
    receipt.authorityRowCount !== 692 ||
    receipt.profileRowCount !== expectedProfileRows ||
    !Number.isSafeInteger(receipt.bulkRowCount) ||
    receipt.bulkRowCount < 0 ||
    receipt.totalRowCount !==
      receipt.authorityRowCount +
        receipt.profileRowCount +
        receipt.bulkRowCount ||
    !Number.isSafeInteger(receipt.reconciledCountPartitionCount) ||
    receipt.reconciledCountPartitionCount < 1 ||
    receipt.readbackRowCount !== receipt.totalRowCount ||
    RECEIPT_HASH_KEYS.some(
      (key) =>
        typeof receipt[key] !== 'string' ||
        !SHA256.test(receipt[key] as string),
    ) ||
    receipt.corpusSha256 !==
      canonicalSha256({
        profilePlanSha256: receipt.profilePlanSha256,
        authorityRowsSha256: receipt.authorityRowsSha256,
        corpusProfileId: receipt.corpusProfileId,
        profileRowsSha256: receipt.profileRowsSha256,
        profileReadbackSha256: receipt.profileReadbackSha256,
        framedReadbackSha256: receipt.framedReadbackSha256,
        bulkRowsSha256: receipt.bulkRowsSha256,
        expectedCountsSha256: receipt.reconciledCountsSha256,
        migrationLedgerSha256: receipt.migrationLedgerSha256,
      }) ||
    canonicalSha256(receipt) !== state.snapshot
  ) {
    fail('H1_DATABASE_RECEIPT_UNTRUSTED', 'receipt-invariants');
  }
}

/**
 * Binds a trusted receipt to the exact opaque profile attestation and retained
 * transaction that produced it. A real receipt from another profile, target,
 * or run cannot be replayed into a new PASS.
 */
export function assertTrustedH1DatabaseSeedReceiptForExecution(
  value: unknown,
  verifiedProfileExecution:
    H1VerifiedProfileExecutionAttestation,
  retainedTransaction: H1RetainedSeedTransaction,
): asserts value is H1DatabaseSeedReceipt {
  assertTrustedH1DatabaseSeedReceipt(value);
  const state = trustedH1DatabaseSeedReceipts.get(value);
  if (
    state === undefined ||
    state.verifiedProfileExecution !== verifiedProfileExecution ||
    state.retainedTransaction !== retainedTransaction
  ) {
    fail(
      'H1_DATABASE_RECEIPT_UNTRUSTED',
      'receipt-execution',
    );
  }
}

interface ProfileReadbackProbe {
  readonly rowId: string;
  readonly table: keyof typeof PROFILE_TABLE_PRIMARY_KEYS;
  readonly columns: readonly string[];
  readonly values: readonly unknown[];
}

interface TableReadbackRowPlan {
  readonly rowId: string;
  readonly shapeId: string;
  readonly columns: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}

interface TableReadbackPlan {
  readonly table: string;
  readonly primaryKeys: readonly string[];
  readonly rows: readonly TableReadbackRowPlan[];
}

interface InsertedRowCapture {
  readonly table: string;
  readonly shapeId: string;
  readonly columns: readonly string[];
  /** PostgreSQL-owned projection of every explicitly supplied column. */
  readonly suppliedJson: string;
  /** PostgreSQL-owned manifest-PK projection as canonical jsonb text. */
  readonly keyJson: string;
}

type InsertedRowsByTable = Map<string, InsertedRowCapture[]>;

interface ValidatedInputs {
  readonly authorityRows: readonly H1DatabaseSeedRow[];
  readonly profileRows: readonly H1DatabaseSeedRow[];
  readonly bulkRows: readonly H1DatabaseSeedRow[];
  readonly corpusProfileId: H1CorpusProfileId;
  readonly expectedCounts: readonly H1ExpectedSeedCount[];
  readonly expectedByKey: ReadonlyMap<string, number>;
  readonly expectedTableTotals: ReadonlyMap<string, number>;
  readonly tenantIds: Readonly<Record<H1TenantSlot, string>>;
  readonly migrationLedger: readonly {
    readonly id: string;
    readonly checksum: string;
  }[];
  readonly authorityRowsSha256: string;
  readonly profileRowsSha256: string;
  readonly bulkRowsSha256: string;
  readonly migrationLedgerSha256: string;
  readonly expectedCountsSha256: string;
  readonly profileReadbackProbes: readonly ProfileReadbackProbe[];
  readonly profileReadbackSha256: string;
  readonly tableReadbackPlans: readonly TableReadbackPlan[];
}

function fail(
  code: H1DatabaseSeedFailureCode,
  stage: string,
): never {
  throw new H1DatabaseSeedError(code, stage);
}

function safeIdentifier(value: string, stage: string): string {
  if (value.length > 63 || !IDENTIFIER.test(value)) {
    fail('H1_DATABASE_IDENTIFIER_INVALID', stage);
  }
  return value;
}

function quoteIdentifier(value: string, stage: string): string {
  return `"${safeIdentifier(value, stage)}"`;
}

function quotePublicTable(value: string, stage: string): string {
  return `public.${quoteIdentifier(value, stage)}`;
}

function countKey(
  table: string,
  tenantSlot: H1TenantSlot | null,
): string {
  return `${table}\0${tenantSlot ?? 'GLOBAL'}`;
}

function migrationId(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const id = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (!MIGRATION_ID.test(id)) {
    fail('H1_DATABASE_INPUT_INVALID', 'migration-pins');
  }
  return id;
}

function plainValues(
  value: Readonly<Record<string, unknown>>,
  stage: string,
): void {
  if (
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length === 0
  ) {
    fail('H1_DATABASE_INPUT_INVALID', stage);
  }
  for (const column of Object.keys(value)) {
    safeIdentifier(column, stage);
  }
  /*
   * Canonicalization rejects accessors, symbols, custom serialization,
   * undefined, cycles, and non-finite numbers before a database event.
   */
  canonicalSha256(value);
}

function validateRows(
  rows: readonly H1DatabaseSeedRow[],
  kind: 'authority' | 'profile' | 'bulk',
  allRowIds: Set<string>,
): void {
  let priorPhase = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const stage = `${kind}-rows`;
    if (
      typeof row.rowId !== 'string' ||
      row.rowId.length === 0 ||
      row.rowId !== row.rowId.trim() ||
      !Number.isSafeInteger(row.phase) ||
      row.phase < 0 ||
      row.phase < priorPhase ||
      (row.tenantSlot !== null &&
        row.tenantSlot !== 'T01' &&
        row.tenantSlot !== 'T02')
    ) {
      fail('H1_DATABASE_INPUT_INVALID', stage);
    }
    safeIdentifier(row.table, stage);
    plainValues(row.values, stage);
    if (allRowIds.has(row.rowId)) {
      fail('H1_DATABASE_INPUT_INVALID', 'duplicate-row-id');
    }
    allRowIds.add(row.rowId);
    priorPhase = row.phase;
  }
}

function validateProfileRows(
  corpusProfileId: H1CorpusProfileId,
  rows: readonly H1DatabaseSeedRow[],
): void {
  const expectedCount =
    corpusProfileId === 'H3M.D0'
      ? 0
      : corpusProfileId.startsWith('H3M.D')
        ? 14
        : corpusProfileId.startsWith('H3M.E')
          ? 2
          : 16;
  if (rows.length !== expectedCount) {
    fail('H1_DATABASE_PROFILE_INVALID', 'profile-row-count');
  }

  const delegationRows = rows.filter(
    (row) => row.phase === 55 && row.table === 'delegation',
  );
  const entitlementRows = rows.filter(
    (row) =>
      row.phase === 55 &&
      row.table === 'tenant_module_entitlement',
  );
  const participantRows = rows.filter(
    (row) =>
      row.phase === 65 &&
      row.table === 'comms_thread_participant',
  );
  if (
    delegationRows.length +
      entitlementRows.length +
      participantRows.length !==
    rows.length
  ) {
    fail('H1_DATABASE_PROFILE_INVALID', 'profile-row-shape');
  }
  if (rows.some((row) => row.tenantSlot === null)) {
    fail('H1_DATABASE_PROFILE_INVALID', 'profile-tenant-partition');
  }

  const assertTenantPartition = (
    selected: readonly H1DatabaseSeedRow[],
    each: number,
    stage: string,
  ): void => {
    const counts = { T01: 0, T02: 0 };
    for (const row of selected) {
      if (row.tenantSlot === null) {
        fail('H1_DATABASE_PROFILE_INVALID', stage);
      }
      counts[row.tenantSlot] += 1;
    }
    if (counts.T01 !== each || counts.T02 !== each) {
      fail('H1_DATABASE_PROFILE_INVALID', stage);
    }
  };

  if (corpusProfileId === 'H3M.D0') {
    return;
  }
  if (corpusProfileId.startsWith('H3M.D')) {
    if (
      delegationRows.length !== 14 ||
      entitlementRows.length !== 0 ||
      participantRows.length !== 0
    ) {
      fail('H1_DATABASE_PROFILE_INVALID', 'profile-row-shape');
    }
    assertTenantPartition(
      delegationRows,
      7,
      'profile-tenant-partition',
    );
    const delegationState = corpusProfileId.slice('H3M.'.length);
    if (
      delegationRows.some(
        (row) => !row.rowId.endsWith(`.${delegationState}.row`),
      )
    ) {
      fail(
        'H1_DATABASE_PROFILE_INVALID',
        'profile-state-binding',
      );
    }
    return;
  }
  if (corpusProfileId.startsWith('H3M.E')) {
    if (
      delegationRows.length !== 0 ||
      entitlementRows.length !== 2 ||
      participantRows.length !== 0
    ) {
      fail('H1_DATABASE_PROFILE_INVALID', 'profile-row-shape');
    }
    assertTenantPartition(
      entitlementRows,
      1,
      'profile-tenant-partition',
    );
    const entitlementState = corpusProfileId.slice('H3M.'.length);
    if (
      entitlementRows.some(
        (row) => !row.rowId.endsWith(`.${entitlementState}.row`),
      )
    ) {
      fail(
        'H1_DATABASE_PROFILE_INVALID',
        'profile-state-binding',
      );
    }
    return;
  }

  if (
    corpusProfileId !== 'H3M.P1' ||
    delegationRows.length !== 0 ||
    entitlementRows.length !== 2 ||
    participantRows.length !== 14
  ) {
    fail('H1_DATABASE_PROFILE_INVALID', 'profile-row-shape');
  }
  assertTenantPartition(
    entitlementRows,
    1,
    'profile-entitlement-tenant-partition',
  );
  assertTenantPartition(
    participantRows,
    7,
    'profile-participant-tenant-partition',
  );
  if (
    entitlementRows.some(
      (row) => !row.rowId.endsWith('.E1.row'),
    ) ||
    participantRows.some(
      (row) => !/\.P1(?:\.[^.]+)?\.row$/u.test(row.rowId),
    )
  ) {
    fail('H1_DATABASE_PROFILE_INVALID', 'profile-state-binding');
  }
}

function buildProfileReadbackProbes(
  rows: readonly H1DatabaseSeedRow[],
): {
  readonly probes: readonly ProfileReadbackProbe[];
  readonly sha256: string;
} {
  const probes = rows.map((row) => {
    if (!(row.table in PROFILE_TABLE_PRIMARY_KEYS)) {
      fail('H1_DATABASE_PROFILE_INVALID', 'profile-readback-table');
    }
    const table =
      row.table as keyof typeof PROFILE_TABLE_PRIMARY_KEYS;
    const columns = PROFILE_TABLE_PRIMARY_KEYS[table];
    const values = columns.map((column) => {
      if (
        !Object.prototype.hasOwnProperty.call(row.values, column) ||
        row.values[column] === null ||
        row.values[column] === undefined
      ) {
        fail(
          'H1_DATABASE_PROFILE_INVALID',
          'profile-readback-primary-key',
        );
      }
      return row.values[column];
    });
    return Object.freeze({
      rowId: row.rowId,
      table,
      columns,
      values: Object.freeze(values),
    });
  });
  const identities = probes.map((probe) =>
    canonicalSha256({
      columns: probe.columns,
      table: probe.table,
      values: probe.values,
    }),
  );
  if (new Set(identities).size !== identities.length) {
    fail(
      'H1_DATABASE_PROFILE_INVALID',
      'profile-readback-primary-key-duplicate',
    );
  }
  const tableCounts = Object.fromEntries(
    Object.keys(PROFILE_TABLE_PRIMARY_KEYS)
      .sort()
      .map((table) => [
        table,
        rows.filter((row) => row.table === table).length,
      ]),
  );
  return Object.freeze({
    probes: Object.freeze(probes),
    sha256: canonicalSha256({
      probes,
      tableCounts,
    }),
  });
}

function buildTableReadbackPlans(
  rows: readonly H1DatabaseSeedRow[],
  primaryKeysByTable: H1PrimaryKeysByTable,
): readonly TableReadbackPlan[] {
  if (
    primaryKeysByTable === null ||
    Array.isArray(primaryKeysByTable) ||
    (Object.getPrototypeOf(primaryKeysByTable) !== Object.prototype &&
      Object.getPrototypeOf(primaryKeysByTable) !== null)
  ) {
    fail('H1_DATABASE_INPUT_INVALID', 'primary-key-map');
  }

  const rowsByTable = new Map<string, H1DatabaseSeedRow[]>();
  for (const row of rows) {
    const tableRows = rowsByTable.get(row.table) ?? [];
    tableRows.push(row);
    rowsByTable.set(row.table, tableRows);
  }
  const plannedTables = [...rowsByTable.keys()].sort();
  const mappedTables = Object.keys(primaryKeysByTable).sort();
  if (
    plannedTables.length !== mappedTables.length ||
    plannedTables.some(
      (table, index) => table !== mappedTables[index],
    )
  ) {
    fail(
      'H1_DATABASE_INPUT_INVALID',
      'primary-key-map-coverage',
    );
  }

  return Object.freeze(
    plannedTables.map((table) => {
      const primaryKeys = primaryKeysByTable[table];
      if (
        !Array.isArray(primaryKeys) ||
        primaryKeys.length === 0 ||
        new Set(primaryKeys).size !== primaryKeys.length
      ) {
        fail(
          'H1_DATABASE_INPUT_INVALID',
          'primary-key-map-columns',
        );
      }
      for (const column of primaryKeys) {
        safeIdentifier(column, 'primary-key-map-columns');
      }

      const tableRows = rowsByTable.get(table)!;
      const readbackRows = tableRows.map((row) => {
        const columns = Object.freeze(Object.keys(row.values).sort());
        return Object.freeze({
          rowId: row.rowId,
          shapeId: canonicalSha256(columns),
          columns,
          values: row.values,
        });
      });
      return Object.freeze({
        table,
        primaryKeys: Object.freeze([...primaryKeys]),
        rows: Object.freeze(readbackRows),
      });
    }),
  );
}

function deriveTenantIds(
  authorityRows: readonly H1DatabaseSeedRow[],
): Readonly<Record<H1TenantSlot, string>> {
  const tenantIds: Partial<Record<H1TenantSlot, string>> = {};
  for (const row of authorityRows) {
    if (row.table !== 'tenant' || row.tenantSlot === null) continue;
    const id = row.values['id'];
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      tenantIds[row.tenantSlot] !== undefined
    ) {
      fail('H1_DATABASE_INPUT_INVALID', 'tenant-id-bindings');
    }
    tenantIds[row.tenantSlot] = id;
  }
  if (tenantIds.T01 === undefined || tenantIds.T02 === undefined) {
    fail('H1_DATABASE_INPUT_INVALID', 'tenant-id-bindings');
  }
  return Object.freeze({
    T01: tenantIds.T01,
    T02: tenantIds.T02,
  });
}

function observedPlannedCounts(
  rows: readonly H1DatabaseSeedRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = countKey(row.table, row.tenantSlot);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function compareExpectedCountEntries(
  left: H1ExpectedSeedCount,
  right: H1ExpectedSeedCount,
): number {
  const byTable = left.table.localeCompare(right.table, 'en');
  if (byTable !== 0) return byTable;
  return (left.tenantSlot ?? '').localeCompare(
    right.tenantSlot ?? '',
    'en',
  );
}

function validateExpectedCounts(
  expectedCounts: readonly H1ExpectedSeedCount[],
  planned: ReadonlyMap<string, number>,
): {
  readonly normalized: readonly H1ExpectedSeedCount[];
  readonly byKey: ReadonlyMap<string, number>;
  readonly tableTotals: ReadonlyMap<string, number>;
} {
  const byKey = new Map<string, number>();
  const tablesWithGlobal = new Set<string>();
  const tablesWithTenant = new Set<string>();
  for (const expected of expectedCounts) {
    safeIdentifier(expected.table, 'expected-counts');
    if (
      (expected.tenantSlot !== null &&
        expected.tenantSlot !== 'T01' &&
        expected.tenantSlot !== 'T02') ||
      !Number.isSafeInteger(expected.rowCount) ||
      expected.rowCount < 0
    ) {
      fail(
        'H1_DATABASE_EXPECTED_COUNTS_INVALID',
        'expected-counts',
      );
    }
    const key = countKey(expected.table, expected.tenantSlot);
    if (byKey.has(key)) {
      fail(
        'H1_DATABASE_EXPECTED_COUNTS_INVALID',
        'expected-counts-duplicate',
      );
    }
    byKey.set(key, expected.rowCount);
    (expected.tenantSlot === null
      ? tablesWithGlobal
      : tablesWithTenant
    ).add(expected.table);
  }

  if (
    [...tablesWithGlobal].some((table) =>
      tablesWithTenant.has(table),
    )
  ) {
    fail(
      'H1_DATABASE_EXPECTED_COUNTS_INVALID',
      'expected-counts-global-tenant-mix',
    );
  }
  if (
    planned.size !== byKey.size ||
    [...planned].some(
      ([key, value]) => byKey.get(key) !== value,
    )
  ) {
    fail(
      'H1_DATABASE_EXPECTED_COUNTS_INVALID',
      'expected-counts-reconciliation',
    );
  }

  const tableTotals = new Map<string, number>();
  for (const expected of expectedCounts) {
    tableTotals.set(
      expected.table,
      (tableTotals.get(expected.table) ?? 0) + expected.rowCount,
    );
  }
  const normalized = [...expectedCounts].sort(
    compareExpectedCountEntries,
  );
  return {
    normalized: Object.freeze(normalized),
    byKey,
    tableTotals,
  };
}

function validateMigrationPins(
  pins: readonly H1MigrationPin[],
): readonly { readonly id: string; readonly checksum: string }[] {
  if (pins.length !== EXPECTED_MIGRATION_COUNT) {
    fail('H1_DATABASE_INPUT_INVALID', 'migration-pin-count');
  }
  const result = pins.map((pin) => {
    if (!SHA256.test(pin.sha256)) {
      fail('H1_DATABASE_INPUT_INVALID', 'migration-pin-sha256');
    }
    return Object.freeze({
      id: migrationId(pin.path),
      checksum: pin.sha256,
    });
  });
  const ids = result.map((entry) => entry.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some(
      (id, index) =>
        index > 0 && id.localeCompare(ids[index - 1]!, 'en') <= 0,
    )
  ) {
    fail('H1_DATABASE_INPUT_INVALID', 'migration-pin-order');
  }
  return Object.freeze(result);
}

export interface H1DatabaseSeedReceiptBinding {
  readonly corpusProfileId: H1CorpusProfileId;
  readonly profilePlanSha256: string;
  readonly authorityRowCount: number;
  readonly profileRowCount: number;
  readonly bulkRowCount: number;
  readonly totalRowCount: number;
  readonly reconciledCountPartitionCount: number;
  readonly targetBindingSha256: string;
  readonly authorityRowsSha256: string;
  readonly profileRowsSha256: string;
  readonly bulkRowsSha256: string;
  readonly migrationLedgerSha256: string;
  readonly reconciledCountsSha256: string;
}

/**
 * One shared plan/target binding for receipt production and the CLI PASS
 * consumer. Keeping this derivation shared prevents the producer and consumer
 * from silently agreeing on different normalization rules.
 */
export function buildH1DatabaseSeedReceiptBinding(
  input: Pick<
    H1DatabaseSeedInput,
    | 'authorityRows'
    | 'bulkRows'
    | 'corpusProfileId'
    | 'expectedCounts'
    | 'migrationPins'
    | 'profileRows'
    | 'retainedTransaction'
    | 'verifiedProfileExecution'
  >,
): H1DatabaseSeedReceiptBinding {
  const normalizedCounts = [...input.expectedCounts].sort(
    compareExpectedCountEntries,
  );
  const migrationLedger = validateMigrationPins(
    input.migrationPins,
  );
  return Object.freeze({
    corpusProfileId: input.corpusProfileId,
    profilePlanSha256:
      input.verifiedProfileExecution.profilePlanSha256,
    authorityRowCount: input.authorityRows.length,
    profileRowCount: input.profileRows.length,
    bulkRowCount: input.bulkRows.length,
    totalRowCount:
      input.authorityRows.length +
      input.profileRows.length +
      input.bulkRows.length,
    reconciledCountPartitionCount: normalizedCounts.length,
    targetBindingSha256: canonicalSha256({
      runId: input.retainedTransaction.runId,
      targetIdentitySha256:
        input.retainedTransaction.targetIdentitySha256,
    }),
    authorityRowsSha256: canonicalSha256(input.authorityRows),
    profileRowsSha256: canonicalSha256(input.profileRows),
    bulkRowsSha256: canonicalSha256(input.bulkRows),
    migrationLedgerSha256: canonicalSha256(migrationLedger),
    reconciledCountsSha256: canonicalSha256(normalizedCounts),
  });
}

function validateInput(input: H1DatabaseSeedInput): ValidatedInputs {
  if (
    !Number.isSafeInteger(input.statementTimeoutMs) ||
    input.statementTimeoutMs < 1 ||
    input.statementTimeoutMs > 60 * 60 * 1_000
  ) {
    fail('H1_DATABASE_INPUT_INVALID', 'statement-timeout');
  }
  if (input.authorityRows.length !== MAX_AUTHORITY_ROWS) {
    fail(
      'H1_DATABASE_AUTHORITY_ROW_COUNT_INVALID',
      'authority-row-count',
    );
  }

  const allRowIds = new Set<string>();
  validateRows(input.authorityRows, 'authority', allRowIds);
  if (
    input.authorityRows.some((row) => PROFILE_TABLES.has(row.table))
  ) {
    fail(
      'H1_DATABASE_PROFILE_INVALID',
      'authority-profile-table-contamination',
    );
  }
  if (!CORPUS_PROFILE_IDS.has(input.corpusProfileId)) {
    fail('H1_DATABASE_PROFILE_INVALID', 'corpus-profile-id');
  }
  validateRows(input.profileRows, 'profile', allRowIds);
  validateProfileRows(input.corpusProfileId, input.profileRows);
  validateRows(input.bulkRows, 'bulk', allRowIds);
  if (input.bulkRows.some((row) => PROFILE_TABLES.has(row.table))) {
    fail(
      'H1_DATABASE_PROFILE_INVALID',
      'bulk-profile-table-contamination',
    );
  }
  const profilePhases = new Set(
    input.profileRows.map((row) => row.phase),
  );
  if (
    input.authorityRows.some((row) => profilePhases.has(row.phase))
  ) {
    fail(
      'H1_DATABASE_PROFILE_INVALID',
      'authority-profile-phase-collision',
    );
  }
  const profileReadback = buildProfileReadbackProbes(
    input.profileRows,
  );
  const tenantIds = deriveTenantIds(input.authorityRows);
  const plannedRows = [
    ...input.authorityRows,
    ...input.profileRows,
    ...input.bulkRows,
  ];
  const plannedCounts = observedPlannedCounts(plannedRows);
  const primaryKeysByTable =
    resolveH1VerifiedPrimaryKeysByTable(
      input.verifiedProfileExecution,
    );
  const tableReadbackPlans = buildTableReadbackPlans(
    plannedRows,
    primaryKeysByTable,
  );
  if (
    input.verifiedProfileExecution.corpusProfileId !==
    input.corpusProfileId
  ) {
    fail(
      'H1_DATABASE_PROFILE_INVALID',
      'verified-profile-execution-binding',
    );
  }
  const verifiedSeedTables = [
    ...resolveH1VerifiedSeedTableSet(
      input.verifiedProfileExecution,
    ),
  ].sort();
  const plannedTables = tableReadbackPlans
    .map(({ table }) => table)
    .sort();
  if (
    verifiedSeedTables.length !== plannedTables.length ||
    verifiedSeedTables.some(
      (table, index) => table !== plannedTables[index],
    )
  ) {
    fail(
      'H1_DATABASE_INPUT_INVALID',
      'verified-seed-table-set',
    );
  }
  const expected = validateExpectedCounts(
    input.expectedCounts,
    plannedCounts,
  );
  const migrationLedger = validateMigrationPins(input.migrationPins);

  /*
   * This is the last readiness check in the pre-side-effect pass. It neither
   * consumes the one-shot transaction nor touches its live client.
   */
  assertRetainedSeedTransactionReady(
    input.retainedTransaction,
    input.verifiedProfileExecution,
  );
  const lockedTables = new Set(input.retainedTransaction.lockedTables);
  if (plannedTables.some((table) => !lockedTables.has(table))) {
    fail(
      'H1_DATABASE_INPUT_INVALID',
      'retained-lock-table-coverage',
    );
  }

  return Object.freeze({
    authorityRows: input.authorityRows,
    profileRows: input.profileRows,
    bulkRows: input.bulkRows,
    corpusProfileId: input.corpusProfileId,
    expectedCounts: expected.normalized,
    expectedByKey: expected.byKey,
    expectedTableTotals: expected.tableTotals,
    tenantIds,
    migrationLedger,
    authorityRowsSha256: canonicalSha256(input.authorityRows),
    profileRowsSha256: canonicalSha256(input.profileRows),
    bulkRowsSha256: canonicalSha256(input.bulkRows),
    migrationLedgerSha256: canonicalSha256(migrationLedger),
    expectedCountsSha256: canonicalSha256(expected.normalized),
    profileReadbackProbes: profileReadback.probes,
    profileReadbackSha256: profileReadback.sha256,
    tableReadbackPlans,
  });
}

function sqlState(error: unknown): string | null {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return null;
}

function translateDatabaseError(
  error: unknown,
  stage: string,
  rolledBack: boolean | null,
): H1DatabaseSeedError {
  if (error instanceof H1DatabaseSeedError) {
    return new H1DatabaseSeedError(
      error.code,
      error.stage,
      error.sqlState,
      rolledBack,
    );
  }
  const state = sqlState(error);
  if (state === '57014') {
    return new H1DatabaseSeedError(
      'H1_DATABASE_STATEMENT_TIMEOUT_57014',
      stage,
      '57014',
      rolledBack,
    );
  }
  return new H1DatabaseSeedError(
    'H1_DATABASE_OPERATION_FAILED',
    stage,
    state,
    rolledBack,
  );
}

function jsonbProjectionForAlias(
  alias: string,
  columns: readonly string[],
  stage:
    | 'authority-insert'
    | 'profile-insert'
    | 'bulk-insert'
    | 'catalog-readback',
): string {
  const safeAlias = safeIdentifier(alias, stage);
  const literals = columns
    .map((column) => `'${safeIdentifier(column, stage)}'`)
    .join(', ');
  return (
    `(SELECT jsonb_object_agg(entry.key, entry.value ` +
    `ORDER BY entry.key)::text ` +
    `FROM jsonb_each(to_jsonb(${safeAlias})) AS entry ` +
    `WHERE entry.key = ANY (ARRAY[${literals}]::text[]))`
  );
}

function insertStatement(
  row: H1DatabaseSeedRow,
  primaryKeys: readonly string[],
  stage: 'authority-insert' | 'profile-insert',
): {
  readonly text: string;
  readonly values: readonly unknown[];
} {
  const columns = Object.keys(row.values).sort();
  return {
    text:
      `WITH inserted_row AS (` +
      `INSERT INTO ${quotePublicTable(row.table, stage)}` +
      ` (${columns
        .map((column) =>
          quoteIdentifier(column, stage),
        )
        .join(', ')}) VALUES (${columns
        .map((_, index) => `$${index + 1}`)
        .join(', ')}) RETURNING *) ` +
      `SELECT ${jsonbProjectionForAlias(
        'inserted_row',
        columns,
        stage,
      )} AS supplied_json, ` +
      `${jsonbProjectionForAlias(
        'inserted_row',
        primaryKeys,
        stage,
      )} AS key_json FROM inserted_row`,
    values: columns.map((column) => row.values[column]),
  };
}

function assertReturnedPrimaryKey(
  keyJson: string,
  primaryKeys: readonly string[],
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(keyJson);
  } catch {
    fail(
      'H1_DATABASE_READBACK_MISMATCH',
      'insert-returning-primary-key',
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    fail(
      'H1_DATABASE_READBACK_MISMATCH',
      'insert-returning-primary-key',
    );
  }
  const object = parsed as Readonly<Record<string, unknown>>;
  const keys = Object.keys(object).sort();
  const expected = [...primaryKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    primaryKeys.some(
      (key) => object[key] === null || object[key] === undefined,
    )
  ) {
    fail(
      'H1_DATABASE_READBACK_MISMATCH',
      'insert-returning-primary-key',
    );
  }
}

function assertReturnedProjection(
  suppliedJson: string,
  columns: readonly string[],
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(suppliedJson);
  } catch {
    fail(
      'H1_DATABASE_READBACK_MISMATCH',
      'insert-returning-projection',
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    fail(
      'H1_DATABASE_READBACK_MISMATCH',
      'insert-returning-projection',
    );
  }
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== columns.length ||
    keys.some((key, index) => key !== columns[index])
  ) {
    fail(
      'H1_DATABASE_READBACK_MISMATCH',
      'insert-returning-projection',
    );
  }
}

function captureInsertedRows(
  result: H1SqlQueryResult,
  table: string,
  columns: readonly string[],
  primaryKeys: readonly string[],
  expectedCount: number,
  captures: InsertedRowsByTable,
  stage:
    | 'authority-insert'
    | 'profile-insert'
    | 'bulk-insert',
): void {
  if (
    result.rowCount !== expectedCount ||
    result.rows.length !== expectedCount
  ) {
    fail('H1_DATABASE_INSERT_COUNT_MISMATCH', stage);
  }
  const tableCaptures = captures.get(table) ?? [];
  const seenKeys = new Set(
    tableCaptures.map(({ keyJson }) => keyJson),
  );
  const shapeId = canonicalSha256(columns);
  for (const row of result.rows) {
    const suppliedJson = row['supplied_json'];
    const keyJson = row['key_json'];
    if (
      typeof suppliedJson !== 'string' ||
      typeof keyJson !== 'string'
    ) {
      fail(
        'H1_DATABASE_READBACK_MISMATCH',
        'insert-returning-row',
      );
    }
    assertReturnedProjection(suppliedJson, columns);
    assertReturnedPrimaryKey(keyJson, primaryKeys);
    if (seenKeys.has(keyJson)) {
      fail(
        'H1_DATABASE_READBACK_MISMATCH',
        'insert-returning-primary-key-duplicate',
      );
    }
    seenKeys.add(keyJson);
    tableCaptures.push(
      Object.freeze({
        table,
        shapeId,
        columns: Object.freeze([...columns]),
        suppliedJson,
        keyJson,
      }),
    );
  }
  captures.set(table, tableCaptures);
}

async function insertExactRows(
  client: H1SqlClient,
  rows: readonly H1DatabaseSeedRow[],
  primaryKeysByTable: ReadonlyMap<string, readonly string[]>,
  captures: InsertedRowsByTable,
  stage: 'authority-insert' | 'profile-insert',
): Promise<void> {
  for (const row of rows) {
    const primaryKeys = primaryKeysByTable.get(row.table);
    if (primaryKeys === undefined) {
      fail('H1_DATABASE_INPUT_INVALID', 'primary-key-map-coverage');
    }
    const columns = Object.keys(row.values).sort();
    const statement = insertStatement(row, primaryKeys, stage);
    const result = await client.query(
      statement.text,
      statement.values,
    );
    captureInsertedRows(
      result,
      row.table,
      columns,
      primaryKeys,
      1,
      captures,
      stage,
    );
  }
}

/**
 * Stable phase merge. Authority rows retain their exact relative order;
 * profile rows retain their exact supplied order. Preflight rejects equal
 * authority/profile phases rather than inventing a tie-break rule.
 */
async function insertAuthorityAndProfileRows(
  client: H1SqlClient,
  authorityRows: readonly H1DatabaseSeedRow[],
  profileRows: readonly H1DatabaseSeedRow[],
  primaryKeysByTable: ReadonlyMap<string, readonly string[]>,
  captures: InsertedRowsByTable,
): Promise<void> {
  let authorityCursor = 0;
  let profileCursor = 0;
  while (
    authorityCursor < authorityRows.length ||
    profileCursor < profileRows.length
  ) {
    const authority = authorityRows[authorityCursor];
    const profile = profileRows[profileCursor];
    if (
      profile !== undefined &&
      (authority === undefined || profile.phase < authority.phase)
    ) {
      await insertExactRows(
        client,
        [profile],
        primaryKeysByTable,
        captures,
        'profile-insert',
      );
      profileCursor += 1;
    } else if (authority !== undefined) {
      await insertExactRows(
        client,
        [authority],
        primaryKeysByTable,
        captures,
        'authority-insert',
      );
      authorityCursor += 1;
    }
  }
}

interface BulkShape {
  readonly phase: number;
  readonly table: string;
  readonly columns: readonly string[];
}

function sameBulkShape(
  left: BulkShape,
  right: BulkShape,
): boolean {
  return (
    left.phase === right.phase &&
    left.table === right.table &&
    left.columns.length === right.columns.length &&
    left.columns.every(
      (column, index) => column === right.columns[index],
    )
  );
}

function bulkShape(row: H1DatabaseSeedRow): BulkShape {
  return {
    phase: row.phase,
    table: row.table,
    columns: Object.keys(row.values).sort(),
  };
}

async function insertBulkChunk(
  client: H1SqlClient,
  shape: BulkShape,
  rows: readonly H1DatabaseSeedRow[],
  primaryKeys: readonly string[],
  captures: InsertedRowsByTable,
): Promise<void> {
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const base = values.length;
    for (const column of shape.columns) {
      values.push(row.values[column]);
    }
    return `(${shape.columns
      .map((_, index) => `$${base + index + 1}`)
      .join(', ')})`;
  });
  const result = await client.query(
    `WITH inserted_row AS (` +
      `INSERT INTO ${quotePublicTable(
      shape.table,
      'bulk-insert',
    )}` +
      ` (${shape.columns
        .map((column) => quoteIdentifier(column, 'bulk-insert'))
        .join(', ')}) VALUES ${tuples.join(', ')} RETURNING *) ` +
      `SELECT ${jsonbProjectionForAlias(
        'inserted_row',
        shape.columns,
        'bulk-insert',
      )} AS supplied_json, ` +
      `${jsonbProjectionForAlias(
        'inserted_row',
        primaryKeys,
        'bulk-insert',
      )} AS key_json FROM inserted_row`,
    values,
  );
  captureInsertedRows(
    result,
    shape.table,
    shape.columns,
    primaryKeys,
    rows.length,
    captures,
    'bulk-insert',
  );
}

async function insertBulkRows(
  client: H1SqlClient,
  rows: readonly H1DatabaseSeedRow[],
  primaryKeysByTable: ReadonlyMap<string, readonly string[]>,
  captures: InsertedRowsByTable,
): Promise<void> {
  let cursor = 0;
  while (cursor < rows.length) {
    const shape = bulkShape(rows[cursor]!);
    const maximumRows = Math.max(
      1,
      Math.min(
        MAX_ROWS_PER_INSERT,
        Math.floor(
          MAX_PARAMETERS_PER_INSERT / shape.columns.length,
        ),
      ),
    );
    let end = cursor + 1;
    while (
      end < rows.length &&
      end - cursor < maximumRows &&
      sameBulkShape(shape, bulkShape(rows[end]!))
    ) {
      end += 1;
    }
    const primaryKeys = primaryKeysByTable.get(shape.table);
    if (primaryKeys === undefined) {
      fail('H1_DATABASE_INPUT_INVALID', 'primary-key-map-coverage');
    }
    await insertBulkChunk(
      client,
      shape,
      rows.slice(cursor, end),
      primaryKeys,
      captures,
    );
    cursor = end;
  }
}

function parseCount(result: H1SqlQueryResult): number {
  if (result.rows.length !== 1) {
    fail('H1_DATABASE_COUNT_MISMATCH', 'count-readback');
  }
  const raw = result.rows[0]?.['row_count'];
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^[0-9]+$/u.test(raw)
        ? Number(raw)
        : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('H1_DATABASE_COUNT_MISMATCH', 'count-readback');
  }
  return value;
}

async function reconcileCounts(
  client: H1SqlClient,
  validated: ValidatedInputs,
): Promise<void> {
  for (const [table, expected] of [
    ...validated.expectedTableTotals.entries(),
  ].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    const actual = parseCount(
      await client.query(
        `SELECT count(*)::text AS row_count FROM ${quotePublicTable(
          table,
          'table-count-readback',
        )}`,
      ),
    );
    if (actual !== expected) {
      fail('H1_DATABASE_COUNT_MISMATCH', 'table-count-readback');
    }
  }

  for (const expected of validated.expectedCounts) {
    if (expected.tenantSlot === null) {
      /*
       * A global partition's whole-table total was already reconciled above.
       * Mixed global/tenant partitions for one table are rejected preflight.
       */
      continue;
    }
    const tenantColumn = expected.table === 'tenant' ? 'id' : 'tenant_id';
    const actual = parseCount(
      await client.query(
        `SELECT count(*)::text AS row_count FROM ${quotePublicTable(
          expected.table,
          'tenant-count-readback',
        )} WHERE ${quoteIdentifier(
          tenantColumn,
          'tenant-count-readback',
        )} = $1`,
        [validated.tenantIds[expected.tenantSlot]],
      ),
    );
    if (actual !== expected.rowCount) {
      fail('H1_DATABASE_COUNT_MISMATCH', 'tenant-count-readback');
    }
  }
}

/**
 * Explicitly proves both sides of the sparse profile contract:
 *
 * - D0/E0/P0 tables are absent when their profile contributes no rows.
 * - Every supplied D/E/P row is present by its pinned physical primary key.
 * - No undeclared row exists in any of the three profile tables.
 */
async function reconcileProfilePresence(
  client: H1SqlClient,
  probes: readonly ProfileReadbackProbe[],
): Promise<void> {
  for (const table of Object.keys(
    PROFILE_TABLE_PRIMARY_KEYS,
  ).sort()) {
    const expected = probes.filter(
      (probe) => probe.table === table,
    ).length;
    const actual = parseCount(
      await client.query(
        `SELECT count(*)::text AS row_count FROM ${quotePublicTable(
          table,
          'profile-table-readback',
        )}`,
      ),
    );
    if (actual !== expected) {
      fail(
        'H1_DATABASE_COUNT_MISMATCH',
        'profile-table-readback',
      );
    }
  }

  for (const probe of probes) {
    const predicates = probe.columns
      .map(
        (column, index) =>
          `${quoteIdentifier(
            column,
            'profile-primary-key-readback',
          )} = $${index + 1}`,
      )
      .join(' AND ');
    const actual = parseCount(
      await client.query(
        `SELECT count(*)::text AS row_count FROM ${quotePublicTable(
          probe.table,
          'profile-primary-key-readback',
        )} WHERE ${predicates}`,
        probe.values,
      ),
    );
    if (actual !== 1) {
      fail(
        'H1_DATABASE_COUNT_MISMATCH',
        'profile-primary-key-readback',
      );
    }
  }
}

interface FramedCatalogReadback {
  readonly sha256: string;
  readonly rowCount: number;
}

function frame(value: string): string {
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}

/**
 * One typed batch per table. Input rows may omit database-generated manifest
 * primary keys, so no plan row is falsely paired with a returned row by result
 * order. Instead, each table/column-shape compares three counted multisets:
 * PostgreSQL-coerced plan values, INSERT RETURNING projections, and final live
 * projections reached through the unique returned manifest keys.
 */
async function reconcileSeededRowValues(
  client: H1SqlClient,
  plans: readonly TableReadbackPlan[],
  capturesByTable: InsertedRowsByTable,
): Promise<FramedCatalogReadback> {
  const framedRows: Array<{
    readonly table: string;
    readonly keyJson: string;
    readonly actualJson: string;
  }> = [];

  for (const plan of plans) {
    const captures = capturesByTable.get(plan.table) ?? [];
    if (captures.length !== plan.rows.length) {
      fail(
        'H1_DATABASE_READBACK_MISMATCH',
        'catalog-readback-capture-count',
      );
    }
    const specs = plan.rows.map((row) => ({
      columns: row.columns,
      rowId: row.rowId,
      shapeId: row.shapeId,
      values: row.values,
    }));
    const capturedSpecs = captures.map((capture) => ({
      columns: capture.columns,
      keyJson: capture.keyJson,
      shapeId: capture.shapeId,
    }));
    const table = quotePublicTable(plan.table, 'catalog-readback');
    const firstPrimaryKey = quoteIdentifier(
      plan.primaryKeys[0]!,
      'catalog-readback',
    );
    const join = plan.primaryKeys
      .map((column) => {
        const quoted = quoteIdentifier(column, 'catalog-readback');
        return (
          `actual_row.${quoted} IS NOT DISTINCT FROM ` +
          `captured_key.${quoted}`
        );
      })
      .join(' AND ');
    const actualKeyProjection = jsonbProjectionForAlias(
      'actual_row',
      plan.primaryKeys,
      'catalog-readback',
    );
    const query = `
WITH specs AS (
  SELECT value AS spec, ordinality
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY
),
captures AS (
  SELECT value AS capture, ordinality
    FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY
),
expected_rows AS (
  SELECT
    'expected'::text AS kind,
    specs.spec->>'rowId' AS identity,
    specs.spec->>'shapeId' AS shape_id,
    TRUE AS actual_present,
    (
      SELECT jsonb_object_agg(entry.key, entry.value ORDER BY entry.key)::text
        FROM jsonb_each(to_jsonb(expected_row)) AS entry
       WHERE entry.key IN (
         SELECT jsonb_array_elements_text(specs.spec->'columns')
       )
    ) AS value_json,
    NULL::text AS key_json,
    specs.ordinality AS source_ordinality
  FROM specs
  CROSS JOIN LATERAL jsonb_populate_record(
    NULL::${table},
    specs.spec->'values'
  ) AS expected_row
),
actual_rows AS (
  SELECT
    'actual'::text AS kind,
    captures.capture->>'keyJson' AS identity,
    captures.capture->>'shapeId' AS shape_id,
    actual_row.${firstPrimaryKey} IS NOT NULL AS actual_present,
    CASE
      WHEN actual_row.${firstPrimaryKey} IS NULL THEN NULL
      ELSE (
        SELECT jsonb_object_agg(entry.key, entry.value ORDER BY entry.key)::text
          FROM jsonb_each(to_jsonb(actual_row)) AS entry
         WHERE entry.key IN (
           SELECT jsonb_array_elements_text(captures.capture->'columns')
         )
      )
    END AS value_json,
    CASE
      WHEN actual_row.${firstPrimaryKey} IS NULL THEN NULL
      ELSE ${actualKeyProjection}
    END AS key_json,
    captures.ordinality AS source_ordinality
  FROM captures
  CROSS JOIN LATERAL jsonb_populate_record(
    NULL::${table},
    (captures.capture->>'keyJson')::jsonb
  ) AS captured_key
  LEFT JOIN ${table} AS actual_row ON ${join}
)
SELECT
  kind, identity, shape_id, actual_present, value_json, key_json
FROM expected_rows
UNION ALL
SELECT
  kind, identity, shape_id, actual_present, value_json, key_json
FROM actual_rows`.trim();
    const result = await client.query(query, [
      canonicalJson(specs),
      canonicalJson(capturedSpecs),
    ]);
    if (result.rows.length !== plan.rows.length + captures.length) {
      fail(
        'H1_DATABASE_READBACK_MISMATCH',
        'catalog-readback-row-count',
      );
    }

    const plannedRowIds = new Set(plan.rows.map((row) => row.rowId));
    const capturedKeys = new Set(captures.map(({ keyJson }) => keyJson));
    const captureByKey = new Map(
      captures.map((capture) => [capture.keyJson, capture] as const),
    );
    if (captureByKey.size !== captures.length) {
      fail(
        'H1_DATABASE_READBACK_MISMATCH',
        'catalog-readback-primary-key',
      );
    }
    const observedRowIds = new Set<string>();
    const observedKeys = new Set<string>();
    const expectedByShape = new Map<string, string[]>();
    const returnedByShape = new Map<string, string[]>();
    const actualByShape = new Map<string, string[]>();
    for (const capture of captures) {
      const values = returnedByShape.get(capture.shapeId) ?? [];
      values.push(capture.suppliedJson);
      returnedByShape.set(capture.shapeId, values);
    }
    for (const row of result.rows) {
      const kind = row['kind'];
      const identity = row['identity'];
      const shapeId = row['shape_id'];
      const actualPresent = row['actual_present'];
      const valueJson = row['value_json'];
      const keyJson = row['key_json'];
      if (
        (kind !== 'expected' && kind !== 'actual') ||
        typeof identity !== 'string' ||
        typeof shapeId !== 'string' ||
        actualPresent !== true ||
        typeof valueJson !== 'string'
      ) {
        fail(
          'H1_DATABASE_READBACK_MISMATCH',
          'catalog-readback-value',
        );
      }
      if (kind === 'expected') {
        if (
          !plannedRowIds.has(identity) ||
          observedRowIds.has(identity) ||
          keyJson !== null
        ) {
          fail(
            'H1_DATABASE_READBACK_MISMATCH',
            'catalog-readback-expected',
          );
        }
        observedRowIds.add(identity);
        const values = expectedByShape.get(shapeId) ?? [];
        values.push(valueJson);
        expectedByShape.set(shapeId, values);
      } else {
        const capture = captureByKey.get(identity);
        if (
          typeof keyJson !== 'string' ||
          identity !== keyJson ||
          !capturedKeys.has(identity) ||
          observedKeys.has(identity) ||
          capture === undefined
        ) {
          fail(
            'H1_DATABASE_READBACK_MISMATCH',
            'catalog-readback-primary-key',
          );
        }
        if (
          capture.shapeId !== shapeId ||
          capture.suppliedJson !== valueJson
        ) {
          fail(
            'H1_DATABASE_READBACK_MISMATCH',
            'catalog-readback-key-value',
          );
        }
        observedKeys.add(identity);
        const values = actualByShape.get(shapeId) ?? [];
        values.push(valueJson);
        actualByShape.set(shapeId, values);
        framedRows.push({
          table: plan.table,
          keyJson,
          actualJson: valueJson,
        });
      }
    }
    const compareMultiset = (
      expected: ReadonlyMap<string, readonly string[]>,
      observed: ReadonlyMap<string, readonly string[]>,
    ): boolean => {
      const shapes = [...expected.keys()].sort();
      const observedShapes = [...observed.keys()].sort();
      if (
        shapes.length !== observedShapes.length ||
        shapes.some((shape, index) => shape !== observedShapes[index])
      ) {
        return false;
      }
      return shapes.every((shape) => {
        const left = [...(expected.get(shape) ?? [])].sort();
        const right = [...(observed.get(shape) ?? [])].sort();
        return (
          left.length === right.length &&
          left.every((value, index) => value === right[index])
        );
      });
    };
    if (
      observedRowIds.size !== plan.rows.length ||
      observedKeys.size !== captures.length ||
      !compareMultiset(expectedByShape, returnedByShape) ||
      !compareMultiset(expectedByShape, actualByShape)
    ) {
      fail(
        'H1_DATABASE_READBACK_MISMATCH',
        'catalog-readback-multiset',
      );
    }
  }

  framedRows.sort((left, right) => {
    const table = left.table.localeCompare(right.table, 'en');
    if (table !== 0) return table;
    return left.keyJson.localeCompare(right.keyJson, 'en');
  });
  const framed = [
    'HEARTH-H1-CATALOG-READBACK-v1',
    ...framedRows.map(
      (row) =>
        `R${frame(row.table)}${frame(row.keyJson)}` +
        `${frame(row.actualJson)}`,
    ),
  ].join('');
  return Object.freeze({
    sha256: sha256Hex(framed),
    rowCount: framedRows.length,
  });
}

async function attestMigrationLedger(
  client: H1SqlClient,
  expected: ValidatedInputs['migrationLedger'],
): Promise<void> {
  const result = await client.query(
    'SELECT id, checksum FROM public."_migrations" ORDER BY id',
  );
  const actual = result.rows.map((row) => ({
    id: typeof row['id'] === 'string' ? row['id'] : null,
    checksum:
      typeof row['checksum'] === 'string' ? row['checksum'] : null,
  }));
  if (
    actual.length !== expected.length ||
    actual.some(
      (row, index) =>
        row.id !== expected[index]!.id ||
        row.checksum !== expected[index]!.checksum,
    )
  ) {
    fail(
      'H1_DATABASE_MIGRATION_LEDGER_MISMATCH',
      'migration-ledger',
    );
  }
}

async function analyzeSeedTables(
  client: H1SqlClient,
  tables: Iterable<string>,
): Promise<void> {
  for (const table of [...tables].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )) {
    await client.query(
      `ANALYZE ${quotePublicTable(table, 'analyze')}`,
    );
  }
}

function recordEvent(
  ledger: H1DatabaseSideEffectLedger | undefined,
  capability: H1DatabaseSideEffectEvent['capability'],
): void {
  if (ledger === undefined) return;
  ledger.attemptedEvents.push({
    sequence: ledger.attemptedEvents.length + 1,
    capability,
  });
}

async function runSeedTransaction(
  connected: H1ConsumedRetainedSeedTransaction,
  validated: ValidatedInputs,
  statementTimeoutMs: number,
  ledger: H1DatabaseSideEffectLedger | undefined,
): Promise<FramedCatalogReadback> {
  const { client } = connected;
  const primaryKeysByTable = new Map(
    validated.tableReadbackPlans.map((plan) => [
      plan.table,
      plan.primaryKeys,
    ]),
  );
  const captures: InsertedRowsByTable = new Map();
  let stage = 'statement-timeout';
  let committed = false;
  let catalogReadback: FramedCatalogReadback | undefined;
  try {
    await client.query(
      "SELECT set_config('statement_timeout', $1, true)",
      [`${statementTimeoutMs}ms`],
    );

    stage = 'migration-ledger';
    await attestMigrationLedger(client, validated.migrationLedger);

    stage = 'constraints-deferred';
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    stage = 'authority-and-profile-insert';
    await insertAuthorityAndProfileRows(
      client,
      validated.authorityRows,
      validated.profileRows,
      primaryKeysByTable,
      captures,
    );

    stage = 'bulk-insert';
    await insertBulkRows(
      client,
      validated.bulkRows,
      primaryKeysByTable,
      captures,
    );

    stage = 'constraints-immediate';
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    stage = 'count-readback';
    await reconcileCounts(client, validated);

    stage = 'profile-presence-readback';
    await reconcileProfilePresence(
      client,
      validated.profileReadbackProbes,
    );

    stage = 'catalog-readback';
    catalogReadback = await reconcileSeededRowValues(
      client,
      validated.tableReadbackPlans,
      captures,
    );

    stage = 'analyze';
    await analyzeSeedTables(
      client,
      validated.expectedTableTotals.keys(),
    );

    stage = 'transaction-commit';
    recordEvent(ledger, 'database-commit');
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    let rolledBack: boolean | null = null;
    if (!committed) {
      try {
        await client.query('ROLLBACK');
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    throw translateDatabaseError(error, stage, rolledBack);
  }
  if (catalogReadback === undefined) {
    fail('H1_DATABASE_READBACK_MISMATCH', 'catalog-readback-missing');
  }
  return catalogReadback;
}

/**
 * Seeds H1 once. There is deliberately no retry path.
 *
 * All authority/planning/count/pin checks complete before the retained
 * transaction is consumed. The probe already owns BEGIN/search_path/locks;
 * this layer issues no second BEGIN and owns COMMIT or ROLLBACK plus `end()`.
 * SQLSTATE 57014 always rolls back and throws a typed error.
 */
export async function seedH1Database(
  input: H1DatabaseSeedInput,
): Promise<H1DatabaseSeedReceipt> {
  const validated = validateInput(input);
  const receiptBinding = buildH1DatabaseSeedReceiptBinding(input);
  let connected: H1ConsumedRetainedSeedTransaction | undefined;
  let receipt: H1DatabaseSeedReceipt | undefined;
  let failure: unknown;
  let catalogReadback: FramedCatalogReadback | undefined;

  try {
    recordEvent(
      input.sideEffectLedger,
      'database-retained-transaction-consume',
    );
    connected = consumeRetainedSeedTransaction(
      input.retainedTransaction,
      input.verifiedProfileExecution,
    );
    catalogReadback = await runSeedTransaction(
      connected,
      validated,
      input.statementTimeoutMs,
      input.sideEffectLedger,
    );

    const corpusSha256 = canonicalSha256({
      profilePlanSha256: receiptBinding.profilePlanSha256,
      authorityRowsSha256: receiptBinding.authorityRowsSha256,
      corpusProfileId: validated.corpusProfileId,
      profileRowsSha256: receiptBinding.profileRowsSha256,
      profileReadbackSha256: validated.profileReadbackSha256,
      framedReadbackSha256: catalogReadback.sha256,
      bulkRowsSha256: receiptBinding.bulkRowsSha256,
      expectedCountsSha256:
        receiptBinding.reconciledCountsSha256,
      migrationLedgerSha256:
        receiptBinding.migrationLedgerSha256,
    });
    receipt = Object.freeze({
      artifactKind: 'hearth-search-h1-database-seed-receipt',
      measurementStatus: 'NOT_YET_MEASURED',
      corpusProfileId: validated.corpusProfileId,
      profilePlanSha256: receiptBinding.profilePlanSha256,
      authorityRowCount: 692,
      profileRowCount: input.profileRows.length as
        | 0
        | 2
        | 14
        | 16,
      bulkRowCount: input.bulkRows.length,
      totalRowCount: receiptBinding.totalRowCount,
      reconciledCountPartitionCount:
        receiptBinding.reconciledCountPartitionCount,
      targetBindingSha256: receiptBinding.targetBindingSha256,
      authorityRowsSha256: receiptBinding.authorityRowsSha256,
      profileRowsSha256: receiptBinding.profileRowsSha256,
      profileReadbackSha256: validated.profileReadbackSha256,
      framedReadbackSha256: catalogReadback.sha256,
      readbackRowCount: catalogReadback.rowCount,
      bulkRowsSha256: receiptBinding.bulkRowsSha256,
      migrationLedgerSha256:
        receiptBinding.migrationLedgerSha256,
      reconciledCountsSha256:
        receiptBinding.reconciledCountsSha256,
      corpusSha256,
    });
    trustedH1DatabaseSeedReceipts.set(
      receipt,
      {
        snapshot: canonicalSha256(receipt),
        verifiedProfileExecution: input.verifiedProfileExecution,
        retainedTransaction: input.retainedTransaction,
      },
    );
    assertTrustedH1DatabaseSeedReceipt(receipt);
  } catch (error) {
    failure = error;
  }

  if (connected !== undefined) {
    try {
      await connected.client.end();
    } catch {
      if (failure === undefined) {
        failure = new H1DatabaseSeedError(
          'H1_DATABASE_OPERATION_FAILED',
          'client-close',
        );
      }
    }
  }
  if (failure !== undefined) throw failure;
  if (receipt === undefined) {
    fail('H1_DATABASE_OPERATION_FAILED', 'receipt');
  }
  return receipt;
}
