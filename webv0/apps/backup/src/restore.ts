/**
 * restore.ts — pure helpers for the restore drill (unit-tested). The heavy
 * I/O lives in restore-main.ts and is certified by the hosted drill.
 */
import { createHash } from 'node:crypto';
import type { ValidatedBlobInventory, ValidatedBlobArchive } from './signing';

/** Fetch an object's bytes by storage key, or null if it does not exist. */
export type BlobFetch = (storageKey: string) => Promise<Buffer | null>;

export interface BlobRecoveryResult {
  /** The classes whose representative object was fetched + hash-verified. */
  readonly verifiedClasses: string[];
}

/**
 * H-08: prove the object store is recoverable. For every NON-EMPTY blob class in
 * the (signed) manifest inventory, fetch its representative object and hash-check
 * it. A missing or corrupt object FAILS the drill — a backup whose bytes cannot
 * be recovered is not a backup. Empty classes are skipped (nothing to prove).
 */
export async function verifyBlobRecovery(inventory: ValidatedBlobInventory, fetch: BlobFetch): Promise<BlobRecoveryResult> {
  const classes: Array<[string, ValidatedBlobInventory['document']]> = [
    ['document', inventory.document],
    ['photo', inventory.photo],
    ['intake', inventory.intake],
  ];
  const verifiedClasses: string[] = [];
  for (const [name, c] of classes) {
    if (c.count === 0) continue;
    // No silent skip (round-2): a class WITH objects but no verifiable sample is
    // an unprovable recoverability gap, not something to pass over.
    if (c.sample === null) {
      throw new Error(`Restore drill: ${name} reports ${c.count} object(s) but no verifiable sample — count-positive/sample-null must NOT be skipped.`);
    }
    const bytes = await fetch(c.sample.storageKey);
    if (!bytes) {
      throw new Error(`Restore drill: ${name} object '${c.sample.storageKey}' is UNRECOVERABLE (not found in the object store).`);
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== c.sample.sha256) {
      throw new Error(`Restore drill: ${name} object '${c.sample.storageKey}' hash mismatch (manifest ${c.sample.sha256}, actual ${sha}).`);
    }
    verifiedClasses.push(name);
  }
  return { verifiedClasses };
}

/** Extract one object's bytes from the (already-decrypted) blob archive, or null. */
export type ArchiveExtract = (storageKey: string) => Promise<Buffer | null>;

/** R3-N06: how many objects a routine drill extracts+hash-verifies before it trusts the
 *  signed index for the rest. A real recovery extracts everything (see the loop below). */
const DRILL_SHA_SAMPLE = 25;

/** An injectable [0,1) source so the sampler is deterministic under test. */
export type Rng = () => number;

/** The three blob classes, in a fixed order so the sampler consumes the RNG deterministically. */
const BLOB_CLASSES = ['document', 'photo', 'intake'] as const;

/**
 * Split `budget` across the non-empty classes as evenly as possible (round-robin, one slot at a
 * time), never exceeding a class's own size. Every non-empty class gets ≥1 before any gets 2, so
 * — as long as `budget ≥ (number of non-empty classes)` — every non-empty class is represented,
 * and the quotas sum to `min(budget, Σ sizes)`. Deterministic; no RNG.
 */
function stratifiedQuota(sizes: number[], budget: number): number[] {
  const quota = sizes.map(() => 0);
  let remaining = budget;
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (let i = 0; i < sizes.length && remaining > 0; i++) {
      if (quota[i]! < sizes[i]!) {
        quota[i]!++;
        remaining--;
        progress = true;
      }
    }
  }
  return quota;
}

/**
 * R4-N12 / R5-N11: a SOUND, STRATIFIED without-replacement sample. The old
 * `sort(() => Math.random() - 0.5)` was a biased, non-injectable shuffle; R4-N12's partial
 * Fisher-Yates then force-added the FIRST entry of any class the random draw missed — a
 * forced-first-entry bias that over-sampled position 0 and could push the sample PAST the budget.
 * This draws WITHIN each non-empty class (its own partial Fisher-Yates over an injectable RNG)
 * under a stratified quota, so: every non-empty class is represented, the entry checked in each
 * class is genuinely random (no forced index), and the total never exceeds `sampleSize`. It is an
 * honest sample: an entry OUTSIDE the draw is not sha-verified (that is the documented contract).
 */
export function strongSample(
  entries: ValidatedBlobArchive['entries'],
  sampleSize: number = DRILL_SHA_SAMPLE,
  rng: Rng = Math.random,
): ValidatedBlobArchive['entries'] {
  if (entries.length <= sampleSize) return entries;
  const buckets = BLOB_CLASSES.map((cls) => entries.filter((e) => e.cls === cls));
  const quota = stratifiedQuota(buckets.map((b) => b.length), sampleSize);

  const chosen: ValidatedBlobArchive['entries'][number][] = [];
  for (let c = 0; c < buckets.length; c++) {
    const arr = [...buckets[c]!];
    const take = quota[c]!;
    // Partial Fisher-Yates within the class: after i iterations arr[0..i) are distinct uniform
    // draws — no entry is picked by position, so a class's first object has no special standing.
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(rng() * (arr.length - i));
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    for (let i = 0; i < take; i++) chosen.push(arr[i]!);
  }
  return chosen;
}

/**
 * H-08 (Option A) / R3-N06: prove recoverability from the INDEPENDENT encrypted blob
 * archive — the live documents bucket is assumed LOST. Unlike the old representative-per-
 * class check, this verifies the COMPLETE index: (1) the archive's per-class count must
 * equal the signed manifest inventory (completeness — no class short, none extra), (2)
 * EVERY indexed object must extract (full key presence), and (3) a strong random sample
 * (all classes) is hash-verified. The signed manifest carries the full {key,sha,cls}
 * index, so a full sha verification is available on demand — which a real recovery does
 * for free while downloading every object.
 */
export async function verifyBlobArchiveRecovery(
  inventory: ValidatedBlobInventory,
  archive: ValidatedBlobArchive,
  extract: ArchiveExtract,
  rng: Rng = Math.random,
): Promise<BlobRecoveryResult> {
  // (1) Completeness: the archive index must match the census count for every class.
  const archiveCount: Record<string, number> = { document: 0, photo: 0, intake: 0 };
  for (const e of archive.entries) archiveCount[e.cls] = (archiveCount[e.cls] ?? 0) + 1;
  for (const cls of ['document', 'photo', 'intake'] as const) {
    if (inventory[cls].count !== archiveCount[cls]) {
      throw new Error(`Restore drill: ${cls} — manifest inventory ${inventory[cls].count} != archive index ${archiveCount[cls]} (incomplete or incoherent archive).`);
    }
  }

  // (2) Full key presence + (3) sampled sha verification.
  const sampleKeys = new Set(strongSample(archive.entries, DRILL_SHA_SAMPLE, rng).map((e) => e.storageKey));
  const verifiedClasses = new Set<string>();
  for (const e of archive.entries) {
    const bytes = await extract(e.storageKey);
    if (!bytes) throw new Error(`Restore drill: object '${e.storageKey}' (${e.cls}) is UNRECOVERABLE from the independent archive.`);
    if (sampleKeys.has(e.storageKey)) {
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== e.sha256) throw new Error(`Restore drill: object '${e.storageKey}' hash mismatch in archive (expected ${e.sha256}, actual ${sha}).`);
    }
    verifiedClasses.add(e.cls);
  }
  return { verifiedClasses: [...verifiedClasses] };
}

/** A unique, safe, disposable restore database name. Never the live DB. */
export function disposableDbName(now: Date, salt: string): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const s = salt.replace(/[^0-9a-z]/gi, '').slice(0, 6) || 'x';
  return `c3_restore_drill_${stamp}_${s}`.toLowerCase();
}

/** Reject any DB name that is not a disposable drill database (safety guard). */
export function assertDisposableDbName(name: string): void {
  if (!/^c3_restore_drill_[0-9]{14}_[0-9a-z]{1,6}$/.test(name)) {
    throw new Error(`Refusing to operate on '${name}': not a disposable restore-drill database.`);
  }
  if (name === 'railway' || name === 'postgres') {
    throw new Error('Refusing to operate on the live/system database.');
  }
}

export const REQUIRED_FIXTURES = {
  persons: ['PER-0001'],
  approvals: ['APR-0001', 'APR-0002'],
} as const;

/**
 * Resolve the optional composed per-org-restore target (Track A, B-5 / A-5).
 * When `RESTORE_EXPORT_TENANT` is set, the drill additionally runs the
 * organization-scoped export against the disposable restored database, proving
 * per-org restore = whole-DB restore ∘ export:tenant. Returns null when unset;
 * throws on a malformed slug (fail-closed rather than silently skipping).
 */
export function resolveExportTenant(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const slug = raw.trim();
  if (slug === '') return null;
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid RESTORE_EXPORT_TENANT '${raw}': expected a lower-case tenant slug.`);
  }
  return slug;
}
