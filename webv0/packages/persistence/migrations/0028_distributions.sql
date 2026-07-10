-- 0028_distributions.sql - S8 prize distribution engine (2026-07-10): the
-- payout list GK-Core keeps by hand. A distribution allocates ONE Received
-- income line's landed money: org cut + per-person shares (largest-remainder
-- integer allocation - org cut + shares == pool EXACTLY, enforced by CHECK
-- at the row level and by the domain allocator). One LIVE distribution per
-- line; revoking (all payouts still pending) frees the line. Payouts flip
-- Pending <-> Paid with paidOn + payment-source LABEL (never account
-- numbers) + bank reference. Nothing is ever deleted.

-- 1 - registry: allocate DIST-XXXX business ids.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution')
         OR kind LIKE 'invoice-series:%');

-- 2 - the distribution head.
CREATE TABLE distribution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  distribution_id text NOT NULL,               -- DIST-XXXX
  mission_id      text NOT NULL,               -- MSN-XXXX
  line_id         text NOT NULL,               -- the Received income line (PNL-XXXX)
  pool_minor      bigint  NOT NULL CHECK (pool_minor > 0),
  currency        text NOT NULL,
  org_share_bps   integer NOT NULL CHECK (org_share_bps BETWEEN 0 AND 10000),
  org_cut_minor   bigint  NOT NULL CHECK (org_cut_minor >= 0),
  status          text NOT NULL CHECK (status IN ('Live','Revoked')),
  revoked_reason  text,
  notes           text,
  created_by      text NOT NULL,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, distribution_id)
);
CREATE UNIQUE INDEX distribution_one_live_per_line ON distribution (tenant_id, line_id) WHERE status = 'Live';
CREATE INDEX distribution_mission_lookup ON distribution (tenant_id, mission_id);
CREATE TRIGGER distribution_set_updated_at BEFORE UPDATE ON distribution
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON distribution
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON distribution TO c3_app;
REVOKE DELETE ON distribution FROM c3_app;
GRANT SELECT ON distribution TO c3_backup;

-- 3 - the payout rows.
CREATE TABLE distribution_share (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  distribution_id      text NOT NULL,          -- DIST-XXXX
  person_id            text NOT NULL,          -- PER-XXXX
  share_bps            integer NOT NULL CHECK (share_bps BETWEEN 1 AND 10000),
  amount_minor         bigint  NOT NULL CHECK (amount_minor >= 0),
  payout_status        text NOT NULL DEFAULT 'Pending' CHECK (payout_status IN ('Pending','Paid')),
  paid_on              date,
  payment_source_label text,                   -- bank LABEL only, never account numbers
  ref_no               text,
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, distribution_id, person_id)
);
CREATE INDEX distribution_share_person_lookup ON distribution_share (tenant_id, person_id);
CREATE TRIGGER distribution_share_set_updated_at BEFORE UPDATE ON distribution_share
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE distribution_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_share FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON distribution_share
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON distribution_share TO c3_app;
REVOKE DELETE ON distribution_share FROM c3_app;
GRANT SELECT ON distribution_share TO c3_backup;
