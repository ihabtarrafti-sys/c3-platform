import {
  FROZEN_SUNSET_REGISTRY,
  FROZEN_SUNSET_COVERAGE_MANIFEST,
  SUNSET_COVERAGE_MANIFEST_VERSION,
  assertSunsetCoverage,
  assertSunsetRegistry,
  buildLiveSunsetRegistrySnapshot,
} from '../registry/index.js';
import { parseProfile, runCommand } from './common.js';

runCommand(() => {
  const profile = parseProfile(process.argv.slice(2));
  const live = buildLiveSunsetRegistrySnapshot();
  assertSunsetRegistry(FROZEN_SUNSET_REGISTRY, live);
  assertSunsetCoverage(live, FROZEN_SUNSET_COVERAGE_MANIFEST);
  throw Object.assign(
    new Error(
      `${profile} real-path conformance requires the H2 database collector and runner`,
    ),
    {
      code: 'HARNESS_STAGE_H2_REQUIRED',
      sunsetCoverageManifest: SUNSET_COVERAGE_MANIFEST_VERSION,
    },
  );
});
