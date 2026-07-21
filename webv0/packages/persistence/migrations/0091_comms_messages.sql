-- 0091_comms_messages.sql — the Comms message family (Comms build Phase 2,
-- Temper's spine §6.3). Messages + their EVENT-SOURCED history: edits are new
-- revision rows (never in-place mutation), deletes are tombstones, reactions are
-- add/remove events. UUID-keyed throughout (the binding graft: app_user.id, not
-- email). Composite tenant FKs (§6.1): every internal FK carries tenant_id.
--
-- Ships DORMANT: no message is created yet; runtime enforcement (business-id
-- allocation, the retention-required-for-direct rule, moderation-note rules,
-- reaction-emoji allowlist) lands with the message use-cases. This migration
-- only opens the schema. The runner wraps this file in its own transaction.
--
-- Exit-ranks (all below comms_thread=30): message=20; its children (revision,
-- tombstone, reaction, document_attachment)=15; revision's children (mention,
-- object_link)=13; retention_tombstone=14 (no message FK — it OUTLIVES the DM).

-- ── comms_message ── immutable; edits→revisions, deletes→tombstones ───────────
CREATE TABLE comms_message (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  message_id        text NOT NULL,                                    -- MSG-#### business id
  thread_id         text NOT NULL,
  seq               bigint NOT NULL,                                  -- per-thread gapless sequence
  author_user_id    uuid NOT NULL,
  author_label      text,
  client_mutation_id uuid NOT NULL,                                   -- send idempotency
  retention_due_at  timestamptz,                                      -- set for direct-thread messages (runtime)
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id),
  UNIQUE (tenant_id, thread_id, seq),
  UNIQUE (tenant_id, author_user_id, client_mutation_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES comms_thread (tenant_id, thread_id)
);
CREATE INDEX comms_message_page ON comms_message (tenant_id, thread_id, seq DESC, message_id);
ALTER TABLE comms_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_message FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_message
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- Immutable: INSERT-only (no in-place edit; edits are revisions, deletes are tombstones).
GRANT SELECT, INSERT ON comms_message TO c3_app;
REVOKE UPDATE, DELETE ON comms_message FROM c3_app;
GRANT SELECT ON comms_message TO c3_backup;

-- ── comms_message_revision ── append-only visible edit history ───────────────
CREATE TABLE comms_message_revision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  message_id     text NOT NULL,
  revision_no    integer NOT NULL CHECK (revision_no > 0),
  body           text NOT NULL,
  editor_user_id uuid NOT NULL,
  editor_label   text,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id, revision_no),
  UNIQUE (tenant_id, id),                                             -- for mention/object_link composite FK
  FOREIGN KEY (tenant_id, message_id) REFERENCES comms_message (tenant_id, message_id)
);
CREATE INDEX comms_message_revision_latest ON comms_message_revision (tenant_id, message_id, revision_no DESC);
CREATE TRIGGER comms_message_revision_append_only BEFORE UPDATE OR DELETE ON comms_message_revision
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_message_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_message_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_message_revision
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_message_revision TO c3_app;
REVOKE UPDATE, DELETE ON comms_message_revision FROM c3_app;
GRANT SELECT ON comms_message_revision TO c3_backup;

-- ── comms_message_tombstone ── append-only removal record ────────────────────
CREATE TABLE comms_message_tombstone (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  message_id      text NOT NULL,
  actor_user_id   uuid NOT NULL,
  actor_label     text,
  reason_code     text NOT NULL,
  moderation_note text,                                              -- mandatory when applicable (runtime)
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES comms_message (tenant_id, message_id)
);
CREATE TRIGGER comms_message_tombstone_append_only BEFORE UPDATE OR DELETE ON comms_message_tombstone
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_message_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_message_tombstone FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_message_tombstone
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_message_tombstone TO c3_app;
REVOKE UPDATE, DELETE ON comms_message_tombstone FROM c3_app;
GRANT SELECT ON comms_message_tombstone TO c3_backup;

-- ── comms_reaction_event ── add/remove events, folded at read ────────────────
CREATE TABLE comms_reaction_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  message_id         text NOT NULL,
  user_id            uuid NOT NULL,
  emoji              text NOT NULL CHECK (char_length(emoji) <= 16), -- allowlist enforced at the use-case
  operation          text NOT NULL CHECK (operation IN ('add','remove')),
  client_mutation_id uuid NOT NULL,
  at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, client_mutation_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES comms_message (tenant_id, message_id)
);
CREATE INDEX comms_reaction_event_fold ON comms_reaction_event (tenant_id, message_id, emoji, user_id, at DESC, id);
ALTER TABLE comms_reaction_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_reaction_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_reaction_event
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_reaction_event TO c3_app;
REVOKE UPDATE, DELETE ON comms_reaction_event FROM c3_app;
GRANT SELECT ON comms_reaction_event TO c3_backup;

-- ── comms_mention ── a revision mentioned a user (Hearth-ready signal) ────────
CREATE TABLE comms_mention (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  revision_id    uuid NOT NULL,
  target_user_id uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, revision_id, target_user_id),
  FOREIGN KEY (tenant_id, revision_id) REFERENCES comms_message_revision (tenant_id, id)
);
CREATE INDEX comms_mention_signal ON comms_mention (tenant_id, target_user_id, created_at DESC, id);
ALTER TABLE comms_mention ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_mention FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_mention
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_mention TO c3_app;
REVOKE UPDATE, DELETE ON comms_mention FROM c3_app;
GRANT SELECT ON comms_mention TO c3_backup;

-- ── comms_object_link ── "link, never execute" chips on a revision ───────────
CREATE TABLE comms_object_link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  revision_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('Approval','Mission','Journey','Person','Credential','Document','Message','Obligation')),
  target_id   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, revision_id, target_type, target_id),
  FOREIGN KEY (tenant_id, revision_id) REFERENCES comms_message_revision (tenant_id, id)
);
-- No separate (tenant_id, revision_id) index: it is the leading prefix of the
-- UNIQUE above, which already serves both the by-revision lookup and the FK check
-- (Temper §205 specs only the unique — unlike §204 mention's distinct index).
ALTER TABLE comms_object_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_object_link FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_object_link
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_object_link TO c3_app;
REVOKE UPDATE, DELETE ON comms_object_link FROM c3_app;
GRANT SELECT ON comms_object_link TO c3_backup;

-- ── comms_document_attachment ── one message owns each ordinary attachment ────
CREATE TABLE comms_document_attachment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  message_id       text NOT NULL,
  document_id      text NOT NULL,
  attached_by_user_id uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_id),                                   -- one message = the provenance owner
  FOREIGN KEY (tenant_id, message_id) REFERENCES comms_message (tenant_id, message_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, document_id)
);
CREATE INDEX comms_document_attachment_by_message ON comms_document_attachment (tenant_id, message_id, created_at, id);
ALTER TABLE comms_document_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_document_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_document_attachment
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_document_attachment TO c3_app;
REVOKE UPDATE, DELETE ON comms_document_attachment FROM c3_app;
GRANT SELECT ON comms_document_attachment TO c3_backup;

-- ── comms_retention_tombstone ── proof a DM was purged (OUTLIVES the message) ─
-- No message FK: the message it records is DELETED by retention; this is proof of
-- performed retention, never a shadow copy. Carries no body/filename/author/keys.
CREATE TABLE comms_retention_tombstone (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  thread_id           text NOT NULL,
  message_id          text NOT NULL,
  original_created_at timestamptz NOT NULL,
  purged_at           timestamptz NOT NULL DEFAULT now(),
  reason              text NOT NULL DEFAULT 'dm_retention' CHECK (reason IN ('dm_retention')),
  UNIQUE (tenant_id, message_id)
);
ALTER TABLE comms_retention_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_retention_tombstone FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_retention_tombstone
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_retention_tombstone TO c3_app;
REVOKE UPDATE, DELETE ON comms_retention_tombstone FROM c3_app;
GRANT SELECT ON comms_retention_tombstone TO c3_backup;
