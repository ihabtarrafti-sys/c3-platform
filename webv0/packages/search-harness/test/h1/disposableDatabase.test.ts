import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  H1_DISPOSABLE_DATABASE_PROVIDER,
  H1DisposableDatabaseError,
  closeDisposableSeedConnection,
  consumeAndConnectExternalDisposableTarget,
  prepareExternalOwnedDisposableTarget,
  type H1SqlClient,
} from '../../src/h1/disposableDatabase.js';
import {
  HEARTH_SEARCH_OWNERSHIP_MARKER,
  HEARTH_SEARCH_SEED_ACK,
  assertDisposableSeedTarget,
  createSeederGuardPolicy,
  isTrustedDisposableSeedTargetAttestation,
} from '../../src/seederGuard.js';

const now = new Date('2026-07-26T12:00:00.000Z');
let runSequence = 0;

function guardedCredentials(
  measuredOverrides: Readonly<Record<string, string | undefined>> = {},
) {
  runSequence += 1;
  const runId = `h1-db-run-${runSequence}`;
  const databaseName = `c3_hearth_search_h1_${runSequence}`;
  const host = '127.0.0.1:6543';
  const seedAdminUrl =
    `postgresql://hearth_seed:seed-secret-${runSequence}` +
    `@${host}/${databaseName}`;
  const policy = createSeederGuardPolicy({
    protectedEndpoints: [
      {
        label: 'development-shared',
        url: 'postgresql://app:x@dev.invalid/c3',
        clusterIdentitySha256: '1'.repeat(64),
      },
      {
        label: 'staging',
        url: 'postgresql://app:x@stage.invalid/c3',
        clusterIdentitySha256: '2'.repeat(64),
      },
      {
        label: 'production',
        url: 'postgresql://app:x@prod.invalid/c3',
        clusterIdentitySha256: '3'.repeat(64),
      },
    ],
  });
  const seedTargetAttestation = assertDisposableSeedTarget(
    {
      targetDatabaseUrl: seedAdminUrl,
      acknowledgement: HEARTH_SEARCH_SEED_ACK,
      runId,
      databaseCreatedAt: '2026-07-26T11:59:30.000Z',
      existingSeedRecordCount: 0,
      ownershipMarker: {
        markerKind: HEARTH_SEARCH_OWNERSHIP_MARKER,
        runId,
        createdAt: '2026-07-26T11:59:45.000Z',
      },
      observedClusterIdentitySha256: runSequence
        .toString(16)
        .padStart(64, '0'),
    },
    policy,
  );
  return {
    databaseName,
    seedAdminUrl,
    seedTargetAttestation,
    measured: {
      NODE_ENV: 'production',
      RATE_LIMIT_MAX: '100000',
      DATABASE_URL:
        `postgresql://hearth_app:app-secret-${runSequence}` +
        `@${host}/${databaseName}`,
      DATABASE_AUTH_URL:
        `postgresql://hearth_auth:auth-secret-${runSequence}` +
        `@${host}/${databaseName}`,
      ...measuredOverrides,
    },
  } as const;
}

function clientForDatabase(databaseName: string): H1SqlClient & {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(async () => ({
      rows: [{ database_name: databaseName }],
      rowCount: 1,
    })),
    end: vi.fn(async () => undefined),
  };
}

describe('H1 external-owned disposable database adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays side-effect free until it consumes H0 and connects with the exact seed URL', async () => {
    const credentials = guardedCredentials();
    const client = clientForDatabase(credentials.databaseName);
    const connect = vi.fn(async () => client);

    const prepared = prepareExternalOwnedDisposableTarget({
      credentials,
      connect,
    });

    expect(prepared.provider).toBe(
      H1_DISPOSABLE_DATABASE_PROVIDER,
    );
    expect(connect).not.toHaveBeenCalled();
    expect(
      isTrustedDisposableSeedTargetAttestation(
        credentials.seedTargetAttestation,
      ),
    ).toBe(true);

    const connected =
      await consumeAndConnectExternalDisposableTarget(prepared);

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(credentials.seedAdminUrl);
    expect(
      isTrustedDisposableSeedTargetAttestation(
        credentials.seedTargetAttestation,
      ),
    ).toBe(false);
    expect(connected).toMatchObject({
      databaseName: credentials.databaseName,
      runId: credentials.seedTargetAttestation.runId,
    });
    expect(JSON.stringify(connected)).not.toContain('seed-secret');
    expect(JSON.stringify(connected)).not.toContain('postgresql://');

    await closeDisposableSeedConnection(connected);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('leaves H0 unconsumed and records no connection when credential preflight fails', async () => {
    const credentials = guardedCredentials({
      NODE_ENV: 'test',
    });
    const connect = vi.fn();
    const beforeConnect = vi.fn();
    const prepared = prepareExternalOwnedDisposableTarget({
      credentials,
      connect,
    });

    await expect(
      consumeAndConnectExternalDisposableTarget(
        prepared,
        beforeConnect,
      ),
    ).rejects.toMatchObject({
      code: 'MEASURED_NODE_ENV_NOT_PRODUCTION',
    });

    expect(beforeConnect).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(
      isTrustedDisposableSeedTargetAttestation(
        credentials.seedTargetAttestation,
      ),
    ).toBe(true);
  });

  it('closes immediately and fails when current_database differs from the attested target', async () => {
    const credentials = guardedCredentials();
    const client = clientForDatabase(
      'c3_hearth_search_wrong_database',
    );
    const prepared = prepareExternalOwnedDisposableTarget({
      credentials,
      connect: async () => client,
    });

    await expect(
      consumeAndConnectExternalDisposableTarget(prepared),
    ).rejects.toMatchObject({
      code: 'H1_DISPOSABLE_TARGET_MISMATCH',
    });
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('rejects forged and reused adapter objects', async () => {
    const credentials = guardedCredentials();
    const client = clientForDatabase(credentials.databaseName);
    const prepared = prepareExternalOwnedDisposableTarget({
      credentials,
      connect: async () => client,
    });
    await consumeAndConnectExternalDisposableTarget(prepared);

    await expect(
      consumeAndConnectExternalDisposableTarget(prepared),
    ).rejects.toBeInstanceOf(H1DisposableDatabaseError);
    expect(() =>
      prepareExternalOwnedDisposableTarget({
        credentials,
        connect: async () => client,
      }),
    ).toThrow(/H1_DISPOSABLE_TARGET_FORGED/u);
  });
});
