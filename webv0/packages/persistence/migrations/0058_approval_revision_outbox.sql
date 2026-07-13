-- 0058_approval_revision_outbox — HARDEN-3.1 M-06.
--
-- Round 2: reviseApproval was multi-transaction (withdraw the source → dispatch the
-- op's real submit → link). A crash between the withdraw and the link left the source
-- Withdrawn with NO successor and NO durable record that one was owed — an orphan no
-- drain could recover — and concurrent revises of a terminal source create-then-
-- withdrew a real row. This is the departure-outbox pattern (0054) applied to revise:
-- the withdraw and a durable revision INTENT are recorded in ONE transaction; a
-- resumable, idempotent drain completes the submit + link.
--
--   status = 'Pending'    the outstanding work — the drain finds it after any crash;
--   status = 'Completed'  submitted + linked; submitted_approval_id names the successor;
--   status = 'Abandoned'  a deterministic refusal (a real duplicate/guard) or the poison-
--                         pill backstop after N transient retries — last_error carries why,
--                         the source stays Withdrawn, the submitter re-submits fresh.
--
-- FORK PREVENTION: the unique index makes the intent a WRITE-ONCE claim on the source —
-- at most one revision intent per source approval ever exists, so two concurrent revises
-- cannot both proceed (the second's INSERT conflicts; tx-1 also serialises on the source
-- lock). PII: `payload` holds a validated submit payload = tenant PII at rest. It is read
-- ONLY server-side by the drain (never projected to a client, unlike approval.payload),
-- is tenant-isolated by RLS, and — critically — is REGISTERED in tenantTables.ts so the
-- tenant-exit ceremony (0056/0057) erases it in the data phase and asserts it zero. A row
-- left behind would strand PII past a zeroed exit (the H-07 class we just closed).
CREATE TABLE approval_revision (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  source_approval_id     text NOT NULL,
  operation_type         text NOT NULL,
  payload                jsonb NOT NULL,
  reason                 text,
  submitted_by           text NOT NULL,
  status                 text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Abandoned')),
  submitted_approval_id  text,
  attempts               integer NOT NULL DEFAULT 0,
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Write-once claim: at most ONE revision intent per source approval (fork prevention).
CREATE UNIQUE INDEX approval_revision_one_per_source ON approval_revision (tenant_id, source_approval_id);
-- Fast drain lookup of the outstanding hand-offs for a tenant.
CREATE INDEX approval_revision_pending ON approval_revision (tenant_id) WHERE status = 'Pending';

-- Same tenant-isolation + at-rest posture as approval: RLS by current tenant, c3_app may
-- read/insert/update but NOT delete (only the exit ceremony's privileged connection
-- deletes), backup reads for the encrypted image.
ALTER TABLE approval_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_revision
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON approval_revision TO c3_app;
REVOKE DELETE ON approval_revision FROM c3_app;
GRANT SELECT ON approval_revision TO c3_backup;
