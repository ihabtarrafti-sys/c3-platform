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
    alignItems: 'flex-end',
    columnGap: '16px',
    rowGap: '8px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  titleWrap: { flexGrow: 1, minWidth: 0 },
  // S46 approved relaxation #1 — the display voice. Default 40px; registers
  // and the cockpit use the command scale (52px + mono kicker).
  kicker: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    lineHeight: '16px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: 'var(--c3-ink-50)',
    marginBottom: '6px',
  },
  h1: { margin: 0, fontSize: '40px', lineHeight: '46px', letterSpacing: '-0.02em', fontWeight: 600, color: 'var(--c3-command-black)' },
  h1Command: { fontSize: '52px', lineHeight: '56px', letterSpacing: '-0.03em' },
  context: { marginTop: '6px', fontSize: '12.5px', color: 'var(--c3-ink-50)' },
  actions: { display: 'flex', alignItems: 'center', columnGap: '8px', flexShrink: 0, paddingBottom: '6px' },
});

export function PageHeader({
  title,
  context,
  actions,
  titleTestId,
  breadcrumbs,
  kicker,
}: {
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  titleTestId?: string;
  breadcrumbs?: ReactNode;
  /** Mono eyebrow above the title; its presence selects the command scale (52px). */
  kicker?: string;
}) {
  const s = useStyles();
  useEffect(() => {
    document.title = `C3 — ${title}`;
  }, [title]);
  return (
    <div className={s.header}>
      <div className={s.titleWrap}>
        {breadcrumbs}
        {kicker && <div className={s.kicker}>{kicker}</div>}
        <h1 className={kicker ? `${s.h1} ${s.h1Command}` : s.h1} data-testid={titleTestId}>
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
