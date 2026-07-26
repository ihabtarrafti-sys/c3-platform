import { canonicalSha256 } from '../canonical.js';

export type H1TenantSlot = 'T01' | 'T02';
export type H1DelegationState = 'D0' | 'D1' | 'D2' | 'D3' | 'D4';

export class H1SeedPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'H1SeedPlanError';
  }
}

export interface H1AuthoritySeedRow {
  readonly rowId: string;
  readonly phase: number;
  readonly table: string;
  readonly tenantSlot: H1TenantSlot | null;
  readonly values: Readonly<Record<string, unknown>>;
  readonly source?: unknown;
  readonly legacyBaselineProjection?: unknown;
}

export interface H1ValidatedPhysicalSeedPlan {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly planVersion: 'HEARTH-003-PHYSICAL-SEED-PLAN-v4';
  readonly sourceCommit: 'dae27a400868c0c686788ab8e5520690dbf77334';
  readonly rowCount: 692;
  readonly searchableBindingRowCount: 634;
  readonly rows: readonly H1AuthoritySeedRow[];
  readonly phaseTableCounts: Readonly<Record<string, number>>;
  readonly rowsCanonicalSha256: string;
}

export interface H1DelegationCorpusProfile {
  readonly corpusProfileId:
    | 'H3M.D0'
    | 'H3M.D1'
    | 'H3M.D2'
    | 'H3M.D3'
    | 'H3M.D4';
  readonly delegationState: H1DelegationState;
  readonly baseAuthorityRowCount: 692;
  readonly delegationRowCount: 0 | 14;
  readonly expectedAuthorityRowCount: 692 | 706;
  readonly exactDelegationRowIds: readonly string[];
  readonly rows: readonly H1AuthoritySeedRow[];
}

export interface H1ValidatedDelegationSeedProfiles {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly mutuallyExclusive: true;
  readonly profiles: readonly H1DelegationCorpusProfile[];
  readonly profileManifestSha256: string;
}

export type H1AcceptanceCorpusProfileId =
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

export interface H1AcceptanceSeedProfile {
  readonly corpusProfileId: H1AcceptanceCorpusProfileId;
  readonly stateComposition: {
    readonly entitlementState: 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
    readonly delegationState: H1DelegationState;
    readonly participantState: 'P0' | 'P1';
  };
  readonly baseAuthorityRowCount: 692;
  readonly deltaRowCount: 0 | 2 | 14 | 16;
  readonly expectedAuthorityRowCount: 692 | 694 | 706 | 708;
  readonly exactDeltaRowIds: readonly string[];
  readonly rows: readonly H1AuthoritySeedRow[];
  readonly authorityBinding:
    | 'authority-baseline-absence'
    | 'delegation-measurement-v2'
    | 'fixture-v5-entitlement-overlays'
    | 'fixture-v5-participant-template-expansion';
}

export interface H1ValidatedAcceptanceSeedProfiles {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly profileExecutionIds: readonly H1AcceptanceCorpusProfileId[];
  readonly profiles: readonly H1AcceptanceSeedProfile[];
  readonly isolatedExecutionRequired: true;
  readonly acceptanceProfileManifestSha256: string;
}

const EXPECTED_PHASE_TABLE_COUNTS = Object.freeze({
  '0:tenant': 2,
  '1:app_user': 14,
  '2:tenant_membership': 14,
  '3:role_assignment': 14,
  '10:entity': 46,
  '10:person': 170,
  '10:team': 19,
  '20:approval': 32,
  '20:mission': 78,
  '30:agreement': 41,
  '30:apparel': 16,
  '30:beneficiary': 18,
  '30:claim': 30,
  '30:credential': 17,
  '30:journey': 17,
  '30:kit': 16,
  '40:agreement_term': 17,
  '40:mission_line': 51,
  '50:distribution': 11,
  '50:invoice': 24,
  '60:comms_thread': 2,
  '70:comms_message': 1,
  '70:comms_obligation': 5,
  '80:document': 31,
  '90:comms_document_attachment': 1,
  '90:comms_evidence_delivery': 5,
} satisfies Readonly<Record<string, number>>);

const EXPECTED_DELEGATION_PROFILES = Object.freeze([
  ['H3M.D0', 'D0', 0, 692],
  ['H3M.D1', 'D1', 14, 706],
  ['H3M.D2', 'D2', 14, 706],
  ['H3M.D3', 'D3', 14, 706],
  ['H3M.D4', 'D4', 14, 706],
] as const);

const EXPECTED_ACCEPTANCE_PROFILE_IDS = Object.freeze([
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
] as const);

const BASE_ROW_KEYS = new Set(['rowId', 'phase', 'table', 'tenantSlot', 'values']);
const OPTIONAL_ROW_KEYS = new Set(['source', 'approvedProjection']);

function fail(message: string): never {
  throw new H1SeedPlanError(message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${path} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function asInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    fail(`${path} must be a safe integer`);
  }
  return value as number;
}

function exactString(
  value: unknown,
  expected: string,
  path: string,
): void {
  if (value !== expected) {
    fail(`${path} must equal ${expected}`);
  }
}

function exactNumber(
  value: unknown,
  expected: number,
  path: string,
): void {
  if (value !== expected) {
    fail(`${path} must equal ${expected}`);
  }
}

function exactBoolean(
  value: unknown,
  expected: boolean,
  path: string,
): void {
  if (value !== expected) {
    fail(`${path} must equal ${String(expected)}`);
  }
}

function assertExactSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (actual.length !== new Set(actual).size) {
    fail(`${path} contains duplicates`);
  }
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    fail(`${path} does not match the authority-declared set`);
  }
}

function validateSeedRow(
  input: unknown,
  path: string,
  mode: 'baseline' | 'delegation' | 'entitlement' | 'participant',
): H1AuthoritySeedRow {
  const row = asRecord(input, path);
  const keys = Object.keys(row);
  for (const key of keys) {
    if (!BASE_ROW_KEYS.has(key) && !OPTIONAL_ROW_KEYS.has(key)) {
      fail(`${path} contains unknown key ${key}`);
    }
  }
  for (const key of BASE_ROW_KEYS) {
    if (!(key in row)) {
      fail(`${path} is missing ${key}`);
    }
  }

  const rowId = asString(row['rowId'], `${path}.rowId`);
  const phase = asInteger(row['phase'], `${path}.phase`);
  const table = asString(row['table'], `${path}.table`);
  const tenantSlot = row['tenantSlot'];
  if (
    tenantSlot !== null &&
    tenantSlot !== 'T01' &&
    tenantSlot !== 'T02'
  ) {
    fail(`${path}.tenantSlot must be T01, T02, or null`);
  }
  const values = asRecord(row['values'], `${path}.values`);
  if (Object.keys(values).length === 0) {
    fail(`${path}.values must not be empty`);
  }
  canonicalSha256(values);

  const hasSource = Object.hasOwn(row, 'source');
  const hasProjection = Object.hasOwn(row, 'approvedProjection');
  if (hasSource !== hasProjection) {
    fail(`${path} must bind source and approvedProjection together`);
  }

  if (mode !== 'baseline') {
    const expected =
      mode === 'delegation'
        ? { phase: 55, table: 'delegation' }
        : mode === 'entitlement'
          ? { phase: 55, table: 'tenant_module_entitlement' }
          : { phase: 65, table: 'comms_thread_participant' };
    if (phase !== expected.phase || table !== expected.table) {
      fail(
        `${path} must be a phase-${expected.phase} ${expected.table} row`,
      );
    }
    if (hasSource || hasProjection || tenantSlot === null) {
      fail(`${path} is not a valid ${mode} overlay row`);
    }
  } else {
    const key = `${phase}:${table}`;
    if (!(key in EXPECTED_PHASE_TABLE_COUNTS)) {
      fail(`${path} has unauthorized phase/table pair ${key}`);
    }
    if (table === 'app_user' ? tenantSlot !== null : tenantSlot === null) {
      fail(
        `${path}.tenantSlot must be null only for authority app_user rows`,
      );
    }
  }

  return Object.freeze({
    rowId,
    phase,
    table,
    tenantSlot,
    values,
    ...(hasSource
      ? {
          source: row['source'],
          // Fixture-v5's legacy input key is baseline output, not approval.
          legacyBaselineProjection: row['approvedProjection'],
        }
      : {}),
  });
}

/**
 * Validates the exact r6 authority baseline before any seeder can consume it.
 *
 * This checks mechanical row/phase/table structure only. It does not interpret
 * any qrel judgment and does not claim that the pinned baseline is correct.
 */
export function validatePhysicalSeedPlan(
  input: unknown,
): H1ValidatedPhysicalSeedPlan {
  const plan = asRecord(input, 'physicalSeedPlan');
  exactNumber(plan['schemaVersion'], 4, 'physicalSeedPlan.schemaVersion');
  exactString(
    plan['artifactKind'],
    'hearth-search-physical-seed-plan',
    'physicalSeedPlan.artifactKind',
  );
  exactString(
    plan['planVersion'],
    'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
    'physicalSeedPlan.planVersion',
  );
  exactBoolean(
    plan['syntheticOnly'],
    true,
    'physicalSeedPlan.syntheticOnly',
  );
  exactString(
    plan['authority'],
    'Apex Lumen',
    'physicalSeedPlan.authority',
  );
  exactString(
    plan['sourceCommit'],
    'dae27a400868c0c686788ab8e5520690dbf77334',
    'physicalSeedPlan.sourceCommit',
  );

  const rawRows = asArray(plan['rows'], 'physicalSeedPlan.rows');
  exactNumber(rawRows.length, 692, 'physicalSeedPlan.rows.length');
  const rows = rawRows.map((row, index) =>
    validateSeedRow(row, `physicalSeedPlan.rows[${index}]`, 'baseline'),
  );

  const rowIds = rows.map((row) => row.rowId);
  if (new Set(rowIds).size !== rowIds.length) {
    fail('physicalSeedPlan.rows contains duplicate rowId values');
  }

  let priorPhase = -1;
  const phaseTableCounts: Record<string, number> = {};
  let searchableBindingRowCount = 0;
  for (const row of rows) {
    if (row.phase < priorPhase) {
      fail('physicalSeedPlan.rows must remain ordered by materialization phase');
    }
    priorPhase = row.phase;
    const key = `${row.phase}:${row.table}`;
    phaseTableCounts[key] = (phaseTableCounts[key] ?? 0) + 1;
    if (row.source !== undefined) {
      searchableBindingRowCount += 1;
    }
  }

  assertExactSet(
    Object.keys(phaseTableCounts),
    Object.keys(EXPECTED_PHASE_TABLE_COUNTS),
    'physicalSeedPlan phase/table keys',
  );
  for (const [key, expected] of Object.entries(
    EXPECTED_PHASE_TABLE_COUNTS,
  )) {
    exactNumber(
      phaseTableCounts[key],
      expected,
      `physicalSeedPlan phase/table count ${key}`,
    );
  }
  exactNumber(
    searchableBindingRowCount,
    634,
    'physicalSeedPlan searchable binding row count',
  );

  return Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    planVersion: 'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
    sourceCommit: 'dae27a400868c0c686788ab8e5520690dbf77334',
    rowCount: 692,
    searchableBindingRowCount: 634,
    rows: Object.freeze(rows),
    phaseTableCounts: Object.freeze({ ...phaseTableCounts }),
    rowsCanonicalSha256: canonicalSha256(rawRows),
  });
}

/**
 * Produces five separate seed schedules. No output combines D0-D4.
 */
export function validateDelegationSeedProfiles(
  input: unknown,
): H1ValidatedDelegationSeedProfiles {
  const measurement = asRecord(input, 'delegationMeasurement');
  exactString(
    measurement['measurementVersion'],
    'HEARTH-003-DELEGATION-MEASUREMENT-v2',
    'delegationMeasurement.measurementVersion',
  );
  exactString(
    measurement['measurementStatus'],
    'NOT_YET_MEASURED',
    'delegationMeasurement.measurementStatus',
  );
  exactBoolean(
    measurement['corpusProfilesAreMutuallyExclusive'],
    true,
    'delegationMeasurement.corpusProfilesAreMutuallyExclusive',
  );
  const rawProfiles = asArray(
    measurement['corpusProfiles'],
    'delegationMeasurement.corpusProfiles',
  );
  exactNumber(rawProfiles.length, 5, 'delegationMeasurement.corpusProfiles.length');

  const profilesById = new Map(
    rawProfiles.map((value, index) => {
      const profile = asRecord(
        value,
        `delegationMeasurement.corpusProfiles[${index}]`,
      );
      return [
        asString(
          profile['corpusProfileId'],
          `delegationMeasurement.corpusProfiles[${index}].corpusProfileId`,
        ),
        profile,
      ] as const;
    }),
  );
  if (profilesById.size !== rawProfiles.length) {
    fail('delegationMeasurement.corpusProfiles contains duplicate ids');
  }

  const allOverlayRowIds = new Set<string>();
  const profiles: H1DelegationCorpusProfile[] = [];
  for (const [
    profileId,
    state,
    delegationRowCount,
    expectedRowCount,
  ] of EXPECTED_DELEGATION_PROFILES) {
    const profile = profilesById.get(profileId);
    if (profile === undefined) {
      fail(`delegationMeasurement is missing ${profileId}`);
    }
    exactString(
      profile['delegationState'],
      state,
      `${profileId}.delegationState`,
    );
    exactString(
      profile['basePlanVersion'],
      'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
      `${profileId}.basePlanVersion`,
    );
    exactNumber(
      profile['baseAuthorityRowCount'],
      692,
      `${profileId}.baseAuthorityRowCount`,
    );
    exactNumber(
      profile['delegationRowCount'],
      delegationRowCount,
      `${profileId}.delegationRowCount`,
    );
    exactNumber(
      profile['expectedAuthorityRowCount'],
      expectedRowCount,
      `${profileId}.expectedAuthorityRowCount`,
    );
    exactString(
      profile['startRule'],
      'Start from a fresh database or an attested exact clone of the authority baseline; no two H3M profiles may ever be merged.',
      `${profileId}.startRule`,
    );

    const exactDelegationRowIds = asArray(
      profile['exactDelegationRowIds'],
      `${profileId}.exactDelegationRowIds`,
    ).map((value, index) =>
      asString(value, `${profileId}.exactDelegationRowIds[${index}]`),
    );
    const rows = asArray(profile['rows'], `${profileId}.rows`).map(
      (row, index) =>
        validateSeedRow(row, `${profileId}.rows[${index}]`, 'delegation'),
    );
    exactNumber(
      exactDelegationRowIds.length,
      delegationRowCount,
      `${profileId}.exactDelegationRowIds.length`,
    );
    exactNumber(rows.length, delegationRowCount, `${profileId}.rows.length`);
    assertExactSet(
      rows.map((row) => row.rowId),
      exactDelegationRowIds,
      `${profileId} row ids`,
    );

    const tenantCounts = { T01: 0, T02: 0 };
    for (const row of rows) {
      if (allOverlayRowIds.has(row.rowId)) {
        fail(`delegation row ${row.rowId} appears in more than one profile`);
      }
      allOverlayRowIds.add(row.rowId);
      if (row.tenantSlot === null) {
        fail(`${profileId} contains a delegation row without a tenant`);
      }
      tenantCounts[row.tenantSlot] += 1;
    }
    if (state !== 'D0') {
      exactNumber(tenantCounts.T01, 7, `${profileId} T01 delegation rows`);
      exactNumber(tenantCounts.T02, 7, `${profileId} T02 delegation rows`);
    }

    profiles.push(
      Object.freeze({
        corpusProfileId: profileId,
        delegationState: state,
        baseAuthorityRowCount: 692,
        delegationRowCount,
        expectedAuthorityRowCount: expectedRowCount,
        exactDelegationRowIds: Object.freeze(exactDelegationRowIds),
        rows: Object.freeze(rows),
      }),
    );
  }

  const manifest = {
    artifactKind: 'hearth-search-h1-delegation-seed-plan',
    measurementStatus: 'NOT_YET_MEASURED',
    profiles: profiles.map((profile) => ({
      baseAuthorityRowCount: profile.baseAuthorityRowCount,
      corpusProfileId: profile.corpusProfileId,
      delegationRowCount: profile.delegationRowCount,
      delegationState: profile.delegationState,
      expectedAuthorityRowCount: profile.expectedAuthorityRowCount,
      rowIds: profile.exactDelegationRowIds,
      rowsCanonicalSha256: canonicalSha256(profile.rows),
    })),
    schedulingRule: 'fresh-database-or-attested-exact-baseline-clone-per-profile',
  };

  return Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    mutuallyExclusive: true,
    profiles: Object.freeze(profiles),
    profileManifestSha256: canonicalSha256(manifest),
  });
}

function exactOrderedStrings(
  value: unknown,
  expected: readonly string[],
  path: string,
): string[] {
  const actual = asArray(value, path).map((entry, index) =>
    asString(entry, `${path}[${index}]`),
  );
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    fail(`${path} does not match the authority-declared order`);
  }
  return actual;
}

function stateComposition(
  value: unknown,
  expected: Readonly<{
    entitlementState: string;
    delegationState: string;
    participantState: string;
  }>,
  path: string,
): void {
  const composition = asRecord(value, path);
  exactString(
    composition['entitlementState'],
    expected.entitlementState,
    `${path}.entitlementState`,
  );
  exactString(
    composition['delegationState'],
    expected.delegationState,
    `${path}.delegationState`,
  );
  exactString(
    composition['participantState'],
    expected.participantState,
    `${path}.participantState`,
  );
}

function rowMap(
  rows: readonly H1AuthoritySeedRow[],
  path: string,
): ReadonlyMap<string, H1AuthoritySeedRow> {
  const byId = new Map<string, H1AuthoritySeedRow>();
  for (const row of rows) {
    if (byId.has(row.rowId)) {
      fail(`${path} contains duplicate row ${row.rowId}`);
    }
    byId.set(row.rowId, row);
  }
  return byId;
}

function assertRowsEqual(
  actual: readonly H1AuthoritySeedRow[],
  expected: readonly H1AuthoritySeedRow[],
  path: string,
): void {
  assertExactSet(
    actual.map((row) => row.rowId),
    expected.map((row) => row.rowId),
    `${path} row ids`,
  );
  const actualById = rowMap(actual, `${path}.actual`);
  for (const expectedRow of expected) {
    const actualRow = actualById.get(expectedRow.rowId);
    if (
      actualRow === undefined ||
      canonicalSha256(actualRow) !== canonicalSha256(expectedRow)
    ) {
      fail(`${path} row ${expectedRow.rowId} is misbound`);
    }
  }
}

function validateOverlayScenarioForRow(
  overlayScenarios: readonly unknown[],
  baselineRowIds: readonly string[],
  expectedRow: H1AuthoritySeedRow,
  mode: 'delegation' | 'entitlement' | 'participant',
): void {
  const scenarioId = expectedRow.rowId.replace(/\.row$/u, '');
  const matches = overlayScenarios.filter((value) => {
    const scenario = asRecord(value, 'physicalSeedPlan.overlayScenario');
    return scenario['scenarioId'] === scenarioId;
  });
  exactNumber(
    matches.length,
    1,
    `physical overlay scenario count for ${scenarioId}`,
  );
  const scenario = asRecord(matches[0], `physical overlay ${scenarioId}`);
  exactString(scenario['expected'], 'accept', `${scenarioId}.expected`);
  assertExactSet(
    asArray(scenario['baseRowIds'], `${scenarioId}.baseRowIds`).map(
      (value, index) =>
        asString(value, `${scenarioId}.baseRowIds[${index}]`),
    ),
    baselineRowIds,
    `${scenarioId}.baseRowIds`,
  );
  const rows = asArray(scenario['rows'], `${scenarioId}.rows`).map(
    (value, index) =>
      validateSeedRow(value, `${scenarioId}.rows[${index}]`, mode),
  );
  exactNumber(rows.length, 1, `${scenarioId}.rows.length`);
  assertRowsEqual(rows, [expectedRow], scenarioId);
}

function validateEmptyOverlayScenario(
  overlayScenarios: readonly unknown[],
  baselineRowIds: readonly string[],
  scenarioId: string,
): void {
  const matches = overlayScenarios.filter(
    (value) =>
      asRecord(value, 'physicalSeedPlan.overlayScenario')['scenarioId'] ===
      scenarioId,
  );
  exactNumber(matches.length, 1, `physical overlay scenario count for ${scenarioId}`);
  const scenario = asRecord(matches[0], `physical overlay ${scenarioId}`);
  exactString(scenario['expected'], 'accept', `${scenarioId}.expected`);
  assertExactSet(
    asArray(scenario['baseRowIds'], `${scenarioId}.baseRowIds`).map(
      (value, index) =>
        asString(value, `${scenarioId}.baseRowIds[${index}]`),
    ),
    baselineRowIds,
    `${scenarioId}.baseRowIds`,
  );
  exactNumber(
    asArray(scenario['rows'], `${scenarioId}.rows`).length,
    0,
    `${scenarioId}.rows.length`,
  );
}

function actorUserIdsByTenantRole(
  measurement: Record<string, unknown>,
  roles: readonly string[],
): ReadonlyMap<string, string> {
  const catalog = asArray(
    measurement['actorProfileCatalog'],
    'delegationMeasurement.actorProfileCatalog',
  );
  exactNumber(catalog.length, 140, 'actorProfileCatalog.length');
  const ids = new Map<string, string>();
  for (let index = 0; index < catalog.length; index += 1) {
    const profile = asRecord(catalog[index], `actorProfileCatalog[${index}]`);
    const tenantSlot = asString(
      profile['tenantSlot'],
      `actorProfileCatalog[${index}].tenantSlot`,
    );
    const role = asString(
      profile['role'],
      `actorProfileCatalog[${index}].role`,
    );
    if (
      (tenantSlot !== 'T01' && tenantSlot !== 'T02') ||
      !roles.includes(role)
    ) {
      fail(`actorProfileCatalog[${index}] has an unknown actor coordinate`);
    }
    const actorUserId = asString(
      profile['actorUserId'],
      `actorProfileCatalog[${index}].actorUserId`,
    );
    const key = `${tenantSlot}\0${role}`;
    const prior = ids.get(key);
    if (prior !== undefined && prior !== actorUserId) {
      fail(`actorProfileCatalog has conflicting actor id for ${key}`);
    }
    ids.set(key, actorUserId);
  }
  exactNumber(ids.size, 14, 'actorProfileCatalog physical actor count');
  return ids;
}

function profileEntryById(
  entries: readonly unknown[],
  profileId: string,
  path: string,
): Record<string, unknown> {
  const matches = entries.filter(
    (value) =>
      asRecord(value, path)['corpusProfileId'] === profileId,
  );
  exactNumber(matches.length, 1, `${path} ${profileId} count`);
  return asRecord(matches[0], `${path}.${profileId}`);
}

function validateDeltaProfile(
  entry: Record<string, unknown>,
  profileId: H1AcceptanceCorpusProfileId,
  expectedComposition: Readonly<{
    entitlementState: string;
    delegationState: string;
    participantState: string;
  }>,
  expectedDeltaCount: 2 | 16,
  expectedTotalCount: 694 | 708,
  modeForRow: (rowId: string) => 'entitlement' | 'participant',
  expectedRows: readonly H1AuthoritySeedRow[],
): H1AcceptanceSeedProfile {
  stateComposition(
    entry['stateComposition'],
    expectedComposition,
    `${profileId}.stateComposition`,
  );
  exactString(
    entry['basePlanVersion'],
    'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
    `${profileId}.basePlanVersion`,
  );
  exactNumber(
    entry['baseAuthorityRowCount'],
    692,
    `${profileId}.baseAuthorityRowCount`,
  );
  exactNumber(
    entry['deltaRowCount'],
    expectedDeltaCount,
    `${profileId}.deltaRowCount`,
  );
  exactNumber(
    entry['expectedAuthorityRowCount'],
    expectedTotalCount,
    `${profileId}.expectedAuthorityRowCount`,
  );
  exactString(
    entry['startRule'],
    'Start from a fresh database or an attested exact clone of the authority baseline; no H3M profile may be merged with another.',
    `${profileId}.startRule`,
  );
  const rowIds = asArray(
    entry['exactDeltaRowIds'],
    `${profileId}.exactDeltaRowIds`,
  ).map((value, index) =>
    asString(value, `${profileId}.exactDeltaRowIds[${index}]`),
  );
  const rows = asArray(entry['rows'], `${profileId}.rows`).map(
    (value, index) => {
      const candidate = asRecord(value, `${profileId}.rows[${index}]`);
      const rowId = asString(
        candidate['rowId'],
        `${profileId}.rows[${index}].rowId`,
      );
      return validateSeedRow(
        value,
        `${profileId}.rows[${index}]`,
        modeForRow(rowId),
      );
    },
  );
  exactNumber(rows.length, expectedDeltaCount, `${profileId}.rows.length`);
  assertExactSet(
    rows.map((row) => row.rowId),
    rowIds,
    `${profileId}.exactDeltaRowIds`,
  );
  assertRowsEqual(rows, expectedRows, profileId);
  return Object.freeze({
    corpusProfileId: profileId,
    stateComposition: Object.freeze({
      entitlementState:
        expectedComposition.entitlementState as 'E1' | 'E2' | 'E3' | 'E4',
      delegationState: 'D0',
      participantState:
        expectedComposition.participantState as 'P0' | 'P1',
    }),
    baseAuthorityRowCount: 692,
    deltaRowCount: expectedDeltaCount,
    expectedAuthorityRowCount: expectedTotalCount,
    exactDeltaRowIds: Object.freeze(rowIds),
    rows: Object.freeze(rows),
    authorityBinding:
      profileId === 'H3M.P1'
        ? 'fixture-v5-participant-template-expansion'
        : 'fixture-v5-entitlement-overlays',
  });
}

/**
 * Validates the complete ten-execution r6 acceptance schedule.
 *
 * Every execution starts from the same 692-row authority baseline. The function
 * consumes only authority-declared rows/templates and never merges profiles.
 */
export function validateAcceptanceSeedProfiles(
  fixtureInput: unknown,
  actorClassesInput: unknown,
  delegationMeasurementInput: unknown,
): H1ValidatedAcceptanceSeedProfiles {
  const fixture = asRecord(fixtureInput, 'fixture');
  exactString(
    fixture['fixtureVersion'],
    'HEARTH-003-FIXTURES-v5',
    'fixture.fixtureVersion',
  );
  const physical = validatePhysicalSeedPlan(fixture['physicalSeedPlan']);
  const physicalPlan = asRecord(
    fixture['physicalSeedPlan'],
    'fixture.physicalSeedPlan',
  );
  const baselineRowIds = physical.rows.map((row) => row.rowId);
  const overlayScenarios = asArray(
    physicalPlan['overlayScenarios'],
    'physicalSeedPlan.overlayScenarios',
  );
  exactNumber(
    overlayScenarios.length,
    71,
    'physicalSeedPlan.overlayScenarios.length',
  );
  const tenantIds = asRecord(
    physicalPlan['tenantIds'],
    'physicalSeedPlan.tenantIds',
  );
  exactString(
    tenantIds['T01'],
    '00000000-0000-4000-8000-000000000001',
    'physicalSeedPlan.tenantIds.T01',
  );
  exactString(
    tenantIds['T02'],
    '00000000-0000-4000-8000-000000000002',
    'physicalSeedPlan.tenantIds.T02',
  );

  const actorClasses = asRecord(actorClassesInput, 'actorClasses');
  exactString(
    actorClasses['actorClassVersion'],
    'HEARTH-003-ACTOR-CLASSES-v2',
    'actorClasses.actorClassVersion',
  );
  const roles = exactOrderedStrings(
    actorClasses['roles'],
    ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'],
    'actorClasses.roles',
  );
  const roleSets = asRecord(actorClasses['roleSets'], 'actorClasses.roleSets');
  exactOrderedStrings(roleSets['ALL'], roles, 'actorClasses.roleSets.ALL');

  const measurement = asRecord(
    delegationMeasurementInput,
    'delegationMeasurement',
  );
  const delegation = validateDelegationSeedProfiles(measurement);
  const suite = asRecord(
    measurement['h4AcceptanceProfileSuite'],
    'delegationMeasurement.h4AcceptanceProfileSuite',
  );
  exactString(
    suite['compositionRule'],
    'Sparse declared composition, never an inferred E x D x P Cartesian product. Every profile execution starts from a fresh database or exact baseline clone.',
    'h4AcceptanceProfileSuite.compositionRule',
  );
  exactString(
    suite['completeRunRule'],
    'One complete H4 acceptance run closes all ten isolated executions. The independent repeat recreates all ten on fresh databases. All share the identical baseline/bulk digest and runtime pins; only the authority-declared delta rows differ.',
    'h4AcceptanceProfileSuite.completeRunRule',
  );
  exactString(
    suite['absentStateRule'],
    'D0, E0, and P0 are proved by post-seed readback in the measured database, never by a zero-statement disposable overlay.',
    'h4AcceptanceProfileSuite.absentStateRule',
  );
  const profileExecutionIds = exactOrderedStrings(
    suite['profileExecutionIds'],
    EXPECTED_ACCEPTANCE_PROFILE_IDS,
    'h4AcceptanceProfileSuite.profileExecutionIds',
  ) as H1AcceptanceCorpusProfileId[];

  const templates = asArray(
    fixture['actorScopedDependencyTemplates'],
    'fixture.actorScopedDependencyTemplates',
  ).map((value, index) =>
    asRecord(value, `fixture.actorScopedDependencyTemplates[${index}]`),
  );
  exactNumber(templates.length, 4, 'actorScopedDependencyTemplates.length');
  const entitlementTemplates = templates.filter(
    (template) => template['relationship'] === 'actor_entitlement',
  );
  const participantTemplates = templates.filter(
    (template) => template['relationship'] === 'participant_overlay',
  );
  exactNumber(entitlementTemplates.length, 2, 'entitlement template count');
  exactNumber(participantTemplates.length, 2, 'participant template count');
  for (const profile of delegation.profiles.slice(1)) {
    for (const row of profile.rows) {
      validateOverlayScenarioForRow(
        overlayScenarios,
        baselineRowIds,
        row,
        'delegation',
      );
    }
  }
  for (const tenantSlot of ['T01', 'T02'] as const) {
    validateEmptyOverlayScenario(
      overlayScenarios,
      baselineRowIds,
      `H3A.${tenantSlot}:actor_entitlement:comms.E0`,
    );
    validateEmptyOverlayScenario(
      overlayScenarios,
      baselineRowIds,
      `H3A.${tenantSlot}:participant_overlay:THR-${
        tenantSlot === 'T01' ? '8999001' : '8999002'
      }.P0`,
    );
  }

  const entitlementEntries = asArray(
    suite['entitlementProfiles'],
    'h4AcceptanceProfileSuite.entitlementProfiles',
  );
  exactNumber(entitlementEntries.length, 5, 'entitlementProfiles.length');
  const d0Entry = profileEntryById(
    entitlementEntries,
    'H3M.D0',
    'entitlementProfiles',
  );
  stateComposition(
    d0Entry['stateComposition'],
    {
      entitlementState: 'E0',
      delegationState: 'D0',
      participantState: 'P0',
    },
    'H3M.D0.stateComposition',
  );
  exactNumber(d0Entry['baseAuthorityRowCount'], 692, 'H3M.D0 base row count');
  exactNumber(d0Entry['deltaRowCount'], 0, 'H3M.D0 delta row count');
  exactNumber(d0Entry['expectedAuthorityRowCount'], 692, 'H3M.D0 total rows');
  exactNumber(
    asArray(d0Entry['exactDeltaRowIds'], 'H3M.D0.exactDeltaRowIds').length,
    0,
    'H3M.D0 exact delta ids',
  );
  exactNumber(
    asArray(d0Entry['rows'], 'H3M.D0.rows').length,
    0,
    'H3M.D0 rows',
  );

  const expectedEntitlementRows = new Map<
    string,
    readonly H1AuthoritySeedRow[]
  >();
  for (const state of ['E1', 'E2', 'E3', 'E4'] as const) {
    const rows: H1AuthoritySeedRow[] = [];
    for (const template of entitlementTemplates) {
      const tenantSlot = asString(
        template['tenantSlot'],
        `entitlement template ${state}.tenantSlot`,
      );
      if (tenantSlot !== 'T01' && tenantSlot !== 'T02') {
        fail(`entitlement template ${state} has unknown tenant`);
      }
      exactString(
        template['table'],
        'tenant_module_entitlement',
        `entitlement template ${tenantSlot}.table`,
      );
      const materializeByState = asRecord(
        template['materializeByState'],
        `entitlement template ${tenantSlot}.materializeByState`,
      );
      const values = asRecord(
        materializeByState[state],
        `entitlement template ${tenantSlot}.${state}`,
      );
      if (values['absent'] === true) {
        fail(`present entitlement ${state} cannot be absent`);
      }
      const row = validateSeedRow(
        {
          rowId: `${asString(
            template['templateId'],
            `entitlement template ${tenantSlot}.templateId`,
          )}.${state}.row`,
          phase: 55,
          table: 'tenant_module_entitlement',
          tenantSlot,
          values: {
            tenant_id: tenantIds[tenantSlot],
            ...values,
          },
        },
        `materialized entitlement ${tenantSlot}.${state}`,
        'entitlement',
      );
      validateOverlayScenarioForRow(
        overlayScenarios,
        baselineRowIds,
        row,
        'entitlement',
      );
      rows.push(row);
    }
    expectedEntitlementRows.set(state, Object.freeze(rows));
  }

  const profiles: H1AcceptanceSeedProfile[] = [
    Object.freeze({
      corpusProfileId: 'H3M.D0',
      stateComposition: Object.freeze({
        entitlementState: 'E0',
        delegationState: 'D0',
        participantState: 'P0',
      }),
      baseAuthorityRowCount: 692,
      deltaRowCount: 0,
      expectedAuthorityRowCount: 692,
      exactDeltaRowIds: Object.freeze([]),
      rows: Object.freeze([]),
      authorityBinding: 'authority-baseline-absence',
    }),
    ...delegation.profiles.slice(1).map(
      (profile): H1AcceptanceSeedProfile =>
        Object.freeze({
          corpusProfileId: profile.corpusProfileId,
          stateComposition: Object.freeze({
            entitlementState: 'E0',
            delegationState: profile.delegationState,
            participantState: 'P0',
          }),
          baseAuthorityRowCount: 692,
          deltaRowCount: 14,
          expectedAuthorityRowCount: 706,
          exactDeltaRowIds: profile.exactDelegationRowIds,
          rows: profile.rows,
          authorityBinding: 'delegation-measurement-v2',
        }),
    ),
  ];
  for (const state of ['E1', 'E2', 'E3', 'E4'] as const) {
    const expectedRows = expectedEntitlementRows.get(state);
    if (expectedRows === undefined) {
      fail(`missing mechanically materialized entitlement ${state}`);
    }
    profiles.push(
      validateDeltaProfile(
        profileEntryById(
          entitlementEntries,
          `H3M.${state}`,
          'entitlementProfiles',
        ),
        `H3M.${state}`,
        {
          entitlementState: state,
          delegationState: 'D0',
          participantState: 'P0',
        },
        2,
        694,
        () => 'entitlement',
        expectedRows,
      ),
    );
  }

  const participantEntries = asArray(
    suite['participantProfiles'],
    'h4AcceptanceProfileSuite.participantProfiles',
  );
  exactNumber(participantEntries.length, 2, 'participantProfiles.length');
  const p0Alias = profileEntryById(
    participantEntries,
    'H3M.E1',
    'participantProfiles',
  );
  stateComposition(
    p0Alias['stateComposition'],
    {
      entitlementState: 'E1',
      delegationState: 'D0',
      participantState: 'P0',
    },
    'participantProfiles.H3M.E1.stateComposition',
  );
  exactString(
    p0Alias['aliasRule'],
    'The E1 execution supplies the exact P0 absence/readback profile.',
    'participantProfiles.H3M.E1.aliasRule',
  );

  const actorIds = actorUserIdsByTenantRole(measurement, roles);
  const expectedParticipantRows: H1AuthoritySeedRow[] = [
    ...(expectedEntitlementRows.get('E1') ?? fail('missing E1 rows')),
  ];
  for (const template of participantTemplates) {
    const tenantSlot = asString(
      template['tenantSlot'],
      'participant template.tenantSlot',
    );
    if (tenantSlot !== 'T01' && tenantSlot !== 'T02') {
      fail('participant template has unknown tenant');
    }
    exactString(
      template['table'],
      'comms_thread_participant',
      `participant template ${tenantSlot}.table`,
    );
    const templateId = asString(
      template['templateId'],
      `participant template ${tenantSlot}.templateId`,
    );
    const materializeByState = asRecord(
      template['materializeByState'],
      `participant template ${tenantSlot}.materializeByState`,
    );
    const p1Values = asRecord(
      materializeByState['P1'],
      `participant template ${tenantSlot}.P1`,
    );
    exactString(
      p1Values['user_id'],
      '$actor.userId',
      `participant template ${tenantSlot}.P1.user_id`,
    );
    for (const role of roles) {
      const actorUserId = actorIds.get(`${tenantSlot}\0${role}`);
      if (actorUserId === undefined) {
        fail(`missing actor user id for ${tenantSlot}/${role}`);
      }
      const row = validateSeedRow(
        {
          rowId: `${templateId}.P1${role === 'owner' ? '' : `.${role}`}.row`,
          phase: 65,
          table: 'comms_thread_participant',
          tenantSlot,
          values: Object.fromEntries(
            Object.entries({
              tenant_id: tenantIds[tenantSlot],
              ...p1Values,
            }).map(([key, value]) => [
              key,
              value === '$actor.userId' ? actorUserId : value,
            ]),
          ),
        },
        `materialized participant ${tenantSlot}.${role}`,
        'participant',
      );
      if (role === 'owner') {
        validateOverlayScenarioForRow(
          overlayScenarios,
          baselineRowIds,
          row,
          'participant',
        );
      }
      expectedParticipantRows.push(row);
    }
  }
  profiles.push(
    validateDeltaProfile(
      profileEntryById(
        participantEntries,
        'H3M.P1',
        'participantProfiles',
      ),
      'H3M.P1',
      {
        entitlementState: 'E1',
        delegationState: 'D0',
        participantState: 'P1',
      },
      16,
      708,
      (rowId) =>
        rowId.includes(':actor_entitlement:')
          ? 'entitlement'
          : 'participant',
      expectedParticipantRows,
    ),
  );

  exactOrderedStrings(
    profiles.map((profile) => profile.corpusProfileId),
    profileExecutionIds,
    'materialized acceptance profile order',
  );
  const dRows = new Set(
    profiles
      .filter((profile) => profile.corpusProfileId.startsWith('H3M.D'))
      .flatMap((profile) => profile.exactDeltaRowIds),
  );
  const entitlementRows = new Set(
    profiles
      .filter((profile) => /^H3M\.E[1-4]$/u.test(profile.corpusProfileId))
      .flatMap((profile) => profile.exactDeltaRowIds),
  );
  if ([...dRows].some((rowId) => entitlementRows.has(rowId))) {
    fail('delegation and entitlement profile rows overlap');
  }
  const p1 = profiles.find(
    (profile) => profile.corpusProfileId === 'H3M.P1',
  );
  const e1 = profiles.find(
    (profile) => profile.corpusProfileId === 'H3M.E1',
  );
  if (p1 === undefined || e1 === undefined) {
    fail('missing P1 or E1 profile');
  }
  const permittedP1Overlap = new Set(e1.exactDeltaRowIds);
  const actualP1Overlap = p1.exactDeltaRowIds.filter((rowId) =>
    entitlementRows.has(rowId),
  );
  assertExactSet(
    actualP1Overlap,
    [...permittedP1Overlap],
    'P1 authority-declared E1 overlap',
  );

  const manifest = {
    artifactKind: 'hearth-search-h1-acceptance-seed-schedule',
    baselineUse: 'drift-detector-against-dae27a4',
    measurementStatus: 'NOT_YET_MEASURED',
    profileExecutionIds,
    profiles: profiles.map((profile) => ({
      authorityBinding: profile.authorityBinding,
      baseAuthorityRowCount: profile.baseAuthorityRowCount,
      corpusProfileId: profile.corpusProfileId,
      deltaRowCount: profile.deltaRowCount,
      expectedAuthorityRowCount: profile.expectedAuthorityRowCount,
      exactDeltaRowIds: profile.exactDeltaRowIds,
      rowsCanonicalSha256: canonicalSha256(profile.rows),
      stateComposition: profile.stateComposition,
    })),
    schedulingRule: 'ten-fresh-isolated-databases-no-profile-merging',
  };
  return Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    profileExecutionIds: Object.freeze(profileExecutionIds),
    profiles: Object.freeze(profiles),
    isolatedExecutionRequired: true,
    acceptanceProfileManifestSha256: canonicalSha256(manifest),
  });
}
