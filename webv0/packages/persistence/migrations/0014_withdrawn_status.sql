-- 0014_withdrawn_status.sql - Sprint 42: the Withdrawn approval status
-- (the S41 single-owner-wedge remedy). The submitter may cancel their own
-- request while Submitted/InReview; terminal; no side effects. Pending-band
-- semantics are unchanged (Withdrawn is CLOSED), so every duplicate-pending
-- guard unblocks automatically.

ALTER TABLE approval DROP CONSTRAINT approval_status_check;
ALTER TABLE approval ADD CONSTRAINT approval_status_check
  CHECK (status IN ('Submitted','InReview','Approved','Rejected','Executed','ExecutionFailed','Withdrawn'));
