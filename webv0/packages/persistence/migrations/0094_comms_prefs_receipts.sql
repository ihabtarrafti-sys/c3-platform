-- 0094_comms_prefs_receipts.sql — preferences, the private read cursor, presence,
-- and access requests (Comms build Phase 2; Temper's spine §6.5 + §6.2's
-- comms_access_request). Completes the Comms data-layer roster.
--
-- THE RECEIPTS MECHANISM (Neural-ruled hybrid override): there is deliberately
-- NO comms_read_receipt table. Receipts DERIVE at read time from the private
-- cursor + the preference row: "read by X" ⇔ X's cursor covers the message's seq
-- AND X's receipts are enabled AND the cursor movement happened at/after X's
-- receipts_enabled_since WATERMARK — so re-enabling receipts never retroactively
-- discloses reading done while they were off, and no per-read shared row is ever
-- written (the write-amplification answer the scorecard credited).
--
-- Ships DORMANT: no slice use-case writes these yet. Self-only write scoping
-- (expected-version prefs, monotonic cursor advance, presence upsert/delete for
-- current_user_id() only) is enforced by the use-case pass; presence additionally
-- keeps the house no-DELETE grant until the presence use-case ships its self-only
-- delete path (Temper §228's upsert/delete posture arrives with the surface).
-- The runner wraps this file in its own transaction.

-- ── comms_user_preference ── receipts/presence toggles + the watermark ────────
-- Missing row = both enabled (the 0037 code-default pattern; the lock-time
-- ruling: ON by default, per-user disable).
CREATE TABLE comms_user_preference (
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  user_id                 uuid NOT NULL,
  receipts_enabled        boolean NOT NULL DEFAULT true,
  -- The anti-retroactive-porosity watermark: stamped when receipts re-enable;
  -- receipt disclosure derives only from cursor movement at/after it.
  receipts_enabled_since  timestamptz,
  presence_enabled        boolean NOT NULL DEFAULT true,
  version                 integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TRIGGER comms_user_preference_set_updated_at BEFORE UPDATE ON comms_user_preference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_user_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_user_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_user_preference
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_user_preference TO c3_app;
REVOKE DELETE ON comms_user_preference FROM c3_app;
GRANT SELECT ON comms_user_preference TO c3_backup;

-- ── comms_inbox_cursor ── the private high-water read cursor ─────────────────
-- One row per (thread, user); monotonic last_read_seq (write only when the
-- sequence advances — use-case guarded). Receipts and unread counts DERIVE from
-- this; it is PRIVATE state (the anchored-thread read path never exposes it
-- directly). Composite thread FK: retiring a thread (DM retention) must retire
-- its cursors first — the comms_thread_participant sibling shape.
CREATE TABLE comms_inbox_cursor (
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  thread_id     text NOT NULL,
  user_id       uuid NOT NULL,
  last_read_seq bigint NOT NULL CHECK (last_read_seq >= 0),
  read_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, thread_id, user_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES comms_thread (tenant_id, thread_id)
);
ALTER TABLE comms_inbox_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_inbox_cursor FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_inbox_cursor
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_inbox_cursor TO c3_app;
REVOKE DELETE ON comms_inbox_cursor FROM c3_app;
GRANT SELECT ON comms_inbox_cursor TO c3_backup;

-- ── comms_presence ── ephemeral heartbeat state (DORMANT until the v2 surface) ─
-- Temper §228: upsert/delete only for current_user_id(). The self-only RLS
-- predicate AND the self-only delete path ship WITH the presence use-case; until
-- then the table is dormant and keeps the house no-DELETE grant.
CREATE TABLE comms_presence (
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  user_id      uuid NOT NULL,
  state        text NOT NULL,                                        -- vocabulary pinned with the presence surface
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  version      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX comms_presence_expiry ON comms_presence (tenant_id, expires_at);
ALTER TABLE comms_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_presence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_presence
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_presence TO c3_app;
REVOKE DELETE ON comms_presence FROM c3_app;
GRANT SELECT ON comms_presence TO c3_backup;

-- ── comms_access_request ── idempotent, advisory "request permission" ─────────
-- Temper §5.3/§196: for an anchor it asks the anchor's canonical authority to
-- change REAL anchor access — never a Comms-only exception. The thread reference
-- is an id (no FK, per spec — the request may outlive room retirement); the
-- authority is a snapshot at request time.
CREATE TABLE comms_access_request (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  thread_id          text NOT NULL,
  requester_user_id  uuid NOT NULL,
  state              text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','resolved','declined')),
  authority_user_id  uuid NOT NULL,                                  -- recipient authority snapshot
  authority_label    text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX comms_access_request_one_pending ON comms_access_request (tenant_id, thread_id, requester_user_id) WHERE state = 'pending';
CREATE INDEX comms_access_request_authority_inbox ON comms_access_request (tenant_id, authority_user_id, state, created_at);
CREATE TRIGGER comms_access_request_set_updated_at BEFORE UPDATE ON comms_access_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_access_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_access_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_access_request
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_access_request TO c3_app;
REVOKE DELETE ON comms_access_request FROM c3_app;
GRANT SELECT ON comms_access_request TO c3_backup;
