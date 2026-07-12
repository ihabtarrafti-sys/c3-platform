-- 0050_provision_identity_lock — HARDEN-3 M-01.
--
-- Concurrent provisioning of the SAME external identity could race: two callers
-- both read no existing identity, both try to create the user, and the loser
-- either crashes on app_user.email UNIQUE (a raw 23505) or — in the window
-- before that constraint existed — left a half-provisioned ghost. We serialize
-- provisions of one identity with a transaction-scoped advisory lock on the
-- immutable (provider, issuer, subject) tuple. The lock is GLOBAL (not tenant-
-- scoped) because app_user / external_identity are global tables shared across
-- tenants, and it releases automatically at transaction end.
--
-- This is a pure CREATE OR REPLACE of member_provision — the body is otherwise
-- byte-identical to 0008; only the PERFORM pg_advisory_xact_lock line is new.

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

  -- M-01: serialize concurrent provisioning of THIS identity. A racer blocks
  -- here until the winner commits, then re-reads and takes the create-or-reuse
  -- path against committed rows (READ COMMITTED) instead of double-creating.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_issuer || ':' || p_subject, 0));

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
