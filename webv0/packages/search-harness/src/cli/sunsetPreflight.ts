import {
  SUNSET_COVERAGE_MANIFEST_VERSION,
  SUNSET_COVERAGE_SURFACES,
  assertSearchSunsetPreflight,
} from '../registry/index.js';
import { runCommand } from './common.js';

runCommand(() => {
  assertSearchSunsetPreflight();
  return {
    command: 'search:harness:sunset-preflight',
    status: 'PASS',
    attestations: {
      safetyStage: 'H0',
      sunsetCoverageManifest: SUNSET_COVERAGE_MANIFEST_VERSION,
      sunsetCoverageSurfaceCount: SUNSET_COVERAGE_SURFACES.length,
    },
  };
});
