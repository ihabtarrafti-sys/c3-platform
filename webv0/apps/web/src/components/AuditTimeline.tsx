import { makeStyles } from '@fluentui/react-components';
import { EmptyState } from './states';

/**
 * AuditTimeline (B.17) — truthful, append-only, record-scoped history. Reverse-
 * chronological entries: mono timestamp, human action label, actor, optional
 * detail (rejection reason, execution error, status transition). Never editable,
 * never a raw enum, never omits failures.
 */
export interface TimelineEntry {
  at: string;
  label: string;
  actor: string;
  detail?: string | null;
}

const useStyles = makeStyles({
  list: { listStyle: 'none', margin: 0, padding: 0 },
  entry: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: '16px',
    padding: '12px 0',
    borderBottom: '1px solid var(--c3-hairline)',
    '@media (max-width: 640px)': { gridTemplateColumns: '1fr', rowGap: '2px' },
  },
  ts: { fontFamily: 'var(--c3-font-mono)', fontSize: '12.5px', color: 'var(--c3-ink-50)', whiteSpace: 'nowrap' },
  action: { fontSize: '14px', fontWeight: 500, color: 'var(--c3-command-black)' },
  actor: { fontSize: '12.5px', color: 'var(--c3-ink-50)', marginTop: '2px' },
  detail: { fontSize: '13px', color: 'var(--c3-ink-70)', marginTop: '4px' },
});

export function AuditTimeline({
  entries,
  emptyMessage = 'No events recorded.',
  testId,
}: {
  entries: TimelineEntry[];
  emptyMessage?: string;
  testId?: string;
}) {
  const s = useStyles();
  if (entries.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <ol className={s.list} data-testid={testId}>
      {entries.map((e, i) => (
        <li className={s.entry} key={i}>
          <span className={s.ts}>{new Date(e.at).toLocaleString()}</span>
          <div>
            <div className={s.action}>{e.label}</div>
            <div className={s.actor}>{e.actor}</div>
            {e.detail && <div className={s.detail}>{e.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
