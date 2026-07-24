import { z } from 'zod';
import {
  deepFreezeFrozenData,
  readFrozenSunsetData,
} from './frozenData.js';
import type { SunsetRegistrySnapshot } from './types.js';

const NonEmptyStringSchema = z.string().min(1);
const StringListSchema = z.array(NonEmptyStringSchema);
const StringListRecordSchema = z.record(NonEmptyStringSchema, StringListSchema);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const SearchProjectionRegistryEntrySchema = z
  .object({
    table: NonEmptyStringSchema,
    match: StringListSchema,
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    subtitle: NonEmptyStringSchema,
    parent: NonEmptyStringSchema,
    extraWhere: NonEmptyStringSchema.nullable(),
  })
  .strict();

const SunsetRegistrySnapshotSchema = z
  .object({
    roles: StringListSchema,
    capabilityKeys: StringListSchema,
    roleCapabilities: z.record(
      NonEmptyStringSchema,
      z.record(NonEmptyStringSchema, z.boolean()),
    ),
    moduleKeys: StringListSchema,
    entitlementStates: StringListSchema,
    entitlementSnapshots: StringListSchema,
    searchDomains: StringListSchema,
    applicationResultKinds: StringListSchema,
    contractResultKinds: StringListSchema,
    gateClasses: StringListRecordSchema,
    predicateRegisters: StringListRecordSchema,
    documentOwnerTypes: StringListSchema,
    recordKinds: StringListSchema,
    matchFields: StringListRecordSchema,
    responseFields: z
      .object({
        envelope: StringListSchema,
        item: StringListSchema,
        application: StringListSchema,
        persistence: StringListSchema,
      })
      .strict(),
    projections: z.record(
      NonEmptyStringSchema,
      SearchProjectionRegistryEntrySchema,
    ),
    criticalSources: StringListSchema,
    criticalSourceFingerprints: z.record(NonEmptyStringSchema, Sha256Schema),
  })
  .strict();

export function parseFrozenSunsetRegistry(
  value: unknown,
): SunsetRegistrySnapshot {
  return SunsetRegistrySnapshotSchema.parse(value);
}

export const FROZEN_SUNSET_REGISTRY: SunsetRegistrySnapshot =
  deepFreezeFrozenData(
    parseFrozenSunsetRegistry(
      readFrozenSunsetData(
        'packages/search-harness/src/registry/frozenManifest.json',
      ),
    ),
  );
