-- 0040_guest_intake.sql — Track B6: tokenized guest intake + sandbox.
--
-- A public, unauthenticated write surface that stays safe by construction:
--
--   * intake_link — a staff-minted, single-purpose, expiring CAPABILITY. Only a
--     SHA-256 of the 256-bit token is stored (the token itself is shown once at
--     mint and never persisted). Unguessable ⇒ no tenant enumeration.
--   * intake_submission — the SANDBOX. A guest's answers land here and ONLY
--     here; nothing reaches live data without a staff-initiated governed
--     promotion (AddPerson) under the reviewer's own identity.
--
-- Cross-tenant token resolution (the guest has no tenant context yet) is the
-- narrow escape hatch: two owner-owned SECURITY DEFINER functions keyed on the
-- unguessable token hash. To let the owner-owned definer bypass RLS on
-- intake_link, that table is ENABLE (NOT FORCE) RLS — a DELIBERATE, documented
-- exception (every other tenant table is FORCE). c3_app (staff) is not the
-- owner, so RLS still scopes the staff link manager to its own tenant.
-- intake_submission keeps ENABLE + FORCE (the convention; no cross-tenant read).
--
-- Wipe-on-reject respects the no-hard-DELETE law: rejecting UPDATEs payload to
-- NULL (PII gone) and leaves a Rejected tombstone; the CHECK makes a Rejected
-- row with a surviving payload unrepresentable.
--
-- NOTE: the migration runner wraps each file in its own transaction and records
-- it in _migrations — so no top-level BEGIN/COMMIT and no _migrations insert
-- here (the deploy paste, which runs raw psql, adds both).

-- ── the capability link (staff-minted) ──────────────────────────────────────
CREATE TABLE intake_link (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  token_hash   text NOT NULL UNIQUE,
  kind         text NOT NULL CHECK (kind IN ('Onboarding')),
  label        text,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  max_uses     integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count   integer NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  status       text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Consumed','Revoked','Expired')),
  consumed_at  timestamptz,
  -- composite target so a submission's (tenant_id, link_id) FK enforces same-tenant.
  UNIQUE (tenant_id, id)
);
CREATE INDEX intake_link_manage ON intake_link (tenant_id, status, created_at DESC);

ALTER TABLE intake_link ENABLE ROW LEVEL SECURITY; -- NOT FORCE: see header (definer resolver).
CREATE POLICY tenant_isolation ON intake_link
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON intake_link TO c3_app;
GRANT SELECT ON intake_link TO c3_backup;

-- ── the sandbox submission ──────────────────────────────────────────────────
CREATE TABLE intake_submission (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  link_id               uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('Onboarding')),
  payload               jsonb,
  uploads               jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Promoted','Rejected')),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  submitter_fingerprint text,
  reviewed_by           text,
  reviewed_at           timestamptz,
  promoted_approval_id  text,
  promoted_person_id    text,
  decision_note         text,
  FOREIGN KEY (tenant_id, link_id) REFERENCES intake_link (tenant_id, id),
  -- the lifecycle shape, incl. wipe-on-reject (Rejected ⇒ payload scrubbed):
  CONSTRAINT intake_submission_state_shape CHECK (
    (status = 'Pending'  AND reviewed_by IS NULL AND reviewed_at IS NULL AND promoted_approval_id IS NULL AND promoted_person_id IS NULL AND payload IS NOT NULL)
    OR (status = 'Promoted' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND promoted_approval_id IS NOT NULL AND payload IS NOT NULL)
    OR (status = 'Rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND payload IS NULL)
  )
);
CREATE INDEX intake_submission_review ON intake_submission (tenant_id, status, submitted_at DESC);

ALTER TABLE intake_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submission FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intake_submission
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON intake_submission TO c3_app;
GRANT SELECT ON intake_submission TO c3_backup;

-- ── tokenized resolution (the pre-tenant escape hatch) ──────────────────────
-- Non-consuming resolve for the public form load. STABLE (no writes): computes
-- the EFFECTIVE status (past-expiry Active reads as Expired) without flipping.
-- Returns a row only for a token that matches (the unguessable hash is the gate).
CREATE OR REPLACE FUNCTION intake_peek(p_token_hash text)
RETURNS TABLE(link_id uuid, tenant_id uuid, kind text, effective_status text, expires_at timestamptz, uses_left integer)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    l.id,
    l.tenant_id,
    l.kind,
    CASE WHEN l.status = 'Active' AND l.expires_at <= now() THEN 'Expired' ELSE l.status END,
    l.expires_at,
    GREATEST(l.max_uses - l.used_count, 0)
  FROM intake_link l
  WHERE l.token_hash = p_token_hash
$$;

-- Atomic claim for the public submit: row-locks, validates (Active + unexpired +
-- uses remaining), consumes one use (marking Consumed when exhausted), and
-- returns the resolved (link_id, tenant_id, kind). Empty result = unclaimable.
-- Runs inside the caller's transaction, so a failed submission INSERT rolls the
-- consume back with it. Lazily flips a past-expiry Active link to Expired.
CREATE OR REPLACE FUNCTION intake_claim(p_token_hash text)
RETURNS TABLE(link_id uuid, tenant_id uuid, kind text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r intake_link%ROWTYPE;
BEGIN
  SELECT * INTO r FROM intake_link WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.status <> 'Active' OR r.expires_at <= now() OR r.used_count >= r.max_uses THEN
    IF r.status = 'Active' AND r.expires_at <= now() THEN
      UPDATE intake_link SET status = 'Expired' WHERE id = r.id;
    END IF;
    RETURN;
  END IF;

  UPDATE intake_link
     SET used_count = used_count + 1,
         status = CASE WHEN used_count + 1 >= max_uses THEN 'Consumed' ELSE status END,
         consumed_at = CASE WHEN used_count + 1 >= max_uses THEN now() ELSE consumed_at END
   WHERE id = r.id;

  RETURN QUERY SELECT r.id, r.tenant_id, r.kind;
END $$;

REVOKE ALL ON FUNCTION intake_peek(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION intake_claim(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_peek(text) TO c3_app;
GRANT EXECUTE ON FUNCTION intake_claim(text) TO c3_app;
