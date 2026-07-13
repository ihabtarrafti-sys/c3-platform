-- 0062_one_open_deactivate_person — HARDEN-3.2 Batch B (R3-N04).
--
-- M-03's departure outbox: the drain find-or-submits a governed DeactivatePerson and
-- links it write-once. The "find" (listApprovals + assertNoOpenPersonOp) is an APP-level
-- check with nothing behind it, so two concurrent drains both see no open DeactivatePerson,
-- both submit, and the person gets TWO deactivation requests.
--
-- Enforce the invariant where it cannot be raced: at most ONE OPEN DeactivatePerson per
-- (tenant, person). A losing drain's second submit fails at the DB (23505); it re-finds
-- the winner's request and links that instead. Terminal DeactivatePerson rows
-- (Executed/Rejected/Withdrawn/ExecutionFailed) are excluded, so a person can be
-- deactivated again later once the prior request is closed.
CREATE UNIQUE INDEX approval_one_open_deactivate_person
  ON approval (tenant_id, target_person_id)
  WHERE operation_type = 'DeactivatePerson' AND status IN ('Submitted', 'InReview', 'Approved');
