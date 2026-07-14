/**
 * exportBundle.ts — HARDEN-3.2 A2 (R3-N01): write the export bundle to disk AND
 * make it self-consistent with the strict exit verifier.
 *
 * The bug this closes: `exportTenant` built the manifest from row files + the
 * DB-ENUMERATED blob list only, while the CLI wrote prefix-discovered orphans under
 * `orphans/` WITHOUT listing them — so the exit gate's strict verifier (which rejects any
 * present file the manifest does not name) turned away every real orphan-bearing bundle,
 * and orphan discovery was skipped entirely when there were no DB blobs. Here the manifest
 * becomes the AUTHORITATIVE SUPERSET (orphans folded in as `class:'orphan'`), orphan
 * discovery ALWAYS runs when a reader is present, and the export RE-VERIFIES the bundle it
 * just wrote against the same `verifyExitBundle` — so it can never publish a manifest the
 * exit gate would later reject. This module is CLI-support (uses fs); the API never imports it.
 */
import { mkdirSync, writeFileSync, renameSync, readdirSync, statSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExportResult, ExportManifest, ManifestBlob } from './exportTenant';
import { type BlobReader, downloadBlobUniverse, downloadOrphanBlobs } from './blobBundle';
import { verifyExitBundle, type ExitBundleReader } from './exitManifest';

/** An fs-backed reader over an export bundle directory (for the at-export/at-exit re-verify). */
export function fsBundleReader(bundleDir: string): ExitBundleReader {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : [relative(bundleDir, full).split('\\').join('/')];
    });
  return {
    async listEntries() {
      return walk(bundleDir).filter((n) => n !== 'manifest.json' && n !== 'manifest.rows-only.json');
    },
    async sha256Of(name) {
      try {
        return createHash('sha256').update(readFileSync(resolve(bundleDir, name))).digest('hex');
      } catch {
        return null;
      }
    },
    async rowCountOf(name) {
      try {
        const text = readFileSync(resolve(bundleDir, name), 'utf8');
        if (text.length === 0) return 0;
        return text.replace(/\n$/, '').split('\n').length;
      } catch {
        return null;
      }
    },
  };
}

export interface WriteBundleResult {
  readonly manifest: ExportManifest;
  readonly blobCount: number;
  readonly orphanCount: number;
}

/**
 * Write `result` to `outDir` as a bundle whose manifest is a superset that the strict
 * verifier accepts, then re-verify it. Throws (refuses) if bytes are required but no
 * reader is configured, or if the written bundle fails its own strict verification.
 */
export async function writeAndVerifyExportBundle(
  outDir: string,
  result: ExportResult,
  reader: BlobReader | null,
  opts: { skipDocBytes: boolean },
): Promise<WriteBundleResult> {
  mkdirSync(outDir, { recursive: true });
  // R5-N09: a REUSED output directory may hold a prior authorizing manifest.json. Delete any
  // existing manifest (both names) at the START of the sequence, so a FAILED verify below leaves
  // NO manifest at all — never a stale one that a slug-only glance might treat as fresh.
  rmSync(resolve(outDir, 'manifest.json'), { force: true });
  rmSync(resolve(outDir, 'manifest.rows-only.json'), { force: true });
  for (const f of result.files) writeFileSync(resolve(outDir, f.name), f.content, 'utf8');

  const write = (bundleName: string, bytes: Buffer): void => {
    const dest = resolve(outDir, bundleName);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  };

  const orphanEntries: ManifestBlob[] = [];
  if (!opts.skipDocBytes) {
    // R4-N02: the object-store reader is MANDATORY for a full (exit-authorizing) export — a
    // null reader REFUSES even with ZERO DB blobs. The old guard only refused when the DB
    // NAMED a blob, so an orphan-only tenant was exported row-only and its orphaned bytes were
    // never returned or accounted for. A full export must be able to read the store.
    if (!reader) {
      throw new Error(
        'EXPORT REFUSED: no blob storage is configured — a full export MUST read the object store ' +
          '(even a zero-DB-blob tenant may have orphaned objects). Set R2_ENDPOINT/R2_ACCESS_KEY_ID/' +
          'R2_SECRET_ACCESS_KEY/R2_BUCKET_DOCUMENTS or DOCUMENTS_DIR, or pass --no-doc-bytes to export rows only.',
      );
    }
    await downloadBlobUniverse(reader, result.blobs, write);
    // R3-N01: ALWAYS discover orphans (even with zero DB blobs — an orphan-only tenant must
    // still return every byte), and index them in the manifest.
    const orphans = await downloadOrphanBlobs(reader, result.manifest.tenant.id, result.blobs.map((b) => b.storageKey), write);
    for (const c of orphans.captured) {
      orphanEntries.push({ bundleName: c.bundleName, blobClass: 'orphan', sha256: c.sha256, ownerRef: `orphan ${c.storageKey}` });
    }
  }

  // R5-N02: a rows-only export carries mode 'rows-only'; a full export is 'full'.
  const manifest: ExportManifest = {
    ...result.manifest,
    mode: opts.skipDocBytes ? 'rows-only' : 'full',
    blobs: [...result.manifest.blobs, ...orphanEntries],
  };

  // R4-N10: VERIFY FIRST, publish LAST. The strict verifier runs against the row + blob files
  // already on disk and the in-memory manifest (fsBundleReader excludes manifest.json, which
  // isn't written yet) — so a FAILED verify throws with NO manifest.json present, never an
  // invalid published one. R3-N01: this is the SAME strict verifier the exit gate runs, so the
  // export can only publish a bundle the gate would accept. Skipped only for the explicit
  // rows-only mode (whose blob-less bundle the exit gate is meant to reject anyway).
  if (!opts.skipDocBytes) {
    await verifyExitBundle(manifest, fsBundleReader(outDir));
  }

  // R5-N02: publish the authorizing manifest as manifest.json ONLY for a full export. A
  // rows-only bundle publishes manifest.rows-only.json — so the exit gate's manifest.json load
  // never finds an authorizing file (the belt), and even a hand-rename is refused by the
  // mode:'rows-only' body (the suspenders). H-06/R4-N10: atomic write-temp + rename, after verify.
  const manifestName = opts.skipDocBytes ? 'manifest.rows-only.json' : 'manifest.json';
  const tmp = resolve(outDir, `${manifestName}.tmp`);
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, resolve(outDir, manifestName));

  return { manifest, blobCount: result.blobs.length, orphanCount: orphanEntries.length };
}
