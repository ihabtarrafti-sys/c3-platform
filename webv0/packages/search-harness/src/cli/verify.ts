import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUNSET_COVERAGE_MANIFEST_VERSION,
  SUNSET_COVERAGE_SURFACES,
  assertSearchSunsetPreflight,
} from '../registry/index.js';
import {
  assertTrustedH1SourcePlan,
  prepareH1SourcePlan,
} from '../h1/sourcePlan.js';
import { runCommand } from './common.js';
import { runHarnessRedSelfTests } from './selfTestRunner.js';

runCommand(() => {
  const webv0Root = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
  );
  const harnessRoot = join(
    webv0Root,
    'packages',
    'search-harness',
  );
  const vitest = join(webv0Root, 'node_modules', 'vitest', 'vitest.mjs');
  const harnessConfig = join(harnessRoot, 'vitest.config.ts');
  assertSearchSunsetPreflight();
  const source = prepareH1SourcePlan();
  assertTrustedH1SourcePlan(source);
  const selfTests = runHarnessRedSelfTests({
    executablePath: process.execPath,
    vitestPath: vitest,
    configPath: harnessConfig,
    harnessRoot,
  });

  return {
    command: 'search:harness:verify',
    status: 'PASS',
    attestations: {
      safetyStage: 'H1',
      certificationScope:
        'source-plan-and-bounded-baseline-drift-partition',
      baselineMeaning: 'dae27a4-drift-baseline-only',
      recordReady: false,
      h4BaselineRecorded: false,
      databaseSeedReceiptPresent: false,
      authorityBundleContentVerified: true,
      externalArtifactAuthenticityVerified: false,
      signatureTrustStoreConfigured: false,
      sunsetCoverageManifest: SUNSET_COVERAGE_MANIFEST_VERSION,
      sunsetCoverageSurfaceCount: SUNSET_COVERAGE_SURFACES.length,
      ...selfTests,
      sourcePlanSha256: source.manifestSha256,
      externallyPinnedAuthorityRoot:
        source.manifestInputs.externallyPinnedAuthorityRoot,
      intendedSearchableCount:
        source.manifestInputs.intendedSearchableCount,
      boundedSourceCount: source.manifestInputs.boundedSourceCount,
      actorProfileCount:
        source.boundedClassification.manifestInputs.actorProfileCount,
      classificationCount:
        source.boundedClassification.manifestInputs.classificationCount,
      classificationIntersectionCount:
        source.boundedClassification.manifestInputs.intersectionCount,
      classificationUnclassifiedCount:
        source.boundedClassification.manifestInputs.unclassifiedCount,
      hardCanarySourceCount:
        source.boundedClassification.manifestInputs
          .hardCanarySourceCount,
      boundedPartitionSha256:
        source.boundedClassification.manifestInputs
          .b0O0PartitionSha256,
    },
  };
});
