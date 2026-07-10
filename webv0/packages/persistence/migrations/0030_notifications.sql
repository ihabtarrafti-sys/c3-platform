-- 0030_notifications.sql - S10 notifications (2026-07-10): Layer 2 of the
-- notification model (the pressure-tested taxonomy): a PER-USER, ack-able
-- attention row. Signals STAY derived (the credentialStatusOn doctrine) -
-- only DELIVERY and ACKNOWLEDGEMENT are stored. The UNIQUE
-- (tenant, user, signal_key) is the dedupe-on-first-crossing law: a
-- condition becoming true notifies once, not on every poll.
--
-- Sources: approval-pipeline transitions fanned per-user AT WRITE TIME
-- (inside the same transaction as the approval event), and derived-signal
-- first crossings swept when the Situation Room is read. Email is a
-- DELIVERY CHANNEL of these rows (post-commit, best-effort, fails closed
-- to rows-only when SMTP is not configured) - never a separate system.

CREATE TABLE notification (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  user_identity text NOT NULL,                  -- the recipient (email identity)
  signal_key    text NOT NULL,                  -- stable key: dedupe-on-first-crossing
  kind          text NOT NULL,                  -- 'pipeline' | signal kind
  title         text NOT NULL,
  link          text NOT NULL,                  -- in-app route
  emitted_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  UNIQUE (tenant_id, user_identity, signal_key)
);
CREATE INDEX notification_inbox ON notification (tenant_id, user_identity, read_at, emitted_at DESC);
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON notification TO c3_app;
REVOKE DELETE ON notification FROM c3_app;
GRANT SELECT ON notification TO c3_backup;
