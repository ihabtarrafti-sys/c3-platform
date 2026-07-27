import { z } from 'zod';
import {
  SUNSET_COVERAGE_ARTIFACT_VERSIONS,
  SUNSET_COVERAGE_MANIFEST_VERSION,
} from './coverage.js';
import type {
  SunsetCoverageSurface,
} from './coverage.js';
import type { SunsetCoverageManifest } from './coverage.js';
import {
  deepFreezeFrozenData,
  readFrozenSunsetData,
} from './frozenData.js';

const NonEmptyStringSchema = z.string().min(1);

function sunsetCoverageInventorySchema(
  surface: SunsetCoverageSurface,
) {
  return z
    .object({
      artifactVersion: z.literal(
        SUNSET_COVERAGE_ARTIFACT_VERSIONS[surface],
      ),
      entries: z.array(
        z
          .object({
            factKey: NonEmptyStringSchema,
            plannedRecordId: NonEmptyStringSchema,
          })
          .strict(),
      ),
    })
    .strict();
}

const SunsetCoverageManifestSchema = z
  .object({
    manifestVersion: z.literal(SUNSET_COVERAGE_MANIFEST_VERSION),
    plannedCoverageOnly: z.literal(true),
    surfaces: z
      .object({
        'visibility-matrix': sunsetCoverageInventorySchema(
          'visibility-matrix',
        ),
        qrels: sunsetCoverageInventorySchema('qrels'),
        provenance: sunsetCoverageInventorySchema('provenance'),
        'positive-conformance': sunsetCoverageInventorySchema(
          'positive-conformance',
        ),
        'negative-conformance': sunsetCoverageInventorySchema(
          'negative-conformance',
        ),
      })
      .strict(),
  })
  .strict();

export function parseFrozenSunsetCoverageManifest(
  value: unknown,
): SunsetCoverageManifest {
  return SunsetCoverageManifestSchema.parse(value);
}

export const FROZEN_SUNSET_COVERAGE_MANIFEST: SunsetCoverageManifest =
  deepFreezeFrozenData(
    parseFrozenSunsetCoverageManifest(
      readFrozenSunsetData(
        'packages/search-harness/src/registry/frozenCoverageManifest.json',
      ),
    ),
  );
