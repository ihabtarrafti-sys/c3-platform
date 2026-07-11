-- 0033_credentials_v2_beneficiaries.sql - S12 (2026-07-11).
--
-- 1) Staging ledger parity with the H-08 runner: the checksum column arrives
--    here for databases migrated by paste (the runner adds it idempotently on
--    programmatic runs; this makes both paths shape-identical).
ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text;

-- 2) Credentials v2: typed taxonomy + PII document number + issuing country.
--    Legacy rows keep their free-text credential_type as the display label
--    and default to kind='Other'.
ALTER TABLE credential
  ADD COLUMN kind text NOT NULL DEFAULT 'Other'
    CHECK (kind IN ('Passport','NationalID','Visa','License','Other')),
  ADD COLUMN document_number text,          -- PII tier: owner/ops/hr only
  ADD COLUMN issuing_country text;

-- 3) The three governed credential/beneficiary operations join the whitelist.
ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant',
                            'AddAgreement','RenewAgreement','TerminateAgreement',
                            'AddAgreementTerm','UpdateAgreementTerm','RemoveAgreementTerm',
                            'ImportBatch','UpdatePersonIdentity','DeactivatePerson','ReactivatePerson',
                            'UpdateCredentialFacts','AddBeneficiary','UpdateBeneficiary','RetireBeneficiary'));

-- 4) The beneficiary registry — payment-ROUTING names, never payment
--    credentials. THE STANDING LAW: no account numbers, no IBANs, ever.
CREATE TABLE beneficiary (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  beneficiary_id            text NOT NULL,            -- BEN-XXXX
  person_id                 text NOT NULL,            -- PER-XXXX (label-coupled, loose ref)
  label                     text NOT NULL,            -- the org's nickname ("ESA main")
  bank_name                 text NOT NULL,
  bank_country              text NOT NULL,
  currency                  text NOT NULL,
  payment_type              text,                     -- SWIFT / local / exchange-house — a label
  registered_with_entity_id text,                     -- ENT-XXXX whose bank holds the registration
  status                    text NOT NULL DEFAULT 'Draft'
                              CHECK (status IN ('Draft','Registered','Retired')),
  status_date               date,
  notes                     text,
  created_by_approval_id    text,
  version                   integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, beneficiary_id)
);
-- one live label per person (case-insensitive); Retired frees the name
CREATE UNIQUE INDEX beneficiary_live_label_per_person
  ON beneficiary (tenant_id, person_id, lower(label)) WHERE status <> 'Retired';
CREATE INDEX beneficiary_person_lookup ON beneficiary (tenant_id, person_id);
CREATE TRIGGER beneficiary_set_updated_at BEFORE UPDATE ON beneficiary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE beneficiary ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON beneficiary
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON beneficiary TO c3_app;
REVOKE DELETE ON beneficiary FROM c3_app;
GRANT SELECT ON beneficiary TO c3_backup;

ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution','claim','delegation','beneficiary')
         OR kind LIKE 'invoice-series:%');
