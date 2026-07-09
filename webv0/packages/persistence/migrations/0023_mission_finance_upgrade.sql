-- 0023_mission_finance_upgrade.sql - S2 Mission Finance Upgrade (2026-07-10):
-- the sprint that makes C3 speak Geekay's tournament language (GK-Core
-- mastersheets + the frozen app's Mission Finance v1 design, merged).
--
--   1. Mission identity: TOURNAMENT CODE (the org's universal join key, e.g.
--      SATR/2024/0001 - unique per tenant when present), organizer, city.
--   2. Mission FINANCIAL LIFECYCLE: Planning -> FinancePending -> Confirmed ->
--      Active -> PostMission -> Settled (absorbs SP-era TD-26). Existing rows
--      backfill to 'Active' (they are operational reality); NEW missions are
--      born 'Planning'.
--   3. Line CATEGORIES from the merged taxonomy (per direction; 'PerDiem' is
--      engine-owned and never a manual line). Existing lines backfill 'Other'.
--   4. INCOME payment tracking: Expected -> Invoiced -> Received, with the
--      received amount, optional FX snapshot at receipt, bank/payment-source
--      LABEL (never account numbers), and the external bank reference.
--   5. mission_budget: planned amount per (direction, category, currency),
--      upsert-set like FX rates; the P&L derives budget-vs-actual.
--   6. Entity CODE rider (e.g. GKA, GKEC) - feeds per-entity invoice series.

-- 1 - mission identity + lifecycle.
ALTER TABLE mission ADD COLUMN code text;
ALTER TABLE mission ADD COLUMN organizer text;
ALTER TABLE mission ADD COLUMN city text;
CREATE UNIQUE INDEX mission_code_unique ON mission (tenant_id, code) WHERE code IS NOT NULL;

ALTER TABLE mission ADD COLUMN finance_stage text NOT NULL DEFAULT 'Active'
  CHECK (finance_stage IN ('Planning','FinancePending','Confirmed','Active','PostMission','Settled'));
-- Legacy rows keep 'Active' (filled by the ADD COLUMN default); new missions
-- are born Planning.
ALTER TABLE mission ALTER COLUMN finance_stage SET DEFAULT 'Planning';

-- 2 - line categories (backfill first, then constrain).
ALTER TABLE mission_line ADD COLUMN category text NOT NULL DEFAULT 'Other';
ALTER TABLE mission_line ADD CONSTRAINT mission_line_category_check CHECK (
  (direction = 'Income' AND category IN
     ('PrizeMoney','AppearanceFee','Support','Sponsorship','RevenueShare','Buyout','Campaign','TravelReimbursement','Other'))
  OR
  (direction = 'Expense' AND category IN
     ('RegistrationFee','Travel','Accommodation','PlayerFee','Equipment','Logistics','Contingency','Other'))
);

-- 3 - income payment tracking (backfill Expected on income, then constrain).
ALTER TABLE mission_line ADD COLUMN payment_status text;
ALTER TABLE mission_line ADD COLUMN received_amount_minor bigint;
ALTER TABLE mission_line ADD COLUMN received_usd_per_unit numeric(18,8);
ALTER TABLE mission_line ADD COLUMN payment_source_label text;
ALTER TABLE mission_line ADD COLUMN ref_no text;

UPDATE mission_line SET payment_status = 'Expected' WHERE direction = 'Income';

ALTER TABLE mission_line ADD CONSTRAINT mission_line_payment_shape CHECK (
  (direction = 'Income' AND payment_status IN ('Expected','Invoiced','Received'))
  OR
  (direction = 'Expense' AND payment_status IS NULL
     AND received_amount_minor IS NULL AND received_usd_per_unit IS NULL
     AND payment_source_label IS NULL AND ref_no IS NULL)
);
ALTER TABLE mission_line ADD CONSTRAINT mission_line_received_only CHECK (
  payment_status = 'Received' OR (received_amount_minor IS NULL AND received_usd_per_unit IS NULL)
);
ALTER TABLE mission_line ADD CONSTRAINT mission_line_received_positive CHECK (
  received_amount_minor IS NULL OR received_amount_minor > 0
);

-- 4 - budgets: one planned amount per (mission, direction, category, currency).
CREATE TABLE mission_budget (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  mission_id     text NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('Income','Expense')),
  category       text NOT NULL,
  currency       text NOT NULL CHECK (currency IN ('USD','AED','SAR','EUR','GBP')),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mission_id, direction, category, currency),
  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id),
  -- Budget categories: the line taxonomy per direction, PLUS the engine-owned
  -- PerDiem on the expense side (budget vs rolled-in actual).
  CONSTRAINT mission_budget_category_check CHECK (
    (direction = 'Income' AND category IN
       ('PrizeMoney','AppearanceFee','Support','Sponsorship','RevenueShare','Buyout','Campaign','TravelReimbursement','Other'))
    OR
    (direction = 'Expense' AND category IN
       ('RegistrationFee','Travel','Accommodation','PlayerFee','Equipment','Logistics','Contingency','Other','PerDiem'))
  )
);
CREATE INDEX mission_budget_mission_lookup ON mission_budget (tenant_id, mission_id);

CREATE TRIGGER mission_budget_set_updated_at BEFORE UPDATE ON mission_budget
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE mission_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_budget FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mission_budget
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Budgets are set/cleared (a cleared budget row is DELETED - it is planning
-- state, not audited history; the AUDIT EVENT of setting/clearing is the
-- history). DELETE is granted HERE ONLY for that reason.
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_budget TO c3_app;
GRANT SELECT ON mission_budget TO c3_backup;

-- 5 - entity code rider.
ALTER TABLE entity ADD COLUMN code text;
CREATE UNIQUE INDEX entity_code_unique ON entity (tenant_id, code) WHERE code IS NOT NULL;
