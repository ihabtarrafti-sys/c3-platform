import type { ActivityItemDto } from '@c3web/api-contracts';
import { useActivityFeed } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  RecordRow,
  RecordLink,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../tablework';

/**
 * Activity feed (Track B3) — the org journal: a read-only, chronological
 * projection of the append-only audit stream. It shows WHAT happened and to
 * which record, never raw values, so it discloses nothing the record pages
 * don't. Owner/operations. Keyset-paginated ("Load more"), newest first.
 *
 * Tablework conversion (pivot W3, Lane 4). Behaviour/testids/copy verbatim.
 * The `activity-*` testids are `zz-activity.spec`'s only handles — including
 * `activity-load-more`, which the spec reaches THROUGH the `activity-feed`
 * container (`feed.locator('[data-testid^="activity-"]')` matches it), so the
 * Load more control stays INSIDE the feed element and after the rows.
 *
 * NEGATIVE contract: `fmt` stays the local `toLocaleString('en-GB', …)` — the
 * kit's `formatDisplayDate` is not adopted here.
 */

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** A clickable target for entity types that have a detail route. */
function targetRoute(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'Person':
      return `/people/${entityId}`;
    case 'Approval':
      return `/approvals/${entityId}`;
    case 'Team':
      return `/teams/${entityId}`;
    case 'Mission':
      return `/missions/${entityId}`;
    case 'Agreement':
      return `/agreements/${entityId}`;
    case 'Claim':
      return `/claims/${entityId}`;
    default:
      return null;
  }
}

function ActivityRow({ item }: { item: ActivityItemDto }) {
  const route = targetRoute(item.entityType, item.entityId);
  return (
    <RecordRow data-testid={`activity-${item.id}`}>
      <span className="record-row-meta">{fmt(item.at)}</span>
      <span className="record-row-name">
        {item.headline}
        {'  '}
        {/* The routable target is the kit's mono business-ID link; a
            non-routable one is an identity reference with no affordance. */}
        {route ? <RecordLink to={route}>{item.entityId}</RecordLink> : <span className="object-ref">{item.entityId}</span>}
      </span>
      <span className="record-quiet">by {item.actor}</span>
    </RecordRow>
  );
}

export function ActivityPage() {
  return (
    <TableworkPage record="Activity" section="Journal">
      <ActivityJournal />
    </TableworkPage>
  );
}

function ActivityJournal() {
  const { me } = useSession();
  const canView = me?.capabilities.canManageEntities ?? false;
  // The wire law: the capability IS the react-query `enabled` flag — the
  // journal never travels to a browser that may not read it.
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useActivityFeed(canView);

  if (!canView) {
    return (
      <CollectionFrame title="Activity">
        {/* denied !== empty: the `activity-denied` testid is the role-gate
            assertion and must survive the conversion. */}
        <EmptyState data-testid="activity-denied" message="The activity feed is available to owners and operations." />
      </CollectionFrame>
    );
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <CollectionFrame
      kicker="What happened"
      title="Activity"
      scope="The org journal — every recorded action across C3, newest first, drawn from the same append-only history each record keeps. It shows what happened and to which record; the details live on the record’s own page."
    >
      {isLoading && <LoadingState label="Loading activity…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load the activity feed.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && items.length === 0 && <EmptyState data-testid="activity-empty" message="No activity recorded yet." />}

      {items.length > 0 && (
        <div data-testid="activity-feed">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
          {hasNextPage && (
            <div className="panel-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
                data-testid="activity-load-more"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </CollectionFrame>
  );
}
