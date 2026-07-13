-- 0053_migration_correctives — HARDEN-3.1 Batch E (R2-N04 + R2-N05).
-- Corrective migrations for two immutable, already-applied data transforms.

-- ── R2-N04: coherent income payment_status vs receipt facts ────────────────────
-- 0048 blindly set every NULL income status to 'Expected'. A NULL-status income
-- row that carried receipt facts was legal under 0047 (the CHECKs pass on SQL
-- UNKNOWN), and 'Expected' + receipt facts then violates mission_line_received_only
-- (0048 aborts instead of repairing). 0048 is immutable and already applied, so
-- this encodes the COHERENT repair as go-forward defense: an income line that
-- carries a received amount IS Received. On a DB where 0048 applied cleanly this
-- is a no-op; it exists so the coherent shape is asserted, not assumed.
UPDATE mission_line SET payment_status = 'Received'
  WHERE direction = 'Income'
    AND received_amount_minor IS NOT NULL
    AND payment_status IS DISTINCT FROM 'Received';

DO $$
DECLARE bad integer;
BEGIN
  -- An FX snapshot with no received amount is an incoherent shape the simple
  -- repair cannot resolve — surface it loudly rather than leave it.
  SELECT count(*) INTO bad FROM mission_line
   WHERE direction = 'Income' AND received_usd_per_unit IS NOT NULL AND received_amount_minor IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'R2-N04: % income line(s) carry a received FX snapshot with no received amount — manual repair required before this migration', bad;
  END IF;
END $$;

-- ── R2-N05: re-derive gated PII from the AUTHORITATIVE intake payload ──────────
-- 0045's regex scrub could (a) promote a free-text joiner note like
-- "Email: x@y.com" into the gated email column, and (b) strip only through the
-- first newline, leaving a multiline address's continuation in notes. The
-- promoting submission's payload is the source of truth: re-derive the gated
-- columns from it (overwriting any manufactured value; NULL where the form had
-- none), then strip the structured PII header block from notes multiline-safely.
UPDATE person p SET
  date_of_birth = CASE WHEN (s.payload->>'dateOfBirth') ~ '^\d{4}-\d{2}-\d{2}$' THEN (s.payload->>'dateOfBirth')::date ELSE NULL END,
  email         = NULLIF(btrim(s.payload->>'email'), ''),
  phone         = NULLIF(btrim(s.payload->>'phone'), ''),
  address_line1 = NULLIF(btrim(s.payload->>'addressLine1'), '')
  FROM intake_submission s
 WHERE s.promoted_person_id = p.person_id
   AND s.payload IS NOT NULL
   AND p.notes LIKE 'Self-submitted via guest intake%';

-- Rather than regex-strip the (possibly multiline) PII out of notes — which is
-- how 0045 left a residual — RECONSTRUCT the note deterministically from the
-- authoritative payload's NON-PII fields only, in the exact canonical shape
-- onboardingToAddPerson produces. No PII residual is possible, by construction.
UPDATE person p SET notes =
  CASE WHEN concat_ws(E'\n',
         CASE WHEN NULLIF(btrim(s.payload->>'apparelSize'),'') IS NOT NULL THEN 'Apparel size: ' || btrim(s.payload->>'apparelSize') END,
         CASE WHEN NULLIF(btrim(s.payload->>'shoeSize'),'')    IS NOT NULL THEN 'Shoe size: '    || btrim(s.payload->>'shoeSize') END,
         CASE WHEN NULLIF(btrim(s.payload->>'note'),'')        IS NOT NULL THEN 'Note from joiner: ' || btrim(s.payload->>'note') END
       ) = '' THEN 'Self-submitted via guest intake.'
       ELSE 'Self-submitted via guest intake —' || E'\n' || concat_ws(E'\n',
         CASE WHEN NULLIF(btrim(s.payload->>'apparelSize'),'') IS NOT NULL THEN 'Apparel size: ' || btrim(s.payload->>'apparelSize') END,
         CASE WHEN NULLIF(btrim(s.payload->>'shoeSize'),'')    IS NOT NULL THEN 'Shoe size: '    || btrim(s.payload->>'shoeSize') END,
         CASE WHEN NULLIF(btrim(s.payload->>'note'),'')        IS NOT NULL THEN 'Note from joiner: ' || btrim(s.payload->>'note') END
       )
  END
  FROM intake_submission s
 WHERE s.promoted_person_id = p.person_id AND s.payload IS NOT NULL AND p.notes LIKE 'Self-submitted via guest intake%';
