/**
 * activityOps — Track B3: the Activity Feed.
 *
 * A read-only org journal projected from the append-only audit stream —
 * newest first, keyset-paginated. Owner/operations only (the oversight
 * audience); it shows the ACTION and the record, never raw before/after
 * values, so it discloses nothing the record pages don't already.
 */
import {
  type Actor,
  type ActivityItem,
  type AuditAction,
  decodeActivityCursor,
  encodeActivityCursor,
  humanizeActivityAction,
} from '@c3web/domain';
import { assertManageEntities } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface ActivityFeedPage {
  readonly items: readonly ActivityItem[];
  /** Cursor to fetch the next (older) page, or null when the stream is exhausted. */
  readonly nextCursor: string | null;
}

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export async function listActivityFeed(
  p: Persistence,
  actor: Actor,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<ActivityFeedPage> {
  assertManageEntities(actor); // owner/operations — the org-oversight journal
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const before = opts.cursor ? decodeActivityCursor(opts.cursor) : null;

  // Fetch one extra to know whether an older page exists.
  const rows = await p.reads.forActor(actor).listActivityFeed(limit + 1, before);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items: ActivityItem[] = page.map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor,
    action: r.action as AuditAction,
    entityType: r.entityType,
    entityId: r.entityId,
    headline: humanizeActivityAction(r.action as AuditAction),
  }));

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeActivityCursor({ at: last.at, id: last.id }) : null;
  return { items, nextCursor };
}
