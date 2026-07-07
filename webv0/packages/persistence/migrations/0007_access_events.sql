-- 0007_access_events.sql - platform-level access-denial audit stream (A-8 Phase 1).
--
-- ACCESS_NOT_PROVISIONED / inactive-identity denials have NO resolvable tenant
-- (that is what makes them denials), so they cannot live in the tenant-scoped,
-- RLS-forced audit_event table. access_event is a platform-level, append-only
-- stream keyed on the immutable external-identity triple.
--
-- Privilege posture:
--   * c3_app: INSERT only (write-only from the API; the app never reads it);
--   * c3_backup: SELECT (captured by logical backups; admin forensics via psql);
--   * c3_auth: nothing;
--   * append-only enforced by trigger (reuses forbid_mutation from 0001) AND by
--     the absence of UPDATE/DELETE grants.
-- No RLS: there is deliberately no tenant on these rows, and c3_app cannot
-- SELECT them at all.

CREATE TABLE access_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at                timestamptz NOT NULL DEFAULT now(),
  provider          text NOT NULL,
  issuer_tenant_id  text NOT NULL,
  subject           text NOT NULL,            -- the immutable oid
  outcome           text NOT NULL CHECK (outcome IN ('AccessDenied')),
  detail            text
);
CREATE INDEX access_event_lookup ON access_event (provider, issuer_tenant_id, subject, at);

CREATE TRIGGER access_event_append_only BEFORE UPDATE OR DELETE ON access_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

GRANT INSERT ON access_event TO c3_app;
GRANT SELECT ON access_event TO c3_backup;
REVOKE UPDATE, DELETE ON access_event FROM c3_app;
