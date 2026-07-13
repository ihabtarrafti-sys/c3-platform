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
import { mkdirSync, writeFileSync, renameSync, readdirSync, statSync, readFileSync } from 'node:fs';
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
      return walk(bundleDir).filter((n) => n !== 'manifest.json');
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
  for (const f of result.files) writeFileSync(resolve(outDir, f.name), f.content, 'utf8');

  const write = (bundleName: string, bytes: Buffer): void => {
    const dest = resolve(outDir, bundleName);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  };

  const orphanEntries: ManifestBlob[] = [];
  if (!opts.skipDocBytes) {
    if (result.blobs.length > 0 && !reader) {
      throw new Error(
        `EXPORT REFUSED: ${result.blobs.length} storage object(s) exist but no blob storage is configured ` +
          '(set R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_DOCUMENTS or DOCUMENTS_DIR, or pass --no-doc-bytes to export rows only).',
      );
    }
    if (reader) {
      await downloadBlobUniverse(reader, result.blobs, write);
      // R3-N01: ALWAYS discover orphans when a reader is present (even with zero DB blobs —
      // an orphan-only tenant must still return every byte), and index them in the manifest.
      const orphans = await downloadOrphanBlobs(reader, result.manifest.tenant.id, result.blobs.map((b) => b.storageKey), write);
      for (const c of orphans.captured) {
        orphanEntries.push({ bundleName: c.bundleName, blobClass: 'orphan', sha256: c.sha256, ownerRef: `orphan ${c.storageKey}` });
      }
    }
  }

  const manifest: ExportManifest = { ...result.manifest, blobs: [...result.manifest.blobs, ...orphanEntries] };

  // H-06: publish the authorizing manifest LAST, atomically (write-temp + rename).
  const tmp = resolve(outDir, 'manifest.json.tmp');
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, resolve(outDir, 'manifest.json'));

  // R3-N01: the export RE-VERIFIES the bundle it just wrote — it must pass the SAME strict
  // verifier the exit gate runs, or it must not exist. Skipped only for the explicit
  // rows-only mode (whose blob-less bundle the exit gate is meant to reject anyway).
  if (!opts.skipDocBytes) {
    await verifyExitBundle(manifest, fsBundleReader(outDir));
  }

  return { manifest, blobCount: result.blobs.length, orphanCount: orphanEntries.length };
}
