-- 0038_request_corrections.sql — Track B1 (2026-07-11): the corrections law.
--
-- "Polish freely until review starts — every change on the record; after
-- that, frozen; corrections are new requests." (owner design, 2026-07-10)
--
-- 1. The payload freeze MOVES from birth to the beginReview boundary:
--    payload/reason may change ONLY while the row is Submitted and STAYS
--    Submitted (an edit can never ride a status transition). From InReview
--    onward, "the approver approves exactly what executes" remains
--    machine-enforced exactly as 0001 promised.
-- 2. edit_count — the "Edited ×N" badge's truth, trigger-guarded monotone.
-- 3. revision_of / superseded_by — the revise-and-resubmit links, both
--    write-once NULL→value (the linking write happens right after the fresh
--    request lands via its op's REAL submit; linking a TERMINAL row is legal —
--    it does not reopen it), both composite-FK'd to real approvals (M-01 law).
--
-- 0001 stays frozen (H-08); the guard function is REPLACED here.

ALTER TABLE approval
  ADD COLUMN edit_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN revision_of   text,
  ADD COLUMN superseded_by text,
  ADD CONSTRAINT approval_revision_of_fk
    FOREIGN KEY (tenant_id, revision_of) REFERENCES approval (tenant_id, approval_id),
  ADD CONSTRAINT approval_superseded_by_fk
    FOREIGN KEY (tenant_id, superseded_by) REFERENCES approval (tenant_id, approval_id);

CREATE OR REPLACE FUNCTION approval_immutable_guard() RETURNS trigger AS $$
BEGIN
  -- Write-once identity: never changes, no matter the status.
  IF NEW.approval_id       IS DISTINCT FROM OLD.approval_id
     OR NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.submitted_by   IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at   IS DISTINCT FROM OLD.submitted_at
     OR NEW.target_id      IS DISTINCT FROM OLD.target_id
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'approval submission is immutable (attempt to modify a write-once column on %)', OLD.approval_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- revision_of: NULL→value once; never rewritten or cleared.
  IF NEW.revision_of IS DISTINCT FROM OLD.revision_of AND OLD.revision_of IS NOT NULL THEN
    RAISE EXCEPTION 'revision_of is write-once (%)', OLD.approval_id USING ERRCODE = 'check_violation';
  END IF;

  -- superseded_by: NULL→value once; never rewritten or cleared.
  IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by AND OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'superseded_by is write-once (%)', OLD.approval_id USING ERRCODE = 'check_violation';
  END IF;

  -- The edit badge never counts down.
  IF NEW.edit_count < OLD.edit_count THEN
    RAISE EXCEPTION 'edit_count is monotone (%)', OLD.approval_id USING ERRCODE = 'check_violation';
  END IF;

  -- Track B1: the corrections boundary. Payload/reason are the SUBMITTER's to
  -- polish while (and only while) the request sits in Submitted.
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    IF OLD.status <> 'Submitted' OR NEW.status <> 'Submitted' THEN
      RAISE EXCEPTION 'approval payload is FROZEN from review onward (%): corrections are new requests', OLD.approval_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
