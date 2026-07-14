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
  // R3-N01: 'orphan' = a prefix-discovered object no DB row named, folded into the
  // manifest so the bundle it describes is a verifier-accepted superset.
  readonly blobClass: 'document' | 'photo' | 'intake' | 'orphan';
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
  /** R5-N02: only a 'full' export authorizes erasure; 'rows-only' is refused. */
  readonly mode: 'full' | 'rows-only';
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
        (b.blobClass !== 'document' && b.blobClass !== 'photo' && b.blobClass !== 'intake' && b.blobClass !== 'orphan')) {
      reject('manifest.blobs has an entry missing bundleName/blobClass/sha256/ownerRef (or a bad value).');
    }
  }

  if (typeof r.note !== 'string') reject('manifest.note is missing.');

  // R5-N02 / round-6 §4.2: `mode` must be EXPLICITLY PRESENT and a known literal. There is NO
  // absent-mode normalization — the old coerce-to-'full' default meant DELETING one field from a
  // rows-only (non-authorizing) manifest turned it into an authorizing one. Fail-open defaults
  // die here; every current export writes the field, so a modeless file is hand-edited or stale.
  if (r.mode !== 'full' && r.mode !== 'rows-only') {
    reject("manifest.mode must be EXPLICITLY 'full' or 'rows-only' — an absent or unknown mode never authorizes (re-export to get a mode-carrying manifest).");
  }
  return r as unknown as ExitManifest;
}

/**
 * Round-6 §4.2: the erasure-authorizing manifest may ONLY be the canonical `manifest.json` a full
 * export published — the diagnostic rows-only artifact (`manifest.rows-only.json`) is structurally
 * unacceptable NO MATTER what path an operator passes to `--manifest`. Enforced on the file NAME
 * (the belt; the parsed literal mode is the suspenders).
 */
export function assertAuthorizingManifestPath(path: string): void {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
  if (base !== 'manifest.json') {
    reject(
      `--manifest must point at a full export's canonical manifest.json (got '${base}'). ` +
        'A rows-only or renamed artifact cannot authorize an erasure.',
    );
  }
}

/** Full gate: structure + identity + schema currency + freshness. */
export function validateExitManifest(raw: unknown, ctx: ManifestCheckContext): ExitManifest {
  const m = parseExitManifest(raw);

  // R5-N02: a rows-only export (--no-doc-bytes) NEVER authorizes an erasure — it omits object
  // bytes that were never returned. Refuse it here (the suspenders; the belt is that it is
  // published as manifest.rows-only.json, so the gate's manifest.json load won't even find it).
  if (m.mode !== 'full') {
    reject(`manifest.mode is '${m.mode}', not 'full' — a rows-only export does not return object bytes and cannot authorize an erasure. Re-export in full mode.`);
  }

  if (m.tenant.slug !== ctx.tenantSlug) reject(`manifest is for tenant '${m.tenant.slug}', not '${ctx.tenantSlug}'.`);
  if (m.tenant.id !== ctx.liveTenantId) reject(`manifest tenant id ${m.tenant.id} does not match the live tenant ${ctx.liveTenantId}.`);

  // H-06: the EXACT migration array must match — not just count + tip. A reordered
  // or divergent history (same length + tip but a different middle) must not
  // authorize erasure of data exported under a different schema.
  const sameHistory =
    m.schemaVersion.length === ctx.liveMigrations.length &&
    m.schemaVersion.every((id, i) => id === ctx.liveMigrations[i]);
  if (!sameHistory) {
    const manifestTip = m.schemaVersion[m.schemaVersion.length - 1];
    const liveTip = ctx.liveMigrations[ctx.liveMigrations.length - 1];
    reject(
      `manifest schema (${m.schemaVersion.length} migrations, tip ${manifestTip ?? 'none'}) does not match the live schema ` +
        `(${ctx.liveMigrations.length} migrations, tip ${liveTip ?? 'none'}) — re-export before erasing.`,
    );
  }

  // H-06: the two time checks are INDEPENDENT. A FUTURE timestamp is never
  // legitimate and is ALWAYS refused (a stale override must not smuggle it past);
  // only the too-old staleness check is what --allow-stale-manifest waives.
  const ageMs = (ctx.now ?? new Date()).getTime() - Date.parse(m.exportedAt);
  if (ageMs < -60_000) reject(`manifest exportedAt ${m.exportedAt} is in the future — refused.`);
  if (!ctx.allowStale) {
    const maxAgeDays = ctx.maxAgeDays ?? 7;
    if (ageMs > maxAgeDays * 86_400_000) {
      reject(`manifest is stale (exported ${m.exportedAt}, older than ${maxAgeDays}d) — re-export, or pass --allow-stale-manifest to override.`);
    }
  }

  return m;
}

/** Reads the actual export bundle for the at-exit re-verification (H-06). */
export interface ExitBundleReader {
  /** Every entry name present in the bundle, EXCLUDING the manifest file itself. */
  listEntries(): Promise<string[]>;
  /** sha256 of a named bundle entry, or null if it is absent. */
  sha256Of(name: string): Promise<string | null>;
  /** Line/row count of a data file, or null if absent / not a row file. */
  rowCountOf(name: string): Promise<number | null>;
}

/**
 * H-06: re-open and verify the ACTUAL bundle at exit — the manifest only
 * describes it. The set of files present must EXACTLY match what the manifest
 * names (no missing file, no unlisted extra), every data file's sha256 (and row
 * count) must match, and every blob the manifest indexes must be present with the
 * right hash. This is what turns away a fabricated, partial, or `--no-doc-bytes`
 * (blob-less) bundle whose metadata would otherwise pass.
 */
export async function verifyExitBundle(m: ExitManifest, reader: ExitBundleReader): Promise<void> {
  const expected = new Set<string>([...m.files.map((f) => f.name), ...m.blobs.map((b) => b.bundleName)]);
  const present = new Set(await reader.listEntries());
  for (const name of expected) if (!present.has(name)) reject(`export bundle is MISSING '${name}' named in the manifest — refusing to erase.`);
  for (const name of present) if (!expected.has(name)) reject(`export bundle contains an UNLISTED file '${name}' — manifest/bundle mismatch, refusing to erase.`);

  for (const f of m.files) {
    const sha = await reader.sha256Of(f.name);
    if (sha === null) reject(`export file '${f.name}' is absent from the bundle.`);
    if (sha !== f.sha256) reject(`export file '${f.name}' hash mismatch (manifest ${f.sha256}, actual ${sha}).`);
    const rows = await reader.rowCountOf(f.name);
    if (rows !== null && rows !== f.rows) reject(`export file '${f.name}' row count ${rows} != manifest ${f.rows}.`);
  }
  for (const b of m.blobs) {
    const sha = await reader.sha256Of(b.bundleName);
    if (sha === null) reject(`blob '${b.bundleName}' (${b.blobClass}) is absent from the bundle — the export omitted its bytes.`);
    if (sha !== b.sha256) reject(`blob '${b.bundleName}' hash mismatch (manifest ${b.sha256}, actual ${sha}).`);
  }
}
