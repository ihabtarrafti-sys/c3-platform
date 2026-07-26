import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  H1SeedPlanError,
  validateAcceptanceSeedProfiles,
  validateDelegationSeedProfiles,
  validatePhysicalSeedPlan,
} from '../../src/h1/seedPlan.js';

async function readAuthorityJson(fileName: string): Promise<Record<string, any>> {
  const bytes = await readFile(
    new URL(`../../authority/r6/${fileName}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(bytes) as Record<string, any>;
}

describe('H1 authority seed planning', () => {
  let fixture: Record<string, any>;
  let delegation: Record<string, any>;
  let actorClasses: Record<string, any>;

  beforeAll(async () => {
    [fixture, delegation, actorClasses] = await Promise.all([
      readAuthorityJson('HEARTH-003-FIXTURE-CONTRACT-v5.json'),
      readAuthorityJson('HEARTH-003-DELEGATION-MEASUREMENT-v2.json'),
      readAuthorityJson('HEARTH-003-ACTOR-CLASSES-v2.json'),
    ]);
  });

  it('validates all 692 exact authority rows by phase and table', () => {
    const result = validatePhysicalSeedPlan(fixture['physicalSeedPlan']);

    expect(result).toMatchObject({
      measurementStatus: 'NOT_YET_MEASURED',
      planVersion: 'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
      rowCount: 692,
      searchableBindingRowCount: 634,
    });
    expect(result.phaseTableCounts).toMatchObject({
      '0:tenant': 2,
      '10:person': 170,
      '20:mission': 78,
      '30:agreement': 41,
      '40:mission_line': 51,
      '80:document': 31,
      '90:comms_evidence_delivery': 5,
    });
    expect(result.rowsCanonicalSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('RED: rejects a phase relocation before a seeder can consume it', () => {
    const rows = fixture['physicalSeedPlan']['rows'] as Array<
      Record<string, any>
    >;
    const priorPhase = rows[0]?.['phase'];
    rows[0]!['phase'] = 10;
    try {
      expect(() =>
        validatePhysicalSeedPlan(fixture['physicalSeedPlan']),
      ).toThrow(H1SeedPlanError);
    } finally {
      rows[0]!['phase'] = priorPhase;
    }
  });

  it('keeps D0-D4 as five mutually exclusive corpus profiles', () => {
    const result = validateDelegationSeedProfiles(delegation);

    expect(result.measurementStatus).toBe('NOT_YET_MEASURED');
    expect(result.mutuallyExclusive).toBe(true);
    expect(
      result.profiles.map((profile) => ({
        id: profile.corpusProfileId,
        state: profile.delegationState,
        base: profile.baseAuthorityRowCount,
        delta: profile.delegationRowCount,
        total: profile.expectedAuthorityRowCount,
      })),
    ).toEqual([
      { id: 'H3M.D0', state: 'D0', base: 692, delta: 0, total: 692 },
      { id: 'H3M.D1', state: 'D1', base: 692, delta: 14, total: 706 },
      { id: 'H3M.D2', state: 'D2', base: 692, delta: 14, total: 706 },
      { id: 'H3M.D3', state: 'D3', base: 692, delta: 14, total: 706 },
      { id: 'H3M.D4', state: 'D4', base: 692, delta: 14, total: 706 },
    ]);
    expect(result.profileManifestSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('RED: rejects a delegation row reused across profile databases', () => {
    const profiles = delegation['corpusProfiles'] as Array<Record<string, any>>;
    const d1Rows = profiles[1]?.['rows'] as Array<Record<string, any>>;
    const d2Rows = profiles[2]?.['rows'] as Array<Record<string, any>>;
    const d2Ids = profiles[2]?.['exactDelegationRowIds'] as string[];
    const priorRow = d2Rows[0];
    const priorId = d2Ids[0];
    d2Rows[0] = d1Rows[0]!;
    d2Ids[0] = d1Rows[0]!['rowId'] as string;
    try {
      expect(() => validateDelegationSeedProfiles(delegation)).toThrow(
        /more than one profile/u,
      );
    } finally {
      d2Rows[0] = priorRow!;
      d2Ids[0] = priorId!;
    }
  });

  it('binds the full ten-profile schedule to exact authority overlays', () => {
    const result = validateAcceptanceSeedProfiles(
      fixture,
      actorClasses,
      delegation,
    );

    expect(result.measurementStatus).toBe('NOT_YET_MEASURED');
    expect(result.isolatedExecutionRequired).toBe(true);
    expect(result.profileExecutionIds).toEqual([
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
    ]);
    expect(
      result.profiles.map((profile) => ({
        id: profile.corpusProfileId,
        delta: profile.deltaRowCount,
        total: profile.expectedAuthorityRowCount,
        binding: profile.authorityBinding,
      })),
    ).toEqual([
      {
        id: 'H3M.D0',
        delta: 0,
        total: 692,
        binding: 'authority-baseline-absence',
      },
      {
        id: 'H3M.D1',
        delta: 14,
        total: 706,
        binding: 'delegation-measurement-v2',
      },
      {
        id: 'H3M.D2',
        delta: 14,
        total: 706,
        binding: 'delegation-measurement-v2',
      },
      {
        id: 'H3M.D3',
        delta: 14,
        total: 706,
        binding: 'delegation-measurement-v2',
      },
      {
        id: 'H3M.D4',
        delta: 14,
        total: 706,
        binding: 'delegation-measurement-v2',
      },
      {
        id: 'H3M.E1',
        delta: 2,
        total: 694,
        binding: 'fixture-v5-entitlement-overlays',
      },
      {
        id: 'H3M.E2',
        delta: 2,
        total: 694,
        binding: 'fixture-v5-entitlement-overlays',
      },
      {
        id: 'H3M.E3',
        delta: 2,
        total: 694,
        binding: 'fixture-v5-entitlement-overlays',
      },
      {
        id: 'H3M.E4',
        delta: 2,
        total: 694,
        binding: 'fixture-v5-entitlement-overlays',
      },
      {
        id: 'H3M.P1',
        delta: 16,
        total: 708,
        binding: 'fixture-v5-participant-template-expansion',
      },
    ]);
    const eProfiles = result.profiles.filter((profile) =>
      /^H3M\.E[1-4]$/u.test(profile.corpusProfileId),
    );
    expect(
      eProfiles
        .flatMap((profile) => profile.rows)
        .every(
          (row) =>
            row.phase === 55 &&
            row.table === 'tenant_module_entitlement',
        ),
    ).toBe(true);
    const p1 = result.profiles.find(
      (profile) => profile.corpusProfileId === 'H3M.P1',
    );
    expect(
      p1?.rows.filter(
        (row) => row.table === 'comms_thread_participant',
      ),
    ).toHaveLength(14);
    expect(result.acceptanceProfileManifestSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('RED: rejects a missing Fixture-v5 physical overlay', () => {
    const scenarios = fixture['physicalSeedPlan'][
      'overlayScenarios'
    ] as Array<Record<string, any>>;
    const index = scenarios.findIndex(
      (scenario) =>
        scenario['scenarioId'] ===
        'H3A.T01:actor_entitlement:comms.E2',
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const [removed] = scenarios.splice(index, 1);
    try {
      expect(() =>
        validateAcceptanceSeedProfiles(
          fixture,
          actorClasses,
          delegation,
        ),
      ).toThrow(H1SeedPlanError);
    } finally {
      scenarios.splice(index, 0, removed!);
    }
  });

  it('RED: rejects a participant row misbound to the wrong actor', () => {
    const suite = delegation['h4AcceptanceProfileSuite'] as Record<string, any>;
    const participantProfiles = suite['participantProfiles'] as Array<
      Record<string, any>
    >;
    const p1 = participantProfiles.find(
      (profile) => profile['corpusProfileId'] === 'H3M.P1',
    );
    const rows = p1?.['rows'] as Array<Record<string, any>>;
    const row = rows.find((candidate) =>
      String(candidate['rowId']).endsWith('.P1.operations.row'),
    );
    expect(row).toBeDefined();
    const values = row!['values'] as Record<string, any>;
    const priorUserId = values['user_id'];
    values['user_id'] = '00000000-0000-4000-9000-999999999999';
    try {
      expect(() =>
        validateAcceptanceSeedProfiles(
          fixture,
          actorClasses,
          delegation,
        ),
      ).toThrow(/misbound/u);
    } finally {
      values['user_id'] = priorUserId;
    }
  });
});
