-- 0084_erasure_straggler_count_via_gateway.sql — Re-skin chapter rider R10-N02.
--
-- Round-10 §4.3/§8: c3_app held BOTH direct UPDATE(straggler_count) on
-- erased_tenant_prefix (0078:46-47) AND EXECUTE on the audit gateway, so the app
-- principal could inflate the straggler COUNTER independently of any audit event,
-- and could mint a count/event pair decoupled from each other. Fold the counter
-- increment INTO the SECURITY DEFINER gateway so ONE least-privileged transition
-- owns count + event atomically (the increment now runs as the function OWNER,
-- not c3_app), and REVOKE c3_app's direct straggler_count write. The remaining
-- capability — an app principal calling the gateway for a real DEAD tenant — is
-- the irreducible "app-reported discovery" residual (RR-01), gated by the same
-- dead-authority/live-absence checks and now inseparable from its counter.
--
-- Safety invariant is untouched: dead-only authority (0079/0081/0083), the
-- append-only/no-PII audit shape (0080), and the finalize path are all unchanged.

CREATE OR REPLACE FUNCTION public.append_post_finalize_erasure_straggler_audit(
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
  IF EXISTS (SELECT 1 FROM public.tenant WHERE id = p_tenant_ref) THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: tenant % is still live', p_tenant_ref
      USING ERRCODE = '23514';
  END IF;

  -- R10-N02: the counter and its audit event are now ONE transition. The
  -- authority-existence check is the UPDATE itself — a missing row updates zero
  -- rows and RAISEs, so a caller can never mint an event for an absent authority.
  UPDATE public.erased_tenant_prefix
     SET straggler_count = straggler_count + p_stragglers_caught
   WHERE tenant_ref = p_tenant_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: permanent authority is absent for tenant %',
      p_tenant_ref
      USING ERRCODE = '23503';
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

-- R10-N02: c3_app may no longer write the straggler COUNTER directly — only the
-- gateway (running as its owner) may. Benign pass telemetry stays app-writable.
REVOKE UPDATE (straggler_count) ON public.erased_tenant_prefix FROM c3_app;
