-- 0057_exit_quiesce_definer — HARDEN-3.1 Batch C fix (R2-N01).
--
-- The 0056 write-quiesce trigger functions read the `tenant` table to test
-- exit_state. But `tenant` is a DIRECTORY table on which c3_app holds ZERO grants
-- (migration 0008 — the app reaches directory tables ONLY through owner-owned
-- SECURITY DEFINER functions). As plain (SECURITY INVOKER) functions the triggers
-- therefore threw "permission denied for table tenant" as c3_app, turning every
-- document / intake / photo write into a 500.
--
-- Fix: run the guard functions as the owner, exactly like the other directory-
-- crossing functions (0008/0034/0040) — SECURITY DEFINER SET search_path = public.
-- They only read one boolean (is this tenant Exiting?) keyed on NEW.tenant_id and
-- take no other caller input, so the elevated read is narrow and safe. `tenant`
-- has no RLS, so the owner sees the row directly. The triggers themselves are
-- unchanged — they reference these functions by name.
CREATE OR REPLACE FUNCTION refuse_blob_write_during_exit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant WHERE id = NEW.tenant_id AND exit_state = 'Exiting') THEN
    RAISE EXCEPTION 'tenant is exiting — new object writes are refused (quiesced for erasure)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION refuse_photo_write_during_exit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.photo_storage_key IS NOT NULL
     AND NEW.photo_storage_key IS DISTINCT FROM OLD.photo_storage_key
     AND EXISTS (SELECT 1 FROM tenant WHERE id = NEW.tenant_id AND exit_state = 'Exiting') THEN
    RAISE EXCEPTION 'tenant is exiting — photo writes are refused (quiesced for erasure)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
