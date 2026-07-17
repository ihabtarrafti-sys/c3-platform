-- 0085_erasure_audit_shape_two_valued.sql — Re-skin chapter rider R10-N03.
--
-- Round-10 §8 found two Class-B holes in the 0080 platform-audit surface:
--  (a) JSON-NULL hole: `after->>'trigger' IN (...)` is UNKNOWN when trigger is a
--      JSON null, and a CHECK constraint ACCEPTS an unknown (it only rejects
--      FALSE). So a shape like {"trigger": null, "stragglersCaught": 5} slipped
--      past the CHECK.
--  (b) Direct-insert bypass: the platform INSERT policy necessarily recognises
--      the gateway's function OWNER, so that privileged owner could INSERT an
--      otherwise-exact reserved row directly, bypassing the gateway's dead
--      authority / live-absence checks entirely.
--
-- Fix (a): rebuild the shape CHECK so it is explicitly TWO-VALUED — add a
-- jsonb_typeof='string' guard on trigger and wrap the whole predicate in `IS
-- TRUE`, so ANY unknown sub-expression becomes a rejection, not an acceptance.
-- Fix (b): a BEFORE INSERT trigger re-enforces the dead-authority/live-absence
-- invariant on EVERY reserved-action row, so even a direct privileged insert
-- must satisfy the same checks the gateway does. Requires no product route;
-- pure defense-in-depth. The erasure SAFETY invariant is unchanged.

-- ── (a) two-valued shape CHECK ──────────────────────────────────────────────
ALTER TABLE public.audit_event
  DROP CONSTRAINT audit_event_platform_erasure_shape_chk;

ALTER TABLE public.audit_event
  ADD CONSTRAINT audit_event_platform_erasure_shape_chk CHECK (
    (
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
        -- R10-N03(a): trigger must be a JSON STRING (a JSON null is typeof 'null',
        -- which fails this two-valued guard instead of yielding UNKNOWN below).
        AND jsonb_typeof(after -> 'trigger') = 'string'
        AND after ->> 'trigger' IN ('boot', 'interval', 'owner')
        AND jsonb_typeof(after -> 'stragglersCaught') = 'number'
        AND (after ->> 'stragglersCaught')::numeric > 0
        AND trunc((after ->> 'stragglersCaught')::numeric)
              = (after ->> 'stragglersCaught')::numeric
        AND (after ->> 'stragglersCaught')::numeric <= 9223372036854775807
      )
    ) IS TRUE   -- R10-N03(a): any UNKNOWN sub-expression becomes a rejection, never an acceptance.
  );

-- ── (b) authority trigger on every reserved-action insert ───────────────────
-- SECURITY DEFINER so it can read the platform authority/tenant tables
-- regardless of the inserting role (the 0057/0080 pattern). It fires for the
-- gateway's own insert too (which already satisfies it) and for any direct
-- privileged insert (which must now satisfy the same dead-only invariant).
CREATE FUNCTION public.audit_event_reserved_platform_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $auth$
BEGIN
  IF NEW.action = 'post_finalize_erasure_straggler_caught' THEN
    IF NEW.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION
        'C3E:INVALID_ERASURE_AUDIT: the reserved platform event must not carry a tenant_id'
        USING ERRCODE = '23514';
    END IF;
    -- entity_id is the dead tenant UUID (its shape is CHECK-validated). Compare
    -- as text to avoid a cast exception on a malformed value — a non-match then
    -- fails the authority check below, which is the correct rejection.
    IF NOT EXISTS (
      SELECT 1 FROM public.erased_tenant_prefix
       WHERE tenant_ref::text = NEW.entity_id
    ) THEN
      RAISE EXCEPTION
        'C3E:INVALID_ERASURE_AUDIT: reserved platform event requires an existing erased authority (%)',
        NEW.entity_id USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tenant
       WHERE id::text = NEW.entity_id
    ) THEN
      RAISE EXCEPTION
        'C3E:INVALID_ERASURE_AUDIT: reserved platform event references a still-live tenant (%)',
        NEW.entity_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$auth$;

CREATE TRIGGER audit_event_reserved_platform_authority
  BEFORE INSERT ON public.audit_event
  FOR EACH ROW EXECUTE FUNCTION public.audit_event_reserved_platform_authority();
