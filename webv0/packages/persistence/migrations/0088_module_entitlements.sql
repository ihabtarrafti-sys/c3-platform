-- 0088_module_entitlements.sql — the reusable per-tenant module entitlement
-- kernel (Comms build Phase 2; Temper's spine §6.2). The platform concept every
-- later licensed module inherits: a tenant's RIGHT to a module, written by
-- COMMERCIAL authority (never the tenant app role), with an append-only
-- grant/lapse history.
--
-- c3_app gets SELECT only — a tenant must not self-enable or self-resize a paid
-- module by writing this table (the entitlement is a license boundary, unlike the
-- tenant_setting kernel which is a tenant-writable JSON surface). Effective WRITE
-- access to a module requires state='active' AND now() within the window; no row
-- means never entitled. Ships DORMANT — the Comms use-cases (later migrations)
-- consume it; nothing references it yet.
--
-- The runner wraps this file in its own transaction and records it; no BEGIN/
-- COMMIT and no _migrations insert here.

CREATE TABLE tenant_module_entitlement (
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  module_key          text NOT NULL,                                   -- slug, e.g. 'comms'
  state               text NOT NULL CHECK (state IN ('active','lapsed')),
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz,                                     -- null = open-ended
  storage_quota_bytes bigint,                                          -- null = no quota (computed-SUM enforcement)
  source_ref          text,                                            -- commercial reference
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_key)
);
CREATE INDEX tenant_module_entitlement_lookup ON tenant_module_entitlement (module_key, state, effective_until);
CREATE TRIGGER tenant_module_entitlement_set_updated_at BEFORE UPDATE ON tenant_module_entitlement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE tenant_module_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_module_entitlement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_module_entitlement
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- Commercial authority writes on the privileged connection; the app role only READS.
GRANT SELECT ON tenant_module_entitlement TO c3_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_module_entitlement FROM c3_app;
GRANT SELECT ON tenant_module_entitlement TO c3_backup;

-- The append-only grant/lapse history — the reusable platform audit for every
-- future licensed module. Keyed by (tenant_id, module_key) as DATA, not a FK, so
-- history survives independently of the current entitlement row.
CREATE TABLE tenant_module_entitlement_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  module_key     text NOT NULL,
  from_state     text CHECK (from_state IN ('active','lapsed')),       -- null on first grant
  to_state       text NOT NULL CHECK (to_state IN ('active','lapsed')),
  platform_actor text NOT NULL,                                        -- the commercial authority identity
  reason         text,
  source_ref     text,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_module_entitlement_event_history ON tenant_module_entitlement_event (tenant_id, module_key, at, id);
CREATE TRIGGER tenant_module_entitlement_event_append_only BEFORE UPDATE OR DELETE ON tenant_module_entitlement_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE tenant_module_entitlement_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_module_entitlement_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_module_entitlement_event
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT ON tenant_module_entitlement_event TO c3_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_module_entitlement_event FROM c3_app;
GRANT SELECT ON tenant_module_entitlement_event TO c3_backup;
