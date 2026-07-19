import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { makeStyles, mergeClasses } from '@fluentui/react-components';
import type { CalendarItemDto } from '@c3web/api-contracts';
import { useCalendar } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';
import { useRegisterStyles } from '../components/registerStyles';

/**
 * Ops calendar / timeline (Track B) — the forward horizon. The twin of the
 * activity feed (backward) and the Situation Room (now): every dated obligation
 * already in C3 — credential expiries, agreement ends, mission dates, approver
 * delegations — laid out soonest-first, with overdue-but-still-open items at
 * the top where they belong. Read-only aggregation; owner/operations.
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

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-muted)', maxWidth: '660px', marginBottom: '16px' },
  controls: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px', alignItems: 'center' },
  controlLabel: { fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c3-ink-quiet)', fontFamily: 'var(--c3-font-mono)', marginRight: '4px' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' },
  chip: {
    fontFamily: 'var(--c3-font-mono)', fontSize: '11px', letterSpacing: '0.06em', color: 'var(--c3-ink-muted)',
    backgroundColor: 'transparent', border: '1px solid var(--c3-border-subtle)', borderRadius: '999px', padding: '3px 11px',
    cursor: 'pointer', ':hover': { backgroundColor: 'var(--c3-hover)' },
  },
  chipActive: { color: 'var(--c3-ink-default)', borderTopColor: 'var(--c3-action-primary)', borderRightColor: 'var(--c3-action-primary)', borderBottomColor: 'var(--c3-action-primary)', borderLeftColor: 'var(--c3-action-primary)', backgroundColor: 'var(--c3-hover)' },
  bucket: { marginTop: '20px' },
  bucketTitle: { fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c3-ink-quiet)', fontFamily: 'var(--c3-font-mono)', marginBottom: '8px' },
  when: { display: 'flex', flexDirection: 'column', rowGap: '2px', minWidth: '110px' },
  date: { fontSize: '13px', color: 'var(--c3-ink-default)' },
  rel: { fontSize: '11.5px', color: 'var(--c3-ink-quiet)', fontFamily: 'var(--c3-font-mono)' },
  title: { fontSize: '13.5px', color: 'var(--c3-ink-default)' },
  sub: { fontSize: '12px', color: 'var(--c3-ink-quiet)' },
  open: { fontSize: '12.5px', color: 'var(--c3-action-primary)' },
});

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
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const canView = me?.capabilities.canViewSituation ?? false;
  const [horizon, setHorizon] = useState(90);
  const [kindFilter, setKindFilter] = useState<CalendarItemDto['kind'] | null>(null);
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
      <div>
        <PageHeader title="Calendar" />
        <EmptyState data-testid="calendar-denied" message="The calendar is available to owners and operations." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader kicker="What's coming" title="Calendar" />
      <p className={s.intro}>
        Every dated obligation in C3 on one timeline — credential expiries, agreement ends, mission dates, delegation
        windows — soonest first, with anything overdue-but-still-open at the top. A planning view; act on each from its
        own record.
      </p>

      <div className={s.controls}>
        <span className={s.controlLabel}>Horizon</span>
        {HORIZONS.map((h) => (
          <button type="button" key={h} className={mergeClasses(s.chip, horizon === h && s.chipActive)} onClick={() => setHorizon(h)} data-testid={`calendar-horizon-${h}`}>
            {h}d
          </button>
        ))}
      </div>

      {isLoading && <LoadingState label="Gathering the horizon…" />}
      {isError && <ErrorState message={error instanceof ApiError ? error.message : 'Could not load the calendar.'} />}

      {data && all.length === 0 && (
        <EmptyState data-testid="calendar-empty" message={`Nothing dated in the next ${horizon} days — the horizon is clear.`} />
      )}

      {data && all.length > 0 && (
        <>
          {kindsPresent.length > 1 && (
            <div className={s.chips} data-testid="calendar-chips">
              <button type="button" className={mergeClasses(s.chip, kindFilter === null && s.chipActive)} onClick={() => setKindFilter(null)}>
                All ({all.length})
              </button>
              {kindsPresent.map((k) => (
                <button type="button" key={k} className={mergeClasses(s.chip, kindFilter === k && s.chipActive)} onClick={() => setKindFilter(kindFilter === k ? null : k)} data-testid={`calendar-chip-${k}`}>
                  {KIND_LABEL[k]} ({all.filter((i) => i.kind === k).length})
                </button>
              ))}
            </div>
          )}

          {buckets.map(([bucket, rows]) => (
            <div className={s.bucket} key={bucket}>
              <div className={s.bucketTitle}>{bucket} · {rows.length}</div>
              <table className={r.table} data-testid={`calendar-bucket-${bucket.replace(/\s+/g, '-').toLowerCase()}`} aria-label={`${bucket} items`}>
                <tbody>
                  {rows.map((it) => (
                    <tr key={`${it.kind}-${it.id}-${it.date}`} className={r.row} data-testid={`calendar-item-${it.id}-${it.kind}`}>
                      <td className={r.td}>
                        <div className={s.when}>
                          <span className={s.date}>{it.date}</span>
                          <span className={s.rel}>{relLabel(it.daysUntil)}</span>
                        </div>
                      </td>
                      <td className={r.td}>
                        <div className={s.title}>
                          {it.title} <StatusBadge variant={urgencyVariant(it.daysUntil)}>{KIND_LABEL[it.kind]}</StatusBadge>
                        </div>
                        {it.subtitle && <div className={s.sub}>{it.subtitle}</div>}
                      </td>
                      <td className={r.td}>
                        <Link className={s.open} to={it.route} data-testid={`calendar-open-${it.id}`}>Open →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
