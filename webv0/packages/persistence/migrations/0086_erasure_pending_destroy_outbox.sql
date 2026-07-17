-- 0086_erasure_pending_destroy_outbox.sql — Re-skin chapter rider R10-N01.
--
-- Round-10 §4.2/§8: the janitor's straggler catch counted + audited + DELETED in
-- one uncommitted transaction (erasureJanitor.ts), so a process/DB/connection
-- loss AFTER DeleteObject but BEFORE the commit destroyed the dead byte while
-- rolling back its counter and audit — a byte destroyed with its promised record
-- lost, unrecoverable (the object is gone, so no later pass rediscovers it).
--
-- Fix (a committed, idempotent pre-delete outbox): the janitor now COMMITS every
-- catch (counter + audit + the caught keys) BEFORE any DeleteObject, then
-- destroys and confirms in a second transaction. This column is that outbox — the
-- keys caught-but-not-yet-confirmed-destroyed for a dead tenant. Normally '[]';
-- non-empty only briefly during a catch or after a crash. On confirm, a key is
-- removed only after ITS delete returned success-or-absent.
--
-- Guard-stack interaction (verified): the dead-only / no-resurrection / isolation
-- guards fire only on `AFTER INSERT OR UPDATE OF tenant_ref` (0079/0081); a write
-- touching ONLY pending_destroy never changes tenant_ref, so it does not invoke
-- them at all — exactly like the existing last_swept_at/last_result telemetry
-- writes. pending_destroy is opaque dead-tenant storage keys (canonical prefix,
-- no PII), and NEVER enters audit_event (the 0080 event shape stays key-free).

ALTER TABLE public.erased_tenant_prefix
  ADD COLUMN pending_destroy jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.erased_tenant_prefix
  ADD CONSTRAINT erased_tenant_prefix_pending_destroy_array_chk
    CHECK (jsonb_typeof(pending_destroy) = 'array');

-- The least-privileged janitor role writes the outbox column (append on catch,
-- prune on confirm). It remains barred from the identity columns and DELETE.
GRANT UPDATE (pending_destroy) ON public.erased_tenant_prefix TO c3_app;
