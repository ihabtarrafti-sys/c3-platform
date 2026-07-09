-- 0018_per_diem.sql - Finance Sprint 2 (2026-07-10): per-diem on mission
-- participants. A daily rate (amount in a currency's minor units + its currency)
-- attached to a person's participation in a mission — money metadata, set via a
-- direct-audited action, SEPARATE from the governed roster membership. Both
-- columns are nullable (no per-diem set) and move together (a currency without
-- an amount, or vice-versa, is meaningless — enforced in the domain/use-case).

ALTER TABLE mission_participant ADD COLUMN per_diem_amount_minor bigint;
ALTER TABLE mission_participant ADD COLUMN per_diem_currency text;
ALTER TABLE mission_participant ADD CONSTRAINT mission_participant_per_diem_currency_check
  CHECK (per_diem_currency IS NULL OR per_diem_currency IN ('USD','AED','SAR','EUR','GBP'));
ALTER TABLE mission_participant ADD CONSTRAINT mission_participant_per_diem_paired_check
  CHECK ((per_diem_amount_minor IS NULL) = (per_diem_currency IS NULL));
