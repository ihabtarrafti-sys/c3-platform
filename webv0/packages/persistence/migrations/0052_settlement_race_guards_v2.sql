-- 0052_settlement_race_guards_v2 — HARDEN-3.1 Batch D (H-04 + H-05 + R2-N02).
--
-- Round 2 found the 0049 guards incomplete:
--   H-04   — mission_finance_child_guard read the parent mission UNLOCKED, so a
--            concurrent child write could observe pre-settlement state and commit
--            AFTER settlement; the line/budget triggers covered only INSERT/UPDATE
--            (a DELETE slipped past) and the per-diem trigger only UPDATE (a raw
--            per-diem INSERT slipped past).
--   H-05   — the required INVERSE distribution-head guard was never added: a Live
--            head could still be flipped to Revoked while Paid shares exist.
--   R2-N02 — a Settled mission's economically-relevant dates (starts_on/ends_on)
--            were still mutable, silently moving derived per-diem / P&L.

-- ── H-04: finance-child guard locks the parent head + covers DELETE + per-diem INSERT ──
CREATE OR REPLACE FUNCTION mission_finance_child_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE rec RECORD; m RECORD;
BEGIN
  rec := COALESCE(NEW, OLD); -- NEW on INSERT/UPDATE, OLD on DELETE
  -- Lock the parent mission head: serializes this child write against the
  -- settlement transaction (which takes the SAME row FOR UPDATE), closing the
  -- observe-pre-settlement / commit-post-settlement window.
  SELECT finance_stage, is_active INTO m
    FROM mission WHERE tenant_id = rec.tenant_id AND mission_id = rec.mission_id FOR UPDATE;
  IF m.finance_stage = 'Settled' OR m.is_active = false THEN
    RAISE EXCEPTION 'C3E:CONFLICT: the mission is settled or inactive — its money facts are frozen' USING ERRCODE = '23514';
  END IF;
  RETURN rec;
END $$;

DROP TRIGGER IF EXISTS mission_line_finance_guard ON mission_line;
DROP TRIGGER IF EXISTS mission_budget_finance_guard ON mission_budget;
CREATE TRIGGER mission_line_finance_guard BEFORE INSERT OR UPDATE OR DELETE ON mission_line
  FOR EACH ROW EXECUTE FUNCTION mission_finance_child_guard();
CREATE TRIGGER mission_budget_finance_guard BEFORE INSERT OR UPDATE OR DELETE ON mission_budget
  FOR EACH ROW EXECUTE FUNCTION mission_finance_child_guard();

CREATE OR REPLACE FUNCTION mission_participant_perdiem_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m RECORD;
BEGIN
  -- On INSERT any non-null per-diem is a money fact to guard; on UPDATE only a
  -- per-diem delta is (roster membership itself is governed elsewhere).
  IF (TG_OP = 'INSERT' AND (NEW.per_diem_amount_minor IS NOT NULL OR NEW.per_diem_currency IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.per_diem_amount_minor IS DISTINCT FROM OLD.per_diem_amount_minor
                               OR NEW.per_diem_currency IS DISTINCT FROM OLD.per_diem_currency)) THEN
    SELECT finance_stage, is_active INTO m
      FROM mission WHERE tenant_id = NEW.tenant_id AND mission_id = NEW.mission_id FOR UPDATE;
    IF m.finance_stage = 'Settled' OR m.is_active = false THEN
      RAISE EXCEPTION 'C3E:CONFLICT: the mission is settled or inactive — per-diem is frozen' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mission_participant_perdiem_guard ON mission_participant;
CREATE TRIGGER mission_participant_perdiem_guard BEFORE INSERT OR UPDATE ON mission_participant
  FOR EACH ROW EXECUTE FUNCTION mission_participant_perdiem_guard();

-- ── H-05: the INVERSE distribution-head guard ──────────────────────────────────
-- 0034's distribution_share_paid_guard blocks a share becoming Paid under a
-- non-Live head. The inverse was missing: a Live head must not be flipped to
-- Revoked (or inactivated) while Paid shares exist, or paid money loses its
-- authorizing head.
CREATE OR REPLACE FUNCTION distribution_head_revoke_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Live' AND (NEW.status IS DISTINCT FROM 'Live') THEN
    IF EXISTS (
      SELECT 1 FROM distribution_share s
       WHERE s.tenant_id = NEW.tenant_id AND s.distribution_id = NEW.distribution_id AND s.payout_status = 'Paid'
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: this distribution has PAID shares — it cannot leave Live (reverse the payments first)' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS distribution_head_revoke_guard ON distribution;
CREATE TRIGGER distribution_head_revoke_guard BEFORE UPDATE ON distribution
  FOR EACH ROW EXECUTE FUNCTION distribution_head_revoke_guard();

-- ── R2-N02: a Settled mission's economically-relevant dates are frozen ─────────
-- starts_on/ends_on drive per-diem day counts and P&L windows; freeze them once
-- the mission is Settled (a governed reopen is the path to change them).
CREATE OR REPLACE FUNCTION mission_settled_dates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finance_stage = 'Settled'
     AND (NEW.starts_on IS DISTINCT FROM OLD.starts_on OR NEW.ends_on IS DISTINCT FROM OLD.ends_on) THEN
    RAISE EXCEPTION 'C3E:CONFLICT: the mission is settled — its dates are frozen (they drive per-diem and P&L); reopen it to change them' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mission_settled_dates_guard ON mission;
CREATE TRIGGER mission_settled_dates_guard BEFORE UPDATE ON mission
  FOR EACH ROW EXECUTE FUNCTION mission_settled_dates_guard();
