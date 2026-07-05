/**
 * directory.ts — the auth control-plane over the PRIVILEGED admin connection.
 * Used only to resolve identity → tenant + role (and, for the dev IdP, to
 * upsert a membership). It never touches business data; that stays on the
 * least-privileged app connection with RLS.
 */
import { Pool } from 'pg';

export interface Membership {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: string;
}

export interface AdminDirectory {
  resolveTenantBySlug(slug: string): Promise<{ tenantId: string } | null>;
  upsertMembership(tenantId: string, email: string, displayName: string, role: string): Promise<void>;
  resolveMembership(email: string): Promise<Membership | null>;
  close(): Promise<void>;
}

export function createAdminDirectory(adminUrl: string): AdminDirectory {
  const pool = new Pool({ connectionString: adminUrl, options: '-c client_encoding=UTF8' });

  return {
    async resolveTenantBySlug(slug) {
      const r = await pool.query('SELECT id FROM tenant WHERE slug = $1', [slug]);
      return r.rows[0] ? { tenantId: r.rows[0].id as string } : null;
    },

    async upsertMembership(tenantId, email, displayName, role) {
      const u = await pool.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [email, displayName],
      );
      const userId = u.rows[0].id as string;
      await pool.query('INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tenantId, userId]);
      // One role per user per tenant for the slice: replace any prior role.
      await pool.query('DELETE FROM role_assignment WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
      await pool.query('INSERT INTO role_assignment (tenant_id, user_id, role) VALUES ($1,$2,$3)', [tenantId, userId, role]);
    },

    async resolveMembership(email) {
      const r = await pool.query(
        `SELECT t.id AS tenant_id, t.slug AS tenant_slug, ra.role AS role
           FROM app_user u
           JOIN tenant_membership tm ON tm.user_id = u.id
           JOIN role_assignment ra ON ra.user_id = u.id AND ra.tenant_id = tm.tenant_id
           JOIN tenant t ON t.id = tm.tenant_id
          WHERE u.email = $1 AND u.is_active = true
          ORDER BY t.created_at ASC
          LIMIT 1`,
        [email],
      );
      const row = r.rows[0];
      return row ? { tenantId: row.tenant_id, tenantSlug: row.tenant_slug, role: row.role } : null;
    },

    close: () => pool.end(),
  };
}
