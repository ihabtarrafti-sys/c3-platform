import { canonicalJson, canonicalSha256 } from '../canonical.js';
import { HearthHarnessError } from '../errors.js';
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

export const SUNSET_COVERAGE_ARTIFACT_VERSIONS = {
  'visibility-matrix': 'hearth-search-visibility/coverage-v1',
  qrels: 'hearth-search-qrels/coverage-v1',
  provenance: 'hearth-search-provenance/coverage-v1',
  'positive-conformance': 'hearth-search-positive/coverage-v1',
  'negative-conformance': 'hearth-search-negative/coverage-v1',
} as const satisfies Readonly<Record<SunsetCoverageSurface, string>>;

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
  | 'SUNSET_COVERAGE_ARTIFACT_VERSION_CHANGED'
  | 'SUNSET_COVERAGE_DUPLICATE_FACT'
  | 'SUNSET_COVERAGE_DUPLICATE_PLANNED_ID'
  | 'SUNSET_COVERAGE_ENTRY_ORDER_CHANGED'
  | 'SUNSET_COVERAGE_FACT_MISSING'
  | 'SUNSET_COVERAGE_FACT_UNKNOWN'
  | 'SUNSET_COVERAGE_MANIFEST_INVALID'
  | 'SUNSET_COVERAGE_PLANNED_ID_CHANGED';

export interface SunsetCoverageFailure {
  readonly code: SunsetCoverageFailureCode;
  readonly surface: string;
  readonly factKey?: string;
  readonly plannedRecordId?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
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

/**
 * H0 coverage IDs are deterministic planning slots, not signed reviewer
 * records. Every refresh therefore re-derives them from the sorted live fact
 * set. Once a later stage binds real records to these IDs, that stage must
 * replace plannedCoverageOnly with a versioned non-regenerable contract.
 */
export function buildSunsetCoverageManifest(
  snapshot: SunsetRegistrySnapshot,
): SunsetCoverageManifest {
  const facts = sunsetClosedFactKeys(snapshot);
  const surfaces = {} as Record<
    SunsetCoverageSurface,
    SunsetCoverageInventory
  >;
  for (const surface of SUNSET_COVERAGE_SURFACES) {
    surfaces[surface] = {
      artifactVersion: SUNSET_COVERAGE_ARTIFACT_VERSIONS[surface],
      entries: facts.map((factKey, index) => ({
        factKey,
        plannedRecordId: `hearth-search:${surface}:${String(
          index + 1,
        ).padStart(3, '0')}`,
      })),
    };
  }
  return {
    manifestVersion: SUNSET_COVERAGE_MANIFEST_VERSION,
    plannedCoverageOnly: true,
    surfaces,
  };
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
  const generatedManifest = buildSunsetCoverageManifest(snapshot);
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
    const generatedInventory = generatedManifest.surfaces[surface];
    if (
      inventory.artifactVersion !== generatedInventory.artifactVersion
    ) {
      failures.push({
        code: 'SUNSET_COVERAGE_ARTIFACT_VERSION_CHANGED',
        surface,
        expected: generatedInventory.artifactVersion,
        actual: inventory.artifactVersion,
      });
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
    if (
      inventory.entries.length === generatedInventory.entries.length &&
      inventory.entries.every(({ factKey }) =>
        requiredFacts.has(factKey),
      ) &&
      coveredFacts.size === requiredFacts.size &&
      inventory.entries.some(
        (entry, index) =>
          entry.factKey !== generatedInventory.entries[index]?.factKey,
      )
    ) {
      failures.push({
        code: 'SUNSET_COVERAGE_ENTRY_ORDER_CHANGED',
        surface,
      });
    }
    const generatedByFact = new Map(
      generatedInventory.entries.map((entry) => [
        entry.factKey,
        entry.plannedRecordId,
      ]),
    );
    for (const entry of inventory.entries) {
      const expectedPlannedRecordId = generatedByFact.get(entry.factKey);
      if (
        expectedPlannedRecordId !== undefined &&
        entry.plannedRecordId !== expectedPlannedRecordId
      ) {
        failures.push({
          code: 'SUNSET_COVERAGE_PLANNED_ID_CHANGED',
          surface,
          factKey: entry.factKey,
          plannedRecordId: entry.plannedRecordId,
          expected: expectedPlannedRecordId,
          actual: entry.plannedRecordId,
        });
      }
    }
  }
  return failures;
}

declare const RedactedFactBrand: unique symbol;

/**
 * A fact NAME with its value stripped. Only `redactFactKey` can produce one —
 * the brand is unforgeable without a cast — so `sunsetCoverageSummary` cannot be
 * handed a raw factKey even by accident. Same mechanism as
 * `SunsetFailureLabel` in compare.ts: the containment is held by the compiler,
 * not by whoever reads this file next.
 */
export type RedactedFactName = string & {
  readonly [RedactedFactBrand]: true;
};

/**
 * A factKey is `name=value` — `criticalSourceFingerprintsSha256=ecae78ce…`,
 * `contractResultKinds[9]="team"`. **The left side is a field name or a
 * positional index and carries no data; the right side is the value and may
 * never travel.** Split on the FIRST `=`, which stays correct even when a value
 * contains one.
 *
 * ⛔ SAFETY FALLBACK, deliberate and not an oversight: a factKey with NO `=` is
 * a shape we do not recognise, so it yields the EMPTY string and the caller
 * emits the bare code. Never emit an unsplit key on the assumption the shape
 * holds — that assumption is exactly the class of thing that quietly stops being
 * true a year later.
 */
export function redactFactKey(
  factKey: string | null | undefined,
): RedactedFactName {
  if (!factKey) return '' as RedactedFactName;
  const separator = factKey.indexOf('=');
  if (separator === -1) return '' as RedactedFactName;
  return `${factKey.slice(0, separator)}=<redacted>` as RedactedFactName;
}

export interface SunsetCoverageLabel {
  readonly code: SunsetCoverageFailureCode;
  readonly surface: string;
  readonly factName: RedactedFactName;
}

/**
 * The RUNTIME belt to the compiler's braces.
 *
 * ⚠️ A BRAND IS ERASED AT RUNTIME. `RedactedFactName` proves INTENT at every
 * call site the compiler can see, but a value arriving through `any`, a JSON
 * round-trip, or a deserialized manifest carries no type at all — and it would
 * travel with its value attached. No current call path does that; this exists so
 * that a future one cannot.
 *
 * Fails CLOSED, deliberately, and does not throw: a verdict path must still
 * produce a verdict. An unrecognised shape says nothing rather than saying too
 * much — the same choice as the no-`=` fallback in `redactFactKey`.
 */
function containedFactName(factName: string): string {
  if (factName === '' || factName.endsWith('=<redacted>')) return factName;
  return '';
}

export function sunsetCoverageSummary(
  labels: readonly SunsetCoverageLabel[],
): string {
  return `Search coverage plan is incomplete:\n${labels
    .map((label) =>
      `${label.code} ${label.surface} ${containedFactName(label.factName)}`.trimEnd(),
    )
    .join('\n')}`;
}

/**
 * ⚖️ WHY THIS IS REDACTED WHERE `SunsetRegistryError` IS NOT.
 *
 * The registry message is codes and paths — no data — so it passes through the
 * CLI's suppression allowlist whole. This one embeds `factKey`, and **a factKey
 * carries a VALUE**, which is precisely what that allowlist exists to keep in.
 *
 * The resolution is not to choose between a useful message and a safe one:
 * **emit the fact NAME and redact the value.** The operator learns WHICH
 * contract drifted rather than merely THAT one did, and still learns nothing
 * about the values. Codes, paths and field names may travel; values never do.
 */
export class SunsetCoverageError extends HearthHarnessError<'SUNSET_COVERAGE_INCOMPLETE'> {
  readonly failures: readonly SunsetCoverageFailure[];

  constructor(failures: readonly SunsetCoverageFailure[]) {
    super(
      'SUNSET_COVERAGE_INCOMPLETE',
      sunsetCoverageSummary(
        failures.map((failure) => ({
          code: failure.code,
          surface: failure.surface,
          factName: redactFactKey(failure.factKey),
        })),
      ),
      { failureCount: failures.length },
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
