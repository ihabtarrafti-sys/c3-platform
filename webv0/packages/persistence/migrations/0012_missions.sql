-- 0012_missions.sql - Sprint 39: the Missions domain (the CP-parity capstone).
--
-- Two tables, two governance postures:
--   * mission — the DIRECT-BUT-AUDITED shell (Sprint-38 equipment pattern:
--     version guard, no approval coupling, soft deactivation only).
--   * mission_participant — GOVERNED membership. ONE row per
--     (tenant, mission, person) pair, EVER (the UNIQUE constraint is the
--     database half of the SP-certified reactivation semantics: adding a
--     previously-removed participant flips the existing row, never inserts a
--     second one, and a concurrent duplicate insert is a constraint violation
--     that surfaces as a truthful ExecutionFailed).
-- Dates: plain date columns (the Credentials discipline).

-- 1 - registry extensions.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission'));

ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember',
                            'AddCredential','DeactivateCredential','InitiateJourney',
                            'AddMissionParticipant','RemoveMissionParticipant'));

-- 2 - the mission shell.
CREATE TABLE mission (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  mission_id  text NOT NULL,                 -- MSN-XXXX
  name        text NOT NULL,
  game_title  text,
  starts_on   date NOT NULL,
  ends_on     date,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mission_id),
  -- Same-day missions are legal; ending before starting is not.
  CONSTRAINT mission_dates_coherent CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE TRIGGER mission_set_updated_at BEFORE UPDATE ON mission
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 - governed participant membership: one row per pair, ever.
CREATE TABLE mission_participant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  mission_id  text NOT NULL,                 -- MSN-XXXX
  person_id   text NOT NULL,                 -- PER-XXXX
  role        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mission_id, person_id),
  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id)
);
CREATE INDEX mission_participant_person_lookup ON mission_participant (tenant_id, person_id);
CREATE TRIGGER mission_participant_set_updated_at BEFORE UPDATE ON mission_participant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4 - tenant isolation + grants (same posture as the rest of the data plane).
ALTER TABLE mission ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mission
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
ALTER TABLE mission_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_participant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mission_participant
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON mission TO c3_app;
REVOKE DELETE ON mission FROM c3_app;
GRANT SELECT ON mission TO c3_backup;
GRANT SELECT, INSERT, UPDATE ON mission_participant TO c3_app;
REVOKE DELETE ON mission_participant FROM c3_app;
GRANT SELECT ON mission_participant TO c3_backup;
