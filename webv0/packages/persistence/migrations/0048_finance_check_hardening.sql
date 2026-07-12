-- 0048_finance_check_hardening.sql — HARDEN-3 Batch D (M-15 + M-05):
-- two DB-boundary money invariants the application must not be the only guard for.

-- ── M-15: income lines must carry a payment_status ──────────────────────────
-- The old shape CHECK's income branch was
--   (direction='Income' AND payment_status IN ('Expected','Invoiced','Received'))
-- For a NULL payment_status income row, `payment_status IN (...)` is NULL, so the
-- branch is NULL and the whole CHECK evaluates to NULL — which PASSES (a CHECK
-- only rejects FALSE). So a null-payment-status income row slipped in. Backfill
-- any stragglers, then require payment_status IS NOT NULL on the income branch.
UPDATE mission_line SET payment_status = 'Expected'
  WHERE direction = 'Income' AND payment_status IS NULL;

ALTER TABLE mission_line DROP CONSTRAINT mission_line_payment_shape;
ALTER TABLE mission_line ADD CONSTRAINT mission_line_payment_shape CHECK (
  (direction = 'Income' AND payment_status IS NOT NULL
     AND payment_status IN ('Expected','Invoiced','Received'))
  OR
  (direction = 'Expense' AND payment_status IS NULL
     AND received_amount_minor IS NULL AND received_usd_per_unit IS NULL
     AND payment_source_label IS NULL AND ref_no IS NULL)
);

-- ── M-05: a USD line's FX snapshot must be unity ────────────────────────────
-- USD is the pivot (rate 1). A USD income line that recorded received_usd_per_unit
-- ≠ 1 multiplies its reported USD income by that factor. Normalize any existing
-- offenders to 1, then forbid a non-unity snapshot on USD lines at the boundary.
UPDATE mission_line SET received_usd_per_unit = 1
  WHERE currency = 'USD' AND received_usd_per_unit IS NOT NULL AND received_usd_per_unit <> 1;

ALTER TABLE mission_line ADD CONSTRAINT mission_line_usd_snapshot_unity CHECK (
  currency <> 'USD' OR received_usd_per_unit IS NULL OR received_usd_per_unit = 1
);
