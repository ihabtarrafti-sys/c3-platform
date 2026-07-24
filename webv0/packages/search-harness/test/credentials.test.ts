import { describe, expect, it, vi } from 'vitest';

import {
  CredentialSeparationError,
  assertMeasuredProcessEnvironment,
  assertSeedMeasuredCredentialSeparation,
  type CredentialSeparationFailureCode,
  type MeasuredProcessEnvironment,
} from '../src/credentials.js';
import {
  HEARTH_SEARCH_OWNERSHIP_MARKER,
  HEARTH_SEARCH_SEED_ACK,
  assertDisposableSeedTarget,
  createSeederGuardPolicy,
  type DisposableSeedTargetAttestation,
} from '../src/seederGuard.js';

const measured = (): MeasuredProcessEnvironment => ({
  NODE_ENV: 'production',
  RATE_LIMIT_MAX: '100000',
  DATABASE_URL:
    'postgresql://c3_search_app:app-secret@127.0.0.1:6543/c3_hearth_search_run',
  DATABASE_AUTH_URL:
    'postgresql://c3_auth_reader:auth-secret@127.0.0.1:6543/c3_hearth_search_run',
});

let seedGrantOrdinal = 0;

const seedTargetAttestation = (
  createdAt = new Date().toISOString(),
): DisposableSeedTargetAttestation => {
  seedGrantOrdinal += 1;
  const runId = `run-${seedGrantOrdinal}`;
  return assertDisposableSeedTarget(
    {
      targetDatabaseUrl:
        'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
      acknowledgement: HEARTH_SEARCH_SEED_ACK,
      runId,
      databaseCreatedAt: createdAt,
      existingSeedRecordCount: 0,
      ownershipMarker: {
        markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
        runId,
        createdAt,
      },
      observedClusterIdentitySha256: '4'.repeat(64),
    },
    createSeederGuardPolicy({
      protectedEndpoints: [
        {
          label: 'development-shared',
          url: 'postgresql://reader:x@dev-shared.invalid:5432/c3_dev',
          clusterIdentitySha256: '1'.repeat(64),
        },
        {
          label: 'staging',
          url: 'postgresql://reader:x@staging.invalid:5432/c3_staging',
          clusterIdentitySha256: '2'.repeat(64),
        },
        {
          label: 'production',
          url: 'postgresql://reader:x@production.invalid:5432/c3_production',
          clusterIdentitySha256: '3'.repeat(64),
        },
      ],
    }),
  );
}

function expectCredentialCode(
  action: () => unknown,
  code: CredentialSeparationFailureCode,
): void {
  try {
    action();
    throw new Error('expected credential guard to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialSeparationError);
    expect((error as CredentialSeparationError).code).toBe(code);
  }
}

describe('seed and measured-process credential separation', () => {
  it('attests production mode, a high non-zero limiter, and separate read roles', () => {
    const attestation = assertMeasuredProcessEnvironment(measured());
    expect(attestation).toMatchObject({
      nodeEnv: 'production',
      rateLimitMax: 100_000,
      applicationRole: 'c3_search_app',
      authenticationRole: 'c3_auth_reader',
    });
    expect(attestation.applicationCredentialSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(attestation.authenticationCredentialSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(attestation.databaseTargetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['non-production mode', { NODE_ENV: 'test' }, 'MEASURED_NODE_ENV_NOT_PRODUCTION'],
    ['missing limiter', { RATE_LIMIT_MAX: undefined }, 'MEASURED_RATE_LIMIT_MISSING'],
    ['invalid limiter', { RATE_LIMIT_MAX: '1.5' }, 'MEASURED_RATE_LIMIT_INVALID'],
    ['zero limiter', { RATE_LIMIT_MAX: '0' }, 'MEASURED_RATE_LIMIT_DISABLED'],
    ['low limiter', { RATE_LIMIT_MAX: '99999' }, 'MEASURED_RATE_LIMIT_TOO_LOW'],
    [
      'admin URL',
      { DATABASE_ADMIN_URL: 'postgresql://admin:x@db.invalid/c3' },
      'MEASURED_ADMIN_CREDENTIAL_PRESENT',
    ],
    [
      'present-but-blank admin URL',
      { DATABASE_ADMIN_URL: '   ' },
      'MEASURED_ADMIN_CREDENTIAL_PRESENT',
    ],
    [
      'seed URL',
      { HEARTH_SEED_DATABASE_URL: 'postgresql://seed:x@db.invalid/c3' },
      'MEASURED_SEED_CREDENTIAL_PRESENT',
    ],
    [
      'present-but-blank seed URL',
      { HEARTH_SEED_DATABASE_URL: '' },
      'MEASURED_SEED_CREDENTIAL_PRESENT',
    ],
    [
      'repo-defined backup-role password',
      { C3_BACKUP_PASSWORD: 'backup-secret' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'standard PostgreSQL administrator password',
      { POSTGRES_PASSWORD: 'postgres-admin-secret' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'standard PostgreSQL administrator user',
      { POSTGRES_USER: 'postgres' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'long-form PostgreSQL administrator password',
      { POSTGRESQL_PASSWORD: 'postgres-admin-secret' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'split backup-role password',
      { BACKUP_PASSWORD: 'backup-secret' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'split backup-role host',
      { BACKUP_HOST: '127.0.0.1' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'split backup-role user',
      { BACKUP_USER: 'c3_backup' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'privileged export URL',
      {
        DATABASE_EXPORT_URL:
          'postgresql://c3_backup:x@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'privileged backup URL',
      {
        DATABASE_BACKUP_URL:
          'postgresql://c3_backup:x@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'backup database password',
      { BACKUP_DB_PASSWORD: 'privileged-secret' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'arbitrarily named PostgreSQL credential',
      {
        OWNER_CONNECTION:
          'postgresql://c3_admin:x@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    [
      'blank extra database credential key',
      { database_export_url: '' },
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
    ],
    ['missing app URL', { DATABASE_URL: undefined }, 'MEASURED_DATABASE_URL_MISSING'],
    ['missing auth URL', { DATABASE_AUTH_URL: undefined }, 'MEASURED_AUTH_URL_MISSING'],
    ['invalid app URL', { DATABASE_URL: 'bad' }, 'MEASURED_DATABASE_URL_INVALID'],
    ['invalid auth URL', { DATABASE_AUTH_URL: 'bad' }, 'MEASURED_AUTH_URL_INVALID'],
    [
      'app URL with a percent-encoded Unix-socket hostname',
      {
        DATABASE_URL:
          'postgresql://c3_search_app:x@%2Ftmp%2FPG_A/c3_hearth_search_run',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'auth URL with a differently cased Unix-socket hostname',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:x@%2ftmp%2fpg_a/c3_hearth_search_run',
      },
      'MEASURED_AUTH_URL_INVALID',
    ],
    [
      'app URL without an explicit password',
      {
        DATABASE_URL:
          'postgresql://c3_search_app@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'auth URL without an explicit password',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_AUTH_URL_INVALID',
    ],
    [
      'app URL with a multi-slash database path',
      {
        DATABASE_URL:
          'postgresql://c3_search_app:x@127.0.0.1:6543//c3_hearth_search_run',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'auth URL with a multi-slash database path',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:x@127.0.0.1:6543///c3_hearth_search_run',
      },
      'MEASURED_AUTH_URL_INVALID',
    ],
    [
      'app URL with a percent-escaped database path',
      {
        DATABASE_URL:
          'postgresql://c3_search_app:x@127.0.0.1:6543/c3_hearth_search_run%3Falias',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'auth URL with a differently cased percent escape',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:x@127.0.0.1:6543/c3_hearth_search_run%3falias',
      },
      'MEASURED_AUTH_URL_INVALID',
    ],
    [
      'app URL role override',
      {
        DATABASE_URL:
          'postgresql://c3_search_app:x@127.0.0.1:6543/c3_hearth_search_run?user=c3_hearth_seed',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'auth URL role override',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:x@127.0.0.1:6543/c3_hearth_search_run?user=c3_search_app',
      },
      'MEASURED_AUTH_URL_INVALID',
    ],
    [
      'app URL startup-options override',
      {
        DATABASE_URL:
          'postgresql://c3_search_app:x@127.0.0.1:6543/c3_hearth_search_run?options=-c%20search_path%3Devil',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'auth URL hostaddr override',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:x@127.0.0.1:6543/c3_hearth_search_run?hostaddr=203.0.113.10',
      },
      'MEASURED_AUTH_URL_INVALID',
    ],
    [
      'app URL TLS-mode connection semantics',
      {
        DATABASE_URL:
          'postgresql://c3_search_app:x@127.0.0.1:6543/c3_hearth_search_run?sslmode=disable',
      },
      'MEASURED_DATABASE_URL_INVALID',
    ],
    [
      'reused app/auth role',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_search_app:different@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_DATABASE_AUTH_CREDENTIAL_REUSED',
    ],
    [
      'reused app/auth secret',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:app-secret@127.0.0.1:6543/c3_hearth_search_run',
      },
      'MEASURED_DATABASE_AUTH_SECRET_REUSED',
    ],
    [
      'different app/auth database targets',
      {
        DATABASE_AUTH_URL:
          'postgresql://c3_auth_reader:auth-secret@127.0.0.1:6543/another_database',
      },
      'MEASURED_DATABASE_TARGET_MISMATCH',
    ],
    [
      'libpq password fallback',
      { PGPASSWORD: 'inherited-secret' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
    [
      'libpq service fallback',
      { PGSERVICE: 'production' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
    [
      'libpq session options override',
      { PGOPTIONS: '-c role=c3_backup -c row_security=off' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
    [
      'libpq TLS mode override',
      { PGSSLMODE: 'disable' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
    [
      'libpq TLS negotiation override',
      { PGSSLNEGOTIATION: 'direct' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
    [
      'arbitrary present PG-prefixed variable',
      { PGAPPNAME: '' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
    [
      'case-insensitive PG-prefixed variable',
      { pgoptions: '-c row_security=off' },
      'MEASURED_PG_FALLBACK_PRESENT',
    ],
  ] as const)('RED: refuses %s', (_label, mutation, code) => {
    expectCredentialCode(
      () => assertMeasuredProcessEnvironment({ ...measured(), ...mutation }),
      code,
    );
  });

  it('RED: treats PostgreSQL SCRAM-equivalent app/auth secrets as reused', () => {
    expectCredentialCode(
      () =>
        assertMeasuredProcessEnvironment({
          ...measured(),
          DATABASE_URL:
            'postgresql://c3_search_app:%C3%A9@127.0.0.1:6543/c3_hearth_search_run',
          DATABASE_AUTH_URL:
            'postgresql://c3_auth_reader:e%CC%81@127.0.0.1:6543/c3_hearth_search_run',
        }),
      'MEASURED_DATABASE_AUTH_SECRET_REUSED',
    );
  });

  it.each([
    ['missing seed URL', undefined, 'SEED_ADMIN_URL_MISSING'],
    ['invalid seed URL', 'bad', 'SEED_ADMIN_URL_INVALID'],
    [
      'seed URL with a percent-encoded Unix-socket hostname',
      'postgresql://c3_hearth_seed:x@%2Ftmp%2FPG_A/c3_hearth_search_run',
      'SEED_ADMIN_URL_INVALID',
    ],
    [
      'seed URL without an explicit password',
      'postgresql://c3_hearth_seed@127.0.0.1:6543/c3_hearth_search_run',
      'SEED_ADMIN_URL_INVALID',
    ],
    [
      'seed URL with a multi-slash database path',
      'postgresql://c3_hearth_seed:x@127.0.0.1:6543//c3_hearth_search_run',
      'SEED_ADMIN_URL_INVALID',
    ],
    [
      'seed URL with a percent-escaped database path',
      'postgresql://c3_hearth_seed:x@127.0.0.1:6543/c3_hearth_search_run%3Falias',
      'SEED_ADMIN_URL_INVALID',
    ],
    [
      'seed URL role override',
      'postgresql://c3_hearth_seed:x@127.0.0.1:6543/c3_hearth_search_run?user=c3_search_app',
      'SEED_ADMIN_URL_INVALID',
    ],
    [
      'seed/app role reuse',
      'postgresql://c3_search_app:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
      'SEED_CREDENTIAL_REUSED_BY_MEASURED_DATABASE',
    ],
    [
      'seed/auth role reuse',
      'postgresql://c3_auth_reader:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
      'SEED_CREDENTIAL_REUSED_BY_MEASURED_AUTH',
    ],
    [
      'seed/app secret reuse',
      'postgresql://c3_hearth_seed:app-secret@127.0.0.1:6543/c3_hearth_search_run',
      'SEED_SECRET_REUSED_BY_MEASURED_DATABASE',
    ],
    [
      'seed/auth secret reuse',
      'postgresql://c3_hearth_seed:auth-secret@127.0.0.1:6543/c3_hearth_search_run',
      'SEED_SECRET_REUSED_BY_MEASURED_AUTH',
    ],
    [
      'seed target mismatch',
      'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_other',
      'SEED_TARGET_MISMATCH',
    ],
  ] as const)('RED: refuses %s', (_label, seedAdminUrl, code) => {
    expectCredentialCode(
      () =>
        assertSeedMeasuredCredentialSeparation({
          seedAdminUrl,
          seedTargetAttestation: seedTargetAttestation(),
          measured: measured(),
        }),
      code,
    );
  });

  it('RED: treats PostgreSQL SCRAM-equivalent seed/app secrets as reused', () => {
    expectCredentialCode(
      () =>
        assertSeedMeasuredCredentialSeparation({
          seedAdminUrl:
            'postgresql://c3_hearth_seed:%C3%A9@127.0.0.1:6543/c3_hearth_search_run',
          seedTargetAttestation: seedTargetAttestation(),
          measured: {
            ...measured(),
            DATABASE_URL:
              'postgresql://c3_search_app:e%CC%81@127.0.0.1:6543/c3_hearth_search_run',
          },
        }),
      'SEED_SECRET_REUSED_BY_MEASURED_DATABASE',
    );
  });

  it('accepts a seed role that never enters the measured environment', () => {
    expect(
      assertSeedMeasuredCredentialSeparation({
        seedAdminUrl:
          'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
        seedTargetAttestation: seedTargetAttestation(),
        measured: measured(),
      }),
    ).toMatchObject({ applicationRole: 'c3_search_app' });
  });

  it('RED: refuses a forged structural clone of a real seeder attestation', () => {
    expectCredentialCode(
      () =>
        assertSeedMeasuredCredentialSeparation({
          seedAdminUrl:
            'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
          seedTargetAttestation: {
            ...seedTargetAttestation(),
            targetIdentitySha256: 'b'.repeat(64),
            clusterIdentitySha256: 'b'.repeat(64),
          },
          measured: measured(),
        }),
      'SEED_TARGET_ATTESTATION_INVALID',
    );
  });

  it('RED: refuses a forged production-target attestation that bypassed the seeder guard', () => {
    expectCredentialCode(
      () =>
        assertSeedMeasuredCredentialSeparation({
          seedAdminUrl:
            'postgresql://c3_hearth_seed:seed-secret@production.invalid:5432/c3_hearth_search_prod',
          seedTargetAttestation: {
            databaseName: 'c3_hearth_search_prod',
            targetIdentitySha256: 'b'.repeat(64),
            clusterIdentitySha256: 'b'.repeat(64),
            runId: 'forged',
            checkedAt: new Date().toISOString(),
          },
          measured: {
            ...measured(),
            DATABASE_URL:
              'postgresql://c3_search_app:app-secret@production.invalid:5432/c3_hearth_search_prod',
            DATABASE_AUTH_URL:
              'postgresql://c3_auth_reader:auth-secret@production.invalid:5432/c3_hearth_search_prod',
          },
        }),
      'SEED_TARGET_ATTESTATION_INVALID',
    );
  });

  it('RED: a disposable-target attestation is single-use', () => {
    const attestation = seedTargetAttestation();
    const input = {
      seedAdminUrl:
        'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
      seedTargetAttestation: attestation,
      measured: measured(),
    } as const;
    expect(assertSeedMeasuredCredentialSeparation(input)).toMatchObject({
      applicationRole: 'c3_search_app',
    });
    expectCredentialCode(
      () => assertSeedMeasuredCredentialSeparation(input),
      'SEED_TARGET_ATTESTATION_INVALID',
    );
  });

  it('RED: a disposable-target attestation expires with the freshness window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
      const attestation = seedTargetAttestation(
        '2026-07-24T11:50:01.000Z',
      );
      vi.advanceTimersByTime(1_001);
      expectCredentialCode(
        () =>
          assertSeedMeasuredCredentialSeparation({
            seedAdminUrl:
              'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
            seedTargetAttestation: attestation,
            measured: measured(),
          }),
        'SEED_TARGET_ATTESTATION_INVALID',
      );
      vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
      expectCredentialCode(
        () =>
          assertSeedMeasuredCredentialSeparation({
            seedAdminUrl:
              'postgresql://c3_hearth_seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
            seedTargetAttestation: attestation,
            measured: measured(),
          }),
        'SEED_TARGET_ATTESTATION_INVALID',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
