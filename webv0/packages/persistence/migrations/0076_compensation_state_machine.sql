-- 0076_compensation_state_machine — HARDEN-3.5 B (R5-N04 + R6-N01 + R6-N08) + Design A's A-1
-- finalize interlock. The compensation record becomes a real state machine:
--
--     ∅ ──INSERT──> prepared ──(owner's failure path / TTL expiry)──> armed ──drain──> swept
--                      │                                                                (terminal)
--                      └──(owning-row tx commits)──> resolved (terminal)
--
--   * `prepared` (pre-registered BEFORE the PUT; the byte may not exist yet) is NOT drainable —
--     the drain consumes ONLY `armed`, killing both R6-N01 orderings by construction;
--   * `prepared` becomes `armed` via the owning request's failure path OR a TTL tied to the
--     request deadline (provably-dead requests);
--   * every transition is an UPDATE with a full prior-state predicate; the app enforces
--     rowCount === 1 (a zombie registration's prepared→resolved matching ZERO rows ABORTS its
--     transaction — never committed metadata over swept bytes);
--   * terminal rows carry deleted_at (B-2) so the bounded purge can reclaim them.

-- ── §0 the quarantine-cleanup reason ─────────────────────────────────────────────────────────
-- A quarantine byte has TWO compensation episodes: its upload intent (prepared → resolved at
-- the claim — the byte gained an owner) and, after a later attach copies it live, its cleanup
-- (the copy is redundant ⇒ delete). The unique key (tenant_ref, storage_key, reason) holds one
-- row per reason, so the second episode is its own reason — never a silent ON CONFLICT overlap
-- with the resolved upload row.
ALTER TABLE blob_tombstone DROP CONSTRAINT blob_tombstone_reason_check;
ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_reason_check
  CHECK (reason IN ('exit', 'intake_reject', 'intake_refused', 'compensation', 'quarantine_cleanup'));

-- ── §1 columns + backfill (legacy rows: pending ⇒ armed, resolved ⇒ swept) ──────────────────
ALTER TABLE blob_tombstone ADD COLUMN state text;
ALTER TABLE blob_tombstone ADD COLUMN prepared_expires_at timestamptz;
UPDATE blob_tombstone SET state = CASE WHEN deleted_at IS NULL THEN 'armed' ELSE 'swept' END;
ALTER TABLE blob_tombstone ALTER COLUMN state SET NOT NULL;
ALTER TABLE blob_tombstone ALTER COLUMN state SET DEFAULT 'armed';
ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_state_chk
  CHECK (state IN ('prepared', 'armed', 'resolved', 'swept'));
-- a prepared row must carry its expiry; a terminal row must carry its terminal timestamp (B-2).
ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_prepared_expiry_chk
  CHECK (state <> 'prepared' OR prepared_expires_at IS NOT NULL);
ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_terminal_stamp_chk
  CHECK (state IN ('prepared', 'armed') OR deleted_at IS NOT NULL);
CREATE INDEX blob_tombstone_armed ON blob_tombstone (tenant_ref) WHERE state = 'armed';
CREATE INDEX blob_tombstone_prepared_exp ON blob_tombstone (prepared_expires_at) WHERE state = 'prepared';

-- c3_app drives the machine through column-scoped UPDATE (0051's discipline, extended).
GRANT UPDATE (state) ON blob_tombstone TO c3_app;

-- ── §2 the 0051 immutability trigger, reconciled with the machine (B-2: explicit, not lucky) ─
-- Identity stays frozen; deleted_at stays monotonic; and STATE may only move along the
-- machine's edges — enforced for EVERY role (superuser/BYPASSRLS included).
CREATE OR REPLACE FUNCTION blob_tombstone_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_ref  IS DISTINCT FROM OLD.tenant_ref
  OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
  OR NEW.blob_class  IS DISTINCT FROM OLD.blob_class
  OR NEW.reason      IS DISTINCT FROM OLD.reason
  OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'blob_tombstone identity is immutable (tenant_ref/storage_key/blob_class/reason/created_at cannot change)'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'blob_tombstone.deleted_at is monotonic (a resolved erasure cannot be reopened or changed)'
      USING ERRCODE = '23514';
  END IF;
  -- The machine's edges (B): prepared→armed, prepared→resolved, armed→swept. Same-state
  -- updates (attempts/last_error bookkeeping) pass; everything else — including ANY move out
  -- of a terminal state — refuses.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'prepared' AND NEW.state IN ('armed', 'resolved'))
         OR (OLD.state = 'armed'    AND NEW.state = 'swept')) THEN
      RAISE EXCEPTION 'blob_tombstone: illegal state transition % → % (legal: prepared→armed, prepared→resolved, armed→swept)', OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── §3 Design A (A-1): the finalize interlock. tenant_ref has NO FK (0046 — the ledger must
-- survive erasure), so nothing serialized a compensation pre-register against finalize's
-- check-then-delete. This BEFORE INSERT trigger reads the tenant row FOR SHARE (SECURITY
-- DEFINER — c3_app has no tenant-table grants; the 0057 pattern): an in-flight pre-register
-- either commits BEFORE finalize's FOR UPDATE (whose unswept check then sees it and refuses)
-- or blocks and fails here when the tenant row is gone. Active/Exiting both pass — tombstones
-- MUST keep working during Exiting (0060's whole point). Existing rows are untouched.
CREATE OR REPLACE FUNCTION blob_tombstone_tenant_interlock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_state text;
BEGIN
  SELECT exit_state INTO v_state FROM public.tenant WHERE id = NEW.tenant_ref FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'blob_tombstone: tenant % no longer exists (exit finalized) — refusing a new tombstone/intent'
      , NEW.tenant_ref USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER blob_tombstone_tenant_interlock
  BEFORE INSERT ON blob_tombstone
  FOR EACH ROW EXECUTE FUNCTION blob_tombstone_tenant_interlock();

-- ── §4 the public-route definers (B-1: namespace INSIDE, 0067's discipline, path pinned) ────
-- Prepare ONE key (called before EACH per-file PUT — the minimal window; §8.3 as approved).
CREATE OR REPLACE FUNCTION intake_prepare_compensation(p_token_hash text, p_key text, p_ttl_ms integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_prefix text;
BEGIN
  IF p_ttl_ms IS NULL OR p_ttl_ms < 1000 OR p_ttl_ms > 14400000 THEN
    RAISE EXCEPTION 'intake_prepare_compensation: the prepared TTL must be 1000..14400000 ms (got %)', p_ttl_ms;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.intake_link WHERE token_hash = p_token_hash;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'intake_prepare_compensation: unknown token' USING ERRCODE = '42501';
  END IF;
  v_prefix := 'intake/' || v_tenant::text || '/';
  IF p_key IS NULL OR NOT starts_with(p_key, v_prefix) OR position('..' IN p_key) > 0 THEN
    RAISE EXCEPTION 'intake_prepare_compensation: key % is outside the token tenant''s intake namespace (%)', coalesce(p_key, '<null>'), v_prefix
      USING ERRCODE = '42501';
  END IF;
  -- NO ON CONFLICT: keys are fresh UUID paths; a duplicate is a bug and must surface.
  INSERT INTO public.blob_tombstone (tenant_ref, storage_key, blob_class, reason, state, prepared_expires_at)
  VALUES (v_tenant, p_key, 'intake', 'compensation', 'prepared', now() + make_interval(secs => p_ttl_ms / 1000.0));
END $$;
REVOKE ALL ON FUNCTION intake_prepare_compensation(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_prepare_compensation(text, text, integer) TO c3_app;

-- Arm the submission's prepared intents on a refused/failed submission (all-or-none namespace
-- discipline like 0067; returns the number ARMED — the caller enforces it equals its key count).
CREATE OR REPLACE FUNCTION intake_arm_compensation(p_token_hash text, p_keys text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_prefix text;
  v_key    text;
  v_n      integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.intake_link WHERE token_hash = p_token_hash;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'intake_arm_compensation: unknown token' USING ERRCODE = '42501';
  END IF;
  v_prefix := 'intake/' || v_tenant::text || '/';
  FOREACH v_key IN ARRAY p_keys LOOP
    IF v_key IS NULL OR NOT starts_with(v_key, v_prefix) OR position('..' IN v_key) > 0 THEN
      RAISE EXCEPTION 'intake_arm_compensation: key % is outside the token tenant''s intake namespace (%)', coalesce(v_key, '<null>'), v_prefix
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  UPDATE public.blob_tombstone
     SET state = 'armed'
   WHERE tenant_ref = v_tenant AND storage_key = ANY(p_keys)
     AND reason = 'compensation' AND state = 'prepared';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION intake_arm_compensation(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_arm_compensation(text, text[]) TO c3_app;

-- ── §5 bounded terminal-row retention (B §4; c3_app has no DELETE — this is the only door) ──
CREATE OR REPLACE FUNCTION blob_tombstone_purge_terminal(p_older_than_days integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 7 THEN
    RAISE EXCEPTION 'blob_tombstone_purge_terminal: retention must be ≥ 7 days (got %)', p_older_than_days;
  END IF;
  -- Tenant-scoped (the drain runs as c3_app inside a tenant context); ONLY terminal states.
  DELETE FROM public.blob_tombstone
   WHERE tenant_ref = public.current_tenant_id()
     AND state IN ('resolved', 'swept')
     AND deleted_at < now() - make_interval(days => p_older_than_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION blob_tombstone_purge_terminal(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION blob_tombstone_purge_terminal(integer) TO c3_app;
