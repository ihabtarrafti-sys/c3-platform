-- 0059_exit_quiesce_lock — HARDEN-3.2 Batch A (R3-N02 / R2-N01).
--
-- The 0057 quiesce functions read the tenant state LOCK-FREE, so `Exiting` was not a
-- real barrier: a writer whose trigger fires while the committed snapshot still shows
-- `Active` reads `Active`, passes, and commits AFTER the `Exiting` transition — its bytes
-- then miss the enumeration that ran just after Phase-0 committed. (An earlier attempt to
-- add `FOR SHARE` to the *conditional* `WHERE … AND exit_state='Exiting'` read does NOT
-- fix it: while the tenant is Active that predicate matches NO row, so `FOR SHARE` locks
-- nothing and the trigger never waits on the transition. A locking clause also cannot sit
-- inside EXISTS().)
--
-- Fix: lock the tenant row UNCONDITIONALLY (`WHERE id = NEW.tenant_id` always matches),
-- THEN test the value. `FOR SHARE` now really takes a row lock, which CONFLICTS with the
-- `FOR NO KEY UPDATE` that Phase-0's `UPDATE tenant SET exit_state='Exiting'` holds — so
-- the two serialize: a racing writer either commits fully BEFORE `Exiting` (and is
-- therefore enumerated) or blocks, re-reads `Exiting`, and is refused. No middle state.
-- It must be FOR SHARE, not FOR KEY SHARE — FOR KEY SHARE does not conflict with
-- FOR NO KEY UPDATE and would not serialize.
CREATE OR REPLACE FUNCTION refuse_blob_write_during_exit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exit_state text;
BEGIN
  SELECT exit_state INTO v_exit_state FROM tenant WHERE id = NEW.tenant_id FOR SHARE;
  IF v_exit_state = 'Exiting' THEN
    RAISE EXCEPTION 'tenant is exiting — new object writes are refused (quiesced for erasure)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION refuse_photo_write_during_exit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exit_state text;
BEGIN
  -- Only a write that SETS a new photo key is a blob write; take the lock only then,
  -- so ordinary person edits are untouched.
  IF NEW.photo_storage_key IS NOT NULL
     AND NEW.photo_storage_key IS DISTINCT FROM OLD.photo_storage_key THEN
    SELECT exit_state INTO v_exit_state FROM tenant WHERE id = NEW.tenant_id FOR SHARE;
    IF v_exit_state = 'Exiting' THEN
      RAISE EXCEPTION 'tenant is exiting — photo writes are refused (quiesced for erasure)' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
