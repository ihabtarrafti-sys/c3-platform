import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEARTH_SEARCH_OWNERSHIP_MARKER,
  HEARTH_SEARCH_SEED_ACK,
  SeederGuardError,
  assertDisposableSeedTarget,
  createSeederGuardPolicy,
  type DisposableSeedTargetEvidence,
  type ProtectedDatabaseEndpoint,
  type SeederGuardPolicy,
  type SeederGuardPolicyInput,
  type SeederGuardFailureCode,
} from '../src/seederGuard.js';

const now = new Date('2026-07-24T12:00:00.000Z');

const protectedEndpoints: readonly ProtectedDatabaseEndpoint[] = [
  {
    label: 'development-shared',
    url: 'postgresql://app:redacted@dev-shared.invalid:5432/c3_dev',
    clusterIdentitySha256: '1'.repeat(64),
  },
  {
    label: 'staging',
    url: 'postgresql://app:redacted@staging.invalid:5432/c3_staging',
    clusterIdentitySha256: '2'.repeat(64),
  },
  {
    label: 'production',
    url: 'postgresql://app:redacted@production.invalid:5432/c3_production',
    clusterIdentitySha256: '3'.repeat(64),
  },
];

const validPolicy = (
  overrides: Partial<SeederGuardPolicyInput> = {},
) =>
  createSeederGuardPolicy({
    protectedEndpoints,
    ...overrides,
  });

const validEvidence = (): DisposableSeedTargetEvidence => ({
  targetDatabaseUrl:
    'postgresql://hearth_seed:synthetic@127.0.0.1:6543/c3_hearth_search_run_001',
  acknowledgement: HEARTH_SEARCH_SEED_ACK,
  runId: 'run-001',
  databaseCreatedAt: '2026-07-24T11:59:30.000Z',
  existingSeedRecordCount: 0,
  ownershipMarker: {
    markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
    runId: 'run-001',
    createdAt: '2026-07-24T11:59:45.000Z',
  },
  observedClusterIdentitySha256: '4'.repeat(64),
});

function expectSeederCode(
  action: () => unknown,
  code: SeederGuardFailureCode,
): void {
  try {
    action();
    throw new Error('expected seeder guard to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SeederGuardError);
    expect((error as SeederGuardError).code).toBe(code);
  }
}

describe('disposable seeder guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attests a fresh, empty, same-run-owned reserved database', () => {
    const attestation = assertDisposableSeedTarget(
      validEvidence(),
      validPolicy(),
    );
    expect(attestation).toMatchObject({
      databaseName: 'c3_hearth_search_run_001',
      runId: 'run-001',
      checkedAt: now.toISOString(),
    });
    expect(attestation.targetIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('RED: refuses pre-minting a second grant for the same run and marker', () => {
    const evidence = {
      ...validEvidence(),
      runId: 'run-pre-mint',
      ownershipMarker: {
        ...validEvidence().ownershipMarker!,
        runId: 'run-pre-mint',
      },
    };
    assertDisposableSeedTarget(evidence, validPolicy());
    expectSeederCode(
      () => assertDisposableSeedTarget(evidence, validPolicy()),
      'SEED_TARGET_GRANT_ALREADY_ISSUED',
    );
  });

  it('RED: refuses pre-minting the same cluster/database grant through a hostname alias', () => {
    const evidence = {
      ...validEvidence(),
      runId: 'run-pre-mint-alias',
      ownershipMarker: {
        ...validEvidence().ownershipMarker!,
        runId: 'run-pre-mint-alias',
      },
    };
    assertDisposableSeedTarget(evidence, validPolicy());
    expectSeederCode(
      () =>
        assertDisposableSeedTarget(
          {
            ...evidence,
            targetDatabaseUrl:
              'postgresql://hearth_seed:synthetic@localhost:6543/c3_hearth_search_run_001',
          },
          validPolicy(),
        ),
      'SEED_TARGET_GRANT_ALREADY_ISSUED',
    );
  });

  it('RED: refuses a protected endpoint even when the database name is reserved', () => {
    const evidence = validEvidence();
    expectSeederCode(
      () =>
        assertDisposableSeedTarget(
          {
            ...evidence,
            targetDatabaseUrl:
              'postgresql://seed:synthetic@staging.invalid.:5432/c3_hearth_search_trap',
          },
          validPolicy(),
        ),
      'SEED_TARGET_PROTECTED_ENDPOINT',
    );
  });

  it('RED: refuses query parameters that override the parsed endpoint', () => {
    const evidence = validEvidence();
    expectSeederCode(
      () =>
        assertDisposableSeedTarget(
          {
            ...evidence,
            targetDatabaseUrl:
              'postgresql://seed:synthetic@127.0.0.1:6543/c3_hearth_search_trap?host=staging.invalid&port=5432',
          },
          validPolicy(),
        ),
      'SEED_TARGET_URL_INVALID',
    );
  });

  it('RED: refuses startup options that can redirect unqualified seed SQL', () => {
    const evidence = validEvidence();
    expectSeederCode(
      () =>
        assertDisposableSeedTarget(
          {
            ...evidence,
            targetDatabaseUrl:
              'postgresql://seed:synthetic@127.0.0.1:6543/c3_hearth_search_trap?options=-c%20search_path%3Devil',
          },
          validPolicy(),
        ),
      'SEED_TARGET_URL_INVALID',
    );
  });

  it.each([
    [
      'invalid target URL',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        targetDatabaseUrl: 'not-a-url',
      }),
      'SEED_TARGET_URL_INVALID',
    ],
    [
      'percent-encoded Unix-socket hostname',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        targetDatabaseUrl:
          'postgresql://seed:synthetic@%2Ftmp%2FPG_A/c3_hearth_search_trap',
      }),
      'SEED_TARGET_URL_INVALID',
    ],
    [
      'missing database name',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        targetDatabaseUrl: 'postgresql://seed:synthetic@127.0.0.1:6543',
      }),
      'SEED_TARGET_DATABASE_MISSING',
    ],
    [
      'multi-slash path that disguises a non-reserved database name',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        targetDatabaseUrl:
          'postgresql://seed:synthetic@127.0.0.1:6543//c3_hearth_search_trap',
      }),
      'SEED_TARGET_DATABASE_MISSING',
    ],
    [
      'percent-escaped reserved delimiter with case-sensitive pg semantics',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        targetDatabaseUrl:
          'postgresql://seed:synthetic@127.0.0.1:6543/c3_hearth_search_trap%3Falias',
      }),
      'SEED_TARGET_DATABASE_MISSING',
    ],
    [
      'non-reserved database name',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        targetDatabaseUrl:
          'postgresql://seed:synthetic@127.0.0.1:6543/shared_development',
      }),
      'SEED_TARGET_NAME_NOT_RESERVED',
    ],
    [
      'missing destructive acknowledgement',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        acknowledgement: undefined,
      }),
      'SEED_ACK_REQUIRED',
    ],
    [
      'blank run ID',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        runId: '   ',
        ownershipMarker: {
          markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
          runId: '   ',
          createdAt: '2026-07-24T11:59:45.000Z',
        },
      }),
      'SEED_RUN_ID_INVALID',
    ],
    [
      'blank marker run ID',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        ownershipMarker: {
          markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
          runId: '   ',
          createdAt: '2026-07-24T11:59:45.000Z',
        },
      }),
      'SEED_RUN_ID_INVALID',
    ],
    [
      'stale database',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        databaseCreatedAt: '2026-07-24T11:00:00.000Z',
      }),
      'SEED_DATABASE_NOT_FRESH',
    ],
    [
      'already populated database',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        existingSeedRecordCount: 1,
      }),
      'SEED_DATABASE_ALREADY_POPULATED',
    ],
    [
      'missing marker',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        ownershipMarker: null,
      }),
      'SEED_MARKER_MISSING',
    ],
    [
      'invalid marker kind',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        ownershipMarker: {
          markerKind: 'another-tool',
          runId: evidence.runId,
          createdAt: '2026-07-24T11:59:45.000Z',
        },
      }),
      'SEED_MARKER_INVALID',
    ],
    [
      'marker from another run',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        ownershipMarker: {
          markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
          runId: 'run-previous',
          createdAt: '2026-07-24T11:59:45.000Z',
        },
      }),
      'SEED_MARKER_RUN_MISMATCH',
    ],
    [
      'stale marker',
      (evidence: DisposableSeedTargetEvidence) => ({
        ...evidence,
        ownershipMarker: {
          markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
          runId: evidence.runId,
          createdAt: '2026-07-24T11:00:00.000Z',
        },
      }),
      'SEED_MARKER_NOT_FRESH',
    ],
  ] as const)('RED: refuses %s with a distinct code', (_label, mutate, code) => {
    expectSeederCode(
      () => assertDisposableSeedTarget(mutate(validEvidence()), validPolicy()),
      code,
    );
  });

  it.each([
    [
      'widened maximum fresh age',
      { maximumFreshAgeMs: 10 * 60 * 1_000 + 1 },
    ],
    [
      'widened maximum clock skew',
      { maximumClockSkewMs: 5_001 },
    ],
  ] as const)('RED: refuses %s in trusted policy construction', (_label, override) => {
    expectSeederCode(
      () => validPolicy(override),
      'SEED_FRESHNESS_BOUND_INVALID',
    );
  });

  it.each([
    ['empty inventory', []],
    ['incomplete inventory', protectedEndpoints.slice(0, 2)],
  ] as const)('RED: refuses %s of protected endpoints', (_label, endpoints) => {
    expectSeederCode(
      () => validPolicy({ protectedEndpoints: endpoints }),
      'SEED_PROTECTED_ENDPOINTS_INVALID',
    );
  });

  it('RED: refuses duplicate protected endpoint identities', () => {
    expectSeederCode(
      () =>
        validPolicy({
          protectedEndpoints: [
            protectedEndpoints[0]!,
            {
              label: 'staging',
              url: 'postgresql://other:redacted@dev-shared.invalid.:5432/other',
              clusterIdentitySha256: '5'.repeat(64),
            },
            protectedEndpoints[2]!,
          ],
        }),
      'SEED_PROTECTED_ENDPOINTS_INVALID',
    );
  });

  it('RED: refuses a protected PostgreSQL cluster reached through a hostname alias', () => {
    const aliasProtectedEndpoints: readonly ProtectedDatabaseEndpoint[] = [
      {
        label: 'development-shared',
        url: 'postgresql://reader:x@localhost:6543/c3_dev',
        clusterIdentitySha256: '6'.repeat(64),
      },
      protectedEndpoints[1]!,
      protectedEndpoints[2]!,
    ];
    expectSeederCode(
      () =>
        assertDisposableSeedTarget(
          {
            ...validEvidence(),
            targetDatabaseUrl:
              'postgresql://seed:x@127.0.0.1:6543/c3_hearth_search_alias',
            observedClusterIdentitySha256: '6'.repeat(64),
          },
          validPolicy({ protectedEndpoints: aliasProtectedEndpoints }),
        ),
      'SEED_TARGET_PROTECTED_ENDPOINT',
    );
  });

  it('RED: refuses a spread-cloned policy with a forged clock and empty inventory', () => {
    const forgedPolicy = {
      ...validPolicy(),
      protectedEndpoints: [],
      clock: () => new Date('2020-01-01T00:00:01.000Z'),
    } as SeederGuardPolicy;
    expectSeederCode(
      () => assertDisposableSeedTarget(validEvidence(), forgedPolicy),
      'SEED_PROTECTED_ENDPOINTS_INVALID',
    );
  });

  it('RED: ignores a forged evidence clock and uses the trusted clock', () => {
    const forged = {
      ...validEvidence(),
      databaseCreatedAt: '2020-01-01T00:00:00.000Z',
      ownershipMarker: {
        markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
        runId: 'run-001',
        createdAt: '2020-01-01T00:00:00.000Z',
      },
      now: new Date('2020-01-01T00:00:01.000Z'),
    };
    expectSeederCode(
      () => assertDisposableSeedTarget(forged, validPolicy()),
      'SEED_DATABASE_NOT_FRESH',
    );
  });
});
