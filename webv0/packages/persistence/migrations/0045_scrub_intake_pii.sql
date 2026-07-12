-- 0045_scrub_intake_pii.sql — HARDEN-3 H-02 remediation (data-only).
--
-- Before this wave, guest-intake promote folded DOB / email / phone / address
-- into person.notes, which is emitted to every canReadPeople role (visitor
-- included) — a live PII leak that defeats structural omission. The code fix
-- routes those into the PII-gated columns; this migration remediates rows that
-- were ALREADY promoted the old way: relocate the values into the gated columns
-- (only where the column is still empty — never clobber a real edit) and strip
-- the four PII line-types out of notes. The non-PII context (apparel/shoe sizes,
-- the joiner's own note) stays in notes.
--
-- Scoped to the distinctive intake header so ordinary notes are never touched.
-- No schema change — the PII columns already exist (S11).
--
-- NOTE: the migration runner wraps each file in its own transaction + records it
-- in _migrations — no top-level BEGIN/COMMIT and no _migrations insert here.

-- 1 — relocate into the gated columns where currently empty. to_date is lenient
--     (it never aborts the migration); the format guard keeps only date-shaped
--     values. Address components were joined at capture, so the whole string
--     lands in address_line1 (best-effort remediation of legacy rows).
UPDATE person SET
  date_of_birth = COALESCE(
    date_of_birth,
    CASE WHEN notes ~ 'Date of birth: \d{4}-\d{2}-\d{2}'
         THEN to_date(substring(notes from 'Date of birth: (\d{4}-\d{2}-\d{2})'), 'YYYY-MM-DD')
    END),
  email         = COALESCE(email,         NULLIF(substring(notes from 'Email: ([^\n]+)'), '')),
  phone         = COALESCE(phone,         NULLIF(substring(notes from 'Phone: ([^\n]+)'), '')),
  address_line1 = COALESCE(address_line1, NULLIF(substring(notes from 'Address: ([^\n]+)'), ''))
WHERE notes LIKE 'Self-submitted via guest intake%';

-- 2 — strip the four PII line-types (and their leading newline) from notes.
UPDATE person SET
  notes = regexp_replace(notes, '\n?(Date of birth|Email|Phone|Address): [^\n]*', '', 'g')
WHERE notes LIKE 'Self-submitted via guest intake%';
