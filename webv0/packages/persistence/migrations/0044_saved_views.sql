-- 0044_saved_views.sql — Track B: saved views (named, PERSONAL filter/sort/
-- search presets on a register, e.g. "LoL roster — active").
--
-- Per-user (keyed by the actor identity, the notification precedent),
-- tenant-scoped. `state` is an OPAQUE json blob the web owns — the backend
-- stores and returns it verbatim and stays register-agnostic, so wiring a new
-- register needs no migration. Soft-remove only (no DELETE grant — uniform with
-- the no-DELETE data-plane law). NOT audited: personal UI preferences are not
-- governed business facts, so they carry no audit trail. A partial unique index
-- keeps one ACTIVE view per (user, register, name); a removed name frees up.
--
-- Owner-scoping (a user sees only their own views) is enforced in the
-- application ops (every read/write filters by user_identity); RLS enforces the
-- tenant boundary as everywhere else.
--
-- NOTE: the migration runner wraps each file in its own transaction + records it
-- in _migrations — no top-level BEGIN/COMMIT and no _migrations insert here.

CREATE TABLE saved_view (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  user_identity text NOT NULL,
  register      text NOT NULL,
  name          text NOT NULL,
  state         jsonb NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_view_lookup ON saved_view (tenant_id, user_identity, register, is_active);
CREATE UNIQUE INDEX saved_view_unique_name ON saved_view (tenant_id, user_identity, register, lower(name)) WHERE is_active;
CREATE TRIGGER saved_view_set_updated_at BEFORE UPDATE ON saved_view
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_view
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON saved_view TO c3_app;
REVOKE DELETE ON saved_view FROM c3_app;
GRANT SELECT ON saved_view TO c3_backup;
