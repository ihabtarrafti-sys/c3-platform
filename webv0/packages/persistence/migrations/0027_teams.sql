-- 0027_teams.sql - S7 Teams domain (2026-07-10): the structure GK-Core runs
-- its whole P&L on. A TEAM is a game division (R6, HOK - fields rosters,
-- competes, owns tournament money) or a department (Operations, Content).
-- Its short CODE is unique per tenant and feeds structured person codes
-- (R6/PL/007) and every per-team report. Membership is one row per
-- (team, person) with the mission-participant reactivation pattern - history
-- is flips, never deletes. Missions gain an optional team tag: that is what
-- makes "per-team P&L + ROI%" derivable from money that already exists.
-- Direct-audited posture (org structure records facts).

-- 1 - registry: allocate TEAM-XXXX business ids.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team')
         OR kind LIKE 'invoice-series:%');

-- 2 - the team table.
CREATE TABLE team (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  team_id     text NOT NULL,                    -- TEAM-XXXX
  name        text NOT NULL,
  code        text NOT NULL,                    -- R6, HOK, OPS - the reporting key
  kind        text NOT NULL CHECK (kind IN ('GameDivision','Department')),
  game_title  text,                             -- GameDivision display, free text
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, team_id),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER team_set_updated_at BEFORE UPDATE ON team
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE team ENABLE ROW LEVEL SECURITY;
ALTER TABLE team FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON team TO c3_app;
REVOKE DELETE ON team FROM c3_app;
GRANT SELECT ON team TO c3_backup;

-- 3 - membership: one row per (team, person); reactivation flips, no deletes.
CREATE TABLE team_membership (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  team_id     text NOT NULL,                    -- TEAM-XXXX
  person_id   text NOT NULL,                    -- PER-XXXX
  role        text NOT NULL,                    -- role ON THIS TEAM (Player, Coach, ...)
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, team_id, person_id)
);
CREATE INDEX team_membership_person_lookup ON team_membership (tenant_id, person_id);
CREATE TRIGGER team_membership_set_updated_at BEFORE UPDATE ON team_membership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE team_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_membership
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON team_membership TO c3_app;
REVOKE DELETE ON team_membership FROM c3_app;
GRANT SELECT ON team_membership TO c3_backup;

-- 4 - the mission tag: which division fielded the event (nullable; per-team
--     P&L filters on it).
ALTER TABLE mission ADD COLUMN team_id text;
