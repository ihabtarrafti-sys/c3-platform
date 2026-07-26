import { beforeAll, describe, expect, it } from 'vitest';

import {
  H1SourcePlanError,
  assertTrustedH1SourcePlan,
  attestH1ProfileExecution,
  buildH1ProfileDatabasePlan,
  prepareH1SourcePlan,
  resolveH1VerifiedH0GuardTableSet,
  resolveH1VerifiedPrimaryKeysByTable,
  resolveH1VerifiedSeedTableSet,
  type H1ProfileDatabasePlan,
  type H1SourcePlan,
  type H1VerifiedProfileExecutionAttestation,
} from '../../src/h1/sourcePlan.js';
import type { H1AcceptanceCorpusProfileId } from '../../src/h1/seedPlan.js';

const PROFILE_IDS = [
  'H3M.D0',
  'H3M.D1',
  'H3M.D2',
  'H3M.D3',
  'H3M.D4',
  'H3M.E1',
  'H3M.E2',
  'H3M.E3',
  'H3M.E4',
  'H3M.P1',
] as const satisfies readonly H1AcceptanceCorpusProfileId[];

describe('H1 verified source plan', () => {
  let source: H1SourcePlan;

  beforeAll(() => {
    source = prepareH1SourcePlan();
  }, 120_000);

  it('binds one externally rooted r6 view to the deterministic corpus and drift-only partition', () => {
    expect(() => assertTrustedH1SourcePlan(source)).not.toThrow();
    expect(source).toMatchObject({
      measurementStatus: 'NOT_YET_MEASURED',
      manifestInputs: {
        authorityModel:
          'PINNED_BASELINE_DRIFT_DETECTOR_NOT_DISCLOSURE_ORACLE',
        baselineMeaning: 'dae27a4-drift-baseline-only',
        intendedSearchableCount: 100_000,
        boundedSourceCount: 100_037,
        hardCanarySourceCount: 37,
        authorityPhysicalRowCount: 692,
        deterministicBulkRowCount: 99_403,
        acceptanceProfileCount: 10,
        h0GuardTableCount: 29,
        physicalDomainManifestSha256:
          source.physicalManifestIdentity.manifestCanonicalSha256,
        physicalPrimaryKeysSha256:
          source.physicalManifestIdentity.primaryKeysByTableSha256,
        doesNotProve:
          'that dae27a4 is authorized, correct, complete, or leak-free',
      },
    });
    expect(source.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(source.migrationPins).toHaveLength(95);
    expect(source.boundedClassification.manifestInputs).toMatchObject({
      sourceCount: 100_037,
      actorProfileCount: 140,
      intersectionCount: 0,
      unclassifiedCount: 0,
      hardCanarySourceCount: 37,
    });
  });

  it('builds all ten isolated database plans over one shared dataset without profile merging', () => {
    const plans = PROFILE_IDS.map((id) =>
      buildH1ProfileDatabasePlan(source, id),
    );
    expect(
      new Set(
        plans.map(({ sharedDatasetSha256 }) => sharedDatasetSha256),
      ).size,
    ).toBe(1);
    expect(plans.map(({ profileRows }) => profileRows.length)).toEqual([
      0, 14, 14, 14, 14, 2, 2, 2, 2, 16,
    ]);
    expect(plans.map(({ totalPhysicalRowCount }) => totalPhysicalRowCount))
      .toEqual([
        100_095,
        100_109,
        100_109,
        100_109,
        100_109,
        100_097,
        100_097,
        100_097,
        100_097,
        100_111,
      ]);
    expect(
      plans.every(
        (plan) =>
          plan.expectedCounts.reduce(
            (sum, entry) => sum + entry.rowCount,
            0,
          ) === plan.totalPhysicalRowCount,
      ),
    ).toBe(true);

    const attestations = plans.map(attestH1ProfileExecution);
    const h0GuardSets = attestations.map(
      resolveH1VerifiedH0GuardTableSet,
    );
    expect(
      new Set(h0GuardSets.map((tables) => JSON.stringify(tables))).size,
    ).toBe(1);
    expect(h0GuardSets[0]).toHaveLength(29);
    expect(h0GuardSets[0]).toEqual(
      expect.arrayContaining([
        'delegation',
        'tenant_module_entitlement',
        'comms_thread_participant',
      ]),
    );

    const d0ExactTables = resolveH1VerifiedSeedTableSet(
      attestations[0] as H1VerifiedProfileExecutionAttestation,
    );
    const d0PrimaryKeys = resolveH1VerifiedPrimaryKeysByTable(
      attestations[0] as H1VerifiedProfileExecutionAttestation,
    );
    expect(Object.keys(d0PrimaryKeys).sort()).toEqual(
      [...d0ExactTables].sort(),
    );
    expect(
      Object.values(d0PrimaryKeys).every(
        (columns) => columns.length > 0,
      ),
    ).toBe(true);
    expect(d0ExactTables).not.toContain('delegation');
    expect(d0ExactTables).not.toContain(
      'tenant_module_entitlement',
    );
    expect(d0ExactTables).not.toContain(
      'comms_thread_participant',
    );
  });

  it('never exposes an approval-oracle claim in its manifest surface', () => {
    const serialized = JSON.stringify(source.manifestInputs).toLowerCase();
    expect(serialized).not.toContain('disclosure oracle');
    expect(serialized).not.toContain('approvedsearch');
    expect(serialized).toContain('doesnotprove');
  });

  it('RED: refuses an undeclared execution instead of choosing a nearby profile', () => {
    expect(() =>
      buildH1ProfileDatabasePlan(
        source,
        'H3M.E0' as H1AcceptanceCorpusProfileId,
      ),
    ).toThrow(H1SourcePlanError);
  });

  it('RED: refuses forged profile plans and structural attestation lookalikes', () => {
    expect(() =>
      assertTrustedH1SourcePlan({ ...source } as H1SourcePlan),
    ).toThrow(H1SourcePlanError);
    expect(() =>
      buildH1ProfileDatabasePlan(
        { ...source } as H1SourcePlan,
        'H3M.D0',
      ),
    ).toThrow(H1SourcePlanError);

    const plan = buildH1ProfileDatabasePlan(source, 'H3M.D0');
    const narrowedPlan = {
      ...plan,
      plannedTables: plan.plannedTables.slice(1),
    } as H1ProfileDatabasePlan;
    expect(() => attestH1ProfileExecution(narrowedPlan)).toThrow(
      H1SourcePlanError,
    );

    const attestation = attestH1ProfileExecution(plan);
    const forgedAttestation = {
      ...attestation,
      h0GuardTableCount: attestation.h0GuardTableCount - 1,
    } as H1VerifiedProfileExecutionAttestation;
    expect(() =>
      resolveH1VerifiedH0GuardTableSet(forgedAttestation),
    ).toThrow(H1SourcePlanError);
    expect(() =>
      resolveH1VerifiedPrimaryKeysByTable(forgedAttestation),
    ).toThrow(H1SourcePlanError);
  });
});
