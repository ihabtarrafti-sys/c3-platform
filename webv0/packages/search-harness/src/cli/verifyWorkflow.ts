import {
  SUNSET_COVERAGE_MANIFEST_VERSION,
} from '../registry/coverage.js';
import type {
  HarnessSelfTestReceipt,
} from './selfTestRunner.js';

export interface H0VerificationDependencies {
  readonly assertSunsetPreflight: () => void;
  readonly runRedSelfTests: () => HarnessSelfTestReceipt;
}

export interface H0VerificationResult {
  readonly command: 'search:harness:verify';
  readonly status: 'PASS';
  readonly attestations: {
    readonly safetyStage: 'H0';
    readonly certificationScope: 'safety-shell-only';
    readonly recordReady: false;
    readonly externalArtifactAuthenticityVerified: false;
    readonly signatureTrustStoreConfigured: false;
    readonly sunsetCoverageManifest: typeof SUNSET_COVERAGE_MANIFEST_VERSION;
    readonly sunsetCoverageSurfaceCount: number;
    readonly redSelfTestsExecuted: true;
    readonly harnessTestCount: number;
  };
}

/**
 * The sunset check is intentionally the first executable dependency.
 * A thrown drift error must prevent the RED/self-test process from starting.
 */
export function runH0VerificationWorkflow(
  dependencies: H0VerificationDependencies,
  sunsetCoverageSurfaceCount: number,
): H0VerificationResult {
  dependencies.assertSunsetPreflight();
  const selfTests = dependencies.runRedSelfTests();

  return {
    command: 'search:harness:verify',
    status: 'PASS',
    attestations: {
      safetyStage: 'H0',
      certificationScope: 'safety-shell-only',
      recordReady: false,
      externalArtifactAuthenticityVerified: false,
      signatureTrustStoreConfigured: false,
      sunsetCoverageManifest: SUNSET_COVERAGE_MANIFEST_VERSION,
      sunsetCoverageSurfaceCount,
      ...selfTests,
    },
  };
}
