-- 0074_distribution_every_mutation_invariant — HARDEN-3.5 C2 (R6-N02 + R6-N06, closing R5-N05).
--
-- R6-N02: 0072's share guard fired only on INSERT or a non-Paid→Paid transition — an UPDATE that
-- KEPT payout_status='Paid' while CHANGING distribution_id (a reparent) revalidated nothing, so a
-- real c3_app transaction moved a Paid share under a Revoked head with balanced sums and committed
-- {Revoked, Paid} (Sentinel's round-6 probe). The share guard now fires on EVERY mutation whose
-- NEW row is Paid — whatever changed, a Paid share's CURRENT parent must be Live.
--
-- R6-N06: 0072 ran its historical scan and installed its triggers with NO write-blocking lock, so
-- concurrent DML could commit a violating row between the clean scan and trigger creation. This
-- migration's FIRST statement takes SHARE ROW EXCLUSIVE on both tables (blocks DML, allows reads;
-- held to the migration's COMMIT) — scan + install are one atomic window.
--
-- Guard bodies also schema-qualify their relations (public.*): trigger functions run as the
-- invoking role, and an unqualified name resolves pg_temp FIRST — 0071's discipline, applied here.

-- §lock — serialize the scan/install window against concurrent DML (released at COMMIT).
LOCK TABLE distribution, distribution_share IN SHARE ROW EXCLUSIVE MODE;

-- §scan — operator-stop: refuse enforcement over historical violations (0072's unlocked window
-- and R6-N02 reparents may have admitted pairs since 0072's scan ran).
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM public.distribution d
    JOIN public.distribution_share s
      ON s.tenant_id = d.tenant_id AND s.distribution_id = d.distribution_id
   WHERE d.status = 'Revoked' AND s.payout_status = 'Paid';
  IF bad > 0 THEN
    RAISE EXCEPTION 'R6-N02: % Revoked-head / Paid-share pair(s) exist — reverse those payouts (or re-Live the head) before the every-mutation invariant can be enforced.', bad;
  END IF;
END $$;

-- §install — the share guard fires on EVERY mutation whose NEW row is Paid.
CREATE OR REPLACE FUNCTION distribution_share_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_head_status text;
BEGIN
  -- R6-N02: no transition predicate — ANY insert/update that leaves the row Paid revalidates the
  -- row's CURRENT parent (a reparent changes distribution_id without touching payout_status).
  IF NEW.payout_status = 'Paid' THEN
    -- R4-N05: WRITE the head (not just lock it) so revoke/pay write-conflict; this also
    -- read-locks the head and returns its status. A missing OR non-Live head refuses.
    UPDATE public.distribution d
       SET updated_at = now()
     WHERE d.tenant_id = NEW.tenant_id AND d.distribution_id = NEW.distribution_id
     RETURNING d.status INTO v_head_status;
    IF v_head_status IS NULL OR v_head_status IS DISTINCT FROM 'Live' THEN
      RAISE EXCEPTION 'C3E:CONFLICT: payouts can only be marked (or remain) Paid under a LIVE distribution' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Head guard: predicate unchanged (0072); body re-issued only to schema-qualify its relations.
CREATE OR REPLACE FUNCTION distribution_head_revoke_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Revoked' AND (TG_OP = 'INSERT' OR OLD.status = 'Live') THEN
    IF EXISTS (
      SELECT 1 FROM public.distribution_share s
       WHERE s.tenant_id = NEW.tenant_id AND s.distribution_id = NEW.distribution_id AND s.payout_status = 'Paid'
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: this distribution has PAID shares — it cannot be Revoked (reverse the payments first)' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
