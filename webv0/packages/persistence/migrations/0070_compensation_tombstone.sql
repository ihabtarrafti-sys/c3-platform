-- 0070_compensation_tombstone — HARDEN-3.3 Batch A (R4-N01, loud durable tombstones).
--
-- The API's compensation paths (a blob landed but the DB registration failed, or a
-- quarantine copy remained after a successful attach) deleted the object best-effort with a
-- SWALLOWED failure — a failed delete stranded the bytes with no record anywhere. Every such
-- site now records a durable 'compensation' tombstone FIRST (the M-02 wipe drain and the exit
-- sweep own the eventual removal), then best-effort-deletes. Admit the new reason.
ALTER TABLE blob_tombstone DROP CONSTRAINT blob_tombstone_reason_check;
ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_reason_check
  CHECK (reason IN ('exit', 'intake_reject', 'intake_refused', 'compensation'));
