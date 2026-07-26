import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalSha256 } from '../../src/canonical.js';
import {
  H1DatabaseSeedError,
  assertTrustedH1DatabaseSeedReceipt,
  assertTrustedH1DatabaseSeedReceiptForExecution,
  seedH1Database,
  type H1DatabaseSeedInput,
  type H1DatabaseSeedRow,
  type H1ExpectedSeedCount,
  type H1MigrationPin,
} from '../../src/h1/databaseSeeder.js';
import type {
  H1SqlClient,
  H1SqlQueryResult,
} from '../../src/h1/disposableDatabase.js';
import type { H1RetainedSeedTransaction } from '../../src/h1/externalTargetProbe.js';
import type { H1VerifiedProfileExecutionAttestation } from '../../src/h1/sourcePlan.js';

const retainedBoundary = vi.hoisted(() => {
  const attestations = new WeakMap<
    object,
    {
      readonly tables: readonly string[];
      readonly primaryKeys: Readonly<Record<string, readonly string[]>>;
    }
  >();
  const transactions = new WeakMap<
    object,
    {
      readonly attestation: object;
      readonly client: H1SqlClient;
      consumed: boolean;
    }
  >();
  return { attestations, transactions };
});

vi.mock('../../src/h1/sourcePlan.js', () => ({
  resolveH1VerifiedSeedTableSet(attestation: object) {
    const state = retainedBoundary.attestations.get(attestation);
    if (state === undefined) throw new Error('unknown attestation');
    return Object.freeze([...state.tables]);
  },
  resolveH1VerifiedPrimaryKeysByTable(attestation: object) {
    const state = retainedBoundary.attestations.get(attestation);
    if (state === undefined) throw new Error('unknown attestation');
    return state.primaryKeys;
  },
}));

vi.mock('../../src/h1/externalTargetProbe.js', () => {
  const ready = (transaction: object, attestation: object) => {
    const state = retainedBoundary.transactions.get(transaction);
    if (
      state === undefined ||
      state.attestation !== attestation ||
      state.consumed
    ) {
      throw new Error('retained transaction is not ready');
    }
    return state;
  };
  return {
    assertRetainedSeedTransactionReady(
      transaction: object,
      attestation: object,
    ) {
      ready(transaction, attestation);
    },
    consumeRetainedSeedTransaction(
      transaction: H1RetainedSeedTransaction,
      attestation: object,
    ) {
      const state = ready(transaction, attestation);
      state.consumed = true;
      return Object.freeze({
        ...transaction,
        client: state.client,
        measuredCredentials: Object.freeze({}),
      });
    },
  };
});

const now = new Date('2026-07-26T12:00:00.000Z');
const T01 = '00000000-0000-4000-8000-000000000001';
const T02 = '00000000-0000-4000-8000-000000000002';
let runSequence = 100;

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface MockDatabase {
  readonly client: H1SqlClient;
  readonly queries: RecordedQuery[];
  readonly end: ReturnType<typeof vi.fn>;
}

function migrationPins(): readonly H1MigrationPin[] {
  return Array.from({ length: 95 }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    return {
      path:
        `webv0/packages/persistence/migrations/` +
        `${number}_migration_${index + 1}.sql`,
      sha256: (index + 1).toString(16).padStart(64, '0'),
    };
  });
}

function authorityRows(): readonly H1DatabaseSeedRow[] {
  const tenants: H1DatabaseSeedRow[] = [
    {
      rowId: 'authority.tenant.T01',
      phase: 0,
      table: 'tenant',
      tenantSlot: 'T01',
      values: { id: T01, name: 'Synthetic T01', slug: 'h1-t01' },
    },
    {
      rowId: 'authority.tenant.T02',
      phase: 0,
      table: 'tenant',
      tenantSlot: 'T02',
      values: { id: T02, name: 'Synthetic T02', slug: 'h1-t02' },
    },
  ];
  const rest = Array.from({ length: 690 }, (_, index) => {
    const tenantSlot = index % 2 === 0 ? 'T01' : 'T02';
    return {
      rowId: `authority.row.${String(index).padStart(4, '0')}`,
      phase: index >= 688 ? 60 : 10,
      table: 'authority_row',
      tenantSlot,
      values: {
        id: `authority-${String(index).padStart(4, '0')}`,
        name: `Synthetic authority ${index}`,
        tenant_id: tenantSlot === 'T01' ? T01 : T02,
      },
    } satisfies H1DatabaseSeedRow;
  });
  return [...tenants, ...rest];
}

function bulkRows(): readonly H1DatabaseSeedRow[] {
  return [
    {
      rowId: 'bulk.parent.T01.1',
      phase: 100,
      table: 'bulk_parent',
      tenantSlot: 'T01',
      values: { id: 'bulk-t01-1', name: 'Bulk 1', tenant_id: T01 },
    },
    {
      rowId: 'bulk.parent.T01.2',
      phase: 100,
      table: 'bulk_parent',
      tenantSlot: 'T01',
      values: { id: 'bulk-t01-2', name: 'Bulk 2', tenant_id: T01 },
    },
    {
      rowId: 'bulk.parent.T02.1',
      phase: 100,
      table: 'bulk_parent',
      tenantSlot: 'T02',
      values: { id: 'bulk-t02-1', name: 'Bulk 3', tenant_id: T02 },
    },
  ];
}

function profileRows(
  state: 'D1' | 'D2' | 'D3' | 'D4' = 'D1',
): readonly H1DatabaseSeedRow[] {
  return Array.from({ length: 14 }, (_, index) => {
    const tenantSlot = index < 7 ? 'T01' : 'T02';
    return {
      rowId:
        `H3D.${tenantSlot}.actor${index % 7}.` +
        `${state}.row`,
      phase: 55,
      table: 'delegation',
      tenantSlot,
      values: {
        id: `00000000-0000-4000-8100-${String(index).padStart(12, '0')}`,
        delegation_id: `delegation-${String(index).padStart(2, '0')}`,
        tenant_id: tenantSlot === 'T01' ? T01 : T02,
      },
    } satisfies H1DatabaseSeedRow;
  });
}

function entitlementProfileRows(
  state: 'E1' | 'E2' | 'E3' | 'E4',
): readonly H1DatabaseSeedRow[] {
  return (['T01', 'T02'] as const).map((tenantSlot) => ({
    rowId:
      `H3A.${tenantSlot}:actor_entitlement:comms.` +
      `${state}.row`,
    phase: 55,
    table: 'tenant_module_entitlement',
    tenantSlot,
    values: {
      tenant_id: tenantSlot === 'T01' ? T01 : T02,
      module_key: 'comms',
      state: state === 'E2' ? 'lapsed' : 'active',
    },
  }));
}

function participantProfileRows(): readonly H1DatabaseSeedRow[] {
  const participants = Array.from({ length: 14 }, (_, index) => {
    const tenantSlot = index < 7 ? 'T01' : 'T02';
    const actor = index % 7;
    return {
      rowId:
        `H3A.${tenantSlot}:participant_overlay:` +
        `THR-${tenantSlot === 'T01' ? '8999001' : '8999002'}` +
        `.P1${actor === 0 ? '' : `.actor${actor}`}.row`,
      phase: 65,
      table: 'comms_thread_participant',
      tenantSlot,
      values: {
        tenant_id: tenantSlot === 'T01' ? T01 : T02,
        thread_id:
          tenantSlot === 'T01' ? 'THR-8999001' : 'THR-8999002',
        user_id:
          `00000000-0000-4000-9000-` +
          `${tenantSlot === 'T01' ? '1' : '2'}${String(actor).padStart(11, '0')}`,
        role: 'member',
      },
    } satisfies H1DatabaseSeedRow;
  });
  return [...entitlementProfileRows('E1'), ...participants];
}

function expectedCounts(
  profile: 'none' | 'D' | 'E' | 'P' = 'none',
): readonly H1ExpectedSeedCount[] {
  const baseline: H1ExpectedSeedCount[] = [
    { table: 'tenant', tenantSlot: 'T01', rowCount: 1 },
    { table: 'tenant', tenantSlot: 'T02', rowCount: 1 },
    {
      table: 'authority_row',
      tenantSlot: 'T01',
      rowCount: 345,
    },
    {
      table: 'authority_row',
      tenantSlot: 'T02',
      rowCount: 345,
    },
    { table: 'bulk_parent', tenantSlot: 'T01', rowCount: 2 },
    { table: 'bulk_parent', tenantSlot: 'T02', rowCount: 1 },
  ];
  if (profile === 'D') {
    baseline.push(
      { table: 'delegation', tenantSlot: 'T01', rowCount: 7 },
      { table: 'delegation', tenantSlot: 'T02', rowCount: 7 },
    );
  } else if (profile === 'E') {
    baseline.push(
      {
        table: 'tenant_module_entitlement',
        tenantSlot: 'T01',
        rowCount: 1,
      },
      {
        table: 'tenant_module_entitlement',
        tenantSlot: 'T02',
        rowCount: 1,
      },
    );
  } else if (profile === 'P') {
    baseline.push(
      {
        table: 'tenant_module_entitlement',
        tenantSlot: 'T01',
        rowCount: 1,
      },
      {
        table: 'tenant_module_entitlement',
        tenantSlot: 'T02',
        rowCount: 1,
      },
      {
        table: 'comms_thread_participant',
        tenantSlot: 'T01',
        rowCount: 7,
      },
      {
        table: 'comms_thread_participant',
        tenantSlot: 'T02',
        rowCount: 7,
      },
    );
  }
  return baseline;
}

function primaryKeysByTable(
  profile: 'none' | 'D' | 'E' | 'P' = 'none',
) {
  const keys: Record<string, readonly string[]> = {
    authority_row: ['id'],
    bulk_parent: ['id'],
    tenant: ['id'],
  };
  if (profile === 'D') {
    keys['delegation'] = ['id'];
  } else if (profile === 'E') {
    keys['tenant_module_entitlement'] = [
      'tenant_id',
      'module_key',
    ];
  } else if (profile === 'P') {
    keys['tenant_module_entitlement'] = [
      'tenant_id',
      'module_key',
    ];
    keys['comms_thread_participant'] = [
      'tenant_id',
      'thread_id',
      'user_id',
    ];
  }
  return keys;
}

function pinLedgerRows() {
  return migrationPins().map((pin) => ({
    id: pin.path.split('/').at(-1)!,
    checksum: pin.sha256,
  }));
}

function mockDatabase(
  databaseName: string,
  failWhen?: (
    text: string,
    values: readonly unknown[],
    occurrence: number,
  ) => unknown,
): MockDatabase {
  const queries: RecordedQuery[] = [];
  const insertedRows = new Map<
    string,
    Array<Readonly<Record<string, unknown>>>
  >();
  const end = vi.fn(async () => undefined);
  let occurrence = 0;

  const query = async (
    text: string,
    values: readonly unknown[] = [],
  ): Promise<H1SqlQueryResult> => {
    occurrence += 1;
    queries.push({ text, values });
    const failure = failWhen?.(text, values, occurrence);
    if (failure !== undefined) throw failure;

    if (text.startsWith('SELECT current_database()')) {
      return {
        rows: [{ database_name: databaseName }],
        rowCount: 1,
      };
    }
    if (
      text ===
      'SELECT id, checksum FROM public."_migrations" ORDER BY id'
    ) {
      return { rows: pinLedgerRows(), rowCount: 95 };
    }
    const stableJson = (value: Record<string, unknown>) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right, 'en'),
          ),
        ),
      );
    const insert =
      /^WITH inserted_row AS \(INSERT INTO public\."([^"]+)" \(([^)]+)\) VALUES /u.exec(
        text,
      );
    if (insert !== null) {
      const table = insert[1]!;
      const columns = [...insert[2]!.matchAll(/"([^"]+)"/gu)].map(
        (match) => match[1]!,
      );
      const projectionArrays = [
        ...text.matchAll(/ARRAY\[([^\]]+)\]::text\[\]/gu),
      ];
      const primaryKeys = [
        ...(projectionArrays.at(-1)?.[1] ?? '').matchAll(
          /'([a-z_][a-z0-9_]*)'/gu,
        ),
      ].map((match) => match[1]!);
      const rowCount = values.length / columns.length;
      const returnedRows: Array<Readonly<Record<string, unknown>>> =
        [];
      for (let offset = 0; offset < values.length; offset += columns.length) {
        const row: Record<string, unknown> = Object.fromEntries(
          columns.map((column, index) => [
            column,
            values[offset + index],
          ]),
        );
        const tableRows = insertedRows.get(table) ?? [];
        for (const primaryKey of primaryKeys) {
          if (row[primaryKey] === undefined) {
            row[primaryKey] =
              `${table}-generated-` +
              String(tableRows.length + 1).padStart(6, '0');
          }
        }
        tableRows.push(row);
        insertedRows.set(table, tableRows);
        returnedRows.push({
          supplied_json: stableJson(
            Object.fromEntries(
              columns.map((column) => [column, row[column]]),
            ),
          ),
          key_json: stableJson(
            Object.fromEntries(
              primaryKeys.map((column) => [column, row[column]]),
            ),
          ),
        });
      }
      return { rows: returnedRows, rowCount };
    }
    if (text.startsWith('WITH specs AS (')) {
      const table = /NULL::public\."([^"]+)"/u.exec(text)?.[1];
      if (table === undefined) throw new Error('mock readback table missing');
      const specs = JSON.parse(String(values[0])) as Array<{
        columns: string[];
        rowId: string;
        shapeId: string;
        values: Record<string, unknown>;
      }>;
      const captures = JSON.parse(String(values[1])) as Array<{
        columns: string[];
        keyJson: string;
        shapeId: string;
      }>;
      const selected = (
        value: Readonly<Record<string, unknown>>,
        columns: readonly string[],
      ) =>
        Object.fromEntries(
          columns.map((column) => [column, value[column]]),
        );
      const rows = [
        ...specs.map((spec) => ({
          kind: 'expected',
          identity: spec.rowId,
          shape_id: spec.shapeId,
          actual_present: true,
          value_json: stableJson(selected(spec.values, spec.columns)),
          key_json: null,
        })),
        ...captures.map((capture) => {
          const key = JSON.parse(capture.keyJson) as Record<
            string,
            unknown
          >;
          const actual = (insertedRows.get(table) ?? []).find((row) =>
            Object.entries(key).every(
              ([column, value]) => row[column] === value,
            ),
          );
          return {
            kind: 'actual',
            identity: capture.keyJson,
            shape_id: capture.shapeId,
            actual_present: actual !== undefined,
            value_json:
              actual === undefined
                ? null
                : stableJson(selected(actual, capture.columns)),
            key_json:
              actual === undefined
                ? null
                : stableJson(
                    Object.fromEntries(
                      Object.keys(key).map((column) => [
                        column,
                        actual[column],
                      ]),
                    ),
                  ),
          };
        }),
      ];
      return { rows, rowCount: rows.length };
    }
    const count =
      /^SELECT count\(\*\)::text AS row_count FROM public\."([^"]+)"(?: WHERE (.+))?$/u.exec(
        text,
      );
    if (count !== null) {
      const table = count[1]!;
      const predicates =
        count[2] === undefined
          ? []
          : [
              ...count[2].matchAll(
                /"([^"]+)" = \$([0-9]+)/gu,
              ),
            ].map((match) => ({
              column: match[1]!,
              parameter: Number(match[2]!) - 1,
            }));
      const observed = (insertedRows.get(table) ?? []).filter(
        (row) =>
          predicates.every(
            ({ column, parameter }) =>
              row[column] === values[parameter],
          ),
      ).length;
      return {
        rows: [{ row_count: String(observed) }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: null };
  };

  return {
    client: { query, end },
    queries,
    end,
  };
}

function retainedExecution(
  client: H1SqlClient,
  corpusProfileId: H1DatabaseSeedInput['corpusProfileId'],
  primaryKeys: Readonly<Record<string, readonly string[]>>,
): Pick<
  H1DatabaseSeedInput,
  'verifiedProfileExecution' | 'retainedTransaction'
> {
  runSequence += 1;
  const runId = `seed-run-${runSequence}`;
  const databaseName = `c3_hearth_search_seed_${runSequence}`;
  const tables = Object.keys(primaryKeys).sort();
  const verifiedProfileExecution = Object.freeze({
    schemaVersion: 1,
    artifactKind:
      'hearth-search-h1-verified-profile-execution-attestation',
    measurementStatus: 'NOT_YET_MEASURED',
    corpusProfileId,
    profilePlanSha256: 'a'.repeat(64),
    exactTableCount: tables.length,
    exactTablesSha256: 'b'.repeat(64),
    h0GuardTableCount: tables.length + 3,
    h0GuardTablesSha256: 'c'.repeat(64),
    primaryKeysByTableSha256: 'd'.repeat(64),
  }) as H1VerifiedProfileExecutionAttestation;
  retainedBoundary.attestations.set(verifiedProfileExecution, {
    tables,
    primaryKeys,
  });
  const lockedTables = [
    ...new Set([
      ...tables,
      'delegation',
      'tenant_module_entitlement',
      'comms_thread_participant',
    ]),
  ].sort();
  const retainedTransaction = Object.freeze({
    clientProvider: 'external-owned-postgresql',
    databaseName,
    targetIdentitySha256: runSequence
      .toString(16)
      .padStart(64, '0'),
    runId,
    isolationLevel: 'SERIALIZABLE',
    lockMode: 'SHARE ROW EXCLUSIVE',
    lockedTables,
    ownershipMarkerLocked: true,
  }) satisfies H1RetainedSeedTransaction;
  retainedBoundary.transactions.set(retainedTransaction, {
    attestation: verifiedProfileExecution,
    client,
    consumed: false,
  });
  return {
    verifiedProfileExecution,
    retainedTransaction,
  };
}

function validInput(database: MockDatabase): {
  readonly input: H1DatabaseSeedInput;
} {
  const execution = retainedExecution(
    database.client,
    'H3M.D0',
    primaryKeysByTable(),
  );
  return {
    input: {
      ...execution,
      corpusProfileId: 'H3M.D0',
      authorityRows: authorityRows(),
      profileRows: [],
      bulkRows: bulkRows(),
      expectedCounts: expectedCounts(),
      migrationPins: migrationPins(),
      statementTimeoutMs: 30_000,
      sideEffectLedger: { attemptedEvents: [] },
    },
  };
}

function isInsertQuery(text: string): boolean {
  return text.startsWith(
    'WITH inserted_row AS (INSERT INTO public.',
  );
}

function insertsTable(text: string, table: string): boolean {
  return text.startsWith(
    `WITH inserted_row AS (INSERT INTO public."${table}"`,
  );
}

describe('H1 database seeder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('inserts all 692 authority rows exactly in supplied order, batches bulk rows, reconciles, analyzes, and commits once', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const { input } = validInput(database);

    const receipt = await seedH1Database(input);
    expect(() =>
      assertTrustedH1DatabaseSeedReceiptForExecution(
        receipt,
        input.verifiedProfileExecution,
        input.retainedTransaction,
      ),
    ).not.toThrow();

    const insertQueries = database.queries.filter((query) =>
      isInsertQuery(query.text),
    );
    expect(insertQueries).toHaveLength(693);
    expect(insertQueries[0]?.values).toContain(T01);
    expect(insertQueries[1]?.values).toContain(T02);
    expect(insertQueries[691]?.values).toContain('authority-0689');
    expect(insertsTable(insertQueries[692]!.text, 'bulk_parent')).toBe(
      true,
    );
    expect(insertQueries[692]?.values).toHaveLength(9);
    expect(
      database.queries.filter((query) => query.text === 'BEGIN'),
    ).toHaveLength(0);
    expect(
      database.queries.filter((query) => query.text === 'COMMIT'),
    ).toHaveLength(1);
    expect(
      database.queries.filter((query) =>
        query.text.startsWith('ANALYZE '),
      ),
    ).toHaveLength(3);
    expect(database.end).toHaveBeenCalledOnce();
    expect(receipt).toMatchObject({
      measurementStatus: 'NOT_YET_MEASURED',
      corpusProfileId: 'H3M.D0',
      authorityRowCount: 692,
      profileRowCount: 0,
      bulkRowCount: 3,
      totalRowCount: 695,
      reconciledCountPartitionCount: 6,
      profilePlanSha256:
        input.verifiedProfileExecution.profilePlanSha256,
    });
    expect(receipt.corpusSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.profileReadbackSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    for (const table of [
      'delegation',
      'tenant_module_entitlement',
      'comms_thread_participant',
    ]) {
      expect(
        database.queries.some(
          (query) =>
            query.text ===
            `SELECT count(*)::text AS row_count FROM public."${table}"`,
        ),
      ).toBe(true);
    }
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('seed-secret');
    expect(serialized).not.toContain('Synthetic authority');
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([
      {
        sequence: 1,
        capability: 'database-retained-transaction-consume',
      },
      { sequence: 2, capability: 'database-commit' },
    ]);
  });

  it('RED: trusts only the exact branded receipt and rejects an identical frozen structural clone', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const { input } = validInput(database);
    const receipt = await seedH1Database(input);

    expect(() =>
      assertTrustedH1DatabaseSeedReceipt(receipt),
    ).not.toThrow();
    const structuralClone = Object.freeze({ ...receipt });
    expect(() =>
      assertTrustedH1DatabaseSeedReceipt(structuralClone),
    ).toThrowError(
      expect.objectContaining({
        code: 'H1_DATABASE_RECEIPT_UNTRUSTED',
        stage: 'receipt-brand',
      }),
    );

    const otherDatabase = mockDatabase(
      `c3_hearth_search_seed_${runSequence + 1}`,
    );
    const other = validInput(otherDatabase).input;
    expect(() =>
      assertTrustedH1DatabaseSeedReceiptForExecution(
        receipt,
        input.verifiedProfileExecution,
        other.retainedTransaction,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'H1_DATABASE_RECEIPT_UNTRUSTED',
        stage: 'receipt-execution',
      }),
    );
    expect(() =>
      assertTrustedH1DatabaseSeedReceiptForExecution(
        receipt,
        other.verifiedProfileExecution,
        input.retainedTransaction,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'H1_DATABASE_RECEIPT_UNTRUSTED',
        stage: 'receipt-execution',
      }),
    );
  });

  it('stable-merges an approved D1 overlay at phase 55 without reordering authority rows', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      ...retainedExecution(
        database.client,
        'H3M.D1',
        primaryKeysByTable('D'),
      ),
      corpusProfileId: 'H3M.D1',
      profileRows: profileRows(),
      expectedCounts: expectedCounts('D'),
    };

    const receipt = await seedH1Database(input);

    const inserts = database.queries.filter((query) =>
      isInsertQuery(query.text),
    );
    expect(inserts).toHaveLength(707);
    expect(inserts[689]?.values).toContain('authority-0687');
    expect(insertsTable(inserts[690]!.text, 'delegation')).toBe(true);
    expect(inserts[690]?.values).toContain('delegation-00');
    expect(inserts[703]?.values).toContain('delegation-13');
    expect(inserts[704]?.values).toContain('authority-0688');
    expect(inserts[705]?.values).toContain('authority-0689');
    expect(insertsTable(inserts[706]!.text, 'bulk_parent')).toBe(true);
    expect(receipt).toMatchObject({
      corpusProfileId: 'H3M.D1',
      profileRowCount: 14,
      totalRowCount: 709,
      reconciledCountPartitionCount: 8,
    });
    expect(receipt.profileRowsSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('materializes an E3 profile as exactly two phase-55 entitlement rows with exact-PK readback', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      ...retainedExecution(
        database.client,
        'H3M.E3',
        primaryKeysByTable('E'),
      ),
      corpusProfileId: 'H3M.E3',
      profileRows: entitlementProfileRows('E3'),
      expectedCounts: expectedCounts('E'),
    };

    const receipt = await seedH1Database(input);
    const inserts = database.queries.filter((query) =>
      isInsertQuery(query.text),
    );

    expect(inserts).toHaveLength(695);
    expect(
      insertsTable(inserts[690]!.text, 'tenant_module_entitlement'),
    ).toBe(true);
    expect(
      insertsTable(inserts[691]!.text, 'tenant_module_entitlement'),
    ).toBe(true);
    expect(inserts[692]?.values).toContain('authority-0688');
    expect(receipt).toMatchObject({
      corpusProfileId: 'H3M.E3',
      profileRowCount: 2,
      totalRowCount: 697,
      reconciledCountPartitionCount: 8,
    });
    expect(
      database.queries.filter((query) =>
        query.text.includes(
          'FROM public."tenant_module_entitlement" WHERE "tenant_id" = $1 AND "module_key" = $2',
        ),
      ),
    ).toHaveLength(2);
  });

  it('stable-merges P1 entitlement rows at phase 55 and participant rows at phase 65', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      ...retainedExecution(
        database.client,
        'H3M.P1',
        primaryKeysByTable('P'),
      ),
      corpusProfileId: 'H3M.P1',
      profileRows: participantProfileRows(),
      expectedCounts: expectedCounts('P'),
    };

    const receipt = await seedH1Database(input);
    const inserts = database.queries.filter((query) =>
      isInsertQuery(query.text),
    );

    expect(inserts).toHaveLength(709);
    expect(
      insertsTable(inserts[690]!.text, 'tenant_module_entitlement'),
    ).toBe(true);
    expect(
      insertsTable(inserts[691]!.text, 'tenant_module_entitlement'),
    ).toBe(true);
    expect(inserts[692]?.values).toContain('authority-0688');
    expect(inserts[693]?.values).toContain('authority-0689');
    expect(
      insertsTable(inserts[694]!.text, 'comms_thread_participant'),
    ).toBe(true);
    expect(
      insertsTable(inserts[707]!.text, 'comms_thread_participant'),
    ).toBe(true);
    expect(insertsTable(inserts[708]!.text, 'bulk_parent')).toBe(true);
    expect(receipt).toMatchObject({
      corpusProfileId: 'H3M.P1',
      profileRowCount: 16,
      totalRowCount: 711,
      reconciledCountPartitionCount: 10,
    });
  });

  it('RED: refuses an E-profile state mismatch before any DB event', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      corpusProfileId: 'H3M.E2',
      profileRows: entitlementProfileRows('E1'),
      expectedCounts: expectedCounts('E'),
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_PROFILE_INVALID',
      stage: 'profile-state-binding',
    });
    expect(database.queries).toEqual([]);
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([]);
    expect(
      retainedBoundary.transactions.get(input.retainedTransaction)
        ?.consumed,
    ).toBe(false);
  });

  it('RED: refuses P1 with a missing participant before any DB event', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      corpusProfileId: 'H3M.P1',
      profileRows: participantProfileRows().slice(0, -1),
      expectedCounts: expectedCounts('P'),
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_PROFILE_INVALID',
      stage: 'profile-row-count',
    });
    expect(database.queries).toEqual([]);
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([]);
    expect(
      retainedBoundary.transactions.get(input.retainedTransaction)
        ?.consumed,
    ).toBe(false);
  });

  it('RED: refuses P1 with a mixed delegation row before any DB event', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const rows = [...participantProfileRows()];
    rows[2] = {
      ...profileRows('D1')[0]!,
      phase: 65,
    };
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      corpusProfileId: 'H3M.P1',
      profileRows: rows,
      expectedCounts: expectedCounts('P'),
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_PROFILE_INVALID',
      stage: 'profile-row-shape',
    });
    expect(database.queries).toEqual([]);
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([]);
    expect(
      retainedBoundary.transactions.get(input.retainedTransaction)
        ?.consumed,
    ).toBe(false);
  });

  it('RED: rolls back when D0 absence readback finds an undeclared delegation row', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      if (
        text ===
        'SELECT count(*)::text AS row_count FROM public."delegation"'
      ) {
        database.queries.push({ text, values: values ?? [] });
        return { rows: [{ row_count: '1' }], rowCount: 1 };
      }
      return originalQuery(text, values);
    };
    const { input } = validInput(database);

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_COUNT_MISMATCH',
      stage: 'profile-table-readback',
      rolledBack: true,
    });
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('RED: rolls back when an E profile primary-key presence readback is missing', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      if (
        text.includes(
          'FROM public."tenant_module_entitlement" WHERE "tenant_id" = $1 AND "module_key" = $2',
        )
      ) {
        database.queries.push({ text, values: values ?? [] });
        return { rows: [{ row_count: '0' }], rowCount: 1 };
      }
      return originalQuery(text, values);
    };
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      ...retainedExecution(
        database.client,
        'H3M.E4',
        primaryKeysByTable('E'),
      ),
      corpusProfileId: 'H3M.E4',
      profileRows: entitlementProfileRows('E4'),
      expectedCounts: expectedCounts('E'),
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_COUNT_MISMATCH',
      stage: 'profile-primary-key-readback',
      rolledBack: true,
    });
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('RED: rejects a non-key value mutation even when counts and primary keys still match', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      const result = await originalQuery(text, values);
      if (
        text.startsWith('WITH specs AS (') &&
        text.includes('NULL::public."authority_row"')
      ) {
        const rows = [...result.rows];
        const actualIndex = rows.findIndex(
          (row) => row['kind'] === 'actual',
        );
        const first = { ...rows[actualIndex]! };
        const actual = JSON.parse(
          String(first['value_json']),
        ) as Record<string, unknown>;
        first['value_json'] = JSON.stringify({
          ...actual,
          name: 'mutated-after-insert',
        });
        rows[actualIndex] = first;
        return { rows, rowCount: result.rowCount };
      }
      return result;
    };
    const { input } = validInput(database);

    let observed: unknown;
    try {
      await seedH1Database(input);
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({
      code: 'H1_DATABASE_READBACK_MISMATCH',
      stage: 'catalog-readback-key-value',
      rolledBack: true,
    });
    expect(observed).not.toHaveProperty('receipt');
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('RED: captures a database-generated manifest key and still rejects a post-insert non-key mutation', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      const result = await originalQuery(text, values);
      if (
        text.startsWith('WITH specs AS (') &&
        text.includes('NULL::public."authority_row"')
      ) {
        const rows = [...result.rows];
        const generatedIndex = rows.findIndex(
          (row) =>
            row['kind'] === 'actual' &&
            String(row['identity']).includes(
              'authority_row-generated-',
            ),
        );
        if (generatedIndex < 0) {
          throw new Error('generated key did not reach final readback');
        }
        const changed = { ...rows[generatedIndex]! };
        const actual = JSON.parse(
          String(changed['value_json']),
        ) as Record<string, unknown>;
        changed['value_json'] = JSON.stringify({
          ...actual,
          name: 'mutated-generated-key-row',
        });
        rows[generatedIndex] = changed;
        return { rows, rowCount: result.rowCount };
      }
      return result;
    };
    const prepared = validInput(database);
    const rows = [...prepared.input.authorityRows];
    const generated = rows[2]!;
    const { id: _databaseDefault, ...valuesWithoutId } =
      generated.values;
    rows[2] = {
      ...generated,
      values: valuesWithoutId,
    };
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      authorityRows: rows,
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_READBACK_MISMATCH',
      stage: 'catalog-readback-key-value',
      rolledBack: true,
    });
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('RED: rejects a same-shape final-value permutation across captured primary keys', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      const result = await originalQuery(text, values);
      if (
        text.startsWith('WITH specs AS (') &&
        text.includes('NULL::public."authority_row"')
      ) {
        const rows = [...result.rows];
        const actualIndexes = rows
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => row['kind'] === 'actual');
        const pair = actualIndexes
          .flatMap((left, leftIndex) =>
            actualIndexes
              .slice(leftIndex + 1)
              .map((right) => ({ left, right })),
          )
          .find(
            ({ left, right }) =>
              left.row['shape_id'] === right.row['shape_id'] &&
              left.row['value_json'] !== right.row['value_json'],
          );
        if (pair === undefined) {
          throw new Error('same-shape readback pair not found');
        }
        const left = { ...rows[pair.left.index]! };
        const right = { ...rows[pair.right.index]! };
        const leftValue = left['value_json'];
        left['value_json'] = right['value_json'];
        right['value_json'] = leftValue;
        rows[pair.left.index] = left;
        rows[pair.right.index] = right;
        return { rows, rowCount: result.rowCount };
      }
      return result;
    };
    const { input } = validInput(database);

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_READBACK_MISMATCH',
      stage: 'catalog-readback-key-value',
      rolledBack: true,
    });
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('RED: refuses a D1 profile/count mismatch before target consumption', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      corpusProfileId: 'H3M.D1',
      profileRows: [],
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_PROFILE_INVALID',
      stage: 'profile-row-count',
    });
    expect(database.queries).toEqual([]);
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([]);
    expect(
      retainedBoundary.transactions.get(input.retainedTransaction)
        ?.consumed,
    ).toBe(false);
  });

  it('RED: refuses D-state contamination even when the foreign profile has the right count and shape', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      corpusProfileId: 'H3M.D1',
      profileRows: profileRows('D2'),
      expectedCounts: expectedCounts('D'),
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_PROFILE_INVALID',
      stage: 'profile-state-binding',
    });
    expect(database.queries).toEqual([]);
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([]);
    expect(
      retainedBoundary.transactions.get(input.retainedTransaction)
        ?.consumed,
    ).toBe(false);
  });

  it('fails before any DB event and leaves H0 unconsumed when the expected-count plan omits a partition', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName);
    const prepared = validInput(database);
    const input: H1DatabaseSeedInput = {
      ...prepared.input,
      expectedCounts: expectedCounts().slice(0, -1),
    };

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_EXPECTED_COUNTS_INVALID',
    });
    expect(database.queries).toEqual([]);
    expect(input.sideEffectLedger?.attemptedEvents).toEqual([]);
    expect(
      retainedBoundary.transactions.get(input.retainedTransaction)
        ?.consumed,
    ).toBe(false);
  });

  it('attests the complete migration ledger before the first insert and rolls back a mismatch', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName, (text) =>
      text ===
      'SELECT id, checksum FROM public."_migrations" ORDER BY id'
        ? undefined
        : undefined,
    );
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      if (
        text ===
        'SELECT id, checksum FROM public."_migrations" ORDER BY id'
      ) {
        return {
          rows: pinLedgerRows().slice(0, -1),
          rowCount: 94,
        };
      }
      return originalQuery(text, values);
    };
    const { input } = validInput(database);

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_MIGRATION_LEDGER_MISMATCH',
    });
    expect(
      database.queries.some((query) => isInsertQuery(query.text)),
    ).toBe(false);
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('turns SQLSTATE 57014 into a typed terminal failure with one rollback, no retry, and no receipt', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    let timedOut = false;
    const database = mockDatabase(databaseName, (text) => {
      if (
        !timedOut &&
        insertsTable(text, 'bulk_parent')
      ) {
        timedOut = true;
        return Object.assign(new Error('cancelled'), { code: '57014' });
      }
      return undefined;
    });
    const { input } = validInput(database);

    let observed: unknown;
    try {
      await seedH1Database(input);
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(H1DatabaseSeedError);
    expect(observed).toMatchObject({
      code: 'H1_DATABASE_STATEMENT_TIMEOUT_57014',
      sqlState: '57014',
      rolledBack: true,
    });
    expect(observed).not.toHaveProperty('receipt');
    expect(observed).not.toHaveProperty('rowCount');
    expect(
      database.queries.filter((query) =>
        insertsTable(query.text, 'bulk_parent'),
      ),
    ).toHaveLength(1);
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('rolls back when readback counts differ and never reports the precomputed plan as actual', async () => {
    const databaseName = `c3_hearth_search_seed_${runSequence + 1}`;
    const database = mockDatabase(databaseName, (text) => {
      if (
        text ===
        'SELECT count(*)::text AS row_count FROM public."bulk_parent"'
      ) {
        return new Error('inject via wrapper below');
      }
      return undefined;
    });
    const originalQuery = database.client.query;
    database.client.query = async (text, values) => {
      if (
        text ===
        'SELECT count(*)::text AS row_count FROM public."bulk_parent"'
      ) {
        database.queries.push({ text, values: values ?? [] });
        return { rows: [{ row_count: '2' }], rowCount: 1 };
      }
      return originalQuery(text, values);
    };
    const { input } = validInput(database);

    await expect(seedH1Database(input)).rejects.toMatchObject({
      code: 'H1_DATABASE_COUNT_MISMATCH',
    });
    expect(
      database.queries.filter((query) => query.text === 'ROLLBACK'),
    ).toHaveLength(1);
    expect(
      database.queries.some((query) => query.text === 'COMMIT'),
    ).toBe(false);
  });

  it('makes receipt identity depend on row content without serializing row content', async () => {
    const rows = authorityRows();
    expect(canonicalSha256(rows)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      canonicalSha256([
        ...rows.slice(0, -1),
        {
          ...rows.at(-1)!,
          values: { ...rows.at(-1)!.values, name: 'changed' },
        },
      ]),
    ).not.toBe(canonicalSha256(rows));
  });
});
