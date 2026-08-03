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
import type { PlatformCapability, PlatformPrincipal } from '@c3web/authz';
import { AmbiguousMembershipError } from './types';

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

/**
 * The membership resolution query, shared by the real auth path and the
 * readiness probe.
 *
 * ⚖️ IT IS ONE CONSTANT SO THE PROBE CANNOT DRIFT FROM THE PATH IT CERTIFIES.
 * A probe with its own hand-written query certifies its own query — and would
 * keep passing after the real one grew a join onto a table this role cannot
 * read. That is the same shape as a readiness check that answers a narrower
 * question than the one asked of it, which is the defect this probe exists for.
 */
const MEMBERSHIP_SQL = `SELECT u.id AS user_id, t.id AS tenant_id, t.slug AS tenant_slug, ra.role AS role,
                u.email AS email, u.display_name AS display_name
           FROM external_identity ei
           JOIN app_user u        ON u.id = ei.user_id AND u.is_active = true
           JOIN tenant_membership tm ON tm.user_id = u.id
           JOIN role_assignment ra   ON ra.user_id = u.id AND ra.tenant_id = tm.tenant_id
           JOIN tenant t          ON t.id = tm.tenant_id
          WHERE ei.provider = $1 AND ei.issuer_tenant_id = $2 AND ei.subject = $3
          ORDER BY t.id ASC, ra.role ASC`;

/**
 * ⛔ A KEY THAT CANNOT MATCH, AND THAT IS A REQUIREMENT RATHER THAN A
 * CONVENIENCE. Entra's `issuer_tenant_id` and `subject` are both UUIDs; this is
 * not a UUID, so no row can carry it. If the probe key COULD match, a
 * multi-tenant identity would make the probe raise `AmbiguousMembershipError`
 * and report a perfectly healthy service as unavailable — a readiness check
 * that invents an outage is worse than one that misses it.
 */
const PROBE_KEY = 'c3-readiness-probe:never-matches';

/**
 * The trust-root key for a PLATFORM principal — the same shape as
 * `ExternalIdentityKey`, deliberately.
 *
 * ⚖️ `D-019`: Entra is the trust root "for now, maybe scale into C3-issued
 * later", and that "for now" is binding — **a second trust root must later be a
 * ROW AND AN ADAPTER, never a rewrite.** Keying on `(provider, issuer, subject)`
 * rather than on an Entra `appId` is what keeps that true.
 */
export interface PlatformIdentityKey {
  readonly provider: 'entra';
  readonly issuer: string;
  readonly subject: string;
}

export interface AdminDirectory {
  resolveTenantBySlug(slug: string): Promise<{ tenantId: string } | null>;
  /**
   * Resolve a platform principal from the registry (migration 0104).
   *
   * ⛔ ADMISSION REQUIRES A ROW — `null` when there is none, and the caller must
   * treat that as a refusal. This is `D-016a` made mechanical: admission is the
   * PRESENCE of a registration, never the ABSENCE of a tenant membership. There
   * is deliberately no "authenticated but unregistered ⇒ allowed" path, because
   * that is the shape that turns a door into a hole.
   *
   * ⛳ It reads on the SELECT-only auth connection, exactly as tenant membership
   * does, and it can grant nothing the registry does not already say.
   */
  resolvePlatformPrincipal(key: PlatformIdentityKey): Promise<PlatformPrincipal | null>;
  /**
   * Readiness probe for THIS credential. Runs the real membership query against
   * a key that cannot match: zero rows, no side effects, and no ambiguity logic.
   *
   * It proves the three things the auth path needs and `/ready` could not see:
   * the connection opens, **the credential authenticates**, and this role holds
   * SELECT on all five identity tables (`external_identity`, `app_user`,
   * `tenant_membership`, `role_assignment`, `tenant`) — Postgres checks
   * privileges on every referenced relation, so a revoked grant fails here.
   *
   * ⛳ WHAT IT DOES NOT PROVE, stated rather than implied: RLS *visibility*. The
   * probe matches nothing, so it cannot distinguish "policy permits reads" from
   * "policy hides everything" — both return zero rows. Proving that needs a row,
   * and readiness must not depend on data existing.
   */
  probe(): Promise<void>;
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
    async resolvePlatformPrincipal(key: PlatformIdentityKey): Promise<PlatformPrincipal | null> {
      const r = await pool.query(
        `SELECT subject, kind, accountable_owner, capabilities
           FROM platform_principal
          WHERE provider = $1 AND issuer = $2 AND subject = $3`,
        [key.provider, key.issuer, key.subject],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        principalId: `${key.provider}:${key.issuer}:${row.subject as string}`,
        kind: row.kind as PlatformPrincipal['kind'],
        accountableOwner: row.accountable_owner as string,
        // The column is CHECK-constrained to the closed vocabulary (0104) and
        // bound to `PLATFORM_CAPABILITIES` by `vocabularyDrift.test.ts`, so this
        // cannot widen the set — only report what was granted.
        capabilities: (row.capabilities as PlatformCapability[]) ?? [],
      };
    },

    async probe() {
      // Deliberately runs the query and discards the rows: no `rows[0]`, no
      // tenant counting, no AmbiguousMembershipError path. The probe asks
      // "can this credential perform this read", never "what did it find".
      await pool.query(MEMBERSHIP_SQL, ['entra', PROBE_KEY, PROBE_KEY]);
    },

    async resolveTenantBySlug(slug) {
      const r = await pool.query('SELECT id FROM tenant WHERE slug = $1', [slug]);
      return r.rows[0] ? { tenantId: r.rows[0].id as string } : null;
    },

    async resolveMembership(key: ExternalIdentityKey): Promise<ResolvedMembership | null> {
      // ⛔ NO `LIMIT 1`, and the absence is the point (D-008 class-B). This query
      // used to end `ORDER BY t.created_at ASC LIMIT 1`, which silently resolved
      // a multi-org identity into the OLDEST tenant — and into that tenant's
      // ROLE, so the silent choice picked an authority level too. Under one
      // tenant the clause was unreachable, so the defect had no behaviour; it is
      // the first instance of the class the identity-plane RLS exemption
      // creates, because nothing underneath these tables catches a missing
      // scope. Every row is fetched so ambiguity can be SEEN rather than
      // ordered away. See AmbiguousMembershipError.
      const r = await pool.query(MEMBERSHIP_SQL, [key.provider, key.issuerTenantId, key.subject]);
      const row = r.rows[0];
      if (!row) return null;
      // Ambiguity is counted over DISTINCT TENANTS, not rows: two roles within
      // one tenant is a different condition and must not be reported as a
      // multi-org identity.
      const tenants = new Set(r.rows.map((candidate) => candidate.tenant_id as string));
      if (tenants.size > 1) throw new AmbiguousMembershipError(tenants.size, key);
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
