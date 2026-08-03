-- 0104_platform_principal_registry.sql — D-015 step 3 / D-019.
--
-- The registry that admits a PLATFORM principal. Platform authority is not
-- tenant membership: these rows carry no tenant, and nothing here can be reached
-- by being a member of anything.
--
-- ⛔ ADMISSION REQUIRES A ROW. No row ⇒ refused. That is `D-016a` made
-- mechanical: **admission is the PRESENCE of a registration, never the ABSENCE
-- of a tenant membership.** A negative can never be an admission criterion, so
-- there is deliberately no "not a customer" state to fall into — an identity
-- either appears here with capabilities or has none.
--
-- ⚖️ KEYED ON (provider, issuer, subject), MIRRORING `external_identity`
-- (0005:19), AND THE SHAPE IS A RULING. The owner chose Entra as the trust root
-- "for now, maybe scale into C3-issued later" — and that "for now" is binding:
-- **a second trust root must later be A ROW AND AN ADAPTER, never a rewrite.**
-- A registry keyed on an Entra `appId` would encode today's answer into the
-- schema and make tomorrow's answer a migration. The precedent already exists in
-- this database for tenant identities; this uses its shape rather than inventing
-- a parallel one.
--
-- ⚖️ WHY ENTRA AND NOT C3-ISSUED KEYS TODAY — sequencing, not preference.
-- Becoming an identity provider means key generation, rotation, revocation and
-- storage, all new and all ours to lose. This system has not yet proven it can
-- take a backup of any environment. **Taking custody of a second irreplaceable
-- secret before proving we can keep the first is the wrong order.**

CREATE TABLE platform_principal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The trust root and the identity within it. 'entra' today; a future
  -- 'c3' provider is a new value and an adapter, not a new table.
  provider           text NOT NULL CHECK (provider IN ('entra')),
  issuer             text NOT NULL,
  subject            text NOT NULL,
  -- What is acting. Human actions carry extra obligations above this layer.
  kind               text NOT NULL CHECK (kind IN ('service', 'staff')),
  -- ⛔ THE ANSWERABLE HUMAN, AND IT IS NOT NULLABLE. A service principal names
  -- WHAT RAN; only a registered owner names WHO IS ANSWERABLE. A platform-wide
  -- destructive sweep attributable to nobody is worse than one attributable to
  -- the wrong tenant's owner — the first cannot be asked why. The length check
  -- exists because '' is a value that satisfies NOT NULL while naming nobody.
  accountable_owner  text NOT NULL CHECK (length(btrim(accountable_owner)) > 0),
  -- ⛔ THE CAPABILITY VOCABULARY, CONSTRAINED HERE AS WELL AS IN TYPESCRIPT.
  -- `vocabularyDrift.test.ts` binds this CHECK to `PLATFORM_CAPABILITIES`, so the
  -- two cannot drift — the lesson from the erasure trigger, applied before it
  -- could bite a second time. `<@` is array containment: every granted value must
  -- be a member of the closed set.
  capabilities       text[] NOT NULL DEFAULT '{}'::text[]
                       CHECK (capabilities <@ ARRAY[
                         'platform.backup_status.read',
                         'platform.erasure_janitor.execute'
                       ]::text[]),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, issuer, subject)
);

-- Platform admission resolves on the SELECT-only auth connection, exactly as
-- tenant membership does. Nothing on the app path may read it.
GRANT SELECT ON platform_principal TO c3_auth;
REVOKE INSERT, UPDATE, DELETE ON platform_principal FROM c3_auth;
-- ⛔ c3_app has no business here AT ALL: the app principal must not be able to
-- discover who holds platform authority, let alone grant it.
REVOKE ALL ON platform_principal FROM c3_app;

-- ⛳ NO ROUTE CREATES A ROW HERE, AND THAT IS THE CONTROL — the same structural
-- guarantee that holds the tenant table (no API route and no migration creates a
-- tenant). Registering a platform principal is a deliberate operator act against
-- the database, not a feature. If an endpoint for it is ever wanted, it is its
-- own decision and it disarms this control the day it lands.
