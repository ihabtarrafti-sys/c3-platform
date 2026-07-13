-- 0051_tombstone_immutability — HARDEN-3.1 R2-N06.
--
-- 0046 declared blob_tombstone "append-and-mark-only" but only in comments: it
-- GRANTed c3_app unrestricted UPDATE, so the role could rewrite the retained
-- erasure record's identity (tenant_ref / storage_key / blob_class / reason /
-- created_at) or reopen a resolved deleted_at. Enforce the boundary at the DB:
--   1. column-scoped UPDATE — c3_app may touch ONLY the resolution columns;
--   2. an immutability trigger — identity/key/class/reason/created are frozen and
--      deleted_at is monotonic (a verified-gone erasure can never be un-resolved),
--      covering the admin/BYPASSRLS path too (triggers fire regardless of role).

-- 1 — column-scoped UPDATE for the app role.
REVOKE UPDATE ON blob_tombstone FROM c3_app;
GRANT UPDATE (deleted_at, attempts, last_error) ON blob_tombstone TO c3_app;

-- 2 — immutability trigger (defense in depth; also the only guard on privileged roles).
CREATE OR REPLACE FUNCTION blob_tombstone_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_ref  IS DISTINCT FROM OLD.tenant_ref
  OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
  OR NEW.blob_class  IS DISTINCT FROM OLD.blob_class
  OR NEW.reason      IS DISTINCT FROM OLD.reason
  OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'blob_tombstone identity is immutable (tenant_ref/storage_key/blob_class/reason/created_at cannot change)'
      USING ERRCODE = '23514';
  END IF;
  -- Monotonic resolution: once the object is verified gone, deleted_at is frozen.
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'blob_tombstone.deleted_at is monotonic (a resolved erasure cannot be reopened or changed)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER blob_tombstone_immutable_guard
  BEFORE UPDATE ON blob_tombstone
  FOR EACH ROW EXECUTE FUNCTION blob_tombstone_immutable();
