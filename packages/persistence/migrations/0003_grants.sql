-- 0003_grants.sql - least-privilege grants for the application role `c3_app`.
--
-- The API connects ONLY as c3_app. This role:
--   * is NOT the table owner and is NOT superuser / BYPASSRLS (so RLS applies);
--   * may SELECT/INSERT/UPDATE operational + governance rows, but NEVER DELETE
--     (soft-deactivation only);
--   * may only SELECT/INSERT the append-only event streams (no UPDATE/DELETE);
--   * has no access to the global identity tables (tenant/app_user/membership/
--     role_assignment) on the data plane - auth membership resolution uses the
--     separate privileged admin connection.
--
-- The role itself is created (with an environment-supplied password) by the
-- migration runner's bootstrap step BEFORE this migration is applied.

GRANT USAGE ON SCHEMA public TO c3_app;

GRANT SELECT, INSERT, UPDATE ON person              TO c3_app;
GRANT SELECT, INSERT, UPDATE ON approval            TO c3_app;
GRANT SELECT, INSERT, UPDATE ON business_id_counter TO c3_app;
GRANT SELECT, INSERT         ON approval_event      TO c3_app;
GRANT SELECT, INSERT         ON audit_event         TO c3_app;

-- Explicitly ensure no DELETE anywhere and no event-stream mutation.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM c3_app;
REVOKE UPDATE, DELETE ON approval_event FROM c3_app;
REVOKE UPDATE, DELETE ON audit_event    FROM c3_app;
