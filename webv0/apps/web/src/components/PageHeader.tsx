import { useEffect, type ReactNode } from 'react';
import { makeStyles } from '@fluentui/react-components';

/**
 * PageHeader (B.2) — names the surface (single H1, the route-change
 * announcement target) and hosts its ActionBar (the action-authority zone,
 * right-aligned). Sets the window title `C3 — <Surface>` (D.1).
 */
const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    columnGap: '16px',
    rowGap: '8px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  titleWrap: { flexGrow: 1, minWidth: 0 },
  h1: { margin: 0, fontSize: '28px', lineHeight: '34px', fontWeight: 600, color: 'var(--c3-command-black)' },
  context: { marginTop: '4px', fontSize: '12.5px', color: 'var(--c3-ink-50)' },
  actions: { display: 'flex', alignItems: 'center', columnGap: '8px', flexShrink: 0 },
});

export function PageHeader({
  title,
  context,
  actions,
  titleTestId,
  breadcrumbs,
}: {
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  titleTestId?: string;
  breadcrumbs?: ReactNode;
}) {
  const s = useStyles();
  useEffect(() => {
    document.title = `C3 — ${title}`;
  }, [title]);
  return (
    <div className={s.header}>
      <div className={s.titleWrap}>
        {breadcrumbs}
        <h1 className={s.h1} data-testid={titleTestId}>
          {title}
        </h1>
        {context != null && <div className={s.context}>{context}</div>}
      </div>
      {actions && (
        <div className={s.actions} role="group" aria-label="Actions">
          {actions}
        </div>
      )}
    </div>
  );
}
