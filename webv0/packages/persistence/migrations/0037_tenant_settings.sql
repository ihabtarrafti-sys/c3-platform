-- 0037_tenant_settings.sql — HARDEN-2: the tenant settings kernel + per-diem
-- presets (the homeless S2 rider comes home: the decisions register promised
-- editable presets — their real config: 65 SAR / 100 SAR / 25 USD — as
-- quick-picks in the per-diem dialog; the rider was cut "loudly → S9/Settings
-- pass" and both shipped without it).
--
-- One row per (tenant, key), value is JSONB, writes are direct-audited and
-- VERSION-GUARDED from birth (the M-03 law — no new last-write-wins cells).
-- Defaults live in CODE: an absent row means "the defaults", so the register
-- stays empty until an owner actually changes something.

CREATE TABLE tenant_setting (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  key        text NOT NULL,
  value      jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE TRIGGER tenant_setting_set_updated_at BEFORE UPDATE ON tenant_setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE tenant_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_setting
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- grants: no DELETE (clearing a setting = writing the defaults back).
GRANT SELECT, INSERT, UPDATE ON tenant_setting TO c3_app;
REVOKE DELETE ON tenant_setting FROM c3_app;
GRANT SELECT ON tenant_setting TO c3_backup;
