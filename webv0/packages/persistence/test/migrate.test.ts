/**
 * migrate.test.ts — H-01 / H-01.1: the FAIL-CLOSED strong-secret gate.
 *
 * runMigrations must refuse a missing or published-default role password BEFORE
 * it touches the database, in EVERY mode except an explicit dev/test opt-in —
 * the backup role is BYPASSRLS (it reads every tenant), so a known password
 * there exposes all data. Round 2 proved the round-1 gate only fired on exact
 * NODE_ENV==='production'; these cases prove the default is now unreachable
 * unless dev/test is explicitly selected. The pure guard fails before any
 * connection, so the admin URL is deliberately unreachable to prove ordering.
 */
import { describe, expect, it } from 'vitest';
import { runMigrations, resolveSecretMode } from '../src/migrate';

const base = {
  adminConnectionString: 'postgres://c3_admin:x@127.0.0.1:1/does-not-exist',
  appRole: 'c3_app',
  appPassword: 'a-strong-app-secret',
  authPassword: 'a-strong-auth-secret',
  backupPassword: 'a-strong-backup-secret',
  log: () => {},
};

describe('H-01.1: fail-closed strong-secret gate for runMigrations', () => {
  // The default (no allowDevSecrets) is fail-closed — this is the whole point.
  it('by DEFAULT (no dev opt-in) refuses a MISSING backup secret before the DB', async () => {
    await expect(runMigrations({ ...base, backupPassword: undefined })).rejects.toThrow(/backupPassword.*required/i);
  });
  it('by DEFAULT refuses the PUBLISHED default backup password (unreachable outside dev)', async () => {
    await expect(runMigrations({ ...base, backupPassword: 'c3_backup_dev_pw' })).rejects.toThrow(/PUBLISHED dev default/);
  });
  it('by DEFAULT refuses default app and missing auth passwords too', async () => {
    await expect(runMigrations({ ...base, appPassword: 'c3_app_dev_pw' })).rejects.toThrow(/PUBLISHED dev default/);
    await expect(runMigrations({ ...base, authPassword: undefined })).rejects.toThrow(/authPassword.*required/i);
  });

  it('ONLY an explicit dev opt-in accepts the fallbacks — and then fails on CONNECTION, not the secret', async () => {
    // allowDevSecrets:true is the explicit opt-in. The default secret is now
    // accepted and the run proceeds to the (unreachable) DB — proving the gate
    // did NOT fire.
    await expect(
      runMigrations({ ...base, allowDevSecrets: true, backupPassword: 'c3_backup_dev_pw' }),
    ).rejects.not.toThrow(/dev default|required/i);
  });
});

describe('H-01.1: resolveSecretMode is fail-closed on NODE_ENV', () => {
  const allow = (NODE_ENV?: string) => resolveSecretMode({ NODE_ENV } as NodeJS.ProcessEnv).allowDevSecrets;

  it('permits dev secrets ONLY for explicit development/test', () => {
    expect(allow('development')).toBe(true);
    expect(allow('test')).toBe(true);
  });

  it('requires strong secrets for production, staging, absent, empty, or MISTYPED values', () => {
    for (const v of ['production', 'staging', undefined, '', 'Production', 'prod', 'Development ', 'dev']) {
      expect(allow(v), `NODE_ENV=${JSON.stringify(v)} must be fail-closed`).toBe(false);
    }
  });

  it('rotation of role secrets is a separate explicit opt-in', () => {
    expect(resolveSecretMode({} as NodeJS.ProcessEnv).rotateRoleSecrets).toBe(false);
    expect(resolveSecretMode({ MIGRATE_ROTATE_ROLE_SECRETS: 'yes' } as NodeJS.ProcessEnv).rotateRoleSecrets).toBe(true);
    expect(resolveSecretMode({ MIGRATE_ROTATE_ROLE_SECRETS: 'true' } as NodeJS.ProcessEnv).rotateRoleSecrets).toBe(false);
  });
});
