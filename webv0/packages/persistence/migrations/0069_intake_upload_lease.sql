-- 0069_intake_upload_lease — HARDEN-3.3 Batch A (R4-N01, the in-flight upload lease/drain).
--
-- The public intake route stores upload bytes BEFORE the DB claim. Phase-0 (Exiting + link
-- revocation) stops NEW uploads, but a request already past the peek can still be streaming
-- bytes while the ceremony's sweep runs — its object lands AFTER the sweep listed the prefix,
-- caught only later by finalize's relist (an operator loop, not a guarantee). The exit needs
-- to KNOW when the last in-flight upload has resolved.
--
-- Mechanism: a DB-backed lease (the ceremony runs in the CLI — a different process from the
-- API, so in-process tracking cannot work). The route acquires a lease right after the token
-- peek and releases it when the request resolves (claimed, or refused+tombstoned). The exit's
-- data phase WAITS for the tenant's unexpired leases to drain to zero before enumerating and
-- sweeping. Leases carry a TTL so a crashed request cannot block an exit forever — an HTTP
-- upload cannot outlive its server timeout, so an expired lease is a dead one.
--
-- The table is FORCE RLS with NO policies: only the SECURITY DEFINER gateways (owner) touch
-- it — the public route has no actor (the 0040 intake_peek/claim posture).
CREATE TABLE intake_upload_lease (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  token_hash  text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
CREATE INDEX intake_upload_lease_tenant ON intake_upload_lease (tenant_id, expires_at);
ALTER TABLE intake_upload_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_upload_lease FORCE ROW LEVEL SECURITY;

-- Acquire: refuse (NULL) for an unknown token, a non-Active link, or an Exiting tenant.
-- Lock order = tenant BEFORE link (0068's global order). The tenant FOR SHARE serializes
-- against Phase-0's FOR NO KEY UPDATE, so an acquire either commits BEFORE Phase-0 (and the
-- drain sees its lease) or runs AFTER it (sees Exiting → refused) — no lease can slip past
-- the drain unobserved.
CREATE OR REPLACE FUNCTION intake_lease_acquire(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_state  text;
  v_status text;
  v_id     uuid;
BEGIN
  SELECT il.tenant_id INTO v_tenant FROM intake_link il WHERE il.token_hash = p_token_hash;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT exit_state INTO v_state FROM tenant WHERE id = v_tenant FOR SHARE;
  IF v_state IS DISTINCT FROM 'Active' THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM intake_link WHERE token_hash = p_token_hash;
  IF v_status IS DISTINCT FROM 'Active' THEN RETURN NULL; END IF;
  INSERT INTO intake_upload_lease (tenant_id, token_hash) VALUES (v_tenant, p_token_hash) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Release: keyed on the unguessable lease id the acquirer holds. Idempotent.
CREATE OR REPLACE FUNCTION intake_lease_release(p_lease_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM intake_upload_lease WHERE id = p_lease_id;
$$;

REVOKE ALL ON FUNCTION intake_lease_acquire(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION intake_lease_release(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_lease_acquire(text) TO c3_app;
GRANT EXECUTE ON FUNCTION intake_lease_release(uuid) TO c3_app;
