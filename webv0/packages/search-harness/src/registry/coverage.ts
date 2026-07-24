import { canonicalJson, canonicalSha256 } from '../canonical.js';
import type { SunsetRegistrySnapshot } from './types.js';

export const SUNSET_COVERAGE_MANIFEST_VERSION = 'search-sunset/v1' as const;

export const SUNSET_COVERAGE_SURFACES = [
  'visibility-matrix',
  'qrels',
  'provenance',
  'positive-conformance',
  'negative-conformance',
] as const;

export type SunsetCoverageSurface =
  (typeof SUNSET_COVERAGE_SURFACES)[number];

export interface SunsetCoverageEntry {
  readonly factKey: string;
  readonly plannedRecordId: string;
}

export interface SunsetCoverageInventory {
  readonly artifactVersion: string;
  readonly entries: readonly SunsetCoverageEntry[];
}

export interface SunsetCoverageManifest {
  readonly manifestVersion: typeof SUNSET_COVERAGE_MANIFEST_VERSION;
  /**
   * H0 contains inspectable coverage plans, not fabricated H1 reviewer
   * artifacts. H1/H2 must bind every plannedRecordId to a signed real record.
   */
  readonly plannedCoverageOnly: true;
  readonly surfaces: Readonly<
    Record<SunsetCoverageSurface, SunsetCoverageInventory>
  >;
}

export type SunsetCoverageFailureCode =
  | 'SUNSET_COVERAGE_DUPLICATE_FACT'
  | 'SUNSET_COVERAGE_DUPLICATE_PLANNED_ID'
  | 'SUNSET_COVERAGE_FACT_MISSING'
  | 'SUNSET_COVERAGE_FACT_UNKNOWN'
  | 'SUNSET_COVERAGE_MANIFEST_INVALID';

export interface SunsetCoverageFailure {
  readonly code: SunsetCoverageFailureCode;
  readonly surface: string;
  readonly factKey?: string;
  readonly plannedRecordId?: string;
}

function orderedFacts(path: string, values: readonly string[]): string[] {
  return values.map(
    (value, index) => `${path}[${index}]=${canonicalJson(value)}`,
  );
}

function recordFacts<T>(
  path: string,
  record: Readonly<Record<string, T>>,
  valueFacts: (entryPath: string, value: T) => readonly string[],
): string[] {
  return Object.keys(record)
    .sort()
    .flatMap((key) => valueFacts(`${path}.${key}`, record[key]!));
}

/**
 * Canonical atomic closed-registry facts. Array indices retain ordering; every
 * object key is explicit, so addition, removal, reordering, or value drift
 * changes the required set.
 */
export function sunsetClosedFactKeys(
  snapshot: SunsetRegistrySnapshot,
): readonly string[] {
  const facts = [
    ...orderedFacts('roles', snapshot.roles),
    ...orderedFacts('capabilityKeys', snapshot.capabilityKeys),
    ...recordFacts(
      'roleCapabilities',
      snapshot.roleCapabilities,
      (rolePath, capabilities) =>
        [`${rolePath}=${canonicalJson(capabilities)}`],
    ),
    ...orderedFacts('moduleKeys', snapshot.moduleKeys),
    ...orderedFacts('entitlementStates', snapshot.entitlementStates),
    ...orderedFacts('entitlementSnapshots', snapshot.entitlementSnapshots),
    ...orderedFacts('searchDomains', snapshot.searchDomains),
    ...orderedFacts(
      'applicationResultKinds',
      snapshot.applicationResultKinds,
    ),
    ...orderedFacts('contractResultKinds', snapshot.contractResultKinds),
    ...recordFacts('gateClasses', snapshot.gateClasses, (path, values) => [
      `${path}=${canonicalJson(values)}`,
    ]),
    ...recordFacts(
      'predicateRegisters',
      snapshot.predicateRegisters,
      (path, values) => [`${path}=${canonicalJson(values)}`],
    ),
    ...orderedFacts('documentOwnerTypes', snapshot.documentOwnerTypes),
    ...orderedFacts('recordKinds', snapshot.recordKinds),
    ...recordFacts('matchFields', snapshot.matchFields, (path, values) => [
      `${path}=${canonicalJson(values)}`,
    ]),
    ...recordFacts(
      'responseFields',
      {
        application: snapshot.responseFields.application,
        envelope: snapshot.responseFields.envelope,
        item: snapshot.responseFields.item,
        persistence: snapshot.responseFields.persistence,
      },
      (path, values) => [`${path}=${canonicalJson(values)}`],
    ),
    ...recordFacts('projections', snapshot.projections, (path, projection) => [
      `${path}=${canonicalJson(projection)}`,
    ]),
    `criticalSourcesSha256=${canonicalSha256(snapshot.criticalSources)}`,
    `criticalSourceFingerprintsSha256=${canonicalSha256(
      snapshot.criticalSourceFingerprints,
    )}`,
  ].sort();
  if (new Set(facts).size !== facts.length) {
    throw new Error('Closed-registry fact-key extraction produced duplicates');
  }
  return Object.freeze(facts);
}

export function compareSunsetCoverage(
  snapshot: SunsetRegistrySnapshot,
  manifest: SunsetCoverageManifest,
): SunsetCoverageFailure[] {
  const failures: SunsetCoverageFailure[] = [];
  if (
    manifest.manifestVersion !== SUNSET_COVERAGE_MANIFEST_VERSION ||
    manifest.plannedCoverageOnly !== true
  ) {
    failures.push({
      code: 'SUNSET_COVERAGE_MANIFEST_INVALID',
      surface: 'manifest',
    });
  }

  const actualSurfaceKeys = Object.keys(manifest.surfaces);
  const expectedSurfaceKeys = new Set<string>(SUNSET_COVERAGE_SURFACES);
  if (
    actualSurfaceKeys.length !== expectedSurfaceKeys.size ||
    actualSurfaceKeys.some((surface) => !expectedSurfaceKeys.has(surface))
  ) {
    failures.push({
      code: 'SUNSET_COVERAGE_MANIFEST_INVALID',
      surface: 'surfaces',
    });
  }

  const requiredFacts = new Set(sunsetClosedFactKeys(snapshot));
  for (const surface of SUNSET_COVERAGE_SURFACES) {
    const inventory = manifest.surfaces[surface];
    if (
      !inventory ||
      inventory.artifactVersion.length === 0 ||
      inventory.artifactVersion !== inventory.artifactVersion.trim()
    ) {
      failures.push({
        code: 'SUNSET_COVERAGE_MANIFEST_INVALID',
        surface,
      });
      continue;
    }

    const coveredFacts = new Set<string>();
    const plannedRecordIds = new Set<string>();
    for (const entry of inventory.entries) {
      if (
        entry.factKey.length === 0 ||
        entry.factKey !== entry.factKey.trim() ||
        entry.plannedRecordId.length === 0 ||
        entry.plannedRecordId !== entry.plannedRecordId.trim()
      ) {
        failures.push({
          code: 'SUNSET_COVERAGE_MANIFEST_INVALID',
          surface,
        });
        continue;
      }
      if (coveredFacts.has(entry.factKey)) {
        failures.push({
          code: 'SUNSET_COVERAGE_DUPLICATE_FACT',
          surface,
          factKey: entry.factKey,
        });
      }
      coveredFacts.add(entry.factKey);
      if (plannedRecordIds.has(entry.plannedRecordId)) {
        failures.push({
          code: 'SUNSET_COVERAGE_DUPLICATE_PLANNED_ID',
          surface,
          plannedRecordId: entry.plannedRecordId,
        });
      }
      plannedRecordIds.add(entry.plannedRecordId);
      if (!requiredFacts.has(entry.factKey)) {
        failures.push({
          code: 'SUNSET_COVERAGE_FACT_UNKNOWN',
          surface,
          factKey: entry.factKey,
        });
      }
    }
    for (const factKey of requiredFacts) {
      if (!coveredFacts.has(factKey)) {
        failures.push({
          code: 'SUNSET_COVERAGE_FACT_MISSING',
          surface,
          factKey,
        });
      }
    }
  }
  return failures;
}

export class SunsetCoverageError extends Error {
  readonly failures: readonly SunsetCoverageFailure[];

  constructor(failures: readonly SunsetCoverageFailure[]) {
    super(
      `Search coverage plan is incomplete:\n${failures
        .map(
          (failure) =>
            `${failure.code} ${failure.surface} ${failure.factKey ?? ''}`,
        )
        .join('\n')}`,
    );
    this.name = 'SunsetCoverageError';
    this.failures = failures;
  }
}

export function assertSunsetCoverage(
  snapshot: SunsetRegistrySnapshot,
  manifest: SunsetCoverageManifest,
): void {
  const failures = compareSunsetCoverage(snapshot, manifest);
  if (failures.length > 0) {
    throw new SunsetCoverageError(failures);
  }
}
