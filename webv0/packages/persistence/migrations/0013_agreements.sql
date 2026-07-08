-- 0013_agreements.sql - Sprint 41: the Agreements domain (contracts, NDAs,
-- addendums, MOUs - one governed lifecycle; the first domain BEYOND the CP).
--
-- The MATERIAL lifecycle is governed (AddAgreement / RenewAgreement /
-- TerminateAgreement ride the approval pipeline); non-material fields are
-- direct-but-audited. Money is integer US cents (bigint - never floats).
-- Dates are plain date columns (the Credentials discipline). Expired is
-- DERIVED read-side and never stored. linked_agreement_id makes an addendum
-- a first-class relationship to its parent agreement (self-FK).

-- 1 - registry extensions.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','agreement'));

ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant',
                            'AddAgreement','RenewAgreement','TerminateAgreement'));

-- 2 - the agreement table.
CREATE TABLE agreement (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  agreement_id            text NOT NULL,                 -- AGR-XXXX
  person_id               text NOT NULL,                 -- owning PER-XXXX
  agreement_code          text,                          -- optional human canonical code
  agreement_type          text NOT NULL,                 -- "Player Contract" / "NDA" / "Addendum" / ...
  linked_agreement_id     text,                          -- optional parent AGR-XXXX (addendum -> contract)
  starts_on               date NOT NULL,
  ends_on                 date NOT NULL,
  value_usd_cents         bigint,                        -- integer cents; null = not recorded (financial field)
  notes                   text,
  status                  text NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active','Terminated')),
  created_by_approval_id  text NOT NULL,
  version                 integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agreement_id),
  UNIQUE (tenant_id, created_by_approval_id),            -- execute idempotency boundary
  FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id),
  FOREIGN KEY (tenant_id, created_by_approval_id) REFERENCES approval (tenant_id, approval_id),
  FOREIGN KEY (tenant_id, linked_agreement_id) REFERENCES agreement (tenant_id, agreement_id),
  CONSTRAINT agreement_dates_coherent CHECK (ends_on >= starts_on),
  CONSTRAINT agreement_value_non_negative CHECK (value_usd_cents IS NULL OR value_usd_cents >= 0)
);
CREATE INDEX agreement_person_lookup ON agreement (tenant_id, person_id);
CREATE INDEX agreement_link_lookup ON agreement (tenant_id, linked_agreement_id);
-- The human canonical code is unique per tenant WHEN PRESENT.
CREATE UNIQUE INDEX agreement_code_unique ON agreement (tenant_id, agreement_code)
  WHERE agreement_code IS NOT NULL;

CREATE TRIGGER agreement_set_updated_at BEFORE UPDATE ON agreement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE agreement ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agreement
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: same posture as the rest of the data plane (no DELETE).
GRANT SELECT, INSERT, UPDATE ON agreement TO c3_app;
REVOKE DELETE ON agreement FROM c3_app;
GRANT SELECT ON agreement TO c3_backup;
