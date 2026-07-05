-- 0001_schema.sql - C3 Web V0 relational core.
-- UUID surrogate keys; canonical PER-XXXX / APR-XXXX are tenant-scoped business
-- keys. Approval review state and execution state are distinct columns.
-- Approval payload + submission identity are immutable (trigger-enforced).
-- approval_event and audit_event are append-only (trigger + grant enforced).

-- gen_random_uuid() is in core since PostgreSQL 13; no extension required.

-- -- tenant & identity -------------------------------------------------------
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,          -- canonical lower-case email/UPN
  display_name  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_membership (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE role_assignment (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN
                ('owner','operations','legal','finance','hr','management','visitor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, role)
);

-- -- atomic, server-controlled business-ID allocation (never MAX+1) ----------
CREATE TABLE business_id_counter (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('person','approval')),
  last_value  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind)
);

-- -- governance: approval (created before person for the FK) -----------------
CREATE TABLE approval (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  approval_id       text NOT NULL,                       -- APR-XXXX
  operation_type    text NOT NULL CHECK (operation_type IN ('AddPerson')),
  target_person_id  text NOT NULL,                       -- PENDING-ADDPERSON until executed
  target_id         text,
  reason            text,
  status            text NOT NULL CHECK (status IN
                      ('Submitted','InReview','Approved','Rejected','Executed','ExecutionFailed')),
  payload           jsonb NOT NULL,                      -- immutable snapshot of intent
  submitted_by      text NOT NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by       text,
  reviewed_at       timestamptz,
  rejection_reason  text,
  executed_at       timestamptz,
  execution_error   text,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, approval_id)
);

-- -- operational: person -----------------------------------------------------
CREATE TABLE person (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  person_id              text NOT NULL,                  -- PER-XXXX
  full_name              text NOT NULL,
  ign                    text,
  nationality            text,
  primary_role           text,
  personnel_code         text,
  current_team           text,
  current_game_title     text,
  primary_department     text,
  notes                  text,
  is_active              boolean NOT NULL DEFAULT true,
  -- The approval (business id, APR-XXXX) whose execution created this person.
  -- UNIQUE per tenant => at most one person per approval: the DB-level
  -- idempotency boundary for execute. Composite FK ties it to a real approval.
  created_by_approval_id text,
  version                integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, person_id),
  UNIQUE (tenant_id, created_by_approval_id),
  FOREIGN KEY (tenant_id, created_by_approval_id)
    REFERENCES approval (tenant_id, approval_id)
);

-- -- append-only event streams -----------------------------------------------
CREATE TABLE approval_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  approval_id   text NOT NULL,                            -- APR-XXXX (business id)
  from_status   text,
  to_status     text NOT NULL,
  actor         text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  note          text
);
CREATE INDEX approval_event_lookup ON approval_event (tenant_id, approval_id, at);

CREATE TABLE audit_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  action        text NOT NULL,
  actor         text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  before        jsonb,
  after         jsonb
);
CREATE INDEX audit_event_lookup ON audit_event (tenant_id, entity_type, entity_id, at);

-- -- triggers: updated_at ----------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_set_updated_at BEFORE UPDATE ON approval
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_set_updated_at BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -- trigger: immutable approval submission ----------------------------------
-- Payload and submission facts are a write-once snapshot of intent. Status,
-- review, execution, version and target_person_id (pending - real on execute)
-- remain mutable.
CREATE OR REPLACE FUNCTION approval_immutable_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.approval_id      IS DISTINCT FROM OLD.approval_id
     OR NEW.tenant_id     IS DISTINCT FROM OLD.tenant_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.payload        IS DISTINCT FROM OLD.payload
     OR NEW.submitted_by   IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at   IS DISTINCT FROM OLD.submitted_at
     OR NEW.reason         IS DISTINCT FROM OLD.reason
     OR NEW.target_id      IS DISTINCT FROM OLD.target_id
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'approval submission is immutable (attempt to modify a write-once column on %)', OLD.approval_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_immutable BEFORE UPDATE ON approval
  FOR EACH ROW EXECUTE FUNCTION approval_immutable_guard();

-- -- trigger: append-only event streams --------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_event_append_only BEFORE UPDATE OR DELETE ON approval_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
