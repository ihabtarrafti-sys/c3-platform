-- 0064_comment_delete_guard — HARDEN-3.2 Batch E (L-03 completion).
--
-- 0055 made comment append-only for UPDATE + TRUNCATE but left single-row DELETE
-- UNGUARDED — a privileged role could quietly destroy a retained comment, and the claimed
-- "the exit ceremony is the only exception" was not actually enforced. Add a DELETE guard;
-- the ONLY bypass is the exit ceremony, which DISABLES this trigger during erasure (exactly
-- how it handles the audit/approval append-only streams). truncateAll (tests) uses
-- session_replication_role = replica, which skips all triggers.
CREATE OR REPLACE FUNCTION comment_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'comment is append-only — DELETE is not permitted (a retained record; tenant erasure is the only exception)' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER comment_no_delete BEFORE DELETE ON comment
  FOR EACH ROW EXECUTE FUNCTION comment_no_delete();
