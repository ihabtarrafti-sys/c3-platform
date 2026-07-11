-- 0041_subscriptions.sql — Track B: recurring subscriptions (the org's
-- recurring costs — SaaS, infra, office). Direct-audited register (the
-- entity/mission-shell posture): RLS ENABLE+FORCE, no DELETE for the app role
-- (soft cancel only), version-guarded, audited in-transaction.
--
-- The vendor is a NAME in V1 (the plan's "small register"); this is the first
-- vendor-shaped domain, so it conceptually opens the S12 vendor beneficiary
-- seat, but the formal Vendor entity (VEN-XXXX) + vendor-beneficiary anchoring
-- is a follow-up. The next-renewal date feeds the ops calendar.
--
-- NOTE: the migration runner wraps each file in its own transaction and records
-- it in _migrations — no top-level BEGIN/COMMIT and no _migrations insert here
-- (the deploy paste, which runs raw psql, adds both).

-- 1 — counter kind.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution','claim','delegation','beneficiary','subscription')
         OR kind LIKE 'invoice-series:%');

-- 2 — the subscription table.
CREATE TABLE subscription (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  subscription_id  text NOT NULL,                 -- SUB-XXXX
  name             text NOT NULL,
  vendor_name      text NOT NULL,
  amount_minor     bigint NOT NULL CHECK (amount_minor >= 0),
  currency         text NOT NULL,
  cadence          text NOT NULL CHECK (cadence IN ('Weekly','Monthly','Quarterly','Annual')),
  category         text,
  status           text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Cancelled')),
  started_on       date NOT NULL,
  next_renewal_on  date,
  notes            text,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subscription_id)
);
CREATE INDEX subscription_lookup ON subscription (tenant_id, status, next_renewal_on);
CREATE TRIGGER subscription_set_updated_at BEFORE UPDATE ON subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 — tenant isolation + grants (direct-audited register).
ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON subscription TO c3_app;
REVOKE DELETE ON subscription FROM c3_app;
GRANT SELECT ON subscription TO c3_backup;
