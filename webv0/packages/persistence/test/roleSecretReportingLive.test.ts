/**
 * roleSecretReportingLive.test.ts — the report REACHES the operator, proven by
 * running the migrator twice against a real database.
 *
 * ⚖️ LAW 34 applied to this fix: the pure classifier and the message are each
 * tested, and neither proves the operator will ever see the line. `log` is
 * opt-in (`config.log ?? (() => {})`), so a correct message that never reaches a
 * caller is exactly the muted-instrument failure this program keeps finding.
 *
 * ⛔ THE SEQUENCE IS THE ONE THAT PRODUCED THE BUG. Run one CREATES the roles
 * (the password is applied). Run two supplies a password for roles that already
 * exist, without rotation — the secret is demanded and deliberately NOT applied.
 * That second run is where *"I supplied a password"* became *"the password is
 * now that"*, three times in this environment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { runMigrations } from '../src/migrate';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** Run the migrator against the live test database, capturing everything logged. */
async function migrateCapturingLog(rotateRoleSecrets: boolean): Promise<string[]> {
  const lines: string[] = [];
  await runMigrations({
    adminConnectionString: db.adminUrl,
    appRole: 'c3_app',
    appPassword: 'c3-app-strong-secret-0123456789',
    authRole: 'c3_auth',
    authPassword: 'c3-auth-strong-secret-0123456789',
    backupRole: 'c3_backup',
    backupPassword: 'c3-backup-strong-secret-0123456789',
    allowDevSecrets: true,
    rotateRoleSecrets,
    log: (m: string) => lines.push(m),
  });
  return lines;
}

describe('⛔ the migrator SAYS whether it applied the secret it demanded', () => {
  it('a re-run over EXISTING roles reports that the supplied secret was NOT applied', async () => {
    // The test database already has every role (its own bootstrap created them),
    // so this is the second-run case directly: passwords demanded, not applied.
    const lines = await migrateCapturingLog(false);

    const roleLines = lines.filter((l) => /^↳ role /.test(l));
    expect(roleLines.length, 'every role must report an outcome, not just some').toBe(3);

    for (const role of ['c3_app', 'c3_auth', 'c3_backup']) {
      const line = roleLines.find((l) => l.includes(role));
      expect(line, `${role} must report an outcome`).toBeDefined();
      // ⛔ The line the three credential disagreements needed and never got.
      expect(line).toMatch(/LEFT UNCHANGED — the supplied secret was NOT applied/);
      expect(line).toMatch(/do not record this run as having set it/i);
    }
  });

  it('⛳ and with rotation opted in, it reports the password as ROTATED', async () => {
    // The positive control: the report must distinguish the two outcomes, or it
    // would be a constant string dressed as a finding.
    const lines = await migrateCapturingLog(true);
    const roleLines = lines.filter((l) => /^↳ role /.test(l));

    expect(roleLines.length).toBe(3);
    for (const line of roleLines) {
      expect(line).toMatch(/password ROTATED to the supplied value/);
      expect(line, 'a rotated run must NOT claim the secret was left alone').not.toMatch(/NOT applied/);
    }
  });

  it('⛔ no logged line discloses the secret itself', async () => {
    // A migration log is not a credential store. The report says WHETHER a
    // password was applied, never WHAT it was.
    const lines = await migrateCapturingLog(false);
    for (const secret of ['c3-app-strong-secret-0123456789', 'c3-auth-strong-secret-0123456789', 'c3-backup-strong-secret-0123456789']) {
      expect(lines.join('\n'), 'a supplied secret must never reach the log').not.toContain(secret);
    }
  });
});
