-- 0032_people_v2.sql - S11 People v2 (2026-07-10): the PIF field model.
-- All columns NULLABLE (existing rows stay valid; capture is incremental).
-- PII tier (date_of_birth, address block, phone, email) is enforced in the
-- READ MODEL by structural omission (canViewPersonPII = owner/operations/hr,
-- owner-ratified C1) - the database stores facts; the API decides visibility.
-- Identity-material fields (names, dob, nationalities) change ONLY through
-- the governed pipeline (owner-ratified C2); operational fields are
-- direct-but-audited. No new tables; person RLS/grants unchanged.

-- The three governed person operations join the approval whitelist.
ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant',
                            'AddAgreement','RenewAgreement','TerminateAgreement',
                            'AddAgreementTerm','UpdateAgreementTerm','RemoveAgreementTerm',
                            'ImportBatch','UpdatePersonIdentity','DeactivatePerson','ReactivatePerson'));

ALTER TABLE person
  ADD COLUMN first_name          text,
  ADD COLUMN last_name           text,
  ADD COLUMN date_of_birth       date,
  ADD COLUMN address_line1       text,
  ADD COLUMN address_line2       text,
  ADD COLUMN address_city        text,
  ADD COLUMN address_country     text,
  ADD COLUMN phone               text,
  ADD COLUMN email               text,
  ADD COLUMN date_of_joining     date,
  ADD COLUMN position            text,
  ADD COLUMN other_nationalities text[] NOT NULL DEFAULT '{}';
