-- 0080_platform_erasure_audit.sql — HARDEN-3.8 H5.
--
-- A post-finalize straggler is discovered only after its tenant row has been
-- erased, while audit_event was originally tenant-only (NOT NULL + FK + FORCE
-- RLS).  Preserve the FK for every ordinary event, but admit one tightly shaped
-- platform event whose NULL tenant_id lets it outlive tenant deletion.  The
-- fixed UUID/count/trigger payload contains no object key, prefix, or PII.

ALTER TABLE public.audit_event
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE public.audit_event
  ADD CONSTRAINT audit_event_platform_erasure_shape_chk CHECK (
    (
      tenant_id IS NOT NULL
      AND action <> 'post_finalize_erasure_straggler_caught'
    )
    OR
    (
      tenant_id IS NULL
      AND entity_type = 'platform'
      AND entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND action = 'post_finalize_erasure_straggler_caught'
      AND actor = 'c3-erasure-janitor'
      AND before IS NULL
      AND after IS NOT NULL
      AND jsonb_typeof(after) = 'object'
      AND after ? 'trigger'
      AND after ? 'stragglersCaught'
      AND after - 'trigger' - 'stragglersCaught' = '{}'::jsonb
      AND after ->> 'trigger' IN ('boot', 'interval', 'owner')
      AND jsonb_typeof(after -> 'stragglersCaught') = 'number'
      AND (after ->> 'stragglersCaught')::numeric > 0
      AND trunc((after ->> 'stragglersCaught')::numeric)
            = (after ->> 'stragglersCaught')::numeric
      AND (after ->> 'stragglersCaught')::numeric <= 9223372036854775807
    )
  );

COMMENT ON COLUMN public.audit_event.tenant_id IS
  'Tenant id for tenant-owned events; NULL only for the constrained permanent post-finalize erasure platform event.';

CREATE FUNCTION public.append_post_finalize_erasure_straggler_audit(
  p_tenant_ref uuid,
  p_stragglers_caught bigint,
  p_trigger text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $audit$
BEGIN
  IF p_stragglers_caught IS NULL OR p_stragglers_caught <= 0 THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: stragglers_caught must be positive'
      USING ERRCODE = '22023';
  END IF;
  IF p_trigger IS NULL OR p_trigger NOT IN ('boot', 'interval', 'owner') THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: trigger must be boot, interval, or owner'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.erased_tenant_prefix
     WHERE tenant_ref = p_tenant_ref
  ) THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: permanent authority is absent for tenant %',
      p_tenant_ref
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant WHERE id = p_tenant_ref) THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: tenant % is still live', p_tenant_ref
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.audit_event (
    tenant_id, entity_type, entity_id, action, actor, before, after
  ) VALUES (
    NULL,
    'platform',
    p_tenant_ref::text,
    'post_finalize_erasure_straggler_caught',
    'c3-erasure-janitor',
    NULL,
    jsonb_build_object(
      'trigger', p_trigger,
      'stragglersCaught', p_stragglers_caught
    )
  );
END
$audit$;

-- audit_event is FORCE RLS.  Its original tenant policy cannot admit a NULL
-- tenant_id, so add one platform INSERT policy.  It is usable only while the
-- narrow SECURITY DEFINER function is the current execution identity; a direct
-- c3_app INSERT cannot forge the same row even though c3_app has table INSERT.
CREATE POLICY audit_event_platform_erasure_insert
  ON public.audit_event
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    tenant_id IS NULL
    AND action = 'post_finalize_erasure_straggler_caught'
    AND current_user = pg_catalog.pg_get_userbyid((
      SELECT p.proowner
        FROM pg_catalog.pg_proc AS p
       WHERE p.oid =
         'public.append_post_finalize_erasure_straggler_audit(uuid,bigint,text)'::pg_catalog.regprocedure
    ))
  );

REVOKE ALL ON FUNCTION
  public.append_post_finalize_erasure_straggler_audit(uuid, bigint, text)
  FROM PUBLIC, c3_auth, c3_backup;
GRANT EXECUTE ON FUNCTION
  public.append_post_finalize_erasure_straggler_audit(uuid, bigint, text)
  TO c3_app;
