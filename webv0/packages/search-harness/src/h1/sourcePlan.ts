import { canonicalSha256 } from '../canonical.js';
import {
  R6_AUTHORITY_MODEL,
  loadR6VerifiedAuthority,
  type R6PreflightReport,
} from './preflight.js';
import {
  planH1ActorMatrix,
  type H1ActorMatrixPlan,
} from './actorMatrixPlan.js';
import {
  materializeH1BulkRows,
  type H1BulkSeedMaterialization,
} from './bulkRows.js';
import {
  classifyH1BoundedCorpus,
  type H1BoundedCorpusClassificationReceipt,
} from './boundedCorpusClassifier.js';
import {
  planH1Corpus,
  type H1CorpusPlan,
} from './corpusPlanner.js';
import type {
  H1DatabaseSeedRow,
  H1ExpectedSeedCount,
  H1MigrationPin,
} from './databaseSeeder.js';
import {
  validateAcceptanceSeedProfiles,
  validatePhysicalSeedPlan,
  type H1AcceptanceCorpusProfileId,
  type H1AcceptanceSeedProfile,
  type H1ValidatedAcceptanceSeedProfiles,
  type H1ValidatedPhysicalSeedPlan,
} from './seedPlan.js';
import {
  parseH1PhysicalManifest,
  reconcileH1PhysicalManifestTables,
  resolveH1H0EmptinessTableSet,
  type H1PhysicalManifestIdentity,
  type H1PhysicalManifestTableAttestation,
} from './physicalManifest.js';

type JsonObject = Record<string, unknown>;

export class H1SourcePlanError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'H1SourcePlanError';
  }
}

export interface H1SourcePlanManifestInputs {
  readonly schemaVersion: 1;
  readonly artifactKind: 'hearth-search-h1-source-plan';
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly authorityModel: typeof R6_AUTHORITY_MODEL;
  readonly baselineMeaning: 'dae27a4-drift-baseline-only';
  readonly sourceCommit: 'dae27a400868c0c686788ab8e5520690dbf77334';
  readonly externallyPinnedAuthorityRoot: string;
  readonly querySetVersion: 'HEARTH-003-QRELS-v7';
  readonly querySetSha256: string;
  readonly fixtureVersion: 'HEARTH-003-FIXTURES-v5';
  readonly fixtureSha256: string;
  readonly actorClassVersion: 'HEARTH-003-ACTOR-CLASSES-v2';
  readonly actorClassesSha256: string;
  readonly delegationMeasurementVersion:
    'HEARTH-003-DELEGATION-MEASUREMENT-v2';
  readonly delegationMeasurementSha256: string;
  readonly authoritativePredicatesSha256: string;
  readonly pinnedBaselineSha256: string;
  readonly applicationPolicyDependencySha256: string;
  readonly migrationStateSha256: string;
  readonly completeDependencyTreeSha256: string;
  readonly intendedSearchableCount: 100_000;
  readonly boundedSourceCount: 100_037;
  readonly hardCanarySourceCount: 37;
  readonly authorityPhysicalRowCount: 692;
  readonly deterministicBulkRowCount: 99_403;
  readonly acceptanceProfileCount: 10;
  readonly h0GuardTableCount: number;
  readonly h0GuardTablesSha256: string;
  readonly physicalDomainManifestSha256: string;
  readonly physicalPrimaryKeysSha256: string;
  readonly datasetSha256: string;
  readonly acceptanceProfileScheduleSha256: string;
  readonly actorMatrixSha256: string;
  readonly pinnedBaselinePartitionSha256: string;
  readonly migrationPinsSha256: string;
  readonly tamperEvidenceMode:
    'sha256-plus-local-git-provenance-no-pki';
  readonly doesNotProve:
    'that dae27a4 is authorized, correct, complete, or leak-free';
}

export interface H1SourcePlan {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly authorityPreflight: R6PreflightReport;
  readonly physicalSeedPlan: H1ValidatedPhysicalSeedPlan;
  readonly acceptanceProfiles: H1ValidatedAcceptanceSeedProfiles;
  readonly corpusPlan: H1CorpusPlan;
  readonly bulkMaterialization: H1BulkSeedMaterialization;
  readonly actorMatrixPlan: H1ActorMatrixPlan;
  readonly boundedClassification: H1BoundedCorpusClassificationReceipt;
  readonly migrationPins: readonly H1MigrationPin[];
  readonly physicalManifestIdentity: H1PhysicalManifestIdentity;
  readonly physicalManifestTableAttestation:
    H1PhysicalManifestTableAttestation;
  /**
   * Authority-derived union of every table seedable by any of the ten
   * acceptance profiles, reconciled against Physical Domain Manifest v3.
   */
  readonly h0GuardTables: readonly string[];
  readonly manifestInputs: H1SourcePlanManifestInputs;
  readonly manifestSha256: string;
}

export interface H1ProfileDatabasePlan {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly corpusProfileId: H1AcceptanceCorpusProfileId;
  readonly authorityRows: readonly H1DatabaseSeedRow[];
  readonly profileRows: readonly H1DatabaseSeedRow[];
  readonly bulkRows: readonly H1DatabaseSeedRow[];
  readonly expectedCounts: readonly H1ExpectedSeedCount[];
  readonly migrationPins: readonly H1MigrationPin[];
  readonly plannedTables: readonly string[];
  readonly plannedTablesSha256: string;
  readonly h0GuardTables: readonly string[];
  readonly h0GuardTablesSha256: string;
  readonly primaryKeysByTable: Readonly<
    Record<string, readonly string[]>
  >;
  readonly primaryKeysByTableSha256: string;
  readonly intendedSearchableCount: 100_000;
  readonly boundedSourceCount: 100_037;
  readonly totalPhysicalRowCount: number;
  readonly sharedDatasetSha256: string;
  readonly profileRowsSha256: string;
  readonly planSha256: string;
}

export interface H1VerifiedProfileExecutionAttestation {
  readonly schemaVersion: 1;
  readonly artifactKind:
    'hearth-search-h1-verified-profile-execution-attestation';
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly corpusProfileId: H1AcceptanceCorpusProfileId;
  readonly profilePlanSha256: string;
  readonly exactTableCount: number;
  readonly exactTablesSha256: string;
  readonly h0GuardTableCount: number;
  readonly h0GuardTablesSha256: string;
  readonly primaryKeysByTableSha256: string;
}

const trustedProfileDatabasePlans = new WeakMap<
  object,
  {
    readonly h0GuardTables: readonly string[];
    readonly primaryKeysByTable: Readonly<
      Record<string, readonly string[]>
    >;
  }
>();
const trustedSourcePlans = new WeakMap<
  object,
  {
    readonly manifestSha256: string;
    readonly physicalManifestSha256: string;
    readonly primaryKeysByTableSha256: string;
  }
>();
const verifiedProfileExecutionAttestations = new WeakMap<
  object,
  {
    readonly exactTables: readonly string[];
    readonly h0GuardTables: readonly string[];
    readonly primaryKeysByTable: Readonly<
      Record<string, readonly string[]>
    >;
    readonly profilePlanSha256: string;
  }
>();

function fail(code: string, detail: string): never {
  throw new H1SourcePlanError(code, detail);
}

function object(value: unknown, path: string): JsonObject {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail('H1_SOURCE_AUTHORITY_SHAPE_INVALID', `${path} is not an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('H1_SOURCE_AUTHORITY_SHAPE_INVALID', `${path} is not a string`);
  }
  return value;
}

function exact(
  value: unknown,
  expected: string | number | boolean,
  path: string,
): void {
  if (value !== expected) {
    fail(
      'H1_SOURCE_AUTHORITY_IDENTITY_INVALID',
      `${path} does not match r6`,
    );
  }
}

function migrationPins(fixture: JsonObject): readonly H1MigrationPin[] {
  const physical = object(
    fixture['physicalSeedPlan'],
    'fixture.physicalSeedPlan',
  );
  const values = physical['migrationFiles'];
  if (!Array.isArray(values) || values.length !== 95) {
    fail(
      'H1_SOURCE_MIGRATION_PINS_INVALID',
      'migration pin count is not 95',
    );
  }
  const pins = values.map((value, index) => {
    const entry = object(value, `migrationFiles[${index}]`);
    const path = string(entry['path'], `migrationFiles[${index}].path`);
    const sha256 = string(
      entry['sha256'],
      `migrationFiles[${index}].sha256`,
    );
    if (
      !/^webv0\/packages\/persistence\/migrations\/[0-9]{4}_[a-z0-9_]+\.sql$/u.test(
        path,
      ) ||
      !/^[a-f0-9]{64}$/u.test(sha256)
    ) {
      fail(
        'H1_SOURCE_MIGRATION_PINS_INVALID',
        `migration pin ${index} is invalid`,
      );
    }
    return Object.freeze({ path, sha256 });
  });
  if (
    pins.some(
      ({ path }, index) =>
        index > 0 && path <= (pins[index - 1]?.path ?? ''),
    )
  ) {
    fail(
      'H1_SOURCE_MIGRATION_PINS_INVALID',
      'migration pins are not strictly ordered',
    );
  }
  return Object.freeze(pins);
}

function dependencyHashes(policy: JsonObject): Readonly<{
  applicationPolicyDependencySha256: string;
  migrationStateSha256: string;
  completeDependencyTreeSha256: string;
}> {
  exact(
    policy['sourceCommit'],
    'dae27a400868c0c686788ab8e5520690dbf77334',
    'policyDependencies.sourceCommit',
  );
  const bindings = object(
    policy['h0Bindings'],
    'policyDependencies.h0Bindings',
  );
  const result = {
    applicationPolicyDependencySha256: string(
      bindings['applicationPolicyDependencySha256'],
      'h0Bindings.applicationPolicyDependencySha256',
    ),
    migrationStateSha256: string(
      bindings['migrationStateSha256'],
      'h0Bindings.migrationStateSha256',
    ),
    completeDependencyTreeSha256: string(
      bindings['completeDependencyTreeSha256'],
      'h0Bindings.completeDependencyTreeSha256',
    ),
  };
  if (
    Object.values(result).some((value) => !/^[a-f0-9]{64}$/u.test(value))
  ) {
    fail(
      'H1_SOURCE_DEPENDENCY_HASH_INVALID',
      'policy dependency hash is malformed',
    );
  }
  return Object.freeze(result);
}

function authoritySeedableTables(
  physicalSeedPlan: H1ValidatedPhysicalSeedPlan,
  acceptanceProfiles: H1ValidatedAcceptanceSeedProfiles,
  bulkMaterialization: H1BulkSeedMaterialization,
): readonly string[] {
  const allSeedableRows: readonly H1DatabaseSeedRow[] = [
    ...physicalSeedPlan.rows,
    ...acceptanceProfiles.profiles.flatMap(({ rows }) => rows),
    ...bulkMaterialization.rows,
  ];
  const seedableTables = [
    ...new Set(allSeedableRows.map(({ table }) => table)),
  ].sort();
  return Object.freeze(seedableTables);
}

/**
 * Builds every H1 pure artifact from one already-verified in-memory r6 view.
 * No database, network, HTTP, or metric capability is accepted by this API.
 */
export function prepareH1SourcePlan(
): H1SourcePlan {
  const loaded = loadR6VerifiedAuthority();
  const { authority } = loaded;
  const fixture = authority.readJson(
    'HEARTH-003-FIXTURE-CONTRACT-v5.json',
  ) as JsonObject;
  const actorClasses = authority.readJson(
    'HEARTH-003-ACTOR-CLASSES-v2.json',
  ) as JsonObject;
  const delegationMeasurement = authority.readJson(
    'HEARTH-003-DELEGATION-MEASUREMENT-v2.json',
  ) as JsonObject;
  const authoritativePredicates = authority.readJson(
    'HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json',
  ) as JsonObject;
  const driftBaseline = authority.readJson(
    'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json',
  ) as JsonObject;
  const qrels = authority.readJson(
    'HEARTH-003-QRELS-v7.json',
  ) as JsonObject;
  const policyDependencies = authority.readJson(
    'HEARTH-003-POLICY-DEPENDENCIES-v2.json',
  ) as JsonObject;
  const physicalDomainManifest = authority.readJson(
    'HEARTH-003-PHYSICAL-DOMAIN-MANIFEST-v3.json',
  ) as JsonObject;

  exact(
    qrels['querySetVersion'],
    'HEARTH-003-QRELS-v7',
    'qrels.querySetVersion',
  );
  exact(
    fixture['fixtureVersion'],
    'HEARTH-003-FIXTURES-v5',
    'fixture.fixtureVersion',
  );
  exact(
    actorClasses['actorClassVersion'],
    'HEARTH-003-ACTOR-CLASSES-v2',
    'actorClasses.actorClassVersion',
  );
  exact(
    delegationMeasurement['measurementVersion'],
    'HEARTH-003-DELEGATION-MEASUREMENT-v2',
    'delegationMeasurement.measurementVersion',
  );

  const physicalSeedPlan = validatePhysicalSeedPlan(
    fixture['physicalSeedPlan'],
  );
  const acceptanceProfiles = validateAcceptanceSeedProfiles(
    fixture,
    actorClasses,
    delegationMeasurement,
  );
  const corpusPlan = planH1Corpus(fixture);
  const bulkMaterialization = materializeH1BulkRows(corpusPlan);
  const actorMatrixPlan = planH1ActorMatrix(
    actorClasses,
    delegationMeasurement,
  );
  const boundedClassification = classifyH1BoundedCorpus({
    fixture,
    driftBaseline,
    authoritativePredicates,
    actorClasses,
    corpusPlan,
    actorMatrixPlan,
    bulkMaterialization,
  });
  const physicalManifestIdentity = parseH1PhysicalManifest(
    physicalDomainManifest,
  );
  const seedableTables = authoritySeedableTables(
    physicalSeedPlan,
    acceptanceProfiles,
    bulkMaterialization,
  );
  const physicalManifestTableAttestation =
    reconcileH1PhysicalManifestTables(
      physicalManifestIdentity,
      seedableTables,
    );
  const h0GuardTables = resolveH1H0EmptinessTableSet(
    physicalManifestTableAttestation,
  );
  const pins = migrationPins(fixture);
  const dependencies = dependencyHashes(policyDependencies);
  const datasetSha256 = canonicalSha256({
    authorityRowsSha256: physicalSeedPlan.rowsCanonicalSha256,
    bulkRowsSha256: bulkMaterialization.rowsCanonicalSha256,
    corpusPlanSha256: corpusPlan.manifestSha256,
    intendedSearchableCount: 100_000,
    boundedSourceCount: 100_037,
  });

  const manifestInputs: H1SourcePlanManifestInputs = Object.freeze({
    schemaVersion: 1,
    artifactKind: 'hearth-search-h1-source-plan',
    measurementStatus: 'NOT_YET_MEASURED',
    authorityModel: R6_AUTHORITY_MODEL,
    baselineMeaning: 'dae27a4-drift-baseline-only',
    sourceCommit: 'dae27a400868c0c686788ab8e5520690dbf77334',
    externallyPinnedAuthorityRoot:
      loaded.report.externallyPinnedManifestRoot,
    querySetVersion: 'HEARTH-003-QRELS-v7',
    querySetSha256: canonicalSha256(qrels),
    fixtureVersion: 'HEARTH-003-FIXTURES-v5',
    fixtureSha256: canonicalSha256(fixture),
    actorClassVersion: 'HEARTH-003-ACTOR-CLASSES-v2',
    actorClassesSha256: canonicalSha256(actorClasses),
    delegationMeasurementVersion:
      'HEARTH-003-DELEGATION-MEASUREMENT-v2',
    delegationMeasurementSha256:
      canonicalSha256(delegationMeasurement),
    authoritativePredicatesSha256:
      canonicalSha256(authoritativePredicates),
    pinnedBaselineSha256: canonicalSha256(driftBaseline),
    ...dependencies,
    intendedSearchableCount: 100_000,
    boundedSourceCount: 100_037,
    hardCanarySourceCount: 37,
    authorityPhysicalRowCount: 692,
    deterministicBulkRowCount: 99_403,
    acceptanceProfileCount: 10,
    h0GuardTableCount: h0GuardTables.length,
    h0GuardTablesSha256: canonicalSha256(h0GuardTables),
    physicalDomainManifestSha256:
      physicalManifestIdentity.manifestCanonicalSha256,
    physicalPrimaryKeysSha256:
      physicalManifestIdentity.primaryKeysByTableSha256,
    datasetSha256,
    acceptanceProfileScheduleSha256:
      acceptanceProfiles.acceptanceProfileManifestSha256,
    actorMatrixSha256: actorMatrixPlan.manifestSha256,
    pinnedBaselinePartitionSha256:
      boundedClassification.manifestSha256,
    migrationPinsSha256: canonicalSha256(pins),
    tamperEvidenceMode: 'sha256-plus-local-git-provenance-no-pki',
    doesNotProve:
      'that dae27a4 is authorized, correct, complete, or leak-free',
  });

  const sourcePlan: H1SourcePlan = Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    authorityPreflight: loaded.report,
    physicalSeedPlan,
    acceptanceProfiles,
    corpusPlan,
    bulkMaterialization,
    actorMatrixPlan,
    boundedClassification,
    migrationPins: pins,
    physicalManifestIdentity,
    physicalManifestTableAttestation,
    h0GuardTables,
    manifestInputs,
    manifestSha256: canonicalSha256(manifestInputs),
  });
  trustedSourcePlans.set(sourcePlan, {
    manifestSha256: sourcePlan.manifestSha256,
    physicalManifestSha256:
      physicalManifestIdentity.manifestCanonicalSha256,
    primaryKeysByTableSha256:
      physicalManifestIdentity.primaryKeysByTableSha256,
  });
  return sourcePlan;
}

function compareExpectedCounts(
  left: H1ExpectedSeedCount,
  right: H1ExpectedSeedCount,
): number {
  if (left.table !== right.table) {
    return left.table < right.table ? -1 : 1;
  }
  const leftSlot = left.tenantSlot ?? '';
  const rightSlot = right.tenantSlot ?? '';
  return leftSlot < rightSlot ? -1 : leftSlot > rightSlot ? 1 : 0;
}

function expectedCounts(
  rows: readonly H1DatabaseSeedRow[],
): readonly H1ExpectedSeedCount[] {
  const counts = new Map<string, H1ExpectedSeedCount>();
  for (const row of rows) {
    const key = `${row.table}\0${row.tenantSlot ?? 'GLOBAL'}`;
    const prior = counts.get(key);
    counts.set(
      key,
      Object.freeze({
        table: row.table,
        tenantSlot: row.tenantSlot,
        rowCount: (prior?.rowCount ?? 0) + 1,
      }),
    );
  }
  return Object.freeze([...counts.values()].sort(compareExpectedCounts));
}

function profile(
  source: H1SourcePlan,
  corpusProfileId: H1AcceptanceCorpusProfileId,
): H1AcceptanceSeedProfile {
  const matches = source.acceptanceProfiles.profiles.filter(
    (candidate) => candidate.corpusProfileId === corpusProfileId,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    fail(
      'H1_SOURCE_PROFILE_INVALID',
      `unknown or duplicate profile ${corpusProfileId}`,
    );
  }
  return matches[0];
}

/**
 * Hard PASS boundary for source-only consumers. A structural object, JSON
 * round-trip, or caller-authored plan cannot inherit the verified r6 claim.
 */
export function assertTrustedH1SourcePlan(
  source: H1SourcePlan,
): void {
  const trustedSource = trustedSourcePlans.get(source);
  if (trustedSource === undefined) {
    fail(
      'H1_SOURCE_PLAN_FORGED',
      'source plan was not produced by the verified r6 source-plan pipeline',
    );
  }
  if (
    !Object.isFrozen(source) ||
    canonicalSha256(source.manifestInputs) !==
      trustedSource.manifestSha256 ||
    source.manifestSha256 !== trustedSource.manifestSha256 ||
    source.physicalManifestIdentity.manifestCanonicalSha256 !==
      trustedSource.physicalManifestSha256 ||
    source.physicalManifestIdentity.primaryKeysByTableSha256 !==
      trustedSource.primaryKeysByTableSha256
  ) {
    fail(
      'H1_SOURCE_PLAN_FORGED',
      'verified r6 source plan no longer matches its trusted manifest',
    );
  }
}

/**
 * Selects exactly one of the ten sparse profiles. It never merges overlays.
 */
export function buildH1ProfileDatabasePlan(
  source: H1SourcePlan,
  corpusProfileId: H1AcceptanceCorpusProfileId,
): H1ProfileDatabasePlan {
  assertTrustedH1SourcePlan(source);
  const selected = profile(source, corpusProfileId);
  const authorityRows = source.physicalSeedPlan.rows;
  const profileRows = selected.rows;
  const bulkRows = source.bulkMaterialization.rows;
  const allRows: readonly H1DatabaseSeedRow[] = [
    ...authorityRows,
    ...profileRows,
    ...bulkRows,
  ];
  const counts = expectedCounts(allRows);
  const plannedTables = Object.freeze(
    [...new Set(allRows.map(({ table }) => table))].sort(),
  );
  const plannedTablesSha256 = canonicalSha256(plannedTables);
  const h0GuardTables = Object.freeze([...source.h0GuardTables]);
  const h0GuardTablesSha256 = canonicalSha256(h0GuardTables);
  const primaryKeysByTableMutable = Object.create(null) as Record<
    string,
    readonly string[]
  >;
  for (const table of plannedTables) {
    const primaryKeys =
      source.physicalManifestIdentity.primaryKeysByTable[table];
    if (primaryKeys === undefined || primaryKeys.length === 0) {
      fail(
        'H1_SOURCE_PHYSICAL_PRIMARY_KEY_INVALID',
        `planned table ${table} has no manifest primary key`,
      );
    }
    primaryKeysByTableMutable[table] = Object.freeze([
      ...primaryKeys,
    ]);
  }
  const primaryKeysByTable = Object.freeze(
    primaryKeysByTableMutable,
  );
  const primaryKeysByTableSha256 = canonicalSha256(
    primaryKeysByTable,
  );
  const totalPhysicalRowCount = allRows.length;
  const profileRowsSha256 = canonicalSha256(profileRows);
  const planInputs = {
    artifactKind: 'hearth-search-h1-profile-database-plan',
    measurementStatus: 'NOT_YET_MEASURED',
    corpusProfileId,
    sharedDatasetSha256: source.manifestInputs.datasetSha256,
    profileRowsSha256,
    expectedCountsSha256: canonicalSha256(counts),
    plannedTablesSha256,
    h0GuardTablesSha256,
    primaryKeysByTableSha256,
    migrationPinsSha256: source.manifestInputs.migrationPinsSha256,
    intendedSearchableCount: 100_000,
    boundedSourceCount: 100_037,
    totalPhysicalRowCount,
  };
  const plan: H1ProfileDatabasePlan = Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    corpusProfileId,
    authorityRows,
    profileRows,
    bulkRows,
    expectedCounts: counts,
    migrationPins: source.migrationPins,
    plannedTables,
    plannedTablesSha256,
    h0GuardTables,
    h0GuardTablesSha256,
    primaryKeysByTable,
    primaryKeysByTableSha256,
    intendedSearchableCount: 100_000,
    boundedSourceCount: 100_037,
    totalPhysicalRowCount,
    sharedDatasetSha256: source.manifestInputs.datasetSha256,
    profileRowsSha256,
    planSha256: canonicalSha256(planInputs),
  });
  trustedProfileDatabasePlans.set(plan, {
    h0GuardTables,
    primaryKeysByTable,
  });
  return plan;
}

function exactStringSet(
  observed: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    observed.length === expected.length &&
    observed.every((value, index) => value === expected[index])
  );
}

/**
 * Issues an opaque execution attestation only for a profile plan produced by
 * the verified r6 source-plan pipeline. The table set is recomputed in both
 * directions from seed rows and expected-count rows before it is branded.
 */
export function attestH1ProfileExecution(
  plan: H1ProfileDatabasePlan,
): H1VerifiedProfileExecutionAttestation {
  const trustedPlan = trustedProfileDatabasePlans.get(plan);
  if (trustedPlan === undefined) {
    fail(
      'H1_SOURCE_PROFILE_EXECUTION_FORGED',
      'profile execution plan was not built by the verified source-plan pipeline',
    );
  }
  const rowTables = [
    ...new Set(
      [
        ...plan.authorityRows,
        ...plan.profileRows,
        ...plan.bulkRows,
      ].map(({ table }) => table),
    ),
  ].sort();
  const countTables = [
    ...new Set(plan.expectedCounts.map(({ table }) => table)),
  ].sort();
  const declaredTables = [...plan.plannedTables].sort();
  const declaredH0GuardTables = [...plan.h0GuardTables].sort();
  const primaryKeyTables = Object.keys(
    plan.primaryKeysByTable,
  ).sort();
  if (
    new Set(plan.plannedTables).size !== plan.plannedTables.length ||
    !exactStringSet(rowTables, countTables) ||
    !exactStringSet(rowTables, declaredTables) ||
    canonicalSha256(declaredTables) !== plan.plannedTablesSha256
  ) {
    fail(
      'H1_SOURCE_PROFILE_TABLE_SET_INVALID',
      'profile row, expected-count, and declared table sets do not reconcile',
    );
  }
  if (
    new Set(plan.h0GuardTables).size !== plan.h0GuardTables.length ||
    !exactStringSet(
      declaredH0GuardTables,
      [...trustedPlan.h0GuardTables],
    ) ||
    canonicalSha256(declaredH0GuardTables) !==
      plan.h0GuardTablesSha256
  ) {
    fail(
      'H1_SOURCE_H0_GUARD_TABLE_SET_INVALID',
      'profile H0 guard set does not match the verified ten-profile union',
    );
  }
  if (
    !exactStringSet(primaryKeyTables, rowTables) ||
    canonicalSha256(plan.primaryKeysByTable) !==
      plan.primaryKeysByTableSha256 ||
    canonicalSha256(trustedPlan.primaryKeysByTable) !==
      plan.primaryKeysByTableSha256
  ) {
    fail(
      'H1_SOURCE_PHYSICAL_PRIMARY_KEY_INVALID',
      'profile primary-key map does not match Physical Domain Manifest v3',
    );
  }
  const exactTables = Object.freeze([...rowTables]);
  const h0GuardTables = Object.freeze([...declaredH0GuardTables]);
  const primaryKeysByTable = trustedPlan.primaryKeysByTable;
  const attestation: H1VerifiedProfileExecutionAttestation =
    Object.freeze({
      schemaVersion: 1,
      artifactKind:
        'hearth-search-h1-verified-profile-execution-attestation',
      measurementStatus: 'NOT_YET_MEASURED',
      corpusProfileId: plan.corpusProfileId,
      profilePlanSha256: plan.planSha256,
      exactTableCount: exactTables.length,
      exactTablesSha256: canonicalSha256(exactTables),
      h0GuardTableCount: h0GuardTables.length,
      h0GuardTablesSha256: canonicalSha256(h0GuardTables),
      primaryKeysByTableSha256:
        plan.primaryKeysByTableSha256,
    });
  verifiedProfileExecutionAttestations.set(attestation, {
    exactTables,
    h0GuardTables,
    primaryKeysByTable,
    profilePlanSha256: plan.planSha256,
  });
  return attestation;
}

/**
 * Resolves a fresh immutable copy of the exact verified table set. Structural
 * lookalikes are rejected; callers cannot author or narrow this set.
 */
export function resolveH1VerifiedSeedTableSet(
  attestation: H1VerifiedProfileExecutionAttestation,
): readonly string[] {
  const state = verifiedProfileExecutionAttestations.get(attestation);
  if (
    state === undefined ||
    state.profilePlanSha256 !== attestation.profilePlanSha256 ||
    state.exactTables.length !== attestation.exactTableCount ||
    canonicalSha256(state.exactTables) !== attestation.exactTablesSha256 ||
    state.h0GuardTables.length !== attestation.h0GuardTableCount ||
    canonicalSha256(state.h0GuardTables) !==
      attestation.h0GuardTablesSha256
  ) {
    fail(
      'H1_SOURCE_PROFILE_EXECUTION_FORGED',
      'profile execution attestation is unknown or does not match its exact table set',
    );
  }
  return Object.freeze([...state.exactTables]);
}

/**
 * Resolves the immutable authority-derived superset used for the H0 emptiness
 * check and retained table locks. This is deliberately broader than sparse
 * D0/E0/P0 profile rows: every table seedable by any verified profile is
 * guarded so stale overlay data cannot survive into an apparently empty run.
 */
export function resolveH1VerifiedH0GuardTableSet(
  attestation: H1VerifiedProfileExecutionAttestation,
): readonly string[] {
  const state = verifiedProfileExecutionAttestations.get(attestation);
  if (
    state === undefined ||
    state.profilePlanSha256 !== attestation.profilePlanSha256 ||
    state.exactTables.length !== attestation.exactTableCount ||
    canonicalSha256(state.exactTables) !== attestation.exactTablesSha256 ||
    state.h0GuardTables.length !== attestation.h0GuardTableCount ||
    canonicalSha256(state.h0GuardTables) !==
      attestation.h0GuardTablesSha256
  ) {
    fail(
      'H1_SOURCE_PROFILE_EXECUTION_FORGED',
      'profile execution attestation is unknown or does not match its H0 guard table set',
    );
  }
  return Object.freeze([...state.h0GuardTables]);
}

/**
 * Returns a fresh immutable copy of the exact current-profile manifest PK map.
 * Callers cannot substitute natural keys or generated defaults.
 */
export function resolveH1VerifiedPrimaryKeysByTable(
  attestation: H1VerifiedProfileExecutionAttestation,
): Readonly<Record<string, readonly string[]>> {
  const state = verifiedProfileExecutionAttestations.get(attestation);
  if (
    state === undefined ||
    state.profilePlanSha256 !== attestation.profilePlanSha256 ||
    canonicalSha256(state.primaryKeysByTable) !==
      attestation.primaryKeysByTableSha256
  ) {
    fail(
      'H1_SOURCE_PROFILE_EXECUTION_FORGED',
      'profile execution attestation is unknown or does not match its physical primary-key map',
    );
  }
  const copy = Object.create(null) as Record<
    string,
    readonly string[]
  >;
  for (const table of Object.keys(
    state.primaryKeysByTable,
  ).sort()) {
    const columns = state.primaryKeysByTable[table];
    if (columns === undefined) {
      fail(
        'H1_SOURCE_PHYSICAL_PRIMARY_KEY_INVALID',
        'verified primary-key map is incomplete',
      );
    }
    copy[table] = Object.freeze([...columns]);
  }
  return Object.freeze(copy);
}
