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
import { bundleFileName, createBlobReader, deleteTenantBlobs, downloadTenantBlobs, parseDocumentRows } from '../src/blobBundle';

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
