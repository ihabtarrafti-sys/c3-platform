import { describe, expect, it } from 'vitest';

import {
  H1SeedRunConfigError,
  parseH1SeedRunConfig,
  parseH1SeedRunConfigPath,
} from '../../src/cli/h1SeedConfig.js';
import { safeHarnessCommandError } from '../../src/cli/common.js';
import { HEARTH_SEARCH_SEED_ACK } from '../../src/seederGuard.js';

function validConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    artifactKind: 'hearth-search-h1-external-seed-run',
    corpusProfileId: 'H3M.D0',
    seedAdminUrl:
      'postgresql://seed:seed-secret@127.0.0.1:6543/c3_hearth_search_run',
    acknowledgement: HEARTH_SEARCH_SEED_ACK,
    runId: 'h1-run-1',
    protectedInventory: {
      schemaVersion: 1,
      endpoints: [
        {
          label: 'development-shared',
          url: 'postgresql://dev.invalid/shared',
          clusterIdentitySha256: '1'.repeat(64),
        },
        {
          label: 'staging',
          url: 'postgresql://staging.invalid/shared',
          clusterIdentitySha256: '2'.repeat(64),
        },
        {
          label: 'production',
          url: 'postgresql://production.invalid/shared',
          clusterIdentitySha256: '3'.repeat(64),
        },
      ],
    },
    statementTimeoutMs: 30_000,
  };
}

describe('H1 external seed run config', () => {
  it('accepts one closed profile and keeps the seed URL in file content, not argv', () => {
    const parsed = parseH1SeedRunConfig(validConfig());
    expect(parsed).toMatchObject({
      corpusProfileId: 'H3M.D0',
      runId: 'h1-run-1',
      statementTimeoutMs: 30_000,
    });
    expect(
      parseH1SeedRunConfigPath([
        '--run-config',
        'C:\\owned\\h1-run.json',
      ]),
    ).toBe('C:\\owned\\h1-run.json');
  });

  it('RED: rejects unknown fields and unsupported profile merges', () => {
    expect(() =>
      parseH1SeedRunConfig({
        ...validConfig(),
        silentTypo: true,
      }),
    ).toThrow(H1SeedRunConfigError);
    expect(() =>
      parseH1SeedRunConfig({
        ...validConfig(),
        corpusProfileId: 'H3M.ALL',
      }),
    ).toThrow(H1SeedRunConfigError);
  });

  it('RED: rejects argv credentials and suppresses config sentinels', () => {
    const sentinel = 'seed-secret-SENTINEL-7f9c';
    expect(() =>
      parseH1SeedRunConfigPath([
        '--seed-database-url',
        `postgresql://seed:${sentinel}@db.invalid/c3`,
      ]),
    ).toThrow(H1SeedRunConfigError);

    let error: unknown;
    try {
      parseH1SeedRunConfig({
        ...validConfig(),
        seedAdminUrl: sentinel,
        statementTimeoutMs: 0,
      });
    } catch (caught) {
      error = caught;
    }
    const safe = safeHarnessCommandError(error);
    expect(JSON.stringify(safe)).not.toContain(sentinel);
    expect(safe.code).toBe('H1_SEED_RUN_CONFIG_INVALID');
  });
});
