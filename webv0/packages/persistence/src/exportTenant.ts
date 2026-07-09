/**
 * exportTenant.ts — organization-scoped logical export (Track A, B-5).
 *
 * Produces a point-in-time bundle of everything ONE tenant owns and nothing any
 * other tenant owns: one JSONL file per table plus a checksummed manifest. The
 * whole read runs inside a single REPEATABLE READ, READ ONLY transaction, so the
 * bundle is a consistent snapshot and the process physically cannot mutate data.
 *
 * Scope decisions (see docs/design/B5-org-scoped-export-and-exit.md):
 *   - Directory rows (app_user, external_identity) are reached via this tenant's
 *     memberships. A user who is ALSO a member of another tenant is exported
 *     profile-only, flagged `shared: true`, and their global identity binding
 *     (external_identity) is withheld — it is not this org's to take.
 *   - access_event is platform-level (no tenant key) and is never part of a
 *     tenant bundle; platform logs are out of scope by definition.
 */
import type { Client } from 'pg';
import { createHash } from 'node:crypto';

export interface ExportSpec {
  readonly tenantSlug: string;
}

export interface ExportedFile {
  readonly name: string; // e.g. 'person.jsonl'
  readonly content: string; // JSONL: one JSON object per line, '' when empty
  readonly rows: number;
  readonly sha256: string;
}

export interface ExportManifest {
  readonly tenant: { id: string; slug: string; name: string };
  readonly exportedAt: string; // ISO-8601 (UTC)
  readonly schemaVersion: string[]; // applied migration ids, ordered
  readonly files: Array<{ name: string; rows: number; sha256: string }>;
  readonly note: string;
}

export interface ExportResult {
  readonly manifest: ExportManifest;
  readonly files: ExportedFile[];
}

/** Ordered so a reader (and a future restore) sees parents before children. */
interface TableExport {
  readonly name: string;
  readonly sql: string;
}

function tableExports(): TableExport[] {
  return [
    { name: 'tenant', sql: `SELECT * FROM tenant WHERE id = $1` },
    {
      // Members of this tenant, with a derived `shared` flag (member of >1 tenant).
      name: 'app_user',
      sql: `
        SELECT u.id, u.email, u.display_name, u.is_active, u.created_at, u.last_seen_at,
               (SELECT count(*) FROM tenant_membership m2 WHERE m2.user_id = u.id) > 1 AS shared
          FROM app_user u
         WHERE u.id IN (SELECT user_id FROM tenant_membership WHERE tenant_id = $1)
         ORDER BY u.id`,
    },
    {
      // Only sole-tenant members' identity bindings — a shared user's global
      // identity key is withheld from this org's bundle.
      name: 'external_identity',
      sql: `
        SELECT ei.id, ei.provider, ei.issuer_tenant_id, ei.subject, ei.user_id, ei.created_at
          FROM external_identity ei
         WHERE ei.user_id IN (SELECT user_id FROM tenant_membership WHERE tenant_id = $1)
           AND (SELECT count(*) FROM tenant_membership m2 WHERE m2.user_id = ei.user_id) = 1
         ORDER BY ei.id`,
    },
    { name: 'tenant_membership', sql: `SELECT * FROM tenant_membership WHERE tenant_id = $1 ORDER BY user_id` },
    { name: 'role_assignment', sql: `SELECT * FROM role_assignment WHERE tenant_id = $1 ORDER BY user_id, role` },
    { name: 'business_id_counter', sql: `SELECT * FROM business_id_counter WHERE tenant_id = $1 ORDER BY kind` },
    { name: 'approval', sql: `SELECT * FROM approval WHERE tenant_id = $1 ORDER BY approval_id` },
    { name: 'person', sql: `SELECT * FROM person WHERE tenant_id = $1 ORDER BY person_id` },
    // Dates export as ISO date strings (::text) — never driver-parsed Dates.
    {
      name: 'credential',
      sql: `SELECT id, tenant_id, credential_id, person_id, credential_type, issuer,
                   issued_on::text AS issued_on, expires_on::text AS expires_on,
                   notes, is_active, created_by_approval_id, version, created_at, updated_at
              FROM credential WHERE tenant_id = $1 ORDER BY credential_id`,
    },
    {
      name: 'journey',
      sql: `SELECT id, tenant_id, journey_id, person_id, journey_type, title,
                   started_on::text AS started_on, ended_on::text AS ended_on,
                   status, notes, created_by_approval_id, version, created_at, updated_at
              FROM journey WHERE tenant_id = $1 ORDER BY journey_id`,
    },
    { name: 'kit', sql: `SELECT * FROM kit WHERE tenant_id = $1 ORDER BY kit_id` },
    { name: 'apparel', sql: `SELECT * FROM apparel WHERE tenant_id = $1 ORDER BY apparel_id` },
    { name: 'entity', sql: `SELECT * FROM entity WHERE tenant_id = $1 ORDER BY entity_id` },
    { name: 'fx_rate', sql: `SELECT * FROM fx_rate WHERE tenant_id = $1 ORDER BY currency` },
    {
      name: 'mission',
      sql: `SELECT id, tenant_id, mission_id, name, game_title,
                   starts_on::text AS starts_on, ends_on::text AS ends_on,
                   notes, is_active, version, created_at, updated_at
              FROM mission WHERE tenant_id = $1 ORDER BY mission_id`,
    },
    {
      name: 'agreement',
      sql: `SELECT id, tenant_id, agreement_id, person_id, entity_id, agreement_code, agreement_type,
                   linked_agreement_id, starts_on::text AS starts_on, ends_on::text AS ends_on,
                   value_usd_cents, notes, status, created_by_approval_id, version, created_at, updated_at
              FROM agreement WHERE tenant_id = $1 ORDER BY agreement_id`,
    },
    { name: 'agreement_term', sql: `SELECT * FROM agreement_term WHERE tenant_id = $1 ORDER BY term_id` },
    { name: 'mission_line', sql: `SELECT * FROM mission_line WHERE tenant_id = $1 ORDER BY line_id` },
    { name: 'mission_budget', sql: `SELECT * FROM mission_budget WHERE tenant_id = $1 ORDER BY mission_id, direction, category, currency` },
    { name: 'mission_participant', sql: `SELECT * FROM mission_participant WHERE tenant_id = $1 ORDER BY mission_id, person_id` },
    { name: 'approval_event', sql: `SELECT * FROM approval_event WHERE tenant_id = $1 ORDER BY at, id` },
    { name: 'audit_event', sql: `SELECT * FROM audit_event WHERE tenant_id = $1 ORDER BY at, id` },
  ];
}

function toJsonl(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Export one tenant's data as a consistent, checksummed bundle. `client` must be
 * a connected, privileged connection (admin or the read-only backup role). The
 * function never writes: all reads run inside a READ ONLY snapshot transaction.
 * Throws if the tenant slug does not resolve.
 */
export async function exportTenant(client: Client, spec: ExportSpec): Promise<ExportResult> {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const t = await client.query<{ id: string; slug: string; name: string }>(
      'SELECT id, slug, name FROM tenant WHERE slug = $1',
      [spec.tenantSlug],
    );
    if (t.rowCount === 0) {
      throw new Error(`Unknown tenant '${spec.tenantSlug}'.`);
    }
    const tenant = t.rows[0]!;

    const files: ExportedFile[] = [];
    for (const table of tableExports()) {
      const res = await client.query(table.sql, [tenant.id]);
      const content = toJsonl(res.rows as Array<Record<string, unknown>>);
      files.push({ name: `${table.name}.jsonl`, content, rows: res.rowCount ?? 0, sha256: sha256(content) });
    }

    const migs = await client.query<{ id: string }>('SELECT id FROM _migrations ORDER BY id');

    await client.query('COMMIT');

    const manifest: ExportManifest = {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      exportedAt: new Date().toISOString(),
      schemaVersion: migs.rows.map((r) => r.id),
      files: files.map((f) => ({ name: f.name, rows: f.rows, sha256: f.sha256 })),
      note:
        'Organization-scoped logical export. Shared users (members of another tenant) are profile-only (shared:true) with their external_identity withheld. Platform-level access_event and logs are out of scope.',
    };
    return { manifest, files };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}
