/**
 * payrollRead.test.ts — L-05: the payroll scoped read `listPayableClaimsWithPayee`.
 *
 * Proves the SQL-scoped path is output-equivalent to the old load-everything path:
 * only Approved/Paid claims, each joined to its payee's verbatim full_name (the same
 * value listPeople returns), ordered (created_at desc, claim_id desc) exactly like
 * listClaims, keyset-paginated with no boundary drop/dup, and RLS tenant-isolated so
 * the joined person never crosses a tenant. Payroll carries no FX — amounts are the
 * claim's own minor units — so there is no honest-numbers coercion path here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@c3web/domain';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;
let alphaId: string;
let bravoId: string;
let alphaFinance: Actor;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ userId: '00000000-0000-0000-0000-0000000000ff', identity: email, displayName: email, role: role as Actor['role'], tenantId });

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

/** Seed a person (for the FK-backed payee join). */
async function seedPerson(admin: Client, tenantId: string, personId: string, fullName: string): Promise<void> {
  await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,$2,$3)`, [tenantId, personId, fullName]);
}
/** Seed a claim with an explicit created_at so the keyset order is deterministic. */
async function seedClaim(
  admin: Client,
  tenantId: string,
  claimId: string,
  status: string,
  personId: string | null,
  createdAt: string,
  paymentSourceLabel: string | null = null,
): Promise<void> {
  // Shape CHECKs (0036): a decided claim needs a reviewer; Paid needs paid_on;
  // Rejected needs a rejection_reason (and only Rejected may carry one).
  const reviewedBy = status === 'Submitted' ? null : 'owner@a.com';
  const paidOn = status === 'Paid' ? '2026-06-05' : null;
  const rejectionReason = status === 'Rejected' ? 'not eligible' : null;
  await admin.query(
    `INSERT INTO claim (tenant_id, claim_id, submitted_by, person_id, category, description, amount_minor, currency, expense_on, status, reviewed_by, paid_on, rejection_reason, payment_source_label, created_at)
     VALUES ($1,$2,'ops@a.com',$3,'Travel',$4,12500,'USD','2026-06-01',$5,$6,$7::date,$8,$9,$10::timestamptz)`,
    [tenantId, claimId, personId, `desc ${claimId}`, status, reviewedBy, paidOn, rejectionReason, paymentSourceLabel, createdAt],
  );
}

beforeEach(async () => {
  await db.truncateAll();
  const alpha = await db.seedTenant({ slug: 'alpha', users: [{ key: 'finance', email: 'finance@a.com', displayName: 'Fin A', role: 'finance' }] });
  const bravo = await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;
  alphaFinance = actor(alphaId, 'finance@a.com', 'finance');

  const admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
  try {
    await seedPerson(admin, alphaId, 'PER-A1', 'Alice Ahmadi');
    await seedPerson(admin, alphaId, 'PER-A2', 'Bob Baria');
    await seedPerson(admin, bravoId, 'PER-B1', 'Bravo Person');
    // increasing created_at t1<t2<t3<t4<t5 → keyset DESC yields t5..t1.
    await seedClaim(admin, alphaId, 'CLM-A1', 'Approved', 'PER-A1', '2026-06-01T10:00:00Z');
    await seedClaim(admin, alphaId, 'CLM-A2', 'Paid', 'PER-A2', '2026-06-01T11:00:00Z', 'Bank Transfer');
    await seedClaim(admin, alphaId, 'CLM-A3', 'Approved', null, '2026-06-01T12:00:00Z'); // no payee
    await seedClaim(admin, alphaId, 'CLM-A4', 'Submitted', 'PER-A1', '2026-06-01T13:00:00Z'); // excluded
    await seedClaim(admin, alphaId, 'CLM-A5', 'Rejected', 'PER-A1', '2026-06-01T14:00:00Z'); // excluded
    await seedClaim(admin, bravoId, 'CLM-B1', 'Approved', 'PER-B1', '2026-06-01T15:00:00Z'); // other tenant
  } finally {
    await admin.end();
  }
});

describe('L-05 — payroll scoped read', () => {
  it('returns only Approved/Paid, joins the payee name, orders created_at/claim_id desc, isolates the tenant', async () => {
    const rows = await p.reads.forActor(alphaFinance).listPayableClaimsWithPayee(null, 100);
    // payable only, newest first (t3 > t2 > t1); Submitted/Rejected/other-tenant excluded.
    expect(rows.map((r) => r.claimId)).toEqual(['CLM-A3', 'CLM-A2', 'CLM-A1']);
    expect(rows.map((r) => r.status)).toEqual(['Approved', 'Paid', 'Approved']);
    // payee name is the verbatim full_name; null when the claim names no person.
    expect(rows.find((r) => r.claimId === 'CLM-A1')!.payeeName).toBe('Alice Ahmadi');
    expect(rows.find((r) => r.claimId === 'CLM-A2')!.payeeName).toBe('Bob Baria');
    expect(rows.find((r) => r.claimId === 'CLM-A3')!).toMatchObject({ personId: null, payeeName: null });
    // no cross-tenant leak through the join.
    expect(rows.some((r) => r.claimId === 'CLM-B1')).toBe(false);
  });

  it('keyset pagination returns every payable row exactly once across page boundaries', async () => {
    const seen: string[] = [];
    let after: { createdAt: string; claimId: string } | null = null;
    for (;;) {
      const page = await p.reads.forActor(alphaFinance).listPayableClaimsWithPayee(after, 2);
      seen.push(...page.map((r) => r.claimId));
      if (page.length < 2) break;
      const last = page[page.length - 1]!;
      after = { createdAt: last.createdAt, claimId: last.claimId };
    }
    // exactly the three payable rows, in order, no duplicate at the page boundary.
    expect(seen).toEqual(['CLM-A3', 'CLM-A2', 'CLM-A1']);
  });
});
