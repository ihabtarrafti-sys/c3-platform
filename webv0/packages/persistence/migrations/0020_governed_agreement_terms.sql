-- 0020_governed_agreement_terms.sql - Finance Sprint 3.5 (2026-07-10): agreement
-- financial TERMS are material money, so every change is dual-controlled. The
-- three term operations (add / edit / remove, all kinds) now ride the approval
-- pipeline (requester != approver; the owner executes). This migration only
-- widens the approval operation_type CHECK to admit them — the agreement_term
-- table itself (0019) is unchanged; the executor writes it through the same
-- version-guarded writeTx methods the direct path used, now gated behind
-- approval + execution.

ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant',
                            'AddAgreement','RenewAgreement','TerminateAgreement',
                            'AddAgreementTerm','UpdateAgreementTerm','RemoveAgreementTerm'));
