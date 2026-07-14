-- 0067_intake_tombstone_key_guard — HARDEN-3.3 Batch A (R4-N03).
--
-- 0060's intake_tombstone_refused resolves the tenant from the token, then tombstones ANY
-- caller-supplied key under that tenant_ref. Because it is SECURITY DEFINER (runs as the
-- owner, bypassing FORCE RLS), a caller holding one valid tenant-A token could pass a
-- tenant-B key (or a document key) and have it recorded as a tenant-A tombstone — which the
-- exit sweep / drain then DELETES from R2. That is a cross-tenant delete via a valid token.
--
-- Fix: the definer must NOT trust caller keys. Validate every key is within the
-- token-resolved tenant's OWN intake namespace (intake/<tenant_id>/…, the exact shape the
-- public route stores under: app.ts `intake/${tenantId}/${submissionId}/${uploadId}`), and
-- reject path-traversal segments. Any key outside it RAISES and records nothing (all-or-none).
CREATE OR REPLACE FUNCTION intake_tombstone_refused(p_token_hash text, p_keys text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_prefix text;
  v_key    text;
  v_n      integer := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM intake_link WHERE token_hash = p_token_hash;
  IF v_tenant IS NULL THEN
    RETURN 0; -- unknown token: nothing we can attribute
  END IF;
  v_prefix := 'intake/' || v_tenant::text || '/';
  FOREACH v_key IN ARRAY p_keys LOOP
    IF v_key IS NULL OR NOT starts_with(v_key, v_prefix) OR position('..' IN v_key) > 0 THEN
      RAISE EXCEPTION 'intake_tombstone_refused: key % is outside the token tenant''s intake namespace (%) — refusing a cross-tenant tombstone', coalesce(v_key, '<null>'), v_prefix
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason)
    VALUES (v_tenant, v_key, 'intake', 'intake_refused')
    ON CONFLICT (tenant_ref, storage_key, reason) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION intake_tombstone_refused(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_tombstone_refused(text, text[]) TO c3_app;
