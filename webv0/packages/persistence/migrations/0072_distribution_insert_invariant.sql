-- 0072_distribution_insert_invariant — HARDEN-3.4 Batch C (R5-N05).
--
-- The head-revoke (0052) and share-pay (0034→0066) guards were BEFORE **UPDATE** only, but
-- c3_app holds INSERT on both tables — so a Paid share can be INSERTED directly under a Revoked
-- head, or a Revoked head INSERTED over Paid shares, bypassing the invariant the UPDATE guards
-- protect. Extend BOTH guards to INSERT, and STOP the migration on any historical Revoked+Paid
-- pair from the 0063 lock-free window (detect, don't assume — mirrors 0065's operator-stop).

-- ── operator-stop: refuse enforcement over historical violations, with a repair diagnostic ──
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM distribution d
    JOIN distribution_share s
      ON s.tenant_id = d.tenant_id AND s.distribution_id = d.distribution_id
   WHERE d.status = 'Revoked' AND s.payout_status = 'Paid';
  IF bad > 0 THEN
    RAISE EXCEPTION 'R5-N05: % Revoked-head / Paid-share pair(s) exist (the 0063 lock-free window) — reverse those payouts (or re-Live the head) before this INSERT invariant can be enforced.', bad;
  END IF;
END $$;

-- ── share-pay guard now covers INSERT: a Paid share requires a LIVE head ────────────────────
CREATE OR REPLACE FUNCTION distribution_share_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_head_status text;
BEGIN
  IF NEW.payout_status = 'Paid' AND (TG_OP = 'INSERT' OR OLD.payout_status <> 'Paid') THEN
    -- R4-N05: WRITE the head (not just lock it) so revoke/pay write-conflict; on INSERT this
    -- also read-locks the head and returns its status. A missing OR non-Live head refuses.
    UPDATE distribution d
       SET updated_at = now()
     WHERE d.tenant_id = NEW.tenant_id AND d.distribution_id = NEW.distribution_id
     RETURNING d.status INTO v_head_status;
    IF v_head_status IS NULL OR v_head_status IS DISTINCT FROM 'Live' THEN
      RAISE EXCEPTION 'C3E:CONFLICT: payouts can only be marked Paid under a LIVE distribution' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS distribution_share_paid_guard ON distribution_share;
CREATE TRIGGER distribution_share_paid_guard BEFORE INSERT OR UPDATE ON distribution_share
  FOR EACH ROW EXECUTE FUNCTION distribution_share_paid_guard();

-- ── head-revoke guard now covers INSERT: a Revoked head must not coexist with a Paid share ──
CREATE OR REPLACE FUNCTION distribution_head_revoke_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Revoked' AND (TG_OP = 'INSERT' OR OLD.status = 'Live') THEN
    IF EXISTS (
      SELECT 1 FROM distribution_share s
       WHERE s.tenant_id = NEW.tenant_id AND s.distribution_id = NEW.distribution_id AND s.payout_status = 'Paid'
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: this distribution has PAID shares — it cannot be Revoked (reverse the payments first)' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS distribution_head_revoke_guard ON distribution;
CREATE TRIGGER distribution_head_revoke_guard BEFORE INSERT OR UPDATE ON distribution
  FOR EACH ROW EXECUTE FUNCTION distribution_head_revoke_guard();
