-- 0017_money_foundation.sql - Finance Sprint 1 (2026-07-10): the currency-aware
-- money foundation. Entities gain a local/base currency; the tenant maintains an
-- editable FX rate per currency (its value in USD, the pivot) from which every
-- cross-rate is derived. Money AMOUNTS themselves live on the domains that use
-- them (per-diem, agreement terms, mission P&L) in later sprints — this sprint
-- establishes the currency + rate substrate everything will stand on.

-- 1 - entity local currency (existing rows default to USD; new rows set it).
ALTER TABLE entity ADD COLUMN local_currency text NOT NULL DEFAULT 'USD';
ALTER TABLE entity ADD CONSTRAINT entity_local_currency_check
  CHECK (local_currency IN ('USD','AED','SAR','EUR','GBP'));

-- 2 - the tenant FX rate table (one editable rate per non-pivot currency).
--     usd_per_unit = value of 1 unit of `currency` in USD (numeric, exact).
CREATE TABLE fx_rate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  currency      text NOT NULL,
  usd_per_unit  numeric(18,8) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, currency),
  CHECK (currency IN ('AED','SAR','EUR','GBP')),   -- USD is the pivot (implicitly 1)
  CHECK (usd_per_unit > 0)
);
CREATE TRIGGER fx_rate_set_updated_at BEFORE UPDATE ON fx_rate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation + grants.
ALTER TABLE fx_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fx_rate
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON fx_rate TO c3_app;
REVOKE DELETE ON fx_rate FROM c3_app;
GRANT SELECT ON fx_rate TO c3_backup;
