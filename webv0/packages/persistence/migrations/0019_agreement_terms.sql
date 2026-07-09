-- 0019_agreement_terms.sql - Finance Sprint 3 (2026-07-10): the typed FINANCIAL
-- TERMS of an agreement. An agreement's money stops being a single headline
-- number and becomes a sub-collection of typed terms — a monthly Salary,
-- Performance bonuses, Milestone payments (amount + trigger), and Prize shares
-- (a percentage, personal and team). Direct-audited (the per-diem posture):
-- owner/operations write; the read is gated to canViewFinancials.
--
-- Two shapes, discriminated by kind: MONETARY (Salary/PerformanceBonus/
-- Milestone) carry amount_minor (integer minor units, > 0) + currency; PERCENT
-- (PrizeSharePersonal/PrizeShareTeam) carry percent_bps (1..10000 = 0.01%..100%,
-- never a float). A CHECK enforces the shape at the DB — the ultimate backstop
-- behind the domain's assertTermShape. RLS ENABLE+FORCE; no DELETE grant, so
-- removal is a soft is_active flip (the kit/apparel posture).
--
-- The legacy agreement.value_usd_cents column is LEFT IN PLACE (no destructive
-- migration on existing rows); it is superseded by these terms as the money
-- surface and is a candidate for later removal once terms fully carry the data.

-- 1 - registry: allocate TRM-XXXX business ids.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','agreement','agreementTerm','entity'));

-- 2 - the agreement_term table.
CREATE TABLE agreement_term (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  term_id        text NOT NULL,                 -- TRM-XXXX
  agreement_id   text NOT NULL,                 -- parent AGR-XXXX
  kind           text NOT NULL
                   CHECK (kind IN ('Salary','PerformanceBonus','Milestone','PrizeSharePersonal','PrizeShareTeam')),
  amount_minor   bigint,                        -- monetary kinds: integer minor units
  currency       text,                          -- monetary kinds: ISO-4217
  percent_bps    integer,                       -- percent kinds: 1..10000 basis points
  label          text,                          -- condition / trigger (required for Milestone)
  is_active      boolean NOT NULL DEFAULT true, -- soft removal (no DELETE grant)
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, term_id),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES agreement (tenant_id, agreement_id),
  CONSTRAINT agreement_term_currency_check
    CHECK (currency IS NULL OR currency IN ('USD','AED','SAR','EUR','GBP')),
  CONSTRAINT agreement_term_percent_range
    CHECK (percent_bps IS NULL OR (percent_bps > 0 AND percent_bps <= 10000)),
  CONSTRAINT agreement_term_amount_positive
    CHECK (amount_minor IS NULL OR amount_minor > 0),
  -- The per-kind shape: monetary kinds carry amount+currency and no percentage;
  -- percent kinds carry a percentage and no money.
  CONSTRAINT agreement_term_shape CHECK (
    (kind IN ('Salary','PerformanceBonus','Milestone')
       AND amount_minor IS NOT NULL AND currency IS NOT NULL AND percent_bps IS NULL)
    OR
    (kind IN ('PrizeSharePersonal','PrizeShareTeam')
       AND percent_bps IS NOT NULL AND amount_minor IS NULL AND currency IS NULL)
  )
);
CREATE INDEX agreement_term_agreement_lookup ON agreement_term (tenant_id, agreement_id);

CREATE TRIGGER agreement_term_set_updated_at BEFORE UPDATE ON agreement_term
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE agreement_term ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_term FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agreement_term
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: same posture as the rest of the data plane (no DELETE — soft removal).
GRANT SELECT, INSERT, UPDATE ON agreement_term TO c3_app;
REVOKE DELETE ON agreement_term FROM c3_app;
GRANT SELECT ON agreement_term TO c3_backup;
