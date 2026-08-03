-- 0103_erasure_trigger_platform_operator.sql — D-015 step 1.
--
-- Widen the post-finalize erasure TRIGGER vocabulary to admit
-- 'platform_operator', so the janitor route can later be reattributed from
-- tenant-owner standing to the platform capability
-- `platform.erasure_janitor.execute`.
--
-- ⛔ ADDITIVE ONLY, AND THAT IS A RULING (D-015 clause 1). 'boot', 'interval'
-- and 'owner' remain valid FOREVER: historical audit rows carry them, and a
-- vocabulary that replaced rather than widened would make the audit trail
-- unreadable backwards — the trail loses exactly the passes that predate the
-- change, which are the ones nobody can re-derive.
--
-- ⚖️ THIS MIGRATION RUNS BEFORE ANY REATTRIBUTION, ALSO BY RULING. The route
-- must not begin emitting a trigger value the database will reject: the sweep
-- DESTROYS BYTES and then writes its audit row, so a rejected write means the
-- destruction happened and the record of it did not.
--
-- ⛔ TWO LIVE SITES, AND FINDING THEM WAS THE WHOLE DIFFICULTY (LAW 23). The
-- vocabulary appears in FOUR migrations, and two of those appearances are DEAD:
--   · 0080:13/31 — the original CHECK, DROPPED and re-added by 0085 ⇒ dead
--   · 0080:43/59 — the original function, CREATE OR REPLACE'd by 0084 ⇒ dead
--   · 0085:26/48 — the LIVE constraint          ← widened below (a)
--   · 0084:17/33 — the LIVE function guard      ← widened below (b)
-- A list assembled by grepping the migrations directory named the two dead ones
-- and missed the live function. **A migrations directory is an append-only log
-- of intentions, not a description of the current schema** — the live answer
-- lives in `pg_constraint` and `pg_proc`, which is where `vocabularyDrift.test.ts`
-- now reads it from.
--
-- ⚠️ AND THE MISSED SITE IS THE DANGEROUS ONE. The CONSTRAINT decides whether the
-- audit ROW is acceptable; the FUNCTION decides whether the WRITE is attempted.
-- Widening only the constraint yields a janitor that completes its destructive
-- sweep and THEN fails to record it — which is strictly worse than refusing to
-- start, because the bytes are already gone.
--
-- ⛳ The TypeScript half (`ERASURE_JANITOR_TRIGGERS`) moves in the same commit;
-- `vocabularyDrift.test.ts` binds all three and fails if any one lags.

-- ── (a) the LIVE audit-shape CHECK — 0085's constraint, re-issued widened ────
-- Reproduced verbatim from 0085 except for the trigger IN-list: a CHECK cannot
-- be altered in place, so the whole predicate must be restated. Every other
-- clause below is unchanged, including the `IS TRUE` wrapper that turns any
-- UNKNOWN sub-expression into a rejection rather than an acceptance.
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
        -- D-015: widened. The three historical values are retained unchanged.
        AND after ->> 'trigger' IN ('boot', 'interval', 'owner', 'platform_operator')
        AND jsonb_typeof(after -> 'stragglersCaught') = 'number'
        AND (after ->> 'stragglersCaught')::numeric > 0
        AND trunc((after ->> 'stragglersCaught')::numeric)
              = (after ->> 'stragglersCaught')::numeric
        AND (after ->> 'stragglersCaught')::numeric <= 9223372036854775807
      )
    ) IS TRUE   -- R10-N03(a): any UNKNOWN sub-expression becomes a rejection, never an acceptance.
  );

-- ── (b) the LIVE gateway function — 0084's body, re-issued widened ───────────
-- ⛔ The signature is IDENTICAL to 0084's on purpose. `CREATE OR REPLACE` with a
-- DIFFERING argument list creates an OVERLOAD rather than replacing, leaving the
-- old body live and invisible to whoever last edited "the" function — which is
-- precisely how 0080's guard survived unnoticed until it was searched for.
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
  -- D-015: widened. The message names the full vocabulary so a rejection tells
  -- the operator what IS allowed, rather than only what was refused.
  IF p_trigger IS NULL
     OR p_trigger NOT IN ('boot', 'interval', 'owner', 'platform_operator') THEN
    RAISE EXCEPTION
      'C3E:INVALID_ERASURE_AUDIT: trigger must be boot, interval, owner, or platform_operator'
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
