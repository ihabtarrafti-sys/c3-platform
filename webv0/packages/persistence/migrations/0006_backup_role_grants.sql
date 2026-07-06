-- 0006_backup_role_grants.sql - read-only logical-backup identity `c3_backup`.
--
-- Purpose: a dedicated, narrowly-scoped principal for `pg_dump` only. It is
-- created by the role bootstrap (LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
-- NOREPLICATION, password supplied out-of-band, never in source). This file
-- grants ONLY the read access pg_dump needs and NOTHING else.
--
-- BYPASSRLS EXCEPTION (documented, deliberate, narrow):
--   A complete logical backup must capture EVERY tenant's rows. The data
--   tables FORCE row-level security, so a normal role would dump only the rows
--   visible under the current tenant GUC (i.e. none, fail-closed). c3_backup is
--   therefore the ONE new principal granted BYPASSRLS. This is safe because
--   c3_backup is read-only (no INSERT/UPDATE/DELETE/TRUNCATE/DDL/GRANT), is
--   private-network only, exists ONLY on the backup service, and is absent
--   from the API runtime. It must remain the only non-superuser BYPASSRLS
--   principal besides the postgres owner.

-- CONNECT on the current database (portable across environment DB names).
DO $grant_connect$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO c3_backup', current_database());
END
$grant_connect$;
GRANT USAGE ON SCHEMA public TO c3_backup;

-- Read every existing application table (all tenants, via BYPASSRLS below).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO c3_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO c3_backup;

-- Preserve SELECT for FUTURE tables the schema owner creates (no write).
-- Applies to objects created by the CURRENT (migration-owner) role — which is
-- the schema owner in every environment (postgres on Railway, c3_admin locally).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO c3_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO c3_backup;

-- The documented backup exception: read across all tenants.
ALTER ROLE c3_backup BYPASSRLS;

-- Defense in depth: c3_backup must never write, own, or grant.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM c3_backup;
REVOKE CREATE ON SCHEMA public FROM c3_backup;
