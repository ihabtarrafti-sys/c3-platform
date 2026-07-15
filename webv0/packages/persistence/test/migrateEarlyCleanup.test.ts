import { beforeEach, describe, expect, it, vi } from 'vitest';

const driver = vi.hoisted(() => ({
  failAt: '' as '' | 'set' | 'lock',
  failure: new Error('unset'),
  connectCalls: 0,
  endCalls: 0,
}));

vi.mock('pg', () => ({
  Client: class MockClient {
    async connect(): Promise<void> {
      driver.connectCalls += 1;
    }

    async query(sql: string): Promise<{ rows: unknown[] }> {
      if (driver.failAt === 'set' && sql.startsWith('SET client_encoding')) throw driver.failure;
      if (driver.failAt === 'lock' && sql.includes('pg_advisory_lock')) throw driver.failure;
      return { rows: [] };
    }

    async end(): Promise<void> {
      driver.endCalls += 1;
    }
  },
}));

import { runMigrations } from '../src/migrate';

const config = {
  adminConnectionString: 'postgres://admin:pw@unused/c3',
  appRole: 'c3_app',
  authRole: 'c3_auth',
  backupRole: 'c3_backup',
  allowDevSecrets: true,
} as const;

describe('HARDEN-3.7 U8 — migrator setup failures always close the session', () => {
  beforeEach(() => {
    driver.failAt = '';
    driver.failure = new Error('unset');
    driver.connectCalls = 0;
    driver.endCalls = 0;
  });

  it('preserves a client-encoding SET failure and ends the client exactly once', async () => {
    driver.failAt = 'set';
    driver.failure = new Error('encoding setup exploded');

    await expect(runMigrations(config)).rejects.toBe(driver.failure);
    expect(driver.connectCalls).toBe(1);
    // RED: when connect/SET lived before the try/finally this was zero.
    expect(driver.endCalls).toBe(1);
  });

  it('preserves an advisory-lock failure and ends the client exactly once', async () => {
    driver.failAt = 'lock';
    driver.failure = new Error('advisory lock exploded');

    await expect(runMigrations(config)).rejects.toBe(driver.failure);
    expect(driver.connectCalls).toBe(1);
    // RED: when advisory-lock acquisition lived before the try/finally this was zero.
    expect(driver.endCalls).toBe(1);
  });
});
