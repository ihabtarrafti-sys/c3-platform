-- 0096 — F05 (disclosure chapter, Block 5): approval_revision gains FORCE.
--
-- 0058 created the table with ENABLE ROW LEVEL SECURITY but never FORCE, so
-- the table owner (the app role, on any future ownership/bypass drift) could
-- read revisions unfiltered. Not live today — no BYPASSRLS path exists — which
-- is why this sat last among the chapter's code blocks. The DDL is one line;
-- the RULED durable fix is the catalog-wide law in
-- packages/persistence/test/rlsCatalog.test.ts, which failed naming exactly
-- this table before this file existed and now guards every future table.
--
-- The catalog law's first full run then surfaced TWO MORE tables in the
-- exact same class (enabled since 0004, policies present, FORCE absent):
-- the identity plane's tenant_membership and role_assignment. FORCE binds
-- only the table OWNER -- c3_auth's cross-tenant resolution policy
-- (USING true, SELECT-only) and every non-owner role are untouched -- so
-- the fix is the same owner-drift closure, three tables wide.
--
-- The staging APPLY is the OWNER's, at the web+API deploy window.
ALTER TABLE approval_revision FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_membership FORCE ROW LEVEL SECURITY;
ALTER TABLE role_assignment   FORCE ROW LEVEL SECURITY;
