-- 0049_settlement_race_guards.sql — HARDEN-3 Batch D (H-05 + H-04):
-- DB-boundary guards backing the application's mission-head lock order.

-- ── H-05: freeze payment_status + receipt FX while a Live distribution pays ──
-- The 0034 guard froze amount_minor / currency / received_amount_minor /
-- is_active on a line funding a Live distribution, but a distribution pays from
-- a RECEIVED source at a snapshot rate — so payment_status (un-receiving it) and
-- received_usd_per_unit (the receipt FX) must be frozen too, or the pool the
-- shares were computed from can move under a Live payout.
CREATE OR REPLACE FUNCTION mission_line_distribution_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.received_amount_minor IS DISTINCT FROM OLD.received_amount_minor
      OR NEW.received_usd_per_unit IS DISTINCT FROM OLD.received_usd_per_unit
      OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
      OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF EXISTS (
      SELECT 1 FROM distribution d
       WHERE d.tenant_id = NEW.tenant_id AND d.line_id = NEW.line_id AND d.status = 'Live'
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: this income line funds a LIVE distribution — revoke it before changing the money truth' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- (trigger distribution_share_paid_guard / mission_line_distribution_guard from
-- 0034 already bind these functions; CREATE OR REPLACE re-points the body.)

-- ── H-04: finance-child writes are refused under a Settled / inactive mission ─
-- Defense-in-depth beneath the application's mission-head FOR UPDATE lock: even
-- a raw write cannot add or change a line / budget / per-diem once the parent
-- mission is Settled (books closed) or inactive.
CREATE OR REPLACE FUNCTION mission_finance_child_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m RECORD;
BEGIN
  SELECT finance_stage, is_active INTO m
    FROM mission WHERE tenant_id = NEW.tenant_id AND mission_id = NEW.mission_id;
  IF m.finance_stage = 'Settled' OR m.is_active = false THEN
    RAISE EXCEPTION 'C3E:CONFLICT: the mission is settled or inactive — its money facts are frozen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mission_line_finance_guard BEFORE INSERT OR UPDATE ON mission_line
  FOR EACH ROW EXECUTE FUNCTION mission_finance_child_guard();
CREATE TRIGGER mission_budget_finance_guard BEFORE INSERT OR UPDATE ON mission_budget
  FOR EACH ROW EXECUTE FUNCTION mission_finance_child_guard();

-- Per-diem lives on mission_participant; guard ONLY a per-diem change (roster
-- membership itself is governed elsewhere and is not a money fact).
CREATE OR REPLACE FUNCTION mission_participant_perdiem_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m RECORD;
BEGIN
  IF (NEW.per_diem_amount_minor IS DISTINCT FROM OLD.per_diem_amount_minor
      OR NEW.per_diem_currency IS DISTINCT FROM OLD.per_diem_currency) THEN
    SELECT finance_stage, is_active INTO m
      FROM mission WHERE tenant_id = NEW.tenant_id AND mission_id = NEW.mission_id;
    IF m.finance_stage = 'Settled' OR m.is_active = false THEN
      RAISE EXCEPTION 'C3E:CONFLICT: the mission is settled or inactive — per-diem is frozen' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mission_participant_perdiem_guard BEFORE UPDATE ON mission_participant
  FOR EACH ROW EXECUTE FUNCTION mission_participant_perdiem_guard();
