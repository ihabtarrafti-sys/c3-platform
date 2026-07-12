/**
 * exitManifest.ts — HARDEN-3 Batch C (H-06): the erasure-authorizing manifest gate.
 *
 * Tenant exit is data-return-FIRST: it refuses to erase unless an export manifest
 * proves the org's data was returned. Before this, the exit CLI only checked that
 * `manifest.tenant.slug` matched — so a hand-written `{"tenant":{"slug":"alpha"}}`,
 * a partial file, or a stale manifest from a months-old export could authorize an
 * irreversible erasure. This validates the manifest STRICTLY:
 *
 *   - STRUCTURE — every required field is present and well-typed (a hand-written
 *     or truncated manifest fails here);
 *   - IDENTITY — tenant id AND slug both match the LIVE tenant being erased (not
 *     the slug alone);
 *   - CURRENCY — the manifest's applied-migration list equals the live schema, so
 *     an export taken before a later migration (and thus possibly missing newer
 *     tables' data) cannot authorize erasure;
 *   - FRESHNESS — the export is within `maxAgeDays` (default 7), unless an explicit
 *     stale override is passed; a future timestamp is always refused.
 *
 * Pure + dependency-free (no zod in this package): the exit CLI calls it after
 * resolving the live tenant id + migrations.
 */

export interface ManifestBlobEntry {
  readonly bundleName: string;
  readonly blobClass: 'document' | 'photo' | 'intake';
  readonly sha256: string;
  readonly ownerRef: string;
}

export interface ExitManifest {
  readonly tenant: { id: string; slug: string; name: string };
  readonly exportedAt: string;
  readonly schemaVersion: string[];
  readonly files: Array<{ name: string; rows: number; sha256: string }>;
  readonly blobs: ManifestBlobEntry[];
  readonly note: string;
}

export interface ManifestCheckContext {
  readonly tenantSlug: string;
  readonly liveTenantId: string;
  readonly liveMigrations: string[];
  readonly now?: Date;
  readonly maxAgeDays?: number;
  readonly allowStale?: boolean;
}

/** Thrown with a human-facing reason when a manifest may not authorize erasure. */
export class ManifestRejectedError extends Error {}

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function reject(msg: string): never {
  throw new ManifestRejectedError(msg);
}

/** Validate STRUCTURE only — returns the typed manifest or throws ManifestRejectedError. */
export function parseExitManifest(raw: unknown): ExitManifest {
  if (!isObj(raw)) reject('manifest is not a JSON object.');
  const r = raw as Record<string, unknown>;

  if (!isObj(r.tenant)) reject('manifest.tenant is missing.');
  const t = r.tenant as Record<string, unknown>;
  if (!isStr(t.id) || !UUID.test(t.id)) reject('manifest.tenant.id is missing or not a uuid.');
  if (!isStr(t.slug)) reject('manifest.tenant.slug is missing.');
  if (!isStr(t.name)) reject('manifest.tenant.name is missing.');

  if (!isStr(r.exportedAt) || Number.isNaN(Date.parse(r.exportedAt))) reject('manifest.exportedAt is missing or not a date.');

  if (!Array.isArray(r.schemaVersion) || r.schemaVersion.length === 0 || !r.schemaVersion.every(isStr)) {
    reject('manifest.schemaVersion must be a non-empty array of migration ids.');
  }

  if (!Array.isArray(r.files) || r.files.length === 0) reject('manifest.files must be a non-empty array.');
  for (const f of r.files as unknown[]) {
    if (!isObj(f) || !isStr(f.name) || typeof f.rows !== 'number' || !Number.isInteger(f.rows) || f.rows < 0 || !isStr(f.sha256) || !SHA256.test(f.sha256)) {
      reject('manifest.files has an entry missing name/rows/sha256 (or a bad sha256).');
    }
  }

  if (!Array.isArray(r.blobs)) reject('manifest.blobs must be an array (possibly empty).');
  for (const b of r.blobs as unknown[]) {
    if (!isObj(b) || !isStr(b.bundleName) || !isStr(b.sha256) || !SHA256.test(b.sha256) || !isStr(b.ownerRef) ||
        (b.blobClass !== 'document' && b.blobClass !== 'photo' && b.blobClass !== 'intake')) {
      reject('manifest.blobs has an entry missing bundleName/blobClass/sha256/ownerRef (or a bad value).');
    }
  }

  if (typeof r.note !== 'string') reject('manifest.note is missing.');

  return raw as unknown as ExitManifest;
}

/** Full gate: structure + identity + schema currency + freshness. */
export function validateExitManifest(raw: unknown, ctx: ManifestCheckContext): ExitManifest {
  const m = parseExitManifest(raw);

  if (m.tenant.slug !== ctx.tenantSlug) reject(`manifest is for tenant '${m.tenant.slug}', not '${ctx.tenantSlug}'.`);
  if (m.tenant.id !== ctx.liveTenantId) reject(`manifest tenant id ${m.tenant.id} does not match the live tenant ${ctx.liveTenantId}.`);

  const manifestTip = m.schemaVersion[m.schemaVersion.length - 1];
  const liveTip = ctx.liveMigrations[ctx.liveMigrations.length - 1];
  if (m.schemaVersion.length !== ctx.liveMigrations.length || manifestTip !== liveTip) {
    reject(
      `manifest schema (${m.schemaVersion.length} migrations, tip ${manifestTip ?? 'none'}) does not match the live schema ` +
        `(${ctx.liveMigrations.length} migrations, tip ${liveTip ?? 'none'}) — re-export before erasing.`,
    );
  }

  if (!ctx.allowStale) {
    const maxAgeDays = ctx.maxAgeDays ?? 7;
    const ageMs = (ctx.now ?? new Date()).getTime() - Date.parse(m.exportedAt);
    if (ageMs < -60_000) reject(`manifest exportedAt ${m.exportedAt} is in the future — refused.`);
    if (ageMs > maxAgeDays * 86_400_000) {
      reject(`manifest is stale (exported ${m.exportedAt}, older than ${maxAgeDays}d) — re-export, or pass --allow-stale-manifest to override.`);
    }
  }

  return m;
}
