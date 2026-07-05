-- 0005_external_identity.sql - immutable external identity binding (Phase 2B).
--
-- The server-side identity KEY is (provider, issuer_tenant_id, subject):
--   * entra: provider='entra', issuer_tenant_id = tid claim, subject = oid claim
--   * dev:   provider='dev',   issuer_tenant_id = 'dev',     subject = dev email
--
-- Tenant membership binds to app_user, and app_user is reached ONLY through
-- this immutable key. Mutable profile attributes (email, display_name,
-- last_seen_at) live on app_user and can change without affecting membership
-- or role. Email / preferred_username / UPN are NEVER membership keys.

CREATE TABLE external_identity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL CHECK (provider IN ('entra','dev')),
  issuer_tenant_id  text NOT NULL,
  subject           text NOT NULL,
  user_id           uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, issuer_tenant_id, subject)
);
CREATE INDEX external_identity_user ON external_identity (user_id);

-- Mutable profile attribute: last seen (updated by explicit flows only; the
-- SELECT-only auth role cannot and must not write it).
ALTER TABLE app_user ADD COLUMN last_seen_at timestamptz;

-- Preserve existing development identities: every current app_user was created
-- by the dev IdP with email as its natural key. Bind each to a dev external
-- identity WITHOUT weakening the production model (dev provider is refused in
-- production by the API's env validation).
INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id)
SELECT 'dev', 'dev', email, id FROM app_user
ON CONFLICT (provider, issuer_tenant_id, subject) DO NOTHING;

-- Membership resolution (c3_auth, SELECT-only) needs to read the binding.
GRANT SELECT ON external_identity TO c3_auth;
-- No writes for c3_auth; c3_app has no business here at all.
REVOKE INSERT, UPDATE, DELETE ON external_identity FROM c3_auth;
