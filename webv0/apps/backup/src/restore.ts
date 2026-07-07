/**
 * restore.ts — pure helpers for the restore drill (unit-tested). The heavy
 * I/O lives in restore-main.ts and is certified by the hosted drill.
 */

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
