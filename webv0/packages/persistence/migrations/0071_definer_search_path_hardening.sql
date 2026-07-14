-- 0071_definer_search_path_hardening — HARDEN-3.4 Batch B (R5-N03, class-wide).
--
-- Every SECURITY DEFINER function carried `SET search_path = public`. PostgreSQL's own
-- documented rule: the temporary schema is searched FIRST for RELATIONS unless pg_temp is
-- EXPLICITLY placed last. So a restricted caller could `CREATE TEMPORARY TABLE intake_link
-- (…)` and have a definer resolve THEIR forged rows instead of the canonical table —
-- undermining token→tenant resolution inside the privileged boundary.
--
-- Kill the class, not the instance:
--   1. the three newest definer families (0067 tombstone gateway, 0068 claim, 0069 leases)
--      are re-created with `search_path = public, pg_temp` AND every relation
--      schema-qualified (belt + suspenders — qualification wins even if search_path drifts);
--   2. a catalog-driven sweep ALTERs EVERY SECURITY DEFINER function in `public` to
--      `SET search_path = public, pg_temp` — mechanical, signature-complete, nothing
--      hand-enumerated to go stale (0008/0034 member admin, 0040 peek/claim, 0050 provision
--      lock, 0057/0059 quiesce triggers, 0060/0067 tombstone, 0068 claim, 0069 leases);
--   3. the gate gains a pg_proc invariant test, so any FUTURE definer missing the trailing
--      pg_temp fails CI (see db.test.ts).

-- ── 1. re-create the new bodies, fully qualified ───────────────────────────────
CREATE OR REPLACE FUNCTION intake_tombstone_refused(p_token_hash text, p_keys text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_prefix text;
  v_key    text;
  v_n      integer := 0;
BEGIN
  SELECT il.tenant_id INTO v_tenant FROM public.intake_link il WHERE il.token_hash = p_token_hash;
  IF v_tenant IS NULL THEN
    RETURN 0; -- unknown token: nothing we can attribute
  END IF;
  v_prefix := 'intake/' || v_tenant::text || '/';
  FOREACH v_key IN ARRAY p_keys LOOP
    IF v_key IS NULL OR NOT starts_with(v_key, v_prefix) OR position('..' IN v_key) > 0 THEN
      RAISE EXCEPTION 'intake_tombstone_refused: key % is outside the token tenant''s intake namespace (%) — refusing a cross-tenant tombstone', coalesce(v_key, '<null>'), v_prefix
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.blob_tombstone (tenant_ref, storage_key, blob_class, reason)
    VALUES (v_tenant, v_key, 'intake', 'intake_refused')
    ON CONFLICT (tenant_ref, storage_key, reason) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION intake_claim(p_token_hash text)
RETURNS TABLE(link_id uuid, tenant_id uuid, kind text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.intake_link%ROWTYPE;
        v_tenant uuid;
BEGIN
  -- R4-N08: acquire the TENANT lock first (global order tenant → intake_link).
  SELECT il.tenant_id INTO v_tenant FROM public.intake_link il WHERE il.token_hash = p_token_hash;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.tenant t WHERE t.id = v_tenant FOR SHARE;

  SELECT * INTO r FROM public.intake_link WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.status <> 'Active' OR r.expires_at <= now() OR r.used_count >= r.max_uses THEN
    IF r.status = 'Active' AND r.expires_at <= now() THEN
      UPDATE public.intake_link SET status = 'Expired' WHERE id = r.id;
    END IF;
    RETURN;
  END IF;

  UPDATE public.intake_link
     SET used_count = used_count + 1,
         status = CASE WHEN used_count + 1 >= max_uses THEN 'Consumed' ELSE status END,
         consumed_at = CASE WHEN used_count + 1 >= max_uses THEN now() ELSE consumed_at END
   WHERE id = r.id;

  RETURN QUERY SELECT r.id, r.tenant_id, r.kind;
END $$;

CREATE OR REPLACE FUNCTION intake_lease_acquire(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_state  text;
  v_status text;
  v_id     uuid;
BEGIN
  SELECT il.tenant_id INTO v_tenant FROM public.intake_link il WHERE il.token_hash = p_token_hash;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT exit_state INTO v_state FROM public.tenant WHERE id = v_tenant FOR SHARE;
  IF v_state IS DISTINCT FROM 'Active' THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM public.intake_link WHERE token_hash = p_token_hash;
  IF v_status IS DISTINCT FROM 'Active' THEN RETURN NULL; END IF;
  INSERT INTO public.intake_upload_lease (tenant_id, token_hash) VALUES (v_tenant, p_token_hash) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION intake_lease_release(p_lease_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.intake_upload_lease WHERE id = p_lease_id;
$$;

-- CREATE OR REPLACE preserves grants; re-assert the intended posture anyway (idempotent).
REVOKE ALL ON FUNCTION intake_tombstone_refused(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION intake_claim(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION intake_lease_acquire(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION intake_lease_release(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_tombstone_refused(text, text[]) TO c3_app;
GRANT EXECUTE ON FUNCTION intake_claim(text) TO c3_app;
GRANT EXECUTE ON FUNCTION intake_lease_acquire(text) TO c3_app;
GRANT EXECUTE ON FUNCTION intake_lease_release(uuid) TO c3_app;

-- ── 2. the class sweep: EVERY public SECURITY DEFINER gets pg_temp LAST ────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.prosecdef
       AND p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;
