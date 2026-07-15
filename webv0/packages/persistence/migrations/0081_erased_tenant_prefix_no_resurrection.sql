-- 0081_erased_tenant_prefix_no_resurrection.sql — HARDEN-3.8 H1 follow-up.
--
-- 0079 closes authority creation/retarget against an existing live tenant.
-- Complete the same dead-only invariant in the other direction: once permanent
-- erased-prefix authority exists, a privileged writer may not recreate a
-- tenant with that UUID and turn an authorized dead prefix live again.

LOCK TABLE public.tenant, public.erased_tenant_prefix
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tenant AS t
      JOIN public.erased_tenant_prefix AS e ON e.tenant_ref = t.id
  ) THEN
    RAISE EXCEPTION
      'C3E:ERASED_PREFIX_LIVE_TENANT: existing tenant resurrects permanent erased-prefix authority'
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;

CREATE FUNCTION public.erased_tenant_prefix_no_resurrection_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.erased_tenant_prefix AS e
     WHERE e.tenant_ref = NEW.id
  ) THEN
    RAISE EXCEPTION
      'C3E:ERASED_PREFIX_LIVE_TENANT: tenant % would resurrect an erased-prefix authority',
      NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;

CREATE CONSTRAINT TRIGGER tenant_no_erased_prefix_resurrection
  AFTER INSERT OR UPDATE OF id ON public.tenant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.erased_tenant_prefix_no_resurrection_guard();

REVOKE ALL ON FUNCTION public.erased_tenant_prefix_no_resurrection_guard() FROM PUBLIC;
