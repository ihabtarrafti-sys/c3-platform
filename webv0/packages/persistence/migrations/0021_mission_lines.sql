-- 0021_mission_lines.sql - Finance Sprint 4 (2026-07-10): mission income/expense
-- lines — the P&L raw material. INCOME (prize money, org support, partnership
-- fees, ...) against EXPENSE (travel, hotels, ...), each in its NATIVE currency
-- (integer minor units, never floats). The P&L itself (per-currency subtotals,
-- per-diem roll-in, USD blend, profit) is a pure READ-SIDE derivation — nothing
-- computed is stored.
--
-- Direct-audited (the per-diem/mission-shell posture): lines RECORD operational
-- facts, unlike agreement terms which are commitments and therefore governed.
-- Direction is immutable (enforced in the use-case; remove + re-add to flip).
-- Removal is a soft is_active flip (no DELETE grant). RLS ENABLE+FORCE.

-- 1 - registry: allocate PNL-XXXX business ids.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','agreement','agreementTerm','entity'));

-- 2 - the mission_line table.
CREATE TABLE mission_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  line_id        text NOT NULL,                 -- PNL-XXXX
  mission_id     text NOT NULL,                 -- owning MSN-XXXX
  direction      text NOT NULL CHECK (direction IN ('Income','Expense')),
  label          text NOT NULL,                 -- "Prize — 2nd place", "Flights", ...
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       text NOT NULL CHECK (currency IN ('USD','AED','SAR','EUR','GBP')),
  is_active      boolean NOT NULL DEFAULT true, -- soft removal (no DELETE grant)
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, line_id),
  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id)
);
CREATE INDEX mission_line_mission_lookup ON mission_line (tenant_id, mission_id);

CREATE TRIGGER mission_line_set_updated_at BEFORE UPDATE ON mission_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE mission_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mission_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: same posture as the rest of the data plane (no DELETE — soft removal).
GRANT SELECT, INSERT, UPDATE ON mission_line TO c3_app;
REVOKE DELETE ON mission_line FROM c3_app;
GRANT SELECT ON mission_line TO c3_backup;
