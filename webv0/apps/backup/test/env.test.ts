import { describe, it, expect } from 'vitest';
import { loadEnv, assertBackupOnlyDatabaseUrl } from '../src/env';

const OK = {
  DATABASE_URL: 'postgresql://c3_backup:pw@postgres.railway.internal:5432/railway',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_BUCKET: 'c3-web-v0-staging-backups',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'SECRET',
  AGE_RECIPIENT: 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p',
  SOURCE_COMMIT: 'd133f0f',
};

describe('env validation', () => {
  it('accepts a well-formed c3_backup configuration', () => {
    const env = loadEnv(OK as NodeJS.ProcessEnv);
    expect(env.mode).toBe('daily');
    expect(env.environmentLabel).toBe('staging');
  });

  it('rejects a missing required variable', () => {
    const { R2_BUCKET: _omit, ...rest } = OK;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/R2_BUCKET/);
  });

  it('refuses non-c3_backup database roles (admin/app/auth)', () => {
    for (const role of ['c3_app', 'c3_auth', 'c3_admin', 'postgres']) {
      expect(() =>
        assertBackupOnlyDatabaseUrl(`postgresql://${role}:pw@host:5432/railway`),
      ).toThrow(/expected 'c3_backup'/);
    }
  });

  it('refuses when DATABASE_ADMIN_URL or DATABASE_AUTH_URL is even present', () => {
    expect(() => loadEnv({ ...OK, DATABASE_ADMIN_URL: 'x' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_ADMIN_URL/);
    expect(() => loadEnv({ ...OK, DATABASE_AUTH_URL: 'x' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_AUTH_URL/);
  });

  it('refuses when a private age identity is present in the environment', () => {
    expect(() => loadEnv({ ...OK, AGE_IDENTITY: 'AGE-SECRET-KEY-1...' } as NodeJS.ProcessEnv)).toThrow(/private key/);
  });

  it('refuses a private identity supplied as the recipient', () => {
    expect(() => loadEnv({ ...OK, AGE_RECIPIENT: 'AGE-SECRET-KEY-1XYZ' } as NodeJS.ProcessEnv)).toThrow(/public age recipient/);
  });

  it('rejects an invalid BACKUP_MODE', () => {
    expect(() => loadEnv({ ...OK, BACKUP_MODE: 'hourly' } as NodeJS.ProcessEnv)).toThrow(/BACKUP_MODE/);
  });
});
