-- 0042_departures.sql — Track B: departure workflow (offboarding). A DEPARTURE
-- record marks "this person is leaving"; the readiness checklist is DERIVED (no
-- new mutation paths — items close through their own pipelines). Direct-audited
-- register (RLS ENABLE+FORCE, no DELETE grant, version-guarded). At most one
-- InProgress departure per person (partial unique index). Composite tenant FK to
-- person. The "departure incomplete" cockpit signal reads these rows.
--
-- NOTE: the migration runner wraps each file in its own transaction and records
-- it in _migrations — no top-level BEGIN/COMMIT and no _migrations insert here
-- (the deploy paste, which runs raw psql, adds both).

-- 1 — counter kind.
ALTER TABLE business_id_counter DROP CONSTRAINT business_id_counter_kind_check;
ALTER TABLE business_id_counter ADD CONSTRAINT business_id_counter_kind_check
  CHECK (kind IN ('person','approval','credential','journey','kit','apparel','mission','missionLine','document','agreement','agreementTerm','entity','invoice','team','distribution','claim','delegation','beneficiary','subscription','departure')
         OR kind LIKE 'invoice-series:%');

-- 2 — the departure table.
CREATE TABLE departure (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  departure_id  text NOT NULL,                 -- DEP-XXXX
  person_id     text NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'InProgress' CHECK (status IN ('InProgress','Completed','Cancelled')),
  initiated_by  text NOT NULL,
  initiated_on  date NOT NULL DEFAULT current_date,
  completed_on  date,
  notes         text,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, departure_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id)
);
-- One live offboarding per person; completed/cancelled rows free the slot.
CREATE UNIQUE INDEX departure_one_open_per_person ON departure (tenant_id, person_id) WHERE status = 'InProgress';
CREATE INDEX departure_lookup ON departure (tenant_id, status, initiated_on DESC);
CREATE TRIGGER departure_set_updated_at BEFORE UPDATE ON departure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3 — tenant isolation + grants.
ALTER TABLE departure ENABLE ROW LEVEL SECURITY;
ALTER TABLE departure FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON departure
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON departure TO c3_app;
REVOKE DELETE ON departure FROM c3_app;
GRANT SELECT ON departure TO c3_backup;
