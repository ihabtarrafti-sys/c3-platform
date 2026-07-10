-- 0026_invoices.sql - S6 invoice generation (2026-07-10): the outward claim.
-- An invoice bills EXACTLY ONE mission income line, is issued by one of the
-- tenant's own legal entities, and carries the per-entity series number
-- {ENTITY.CODE}-INV-{YYYY}-{NNN}. Numbers are allocated race-safe per
-- (entity, year) and NEVER reused - a voided invoice keeps its number and the
-- gap is the audit trail (standard series accounting, the GK-Core model).
-- Issuing flips the line's payment status Expected -> Invoiced in the same
-- transaction; voiding (reason mandatory) flips it back unless already
-- Received. Direct-audited posture: the same standing as the S2 payment flip
-- this automates. The generated PDF is stored via the S4 document path under
-- a NEW 'Invoice' owner type whose read gate is canViewFinancials.

-- 1 - counter kinds: 'invoice' (internal INV-XXXX id) plus the per-entity,
--     per-year series counters ('invoice-series:ENT-XXXX:YYYY').
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice')
         OR kind LIKE 'invoice-series:%');

-- 2 - the invoice record.
CREATE TABLE invoice (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  invoice_id        text NOT NULL,                -- INV-XXXX (internal, uniform)
  invoice_number    text NOT NULL,                -- GKA-INV-2026-001 (outward series)
  entity_id         text NOT NULL,                -- issuing entity (ENT-XXXX)
  mission_id        text NOT NULL,                -- tournament context (MSN-XXXX)
  line_id           text NOT NULL,                -- the income line billed (PNL-XXXX)
  billed_to_name    text NOT NULL,                -- counterparty (organizer/publisher)
  billed_to_details text,                         -- address block, free text
  income_category   text NOT NULL,                -- snapshot from the line at issue
  description       text,
  currency          text NOT NULL,                -- the line's native currency
  subtotal_minor    bigint  NOT NULL CHECK (subtotal_minor > 0),
  vat_rate_bps      integer NOT NULL CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  vat_minor         bigint  NOT NULL CHECK (vat_minor >= 0),
  total_minor       bigint  NOT NULL CHECK (total_minor > 0),
  status            text NOT NULL CHECK (status IN ('Issued','Voided')),
  issued_on         date NOT NULL,
  issued_by         text NOT NULL,
  voided_reason     text,
  document_id       text,                         -- the stored PDF (DOC-XXXX), null until attached
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_id),
  UNIQUE (tenant_id, invoice_number)
);

-- One LIVE invoice per income line: double-billing is impossible; voiding
-- frees the line for a corrected re-issue (with a fresh number).
CREATE UNIQUE INDEX invoice_one_live_per_line ON invoice (tenant_id, line_id) WHERE status = 'Issued';
CREATE INDEX invoice_mission_lookup ON invoice (tenant_id, mission_id);

CREATE TRIGGER invoice_set_updated_at BEFORE UPDATE ON invoice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: no DELETE, ever (voided invoices are history, not garbage).
GRANT SELECT, INSERT, UPDATE ON invoice TO c3_app;
REVOKE DELETE ON invoice FROM c3_app;
GRANT SELECT ON invoice TO c3_backup;

-- 5 - the generated PDF is a document OWNED BY the invoice (its read gate is
--     the invoice's: canViewFinancials - stricter than the mission's).
ALTER TABLE document DROP CONSTRAINT document_owner_type_check;
ALTER TABLE document ADD CONSTRAINT document_owner_type_check
  CHECK (owner_type IN ('Agreement','Mission','Person','Credential','Entity','Invoice'));
