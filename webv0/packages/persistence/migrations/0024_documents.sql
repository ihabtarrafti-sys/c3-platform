-- 0024_documents.sql - S4 Documents & files (2026-07-10): registered evidence.
-- C3 holds the METADATA; the bytes live in PRIVATE object storage (R2) under a
-- tenant-scoped, server-generated key. Nothing is public: every byte is served
-- through the API under the OWNING record's read gate. Direct-audited attach /
-- soft-remove (owner/operations); the audit lands on the OWNER record's trail.
-- Removal is a soft flip - bytes retained, unreachable via the API (the
-- no-DELETE data-plane law). A server-side SHA-256 is stored at attach time.

-- 1 - registry: allocate DOC-XXXX business ids.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity'));

-- 2 - the document metadata table.
CREATE TABLE document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  document_id   text NOT NULL,                 -- DOC-XXXX
  owner_type    text NOT NULL
                  CHECK (owner_type IN ('Agreement','Mission','Person','Credential','Entity')),
  owner_id      text NOT NULL,                 -- the owning record's business id
  file_name     text NOT NULL,                 -- original name (display only)
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  label         text,
  storage_key   text NOT NULL,                 -- tenant-scoped, server-generated
  uploaded_by   text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true, -- soft removal (no DELETE grant)
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_id),
  UNIQUE (tenant_id, storage_key)
);
CREATE INDEX document_owner_lookup ON document (tenant_id, owner_type, owner_id);

CREATE TRIGGER document_set_updated_at BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: same posture as the rest of the data plane (no DELETE).
GRANT SELECT, INSERT, UPDATE ON document TO c3_app;
REVOKE DELETE ON document FROM c3_app;
GRANT SELECT ON document TO c3_backup;
