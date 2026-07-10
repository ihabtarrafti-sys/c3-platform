-- 0025_import_batches.sql - S5 import/export (2026-07-10): governance at batch
-- scale. A VALIDATED import file becomes ONE ImportBatch approval (ops stages,
-- the owner executes - requester != approver); execution inserts every row in
-- a single transaction with per-row audit.
--
-- created_by_approval_id becomes NULLABLE on person/credential/agreement:
-- imported rows are not created by a per-row approval - their provenance is
-- the BATCH approval, carried in the per-row audit events. The UNIQUE
-- (tenant_id, created_by_approval_id) indexes SURVIVE untouched: Postgres
-- UNIQUE ignores NULLs, so the one-row-per-AddPerson/AddCredential/
-- AddAgreement idempotency boundary is exactly as strong as before for
-- pipeline-created rows.

-- 1 - the new governed operation.
ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant',
                            'AddAgreement','RenewAgreement','TerminateAgreement',
                            'AddAgreementTerm','UpdateAgreementTerm','RemoveAgreementTerm',
                            'ImportBatch'));

-- 2 - imported rows carry NULL creator-approval; the batch approval is the
--     provenance (audit-carried).
ALTER TABLE person ALTER COLUMN created_by_approval_id DROP NOT NULL;
ALTER TABLE credential ALTER COLUMN created_by_approval_id DROP NOT NULL;
ALTER TABLE agreement ALTER COLUMN created_by_approval_id DROP NOT NULL;
