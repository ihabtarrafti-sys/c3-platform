-- 0039_comments.sql — Track B4 (2026-07-11): contextual comments + @mentions.
--
-- A comment is a note attached to a record (a person, mission, agreement, or
-- approval) — the connective-tissue upgrade over plain notes: discussion and
-- clarification stay ON the record, in C3, instead of scattering to WhatsApp.
-- @mentions are stored as an explicit list (the composer picks members) and
-- fan out to the S10 notification bell.
--
-- Append-only by the same law as the event streams: no UPDATE/DELETE grant —
-- a comment is part of the record's history the moment it lands. (Editing /
-- soft-deleting a comment is a deliberate v2 with its own audit, not a quiet
-- rewrite.)

CREATE TABLE comment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  subject_type  text NOT NULL CHECK (subject_type IN ('Person','Mission','Agreement','Approval')),
  subject_id    text NOT NULL,
  author        text NOT NULL,
  body          text NOT NULL,
  -- The authoritative @mention list (member identities); the body is free text.
  mentions      text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_subject_lookup ON comment (tenant_id, subject_type, subject_id, created_at);

ALTER TABLE comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comment
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Append-only: insert + read, never mutate or destroy.
GRANT SELECT, INSERT ON comment TO c3_app;
REVOKE UPDATE, DELETE ON comment FROM c3_app;
GRANT SELECT ON comment TO c3_backup;
