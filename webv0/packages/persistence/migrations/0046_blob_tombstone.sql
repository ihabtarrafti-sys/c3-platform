-- 0046_blob_tombstone.sql — HARDEN-3 Batch C (blob universe): the durable
-- object-erasure ledger.
--
-- Object deletion in the object store is NOT transactional with the database.
-- Two ceremonies need a durable record of "this object MUST be erased" that
-- OUTLIVES the rows (and the tenant) that named it:
--
--   1. TENANT EXIT (H-07 two-phase) — the exit transaction records every object
--      in the blob universe as a tombstone WHILE the source rows still exist,
--      then (post-commit) deletes + verifies each. If deletion is interrupted
--      the tombstone survives as the retryable record; the tenant identity is
--      already gone, so without this ledger the stranded objects have no handle.
--
--   2. REJECTED-INTAKE WIPE (M-02) — reject records the quarantine keys as
--      tombstones IN THE SAME TX as the reject, so a failed object delete leaves
--      a retryable tombstone instead of a silently-orphaned blob.
--
-- Deliberately PLATFORM-LEVEL, not a tenant-owned table: the column is
-- `tenant_ref` (NOT `tenant_id`) and carries NO foreign key, so (a) it survives
-- the tenant erasure that deletes every `tenant_id`-keyed row, and (b) the H-03
-- catalog gate — which requires the tenant-table registry to equal every table
-- carrying a `tenant_id` column — correctly leaves it out of the export/exit
-- deletion set (same posture as access_event). It holds ONLY opaque storage
-- keys: no payload, no PII.

CREATE TABLE blob_tombstone (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref   uuid NOT NULL,                       -- the (possibly-erased) tenant; NO FK on purpose
  storage_key  text NOT NULL,
  blob_class   text NOT NULL CHECK (blob_class IN ('document','photo','intake','orphan')),
  reason       text NOT NULL CHECK (reason IN ('exit','intake_reject')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,                         -- NULL = pending; set ONLY after the object is verified gone
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text
);

-- Fast lookup of the outstanding work for a tenant.
CREATE INDEX blob_tombstone_pending ON blob_tombstone (tenant_ref) WHERE deleted_at IS NULL;
-- One tombstone per (tenant, key, reason): re-recording is idempotent, so a
-- retried exit/reject does not duplicate rows.
CREATE UNIQUE INDEX blob_tombstone_key ON blob_tombstone (tenant_ref, storage_key, reason);

-- The M-02 (API) path writes/reads its own tenant's tombstones; the exit CLI
-- runs as the privileged admin role (BYPASSRLS) and is unaffected by the policy.
ALTER TABLE blob_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE blob_tombstone FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON blob_tombstone
  USING (tenant_ref = current_tenant_id())
  WITH CHECK (tenant_ref = current_tenant_id());

-- The ledger is append-and-mark-only: the app inserts on reject and updates
-- deleted_at/attempts, but never deletes a tombstone (it is the retained record
-- of the erasure). The exit CLI acts as admin.
GRANT SELECT, INSERT, UPDATE ON blob_tombstone TO c3_app;
REVOKE DELETE ON blob_tombstone FROM c3_app;
GRANT SELECT ON blob_tombstone TO c3_backup;
