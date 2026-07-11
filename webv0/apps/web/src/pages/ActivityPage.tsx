import { Link } from 'react-router-dom';
import { Button, makeStyles } from '@fluentui/react-components';
import type { ActivityItemDto } from '@c3web/api-contracts';
import { useActivityFeed } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';

/**
 * Activity feed (Track B3) — the org journal: a read-only, chronological
 * projection of the append-only audit stream. It shows WHAT happened and to
 * which record, never raw values, so it discloses nothing the record pages
 * don't. Owner/operations. Keyset-paginated ("Load more"), newest first.
 */

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-mid)', maxWidth: '640px', marginBottom: '18px' },
  list: { display: 'flex', flexDirection: 'column', maxWidth: '720px' },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    columnGap: '12px',
    padding: '11px 4px',
    borderBottom: '1px solid var(--c3-hairline)',
  },
  when: { fontFamily: 'var(--c3-font-mono)', fontSize: '11px', color: 'var(--c3-ink-muted)', minWidth: '128px', flexShrink: 0 },
  body: { display: 'flex', flexDirection: 'column', rowGap: '2px', flex: 1 },
  headline: { fontSize: '13.5px', color: 'var(--c3-ink)' },
  target: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-brand)' },
  targetPlain: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-muted)' },
  actor: { fontSize: '12px', color: 'var(--c3-ink-muted)' },
  more: { marginTop: '16px' },
});

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
  const s = useStyles();
  const route = targetRoute(item.entityType, item.entityId);
  return (
    <div className={s.row} data-testid={`activity-${item.id}`}>
      <span className={s.when}>{fmt(item.at)}</span>
      <span className={s.body}>
        <span className={s.headline}>
          {item.headline}
          {'  '}
          {route ? (
            <Link className={s.target} to={route}>
              {item.entityId}
            </Link>
          ) : (
            <span className={s.targetPlain}>{item.entityId}</span>
          )}
        </span>
        <span className={s.actor}>by {item.actor}</span>
      </span>
    </div>
  );
}

export function ActivityPage() {
  const s = useStyles();
  const { me } = useSession();
  const canView = me?.capabilities.canManageEntities ?? false;
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useActivityFeed(canView);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Activity" />
        <EmptyState data-testid="activity-denied" message="The activity feed is available to owners and operations." />
      </div>
    );
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader kicker="What happened" title="Activity" />
      <p className={s.intro}>
        The org journal — every recorded action across C3, newest first, drawn from the same append-only history each
        record keeps. It shows what happened and to which record; the details live on the record’s own page.
      </p>

      {isLoading && <LoadingState label="Loading activity…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load the activity feed.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && items.length === 0 && <EmptyState data-testid="activity-empty" message="No activity recorded yet." />}

      {items.length > 0 && (
        <div className={s.list} data-testid="activity-feed">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
          {hasNextPage && (
            <div className={s.more}>
              <Button appearance="secondary" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} data-testid="activity-load-more">
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
