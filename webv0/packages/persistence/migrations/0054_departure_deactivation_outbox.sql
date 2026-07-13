-- 0054_departure_deactivation_outbox — HARDEN-3.1 Batch F (M-03).
--
-- Round 2: departure completion and the governed DeactivatePerson submit were two
-- separate commits, so a crash between them left a Completed departure with no
-- durable, discoverable follow-up. Persist the deactivation INTENT on the
-- departure row inside the completion transaction — an outbox:
--   deactivation_requested   set atomically with status='Completed';
--   deactivation_approval_id  the submitted approval, linked write-once by a drain.
-- A departure with deactivation_requested = true AND deactivation_approval_id IS
-- NULL is the outstanding work; the drain finds it after any crash.

ALTER TABLE departure ADD COLUMN deactivation_requested boolean NOT NULL DEFAULT false;
ALTER TABLE departure ADD COLUMN deactivation_approval_id text;

-- Fast lookup of the outstanding hand-offs for a tenant.
CREATE INDEX departure_deactivation_pending
  ON departure (tenant_id)
  WHERE deactivation_requested = true AND deactivation_approval_id IS NULL;
