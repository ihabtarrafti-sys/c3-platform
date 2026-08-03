/**
 * rlsCatalog.test.ts — F05's RULED DELIVERABLE (disclosure chapter, Block 5):
 * the CATALOG-WIDE assertion that every tenant table carries ENABLED + FORCED
 * row-level security. The one-line DDL (0096) fixes approval_revision; THIS
 * test is the fix's durable form — the next table someone creates without
 * FORCE fails here, by name, instead of shipping as the next F05.
 *
 * RED-proven by ordering: this file landed BEFORE migration 0096 and failed
 * naming exactly `approval_revision` (ENABLE since 0058, FORCE never); green
 * once 0096 exists. The staging APPLY of 0096 is the OWNER's, at the web+API
 * window — this certifies against the in-gate embedded cluster.
 *
 * THE EXEMPTION LIST IS NAMED AND REASONED — never pattern-matched:
 *   - intake_link: the ruled exemption (the public guest-intake token table;
 *     its access model is the hashed-token lookup, not tenant RLS);
 *   - _migrations: the migration runner's own bookkeeping, not a tenant table.
 * Anything else without both flags is a failure by name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

const EXEMPT: Record<string, string> = {
  intake_link: 'ruled exemption — public token table, hashed-token access model',
  _migrations: 'the migration runner’s own bookkeeping, not a tenant table',
  // THE IDENTITY/ERASURE PLANE — pre-tenant or tenant-outliving by design;
  // none carries a tenant-RLS model to enable (0004's design: resolution
  // happens before tenant context; erasure registry outlives the tenant).
  // ⛳ Classification REPORTED to Neural for counter-verdict — designing an
  // RLS posture for this plane is owner-visible work, not a catalog patch.
  tenant: 'the tenant registry itself — cross-tenant by nature',
  app_user: 'identity plane: users exist before and across tenant contexts',
  external_identity: 'identity plane: the immutable (provider, tid, oid) binding',
  access_event: 'auth-plane audit, written pre-tenant-context',
  erased_tenant_prefix: 'the erasure janitor’s registry — deliberately OUTLIVES its tenant',
  // D-015/D-019 (migration 0104). A PLATFORM principal has no tenant, so there is
  // no tenant column to write a policy against — an RLS predicate here would have
  // to be `true`, which is a policy in name only.
  //
  // ⛔ AND THE PROTECTION IS THE GRANT, NOT RLS: c3_app holds NO privilege on this
  // table at all — not SELECT, not anything — so the app principal cannot read who
  // holds platform authority even without a policy. `platformAdmission.test.ts`
  // asserts all four privileges are false rather than inferring it from a failing
  // query. c3_auth may SELECT and nothing else, exactly as it resolves tenant
  // membership against `external_identity`.
  //
  // ⛳ Classification REPORTED to Neural with the rest of this plane, per the note
  // above — an exemption is a decision, and this one is being recorded as such
  // rather than added to make a gate green.
  platform_principal: 'platform plane: authority that is not tenant membership; guarded by grants, not RLS',
};

describe('F05 — the RLS catalog law', () => {
  it('every tenant table has ENABLED + FORCED row-level security (exemptions named, never matched)', async () => {
    const rows = await db.adminQuery<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );
    // POSITIVE CONTROL: the catalog scan actually saw the schema.
    expect(rows.length, 'the scan must see the real table population').toBeGreaterThan(40);
    expect(rows.some((r) => r.relname === 'approval_revision')).toBe(true);

    const offenders = rows
      .filter((r) => !(r.relname in EXEMPT))
      .filter((r) => !(r.relrowsecurity && r.relforcerowsecurity))
      .map((r) => `${r.relname} (enabled=${r.relrowsecurity}, forced=${r.relforcerowsecurity})`);
    expect(offenders, 'every listed table needs ALTER TABLE … ENABLE/FORCE ROW LEVEL SECURITY in a migration').toEqual([]);

    // The exemptions must still EXIST — a renamed or dropped exempt table
    // means this list is stale, and a stale exemption is a silent hole.
    for (const name of Object.keys(EXEMPT)) {
      expect(rows.some((r) => r.relname === name), `exempt table '${name}' no longer exists — re-derive the list`).toBe(true);
    }
  });
});
