-- 0031_delegations.sql - Tier 0.5 approver delegation (2026-07-10): the owner
-- grants review+execute standing AS ONE UNIT to a named active member for a
-- bounded window. Direct-but-audited owner act (routing the grant through the
-- pipeline would wedge single-owner tenants); revocable at any moment; rows
-- are history and are never deleted. Separation of duties is NOT delegable -
-- the self-review guard runs on every decision path regardless of standing.

CREATE TABLE delegation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  delegation_id     text NOT NULL,               -- DLG-XXXX
  grantee_identity  text NOT NULL,               -- active member email
  granted_by        text NOT NULL,               -- the owner who granted
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  reason            text NOT NULL,               -- why (audit narrative)
  revoked_at        timestamptz,
  revoked_by        text,
  revoke_reason     text,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, delegation_id),
  CHECK (ends_on >= starts_on)
);
-- one unrevoked delegation per grantee (friendly 409 in the app layer)
CREATE UNIQUE INDEX delegation_one_unrevoked_per_grantee
  ON delegation (tenant_id, grantee_identity) WHERE revoked_at IS NULL;
CREATE INDEX delegation_active_lookup ON delegation (tenant_id, grantee_identity, starts_on, ends_on);
CREATE TRIGGER delegation_set_updated_at BEFORE UPDATE ON delegation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE delegation ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delegation
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON delegation TO c3_app;
REVOKE DELETE ON delegation FROM c3_app;
GRANT SELECT ON delegation TO c3_backup;

ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution','claim','delegation')
         OR kind LIKE 'invoice-series:%');
