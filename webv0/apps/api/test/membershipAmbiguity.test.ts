/**
 * membershipAmbiguity.test.ts — D-008 class-B: one identity, two tenants.
 *
 * ⚖️ THE DEFECT. `resolveMembership` ends `ORDER BY t.created_at ASC LIMIT 1`.
 * A person who is a member of more than one tenant is therefore resolved into
 * **whichever C3 tenant was created first** — silently, with no selection, no
 * signal, and no error. Every request they make then runs against that tenant's
 * data, and the system is behaving exactly as written.
 *
 * ⛔ WHY IT SURVIVED: with one tenant the ordering clause is unreachable, so the
 * bug has no behaviour. It is the FIRST INSTANCE of the class the identity-plane
 * RLS exemption creates — `app_user` / `external_identity` carry no policy, so
 * every query against them is hand-scoped, and hand-scoping is what fails
 * silently the moment a second tenant exists.
 *
 * ⚖️ THE FIX IS A REFUSAL, NOT A SELECTION, AND THAT IS DELIBERATE. Choosing a
 * tenant needs a UI, a notion of "active tenant" on the session, and an owner
 * decision — a slice of its own. What must not survive is the SILENT choice. So
 * an ambiguous identity is refused by name, and the refusal states its own
 * reopening condition.
 *
 * ⚠️ STATED ASSUMPTION, not a silent default: this REFUSES a legitimate
 * multi-org user the day one exists. That is the correct trade while zero exist
 * — a refusal is recoverable and a wrong tenant is not — and it is written here
 * so the next reader inherits the reasoning rather than the behaviour.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createAdminDirectory, type AdminDirectory } from '../src/auth/directory';

let db: TestDatabase;
let directory: AdminDirectory;

const KEY = { provider: 'entra' as const, issuerTenantId: 'tid-contoso', subject: 'oid-dual-member' };

beforeAll(async () => {
  db = await startTestDatabase();
  directory = createAdminDirectory(db.adminUrl);
}, 180_000);

afterAll(async () => {
  await directory?.close();
  await db?.stop();
});

/** One human, one Entra identity, memberships in BOTH tenants. */
async function seedDualMember(): Promise<{ olderTenantId: string; newerTenantId: string; userId: string }> {
  const older = await db.seedTenant({ slug: 'older-org', name: 'Older Org' });
  const newer = await db.seedTenant({ slug: 'newer-org', name: 'Newer Org' });
  // Make the creation order unambiguous — the defect keys on created_at.
  await db.adminQuery(`UPDATE tenant SET created_at = now() - interval '10 days' WHERE id = $1`, [older.tenantId]);
  await db.adminQuery(`UPDATE tenant SET created_at = now() WHERE id = $1`, [newer.tenantId]);

  const [user] = await db.adminQuery<{ id: string }>(
    `INSERT INTO app_user (email, display_name) VALUES ('dual@member.com','Dual Member') RETURNING id`,
  );
  await db.adminQuery(
    `INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id) VALUES ($1,$2,$3,$4)`,
    [KEY.provider, KEY.issuerTenantId, KEY.subject, user!.id],
  );
  for (const [tenantId, role] of [
    [older.tenantId, 'operations'],
    [newer.tenantId, 'owner'],
  ] as const) {
    await db.adminQuery(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [tenantId, user!.id]);
    await db.adminQuery(`INSERT INTO role_assignment (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [
      tenantId,
      user!.id,
      role,
    ]);
  }
  return { olderTenantId: older.tenantId, newerTenantId: newer.tenantId, userId: user!.id };
}

beforeEach(async () => {
  await db.truncateAll();
});

describe('one identity, two tenants', () => {
  it('POSITIVE CONTROL: the identity really does hold two memberships with different roles', async () => {
    const { olderTenantId, newerTenantId, userId } = await seedDualMember();
    const rows = await db.adminQuery<{ tenant_id: string; role: string }>(
      `SELECT tenant_id, role FROM role_assignment WHERE user_id = $1 ORDER BY tenant_id`,
      [userId],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([olderTenantId, newerTenantId]));
    // Different roles per tenant: silently picking one also silently picks an
    // AUTHORITY LEVEL, which is the part that makes this more than a nuisance.
    expect(new Set(rows.map((r) => r.role))).toEqual(new Set(['operations', 'owner']));
  });

  it('⛔ an ambiguous membership is REFUSED, not silently resolved to the oldest tenant', async () => {
    const { olderTenantId } = await seedDualMember();

    // RED before the fix: this RESOLVED, returning the older tenant and its
    // 'operations' role, with nothing to indicate a choice had been made.
    await expect(directory.resolveMembership(KEY)).rejects.toThrow(/more than one organisation/i);

    // And it must not be resolvable by luck of ordering either way.
    await db.adminQuery(`UPDATE tenant SET created_at = now() WHERE id = $1`, [olderTenantId]);
    await expect(directory.resolveMembership(KEY)).rejects.toThrow(/more than one organisation/i);
  });

  it('a SINGLE membership still resolves normally — the refusal must not break the ordinary case', async () => {
    const solo = await db.seedTenant({ slug: 'solo-org' });
    const [user] = await db.adminQuery<{ id: string }>(
      `INSERT INTO app_user (email, display_name) VALUES ('solo@member.com','Solo') RETURNING id`,
    );
    await db.adminQuery(
      `INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id) VALUES ($1,$2,$3,$4)`,
      [KEY.provider, KEY.issuerTenantId, 'oid-solo', user!.id],
    );
    await db.adminQuery(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [solo.tenantId, user!.id]);
    await db.adminQuery(`INSERT INTO role_assignment (tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [
      solo.tenantId,
      user!.id,
    ]);

    const resolved = await directory.resolveMembership({ ...KEY, subject: 'oid-solo' });
    expect(resolved).toMatchObject({ tenantId: solo.tenantId, tenantSlug: 'solo-org', role: 'owner' });
  });

  it('an UNKNOWN identity still resolves to null — refusal and non-provision stay distinguishable', async () => {
    // These are different truths and must not collapse into one another: "we do
    // not know you" and "we know you twice" call for different operator actions.
    await expect(directory.resolveMembership({ ...KEY, subject: 'oid-nobody' })).resolves.toBeNull();
  });
});
