-- 0009_credentials.sql - Sprint 36: the Credentials domain.
--
-- A credential belongs to exactly one person (composite business-key FK) and
-- is created ONLY by executing an approved AddCredential request (the same
-- one-row-per-approval idempotency boundary as person). Dates are PLAIN date
-- columns - no timestamps, no timezone (the CP date-swap lesson); the
-- expiry-after-issue rule is enforced here as well as in the domain schema.
-- Data-plane table: RLS ENABLE + FORCE, same grants posture as person.

-- 1 - registry extensions.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential'));

ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember','AddCredential','DeactivateCredential'));

-- 2 - the credential table.
CREATE TABLE credential (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  credential_id           text NOT NULL,                 -- CRED-XXXX
  person_id               text NOT NULL,                 -- owning PER-XXXX
  credential_type         text NOT NULL,
  issuer                  text,
  issued_on               date NOT NULL,
  expires_on              date,                          -- NULL = non-expiring
  notes                   text,
  is_active               boolean NOT NULL DEFAULT true,
  -- The approval whose execution created this credential: at most one
  -- credential per approval (DB-level execute idempotency, as for person).
  created_by_approval_id  text NOT NULL,
  version                 integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, credential_id),
  UNIQUE (tenant_id, created_by_approval_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id),
  FOREIGN KEY (tenant_id, created_by_approval_id) REFERENCES approval (tenant_id, approval_id),
  CONSTRAINT credential_expiry_after_issue CHECK (expires_on IS NULL OR expires_on > issued_on)
);
CREATE INDEX credential_person_lookup ON credential (tenant_id, person_id);

CREATE TRIGGER credential_set_updated_at BEFORE UPDATE ON credential
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, so ENABLE + FORCE (owner cannot bypass).
ALTER TABLE credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credential
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: same posture as person (no DELETE, soft-deactivation only).
GRANT SELECT, INSERT, UPDATE ON credential TO c3_app;
REVOKE DELETE ON credential FROM c3_app;
GRANT SELECT ON credential TO c3_backup;
