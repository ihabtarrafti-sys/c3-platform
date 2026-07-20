-- 0089_document_comms_owner_types.sql — widen the document owner-type universe
-- for Comms attachments + add record_kind (Comms build Phase 2; Neural's pinned
-- 0089 doc-dispatch spec §E/§F).
--
-- Two NEW server-owned owner types: CommsMessage (an ordinary chat attachment —
-- the Document table as the PRIVATE byte/inventory record, ABSENT from the
-- Documents register) and CommsObligation (evidence — registered, appears with
-- provenance). record_kind carries the distinction: every existing document is
-- registered evidence (the domain's historical meaning), so existing rows default
-- to 'RegisteredEvidence' via a DDL-time backfill — NOT a bulk UPDATE, which would
-- trip the BEFORE UPDATE set_updated_at trigger on every row and shift updated_at.
--
-- No Comms document is created yet: the read/attach/download paths fail CLOSED on
-- the two new types until the Comms module's own use-cases wire the record-scoped
-- guard. This migration only opens the schema. The current 7-type CHECK is pinned
-- by 0029_claims.sql:53-55. The runner wraps this file in its own transaction.

ALTER TABLE document DROP CONSTRAINT document_owner_type_check;
ALTER TABLE document ADD CONSTRAINT document_owner_type_check
  CHECK (owner_type IN ('Agreement','Mission','Person','Credential','Entity','Invoice','Claim','CommsMessage','CommsObligation'));

ALTER TABLE document ADD COLUMN record_kind text NOT NULL DEFAULT 'RegisteredEvidence'
  CHECK (record_kind IN ('Attachment','RegisteredEvidence'));
