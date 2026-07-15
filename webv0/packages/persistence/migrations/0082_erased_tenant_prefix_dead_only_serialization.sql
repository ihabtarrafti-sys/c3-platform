-- 0082_erased_tenant_prefix_dead_only_serialization.sql — HARDEN-3.8 H1.
--
-- 0079 and 0081 guard both write directions at deferred COMMIT evaluation.
-- Serialize those opposite-side checks by tenant UUID so two concurrent
-- privileged transactions cannot each miss the other's uncommitted row.

CREATE OR REPLACE FUNCTION public.erased_tenant_prefix_dead_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.tenant_ref::text, 928340015)
  );
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

CREATE OR REPLACE FUNCTION public.erased_tenant_prefix_no_resurrection_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.id::text, 928340015)
  );
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
