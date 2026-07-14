-- 0075_intake_lease_ttl_bounds — HARDEN-3.5 D3 (R6-N07).
--
-- 0073 accepted ANY positive integer TTL: the int4 maximum parked a tenant's exit lease-drain
-- for ~24.8 days, versus the prior 15-minute ceiling, while the exit waits only 60 seconds per
-- attempt. The DB parameter now carries OPERATIONAL BOUNDS as a decision, not a discovery:
--
--   floor   1_000 ms (1 s)      — a sub-second lease cannot cover any real request;
--   ceiling 7_200_000 ms (2 h)  — the supported maximum; the app's boot algebra
--                                 (receive ≤ deadline, deadline×2 ≤ leaseTtl ≤ this cap)
--                                 independently keeps the actual production TTL far below it.
--
-- Out-of-range values RAISE at the function — the caller sees a loud error, never a lease whose
-- expiry the exit ceremony cannot practically outwait. Same definer discipline as 0073/0071.
CREATE OR REPLACE FUNCTION intake_lease_acquire(p_token_hash text, p_ttl_ms integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_state  text;
  v_status text;
  v_id     uuid;
BEGIN
  IF p_ttl_ms IS NULL OR p_ttl_ms < 1000 OR p_ttl_ms > 7200000 THEN
    RAISE EXCEPTION 'intake_lease_acquire: the TTL must be between 1000 ms (1s) and 7200000 ms (2h) — got % (R6-N07: an unbounded lease parks the exit drain)', p_ttl_ms;
  END IF;
  SELECT il.tenant_id INTO v_tenant FROM public.intake_link il WHERE il.token_hash = p_token_hash;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT exit_state INTO v_state FROM public.tenant WHERE id = v_tenant FOR SHARE;
  IF v_state IS DISTINCT FROM 'Active' THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM public.intake_link WHERE token_hash = p_token_hash;
  IF v_status IS DISTINCT FROM 'Active' THEN RETURN NULL; END IF;
  INSERT INTO public.intake_upload_lease (tenant_id, token_hash, expires_at)
  VALUES (v_tenant, p_token_hash, now() + make_interval(secs => p_ttl_ms / 1000.0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
