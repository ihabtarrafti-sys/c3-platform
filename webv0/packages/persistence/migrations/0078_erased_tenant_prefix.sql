-- 0078_erased_tenant_prefix.sql — HARDEN-3.7 J′: permanent post-finalize
-- erasure authority.
--
-- Cloudflare R2 publishes no maximum delay between a locally-aborted PUT and a
-- later visible object. A finite authority window would therefore repeat the
-- fence fallacy this ledger exists to close. One row is retained FOREVER per
-- finalized tenant; there is deliberately no sweep_until, expiry, retirement
-- function, or application DELETE path. If the provider ever supplies a bound,
-- an owner may review and delete rows manually as a separate ceremony — no such
-- policy is encoded here.
--
-- This is a PLATFORM table, like access_event/blob_tombstone: tenant_ref has NO
-- FK and the table has no tenant_id column, so it survives tenant deletion and
-- stays outside the tenant-table registry. The two prefixes are opaque storage
-- identifiers for DEAD tenants: no PII and no live-tenant data. Consequently the
-- API janitor must see every row without a tenant context, so this table is
-- deliberately NO-RLS. Structural safety comes from write authority instead:
-- only the privileged finalize transaction may INSERT; c3_app may SELECT and
-- update telemetry columns only; neither c3_app nor c3_auth receives DELETE.
--
-- Cost envelope: one tiny row per finalized tenant forever. Tenant erasure is a
-- rare owner ceremony, so N remains small; each pass is O(N + discovered keys).

CREATE TABLE erased_tenant_prefix (
  tenant_ref       uuid PRIMARY KEY,              -- erased tenant; NO FK on purpose
  doc_prefix       text NOT NULL,
  intake_prefix    text NOT NULL,
  finalized_at     timestamptz NOT NULL DEFAULT now(),
  last_swept_at    timestamptz,
  last_result      text,
  straggler_count  bigint NOT NULL DEFAULT 0 CHECK (straggler_count >= 0),

  -- Even the privileged writer cannot accidentally arm a live or neighbouring
  -- prefix: finalize records only the two canonical namespaces for tenant_ref.
  CONSTRAINT erased_tenant_prefix_doc_canonical_chk
    CHECK (doc_prefix = tenant_ref::text || '/'),
  CONSTRAINT erased_tenant_prefix_intake_canonical_chk
    CHECK (intake_prefix = 'intake/' || tenant_ref::text || '/')
);

CREATE INDEX erased_tenant_prefix_finalized_at
  ON erased_tenant_prefix (finalized_at, tenant_ref);

REVOKE ALL ON erased_tenant_prefix FROM PUBLIC, c3_app, c3_auth, c3_backup;
GRANT SELECT ON erased_tenant_prefix TO c3_app;
GRANT UPDATE (last_swept_at, last_result, straggler_count)
  ON erased_tenant_prefix TO c3_app;
GRANT SELECT ON erased_tenant_prefix TO c3_backup;

