import { describe, expect, it } from 'vitest';
import {
  FROZEN_SUNSET_REGISTRY,
  FROZEN_SUNSET_COVERAGE_MANIFEST,
  assertSunsetCoverage,
  assertSunsetRegistry,
  buildLiveSunsetRegistrySnapshot,
  compareSunsetCoverage,
  compareSunsetRegistry,
  isSunsetEnforcementTreePath,
  listSunsetEnforcementTreeFiles,
  SUNSET_COVERAGE_SURFACES,
  SUNSET_ENFORCEMENT_TREE_KEY,
  SUNSET_POLICY_ROOTS,
  SUNSET_WIRING_FILES,
  SunsetCoverageError,
  SunsetRegistryError,
} from '../../src/registry';
import type {
  SearchProjectionRegistryEntry,
  SunsetCoverageManifest,
  SunsetCoverageSurface,
  SunsetReasonCode,
  SunsetRegistrySnapshot,
} from '../../src/registry';

function withPatch(patch: Partial<SunsetRegistrySnapshot>): SunsetRegistrySnapshot {
  return { ...FROZEN_SUNSET_REGISTRY, ...patch };
}

function failureCodes(actual: SunsetRegistrySnapshot): SunsetReasonCode[] {
  return compareSunsetRegistry(FROZEN_SUNSET_REGISTRY, actual).map(
    (failure) => failure.code,
  );
}

function withoutKey<T>(
  record: Readonly<Record<string, T>>,
  removedKey: string,
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== removedKey));
}

function withCoverageEntries(
  surface: SunsetCoverageSurface,
  entries: SunsetCoverageManifest['surfaces'][SunsetCoverageSurface]['entries'],
): SunsetCoverageManifest {
  return {
    ...FROZEN_SUNSET_COVERAGE_MANIFEST,
    surfaces: {
      ...FROZEN_SUNSET_COVERAGE_MANIFEST.surfaces,
      [surface]: {
        ...FROZEN_SUNSET_COVERAGE_MANIFEST.surfaces[surface],
        entries,
      },
    },
  };
}

describe('H0 permanent search sunset registry', () => {
  it('matches the live public registries and private AST/source snapshot', () => {
    const live = buildLiveSunsetRegistrySnapshot();
    expect(compareSunsetRegistry(FROZEN_SUNSET_REGISTRY, live)).toEqual([]);
    expect(() => assertSunsetRegistry(FROZEN_SUNSET_REGISTRY, live)).not.toThrow();
  });

  it('fingerprints every complete policy root as the unknown-gate backstop', () => {
    for (const root of SUNSET_POLICY_ROOTS) {
      expect(
        FROZEN_SUNSET_REGISTRY.criticalSourceFingerprints[`${root}#tree`],
      ).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('fingerprints enforcement wiring and generated API contract artifacts', () => {
    for (const file of SUNSET_WIRING_FILES) {
      expect(
        FROZEN_SUNSET_REGISTRY.criticalSourceFingerprints[`${file}#wiring`],
      ).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(
      FROZEN_SUNSET_REGISTRY.criticalSourceFingerprints[
        SUNSET_ENFORCEMENT_TREE_KEY
      ],
    ).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    'packages/search-harness/node_modules/.vite/vitest/results.json',
    'packages/search-harness/NODE_MODULES/.VITE/vitest/results.json',
    'packages/search-harness/.vite/deps/cache.json',
    'packages/search-harness/coverage/index.html',
    'packages/search-harness/dist/index.js',
    'packages/search-harness/tsconfig.tsbuildinfo',
    'packages/search-harness/test-output.log',
  ])('RED: excludes generated enforcement-tree artifact %s', (relativePath) => {
    expect(isSunsetEnforcementTreePath(relativePath)).toBe(false);
  });

  it('keeps every real harness source and test file inside the enforcement tree', () => {
    expect(
      isSunsetEnforcementTreePath(
        'packages/search-harness/src/new-sensitive-policy.ts',
      ),
    ).toBe(true);
    expect(
      isSunsetEnforcementTreePath(
        'packages/search-harness/test/new-sensitive-policy.test.ts',
      ),
    ).toBe(true);
    expect(
      isSunsetEnforcementTreePath(
        'packages/search-harness/src/dist/new-sensitive-policy.ts',
      ),
    ).toBe(true);
    expect(
      listSunsetEnforcementTreeFiles().every(isSunsetEnforcementTreePath),
    ).toBe(true);
  });

  it('binds every coverage surface to the exact complete closed registry', () => {
    const live = buildLiveSunsetRegistrySnapshot();
    expect(
      compareSunsetCoverage(live, FROZEN_SUNSET_COVERAGE_MANIFEST),
    ).toEqual([]);
    expect(() =>
      assertSunsetCoverage(live, FROZEN_SUNSET_COVERAGE_MANIFEST),
    ).not.toThrow();
  });

  it.each(SUNSET_COVERAGE_SURFACES)(
    'RED: missing, unknown, and duplicate %s coverage fail before sampling',
    (surface) => {
      const entries = FROZEN_SUNSET_COVERAGE_MANIFEST.surfaces[surface].entries;

      expect(() =>
        assertSunsetCoverage(
          FROZEN_SUNSET_REGISTRY,
          withCoverageEntries(surface, entries.slice(1)),
        ),
      ).toThrow(SunsetCoverageError);

      expect(
        compareSunsetCoverage(
          FROZEN_SUNSET_REGISTRY,
          withCoverageEntries(surface, [
            ...entries,
            {
              factKey: 'roles[999]="unknown-role"',
              plannedRecordId: `${surface}:unknown`,
            },
          ]),
        ).map(({ code }) => code),
      ).toContain('SUNSET_COVERAGE_FACT_UNKNOWN');

      expect(
        compareSunsetCoverage(
          FROZEN_SUNSET_REGISTRY,
          withCoverageEntries(surface, [
            ...entries.slice(0, 1),
            {
              ...entries[1]!,
              plannedRecordId: entries[0]!.plannedRecordId,
            },
            ...entries.slice(2),
          ]),
        ).map(({ code }) => code),
      ).toContain('SUNSET_COVERAGE_DUPLICATE_PLANNED_ID');

      expect(
        compareSunsetCoverage(
          FROZEN_SUNSET_REGISTRY,
          withCoverageEntries(surface, [
            ...entries,
            {
              ...entries[0]!,
              plannedRecordId: `${surface}:duplicate-fact`,
            },
          ]),
        ).map(({ code }) => code),
      ).toContain('SUNSET_COVERAGE_DUPLICATE_FACT');
    },
  );

  it('RED: registry growth invalidates all five coverage surfaces', () => {
    const grown = withPatch({
      roles: [...FROZEN_SUNSET_REGISTRY.roles, 'auditor'],
    });
    const failures = compareSunsetCoverage(
      grown,
      FROZEN_SUNSET_COVERAGE_MANIFEST,
    );
    expect(failures).toHaveLength(SUNSET_COVERAGE_SURFACES.length);
    expect(
      failures.every(
        ({ code }) => code === 'SUNSET_COVERAGE_FACT_MISSING',
      ),
    ).toBe(true);
  });

  const fakeProjection: SearchProjectionRegistryEntry = {
    table: 'secret',
    match: ['secret_id'],
    id: 'secret_id',
    title: 'secret_id',
    subtitle: 'NULL',
    parent: 'NULL',
    extraWhere: null,
  };

  const redMutations: ReadonlyArray<{
    readonly name: string;
    readonly code: SunsetReasonCode;
    readonly actual: SunsetRegistrySnapshot;
  }> = [
    {
      name: 'RED role addition',
      code: 'SUNSET_ROLE_ADDED',
      actual: withPatch({ roles: [...FROZEN_SUNSET_REGISTRY.roles, 'auditor'] }),
    },
    {
      name: 'RED role removal',
      code: 'SUNSET_ROLE_REMOVED',
      actual: withPatch({ roles: FROZEN_SUNSET_REGISTRY.roles.slice(0, -1) }),
    },
    {
      name: 'RED capability addition',
      code: 'SUNSET_CAPABILITY_ADDED',
      actual: withPatch({
        capabilityKeys: [...FROZEN_SUNSET_REGISTRY.capabilityKeys, 'canReadSecrets'],
      }),
    },
    {
      name: 'RED capability removal',
      code: 'SUNSET_CAPABILITY_REMOVED',
      actual: withPatch({
        capabilityKeys: FROZEN_SUNSET_REGISTRY.capabilityKeys.filter(
          (key) => key !== 'canReadPeople',
        ),
      }),
    },
    {
      name: 'RED role composition flip',
      code: 'SUNSET_CAPABILITY_COMPOSITION_CHANGED',
      actual: withPatch({
        roleCapabilities: {
          ...FROZEN_SUNSET_REGISTRY.roleCapabilities,
          visitor: {
            ...FROZEN_SUNSET_REGISTRY.roleCapabilities.visitor,
            canViewFinancials: true,
          },
        },
      }),
    },
    {
      name: 'RED module addition',
      code: 'SUNSET_MODULE_KEY_ADDED',
      actual: withPatch({ moduleKeys: [...FROZEN_SUNSET_REGISTRY.moduleKeys, 'vault'] }),
    },
    {
      name: 'RED entitlement-state removal',
      code: 'SUNSET_ENTITLEMENT_STATE_REMOVED',
      actual: withPatch({ entitlementStates: ['active'] }),
    },
    {
      name: 'RED search-kind addition',
      code: 'SUNSET_SEARCH_KIND_ADDED',
      actual: withPatch({
        searchDomains: [...FROZEN_SUNSET_REGISTRY.searchDomains, 'secret'],
      }),
    },
    {
      name: 'RED search-kind removal',
      code: 'SUNSET_SEARCH_KIND_REMOVED',
      actual: withPatch({
        contractResultKinds: FROZEN_SUNSET_REGISTRY.contractResultKinds.filter(
          (kind) => kind !== 'beneficiary',
        ),
      }),
    },
    {
      name: 'RED gate addition',
      code: 'SUNSET_GATE_ADDED',
      actual: withPatch({
        gateClasses: {
          ...FROZEN_SUNSET_REGISTRY.gateClasses,
          'domain:canReadSecrets(actor.role)': ['secret'],
        },
      }),
    },
    {
      name: 'RED gate removal',
      code: 'SUNSET_GATE_REMOVED',
      actual: withPatch({
        gateClasses: withoutKey(FROZEN_SUNSET_REGISTRY.gateClasses, 'domain:always'),
      }),
    },
    {
      name: 'RED predicate-register addition',
      code: 'SUNSET_PREDICATE_REGISTER_ADDED',
      actual: withPatch({
        predicateRegisters: {
          ...FROZEN_SUNSET_REGISTRY.predicateRegisters,
          secret: ['participant-only'],
        },
      }),
    },
    {
      name: 'RED predicate-register removal',
      code: 'SUNSET_PREDICATE_REGISTER_REMOVED',
      actual: withPatch({
        predicateRegisters: withoutKey(
          FROZEN_SUNSET_REGISTRY.predicateRegisters,
          'claim',
        ),
      }),
    },
    {
      name: 'RED owner-type addition',
      code: 'SUNSET_OWNER_TYPE_ADDED',
      actual: withPatch({
        documentOwnerTypes: [...FROZEN_SUNSET_REGISTRY.documentOwnerTypes, 'Secret'],
      }),
    },
    {
      name: 'RED record-kind removal',
      code: 'SUNSET_RECORD_KIND_REMOVED',
      actual: withPatch({ recordKinds: ['RegisteredEvidence'] }),
    },
    {
      name: 'RED match-field addition',
      code: 'SUNSET_MATCH_FIELD_ADDED',
      actual: withPatch({
        matchFields: {
          ...FROZEN_SUNSET_REGISTRY.matchFields,
          person: [...(FROZEN_SUNSET_REGISTRY.matchFields.person ?? []), 'private_note'],
        },
      }),
    },
    {
      name: 'RED match-field removal',
      code: 'SUNSET_MATCH_FIELD_REMOVED',
      actual: withPatch({
        matchFields: {
          ...FROZEN_SUNSET_REGISTRY.matchFields,
          claim: ['claim_id', 'description'],
        },
      }),
    },
    {
      name: 'RED response-field addition',
      code: 'SUNSET_RESPONSE_FIELD_ADDED',
      actual: withPatch({
        responseFields: {
          ...FROZEN_SUNSET_REGISTRY.responseFields,
          item: [...FROZEN_SUNSET_REGISTRY.responseFields.item, 'snippet'],
        },
      }),
    },
    {
      name: 'RED response-field removal',
      code: 'SUNSET_RESPONSE_FIELD_REMOVED',
      actual: withPatch({
        responseFields: {
          ...FROZEN_SUNSET_REGISTRY.responseFields,
          item: FROZEN_SUNSET_REGISTRY.responseFields.item.filter(
            (field) => field !== 'subtitle',
          ),
        },
      }),
    },
    {
      name: 'RED projection addition',
      code: 'SUNSET_PROJECTION_ADDED',
      actual: withPatch({
        projections: {
          ...FROZEN_SUNSET_REGISTRY.projections,
          secret: fakeProjection,
        },
      }),
    },
    {
      name: 'RED projection removal',
      code: 'SUNSET_PROJECTION_REMOVED',
      actual: withPatch({
        projections: withoutKey(FROZEN_SUNSET_REGISTRY.projections, 'beneficiary'),
      }),
    },
    {
      name: 'RED projection change',
      code: 'SUNSET_PROJECTION_CHANGED',
      actual: withPatch({
        projections: {
          ...FROZEN_SUNSET_REGISTRY.projections,
          claim: {
            ...(FROZEN_SUNSET_REGISTRY.projections.claim as SearchProjectionRegistryEntry),
            title: 'claim_id',
          },
        },
      }),
    },
    {
      name: 'RED critical-source addition',
      code: 'SUNSET_CRITICAL_SOURCE_ADDED',
      actual: withPatch({
        criticalSources: [
          ...FROZEN_SUNSET_REGISTRY.criticalSources,
          'packages/application/src/usecases/secretOps.ts',
        ],
      }),
    },
    {
      name: 'RED policy-root source change',
      code: 'SUNSET_CRITICAL_SOURCE_CHANGED',
      actual: withPatch({
        criticalSourceFingerprints: {
          ...FROZEN_SUNSET_REGISTRY.criticalSourceFingerprints,
          'apps/api/src#tree': 'b'.repeat(64),
        },
      }),
    },
  ];

  it.each(redMutations)('$name fails before sampling with $code', ({ actual, code }) => {
    expect(failureCodes(actual)).toContain(code);
    expect(() => assertSunsetRegistry(FROZEN_SUNSET_REGISTRY, actual)).toThrow(
      SunsetRegistryError,
    );
  });
});
