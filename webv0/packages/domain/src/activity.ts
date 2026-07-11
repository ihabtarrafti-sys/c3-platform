/**
 * activity.ts — Track B3: the Activity Feed projection.
 *
 * The org journal is a READ-ONLY projection of the append-only audit stream —
 * a human-readable, chronological "what happened" over the same events the
 * record pages already show. It shows the ACTION and the record, never raw
 * before/after values (those stay on the record's own gated timeline). Since
 * the projection is derived from the AuditAction verb, it stays correct as new
 * actions are added — no per-action table to maintain.
 */
import type { AuditAction } from './audit';

export interface ActivityItem {
  /** Stable cursor id (the audit row's uuid). */
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  /** Human phrase for the action, e.g. "Credential deactivated". */
  readonly headline: string;
}

/** Opaque keyset cursor "<at>|<id>" for stable newest-first pagination. */
export interface ActivityCursor {
  readonly at: string;
  readonly id: string;
}

export function encodeActivityCursor(c: ActivityCursor): string {
  return `${c.at}|${c.id}`;
}

export function decodeActivityCursor(raw: string): ActivityCursor | null {
  const i = raw.indexOf('|');
  if (i <= 0) return null;
  const at = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (!at || !id) return null;
  return { at, id };
}

/**
 * "PersonDeactivated" → "Person deactivated"; "ApprovalExecutionFailed" →
 * "Approval execution failed". PascalCase → sentence case, generically.
 */
export function humanizeActivityAction(action: AuditAction): string {
  const words = action.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
  const lowered = words.map((w, i) => (i === 0 ? w : w.toLowerCase()));
  return lowered.join(' ');
}
