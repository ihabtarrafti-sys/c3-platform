import {
  SUNSET_COVERAGE_MANIFEST_VERSION,
  SUNSET_COVERAGE_SURFACES,
  applySearchSunsetRefresh,
  assertSearchSunsetPreflight,
  createSearchSunsetRefreshPlan,
  parseSunsetRefreshRequest,
  publicSunsetRefreshPlan,
} from '../registry/index.js';
import type {
  AppliedSunsetRefresh,
  SunsetRefreshPlanEvidence,
} from '../registry/index.js';
import { runCommand } from './common.js';
import type { HarnessCommandResult } from './common.js';

interface SunsetRefreshCommandResult extends HarnessCommandResult {
  readonly refreshPlan: SunsetRefreshPlanEvidence & {
    readonly planSha256: string;
  };
  readonly postWrite?: {
    readonly artifactSha256:
      AppliedSunsetRefresh['postWriteArtifactSha256'];
    readonly registryFailureCount: 0;
    readonly coverageFailureCount: 0;
    readonly freshPreflightPassed: true;
  };
}

function runSunsetCommand(): HarnessCommandResult {
  const request = parseSunsetRefreshRequest(process.argv.slice(2));
  if (request.mode === 'preflight') {
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
  }

  const applied = request.mode === 'apply'
    ? applySearchSunsetRefresh(request.expectedPlanSha256)
    : undefined;
  const plan = applied?.plan ?? createSearchSunsetRefreshPlan();
  const publicPlan = publicSunsetRefreshPlan(plan);
  const result: SunsetRefreshCommandResult = {
    command: 'search:harness:sunset-refresh',
    status: 'PASS',
    attestations: {
      safetyStage: 'H0',
      refreshMode: request.mode,
      applied: request.mode === 'apply',
      frozenArtifactCount: publicPlan.artifacts.length,
      registryFalsifierCount:
        publicPlan.falsifiers.registry.length,
      coverageFalsifierCount:
        publicPlan.falsifiers.coverage.length,
      planSha256: publicPlan.planSha256,
      claimCeiling: publicPlan.claimCeiling,
    },
    refreshPlan: publicPlan,
  };
  if (applied === undefined) return result;
  const appliedResult: SunsetRefreshCommandResult = {
    ...result,
    postWrite: {
      artifactSha256: applied.postWriteArtifactSha256,
      registryFailureCount:
        applied.postWriteRegistryFailureCount,
      coverageFailureCount:
        applied.postWriteCoverageFailureCount,
      freshPreflightPassed: applied.freshPreflightPassed,
    },
  };
  return appliedResult;
}

runCommand(runSunsetCommand);
