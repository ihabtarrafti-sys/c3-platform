-- 0010_journeys.sql - Sprint 37: the Journeys domain.
--
-- A journey belongs to one person and carries the CP-parity lifecycle:
-- Active <-> Suspended; Active/Suspended -> Completed | Cancelled (terminal).
-- Creation is GOVERNED (InitiateJourney approval; one journey per approval);
-- transitions are DIRECT-BUT-AUDITED (application-enforced state machine with
-- a version guard; the DB additionally enforces status validity and the
-- terminal/ended coherence invariant below). Dates: plain date columns.

-- 1 - registry extensions.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey'));

ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember','AddCredential','DeactivateCredential','InitiateJourney'));

-- 2 - the journey table.
CREATE TABLE journey (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  journey_id              text NOT NULL,                 -- JRN-XXXX
  person_id               text NOT NULL,                 -- owning PER-XXXX
  journey_type            text NOT NULL,
  title                   text,
  started_on              date NOT NULL,
  ended_on                date,                          -- stamped by complete/cancel
  status                  text NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active','Suspended','Completed','Cancelled')),
  notes                   text,
  created_by_approval_id  text NOT NULL,
  version                 integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, journey_id),
  UNIQUE (tenant_id, created_by_approval_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id),
  FOREIGN KEY (tenant_id, created_by_approval_id) REFERENCES approval (tenant_id, approval_id),
  -- Terminal/ended coherence: exactly the closed statuses carry an end date.
  CONSTRAINT journey_terminal_ended_coherent
    CHECK ((status IN ('Completed','Cancelled')) = (ended_on IS NOT NULL))
);
CREATE INDEX journey_person_lookup ON journey (tenant_id, person_id);

CREATE TRIGGER journey_set_updated_at BEFORE UPDATE ON journey
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - tenant isolation: data-plane, ENABLE + FORCE.
ALTER TABLE journey ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journey
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4 - grants: same posture as person/credential (no DELETE).
GRANT SELECT, INSERT, UPDATE ON journey TO c3_app;
REVOKE DELETE ON journey FROM c3_app;
GRANT SELECT ON journey TO c3_backup;
