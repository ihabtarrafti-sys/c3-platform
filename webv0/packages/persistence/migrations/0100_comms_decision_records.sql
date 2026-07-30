-- 0100 — Phase C: DECISION RECORDS (a message kind + the supersession pointer).
--
-- The program's own ruling-supersession law, productized inside the tool: a
-- ruling is captured WHERE it was made, and it names what it replaces. What a
-- decision supersedes is part of the decision, not a note beside it.
--
-- The spine stays INSERT-only (grants untouched): a message's kind is fixed at
-- post time and a supersession pointer is written once, never edited. Two
-- CHECKs carry the shape rather than trusting the writer:
--   · the kind vocabulary is closed;
--   · only a DECISION may supersede anything (a note that "replaces" a ruling
--     would be a ruling wearing a note's clothes).
--
-- ⚠️ The application adds two further guarantees the DB cannot see, and both
-- are RED-proven in commsDecisions.test.ts: the superseded message must live in
-- the SAME thread, and a RECALLED decision may not be superseded — an absence
-- is not a foundation.
--
-- 0099 (B-LIVE sound prefs) precedes this and is still awaiting the owner's
-- window; this number was re-derived at authoring rather than carried.
--
-- The staging APPLY is the OWNER's, at the next deploy window.
ALTER TABLE comms_message
  ADD COLUMN message_kind text NOT NULL DEFAULT 'note';
ALTER TABLE comms_message
  ADD CONSTRAINT comms_message_kind_vocabulary CHECK (message_kind IN ('note', 'decision'));
ALTER TABLE comms_message
  ADD COLUMN supersedes_message_id text;
ALTER TABLE comms_message
  ADD CONSTRAINT comms_message_supersedes_is_a_decision
  CHECK (supersedes_message_id IS NULL OR message_kind = 'decision');
