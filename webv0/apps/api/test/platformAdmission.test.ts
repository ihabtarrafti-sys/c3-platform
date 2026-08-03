/**
 * platformAdmission.test.ts — admission requires a ROW (`D-019`).
 *
 * ⚖️ THE RULING THIS PINS: platform authority is granted by the PRESENCE of a
 * registration, never by the ABSENCE of a tenant membership. `D-016a` stated it;
 * migration 0104 made it mechanical; this proves the resolver honours it against
 * a real database rather than a fake.
 *
 * ⛔ Why the distinction is not pedantry: *"admit principals with no tenant"* and
 * *"admit principals that are registered"* describe the same feature and produce
 * opposite code. The first is a SUBTRACTION — it reads as removing the check
 * that refuses non-members, and that denial is the only thing standing between an
 * uninvited stranger and the product. There must be no path here where being
 * unknown is sufficient.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { hasPlatformCapability } from '@c3web/authz';
import { createAdminDirectory, type AdminDirectory } from '../src/auth/directory';

let db: TestDatabase;
let admin: Client;
let directory: AdminDirectory;

const ISSUER = 'https://login.microsoftonline.com/e6eb2f39-0000-0000-0000-000000000000/v2.0';
const REGISTERED = '11111111-2222-3333-4444-555555555555';
const UNREGISTERED = '99999999-8888-7777-6666-555555555555';

const key = (subject: string) => ({ provider: 'entra' as const, issuer: ISSUER, subject });

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
  await admin.query(
    `INSERT INTO platform_principal (provider, issuer, subject, kind, accountable_owner, capabilities)
     VALUES ('entra', $1, $2, 'service', 'ihab@c3hq.org', ARRAY['platform.erasure_janitor.execute']::text[])`,
    [ISSUER, REGISTERED],
  );
  directory = createAdminDirectory(db.adminUrl);
}, 180_000);

afterAll(async () => {
  await directory?.close().catch(() => {});
  await admin?.end().catch(() => {});
  await db?.stop();
});

describe('⛔ a row is required — nothing else admits', () => {
  it('a REGISTERED principal resolves with exactly its granted capabilities', async () => {
    const principal = await directory.resolvePlatformPrincipal(key(REGISTERED));
    expect(principal).not.toBeNull();
    expect(principal!.accountableOwner).toBe('ihab@c3hq.org');
    expect(hasPlatformCapability(principal, 'platform.erasure_janitor.execute')).toBe(true);
    // Registered is not the same as omnipotent: the OTHER capability was not granted.
    expect(hasPlatformCapability(principal, 'platform.backup_status.read')).toBe(false);
  });

  it('⛔ an UNREGISTERED subject resolves to null — being unknown grants nothing', async () => {
    // The failure mode: an authenticated identity that C3 has never heard of
    // being admitted because nothing objected. `null` here, refusal upstream.
    expect(await directory.resolvePlatformPrincipal(key(UNREGISTERED))).toBeNull();
    expect(hasPlatformCapability(await directory.resolvePlatformPrincipal(key(UNREGISTERED)), 'platform.erasure_janitor.execute')).toBe(false);
  });

  it('⛔ the same subject under a DIFFERENT issuer is a different principal', async () => {
    // The key is (provider, issuer, subject). A subject id that collides across
    // trust roots must not inherit the registration of the other one — the same
    // rule that makes an Entra `oid` meaningless without its `tid`.
    const other = await directory.resolvePlatformPrincipal({
      provider: 'entra',
      issuer: 'https://login.microsoftonline.com/ffffffff-0000-0000-0000-000000000000/v2.0',
      subject: REGISTERED,
    });
    expect(other).toBeNull();
  });
});

describe('⚖️ the registry cannot express an unaccountable or over-broad principal', () => {
  it('⛔ refuses a row with a blank accountable owner', async () => {
    // NOT NULL alone would admit ''. A principal naming nobody cannot be asked
    // why, and a platform-wide destructive sweep attributable to nobody is worse
    // than one attributable to the wrong tenant's owner.
    await expect(
      admin.query(
        `INSERT INTO platform_principal (provider, issuer, subject, kind, accountable_owner)
         VALUES ('entra', $1, 'blank-owner', 'service', '   ')`,
        [ISSUER],
      ),
    ).rejects.toThrow(/accountable_owner/i);
  });

  it('⛔ refuses a capability outside the closed vocabulary', async () => {
    // The database is the second half of the binding; `vocabularyDrift.test.ts`
    // holds it to `PLATFORM_CAPABILITIES`. Break-glass was put out of scope by
    // `D-016`, and it must not arrive by an INSERT.
    await expect(
      admin.query(
        `INSERT INTO platform_principal (provider, issuer, subject, kind, accountable_owner, capabilities)
         VALUES ('entra', $1, 'over-broad', 'service', 'ihab@c3hq.org', ARRAY['platform.people.read']::text[])`,
        [ISSUER],
      ),
    ).rejects.toThrow(/capabilities/i);
  });

  it('⛔ refuses an unknown principal kind', async () => {
    await expect(
      admin.query(
        `INSERT INTO platform_principal (provider, issuer, subject, kind, accountable_owner)
         VALUES ('entra', $1, 'odd-kind', 'robot', 'ihab@c3hq.org')`,
        [ISSUER],
      ),
    ).rejects.toThrow(/kind/i);
  });
});

describe('⛳ the app principal cannot see who holds platform authority', () => {
  it('c3_app has NO privilege on the registry at all', async () => {
    // Not merely "cannot grant" — cannot READ. Discovering which principals hold
    // platform capabilities is reconnaissance, and the app path has no business
    // with it. `has_table_privilege` is asked directly rather than inferred from
    // a failing query, so this states the grant rather than a symptom of it.
    const r = await admin.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('c3_app','platform_principal','SELECT') AS sel,
              has_table_privilege('c3_app','platform_principal','INSERT') AS ins,
              has_table_privilege('c3_app','platform_principal','UPDATE') AS upd,
              has_table_privilege('c3_app','platform_principal','DELETE') AS del`,
    );
    expect(r.rows[0]).toEqual({ sel: false, ins: false, upd: false, del: false });
  });

  it('c3_auth may READ and may not WRITE — resolution only', async () => {
    const r = await admin.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('c3_auth','platform_principal','SELECT') AS sel,
              has_table_privilege('c3_auth','platform_principal','INSERT') AS ins,
              has_table_privilege('c3_auth','platform_principal','UPDATE') AS upd,
              has_table_privilege('c3_auth','platform_principal','DELETE') AS del`,
    );
    expect(r.rows[0]).toEqual({ sel: true, ins: false, upd: false, del: false });
  });
});
