/**
 * migrate.test.ts — H-01: the strong-secret gate. In production, runMigrations
 * MUST refuse a missing or published-default role password BEFORE it touches the
 * database — the backup role is BYPASSRLS (it reads every tenant), so a known
 * password there exposes all data. These cases fail in the pure guard, so no
 * database is needed; the admin URL is deliberately unreachable to prove the
 * refusal happens first.
 */
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';

const base = {
  adminConnectionString: 'postgres://c3_admin:x@127.0.0.1:1/does-not-exist',
  appRole: 'c3_app',
  appPassword: 'a-strong-app-secret',
  authPassword: 'a-strong-auth-secret',
  backupPassword: 'a-strong-backup-secret',
  requireStrongSecrets: true as const,
  log: () => {},
};

describe('H-01: production strong-secret gate for runMigrations', () => {
  it('refuses a MISSING backup secret before touching the database', async () => {
    await expect(runMigrations({ ...base, backupPassword: undefined })).rejects.toThrow(/backupPassword.*required/i);
  });

  it('refuses the PUBLISHED default backup password (unreachable in prod mode)', async () => {
    await expect(runMigrations({ ...base, backupPassword: 'c3_backup_dev_pw' })).rejects.toThrow(/PUBLISHED dev default/);
  });

  it('refuses default app and auth passwords too', async () => {
    await expect(runMigrations({ ...base, appPassword: 'c3_app_dev_pw' })).rejects.toThrow(/PUBLISHED dev default/);
    await expect(runMigrations({ ...base, authPassword: undefined })).rejects.toThrow(/authPassword.*required/i);
  });

  it('does NOT apply the gate when requireStrongSecrets is off (dev/test keep the fallbacks)', async () => {
    // With the gate off, the default secret is accepted and the run proceeds to
    // the DB — which is unreachable here, so it fails on CONNECTION, never on the
    // secret. That distinction proves the gate did not fire.
    await expect(runMigrations({ ...base, requireStrongSecrets: false, backupPassword: 'c3_backup_dev_pw' })).rejects.not.toThrow(/dev default|required/i);
  });
});
