-- 0066_distribution_share_pay_head_write — HARDEN-3.3 Batch B (R4-N05 / R3-N05).
--
-- 0063 made the share-pay guard take the head FOR UPDATE, a COMMON LOCK ANCHOR against the
-- revoke path's own head write. That closes the race under READ COMMITTED, but FOR UPDATE is
-- a READ-lock: it creates no new head row version. So a REPEATABLE READ revoker whose UPDATE
-- of the head waits behind the payer's read-lock does NOT get a serialization failure when
-- released (the head was never modified) — and its guard, reading shares at the FROZEN
-- snapshot, never sees the freshly-Paid share. Result: Revoked head + Paid share commit.
--
-- Fix: the share-pay guard must WRITE the head, not merely lock it. Paying a share bumps the
-- head's updated_at, creating a new head row version. Now revoke and pay both WRITE the same
-- head row and truly conflict:
--   * REPEATABLE READ: the loser gets 40001 (could not serialize access due to concurrent
--     update) and rolls back — no stale-snapshot commit survives;
--   * READ COMMITTED: the second blocks, then re-reads the new head; its guard sees the
--     conflict (the revoke guard now sees the Paid share; the pay guard sees the Revoked head).
-- `updated_at` is bumped (NOT `version`) so the head's optimistic-concurrency token — which
-- the app's revoke uses as expectedVersion — is left untouched.
CREATE OR REPLACE FUNCTION distribution_share_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_head_status text;
BEGIN
  IF NEW.payout_status = 'Paid' AND OLD.payout_status <> 'Paid' THEN
    UPDATE distribution d
       SET updated_at = now()
     WHERE d.tenant_id = NEW.tenant_id AND d.distribution_id = NEW.distribution_id
     RETURNING d.status INTO v_head_status;
    IF v_head_status IS DISTINCT FROM 'Live' THEN
      RAISE EXCEPTION 'C3E:CONFLICT: payouts can only be marked Paid under a LIVE distribution' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
