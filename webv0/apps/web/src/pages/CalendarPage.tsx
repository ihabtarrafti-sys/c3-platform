import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CalendarItemDto } from '@c3web/api-contracts';
import { useCalendar } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../tablework';

/**
 * Ops calendar / timeline (Track B) — the forward horizon, on the Tablework
 * frame (pivot W2; the Fluent page's behaviour, testids, and copy verbatim).
 * The twin of the activity feed (backward) and Home (now): every dated
 * obligation already in C3 — credential expiries, agreement ends, mission
 * dates, approver delegations — laid out soonest-first, with overdue-but-still-
 * open items at the top where they belong. Read-only aggregation;
 * owner/operations.
 */

const HORIZONS = [30, 60, 90, 180];

const KIND_LABEL: Record<CalendarItemDto['kind'], string> = {
  CredentialExpiry: 'Credential expiry',
  AgreementEnd: 'Agreement end',
  MissionStart: 'Mission start',
  MissionEnd: 'Mission end',
  DelegationEnd: 'Delegation end',
  SubscriptionRenewal: 'Subscription renewal',
};

/**
 * ⚠️ THE ORG-WIDE DEFINITION OF "OVERDUE" LIVES HERE, CLIENT-SIDE, AND NO TEST
 * CATCHES A CHANGE. `d < 0` = overdue/blocked, `d <= 7` = the near band. These
 * three functions are the visible meaning of "overdue" everywhere the calendar
 * is read. They are carried VERBATIM through the conversion — thresholds,
 * boundaries, wording and bucket order unchanged. Any change to them is a
 * product decision, not a refactor.
 */
function relLabel(d: number): string {
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d}d`;
}
function urgencyVariant(d: number): 'blocked' | 'pending' | 'neutral' {
  if (d < 0) return 'blocked';
  if (d <= 7) return 'pending';
  return 'neutral';
}
function bucketOf(d: number): string {
  if (d < 0) return 'Overdue';
  if (d <= 7) return 'Next 7 days';
  if (d <= 30) return 'This month';
  return 'Later';
}
const BUCKET_ORDER = ['Overdue', 'Next 7 days', 'This month', 'Later'];

export function CalendarPage() {
  return (
    <TableworkPage record="Calendar" section="Horizon">
      <CalendarHorizon />
    </TableworkPage>
  );
}

function CalendarHorizon() {
  const { me } = useSession();
  const canView = me?.capabilities.canViewSituation ?? false;
  const [horizon, setHorizon] = useState(90);
  const [kindFilter, setKindFilter] = useState<CalendarItemDto['kind'] | null>(null);
  // THE WIRE LAW: the capability IS the `enabled` flag — never hoisted to
  // always-on and hidden.
  const { data, isLoading, isError, error } = useCalendar(horizon, canView);

  const all = useMemo(() => data?.items ?? [], [data]);
  const items = kindFilter ? all.filter((i) => i.kind === kindFilter) : all;
  const kindsPresent = useMemo(() => (Object.keys(KIND_LABEL) as CalendarItemDto['kind'][]).filter((k) => all.some((i) => i.kind === k)), [all]);
  const buckets = useMemo(() => {
    const m = new Map<string, CalendarItemDto[]>();
    for (const it of items) {
      const b = bucketOf(it.daysUntil);
      (m.get(b) ?? m.set(b, []).get(b)!).push(it);
    }
    return BUCKET_ORDER.filter((b) => m.has(b)).map((b) => [b, m.get(b)!] as const);
  }, [items]);

  if (!canView) {
    return (
      <CollectionFrame title="Calendar">
        <EmptyState data-testid="calendar-denied" message="The calendar is available to owners and operations." />
      </CollectionFrame>
    );
  }

  return (
    <CollectionFrame
      kicker="What's coming"
      title="Calendar"
      scope={
        <>
          Every dated obligation in C3 on one timeline — credential expiries, agreement ends, mission dates, delegation
          windows — soonest first, with anything overdue-but-still-open at the top. A planning view; act on each from its
          own record.
        </>
      }
      filters={
        <>
          <span className="saved-views-label">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              type="button"
              key={h}
              className={horizon === h ? 'search-chip active' : 'search-chip'}
              onClick={() => setHorizon(h)}
              data-testid={`calendar-horizon-${h}`}
            >
              {h}d
            </button>
          ))}
        </>
      }
    >
      {isLoading && <LoadingState label="Gathering the horizon…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load the calendar.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}

      {data && all.length === 0 && (
        <EmptyState data-testid="calendar-empty" message={`Nothing dated in the next ${horizon} days — the horizon is clear.`} />
      )}

      {data && all.length > 0 && (
        <>
          {kindsPresent.length > 1 && (
            <div className="search-chips" data-testid="calendar-chips">
              <button type="button" className={kindFilter === null ? 'search-chip active' : 'search-chip'} onClick={() => setKindFilter(null)}>
                All ({all.length})
              </button>
              {kindsPresent.map((k) => (
                <button
                  type="button"
                  key={k}
                  className={kindFilter === k ? 'search-chip active' : 'search-chip'}
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                  data-testid={`calendar-chip-${k}`}
                >
                  {KIND_LABEL[k]} ({all.filter((i) => i.kind === k).length})
                </button>
              ))}
            </div>
          )}

          {buckets.map(([bucket, rows]) => (
            <div key={bucket}>
              <p className="eyebrow">{bucket} · {rows.length}</p>
              <ComparisonTable label={`${bucket} items`} testId={`calendar-bucket-${bucket.replace(/\s+/g, '-').toLowerCase()}`}>
                <tbody>
                  {rows.map((it) => (
                    <tr key={`${it.kind}-${it.id}-${it.date}`} data-testid={`calendar-item-${it.id}-${it.kind}`}>
                      {/* The date stays RAW ISO — formatDisplayDate is a NEGATIVE
                          contract; the relative line is the local relLabel. */}
                      <td className="mono">
                        <div>{it.date}</div>
                        <div className="record-row-meta">{relLabel(it.daysUntil)}</div>
                      </td>
                      <td>
                        <div>
                          {it.title} <StatusBadge variant={urgencyVariant(it.daysUntil)}>{KIND_LABEL[it.kind]}</StatusBadge>
                        </div>
                        {it.subtitle && <div className="collection-scope">{it.subtitle}</div>}
                      </td>
                      <td>
                        <Link className="mini-action" to={it.route} data-testid={`calendar-open-${it.id}`}>Open →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ComparisonTable>
            </div>
          ))}
        </>
      )}
    </CollectionFrame>
  );
}
