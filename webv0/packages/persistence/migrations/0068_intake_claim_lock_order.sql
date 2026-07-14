-- 0068_intake_claim_lock_order — HARDEN-3.3 Batch A (R4-N08).
--
-- The claim path and the exit ceremony acquired the tenant and intake_link row locks in
-- OPPOSITE orders — a deadlock surface:
--   * claim: intake_claim locks the intake_link row (FOR UPDATE), then the follow-on document/
--     intake_submission INSERT fires the 0059 quiesce trigger, which locks the tenant row
--     (FOR SHARE) — so link → tenant;
--   * exit Phase-0: locks the tenant row (FOR NO KEY UPDATE via the Exiting UPDATE), then
--     revokes the links — so tenant → link.
-- Concurrent, they can each hold the other's next lock → 40P01 deadlock (one txn killed).
--
-- Fix: ONE global lock order — tenant BEFORE intake_link, on the claim path too. Read the
-- link's tenant WITHOUT a lock, take the tenant's FOR SHARE lock FIRST, THEN the link's
-- FOR UPDATE claim lock. The 0059 trigger's later FOR SHARE on the same tenant (same txn) is
-- then a no-op re-lock. Now both paths order tenant → link, so they serialize instead of
-- cycling: an exit holding the tenant blocks the claim at its first lock (which is refused
-- cleanly once Exiting), and a claim holding the tenant blocks the exit's Phase-0 briefly.
CREATE OR REPLACE FUNCTION intake_claim(p_token_hash text)
RETURNS TABLE(link_id uuid, tenant_id uuid, kind text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r intake_link%ROWTYPE;
        v_tenant uuid;
BEGIN
  -- R4-N08: acquire the TENANT lock first (global order tenant → intake_link).
  SELECT il.tenant_id INTO v_tenant FROM intake_link il WHERE il.token_hash = p_token_hash;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM tenant t WHERE t.id = v_tenant FOR SHARE;

  SELECT * INTO r FROM intake_link WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.status <> 'Active' OR r.expires_at <= now() OR r.used_count >= r.max_uses THEN
    IF r.status = 'Active' AND r.expires_at <= now() THEN
      UPDATE intake_link SET status = 'Expired' WHERE id = r.id;
    END IF;
    RETURN;
  END IF;

  UPDATE intake_link
     SET used_count = used_count + 1,
         status = CASE WHEN used_count + 1 >= max_uses THEN 'Consumed' ELSE status END,
         consumed_at = CASE WHEN used_count + 1 >= max_uses THEN now() ELSE consumed_at END
   WHERE id = r.id;

  RETURN QUERY SELECT r.id, r.tenant_id, r.kind;
END $$;

REVOKE ALL ON FUNCTION intake_claim(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_claim(text) TO c3_app;
