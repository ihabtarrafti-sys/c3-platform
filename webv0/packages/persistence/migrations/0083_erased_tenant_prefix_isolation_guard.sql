-- 0083_erased_tenant_prefix_isolation_guard.sql — HARDEN-3.8 H1.
--
-- The keyed 0082 serialization depends on READ COMMITTED taking a fresh
-- statement snapshot after a waiter acquires the advisory lock. Refuse the two
-- invariant-changing write shapes at other isolation levels instead of leaving
-- a privileged session able to select an older transaction snapshot.

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
      'C3E:ERASED_PREFIX_LIVE_TENANT: existing authority names a live tenant before isolation hardening'
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;

CREATE FUNCTION public.erased_tenant_prefix_write_is_read_committed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $isolation$
  SELECT pg_catalog.current_setting('transaction_isolation') = 'read committed'
$isolation$;

COMMENT ON FUNCTION public.erased_tenant_prefix_write_is_read_committed() IS
  'Boolean trigger primitive: dead-only authority writes are supported only at READ COMMITTED.';

CREATE OR REPLACE FUNCTION public.erased_tenant_prefix_dead_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard$
BEGIN
  IF NOT public.erased_tenant_prefix_write_is_read_committed() THEN
    RAISE EXCEPTION
      'C3E:ERASED_PREFIX_ISOLATION: authority writes require READ COMMITTED'
      USING ERRCODE = '23514';
  END IF;
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
  IF NOT public.erased_tenant_prefix_write_is_read_committed() THEN
    RAISE EXCEPTION
      'C3E:ERASED_PREFIX_ISOLATION: tenant identity writes require READ COMMITTED'
      USING ERRCODE = '23514';
  END IF;
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
