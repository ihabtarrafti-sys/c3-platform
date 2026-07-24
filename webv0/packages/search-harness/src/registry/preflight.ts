import {
  assertSunsetCoverage,
} from './coverage';
import {
  FROZEN_SUNSET_COVERAGE_MANIFEST,
} from './frozenCoverageManifest';
import {
  FROZEN_SUNSET_REGISTRY,
} from './frozenManifest';
import {
  buildLiveSunsetRegistrySnapshot,
} from './liveSnapshot';
import {
  assertSunsetRegistry,
} from './compare';

/**
 * Fail-fast H0 guard. Call this before any harness or workspace test process.
 */
export function assertSearchSunsetPreflight(): void {
  const live = buildLiveSunsetRegistrySnapshot();
  assertSunsetRegistry(FROZEN_SUNSET_REGISTRY, live);
  assertSunsetCoverage(live, FROZEN_SUNSET_COVERAGE_MANIFEST);
}
