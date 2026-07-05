-- 0004_auth_role_grants.sql - grants for the SELECT-only membership role `c3_auth`.
--
-- Purpose: the RUNNING API must never hold the privileged migration/admin
-- credentials. Membership resolution (identity -> tenant + role) needs only
-- read access to the control-plane identity tables, so the API's auth
-- boundary connects as `c3_auth`:
--   * SELECT only, and only on the four identity tables;
--   * NO access to business data (person/approval/events/counters);
--   * NOSUPERUSER / NOBYPASSRLS (enforced by the migration runner bootstrap).
--
-- The identity tables have RLS ENABLED (not FORCED) with a tenant policy;
-- membership resolution happens before tenant context exists, so c3_auth reads
-- them via... RLS applies to c3_auth (not the table owner). We therefore add a
-- dedicated read policy for c3_auth: identity rows are the auth control plane,
-- not tenant business data, and this role can do nothing else with them.

GRANT USAGE ON SCHEMA public TO c3_auth;

GRANT SELECT ON tenant            TO c3_auth;
GRANT SELECT ON app_user          TO c3_auth;
GRANT SELECT ON tenant_membership TO c3_auth;
GRANT SELECT ON role_assignment   TO c3_auth;

-- RLS: allow c3_auth to read memberships/roles across tenants (resolution
-- happens pre-tenant-context). SELECT-only grants make this read-only.
CREATE POLICY auth_resolution_read ON tenant_membership
  FOR SELECT TO c3_auth USING (true);
CREATE POLICY auth_resolution_read ON role_assignment
  FOR SELECT TO c3_auth USING (true);

-- Explicitly ensure no business-data access and no writes anywhere.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM c3_auth;
REVOKE ALL ON person, approval, approval_event, audit_event, business_id_counter FROM c3_auth;
