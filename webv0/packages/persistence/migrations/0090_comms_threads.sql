-- 0090_comms_threads.sql — the Comms thread layer (Comms build Phase 2, Temper's
-- spine §6.2). Rooms + their append-only change history + membership. UUID-keyed
-- throughout (the binding graft: every principal is app_user.id, never email).
--
-- Three kinds: anchored (readership = the anchor's live gate; no participant
-- rows), standing (a channel — all_members or explicit audience), direct (a DM/
-- group DM keyed by an immutable sorted-user-id hash). The kind-legal-fields
-- CHECKs keep each kind's shape honest.
--
-- Ships DORMANT: no thread is created yet. The runtime enforcement — direct-row
-- participant immutability, the standing-membership gateway, business-id
-- allocation — lands with the thread-management use-cases in a later pass; this
-- migration only opens the schema. The runner wraps this file in its own tx.

-- ── comms_thread ────────────────────────────────────────────────────────────
CREATE TABLE comms_thread (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  thread_id           text NOT NULL,                                   -- THR-#### business id
  kind                text NOT NULL CHECK (kind IN ('anchored','standing','direct')),
  anchor_type         text CHECK (anchor_type IN ('Mission','Journey','Person','Credential','Approval','Document')),
  anchor_id           text,                                            -- the anchor's business id (text ref, no FK)
  direct_set_hash     text,                                            -- DM: sha256 of the sorted user_id set (immutable)
  title               text,                                            -- standing channels
  audience_mode       text CHECK (audience_mode IN ('all_members','explicit')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  direct_retention_days integer,
  version             integer NOT NULL DEFAULT 0,
  created_by_user_id  uuid NOT NULL,                                   -- stable app_user.id (never email)
  created_by_label    text,                                            -- display snapshot
  last_seq            bigint NOT NULL DEFAULT 0,                       -- per-thread message sequence
  last_message_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, thread_id),
  -- kind-legal fields: each kind carries ONLY what it may. The anchor is two
  -- columns, so the anchored biconditional (both-non-null iff anchored) needs a
  -- companion that forbids a DANGLING HALF-ANCHOR on a non-anchored kind — else
  -- e.g. a direct thread could persist anchor_type without anchor_id. direct_set_hash
  -- and audience_mode are single-column, so their biconditionals suffice alone.
  CONSTRAINT comms_thread_anchored_shape    CHECK ((kind = 'anchored') = (anchor_type IS NOT NULL AND anchor_id IS NOT NULL)),
  CONSTRAINT comms_thread_anchor_null_shape CHECK (kind = 'anchored' OR (anchor_type IS NULL AND anchor_id IS NULL)),
  CONSTRAINT comms_thread_direct_shape      CHECK ((kind = 'direct') = (direct_set_hash IS NOT NULL)),
  CONSTRAINT comms_thread_standing_shape    CHECK ((kind = 'standing') = (audience_mode IS NOT NULL)),
  -- direct_retention_days is a DM-only concept (Temper A3, bounded 30-365); it may
  -- not bleed onto anchored/standing threads and may not hold an out-of-range value.
  CONSTRAINT comms_thread_retention_shape   CHECK (direct_retention_days IS NULL OR (kind = 'direct' AND direct_retention_days BETWEEN 30 AND 365))
);
-- one canonical thread per anchor; one DM per member set.
CREATE UNIQUE INDEX comms_thread_one_per_anchor ON comms_thread (tenant_id, anchor_type, anchor_id) WHERE kind = 'anchored';
CREATE UNIQUE INDEX comms_thread_one_per_direct ON comms_thread (tenant_id, direct_set_hash) WHERE kind = 'direct';
CREATE INDEX comms_thread_list ON comms_thread (tenant_id, last_message_at DESC, thread_id);
CREATE TRIGGER comms_thread_set_updated_at BEFORE UPDATE ON comms_thread
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_thread FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_thread
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_thread TO c3_app;
REVOKE DELETE ON comms_thread FROM c3_app;
GRANT SELECT ON comms_thread TO c3_backup;

-- ── comms_thread_event ── append-only room-change history ────────────────────
CREATE TABLE comms_thread_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  thread_id     text NOT NULL,
  event_type    text NOT NULL CHECK (event_type IN ('Created','TitleChanged','Archived','Reopened','AudienceChanged','ParticipantAdded','ParticipantRemoved')),
  actor_user_id uuid NOT NULL,
  actor_label   text,
  before_json   jsonb,                                                 -- limited to thread metadata / user uuid
  after_json    jsonb,
  reason        text,
  at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, thread_id, id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES comms_thread (tenant_id, thread_id)
);
CREATE INDEX comms_thread_event_history ON comms_thread_event (tenant_id, thread_id, at, id);
CREATE TRIGGER comms_thread_event_append_only BEFORE UPDATE OR DELETE ON comms_thread_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_thread_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_thread_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_thread_event
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_thread_event TO c3_app;
REVOKE UPDATE, DELETE ON comms_thread_event FROM c3_app;
GRANT SELECT ON comms_thread_event TO c3_backup;

-- ── comms_thread_participant ── channel/direct membership ────────────────────
-- Direct rows are immutable and standing rows change only through a gateway that
-- appends the matching thread event — enforced by triggers that ship with the
-- participant-management use-case (this table is dormant until then).
CREATE TABLE comms_thread_participant (
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  thread_id  text NOT NULL,
  user_id    uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('member','admin')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  version    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, thread_id, user_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES comms_thread (tenant_id, thread_id)
);
CREATE INDEX comms_thread_participant_reader ON comms_thread_participant (tenant_id, user_id, removed_at, thread_id);
CREATE INDEX comms_thread_participant_admin ON comms_thread_participant (tenant_id, thread_id, role) WHERE removed_at IS NULL;
ALTER TABLE comms_thread_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_thread_participant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_thread_participant
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_thread_participant TO c3_app;
REVOKE DELETE ON comms_thread_participant FROM c3_app;
GRANT SELECT ON comms_thread_participant TO c3_backup;
