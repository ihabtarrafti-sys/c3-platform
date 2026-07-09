-- 0016_entities.sql - S48 (2026-07-10): the Entity domain — the tenant company's
-- own legal operating entities per jurisdiction (e.g. a UAE company, a KSA
-- company). Direct-audited CRUD (the mission-shell posture): RLS ENABLE+FORCE,
-- no DELETE for the app role (soft deactivation only). People and agreements
-- gain a NULLABLE entity reference (composite FK, tenant-scoped); existing rows
-- pre-date entities and stay null until assigned.

-- 1 - counter kind.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','agreement','entity'));

-- 2 - the entity table.
CREATE TABLE entity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  entity_id        text NOT NULL,                 -- ENT-XXXX
  name             text NOT NULL,
  jurisdiction     text NOT NULL,
  registration_id  text,
  is_active        boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_id)
);
CREATE TRIGGER entity_set_updated_at BEFORE UPDATE ON entity
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation + grants.
ALTER TABLE entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON entity TO c3_app;
REVOKE DELETE ON entity FROM c3_app;
GRANT SELECT ON entity TO c3_backup;

-- 4 - person "signed with" the entity (one primary, nullable).
ALTER TABLE person ADD COLUMN entity_id text;
ALTER TABLE person ADD CONSTRAINT person_entity_fk
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity (tenant_id, entity_id);
CREATE INDEX person_entity_lookup ON person (tenant_id, entity_id);

-- 5 - agreement "under" the entity (nullable; person still required this sprint).
ALTER TABLE agreement ADD COLUMN entity_id text;
ALTER TABLE agreement ADD CONSTRAINT agreement_entity_fk
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity (tenant_id, entity_id);
CREATE INDEX agreement_entity_lookup ON agreement (tenant_id, entity_id);
