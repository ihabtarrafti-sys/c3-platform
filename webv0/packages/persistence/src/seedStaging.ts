/**
 * seedStaging.ts — idempotent first-tenant reconciliation (testable core used
 * by scripts/seed-staging.ts). Runs on the PRIVILEGED admin connection only.
 *
 * Refusal rules (ambiguity is never auto-resolved):
 *   - an (entra, tid, oid) identity already bound to a user whose email
 *     differs from the requested one => REFUSED (explicit admin action needed);
 *   - a requested email already used by a DIFFERENT external identity =>
 *     REFUSED (would silently rebind a mailbox to a new person);
 *   - owner and operations sharing the same oid => REFUSED.
 */
import type { Client } from 'pg';

export interface SeedIdentity {
  readonly oid: string;
  readonly email: string;
  readonly displayName: string;
}

export interface SeedSpec {
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly entraTenantId: string;
  readonly owner: SeedIdentity;
  readonly operations: SeedIdentity;
}

export interface SeedReport {
  readonly lines: string[];
  readonly changed: boolean;
}

const mask = (oid: string): string => (oid.length > 8 ? `${oid.slice(0, 4)}…${oid.slice(-4)}` : '…');

async function reconcileIdentity(
  client: Client,
  spec: SeedSpec,
  who: SeedIdentity,
  role: 'owner' | 'operations',
  tenantId: string,
  lines: string[],
): Promise<boolean> {
  let changed = false;

  // Ambiguity guard 1: the oid is already bound — to whom?
  const bound = await client.query(
    `SELECT u.id, u.email FROM external_identity ei JOIN app_user u ON u.id = ei.user_id
      WHERE ei.provider='entra' AND ei.issuer_tenant_id=$1 AND ei.subject=$2`,
    [spec.entraTenantId, who.oid],
  );
  // Ambiguity guard 2: the email exists — does it belong to a different identity?
  const byEmail = await client.query('SELECT id FROM app_user WHERE email=$1', [who.email]);

  let userId: string;
  if (bound.rows[0]) {
    if (bound.rows[0].email !== who.email) {
      throw new Error(
        `identity ${mask(who.oid)} is already bound to a different profile email — ` +
          `refusing ambiguous rebinding (update the profile explicitly first)`,
      );
    }
    userId = bound.rows[0].id;
    lines.push(`${role}: identity ${mask(who.oid)} already bound — reconciled`);
  } else {
    if (byEmail.rows[0]) {
      const otherIdentity = await client.query(
        `SELECT 1 FROM external_identity WHERE user_id=$1 AND NOT (provider='entra' AND issuer_tenant_id=$2 AND subject=$3)`,
        [byEmail.rows[0].id, spec.entraTenantId, who.oid],
      );
      if (otherIdentity.rows[0]) {
        throw new Error(
          `email for ${role} already belongs to a different external identity — refusing ambiguous binding`,
        );
      }
      userId = byEmail.rows[0].id;
    } else {
      const created = await client.query(
        'INSERT INTO app_user (email, display_name) VALUES ($1,$2) RETURNING id',
        [who.email, who.displayName],
      );
      userId = created.rows[0].id;
      changed = true;
      lines.push(`${role}: created profile for ${who.email}`);
    }
    await client.query(
      `INSERT INTO external_identity (provider, issuer_tenant_id, subject, user_id)
       VALUES ('entra',$1,$2,$3) ON CONFLICT (provider, issuer_tenant_id, subject) DO NOTHING`,
      [spec.entraTenantId, who.oid, userId],
    );
    changed = true;
    lines.push(`${role}: bound entra identity ${mask(who.oid)}`);
  }

  // Display name reconciliation (profile attribute; never affects membership).
  const upd = await client.query('UPDATE app_user SET display_name=$2 WHERE id=$1 AND display_name IS DISTINCT FROM $2', [userId, who.displayName]);
  if (upd.rowCount) {
    changed = true;
    lines.push(`${role}: display name reconciled`);
  }

  const mem = await client.query(
    'INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [tenantId, userId],
  );
  if (mem.rowCount) changed = true;

  // EXACT role assignment: replace anything else with the single mandated role.
  const cur = await client.query('SELECT role FROM role_assignment WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
  const roles = cur.rows.map((r) => r.role as string);
  if (roles.length !== 1 || roles[0] !== role) {
    await client.query('DELETE FROM role_assignment WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
    await client.query('INSERT INTO role_assignment (tenant_id, user_id, role) VALUES ($1,$2,$3)', [tenantId, userId, role]);
    changed = true;
    lines.push(`${role}: role assignment set to '${role}'`);
  } else {
    lines.push(`${role}: role assignment already '${role}'`);
  }
  return changed;
}

export async function seedStagingTenant(client: Client, spec: SeedSpec): Promise<SeedReport> {
  if (spec.owner.oid === spec.operations.oid) {
    throw new Error('owner and operations must be DIFFERENT Entra identities (same oid supplied)');
  }
  const lines: string[] = [];
  let changed = false;

  await client.query('BEGIN');
  try {
    const t = await client.query(
      `INSERT INTO tenant (slug, name) VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, (xmax = 0) AS inserted`,
      [spec.tenantSlug, spec.tenantName],
    );
    const tenantId = t.rows[0].id as string;
    if (t.rows[0].inserted) {
      changed = true;
      lines.push(`tenant '${spec.tenantSlug}' created`);
    } else {
      lines.push(`tenant '${spec.tenantSlug}' exists — reconciled`);
    }

    changed = (await reconcileIdentity(client, spec, spec.owner, 'owner', tenantId, lines)) || changed;
    changed = (await reconcileIdentity(client, spec, spec.operations, 'operations', tenantId, lines)) || changed;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  lines.push(`entra tenant: ${mask(spec.entraTenantId)}`);
  return { lines, changed };
}
