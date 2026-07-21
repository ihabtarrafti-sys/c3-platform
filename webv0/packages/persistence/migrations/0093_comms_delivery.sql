-- 0093_comms_delivery.sql — the Comms delivery substrate (Comms build Phase 2,
-- Temper's spine §6.4): versioned nudge policies + their stages, the durable
-- scheduled nudge records the brief demands ("channel, recipient, sender
-- authority, time, template — never browser state"), the delivery outbox
-- (mutable mechanics; the source records remain the truth), and the attention
-- rows the notification bell unions in.
--
-- Idempotency is layered (the hybrid ruling): the outbox unique
-- (tenant, source_kind, source_id, recipient, channel) is the DELIVER-ONCE
-- claim; comms_nudge.idempotency_key and comms_attention's
-- (tenant, recipient, source_kind, source_id) are the FOREVER-DEDUP, whose key
-- VALUES are composed at the use-case layer with Zenith's crossing/event-scoped
-- key scheme (so a re-crossing or a re-delivery genuinely re-arms).
--
-- Source references are business ids (no FK): delivery mechanics never pin the
-- record tables. Ships DORMANT: nothing schedules or drains yet; the drain
-- (opportunistic-on-write + low-frequency crash-net), the max-5-stages /
-- max-10-recipients bounds, and the no-message-body template rule are
-- gateway-enforced in the use-case pass. The runner wraps this file in its own tx.

-- ── comms_nudge_policy ── versioned; a new version is inserted, never edited ──
CREATE TABLE comms_nudge_policy (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  policy_key         text NOT NULL,
  version            integer NOT NULL CHECK (version > 0),
  name               text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),               -- stamps the is_active supersession flip
  UNIQUE (tenant_id, policy_key, version),
  UNIQUE (tenant_id, id)                                              -- for the stage composite FK
);
CREATE TRIGGER comms_nudge_policy_set_updated_at BEFORE UPDATE ON comms_nudge_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_nudge_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_nudge_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_nudge_policy
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- Stage CONTENT is append-only (new version = new rows); the policy row's ONLY
-- legal in-place change is the is_active supersession flip — DB-ENFORCED with a
-- column-scoped UPDATE grant (the 0051/0076/0078/0086 precedent), so identity
-- (policy_key/version/name/creator) can never be rewritten under a nudge's
-- by-value snapshot.
GRANT SELECT, INSERT ON comms_nudge_policy TO c3_app;
GRANT UPDATE (is_active) ON comms_nudge_policy TO c3_app;
REVOKE DELETE ON comms_nudge_policy FROM c3_app;
GRANT SELECT ON comms_nudge_policy TO c3_backup;

-- ── comms_nudge_policy_stage ── append-only stage content ────────────────────
CREATE TABLE comms_nudge_policy_stage (
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  policy_id      uuid NOT NULL,
  stage_no       integer NOT NULL CHECK (stage_no > 0),               -- max 5 stages gateway-enforced
  offset_seconds integer NOT NULL,                                    -- relative to due_at (negative = before)
  recipient_role text NOT NULL CHECK (recipient_role IN ('accountable','requester','acceptance')),
  channel        text NOT NULL CHECK (channel IN ('in_app','email')),
  template_key   text NOT NULL,
  PRIMARY KEY (tenant_id, policy_id, stage_no),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES comms_nudge_policy (tenant_id, id)
);
CREATE TRIGGER comms_nudge_policy_stage_append_only BEFORE UPDATE OR DELETE ON comms_nudge_policy_stage
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_nudge_policy_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_nudge_policy_stage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_nudge_policy_stage
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_nudge_policy_stage TO c3_app;
REVOKE UPDATE, DELETE ON comms_nudge_policy_stage FROM c3_app;
GRANT SELECT ON comms_nudge_policy_stage TO c3_backup;

-- ── comms_nudge ── the durable, policy-snapshotted scheduled nudge record ─────
CREATE TABLE comms_nudge (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenant(id),
  nudge_id                 text NOT NULL,
  idempotency_key          text NOT NULL,                             -- deterministic (Zenith key scheme at the use-case)
  source_kind              text NOT NULL CHECK (source_kind IN ('message','obligation')),
  source_id                text NOT NULL,                             -- business id, no FK
  policy_key               text NOT NULL,                             -- policy/version/stage SNAPSHOT
  policy_version           integer NOT NULL,
  stage_no                 integer NOT NULL,
  recipient_user_id        uuid NOT NULL,
  -- sender authority: 'system' (policy-fired, no uuid) or 'account' (a member's
  -- explicit authority, uuid present). Fully bound (the 0090 split-column law).
  sender_authority_kind    text NOT NULL CHECK (sender_authority_kind IN ('account','system')),
  sender_authority_user_id uuid,
  channel                  text NOT NULL CHECK (channel IN ('in_app','email')),
  scheduled_at             timestamptz NOT NULL,
  template_key             text NOT NULL,
  template_params          jsonb,                                     -- never a message body (gateway rule)
  state                    text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','cancelled','delivered','dead')),
  attempts                 integer NOT NULL DEFAULT 0,
  last_error               text,
  delivered_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nudge_id),
  UNIQUE (tenant_id, idempotency_key),
  -- kind-legal shape: 'account' carries the member uuid; 'system' carries none.
  CONSTRAINT comms_nudge_sender_authority_shape CHECK (
    (sender_authority_kind = 'account') = (sender_authority_user_id IS NOT NULL)
  )
);
CREATE INDEX comms_nudge_due ON comms_nudge (tenant_id, state, scheduled_at, id);
CREATE TRIGGER comms_nudge_set_updated_at BEFORE UPDATE ON comms_nudge
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_nudge ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_nudge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_nudge
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_nudge TO c3_app;
REVOKE DELETE ON comms_nudge FROM c3_app;
GRANT SELECT ON comms_nudge TO c3_backup;

-- ── comms_delivery_outbox ── deliver-once claim; mutable mechanics ────────────
CREATE TABLE comms_delivery_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  source_kind       text NOT NULL CHECK (source_kind IN ('mention','nudge')),
  source_id         text NOT NULL,                                    -- business id / row id, no FK
  thread_id         text NOT NULL,                                    -- id, no FK (mechanics never pin records)
  recipient_user_id uuid NOT NULL,
  channel           text NOT NULL CHECK (channel IN ('in_app','email')),
  available_at      timestamptz NOT NULL DEFAULT now(),
  leased_until      timestamptz,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','delivered','dead')),
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_kind, source_id, recipient_user_id, channel)
);
CREATE INDEX comms_delivery_outbox_claim ON comms_delivery_outbox (tenant_id, status, available_at, id);
CREATE TRIGGER comms_delivery_outbox_set_updated_at BEFORE UPDATE ON comms_delivery_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_delivery_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_delivery_outbox
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_delivery_outbox TO c3_app;
REVOKE DELETE ON comms_delivery_outbox FROM c3_app;
GRANT SELECT ON comms_delivery_outbox TO c3_backup;

-- ── comms_attention ── the bell rows (unioned into the existing inbox DTO) ────
-- Carries NO body, filename, evidence description, or sender email — a title
-- key + link only. The unique is the FOREVER-DEDUP; source_id values are
-- composed with Zenith's crossing/event-scoped keys so re-crossings re-arm.
-- source_kind is deliberately generic (mention | nudge | dm_unread | …).
CREATE TABLE comms_attention (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  thread_id         text NOT NULL,                                    -- id, no FK; every attention kind is thread-scoped
  source_kind       text NOT NULL,
  source_id         text NOT NULL,
  recipient_user_id uuid NOT NULL,
  title_key         text NOT NULL,
  link              text NOT NULL,                                    -- in-app route
  emitted_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,
  expires_at        timestamptz,                                      -- optional, for direct-room content
  UNIQUE (tenant_id, recipient_user_id, source_kind, source_id)
);
CREATE INDEX comms_attention_inbox ON comms_attention (tenant_id, recipient_user_id, read_at, emitted_at DESC, id);
ALTER TABLE comms_attention ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_attention FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_attention
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_attention TO c3_app;
REVOKE DELETE ON comms_attention FROM c3_app;
GRANT SELECT ON comms_attention TO c3_backup;
