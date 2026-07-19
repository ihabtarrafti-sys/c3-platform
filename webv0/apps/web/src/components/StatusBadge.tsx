import type { HTMLAttributes, ReactNode } from 'react';
import { makeStyles } from '@fluentui/react-components';

/**
 * StatusBadge (B.8) — dot (shape) + label; semantic colour from A.5. Colour is
 * NEVER the sole signal: the label is always present. Static, never a button.
 * Approval statuses/outcomes are mapped to human labels by the caller (D.4).
 */
export type StatusVariant = 'ready' | 'pending' | 'blocked' | 'neutral' | 'info' | 'signal';

const COLOR: Record<StatusVariant, string> = {
  ready: 'var(--c3-state-success)',
  pending: 'var(--c3-state-warning)',
  blocked: 'var(--c3-state-danger)',
  neutral: 'var(--c3-ink-quiet)',
  info: 'var(--c3-state-info)',
  // S46 (approved relaxation #4): Signal Red as TEXT for the one state that
  // demands the eye — agreement "Expired". Never on governed flows.
  signal: 'var(--c3-state-danger)',
};

const useStyles = makeStyles({
  badge: { display: 'inline-flex', alignItems: 'center', columnGap: '6px', fontSize: '12.5px', fontWeight: 500, whiteSpace: 'nowrap' },
  dot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
});

export function StatusBadge({
  variant,
  children,
  ...rest
}: { variant: StatusVariant; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  const s = useStyles();
  const color = COLOR[variant];
  return (
    <span className={s.badge} style={{ color }} {...rest}>
      <span className={s.dot} style={{ backgroundColor: color }} aria-hidden="true" />
      {children}
    </span>
  );
}
