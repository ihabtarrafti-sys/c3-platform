-- 0063_distribution_share_pay_lock — HARDEN-3.2 Batch B (R3-N05).
--
-- The distribution head/share invariant (no Revoked head with Paid shares) was guarded on
-- both sides but LOCK-FREE, a classic TOCTOU:
--   * distribution_head_revoke_guard (0052) checks for Paid shares WITHOUT locking them;
--   * distribution_share_paid_guard (0034) checks the head status WITHOUT locking it.
-- Two transactions — one revoking the head, one paying a share — each read the other's
-- pre-change state and both commit, leaving a Revoked head with a Paid share.
--
-- Fix: a COMMON LOCK ANCHOR — the head row. The head-revoke path ALREADY holds the head's
-- row lock (its own UPDATE takes FOR NO KEY UPDATE before the BEFORE trigger fires). The
-- share-pay path must take the head FOR UPDATE before reading its status. FOR UPDATE
-- conflicts with the revoke's FOR NO KEY UPDATE, so the two serialize on the head:
--   * revoke commits first  → pay blocks, re-reads Revoked, refuses;
--   * pay commits first      → revoke blocks, its guard now sees the new Paid share, refuses.
-- No stale read survives. Only the share-pay guard changes; the trigger is unchanged.
CREATE OR REPLACE FUNCTION distribution_share_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_head_status text;
BEGIN
  IF NEW.payout_status = 'Paid' AND OLD.payout_status <> 'Paid' THEN
    SELECT d.status INTO v_head_status
      FROM distribution d
     WHERE d.tenant_id = NEW.tenant_id AND d.distribution_id = NEW.distribution_id
     FOR UPDATE;
    IF v_head_status IS DISTINCT FROM 'Live' THEN
      RAISE EXCEPTION 'C3E:CONFLICT: payouts can only be marked Paid under a LIVE distribution' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
