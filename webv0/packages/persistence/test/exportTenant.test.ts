/**
 * exportTenant.test.ts — B-5 evidence. Proves the organization-scoped export:
 *   - contains ONLY the target tenant's rows (isolation);
 *   - flags a user shared with another tenant (shared:true) and withholds that
 *     user's external_identity, while exporting sole-tenant members' bindings;
 *   - manifest checksums + row counts match the emitted content;
 *   - records the applied schema version;
 *   - refuses an unknown tenant slug.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';
import { exportTenant, type ExportResult } from '../src/exportTenant';

let db: TestDatabase;
let p: PersistenceHandle;

function ownerActor(tenantId: string, email: string): Actor {
  return { userId: '00000000-0000-0000-0000-0000000000fe', identity: email, displayName: 'Owner', role: 'owner', tenantId };
}

/** Submit an approval, then execute it into a real person (+ audit event). */
async function governedAddPerson(actor: Actor, fullName: string): Promise<void> {
  await p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = `APR-${String(seq).padStart(4, '0')}`;
    await tx.insertApproval({
      approvalId,
      operationType: 'AddPerson',
      targetPersonId: 'PENDING-ADDPERSON',
      targetId: null,
      reason: null,
      payload: { operationType: 'AddPerson', input: { fullName } },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({ approvalId, fromStatus: null, toStatus: 'Submitted', actor: actor.identity });
    const pseq = await tx.allocateSequence('person');
    const personId = `PER-${String(pseq).padStart(4, '0')}`;
    await tx.insertPerson({
      personId, fullName, ign: null, nationality: null, primaryRole: null,
      personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null,
      notes: null, createdByApprovalId: approvalId,
    });
    await tx.appendAuditEvent({ entityType: 'Person', entityId: personId, action: 'PersonCreated', actor: actor.identity });
  });
}

async function runExport(slug: string): Promise<ExportResult> {
  const client = new Client({ connectionString: db.adminUrl, options: '-c client_encoding=UTF8' });
  await client.connect();
  try {
    return await exportTenant(client, { tenantSlug: slug });
  } finally {
    await client.end();
  }
}

const HEX = (c: string) => c.repeat(64);

/**
 * Seed the three blob classes for a tenant via the admin client (bypasses RLS):
 * a document, a photo on the named person, and three intake submissions
 * (Pending / Promoted / Rejected) — only the Pending one has LIVE quarantine
 * bytes, so only its upload should appear in the blob universe.
 */
async function seedBlobs(tenantId: string, personFullName: string): Promise<void> {
  const client = new Client({ connectionString: db.adminUrl, options: '-c client_encoding=UTF8' });
  await client.connect();
  try {
    await client.query(
      `UPDATE person SET photo_storage_key = $2, photo_content_type = 'image/jpeg', photo_sha256 = $3, photo_updated_at = now()
        WHERE tenant_id = $1 AND full_name = $4`,
      [tenantId, `${tenantId}/photo-obj`, HEX('a'), personFullName],
    );
    await client.query(
      `INSERT INTO document (tenant_id, document_id, owner_type, owner_id, file_name, content_type, size_bytes, sha256, storage_key, uploaded_by)
       VALUES ($1, 'DOC-0001', 'Person', 'PER-0001', 'contract.pdf', 'application/pdf', 12, $2, $3, 'owner')`,
      [tenantId, HEX('b'), `${tenantId}/doc-obj`],
    );
    const link = await client.query<{ id: string }>(
      `INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at)
       VALUES ($1, $2, 'Onboarding', 'ops', now() + interval '7 days') RETURNING id`,
      [tenantId, `hash-${tenantId}`],
    );
    const linkId = link.rows[0]!.id;
    const upload = (sub: string) => JSON.stringify([{ uploadId: 'up1', fileName: 'passport.jpg', contentType: 'image/jpeg', sizeBytes: 5, sha256: HEX('c'), storageKey: `intake/${tenantId}/${sub}/up1` }]);
    // Pending — live quarantine bytes (SHOULD be enumerated).
    await client.query(
      `INSERT INTO intake_submission (tenant_id, link_id, kind, payload, uploads, status)
       VALUES ($1, $2, 'Onboarding', '{"fullName":"X"}'::jsonb, $3::jsonb, 'Pending')`,
      [tenantId, linkId, upload('subPending')],
    );
    // Promoted — quarantine already copied+deleted (must NOT be enumerated).
    await client.query(
      `INSERT INTO intake_submission (tenant_id, link_id, kind, payload, uploads, status, reviewed_by, reviewed_at, promoted_approval_id, promoted_person_id)
       VALUES ($1, $2, 'Onboarding', '{"fullName":"Y"}'::jsonb, $3::jsonb, 'Promoted', 'ops', now(), 'APR-0001', 'PER-0002')`,
      [tenantId, linkId, upload('subPromoted')],
    );
    // Rejected — bytes wiped, payload scrubbed (must NOT be enumerated).
    await client.query(
      `INSERT INTO intake_submission (tenant_id, link_id, kind, payload, uploads, status, reviewed_by, reviewed_at)
       VALUES ($1, $2, 'Onboarding', NULL, $3::jsonb, 'Rejected', 'ops', now())`,
      [tenantId, linkId, upload('subRejected')],
    );
  } finally {
    await client.end();
  }
}

function fileRows(res: ExportResult, name: string): Array<Record<string, unknown>> {
  const f = res.files.find((x) => x.name === `${name}.jsonl`)!;
  return f.content ? f.content.trimEnd().split('\n').map((l) => JSON.parse(l)) : [];
}

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

let alphaId: string;
let bravoId: string;

beforeEach(async () => {
  await db.truncateAll();
  // Alpha: owner (sole-tenant) + ops (will be shared). Both have entra bindings.
  const alpha = await db.seedTenant({
    slug: 'alpha',
    name: 'Alpha Org',
    users: [
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner', entra: { tid: 'tid-a', oid: 'oid-owner-a' } },
      { key: 'ops', email: 'shared@x.com', displayName: 'Shared User', role: 'operations', entra: { tid: 'tid-a', oid: 'oid-shared' } },
    ],
  });
  // Bravo: its own owner + the SAME shared user (same email → same app_user id).
  const bravo = await db.seedTenant({
    slug: 'bravo',
    name: 'Bravo Org',
    users: [
      { key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner', entra: { tid: 'tid-b', oid: 'oid-owner-b' } },
      { key: 'shared', email: 'shared@x.com', displayName: 'Shared User', role: 'visitor' },
    ],
  });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;

  await governedAddPerson(ownerActor(alphaId, 'owner@a.com'), 'Alpha Person One');
  await governedAddPerson(ownerActor(alphaId, 'owner@a.com'), 'Alpha Person Two');
  await governedAddPerson(ownerActor(bravoId, 'owner@b.com'), 'Bravo Person'); // must NOT leak into alpha's export
});

describe('organization-scoped export', () => {
  it('exports only the target tenant and none of another tenant', async () => {
    const res = await runExport('alpha');
    expect(res.manifest.tenant).toMatchObject({ slug: 'alpha', name: 'Alpha Org', id: alphaId });

    const tenants = fileRows(res, 'tenant');
    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({ id: alphaId, slug: 'alpha' });

    const people = fileRows(res, 'person');
    expect(people.map((r) => r.full_name).sort()).toEqual(['Alpha Person One', 'Alpha Person Two']);
    // Every exported row belongs to alpha; nothing from bravo.
    for (const r of [...people, ...fileRows(res, 'approval'), ...fileRows(res, 'approval_event'), ...fileRows(res, 'audit_event')]) {
      expect(r.tenant_id).toBe(alphaId);
    }
    expect(fileRows(res, 'audit_event').some((r) => r.action === 'PersonCreated')).toBe(true);
  });

  it('flags a shared user and withholds their identity binding; keeps sole-tenant members whole', async () => {
    const res = await runExport('alpha');
    const appUsers = fileRows(res, 'app_user');

    const owner = appUsers.find((u) => u.email === 'owner@a.com')!;
    const shared = appUsers.find((u) => u.email === 'shared@x.com')!;
    expect(owner.shared).toBe(false);
    expect(shared.shared).toBe(true);

    const ids = fileRows(res, 'external_identity');
    const subjects = ids.map((r) => r.subject);
    expect(subjects).toContain('oid-owner-a'); // sole-tenant member's binding present
    expect(subjects).not.toContain('oid-shared'); // shared user's binding withheld
  });

  it('manifest row counts and SHA-256 checksums match the emitted content', async () => {
    const res = await runExport('alpha');
    for (const f of res.files) {
      const entry = res.manifest.files.find((m) => m.name === f.name)!;
      expect(entry.rows).toBe(f.rows);
      expect(entry.sha256).toBe(createHash('sha256').update(f.content, 'utf8').digest('hex'));
      const lines = f.content ? f.content.trimEnd().split('\n').length : 0;
      expect(lines).toBe(f.rows);
    }
    expect(res.manifest.schemaVersion).toContain('0001_schema.sql');
    expect(res.manifest.schemaVersion).toContain('0009_credentials.sql');
    // Sprint 36: credentials are part of the org's bundle.
    expect(res.files.some((f) => f.name === 'credential.jsonl')).toBe(true);
    // access_event (platform-level) is never part of a tenant bundle.
    expect(res.files.some((f) => f.name === 'access_event.jsonl')).toBe(false);
  });

  it('refuses an unknown tenant slug', async () => {
    await expect(runExport('does-not-exist')).rejects.toThrow(/Unknown tenant/i);
  });

  it('H-07: the blob universe carries documents + photos + PENDING intake, excludes promoted/rejected and other tenants', async () => {
    await seedBlobs(alphaId, 'Alpha Person One');
    await seedBlobs(bravoId, 'Bravo Person'); // must NOT leak into alpha's universe

    const res = await runExport('alpha');
    const byClass = (c: string) => res.blobs.filter((b) => b.blobClass === c);

    // exactly one of each live class, and the intake is the PENDING submission's upload only.
    expect(byClass('document').map((b) => b.ownerRef)).toEqual(['DOC-0001']);
    expect(byClass('photo')).toHaveLength(1);
    expect(byClass('photo')[0]!.bundleName).toMatch(/^photos\/PER-\d+__photo\.jpg$/);
    expect(byClass('intake')).toHaveLength(1);
    expect(byClass('intake')[0]!.storageKey).toBe(`intake/${alphaId}/subPending/up1`);
    // promoted + rejected quarantine are NOT enumerated (their bytes are gone).
    expect(res.blobs.some((b) => b.storageKey.includes('subPromoted') || b.storageKey.includes('subRejected'))).toBe(false);
    // isolation: nothing points at bravo.
    expect(res.blobs.some((b) => b.storageKey.startsWith(bravoId) || b.storageKey.includes(bravoId))).toBe(false);

    // the manifest mirrors the universe (H-06 foundation): same count + hashes.
    expect(res.manifest.blobs).toHaveLength(res.blobs.length);
    expect(res.manifest.blobs.map((b) => b.sha256).sort()).toEqual(res.blobs.map((b) => b.sha256).sort());
  });
});
