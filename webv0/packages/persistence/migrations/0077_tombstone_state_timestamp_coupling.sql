-- HARDEN-3.6 T3: live machine states and the terminal timestamp are one invariant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM blob_tombstone
              WHERE (state IN ('prepared', 'armed')) IS DISTINCT FROM (deleted_at IS NULL)) THEN
    RAISE EXCEPTION '0077 preflight: blob_tombstone contains state/deleted_at coupling violations';
  END IF;
END $$;

ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_state_timestamp_coupling_chk
  CHECK ((state IN ('prepared', 'armed')) = (deleted_at IS NULL));

CREATE OR REPLACE FUNCTION blob_tombstone_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_ref IS DISTINCT FROM OLD.tenant_ref OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
  OR NEW.blob_class IS DISTINCT FROM OLD.blob_class OR NEW.reason IS DISTINCT FROM OLD.reason
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'blob_tombstone identity is immutable (tenant_ref/storage_key/blob_class/reason/created_at cannot change)' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'blob_tombstone.deleted_at is monotonic (a resolved erasure cannot be reopened or changed)' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state = 'prepared' AND NEW.state IN ('armed', 'resolved'))
           OR (OLD.state = 'armed' AND NEW.state = 'swept')) THEN
    RAISE EXCEPTION 'blob_tombstone: illegal state transition % → %', OLD.state, NEW.state USING ERRCODE = '23514';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'blob_tombstone.deleted_at may change only with its legal state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
