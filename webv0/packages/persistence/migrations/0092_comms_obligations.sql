-- 0092_comms_obligations.sql — the Comms obligation family (Comms build Phase 2,
-- Temper's spine §6.4 / §4.3). The scar-killer: a durable deadline record with a
-- versioned state machine (Open → Delivered → Accepted → Done, + Cancelled and
-- reopen), immutable transition/evidence histories, UUID-keyed principals (the
-- binding graft: app_user.id, never email).
--
-- The source-message reference is a BUSINESS ID, deliberately NOT a restrictive
-- FK: an obligation born in a DM survives that message's retention expiry (§213).
-- Evidence rows FK the document table — evidence Documents use owner
-- 'CommsObligation' (0089), so they too survive DM expiry.
--
-- Ships DORMANT: no obligation is created yet; the transition gateway (who may
-- accept/reject/complete, the Delivered-requires-evidence rule, attestation
-- notes, reopen reasons) lands with the obligation use-cases. The runner wraps
-- this file in its own transaction.

-- ── comms_obligation ── the durable deadline record ──────────────────────────
CREATE TABLE comms_obligation (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  obligation_id        text NOT NULL,                                 -- OBL-#### business id
  thread_id            text NOT NULL,
  source_message_id    text,                                          -- business id, NO FK (survives DM expiry)
  description          text NOT NULL CHECK (char_length(description) > 0),
  accountable_user_id  uuid NOT NULL,
  requester_user_id    uuid NOT NULL,
  -- beneficiary: an account (uuid) or an external label — exactly one shape.
  beneficiary_kind     text NOT NULL CHECK (beneficiary_kind IN ('account','external')),
  beneficiary_user_id  uuid,
  beneficiary_label    text,
  due_at               timestamptz NOT NULL,                          -- exact RFC 3339 due instant (UTC)
  evidence_requirement text NOT NULL CHECK (char_length(evidence_requirement) > 0),
  -- acceptance authority: an account uuid, or an external label PLUS an internal
  -- proxy uuid — so acceptance_user_id is ALWAYS present (authority or proxy).
  acceptance_kind      text NOT NULL CHECK (acceptance_kind IN ('account','external')),
  acceptance_user_id   uuid NOT NULL,
  acceptance_label     text,
  state                text NOT NULL DEFAULT 'Open' CHECK (state IN ('Open','Delivered','Accepted','Done','Cancelled')),
  version              integer NOT NULL DEFAULT 0,
  created_by_user_id   uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, obligation_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES comms_thread (tenant_id, thread_id),
  -- kind-legal shapes (the 0090 lesson: split-column fields need FULL binding,
  -- both branches exhaustive — beneficiary_kind/acceptance_kind are NOT NULL and
  -- CHECK-bound to two values, so these two-branch ORs are total).
  CONSTRAINT comms_obligation_beneficiary_shape CHECK (
    (beneficiary_kind = 'account'  AND beneficiary_user_id IS NOT NULL AND beneficiary_label IS NULL) OR
    (beneficiary_kind = 'external' AND beneficiary_label IS NOT NULL AND beneficiary_user_id IS NULL)
  ),
  CONSTRAINT comms_obligation_acceptance_shape CHECK (
    (acceptance_kind = 'account'  AND acceptance_label IS NULL) OR
    (acceptance_kind = 'external' AND acceptance_label IS NOT NULL)
  )
);
CREATE INDEX comms_obligation_by_thread      ON comms_obligation (tenant_id, thread_id, state, due_at, obligation_id);
CREATE INDEX comms_obligation_by_accountable ON comms_obligation (tenant_id, accountable_user_id, state, due_at, obligation_id);
CREATE INDEX comms_obligation_by_acceptance  ON comms_obligation (tenant_id, acceptance_user_id, state, due_at, obligation_id);
CREATE TRIGGER comms_obligation_set_updated_at BEFORE UPDATE ON comms_obligation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE comms_obligation ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_obligation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_obligation
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON comms_obligation TO c3_app;
REVOKE DELETE ON comms_obligation FROM c3_app;
GRANT SELECT ON comms_obligation TO c3_backup;

-- ── comms_obligation_event ── append-only transition history ─────────────────
CREATE TABLE comms_obligation_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  obligation_id      text NOT NULL,
  event_type         text NOT NULL,                                   -- gateway vocabulary (Created, EvidenceDelivered, …)
  from_state         text CHECK (from_state IN ('Open','Delivered','Accepted','Done','Cancelled')),
  to_state           text NOT NULL CHECK (to_state IN ('Open','Delivered','Accepted','Done','Cancelled')),
  actor_user_id      uuid NOT NULL,
  actor_label        text,
  before_json        jsonb,                                           -- constrained at the gateway
  after_json         jsonb,
  reason             text,
  attestation        text,                                            -- external-proxy acceptance note
  delivery_id        uuid,                                            -- the evidence delivery, when applicable
  client_mutation_id uuid NOT NULL,
  at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, actor_user_id, client_mutation_id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES comms_obligation (tenant_id, obligation_id)
);
CREATE INDEX comms_obligation_event_history ON comms_obligation_event (tenant_id, obligation_id, at, id);
CREATE TRIGGER comms_obligation_event_append_only BEFORE UPDATE OR DELETE ON comms_obligation_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_obligation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_obligation_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_obligation_event
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_obligation_event TO c3_app;
REVOKE UPDATE, DELETE ON comms_obligation_event FROM c3_app;
GRANT SELECT ON comms_obligation_event TO c3_backup;

-- ── comms_obligation_link ── typed links on the obligation ───────────────────
CREATE TABLE comms_obligation_link (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  obligation_id      text NOT NULL,
  target_type        text NOT NULL CHECK (target_type IN ('Approval','Mission','Journey','Person','Credential','Document','Message','Obligation')),
  target_id          text NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, obligation_id, target_type, target_id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES comms_obligation (tenant_id, obligation_id)
);
CREATE TRIGGER comms_obligation_link_append_only BEFORE UPDATE OR DELETE ON comms_obligation_link
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_obligation_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_obligation_link FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_obligation_link
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_obligation_link TO c3_app;
REVOKE UPDATE, DELETE ON comms_obligation_link FROM c3_app;
GRANT SELECT ON comms_obligation_link TO c3_backup;

-- ── comms_evidence_delivery ── append-only evidence record ───────────────────
-- Evidence Documents use owner 'CommsObligation' (0089), so they survive expiry
-- of a source DM message; the source references here are business ids (no FK).
CREATE TABLE comms_evidence_delivery (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  obligation_id       text NOT NULL,
  document_id         text NOT NULL,
  source_message_id   text,                                           -- provenance, business id
  source_document_id  text,                                           -- provenance (promoted attachment), business id
  delivered_by_user_id uuid NOT NULL,
  deliverer_label     text,
  note                text,
  delivered_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, obligation_id, document_id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES comms_obligation (tenant_id, obligation_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, document_id)
);
CREATE TRIGGER comms_evidence_delivery_append_only BEFORE UPDATE OR DELETE ON comms_evidence_delivery
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE comms_evidence_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms_evidence_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comms_evidence_delivery
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON comms_evidence_delivery TO c3_app;
REVOKE UPDATE, DELETE ON comms_evidence_delivery FROM c3_app;
GRANT SELECT ON comms_evidence_delivery TO c3_backup;
