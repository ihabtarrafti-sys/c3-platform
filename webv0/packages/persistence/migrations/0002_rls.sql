-- 0002_rls.sql - Row-Level Security on every tenant-owned table.
--
-- Tenant context is carried in the `app.tenant_id` GUC, set LOCAL to each
-- transaction by the application (see tenantContext.ts). When it is unset,
-- current_setting('app.tenant_id', true) returns NULL and every policy
-- predicate evaluates to false - the query sees nothing and writes are
-- rejected. This is the FAIL-CLOSED guarantee: missing tenant context = no data.
--
-- FORCE ROW LEVEL SECURITY makes policies apply even to the table owner, so a
-- privileged connection cannot silently bypass tenant isolation on data tables.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  -- Data-plane tables: ENABLE + FORCE so even the table owner/admin cannot
  -- bypass tenant isolation on business data.
  FOREACH t IN ARRAY ARRAY[
    'business_id_counter','approval','person','approval_event','audit_event'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
    $f$, t);
  END LOOP;

  -- Control-plane identity tables: ENABLE RLS (the least-privileged app role is
  -- restricted by policy), but NOT forced - the privileged admin/auth resolver
  -- must read memberships to resolve a principal's tenant BEFORE tenant context
  -- can exist (chicken-and-egg). The app role has no grants here regardless.
  FOREACH t IN ARRAY ARRAY['tenant_membership','role_assignment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
    $f$, t);
  END LOOP;
END $$;
