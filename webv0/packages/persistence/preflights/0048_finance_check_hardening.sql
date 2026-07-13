-- PREFLIGHT for 0048_finance_check_hardening.sql — HARDEN-3.2 Batch D (R2-N04).
--
-- 0048:11-12 blindly flips every NULL-status income row to 'Expected'. A NULL-status
-- income row that carried receipt facts (received_amount_minor set) was LEGAL under 0047
-- (the mission_line_received_only CHECK evaluates to `NULL OR FALSE = NULL`, and a CHECK
-- only rejects FALSE). 0048's flip turns it into `'Received' OR FALSE = FALSE` → CHECK
-- VIOLATION → 0048 aborts the whole run. 0053 encodes the coherent repair, but it is
-- ordered AFTER 0048, so on a fresh replay it can never run (0048 already aborted).
--
-- A later migration cannot fix this by construction — the repair must run BEFORE 0048's
-- transaction. The runner executes this preflight inside 0048's own BEGIN/COMMIT,
-- immediately before 0048's SQL, and ONLY when 0048 is pending (a fresh replay / DR
-- rebuild / new environment). On the live DB 0048 is already ledgered, so this never
-- runs. It is IDENTICAL to 0053's R2-N04 repair by construction; 0053 remains the
-- go-forward assertion, this is what makes a from-0047 replay survive.
--
-- Idempotent + a no-op on coherent data (the WHERE matches only the pathological shape).

-- Cohere receipt-carrying income lines to 'Received' BEFORE 0048's NULL->'Expected'.
UPDATE mission_line SET payment_status = 'Received'
  WHERE direction = 'Income'
    AND received_amount_minor IS NOT NULL
    AND payment_status IS DISTINCT FROM 'Received';

DO $$
DECLARE bad integer;
BEGIN
  -- An FX snapshot with no received amount is incoherent beyond the simple repair —
  -- surface it loudly (identical guard to 0053) rather than let 0048 abort cryptically.
  SELECT count(*) INTO bad FROM mission_line
   WHERE direction = 'Income' AND received_usd_per_unit IS NOT NULL AND received_amount_minor IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'preflight 0048: % income line(s) carry a received FX snapshot with no received amount — manual repair required before this migration', bad;
  END IF;
END $$;
