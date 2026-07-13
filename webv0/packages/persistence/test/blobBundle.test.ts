/**
 * blobBundle.test.ts — HARDEN-2 doc-bytes export/exit (fs driver).
 *
 * The export bundle must return VERIFIED evidence bytes (a corrupted or
 * missing object refuses the whole export), and exit must erase the object
 * store under the tenant prefix — including orphans no metadata row names.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bundleFileName, createBlobReader, deleteTenantBlobs, downloadBlobUniverse, downloadOrphanBlobs, downloadTenantBlobs, parseDocumentRows } from '../src/blobBundle';
import type { BlobDescriptor } from '../src/blobUniverse';

const TENANT = '11111111-2222-3333-4444-555555555555';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'c3blob-'));
  mkdirSync(join(root, TENANT), { recursive: true });
  const put = (key: string, content: string) => writeFileSync(join(root, key), content);
  const reader = createBlobReader({ DOCUMENTS_DIR: root })!;
  return { root, put, reader };
}

const row = (documentId: string, storageKey: string, content: string, fileName = 'receipt.pdf') => ({
  documentId,
  storageKey,
  fileName,
  sha256: createHash('sha256').update(content).digest('hex'),
  sizeBytes: content.length,
});

describe('HARDEN-2 — document blob bundle (export)', () => {
  it('downloads and VERIFIES every blob; names carry the document id', async () => {
    const { put, reader } = setup();
    put(`${TENANT}/aaa`, 'first evidence');
    put(`${TENANT}/bbb`, 'second evidence');
    const rows = [row('DOC-0001', `${TENANT}/aaa`, 'first evidence'), row('DOC-0002', `${TENANT}/bbb`, 'second evidence', 'státe mènt.pdf')];

    const written = new Map<string, Buffer>();
    const result = await downloadTenantBlobs(reader, rows, (name, bytes) => void written.set(name, bytes));
    expect(result).toEqual({ count: 2, totalBytes: 'first evidence'.length + 'second evidence'.length });
    // the sanitizer keeps spaces/dots/dashes (the API's download-name law) and
    // replaces everything else
    expect([...written.keys()].sort()).toEqual(['DOC-0001__receipt.pdf', 'DOC-0002__st_te m_nt.pdf']);
    expect(written.get('DOC-0001__receipt.pdf')!.toString()).toBe('first evidence');
  });

  it('a hash mismatch or a missing object REFUSES the export (no silent partial bundle)', async () => {
    const { put, reader } = setup();
    put(`${TENANT}/aaa`, 'tampered content');
    await expect(downloadTenantBlobs(reader, [row('DOC-0001', `${TENANT}/aaa`, 'original content')], () => {})).rejects.toThrow(
      /hash mismatch for DOC-0001/,
    );
    await expect(downloadTenantBlobs(reader, [row('DOC-0002', `${TENANT}/gone`, 'x')], () => {})).rejects.toThrow(/Blob missing for DOC-0002/);
  });

  it('parseDocumentRows demands blob-enumerable rows and tolerates an empty register', () => {
    expect(parseDocumentRows('')).toEqual([]);
    const good = JSON.stringify({ document_id: 'DOC-0001', storage_key: `${TENANT}/aaa`, file_name: 'a.pdf', sha256: 'a'.repeat(64), size_bytes: 3 });
    expect(parseDocumentRows(good)[0]!.documentId).toBe('DOC-0001');
    const bad = JSON.stringify({ document_id: 'DOC-0002', file_name: 'b.pdf', sha256: 'nope', size_bytes: 1 });
    expect(() => parseDocumentRows(bad)).toThrow(/not blob-enumerable/);
  });

  it('bundleFileName sanitizes but keeps the business id authoritative', () => {
    expect(bundleFileName(row('DOC-0009', 'k', 'x', '../../etc/passwd'))).toBe('DOC-0009__.._.._etc_passwd');
  });
});

describe('HARDEN-3 — blob-universe bundle (export, all three classes)', () => {
  const desc = (blobClass: BlobDescriptor['blobClass'], storageKey: string, content: string, bundleName: string): BlobDescriptor => ({
    blobClass,
    storageKey,
    sha256: createHash('sha256').update(content).digest('hex'),
    bundleName,
    ownerRef: bundleName,
  });

  it('downloads + verifies documents, photos AND intake quarantine; writes under their bundle paths; tallies by class', async () => {
    const { root, put, reader } = setup();
    mkdirSync(join(root, 'intake', TENANT), { recursive: true });
    put(`${TENANT}/doc1`, 'a document');
    put(`${TENANT}/photo1`, 'a headshot');
    mkdirSync(join(root, 'intake', TENANT, 'sub1'), { recursive: true });
    put(`intake/${TENANT}/sub1/up1`, 'a quarantined upload');

    const descriptors = [
      desc('document', `${TENANT}/doc1`, 'a document', 'documents/DOC-0001__a.pdf'),
      desc('photo', `${TENANT}/photo1`, 'a headshot', 'photos/PER-0001__photo.jpg'),
      desc('intake', `intake/${TENANT}/sub1/up1`, 'a quarantined upload', 'intake/sub1__up1__passport.jpg'),
    ];

    const written = new Map<string, Buffer>();
    const result = await downloadBlobUniverse(reader, descriptors, (name, bytes) => void written.set(name, bytes));
    expect(result.count).toBe(3);
    expect(result.byClass).toEqual({ document: 1, photo: 1, intake: 1 });
    expect(result.totalBytes).toBe('a document'.length + 'a headshot'.length + 'a quarantined upload'.length);
    expect([...written.keys()].sort()).toEqual(['documents/DOC-0001__a.pdf', 'intake/sub1__up1__passport.jpg', 'photos/PER-0001__photo.jpg']);
    expect(written.get('photos/PER-0001__photo.jpg')!.toString()).toBe('a headshot');
  });

  it('a missing intake or photo object REFUSES the whole export (same fail-closed law as documents)', async () => {
    const { put, reader } = setup();
    put(`${TENANT}/photo1`, 'tampered');
    await expect(
      downloadBlobUniverse(reader, [desc('photo', `${TENANT}/photo1`, 'original', 'photos/PER-0001__photo.jpg')], () => {}),
    ).rejects.toThrow(/hash mismatch for photos\/PER-0001/);
    await expect(
      downloadBlobUniverse(reader, [desc('intake', `intake/${TENANT}/gone`, 'x', 'intake/sub1__up1__f')], () => {}),
    ).rejects.toThrow(/Blob missing for intake\/sub1__up1__f/);
  });

  it('H-07: downloadOrphanBlobs captures prefix objects no DB row named (Promoted residual + orphan), skips the known set', async () => {
    const { root, put, reader } = setup();
    mkdirSync(join(root, 'intake', TENANT, 'sub1'), { recursive: true });
    put(`${TENANT}/doc1`, 'a known document'); // enumerated (known)
    put(`${TENANT}/orphan`, 'crashed-compensation orphan'); // no row names it
    put(`intake/${TENANT}/sub1/up1`, 'promoted quarantine residual'); // best-effort delete missed it

    const written = new Map<string, Buffer>();
    const result = await downloadOrphanBlobs(reader, TENANT, [`${TENANT}/doc1`], (name, bytes) => void written.set(name, bytes));

    // the known document is skipped; both prefix-discovered objects are captured under orphans/
    expect(result.capturedKeys).toEqual([`${TENANT}/orphan`, `intake/${TENANT}/sub1/up1`].sort());
    expect(result.totalBytes).toBe('crashed-compensation orphan'.length + 'promoted quarantine residual'.length);
    expect([...written.keys()].sort()).toEqual([`orphans/${TENANT}/orphan`, `orphans/intake/${TENANT}/sub1/up1`].sort());
    expect(written.get(`orphans/${TENANT}/orphan`)!.toString()).toBe('crashed-compensation orphan');
  });
});

describe('HARDEN-2 — tenant blob erasure (exit)', () => {
  it('erases EVERYTHING under the tenant prefix (orphans included), nothing else', async () => {
    const { root, put, reader } = setup();
    const OTHER = '99999999-8888-7777-6666-555555555555';
    mkdirSync(join(root, OTHER), { recursive: true });
    put(`${TENANT}/aaa`, 'row-backed');
    put(`${TENANT}/orphan`, 'no metadata row names me');
    put(`${OTHER}/keep`, 'another tenant’s evidence');

    const deleted = await deleteTenantBlobs(reader, TENANT);
    expect(deleted.sort()).toEqual([`${TENANT}/aaa`, `${TENANT}/orphan`]);
    expect(readdirSync(join(root, TENANT))).toEqual([]);
    expect(readdirSync(join(root, OTHER))).toEqual(['keep']);
  });
});
