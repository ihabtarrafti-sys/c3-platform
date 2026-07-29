-- 0098 — Phase B (activation): the participant discipline 0090 deferred.
--
-- 0090 shipped comms_thread_participant with grants only (no DELETE) and a
-- comment deferring enforcement "to the participant-management use-case".
-- Phase B built that use-case; this migration adds the DB-side belt the
-- schema always intended:
--
--   A DIRECT thread's seats are its pair, forever. A DM is defined by its
--   two members (direct_set_hash); un-seating either would orphan the
--   conversation's disclosure derivation. Room (standing) seats stay
--   application-managed — soft removal via removed_at IS their lifecycle,
--   and the same-tx ParticipantAdded/Removed thread events are the record
--   (the event-pairing gateway remains use-case-enforced by design; a
--   cross-table trigger would duplicate the application's tx without adding
--   a guarantee the grants don't already give).
--
-- The staging APPLY is the OWNER's, at the next deploy window.
CREATE OR REPLACE FUNCTION comms_direct_participant_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM comms_thread t
     WHERE t.tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
       AND t.thread_id = COALESCE(NEW.thread_id, OLD.thread_id)
       AND t.kind = 'direct'
  ) THEN
    RAISE EXCEPTION 'C3E:DIRECT_SEATS_IMMUTABLE: a direct thread''s participants are its pair — seats cannot change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER comms_direct_participant_immutable_guard
  BEFORE UPDATE OR DELETE ON comms_thread_participant
  FOR EACH ROW EXECUTE FUNCTION comms_direct_participant_immutable();
