-- 0087_current_user_id.sql — the participant identity helper (Comms Phase 1).
--
-- The stable participant surrogate (app_user.id) is carried per-transaction in
-- the `app.user_id` GUC, set LOCAL by the application right after `app.tenant_id`
-- (see tenantContext.ts). This helper mirrors current_tenant_id() exactly: when
-- the GUC is unset, current_setting('app.user_id', true) returns NULL, so
-- current_user_id() returns NULL and any participant predicate built on it
-- matches nothing.
--
-- DEFENSE-IN-DEPTH ONLY. Tenant RLS (current_tenant_id()) stays the universal,
-- fail-closed isolation boundary; the application layer stays the PRIMARY
-- participant filter. This function ships DORMANT — no policy references it yet;
-- the Comms data layer (0088+) will AND it onto the tenant predicate on
-- participant-scoped tables. Being nullable-by-construction, it is safe on every
-- connection (the c3_auth resolver, c3_backup, and migrations never set the GUC).
--
-- The runner wraps this file in its own transaction and records it; no BEGIN/
-- COMMIT and no _migrations insert here (the raw-psql deploy paste adds both).

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
