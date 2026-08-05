/**
 * roleSecretReportingLive.test.ts — the report REACHES the operator, proven by
 * running the migrator against a real database; and rotation is TRANSACTIONAL
 * with the store the consumers read.
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
 *
 * ⛔ AND THE FOURTH TIME MADE IT AN OUTAGE (2026-08-05): the 0105 run rotated
 * `c3_auth`/`c3_backup` in Postgres while Railway's stored URLs kept the old
 * values — sign-in down, nightly backup down, `/health` green. So rotation now
 * REFUSES unless the consumer string this environment carries agrees with the
 * password being applied, and every run MEASURES the supplied secret against
 * the live database instead of trusting the input.
 *
 * ⚠️ TEST ORDER IS LOAD-BEARING: the refusal cases run BEFORE the successful
 * rotation, because a refusal's proof is that the OLD passwords still work —
 * which stops being observable once a rotation legitimately goes through.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { runMigrations } from '../src/migrate';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

const STRONG = {
  app: 'c3-app-strong-secret-0123456789',
  auth: 'c3-auth-strong-secret-0123456789',
  backup: 'c3-backup-strong-secret-0123456789',
};

/** A consumer connection string for `role`, borrowing host/db from the admin URL. */
function consumerUrl(role: string, password: string): string {
  const admin = new URL(db.adminUrl);
  return `postgres://${encodeURIComponent(role)}:${encodeURIComponent(password)}@${admin.host}${admin.pathname}`;
}

/** Run the migrator against the live test database, capturing everything logged. */
async function migrateCapturingLog(
  rotateRoleSecrets: boolean,
  consumerConnectionStrings?: { app?: string; auth?: string; backup?: string },
): Promise<string[]> {
  const lines: string[] = [];
  await runMigrations({
    adminConnectionString: db.adminUrl,
    appRole: 'c3_app',
    appPassword: STRONG.app,
    authRole: 'c3_auth',
    authPassword: STRONG.auth,
    backupRole: 'c3_backup',
    backupPassword: STRONG.backup,
    allowDevSecrets: true,
    rotateRoleSecrets,
    consumerConnectionStrings,
    log: (m: string) => lines.push(m),
  });
  return lines;
}

/** Can this role+password actually open a connection right now? */
async function authenticates(role: string, password: string): Promise<boolean> {
  const probe = new Client({ connectionString: consumerUrl(role, password) });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
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

  it('⛔ AND the disagreement is MEASURED, not inferred: the live-check says the supplied secret fails', async () => {
    /*
     * The supplied strong secrets differ from the live (bootstrap) passwords, so
     * every live-check must report the mismatch — the exact fact whose absence
     * turned three wrong inputs into three incidents.
     *
     * ⚖️ THIS IS ALSO THE AUTH-METHOD CONTROL (LAW 29): if the embedded database
     * accepted any password (trust auth), the probe would succeed and this line
     * would read AGREES — so the assertion doubles as proof that password auth
     * is real here and the detector is not vacuous.
     */
    const lines = await migrateCapturingLog(false);
    const checks = lines.filter((l) => /^↳ live-check /.test(l));
    expect(checks.length, 'every role gets a live check').toBe(3);
    for (const line of checks) {
      expect(line).toMatch(/does NOT authenticate — the live password DIFFERS/);
      expect(line).toMatch(/Railway/); // the platform store is named, not "your config"
    }
  });
});

describe('⛔ rotation is REFUSED when it cannot be verified — and refusal changes NOTHING', () => {
  it('without consumer strings: refused, all three stores named, old passwords still live', async () => {
    await expect(migrateCapturingLog(true)).rejects.toThrow(/Rotation refused before touching the database/);
    await expect(migrateCapturingLog(true)).rejects.toThrow(/DATABASE_URL/);
    await expect(migrateCapturingLog(true)).rejects.toThrow(/DATABASE_AUTH_URL/);
    await expect(migrateCapturingLog(true)).rejects.toThrow(/DATABASE_BACKUP_URL/);
    await expect(migrateCapturingLog(true)).rejects.toThrow(/c3-backup-cron/);

    // ⛔ The transactionality proof: the refusal happened BEFORE any effect, so
    // the strong secrets must NOT authenticate yet.
    expect(await authenticates('c3_app', STRONG.app), 'strong secret must NOT work yet').toBe(false);
  });

  it('⛔ THE INCIDENT CASE: a consumer string still carrying the OLD password refuses the rotation', async () => {
    // c3_auth's consumer URL disagrees (old bootstrap password); app and backup agree.
    // One disagreement must refuse the WHOLE set — a half-rotated trio is worse
    // than either endpoint.
    const disagreeing = {
      app: consumerUrl('c3_app', STRONG.app),
      auth: db.authUrl, // the OLD credential — exactly Railway's state on 2026-08-05
      backup: consumerUrl('c3_backup', STRONG.backup),
    };
    await expect(migrateCapturingLog(true, disagreeing)).rejects.toThrow(/DIFFERENT password/);
    await expect(migrateCapturingLog(true, disagreeing)).rejects.toThrow(/strand that consumer/);

    expect(await authenticates('c3_app', STRONG.app), 'agreeing roles must not rotate either').toBe(false);
  });
});

describe('⛳ with the store in agreement, rotation proceeds and is PROVEN', () => {
  it('rotates, reports ROTATED, and the connect-back measures the new secret working', async () => {
    const agreed = {
      app: consumerUrl('c3_app', STRONG.app),
      auth: consumerUrl('c3_auth', STRONG.auth),
      backup: consumerUrl('c3_backup', STRONG.backup),
    };
    const lines = await migrateCapturingLog(true, agreed);
    const roleLines = lines.filter((l) => /^↳ role /.test(l));

    expect(roleLines.length).toBe(3);
    for (const line of roleLines) {
      expect(line).toMatch(/password ROTATED to the supplied value/);
      expect(line, 'a rotated run must NOT claim the secret was left alone').not.toMatch(/NOT applied/);
    }

    const checks = lines.filter((l) => /^↳ live-check /.test(l));
    expect(checks.length).toBe(3);
    for (const line of checks) {
      expect(line).toMatch(/post-rotation connect-back OK/);
      // ⛔ The report states its own limit: it proves the database and THIS
      // machine's copy, never the platform store nothing here can read.
      expect(line).toMatch(/does NOT prove/);
      expect(line).toMatch(/Railway/);
    }

    // The composition, re-proven from outside the migrator (LAW 34).
    expect(await authenticates('c3_auth', STRONG.auth)).toBe(true);
  });

  it('a later plain run now reports the supplied secret AGREES with the live password', async () => {
    const lines = await migrateCapturingLog(false);
    const checks = lines.filter((l) => /^↳ live-check /.test(l));
    expect(checks.length).toBe(3);
    for (const line of checks) {
      expect(line).toMatch(/AGREES with the live password/);
    }
  });
});

describe('⛔ no logged line discloses the secret itself', () => {
  it('neither outcome lines nor live-check lines carry a password', async () => {
    const lines = await migrateCapturingLog(false);
    for (const secret of Object.values(STRONG)) {
      expect(lines.join('\n'), 'a supplied secret must never reach the log').not.toContain(secret);
    }
  });
});
