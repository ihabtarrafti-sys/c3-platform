-- 0036_harden2_closure.sql — HARDEN-2 (M-01 relational closure + M-03 columns).
-- The S6–S9 generation (invoice/team/distribution/claim/delegation) stored
-- business references as bare text and promised shapes ("reason mandatory",
-- "label on Paid", "org cut + shares == pool EXACTLY") only in the app layer.
-- This migration makes the DATABASE hold every one of those promises:
--   1. composite tenant FKs — a reference that names a row that does not
--      exist in the same tenant can no longer be written by ANY path;
--   2. a deferred exact-sum constraint trigger on distributions — at commit,
--      org_cut + shares == pool and org_bps + share_bps == 10000, always;
--   3. state-shape CHECKs — voided/rejected/revoked demand their reason,
--      Paid demands paid_on + a payment-source LABEL (never account numbers),
--      a decided claim names its decider;
--   4. version columns on mission_participant / mission_budget (M-03 —
--      the last-write-wins repairs; the guarded predicates live in code).
-- Applied-migration law (H-08): this file is FROZEN once applied.

-- ── 0 — pre-check: existing data must already satisfy the exact-sum law.
--        (The allocator guaranteed it; this proves it at apply time, loudly,
--        BEFORE the trigger below starts claiming protection.)
-- The S8 allocation laws (the domain allocator's contract):
--   (1) org_cut + Σshare amounts == pool, EXACTLY;
--   (2) the players' share_bps split the PLAYER pool among THEMSELVES —
--       Σshare_bps == 10000 whenever share rows exist;
--   (3) a distribution with NO share rows must be a 100% org cut.
DO $$
DECLARE bad record;
BEGIN
  FOR bad IN
    SELECT d.distribution_id,
           d.pool_minor, d.org_cut_minor, d.org_share_bps,
           coalesce(sum(s.amount_minor), 0) AS shares_amount,
           coalesce(sum(s.share_bps), 0)    AS shares_bps,
           count(s.id)                      AS share_rows
      FROM distribution d
      LEFT JOIN distribution_share s
        ON s.tenant_id = d.tenant_id AND s.distribution_id = d.distribution_id
     GROUP BY d.id, d.distribution_id, d.pool_minor, d.org_cut_minor, d.org_share_bps
    HAVING d.org_cut_minor + coalesce(sum(s.amount_minor), 0) <> d.pool_minor
        OR (count(s.id) > 0 AND coalesce(sum(s.share_bps), 0) <> 10000)
        OR (count(s.id) = 0 AND d.org_share_bps <> 10000)
  LOOP
    RAISE EXCEPTION 'HARDEN-2 pre-check: distribution % violates exact-sum (pool=% org_cut=% shares=% org_bps=% share_bps=% rows=%)',
      bad.distribution_id, bad.pool_minor, bad.org_cut_minor, bad.shares_amount, bad.org_share_bps, bad.shares_bps, bad.share_rows;
  END LOOP;
END $$;

-- ── 1 — composite tenant FKs (ADD CONSTRAINT validates existing rows: an
--        orphan reference fails this migration loudly, which is the point).
ALTER TABLE invoice
  ADD CONSTRAINT invoice_entity_fk   FOREIGN KEY (tenant_id, entity_id)  REFERENCES entity (tenant_id, entity_id),
  ADD CONSTRAINT invoice_mission_fk  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id),
  ADD CONSTRAINT invoice_line_fk     FOREIGN KEY (tenant_id, line_id)    REFERENCES mission_line (tenant_id, line_id),
  ADD CONSTRAINT invoice_document_fk FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, document_id);

ALTER TABLE team_membership
  ADD CONSTRAINT team_membership_team_fk   FOREIGN KEY (tenant_id, team_id)   REFERENCES team (tenant_id, team_id),
  ADD CONSTRAINT team_membership_person_fk FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id);

-- mission.team_id is the S7 division tag (nullable — NULL passes MATCH SIMPLE).
ALTER TABLE mission
  ADD CONSTRAINT mission_team_fk FOREIGN KEY (tenant_id, team_id) REFERENCES team (tenant_id, team_id);

ALTER TABLE distribution
  ADD CONSTRAINT distribution_mission_fk FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id),
  ADD CONSTRAINT distribution_line_fk    FOREIGN KEY (tenant_id, line_id)    REFERENCES mission_line (tenant_id, line_id);

ALTER TABLE distribution_share
  ADD CONSTRAINT distribution_share_head_fk   FOREIGN KEY (tenant_id, distribution_id) REFERENCES distribution (tenant_id, distribution_id),
  ADD CONSTRAINT distribution_share_person_fk FOREIGN KEY (tenant_id, person_id)       REFERENCES person (tenant_id, person_id);

ALTER TABLE claim
  ADD CONSTRAINT claim_person_fk  FOREIGN KEY (tenant_id, person_id)  REFERENCES person (tenant_id, person_id),
  ADD CONSTRAINT claim_mission_fk FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id);

-- beneficiary person seat (0035 made it nullable; freelancer/vendor seats stay
-- dormant text until their target tables exist — the CHECK already forbids
-- anchoring more than one seat).
ALTER TABLE beneficiary
  ADD CONSTRAINT beneficiary_person_fk FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id);

-- ── 2 — the exact-sum law, held by the database at COMMIT (deferred so the
--        head and its shares can be written in any order inside one tx).
CREATE OR REPLACE FUNCTION distribution_exact_sum_check() RETURNS trigger AS $$
DECLARE
  head          distribution%ROWTYPE;
  shares_amount bigint;
  shares_bps    integer;
  share_rows    integer;
BEGIN
  SELECT * INTO head FROM distribution
   WHERE tenant_id = NEW.tenant_id AND distribution_id = NEW.distribution_id;
  IF NOT FOUND THEN
    RETURN NULL; -- unreachable while the share→head FK holds; harmless if reordered
  END IF;
  SELECT coalesce(sum(amount_minor), 0), coalesce(sum(share_bps), 0), count(*)
    INTO shares_amount, shares_bps, share_rows
    FROM distribution_share
   WHERE tenant_id = head.tenant_id AND distribution_id = head.distribution_id;
  IF head.org_cut_minor + shares_amount <> head.pool_minor THEN
    RAISE EXCEPTION 'DISTRIBUTION_SUM_VIOLATION: % org_cut(%) + shares(%) <> pool(%)',
      head.distribution_id, head.org_cut_minor, shares_amount, head.pool_minor;
  END IF;
  -- share_bps split the PLAYER pool among themselves (law 2); no rows = 100% org (law 3)
  IF share_rows > 0 AND shares_bps <> 10000 THEN
    RAISE EXCEPTION 'DISTRIBUTION_BPS_VIOLATION: % share_bps sum(%) <> 10000',
      head.distribution_id, shares_bps;
  END IF;
  IF share_rows = 0 AND head.org_share_bps <> 10000 THEN
    RAISE EXCEPTION 'DISTRIBUTION_BPS_VIOLATION: % has no share rows but org share is % bps (must be 10000)',
      head.distribution_id, head.org_share_bps;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER distribution_exact_sum_head
  AFTER INSERT OR UPDATE ON distribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION distribution_exact_sum_check();

CREATE CONSTRAINT TRIGGER distribution_exact_sum_share
  AFTER INSERT OR UPDATE ON distribution_share
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION distribution_exact_sum_check();

-- ── 3 — state-shape CHECKs (each encodes a promise the app already keeps;
--        ADD CONSTRAINT validates every existing row).
ALTER TABLE invoice
  ADD CONSTRAINT invoice_total_exact CHECK (total_minor = subtotal_minor + vat_minor),
  ADD CONSTRAINT invoice_void_shape  CHECK ((status = 'Voided') = (voided_reason IS NOT NULL));

ALTER TABLE claim
  ADD CONSTRAINT claim_rejection_shape CHECK ((status = 'Rejected') = (rejection_reason IS NOT NULL)),
  ADD CONSTRAINT claim_paid_shape CHECK (
    ((status = 'Paid') = (paid_on IS NOT NULL)) AND
    ((status = 'Paid') = (payment_source_label IS NOT NULL))
  ),
  ADD CONSTRAINT claim_decider_shape CHECK (status = 'Submitted' OR reviewed_by IS NOT NULL);

ALTER TABLE distribution
  ADD CONSTRAINT distribution_revoke_shape CHECK ((status = 'Revoked') = (revoked_reason IS NOT NULL));

ALTER TABLE distribution_share
  ADD CONSTRAINT distribution_share_paid_shape CHECK (
    ((payout_status = 'Paid') = (paid_on IS NOT NULL)) AND
    ((payout_status = 'Paid') = (payment_source_label IS NOT NULL))
  );

ALTER TABLE delegation
  ADD CONSTRAINT delegation_revoke_shape CHECK (
    ((revoked_at IS NULL) = (revoked_by IS NULL)) AND
    ((revoked_at IS NULL) = (revoke_reason IS NULL))
  );

-- ── 4 — M-03: version columns where absent (guarded predicates live in code;
--        every participant/budget write now increments its row version).
ALTER TABLE mission_participant ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE mission_budget      ADD COLUMN version integer NOT NULL DEFAULT 0;
