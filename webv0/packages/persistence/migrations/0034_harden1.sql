-- 0034_harden1.sql - HARDEN-1 (2026-07-11): audit H-04 + H-05 database halves.
-- (H-06 is code-side; the M-item constraints ride here too where they are DDL.)
--
-- H-04: the last-owner invariant was check-then-write — two concurrent owner
-- demotions/deactivations could each see the other as "another active owner"
-- and both commit, leaving an ownerless tenant. Both SECURITY DEFINER
-- functions are REPLACED (0008 stays frozen per H-08) with bodies identical
-- except ONE line: a per-tenant transaction-scoped advisory lock taken before
-- any check, serializing all member role/active mutations within a tenant.
--
-- H-05: two triggers make the worst finance states unrepresentable at the
-- database boundary (the app-side lock-order lands in the same commit):
--   * a payout cannot flip to Paid under a non-Live distribution head;
--   * a mission line's money truth cannot change while a Live distribution
--     references it (amount, currency, received amount, active flag).

-- ── H-04: member_set_role, serialized ────────────────────────────────────────
CREATE OR REPLACE FUNCTION member_set_role(p_user uuid, p_role text, p_actor_email text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; prev text; tgt_email text;
BEGIN
  tid := member_require_tenant();
  -- HARDEN-1 H-04: serialize member mutations per tenant (advisory, tx-scoped).
  PERFORM pg_advisory_xact_lock(hashtextextended(tid::text, 42));
  IF NOT EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tid AND user_id = p_user) THEN
    RAISE EXCEPTION 'C3E:NOT_FOUND: target is not a member of this organization' USING ERRCODE = 'P0002';
  END IF;
  SELECT email INTO tgt_email FROM app_user WHERE id = p_user;
  IF tgt_email = lower(trim(p_actor_email)) THEN
    RAISE EXCEPTION 'C3E:SELF_ADMINISTRATION_BLOCKED: a member may not change their own role'
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(role, ',' ORDER BY role) INTO prev
    FROM role_assignment WHERE tenant_id = tid AND user_id = p_user;
  IF position('owner' IN coalesce(prev, '')) > 0 AND p_role <> 'owner' AND NOT EXISTS (
    SELECT 1 FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
     WHERE ra.tenant_id = tid AND ra.role = 'owner' AND u.is_active AND ra.user_id <> p_user
  ) THEN
    RAISE EXCEPTION 'C3E:LAST_OWNER_PROTECTED: cannot demote the last active owner' USING ERRCODE = '23514';
  END IF;
  DELETE FROM role_assignment WHERE tenant_id = tid AND user_id = p_user;
  INSERT INTO role_assignment (tenant_id, user_id, role) VALUES (tid, p_user, p_role);
  RETURN coalesce(prev, '');
END $$;

-- ── H-04: member_set_active, serialized ──────────────────────────────────────
CREATE OR REPLACE FUNCTION member_set_active(p_user uuid, p_active boolean, p_actor_email text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; tgt_email text; tgt_active boolean; shared boolean;
BEGIN
  tid := member_require_tenant();
  -- HARDEN-1 H-04: serialize member mutations per tenant (advisory, tx-scoped).
  PERFORM pg_advisory_xact_lock(hashtextextended(tid::text, 42));
  IF NOT EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tid AND user_id = p_user) THEN
    RAISE EXCEPTION 'C3E:NOT_FOUND: target is not a member of this organization' USING ERRCODE = 'P0002';
  END IF;
  SELECT email, is_active INTO tgt_email, tgt_active FROM app_user WHERE id = p_user;
  IF tgt_email = lower(trim(p_actor_email)) THEN
    RAISE EXCEPTION 'C3E:SELF_ADMINISTRATION_BLOCKED: a member may not change their own access'
      USING ERRCODE = '42501';
  END IF;

  IF NOT p_active THEN
    IF NOT tgt_active THEN
      RAISE EXCEPTION 'C3E:CONFLICT: member is already deactivated' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM role_assignment WHERE tenant_id = tid AND user_id = p_user AND role = 'owner')
       AND NOT EXISTS (
         SELECT 1 FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
          WHERE ra.tenant_id = tid AND ra.role = 'owner' AND u.is_active AND ra.user_id <> p_user
       ) THEN
      RAISE EXCEPTION 'C3E:LAST_OWNER_PROTECTED: cannot deactivate the last active owner' USING ERRCODE = '23514';
    END IF;
    shared := EXISTS (SELECT 1 FROM tenant_membership WHERE user_id = p_user AND tenant_id <> tid);
    IF shared THEN
      -- Shared user: revoke THIS org's access only; they stay active elsewhere.
      DELETE FROM role_assignment WHERE tenant_id = tid AND user_id = p_user;
      DELETE FROM tenant_membership WHERE tenant_id = tid AND user_id = p_user;
      RETURN 'membership-removed';
    ELSE
      UPDATE app_user SET is_active = false WHERE id = p_user;
      RETURN 'deactivated-sole';
    END IF;
  ELSE
    IF tgt_active THEN
      RAISE EXCEPTION 'C3E:CONFLICT: member is already active' USING ERRCODE = '23514';
    END IF;
    UPDATE app_user SET is_active = true WHERE id = p_user;
    RETURN 'reactivated';
  END IF;
END $$;

-- ── H-05a: a payout cannot flip to Paid under a non-Live head ────────────────
CREATE OR REPLACE FUNCTION distribution_share_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payout_status = 'Paid' AND OLD.payout_status <> 'Paid' THEN
    IF NOT EXISTS (
      SELECT 1 FROM distribution d
       WHERE d.tenant_id = NEW.tenant_id AND d.distribution_id = NEW.distribution_id AND d.status = 'Live'
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: payouts can only be marked Paid under a LIVE distribution' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER distribution_share_paid_guard BEFORE UPDATE ON distribution_share
  FOR EACH ROW EXECUTE FUNCTION distribution_share_paid_guard();

-- ── H-05b: source money is frozen while a Live distribution references it ────
CREATE OR REPLACE FUNCTION mission_line_distribution_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.received_amount_minor IS DISTINCT FROM OLD.received_amount_minor
      OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF EXISTS (
      SELECT 1 FROM distribution d
       WHERE d.tenant_id = NEW.tenant_id AND d.line_id = NEW.line_id AND d.status = 'Live'
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: this income line funds a LIVE distribution — revoke it before changing the money truth' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mission_line_distribution_guard BEFORE UPDATE ON mission_line
  FOR EACH ROW EXECUTE FUNCTION mission_line_distribution_guard();

-- ── M-06: the append-only streams refuse TRUNCATE too ───────────────────────
-- Row triggers already deny UPDATE/DELETE; a statement-level TRUNCATE denial
-- closes the wholesale-erasure path. The embedded test harness (superuser)
-- resets via session_replication_role='replica'; there is deliberately no
-- production break-glass — destruction of the streams is not a feature.
CREATE OR REPLACE FUNCTION append_only_truncate_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'C3E:APPEND_ONLY: % is append-only — TRUNCATE is denied', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_truncate_guard();
CREATE TRIGGER approval_event_no_truncate BEFORE TRUNCATE ON approval_event
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_truncate_guard();
CREATE TRIGGER access_event_no_truncate BEFORE TRUNCATE ON access_event
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_truncate_guard();

-- M-05 (audit): tenant_membership/role_assignment stay ENABLE-without-FORCE
-- **deliberately** — the auth resolver must read memberships to resolve a
-- principal's tenant BEFORE tenant context exists (0002's recorded decision).
-- Forcing would break Entra sign-in's owner-bypass bootstrap. Disposition:
-- accepted-as-designed; c3_app holds zero grants on these tables regardless.
-- (See docs/design/HARDEN-1.md.)
