-- 0056_tenant_exit_state — HARDEN-3.1 Batch C (R2-N01 + H-07).
--
-- The durable anchor for a QUIESCED, RESUMABLE tenant exit. `Exiting` is
-- committed BEFORE enumeration so it survives a crash (resume-by-UUID) and so
-- object writers can refuse to write for a tenant that is leaving. The tenant
-- identity row itself is removed only at FINALIZE — after the R2 sweep has
-- verified zero remaining bytes — so `Exiting` is the state the ceremony lives
-- in between "data deleted" and "identity removed". Per-object resume progress
-- lives in blob_tombstone (0046); this column is the tenant-level anchor.
ALTER TABLE tenant ADD COLUMN exit_state text NOT NULL DEFAULT 'Active'
  CHECK (exit_state IN ('Active', 'Exiting'));

-- Fast lookup of tenants mid-exit (for resume + the writer quiesce check).
CREATE INDEX tenant_exiting ON tenant (id) WHERE exit_state = 'Exiting';

-- R2-N01: QUIESCE object writers at the database. Once a tenant is Exiting, no new
-- blob-referencing row may be created — the ceremony has already enumerated the
-- universe, so a new document / photo / intake upload would be a byte the sweep
-- could strand. A refused DB claim also means the app never persists a reference
-- to bytes it may have started uploading; any such orphan is caught by the exit
-- sweep's prefix listing. (DELETE is unaffected — the ceremony itself deletes.)
CREATE OR REPLACE FUNCTION refuse_blob_write_during_exit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant WHERE id = NEW.tenant_id AND exit_state = 'Exiting') THEN
    RAISE EXCEPTION 'tenant is exiting — new object writes are refused (quiesced for erasure)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_exit_quiesce BEFORE INSERT ON document
  FOR EACH ROW EXECUTE FUNCTION refuse_blob_write_during_exit();
CREATE TRIGGER intake_submission_exit_quiesce BEFORE INSERT OR UPDATE ON intake_submission
  FOR EACH ROW EXECUTE FUNCTION refuse_blob_write_during_exit();

-- Person: refuse ONLY a write that SETS a new photo storage key while exiting
-- (ordinary person edits are untouched — the exit's own deletes still run).
CREATE OR REPLACE FUNCTION refuse_photo_write_during_exit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.photo_storage_key IS NOT NULL
     AND NEW.photo_storage_key IS DISTINCT FROM OLD.photo_storage_key
     AND EXISTS (SELECT 1 FROM tenant WHERE id = NEW.tenant_id AND exit_state = 'Exiting') THEN
    RAISE EXCEPTION 'tenant is exiting — photo writes are refused (quiesced for erasure)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_photo_exit_quiesce BEFORE INSERT OR UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION refuse_photo_write_during_exit();
