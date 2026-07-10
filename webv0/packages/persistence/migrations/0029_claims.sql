-- 0029_claims.sql - S9 expense claims (2026-07-10): the Finance Intelligence
-- Hub (MS Form -> Excel log -> hand-flipped Status cells) as a record with a
-- lifecycle: Submitted -> InReview -> Approved -> Paid, or Rejected with a
-- mandatory reason. Anyone except read-only roles submits (staff get money
-- back); deciding takes finance standing and NEVER the submitter (the
-- pipeline's separation law). Receipts are S4 documents owned by the claim.
-- Paid records a bank LABEL only - account numbers are never stored.

-- 1 - registry: allocate CLM-XXXX business ids.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution','claim')
         OR kind LIKE 'invoice-series:%');

-- 2 - the claim.
CREATE TABLE claim (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  claim_id             text NOT NULL,            -- CLM-XXXX
  submitted_by         text NOT NULL,            -- the identity who gets the money back
  person_id            text,                     -- optional: whose expense it concerns
  mission_id           text,                     -- optional context
  category             text NOT NULL,
  description          text NOT NULL,
  amount_minor         bigint  NOT NULL CHECK (amount_minor > 0),
  currency             text NOT NULL,
  expense_on           date NOT NULL,
  status               text NOT NULL DEFAULT 'Submitted'
                         CHECK (status IN ('Submitted','InReview','Approved','Rejected','Paid')),
  reviewed_by          text,
  rejection_reason     text,
  paid_on              date,
  payment_source_label text,                     -- bank LABEL only, never account numbers
  ref_no               text,
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, claim_id)
);
CREATE INDEX claim_submitter_lookup ON claim (tenant_id, submitted_by);
CREATE TRIGGER claim_set_updated_at BEFORE UPDATE ON claim
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON claim
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON claim TO c3_app;
REVOKE DELETE ON claim FROM c3_app;
GRANT SELECT ON claim TO c3_backup;

-- 3 - receipts: documents may be owned by claims.
ALTER TABLE document DROP CONSTRAINT document_owner_type_check;
ALTER TABLE document ADD CONSTRAINT document_owner_type_check
  CHECK (owner_type IN ('Agreement','Mission','Person','Credential','Entity','Invoice','Claim'));
