/**
 * blobUniverse.ts — HARDEN-3 Batch C (H-07): the AUTHORITATIVE enumeration of
 * every storage object a tenant owns, derived from the database rows that name
 * those objects. One source of truth for three ceremonies:
 *
 *   - EXPORT bundles every object (verified against its stored sha256);
 *   - EXIT records every object in the erasure tombstone, then deletes + verifies;
 *   - BACKUP snapshots every object so a restore can recover the bytes.
 *
 * Before this, the export bundled DOCUMENTS ONLY and the exit prefix-listed
 * `${tenantId}/` ONLY — so **photos** (columns on `person`, key `${tenantId}/…`)
 * were never exported, and **intake quarantine** (keys on `intake_submission.uploads`,
 * key `intake/${tenantId}/…` — a DIFFERENT prefix) was never exported OR erased.
 * The three classes and their storage-key prefixes:
 *
 *   document  ${tenantId}/<uuid>          document.storage_key
 *   photo     ${tenantId}/<uuid>          person.photo_storage_key
 *   intake    intake/${tenantId}/<sub>/<upload>   intake_submission.uploads[].storageKey
 *
 * Only PENDING intake submissions have live quarantine bytes: a Promoted
 * submission's upload was copied to `${tenantId}/…` and its quarantine key
 * deleted; a Rejected submission's bytes are wiped. So enumerating Pending
 * submissions never references an already-deleted object.
 *
 * This module is DB-ONLY (no object-store/S3 import) so it may be used by the
 * export snapshot AND the backup image without pulling in the storage SDK — the
 * bytes are moved by the CLI's blob reader (blobBundle.ts).
 */

export type BlobClass = 'document' | 'photo' | 'intake';

export interface BlobDescriptor {
  readonly blobClass: BlobClass;
  /** The exact object-store key (unique within the tenant). */
  readonly storageKey: string;
  /** Stored SHA-256 — every class carries one, so every object is verifiable. */
  readonly sha256: string;
  /** Stable, collision-free relative path inside the export bundle. */
  readonly bundleName: string;
  /** Human handle for error messages (DOC-XXXX / PER-XXXX / intake <sub>). */
  readonly ownerRef: string;
}

/** Minimal shape of a connected pg client (kept structural to avoid a pg import). */
export interface Queryable {
  query<R extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

const SHA256 = /^[a-f0-9]{64}$/;

/** Keep spaces/dots/dashes (the API download-name law), replace everything else. */
function safeName(s: string): string {
  return s.replace(/[^\w. -]/g, '_').slice(0, 140) || 'file';
}

function photoExt(contentType: string | null | undefined): string {
  switch (contentType) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/jpeg':
      return '.jpg';
    default:
      return '';
  }
}

interface IntakeUpload {
  readonly storageKey?: unknown;
  readonly sha256?: unknown;
  readonly uploadId?: unknown;
  readonly fileName?: unknown;
}

/**
 * Enumerate every storage object owned by the tenant. Runs three reads; when
 * called inside the export's REPEATABLE READ snapshot the result is consistent
 * with the exported rows. Throws (fail-closed) if any object lacks a verifiable
 * sha256 — an un-verifiable blob must not silently ride in a bundle or be
 * recorded as recoverable.
 */
export async function enumerateTenantBlobs(db: Queryable, tenantId: string): Promise<BlobDescriptor[]> {
  const out: BlobDescriptor[] = [];

  // 1. Documents — DOC-XXXX, key ${tenantId}/<uuid>.
  const docs = await db.query<{ document_id: string; storage_key: string; sha256: string; file_name: string }>(
    `SELECT document_id, storage_key, sha256, file_name FROM document WHERE tenant_id = $1 ORDER BY document_id`,
    [tenantId],
  );
  for (const d of docs.rows) {
    if (!SHA256.test(d.sha256)) throw new Error(`Document ${d.document_id} has no verifiable sha256 — blob universe refuses.`);
    out.push({
      blobClass: 'document',
      storageKey: d.storage_key,
      sha256: d.sha256,
      bundleName: `documents/${d.document_id}__${safeName(d.file_name)}`,
      ownerRef: d.document_id,
    });
  }

  // 2. Photos — person.photo_storage_key, key ${tenantId}/<uuid>.
  const photos = await db.query<{ person_id: string; photo_storage_key: string; photo_sha256: string | null; photo_content_type: string | null }>(
    `SELECT person_id, photo_storage_key, photo_sha256, photo_content_type
       FROM person WHERE tenant_id = $1 AND photo_storage_key IS NOT NULL ORDER BY person_id`,
    [tenantId],
  );
  for (const p of photos.rows) {
    if (!p.photo_sha256 || !SHA256.test(p.photo_sha256)) {
      throw new Error(`Person ${p.person_id} has a photo but no verifiable sha256 — blob universe refuses.`);
    }
    out.push({
      blobClass: 'photo',
      storageKey: p.photo_storage_key,
      sha256: p.photo_sha256,
      bundleName: `photos/${p.person_id}__photo${photoExt(p.photo_content_type)}`,
      ownerRef: `${p.person_id} (photo)`,
    });
  }

  // 3. Intake QUARANTINE — Pending submissions' uploads, key intake/${tenantId}/<sub>/<upload>.
  const subs = await db.query<{ id: string; uploads: unknown }>(
    `SELECT id, uploads FROM intake_submission WHERE tenant_id = $1 AND status = 'Pending' ORDER BY id`,
    [tenantId],
  );
  for (const s of subs.rows) {
    const uploads: IntakeUpload[] = Array.isArray(s.uploads) ? (s.uploads as IntakeUpload[]) : [];
    for (const u of uploads) {
      const storageKey = typeof u.storageKey === 'string' ? u.storageKey : '';
      const sha256 = typeof u.sha256 === 'string' ? u.sha256 : '';
      if (!storageKey || !SHA256.test(sha256)) {
        throw new Error(`Intake submission ${s.id} has an upload with no verifiable key/sha256 — blob universe refuses.`);
      }
      const uploadId = typeof u.uploadId === 'string' ? u.uploadId : 'file';
      const fileName = typeof u.fileName === 'string' ? u.fileName : 'file';
      out.push({
        blobClass: 'intake',
        storageKey,
        sha256,
        bundleName: `intake/${s.id}__${safeName(uploadId)}__${safeName(fileName)}`,
        ownerRef: `intake ${s.id}`,
      });
    }
  }

  return out;
}

/** The distinct object-store PREFIXES a tenant's blobs live under (for orphan sweeps). */
export function tenantBlobPrefixes(tenantId: string): string[] {
  return [`${tenantId}/`, `intake/${tenantId}/`];
}
