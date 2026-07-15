-- 0079_erased_tenant_prefix_dead_only.sql — HARDEN-3.8 H1 / R9-N01.
--
-- 0078 made erased-prefix authority permanent and canonical, but its shape
-- checks did not prove that tenant_ref was actually dead. A privileged writer
-- could therefore arm the janitor against a live tenant. This deferred
-- final-state constraint closes that confused-deputy edge while preserving the
-- supported finalize transaction: finalize inserts authority first and deletes
-- tenant identity later in the SAME transaction.

LOCK TABLE public.tenant, public.erased_tenant_prefix
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.erased_tenant_prefix AS e
      JOIN public.tenant AS t ON t.id = e.tenant_ref
  ) THEN
    RAISE EXCEPTION
      'C3E:ERASED_PREFIX_LIVE_TENANT: existing erased-prefix authority names a live tenant'
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;

CREATE FUNCTION public.erased_tenant_prefix_dead_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard$
BEGIN
  -- Inspect the COMMIT-time state, not only NEW: a transient authority row that
  -- was deleted again is harmless, and multiple retargets are judged by their
  -- final stored state. Any committed authority/live-tenant join is refused.
  IF EXISTS (
    SELECT 1
      FROM public.erased_tenant_prefix AS e
      JOIN public.tenant AS t ON t.id = e.tenant_ref
     WHERE e.tenant_ref = NEW.tenant_ref
  ) THEN
    RAISE EXCEPTION
      'C3E:ERASED_PREFIX_LIVE_TENANT: authority for tenant % is not dead-only',
      NEW.tenant_ref
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;

CREATE CONSTRAINT TRIGGER erased_tenant_prefix_dead_only
  AFTER INSERT OR UPDATE OF tenant_ref ON public.erased_tenant_prefix
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.erased_tenant_prefix_dead_only_guard();

-- The function is a trigger primitive, not an application-callable gateway.
REVOKE ALL ON FUNCTION public.erased_tenant_prefix_dead_only_guard() FROM PUBLIC;
