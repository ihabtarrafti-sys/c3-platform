import type { ReactNode } from 'react';
import { makeStyles } from '@fluentui/react-components';

/**
 * DefinitionList (B.7) — a record's fields as label→value pairs. Two columns on
 * desktop, single column < 640px. Empty values render an explicit "—" (labelled
 * "not set"), never a blank; IDs use Mono. Enum values are mapped to human
 * labels by the caller.
 */
export interface DefItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** data-testid applied to the value cell. */
  testId?: string;
}

const useStyles = makeStyles({
  dl: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: '32px',
    rowGap: '12px',
    margin: 0,
    maxWidth: '640px',
    '@media (max-width: 640px)': { gridTemplateColumns: '1fr', rowGap: '4px' },
  },
  pair: { display: 'contents' },
  dt: { margin: 0, fontSize: '12.5px', fontWeight: 600, color: 'var(--c3-ink-50)' },
  dd: { margin: 0, fontSize: '14px', color: 'var(--c3-command-black)' },
  mono: { fontFamily: 'var(--c3-font-mono)', fontSize: '13px' },
  unset: { color: 'var(--c3-ink-35)' },
});

function isEmpty(v: ReactNode): boolean {
  return v == null || v === '' || v === '-';
}

export function DefinitionList({ items }: { items: DefItem[] }) {
  const s = useStyles();
  return (
    <dl className={s.dl}>
      {items.map((it, i) => (
        <div className={s.pair} key={i}>
          <dt className={s.dt}>{it.label}</dt>
          <dd className={it.mono ? `${s.dd} ${s.mono}` : s.dd} data-testid={it.testId}>
            {isEmpty(it.value) ? (
              <span className={s.unset} aria-label="not set">
                —
              </span>
            ) : (
              it.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
