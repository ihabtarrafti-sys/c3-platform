/**
 * seedStaging.test.ts — the owner-run first-tenant seed against a real
 * PostgreSQL: idempotency, exact role assignment, and ambiguity refusal.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { seedStagingTenant, type SeedSpec } from '../src/seedStaging';

let db: TestDatabase;
let admin: Client;

const TID = 'aaaaaaaa-1111-2222-3333-444444444444';
const spec: SeedSpec = {
  tenantSlug: 'geekay',
  tenantName: 'Geekay Esports',
  entraTenantId: TID,
  owner: { oid: '11111111-0000-0000-0000-000000000001', email: 'owner@geekay.com', displayName: 'Ihab' },
  operations: { oid: '11111111-0000-0000-0000-000000000002', email: 'ops@geekay.com', displayName: 'Khalailah' },
};

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
});

async function counts() {
  const r = await admin.query(`
    SELECT (SELECT count(*)::int FROM tenant) AS tenants,
           (SELECT count(*)::int FROM app_user) AS users,
           (SELECT count(*)::int FROM external_identity) AS identities,
           (SELECT count(*)::int FROM role_assignment) AS roles`);
  return r.rows[0];
}

describe('seed command', () => {
  it('creates one tenant, two identities, exact owner+operations roles', async () => {
    const report = await seedStagingTenant(admin, spec);
    expect(report.changed).toBe(true);
    expect(await counts()).toEqual({ tenants: 1, users: 2, identities: 2, roles: 2 });
    const roles = await admin.query(
      `SELECT u.email, ra.role FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id ORDER BY ra.role`,
    );
    expect(roles.rows).toEqual([
      { email: 'ops@geekay.com', role: 'operations' },
      { email: 'owner@geekay.com', role: 'owner' },
    ]);
    // Redaction: full object IDs never appear in the report.
    const text = report.lines.join('\n');
    expect(text).not.toContain(spec.owner.oid);
    expect(text).not.toContain(spec.entraTenantId);
  });

  it('is idempotent: a second run changes nothing and duplicates nothing', async () => {
    await seedStagingTenant(admin, spec);
    const second = await seedStagingTenant(admin, spec);
    expect(second.changed).toBe(false);
    expect(await counts()).toEqual({ tenants: 1, users: 2, identities: 2, roles: 2 });
  });

  it('reconciles a drifted role back to the exact assignment', async () => {
    await seedStagingTenant(admin, spec);
    await admin.query(`UPDATE role_assignment SET role='visitor' WHERE role='operations'`);
    const rerun = await seedStagingTenant(admin, spec);
    expect(rerun.changed).toBe(true);
    const r = await admin.query(`SELECT role FROM role_assignment ORDER BY role`);
    expect(r.rows.map((x) => x.role)).toEqual(['operations', 'owner']);
  });

  it('refuses when owner and operations share one oid', async () => {
    await expect(
      seedStagingTenant(admin, { ...spec, operations: { ...spec.operations, oid: spec.owner.oid } }),
    ).rejects.toThrow(/DIFFERENT Entra identities/);
  });

  it('refuses an ambiguous rebinding: oid already bound to a different email', async () => {
    await seedStagingTenant(admin, spec);
    await expect(
      seedStagingTenant(admin, { ...spec, owner: { ...spec.owner, email: 'different@geekay.com' } }),
    ).rejects.toThrow(/refusing ambiguous rebinding/);
    // And the refusal mutated nothing:
    expect(await counts()).toEqual({ tenants: 1, users: 2, identities: 2, roles: 2 });
  });

  it('refuses when the email already belongs to a different external identity', async () => {
    await seedStagingTenant(admin, spec);
    // A new oid claiming the existing owner email:
    await expect(
      seedStagingTenant(admin, { ...spec, owner: { ...spec.owner, oid: '22222222-0000-0000-0000-00000000000f' } }),
    ).rejects.toThrow(/already belongs to a different external identity/);
  });
});
