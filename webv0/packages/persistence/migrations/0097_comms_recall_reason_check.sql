-- 0097 — Block 6 (R2-02): the tombstone's reason vocabulary, DB-enforced.
--
-- 0091 shipped comms_message_tombstone fully armored (append-only trigger,
-- forced RLS, tenant policy) but with reason_code as unchecked text — because
-- nothing had ever written it, no vocabulary was ever pinned. Block 6 makes
-- the table load-bearing with exactly two reason classes (the disposition's
-- item-5 distinction: author self-recall vs reasoned moderator removal), and
-- the moderator arm's note is mandatory AT THE DB, not just in the use-case —
-- a reasoned act stays reasoned even against a future writer that forgets.
--
-- The staging APPLY is the OWNER's, at the web+API deploy window.
ALTER TABLE comms_message_tombstone
  ADD CONSTRAINT comms_recall_reason_vocabulary
  CHECK (reason_code IN ('AuthorRecall', 'ModeratorRemoval'));
ALTER TABLE comms_message_tombstone
  ADD CONSTRAINT comms_moderator_removal_reasoned
  CHECK (reason_code <> 'ModeratorRemoval' OR (moderation_note IS NOT NULL AND length(trim(moderation_note)) > 0));
