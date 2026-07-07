-- 0008_member_admin.sql - Sprint 35 tenant-admin (A-8 Phase 2).
--
-- Governed access administration WITHOUT weakening the certified posture:
-- c3_app keeps ZERO table grants on the directory tables (tenant, app_user,
-- tenant_membership, role_assignment, external_identity). Member mutations go
-- through owner-owned SECURITY DEFINER functions - four narrow, reviewed
-- gateways that enforce tenant scoping and the A8-P2 invariants IN SQL:
--   * fail-closed without tenant context;
--   * bind-once identity key (provider, issuer_tenant_id, subject);
--   * no self-administration (actor may not target their own account);
--   * last-active-owner protection (no ownerless tenants);
--   * shared-vs-sole deactivation semantics (Phase-E1 exactly);
--   * read access (member_list/member_get) scoped to the current tenant.
-- Errors carry a 'C3E:<DOMAIN_CODE>:' message prefix which the persistence
-- adapter maps to the domain error taxonomy.

-- 1 - extend the governed operation registry.
ALTER TABLE approval DROP CONSTRAINT approval_operation_type_check;
ALTER TABLE approval ADD CONSTRAINT approval_operation_type_check
  CHECK (operation_type IN ('AddPerson','ProvisionMember','ChangeRole','DeactivateMember','ReactivateMember'));

-- 2 - shared guard: tenant context is mandatory for every member gateway.
CREATE OR REPLACE FUNCTION member_require_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE tid uuid;
BEGIN
  tid := current_tenant_id();
  IF tid IS NULL THEN
    RAISE EXCEPTION 'C3E:TENANT_CONTEXT_MISSING: no tenant context for member administration'
      USING ERRCODE = '28000';
  END IF;
  RETURN tid;
END $$;

-- 3 - provision: create-or-reuse the user by the immutable identity key, bind
--     once, and grant membership + exactly one role in the CURRENT tenant.
CREATE OR REPLACE FUNCTION member_provision(
  p_email text, p_display text, p_role text,
  p_provider text, p_issuer text, p_subject text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tid uuid; uid uuid; bound_email text; norm_email text;
BEGIN
  tid := member_require_tenant();
  norm_email := lower(trim(p_email));

  SELECT u.id, u.email INTO uid, bound_email
    FROM external_identity ei JOIN app_user u ON u.id = ei.user_id
   WHERE ei.provider = p_provider AND ei.issuer_tenant_id = p_issuer AND ei.subject = p_subject;

  IF uid IS NOT NULL THEN
    IF bound_email IS DISTINCT FROM norm_email THEN
      RAISE EXCEPTION 'C3E:IDENTITY_ALREADY_BOUND: identity is bound to a different profile'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT id INTO uid FROM app_user WHERE email = norm_email;
    IF uid IS NOT NULL AND EXISTS (
      SELECT 1 FROM external_identity
       WHERE user_id = uid
         AND NOT (provider = p_provider AND issuer_tenant_id = p_issuer AND subject = p_subject)
    ) THEN
      RAISE EXCEPTION 'C3E:CONFLICT: email already belongs to a different external identity'
        USING ERRCODE = '23505';
    END IF;
    IF uid IS NULL THEN
      INSERT INTO app_user (email, display_name) VALUES (norm_email, p_display) RETURNING id INTO uid;
    END IF;
    INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id)
    VALUES (p_provider, p_issuer, p_subject, uid)
    ON CONFLICT (provider, issuer_tenant_id, subject) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM app_user WHERE id = uid AND NOT is_active) THEN
    RAISE EXCEPTION 'C3E:CONFLICT: user is deactivated; use ReactivateMember instead of provisioning'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tid AND user_id = uid) THEN
    RAISE EXCEPTION 'C3E:CONFLICT: already a member of this organization'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO tenant_membership (tenant_id, user_id) VALUES (tid, uid);
  INSERT INTO role_assignment (tenant_id, user_id, role) VALUES (tid, uid, p_role);
  RETURN uid;
END $$;

-- 4 - exact-set role change with self-administration + last-owner guards.
--     Returns the PREVIOUS role set (comma-joined) for the audit before-image.
CREATE OR REPLACE FUNCTION member_set_role(p_user uuid, p_role text, p_actor_email text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; prev text; tgt_email text;
BEGIN
  tid := member_require_tenant();
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

-- 5 - activation flip implementing Phase-E1 semantics exactly. Returns the
--     mode applied: 'deactivated-sole' | 'membership-removed' | 'reactivated'.
CREATE OR REPLACE FUNCTION member_set_active(p_user uuid, p_active boolean, p_actor_email text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; tgt_email text; tgt_active boolean; shared boolean;
BEGIN
  tid := member_require_tenant();
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

-- 6 - tenant-scoped member reads (the app role still has no table access).
CREATE OR REPLACE FUNCTION member_list()
RETURNS TABLE(user_id uuid, email text, display_name text, role text, is_active boolean, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT u.id, u.email, u.display_name, ra.role, u.is_active, tm.created_at
    FROM tenant_membership tm
    JOIN app_user u ON u.id = tm.user_id
    JOIN role_assignment ra ON ra.tenant_id = tm.tenant_id AND ra.user_id = tm.user_id
   WHERE tm.tenant_id = member_require_tenant()
   ORDER BY u.email, ra.role
$$;

CREATE OR REPLACE FUNCTION member_get(p_user uuid)
RETURNS TABLE(user_id uuid, email text, display_name text, role text, is_active boolean, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT u.id, u.email, u.display_name, ra.role, u.is_active, tm.created_at
    FROM tenant_membership tm
    JOIN app_user u ON u.id = tm.user_id
    JOIN role_assignment ra ON ra.tenant_id = tm.tenant_id AND ra.user_id = tm.user_id
   WHERE tm.tenant_id = member_require_tenant() AND tm.user_id = p_user
$$;

-- 7 - the gateways are the ONLY member surface for the app role.
REVOKE ALL ON FUNCTION member_provision(text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_set_role(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_set_active(uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION member_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_provision(text,text,text,text,text,text) TO c3_app;
GRANT EXECUTE ON FUNCTION member_set_role(uuid,text,text) TO c3_app;
GRANT EXECUTE ON FUNCTION member_set_active(uuid,boolean,text) TO c3_app;
GRANT EXECUTE ON FUNCTION member_list() TO c3_app;
GRANT EXECUTE ON FUNCTION member_get(uuid) TO c3_app;
