import { canonicalSha256 } from '../canonical.js';
import {
  type H1TenantSlot,
  validatePhysicalSeedPlan,
} from './seedPlan.js';

export const H1_REGISTER_TARGETS = Object.freeze({
  person: 5_000,
  mission: 3_000,
  agreement: 2_500,
  entity: 500,
  credential: 4_000,
  journey: 3_000,
  kit: 2_500,
  apparel: 2_500,
  approval: 4_000,
  team: 500,
  invoice: 2_500,
  claim: 4_000,
  distribution: 2_500,
  document: 4_000,
  term: 2_500,
  line: 4_000,
  beneficiary: 3_000,
} as const);

export type H1Register = keyof typeof H1_REGISTER_TARGETS;

export class H1CorpusPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'H1CorpusPlanError';
  }
}

export interface H1SourceIdentity {
  readonly tenantSlot: H1TenantSlot;
  readonly register: H1Register;
  readonly recordId: string;
  readonly recordKind: string | null;
}

export interface H1BulkRecordDescriptor {
  readonly bulkRowId: string;
  readonly tenantSlot: H1TenantSlot;
  readonly register: H1Register;
  readonly physicalTable: string;
  readonly countedOrdinal: number;
  readonly generatedOrdinal: number;
  readonly source: H1SourceIdentity;
  readonly deterministicFields: {
    readonly primaryText: string;
    readonly secondaryText: string;
    readonly code: string;
    readonly frozenTimestamp: '2035-06-15T12:00:00.000Z';
  };
}

export interface H1CorpusDistributionEntry {
  readonly tenantSlot: H1TenantSlot;
  readonly register: H1Register;
  readonly targetCount: number;
  readonly authorityIntendedSearchableCount: number;
  readonly generatedBulkCount: number;
}

export interface H1CorpusManifestInputs {
  readonly schemaVersion: 1;
  readonly artifactKind: 'hearth-search-h1-corpus-plan';
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly baselineUse: 'drift-detector-against-dae27a4';
  readonly fixtureVersion: 'HEARTH-003-FIXTURES-v5';
  readonly physicalSeedPlanVersion: 'HEARTH-003-PHYSICAL-SEED-PLAN-v4';
  readonly intendedSearchableTotal: 100_000;
  readonly intendedSearchablePerTenant: 50_000;
  readonly authorityIntendedSearchableCount: number;
  readonly generatedBulkCount: number;
  readonly authorityFixtureCanaryCount: number;
  readonly reservedQueryTokenCount: number;
  readonly authorityPhysicalRowsSha256: string;
  readonly authoritySourceIdentitySha256: string;
  readonly reservedQueryTokensSha256: string;
  readonly bulkRecordMetadataSha256: string;
  readonly distribution: readonly H1CorpusDistributionEntry[];
}

export interface H1CorpusPlan {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly distribution: readonly H1CorpusDistributionEntry[];
  readonly authoritySources: readonly H1SourceIdentity[];
  readonly bulkRecords: readonly H1BulkRecordDescriptor[];
  readonly reservedQueryTokens: readonly string[];
  readonly authorityFixtureCanaryCount: number;
  readonly manifestInputs: H1CorpusManifestInputs;
  readonly manifestSha256: string;
}

const TENANTS = Object.freeze(['T01', 'T02'] as const);
const REGISTERS = Object.freeze(
  Object.keys(H1_REGISTER_TARGETS) as H1Register[],
);
const FIXTURE_RELEVANCE = new Set([
  'relevant',
  'coarse_distractor',
  'forbidden_canary',
  'security_collision_canary',
]);
const COUNTED_FIXTURE_RELEVANCE = new Set([
  'relevant',
  'coarse_distractor',
]);
const SAFE_ORDINAL_ALPHABET = 'bcdfghklmnprstvw';

const PHYSICAL_TABLE_BY_REGISTER = Object.freeze({
  person: 'person',
  mission: 'mission',
  agreement: 'agreement',
  entity: 'entity',
  credential: 'credential',
  journey: 'journey',
  kit: 'kit',
  apparel: 'apparel',
  approval: 'approval',
  team: 'team',
  invoice: 'invoice',
  claim: 'claim',
  distribution: 'distribution',
  document: 'document',
  term: 'agreement_term',
  line: 'mission_line',
  beneficiary: 'beneficiary',
} satisfies Readonly<Record<H1Register, string>>);

const REGISTER_CODE = Object.freeze({
  person: 'per',
  mission: 'msn',
  agreement: 'agr',
  entity: 'ent',
  credential: 'cred',
  journey: 'jrn',
  kit: 'kit',
  apparel: 'apl',
  approval: 'apr',
  team: 'team',
  invoice: 'inv',
  claim: 'clm',
  distribution: 'dist',
  document: 'doc',
  term: 'trm',
  line: 'pnl',
  beneficiary: 'ben',
} satisfies Readonly<Record<H1Register, string>>);

function fail(message: string): never {
  throw new H1CorpusPlanError(message);
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

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    fail(`${path} must equal ${String(expected)}`);
  }
}

function isRegister(value: string): value is H1Register {
  return Object.hasOwn(H1_REGISTER_TARGETS, value);
}

function parseSourceIdentity(
  value: unknown,
  path: string,
): H1SourceIdentity {
  const source = asRecord(value, path);
  const tenantSlot = source['tenantSlot'];
  if (tenantSlot !== 'T01' && tenantSlot !== 'T02') {
    fail(`${path}.tenantSlot must be T01 or T02`);
  }
  const register = asString(source['register'], `${path}.register`);
  if (!isRegister(register)) {
    fail(`${path}.register is outside the closed 17-register set`);
  }
  const recordId = asString(source['recordId'], `${path}.recordId`);
  const recordKind = source['recordKind'];
  if (recordKind !== null && typeof recordKind !== 'string') {
    fail(`${path}.recordKind must be a string or null`);
  }
  return Object.freeze({
    tenantSlot,
    register,
    recordId,
    recordKind,
  });
}

function sourceKey(source: H1SourceIdentity): string {
  return JSON.stringify([
    source.tenantSlot,
    source.register,
    source.recordId,
  ]);
}

function normalizeForTokenCheck(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

export function findReservedQueryToken(
  value: string,
  reservedQueryTokens: readonly string[],
): string | null {
  const normalizedValue = normalizeForTokenCheck(value);
  for (const token of reservedQueryTokens) {
    if (normalizedValue.includes(normalizeForTokenCheck(token))) {
      return token;
    }
  }
  return null;
}

function encodeSafeOrdinal(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('bulk generated ordinal must be a positive safe integer');
  }
  let remainder = value - 1;
  let encoded = '';
  for (let position = 0; position < 5; position += 1) {
    const index = remainder % SAFE_ORDINAL_ALPHABET.length;
    const character = SAFE_ORDINAL_ALPHABET[index];
    if (character === undefined) {
      fail('safe ordinal alphabet lookup failed');
    }
    encoded = `${character}${encoded}`;
    remainder = Math.floor(remainder / SAFE_ORDINAL_ALPHABET.length);
  }
  if (remainder !== 0) {
    fail('bulk generated ordinal exceeds the fixed identity namespace');
  }
  return encoded;
}

function createBulkRecord(
  tenantSlot: H1TenantSlot,
  register: H1Register,
  authorityCount: number,
  generatedOrdinal: number,
  normalizedReservedQueryTokens: readonly Readonly<{
    original: string;
    normalized: string;
  }>[],
): H1BulkRecordDescriptor {
  const suffix = encodeSafeOrdinal(generatedOrdinal);
  const tenantText = tenantSlot.toLowerCase();
  const registerCode = REGISTER_CODE[register];
  const recordId = `hearthbulk-${tenantText}-${registerCode}-${suffix}`;
  const primaryText = `Hearthbulk ${register} ${tenantSlot} ${suffix}`;
  const secondaryText = `Hearthbulk synthetic ${register} ${suffix}`;
  const code = `HB-${tenantSlot}-${registerCode}-${suffix}`;
  const searchableValues = [recordId, primaryText, secondaryText, code];
  const normalizedSearchableValues = normalizeForTokenCheck(
    searchableValues.join('\u0000'),
  );
  for (const token of normalizedReservedQueryTokens) {
    if (normalizedSearchableValues.includes(token.normalized)) {
      fail(
        `bulk generator output collides with reserved query token ${JSON.stringify(
          token.original,
        )}`,
      );
    }
  }

  const source = Object.freeze({
    tenantSlot,
    register,
    recordId,
    recordKind: register === 'document' ? 'RegisteredEvidence' : null,
  });
  return Object.freeze({
    bulkRowId: `H1B.${tenantSlot}.${register}.${suffix}`,
    tenantSlot,
    register,
    physicalTable: PHYSICAL_TABLE_BY_REGISTER[register],
    countedOrdinal: authorityCount + generatedOrdinal,
    generatedOrdinal,
    source,
    deterministicFields: Object.freeze({
      primaryText,
      secondaryText,
      code,
      frozenTimestamp: '2035-06-15T12:00:00.000Z',
    }),
  });
}

/**
 * Plans the counted corpus solely from Fixture-v5 metadata.
 *
 * The counted authority union is:
 *   active relevant/coarse fixtures
 *   UNION active supportingSearchSources
 * deduplicated by tenant/register/recordId. Qrels are not accepted as input.
 */
export function planH1Corpus(fixtureInput: unknown): H1CorpusPlan {
  const fixture = asRecord(fixtureInput, 'fixture');
  exact(fixture['schemaVersion'], 4, 'fixture.schemaVersion');
  exact(
    fixture['artifactKind'],
    'hearth-search-gold-fixture-contract',
    'fixture.artifactKind',
  );
  exact(
    fixture['fixtureVersion'],
    'HEARTH-003-FIXTURES-v5',
    'fixture.fixtureVersion',
  );
  exact(fixture['syntheticOnly'], true, 'fixture.syntheticOnly');
  exact(fixture['authority'], 'Apex Lumen', 'fixture.authority');
  exact(
    fixture['seederRule'],
    'Ember materializes every physicalSeedPlan row exactly and may add only deterministic bulk rows that avoid every reserved token; it may not fill, repair, or reinterpret an authority row and must not read qrel judgments.',
    'fixture.seederRule',
  );
  const physicalSeedPlan = validatePhysicalSeedPlan(
    fixture['physicalSeedPlan'],
  );

  const reservedQueryTokens = asArray(
    fixture['reservedQueryTokens'],
    'fixture.reservedQueryTokens',
  ).map((value, index) =>
    asString(value, `fixture.reservedQueryTokens[${index}]`),
  );
  exact(
    reservedQueryTokens.length,
    285,
    'fixture.reservedQueryTokens.length',
  );
  if (new Set(reservedQueryTokens).size !== reservedQueryTokens.length) {
    fail('fixture.reservedQueryTokens contains duplicate tokens');
  }
  const normalizedReservedQueryTokens = reservedQueryTokens.map((token) =>
    Object.freeze({
      original: token,
      normalized: normalizeForTokenCheck(token),
    }),
  );

  const countedSources = new Map<string, H1SourceIdentity>();
  const allSourceKeys = new Set<string>();
  let fixtureCanaryCount = 0;
  const fixtures = asArray(fixture['fixtures'], 'fixture.fixtures');
  exact(fixtures.length, 356, 'fixture.fixtures.length');
  for (let index = 0; index < fixtures.length; index += 1) {
    const entry = asRecord(fixtures[index], `fixture.fixtures[${index}]`);
    const source = parseSourceIdentity(
      entry['source'],
      `fixture.fixtures[${index}].source`,
    );
    const key = sourceKey(source);
    if (allSourceKeys.has(key)) {
      fail(`fixture.fixtures contains duplicate source ${source.recordId}`);
    }
    allSourceKeys.add(key);
    const relevance = asString(
      entry['relevance'],
      `fixture.fixtures[${index}].relevance`,
    );
    if (!FIXTURE_RELEVANCE.has(relevance)) {
      fail(`fixture.fixtures[${index}] has unknown relevance ${relevance}`);
    }
    const rowFacts = asRecord(
      entry['rowFacts'],
      `fixture.fixtures[${index}].rowFacts`,
    );
    if (rowFacts['active'] !== true && rowFacts['active'] !== false) {
      fail(`fixture.fixtures[${index}].rowFacts.active must be boolean`);
    }
    if (
      rowFacts['active'] === true &&
      COUNTED_FIXTURE_RELEVANCE.has(relevance)
    ) {
      countedSources.set(key, source);
    } else if (
      relevance === 'forbidden_canary' ||
      relevance === 'security_collision_canary'
    ) {
      fixtureCanaryCount += 1;
    }
  }
  exact(fixtureCanaryCount, 37, 'authority fixture canary count');

  const supportingSearchSources = asArray(
    fixture['supportingSearchSources'],
    'fixture.supportingSearchSources',
  );
  exact(
    supportingSearchSources.length,
    278,
    'fixture.supportingSearchSources.length',
  );
  for (let index = 0; index < supportingSearchSources.length; index += 1) {
    const entry = asRecord(
      supportingSearchSources[index],
      `fixture.supportingSearchSources[${index}]`,
    );
    exact(
      entry['relevance'],
      'supporting_dependency',
      `fixture.supportingSearchSources[${index}].relevance`,
    );
    const rowFacts = asRecord(
      entry['rowFacts'],
      `fixture.supportingSearchSources[${index}].rowFacts`,
    );
    const source = parseSourceIdentity(
      entry['source'],
      `fixture.supportingSearchSources[${index}].source`,
    );
    if (rowFacts['active'] === true) {
      countedSources.set(sourceKey(source), source);
    } else if (rowFacts['active'] !== false) {
      fail(
        `fixture.supportingSearchSources[${index}].rowFacts.active must be boolean`,
      );
    }
  }
  exact(countedSources.size, 597, 'authority intended-searchable source count');

  const authoritySources = [...countedSources.values()].sort((left, right) =>
    sourceKey(left).localeCompare(sourceKey(right)),
  );
  const distribution: H1CorpusDistributionEntry[] = [];
  const bulkRecords: H1BulkRecordDescriptor[] = [];
  for (const tenantSlot of TENANTS) {
    for (const register of REGISTERS) {
      const authorityCount = authoritySources.filter(
        (source) =>
          source.tenantSlot === tenantSlot && source.register === register,
      ).length;
      const targetCount = H1_REGISTER_TARGETS[register];
      if (authorityCount > targetCount) {
        fail(
          `${tenantSlot}/${register} authority count exceeds its corpus target`,
        );
      }
      const generatedBulkCount = targetCount - authorityCount;
      distribution.push(
        Object.freeze({
          tenantSlot,
          register,
          targetCount,
          authorityIntendedSearchableCount: authorityCount,
          generatedBulkCount,
        }),
      );
      for (
        let generatedOrdinal = 1;
        generatedOrdinal <= generatedBulkCount;
        generatedOrdinal += 1
      ) {
        bulkRecords.push(
          createBulkRecord(
            tenantSlot,
            register,
            authorityCount,
            generatedOrdinal,
            normalizedReservedQueryTokens,
          ),
        );
      }
    }
  }

  const intendedByTenant = Object.fromEntries(
    TENANTS.map((tenantSlot) => [
      tenantSlot,
      distribution
        .filter((entry) => entry.tenantSlot === tenantSlot)
        .reduce((sum, entry) => sum + entry.targetCount, 0),
    ]),
  );
  exact(intendedByTenant['T01'], 50_000, 'T01 intended-searchable target');
  exact(intendedByTenant['T02'], 50_000, 'T02 intended-searchable target');
  exact(
    authoritySources.length + bulkRecords.length,
    100_000,
    'two-tenant intended-searchable total',
  );
  exact(bulkRecords.length, 99_403, 'generated bulk row count');

  const bulkSourceKeys = bulkRecords.map((row) => sourceKey(row.source));
  if (new Set(bulkSourceKeys).size !== bulkSourceKeys.length) {
    fail('bulk generator produced duplicate source identities');
  }
  const authorityKeys = new Set(authoritySources.map(sourceKey));
  if (bulkSourceKeys.some((key) => authorityKeys.has(key))) {
    fail('bulk generator collided with an authority source identity');
  }

  const manifestInputs: H1CorpusManifestInputs = Object.freeze({
    schemaVersion: 1,
    artifactKind: 'hearth-search-h1-corpus-plan',
    measurementStatus: 'NOT_YET_MEASURED',
    baselineUse: 'drift-detector-against-dae27a4',
    fixtureVersion: 'HEARTH-003-FIXTURES-v5',
    physicalSeedPlanVersion: 'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
    intendedSearchableTotal: 100_000,
    intendedSearchablePerTenant: 50_000,
    authorityIntendedSearchableCount: authoritySources.length,
    generatedBulkCount: bulkRecords.length,
    authorityFixtureCanaryCount: fixtureCanaryCount,
    reservedQueryTokenCount: reservedQueryTokens.length,
    authorityPhysicalRowsSha256: physicalSeedPlan.rowsCanonicalSha256,
    authoritySourceIdentitySha256: canonicalSha256(authoritySources),
    reservedQueryTokensSha256: canonicalSha256(
      [...reservedQueryTokens].sort(),
    ),
    bulkRecordMetadataSha256: canonicalSha256(bulkRecords),
    distribution: Object.freeze(distribution),
  });

  return Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    distribution: Object.freeze(distribution),
    authoritySources: Object.freeze(authoritySources),
    bulkRecords: Object.freeze(bulkRecords),
    reservedQueryTokens: Object.freeze(reservedQueryTokens),
    authorityFixtureCanaryCount: fixtureCanaryCount,
    manifestInputs,
    manifestSha256: canonicalSha256(manifestInputs),
  });
}
