/**
 * directory.ts — identity/membership resolution over the C3 identity tables.
 *
 * Two connection tiers use this module:
 *   - production (Entra): the SELECT-only `c3_auth` role — resolution only;
 *   - development (dev IdP): the privileged admin role — the dev login also
 *     PROVISIONS memberships (dev/test environments only).
 *
 * The membership key is the IMMUTABLE external identity
 * (provider, issuer_tenant_id, subject) — for Entra that is (tid, oid).
 * Email / preferred_username / display name are mutable PROFILE attributes and
 * never participate in resolution. Changing them cannot change membership or
 * role. Entra sign-in NEVER auto-creates a membership.
 */
import { Pool } from 'pg';

export interface ExternalIdentityKey {
  readonly provider: 'entra' | 'dev';
  readonly issuerTenantId: string;
  readonly subject: string;
}

export interface ResolvedMembership {
  /** Stable participant surrogate (uuid = app_user.id) — the permanent identity key. */
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: string;
  /** Canonical stored profile email (stable; admin-controlled — NOT the token claim). */
  readonly email: string;
  readonly displayName: string;
}

export interface AdminDirectory {
  resolveTenantBySlug(slug: string): Promise<{ tenantId: string } | null>;
  /** Resolve an authenticated external identity to tenant + role. Fail-closed:
   *  unknown identity, inactive user, or missing membership/role => null. */
  resolveMembership(key: ExternalIdentityKey): Promise<ResolvedMembership | null>;
  /** Resolve an external identity to just the stable app_user.id (uuid). Used by
   *  the dev adapter to obtain a SERVER-resolved userId (never a self-asserted
   *  token claim). Fail-closed: unknown identity or inactive user => null. */
  resolveUserId(key: ExternalIdentityKey): Promise<string | null>;
  /** DEV-ONLY provisioning used by the dev IdP login (privileged connection). */
  upsertDevMembership(tenantId: string, email: string, displayName: string, role: string): Promise<void>;
  close(): Promise<void>;
}

export function createAdminDirectory(connectionString: string): AdminDirectory {
  const pool = new Pool({ connectionString, options: '-c client_encoding=UTF8' });

  return {
    async resolveTenantBySlug(slug) {
      const r = await pool.query('SELECT id FROM tenant WHERE slug = $1', [slug]);
      return r.rows[0] ? { tenantId: r.rows[0].id as string } : null;
    },

    async resolveMembership(key: ExternalIdentityKey): Promise<ResolvedMembership | null> {
      const r = await pool.query(
        `SELECT u.id AS user_id, t.id AS tenant_id, t.slug AS tenant_slug, ra.role AS role,
                u.email AS email, u.display_name AS display_name
           FROM external_identity ei
           JOIN app_user u        ON u.id = ei.user_id AND u.is_active = true
           JOIN tenant_membership tm ON tm.user_id = u.id
           JOIN role_assignment ra   ON ra.user_id = u.id AND ra.tenant_id = tm.tenant_id
           JOIN tenant t          ON t.id = tm.tenant_id
          WHERE ei.provider = $1 AND ei.issuer_tenant_id = $2 AND ei.subject = $3
          ORDER BY t.created_at ASC
          LIMIT 1`,
        [key.provider, key.issuerTenantId, key.subject],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        role: row.role,
        email: row.email,
        displayName: row.display_name,
      };
    },

    async resolveUserId(key: ExternalIdentityKey): Promise<string | null> {
      // The stable app_user.id by the IMMUTABLE identity key. `subject` is matched
      // verbatim (for Entra it is the oid; for dev it is the email exactly as the
      // dev-login route stored it) — no normalization, so this cannot drift from
      // what the binding holds. Fail-closed: no active binding => null.
      const r = await pool.query(
        `SELECT u.id AS user_id
           FROM external_identity ei
           JOIN app_user u ON u.id = ei.user_id AND u.is_active = true
          WHERE ei.provider = $1 AND ei.issuer_tenant_id = $2 AND ei.subject = $3
          LIMIT 1`,
        [key.provider, key.issuerTenantId, key.subject],
      );
      return (r.rows[0]?.user_id as string | undefined) ?? null;
    },

    async upsertDevMembership(tenantId, email, displayName, role) {
      const u = await pool.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, last_seen_at = now()
         RETURNING id`,
        [email, displayName],
      );
      const userId = u.rows[0].id as string;
      await pool.query(
        `INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id)
         VALUES ('dev', 'dev', $1, $2)
         ON CONFLICT (provider, issuer_tenant_id, subject) DO NOTHING`,
        [email, userId],
      );
      await pool.query('INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tenantId, userId]);
      // One role per user per tenant for the slice: replace any prior role.
      await pool.query('DELETE FROM role_assignment WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
      await pool.query('INSERT INTO role_assignment (tenant_id, user_id, role) VALUES ($1,$2,$3)', [tenantId, userId, role]);
    },

    close: () => pool.end(),
  };
}
