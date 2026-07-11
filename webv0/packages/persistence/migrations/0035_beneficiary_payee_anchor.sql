-- 0035_beneficiary_payee_anchor.sql - S12 variance closure (2026-07-11).
--
-- The plan of record specifies the beneficiary registry as PAYEE-anchored
-- (exactly one of person | freelancer | vendor — the agreement anchor-rule
-- pattern), "schema ready from day one". 0033 shipped person-only; this
-- migration installs the anchor while the table is EMPTY, so activating the
-- Freelancers domain (or the first vendor-shaped domain) needs no data
-- migration — only the input surface widens when those domains land.
--
-- The freelancer/vendor seats are DORMANT: no domain writes them yet, the
-- API input schema stays person-only, and payouts keep referencing labels.

ALTER TABLE beneficiary
  ALTER COLUMN person_id DROP NOT NULL,
  ADD COLUMN freelancer_id text,  -- FRL-XXXX when the Freelancers domain lands
  ADD COLUMN vendor_id     text,  -- VEN-XXXX when a vendor-shaped domain lands
  ADD CONSTRAINT beneficiary_exactly_one_payee CHECK (
    (person_id IS NOT NULL)::int + (freelancer_id IS NOT NULL)::int + (vendor_id IS NOT NULL)::int = 1
  );

-- Label uniqueness becomes per-PAYEE (was per-person): one live label per
-- payee, whichever seat anchors them. Retired still frees the name.
DROP INDEX beneficiary_live_label_per_person;
CREATE UNIQUE INDEX beneficiary_live_label_per_payee
  ON beneficiary (tenant_id, coalesce(person_id, freelancer_id, vendor_id), lower(label))
  WHERE status <> 'Retired';
