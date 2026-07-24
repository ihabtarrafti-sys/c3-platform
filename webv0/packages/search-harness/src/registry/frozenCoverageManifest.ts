import { z } from 'zod';
import {
  SUNSET_COVERAGE_MANIFEST_VERSION,
} from './coverage.js';
import type { SunsetCoverageManifest } from './coverage.js';
import {
  deepFreezeFrozenData,
  readFrozenSunsetData,
} from './frozenData.js';

const NonEmptyStringSchema = z.string().min(1);

const SunsetCoverageInventorySchema = z
  .object({
    artifactVersion: NonEmptyStringSchema,
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

const SunsetCoverageManifestSchema = z
  .object({
    manifestVersion: z.literal(SUNSET_COVERAGE_MANIFEST_VERSION),
    plannedCoverageOnly: z.literal(true),
    surfaces: z
      .object({
        'visibility-matrix': SunsetCoverageInventorySchema,
        qrels: SunsetCoverageInventorySchema,
        provenance: SunsetCoverageInventorySchema,
        'positive-conformance': SunsetCoverageInventorySchema,
        'negative-conformance': SunsetCoverageInventorySchema,
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
