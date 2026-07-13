-- 0055_journey_dates_and_comment_immutability — HARDEN-3.1 Batch G (L-01 + L-03).

-- L-01: a journey cannot END before it STARTED. 0010 only coupled terminal status
-- to end-date PRESENCE; add the ordering invariant at the database.
ALTER TABLE journey ADD CONSTRAINT journey_ended_after_started
  CHECK (ended_on IS NULL OR ended_on >= started_on);

-- L-03: comment is APPEND-ONLY at the database for EVERY role. 0039 revoked
-- UPDATE/DELETE from c3_app, but relied on grants alone — a privileged role could
-- still tamper (UPDATE) or mass-destroy (TRUNCATE) the retained record. A trigger
-- refuses UPDATE and TRUNCATE outright (matching the audit/approval streams).
-- Single-row DELETE is left to the privileged exit ceremony (tenant erasure).
CREATE OR REPLACE FUNCTION comment_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'comment is append-only — % is not permitted (comments are a retained record)', TG_OP
    USING ERRCODE = '23514';
END $$;
CREATE TRIGGER comment_no_update BEFORE UPDATE ON comment
  FOR EACH ROW EXECUTE FUNCTION comment_append_only();
CREATE TRIGGER comment_no_truncate BEFORE TRUNCATE ON comment
  FOR EACH STATEMENT EXECUTE FUNCTION comment_append_only();
