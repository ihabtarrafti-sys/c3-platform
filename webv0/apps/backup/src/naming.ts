/**
 * naming.ts — deterministic, sortable, UTC backup object keys.
 *
 * Shape (daily):  daily/2026/07/07/c3-staging-20260707T021500Z-<sha>.dump.age
 * Sunday copy:    weekly/2026/07/07/c3-staging-...-<sha>.dump.age
 * Manual:         manual/2026/07/07/c3-staging-...-<sha>.dump.age
 * Manifest:       <same path>.manifest.json
 * Status marker:  status/latest-success.json
 *
 * No credential or connection URL ever appears in a key. Names are pure
 * functions of (timestamp, mode, environment, short sha) — deterministic and
 * lexicographically sortable by time within a prefix.
 */

export type BackupMode = 'daily' | 'manual';
export type BackupClass = 'daily' | 'weekly' | 'manual';

/** Compact UTC timestamp: 20260707T021500Z (always Z / UTC). */
export function utcStamp(d: Date): string {
  const iso = d.toISOString(); // 2026-07-07T02:15:00.000Z
  return iso.slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A daily run on a Sunday is ALSO retained under weekly/. */
export function isWeekly(d: Date): boolean {
  return d.getUTCDate !== undefined && d.getUTCDay() === 0; // Sunday, UTC
}

export interface KeySpec {
  readonly when: Date;
  readonly mode: BackupMode;
  readonly environmentLabel: string;
  readonly shortSha: string;
}

function safeSha(sha: string): string {
  const s = (sha || 'unknown').toLowerCase().replace(/[^0-9a-z]/g, '');
  return (s || 'unknown').slice(0, 12);
}

function datePath(d: Date): string {
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

/** The base object key for a class (without the trailing .manifest.json). */
export function objectKey(cls: BackupClass, spec: KeySpec): string {
  const stamp = utcStamp(spec.when);
  const label = spec.environmentLabel.replace(/[^0-9a-z-]/gi, '');
  return `${cls}/${datePath(spec.when)}/c3-${label}-${stamp}-${safeSha(spec.shortSha)}.dump.age`;
}

export function manifestKey(dumpKey: string): string {
  return `${dumpKey}.manifest.json`;
}

/**
 * The classes an object belongs to. A `manual` run → [manual]. A `daily` run
 * → [daily], plus [weekly] when it falls on a Sunday.
 */
export function classesFor(mode: BackupMode, when: Date): BackupClass[] {
  if (mode === 'manual') return ['manual'];
  return isWeekly(when) ? ['daily', 'weekly'] : ['daily'];
}

export const STATUS_LATEST_SUCCESS_KEY = 'status/latest-success.json';
