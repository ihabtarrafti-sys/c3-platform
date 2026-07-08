-- 0011_kit_apparel.sql - Sprint 38: the Kit and Apparel equipment domains.
--
-- Pure DIRECT-BUT-AUDITED CRUD (no approval coupling — note there is NO
-- created_by_approval_id here, unlike person/credential/journey). Items may
-- be assigned to a person (nullable composite business-key FK). Optimistic
-- version guard = the CP-era ETag/412 discipline. Data-plane posture: RLS
-- ENABLE + FORCE, no DELETE for the app role (soft deactivation only).

-- 1 - counter kinds.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel'));

-- 2 - the kit table.
CREATE TABLE kit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  kit_id              text NOT NULL,                 -- KIT-XXXX
  name                text NOT NULL,
  category            text NOT NULL,
  size                text,
  assigned_person_id  text,                          -- nullable PER-XXXX
  notes               text,
  is_active           boolean NOT NULL DEFAULT true,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kit_id),
  FOREIGN KEY (tenant_id, assigned_person_id) REFERENCES person (tenant_id, person_id)
);
CREATE INDEX kit_person_lookup ON kit (tenant_id, assigned_person_id);
CREATE TRIGGER kit_set_updated_at BEFORE UPDATE ON kit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - the apparel table (same shape, its own identity space).
CREATE TABLE apparel (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  apparel_id          text NOT NULL,                 -- APL-XXXX
  name                text NOT NULL,
  category            text NOT NULL,
  size                text,
  assigned_person_id  text,
  notes               text,
  is_active           boolean NOT NULL DEFAULT true,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, apparel_id),
  FOREIGN KEY (tenant_id, assigned_person_id) REFERENCES person (tenant_id, person_id)
);
CREATE INDEX apparel_person_lookup ON apparel (tenant_id, assigned_person_id);
CREATE TRIGGER apparel_set_updated_at BEFORE UPDATE ON apparel
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4 - tenant isolation + grants for both.
ALTER TABLE kit ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kit
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
ALTER TABLE apparel ENABLE ROW LEVEL SECURITY;
ALTER TABLE apparel FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON apparel
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON kit TO c3_app;
REVOKE DELETE ON kit FROM c3_app;
GRANT SELECT ON kit TO c3_backup;
GRANT SELECT, INSERT, UPDATE ON apparel TO c3_app;
REVOKE DELETE ON apparel FROM c3_app;
GRANT SELECT ON apparel TO c3_backup;
