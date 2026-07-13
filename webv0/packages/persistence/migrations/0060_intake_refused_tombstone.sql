-- 0060_intake_refused_tombstone — HARDEN-3.2 Batch A (R3-N02, part 2).
--
-- The public intake route stores upload bytes BEFORE the DB claim, and on a refused
-- claim it best-effort-deletes them with a SWALLOWED failure (app.ts `.catch(()=>{})`)
-- — a failed delete stranded the bytes with no record. The fix is the M-02 pattern: on
-- refusal, record the stored keys as durable wipe tombstones so a drain / the exit sweep
-- removes them. But the route is PUBLIC (no actor) and blob_tombstone is FORCE RLS
-- (tenant_ref = current_tenant_id()), so the write needs a SECURITY DEFINER gateway keyed
-- on the token — exactly like intake_peek / intake_claim (0040).

-- Admit the new reason. (blob_tombstone is not touched by the quiesce trigger, so this
-- INSERT succeeds even while the tenant is Exiting — which is the whole point.)
ALTER TABLE blob_tombstone DROP CONSTRAINT blob_tombstone_reason_check;
ALTER TABLE blob_tombstone ADD CONSTRAINT blob_tombstone_reason_check
  CHECK (reason IN ('exit', 'intake_reject', 'intake_refused'));

-- Token-keyed definer gateway: resolve the tenant from the token (the caller proved
-- possession by uploading to it) and durably tombstone the refused-claim's keys. Runs as
-- the owner, so it bypasses FORCE RLS to write tenant_ref = the link's tenant. Idempotent
-- per (tenant, key, reason). Returns the number of keys recorded.
CREATE OR REPLACE FUNCTION intake_tombstone_refused(p_token_hash text, p_keys text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_key    text;
  v_n      integer := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM intake_link WHERE token_hash = p_token_hash;
  IF v_tenant IS NULL THEN
    RETURN 0; -- unknown token: nothing we can attribute
  END IF;
  FOREACH v_key IN ARRAY p_keys LOOP
    INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason)
    VALUES (v_tenant, v_key, 'intake', 'intake_refused')
    ON CONFLICT (tenant_ref, storage_key, reason) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION intake_tombstone_refused(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_tombstone_refused(text, text[]) TO c3_app;
