/**
 * exportBundle.test.ts — HARDEN-3.2 A2 (R3-N01): the export bundle must be a superset
 * the strict exit verifier accepts, and the export must re-verify what it wrote.
 *
 * Before the fix, prefix-discovered orphans were written under orphans/ but NOT listed in
 * the manifest, so the exit gate's strict verifier (rejects any present file the manifest
 * does not name) turned away every orphan-bearing bundle; and orphan discovery was skipped
 * when there were no DB blobs, so an orphan-only tenant returned none of its bytes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createBlobReader } from '../src/blobBundle';
import { writeAndVerifyExportBundle, fsBundleReader } from '../src/exportBundle';
import { verifyExitBundle, validateExitManifest } from '../src/exitManifest';
import type { ExportResult } from '../src/exportTenant';

const TENANT = '11111111-2222-3333-4444-555555555555';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dirs: string[] = [];

function storageDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'c3exp-store-'));
  dirs.push(d);
  mkdirSync(join(d, TENANT), { recursive: true });
  return d;
}
function outDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'c3exp-out-'));
  dirs.push(d);
  return d;
}

/** A minimal ExportResult with one row file and `dbBlobs` DB-named document blobs. */
function makeResult(dbBlobs: Array<{ key: string; bytes: string; bundleName: string; ownerRef: string }>): ExportResult {
  const tenantJson = JSON.stringify({ id: TENANT, slug: 'x', name: 'X' });
  const content = tenantJson + '\n';
  return {
    manifest: {
      tenant: { id: TENANT, slug: 'x', name: 'X' },
      exportedAt: new Date().toISOString(),
      schemaVersion: ['0001_schema.sql'],
      files: [{ name: 'tenant.jsonl', rows: 1, sha256: sha(content) }],
      blobs: dbBlobs.map((b) => ({ bundleName: b.bundleName, blobClass: 'document' as const, sha256: sha(b.bytes), ownerRef: b.ownerRef })),
      note: 'test',
    },
    files: [{ name: 'tenant.jsonl', content, rows: 1, sha256: sha(content) }],
    blobs: dbBlobs.map((b) => ({ blobClass: 'document' as const, storageKey: b.key, sha256: sha(b.bytes), bundleName: b.bundleName, ownerRef: b.ownerRef })),
  };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('A2 (R3-N01) — export bundle is a verifier-accepted superset', () => {
  it('folds a prefix orphan into the manifest as class:orphan; the written bundle PASSES its own strict verifier', async () => {
    const store = storageDir();
    writeFileSync(join(store, TENANT, 'doc1'), 'the document'); // DB-named
    writeFileSync(join(store, TENANT, 'orphan1'), 'a crashed orphan'); // no DB row names it
    const reader = createBlobReader({ DOCUMENTS_DIR: store })!;
    const out = outDir();
    const result = makeResult([{ key: `${TENANT}/doc1`, bytes: 'the document', bundleName: 'documents/DOC-1__f', ownerRef: 'DOC-1' }]);

    // Does NOT throw → the export re-verified the bundle it wrote (strict verifier passed).
    const written = await writeAndVerifyExportBundle(out, result, reader, { skipDocBytes: false });
    reader.close();

    // the orphan is a first-class manifest entry, and its bytes are on disk under orphans/.
    const orphanEntry = written.manifest.blobs.find((b) => b.blobClass === 'orphan');
    expect(orphanEntry).toBeTruthy();
    expect(orphanEntry!.sha256).toBe(sha('a crashed orphan'));
    expect(existsSync(resolve(out, orphanEntry!.bundleName))).toBe(true);
    expect(readFileSync(resolve(out, orphanEntry!.bundleName), 'utf8')).toBe('a crashed orphan');

    // Load-bearing: WITHOUT the orphan in the manifest (the old behavior), the SAME strict
    // verifier rejects the present orphan file as unlisted — which is why exit turned real
    // orphan bundles away.
    const strippedManifest = { ...written.manifest, blobs: written.manifest.blobs.filter((b) => b.blobClass !== 'orphan') };
    await expect(verifyExitBundle(strippedManifest, fsBundleReader(out))).rejects.toThrow(/UNLISTED/i);
  });

  it('R5-N02: a --no-doc-bytes export publishes manifest.rows-only.json (mode rows-only); the exit gate REFUSES it', async () => {
    const out = outDir();
    // rows-only export (no reader needed): omits object bytes, so it must be non-authorizing.
    const written = await writeAndVerifyExportBundle(out, makeResult([]), null, { skipDocBytes: true });
    expect(written.manifest.mode).toBe('rows-only');
    // BELT: it is NOT published as manifest.json — the exit gate's manifest.json load can't find it.
    expect(existsSync(resolve(out, 'manifest.json'))).toBe(false);
    expect(existsSync(resolve(out, 'manifest.rows-only.json'))).toBe(true);
    // SUSPENDERS: even hand-renamed to manifest.json, the exit gate refuses mode !== 'full'.
    const rowsRaw = JSON.parse(readFileSync(resolve(out, 'manifest.rows-only.json'), 'utf8'));
    expect(() => validateExitManifest(rowsRaw, { tenantSlug: 'x', liveTenantId: TENANT, liveMigrations: rowsRaw.schemaVersion, allowStale: true })).toThrow(/rows-only|not 'full'/i);

    // The FULL-mode export of the same tenant authorizes (mode full, manifest.json present).
    const store = storageDir();
    writeFileSync(join(store, TENANT, 'orphan1'), 'a store-only orphan');
    const reader = createBlobReader({ DOCUMENTS_DIR: store })!;
    const out2 = outDir();
    const full = await writeAndVerifyExportBundle(out2, makeResult([]), reader, { skipDocBytes: false });
    reader.close();
    expect(full.manifest.mode).toBe('full');
    expect(existsSync(resolve(out2, 'manifest.json'))).toBe(true);
    const fullRaw = JSON.parse(readFileSync(resolve(out2, 'manifest.json'), 'utf8'));
    expect(() => validateExitManifest(fullRaw, { tenantSlug: 'x', liveTenantId: TENANT, liveMigrations: fullRaw.schemaVersion, allowStale: true })).not.toThrow();
  });

  it('R4-N02: a full export REFUSES with NO reader — even for a ZERO-DB-blob (orphan-only) tenant', async () => {
    const out = outDir();
    const result = makeResult([]); // zero DB blobs — the old guard only refused when the DB named one
    await expect(writeAndVerifyExportBundle(out, result, null, { skipDocBytes: false })).rejects.toThrow(/EXPORT REFUSED|MUST read the object store/i);
    // and nothing was published.
    expect(existsSync(resolve(out, 'manifest.json'))).toBe(false);
  });

  it('R4-N10: a FAILED self-verify publishes NO manifest.json (verify before publish, not after)', async () => {
    const store = storageDir();
    writeFileSync(join(store, TENANT, 'doc1'), 'the document');
    const reader = createBlobReader({ DOCUMENTS_DIR: store })!;
    const out = outDir();
    const result = makeResult([{ key: `${TENANT}/doc1`, bytes: 'the document', bundleName: 'documents/DOC-1__f', ownerRef: 'DOC-1' }]);
    // Make the manifest's row-file sha WRONG so the strict self-verify FAILS at the verify step.
    result.manifest.files[0]!.sha256 = sha('a different content');

    await expect(writeAndVerifyExportBundle(out, result, reader, { skipDocBytes: false })).rejects.toThrow();
    reader.close();
    // The crux: a failed verify leaves NO authorizing manifest. On the old order (verify AFTER
    // the rename) an invalid manifest.json would already be published — RED.
    expect(existsSync(resolve(out, 'manifest.json'))).toBe(false);
  });

  it('an orphan-only tenant (zero DB blobs) still discovers, returns, and indexes every byte', async () => {
    const store = storageDir();
    writeFileSync(join(store, TENANT, 'strayA'), 'stray A'); // only orphans exist
    mkdirSync(join(store, 'intake', TENANT, 'sub'), { recursive: true });
    writeFileSync(join(store, 'intake', TENANT, 'sub', 'strayB'), 'stray B');
    const reader = createBlobReader({ DOCUMENTS_DIR: store })!;
    const out = outDir();
    const result = makeResult([]); // zero DB blobs — the old code skipped orphan discovery entirely

    const written = await writeAndVerifyExportBundle(out, result, reader, { skipDocBytes: false });
    reader.close();

    // both orphans captured + indexed; bundle self-verified.
    expect(written.orphanCount).toBe(2);
    expect(written.manifest.blobs.filter((b) => b.blobClass === 'orphan')).toHaveLength(2);
    for (const b of written.manifest.blobs) expect(existsSync(resolve(out, b.bundleName))).toBe(true);
  });
});
