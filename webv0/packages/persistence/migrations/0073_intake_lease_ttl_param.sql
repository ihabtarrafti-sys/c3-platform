-- 0073_intake_lease_ttl_param — HARDEN-3.4 Batch A (R5-N01).
--
-- The lease TTL was a fixed 15-minute DB default, invisible to the API. R5-N01 makes the
-- lifetimes RELATE: the API sets Fastify requestTimeout AND the lease TTL, and refuses to boot
-- unless requestTimeout×2 ≤ leaseTtl (so an HTTP request can NEVER outlive its lease). For the
-- API to own the TTL, the acquire takes it as a parameter. search_path is pinned
-- `public, pg_temp` (R5-N03) since 0071's catalog sweep already ran.
DROP FUNCTION IF EXISTS intake_lease_acquire(text);
CREATE OR REPLACE FUNCTION intake_lease_acquire(p_token_hash text, p_ttl_ms integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_state  text;
  v_status text;
  v_id     uuid;
BEGIN
  IF p_ttl_ms IS NULL OR p_ttl_ms <= 0 THEN
    RAISE EXCEPTION 'intake_lease_acquire: a positive TTL is required (got %)', p_ttl_ms;
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

REVOKE ALL ON FUNCTION intake_lease_acquire(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_lease_acquire(text, integer) TO c3_app;
