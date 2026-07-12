-- 0047_reactivate_credential_op.sql — HARDEN-3 recycle door (owner ruling #1).
--
-- Restoring a soft-removed credential from the recycle bin submits a GOVERNED
-- ReactivateCredential approval (symmetric with DeactivateCredential). The
-- approval.operation_type whitelist CHECK must admit the new op type, or the
-- insert is refused at the database boundary. Same drop-and-re-add pattern as
-- 0033.

ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','ReactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant',
                            'AddAgreement','RenewAgreement','TerminateAgreement',
                            'AddAgreementTerm','UpdateAgreementTerm','RemoveAgreementTerm',
                            'ImportBatch','UpdatePersonIdentity','DeactivatePerson','ReactivatePerson',
                            'UpdateCredentialFacts','AddBeneficiary','UpdateBeneficiary','RetireBeneficiary'));
