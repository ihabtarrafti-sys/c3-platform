-- 0065_deactivate_open_status_align — HARDEN-3.3 Batch C (R4-N06).
--
-- 0062's partial-unique excluded ExecutionFailed, but the app's single definition of "open"
-- for person ops (submitPersonOps.ts OPEN_STATUSES) INCLUDES ExecutionFailed and treats it as
-- recoverable/actionable. So an ExecutionFailed DeactivatePerson and a fresh Submitted one
-- could coexist for the same person — the exact double the index exists to forbid, slipping
-- through because the DB predicate and the code predicate disagreed. Realign the DB to the
-- code's one authoritative open-status set.
--
-- The recreated unique index fails atomically if historical duplicates exist. We do NOT
-- auto-resolve them — silently picking a winner among governed compliance rows would be a
-- data decision no migration should make. Surface the count loudly so an operator resolves
-- them first; the index is then created against clean data.
DO $$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT tenant_id, target_person_id
    FROM approval
    WHERE operation_type = 'DeactivatePerson'
      AND status IN ('Submitted', 'InReview', 'Approved', 'ExecutionFailed')
    GROUP BY tenant_id, target_person_id
    HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'R4-N06: % (tenant, person) group(s) already hold more than one OPEN DeactivatePerson (now incl. ExecutionFailed) — resolve the duplicates before this migration can enforce one-open-per-person.', dup;
  END IF;
END $$;

DROP INDEX IF EXISTS approval_one_open_deactivate_person;
CREATE UNIQUE INDEX approval_one_open_deactivate_person
  ON approval (tenant_id, target_person_id)
  WHERE operation_type = 'DeactivatePerson'
    AND status IN ('Submitted', 'InReview', 'Approved', 'ExecutionFailed');
