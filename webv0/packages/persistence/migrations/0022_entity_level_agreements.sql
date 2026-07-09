-- 0022_entity_level_agreements.sql - Tier-0 Sprint 1 (2026-07-10): person-less
-- ENTITY-LEVEL agreements — the S48 fast-follow. Org-to-org paper (sponsorships,
-- partnership fees, venue MOUs) is anchored to one of the tenant's legal
-- entities instead of a person. THE ANCHOR RULE: person_id or entity_id, at
-- least one — an agreement anchored to nothing is meaningless.
--
-- person_id keeps its composite FK (a NULL person_id simply isn't enforced,
-- standard MATCH SIMPLE semantics); every existing row already has a person and
-- is untouched. Approval.target_person_id carries the 'N/A-ENTITY' sentinel for
-- entity-level agreement operations (the member-ops precedent) — no schema
-- change there.

ALTER TABLE agreement ALTER COLUMN person_id DROP NOT NULL;
ALTER TABLE agreement ADD CONSTRAINT agreement_anchor_check
  CHECK (person_id IS NOT NULL OR entity_id IS NOT NULL);
