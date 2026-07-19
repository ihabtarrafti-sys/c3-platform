import type { HTMLAttributes, ReactNode } from 'react';
import { makeStyles } from '@fluentui/react-components';

/**
 * Truthful data-surface states (A.12, B.10–B.12). These are deliberately
 * distinct: empty !== unavailable !== denied !== error. Zero is only shown
 * when zero is the truth; failures always carry a correlation reference.
 */
const useStyles = makeStyles({
  empty: {
    padding: '48px 16px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: '12px',
  },
  emptyText: { fontSize: '14px', color: 'var(--c3-ink-muted)' },
  loading: { padding: '24px 0', fontSize: '13px', color: 'var(--c3-ink-quiet)' },
  error: {
    padding: '16px',
    border: '1px solid var(--c3-border-subtle)',
    borderLeft: '3px solid var(--c3-state-danger)',
    borderRadius: 'var(--c3-radius)',
    backgroundColor: 'var(--c3-surface-base)',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '6px',
  },
  errorMsg: { fontSize: '14px', color: 'var(--c3-ink-strong)' },
  ref: { fontFamily: 'var(--c3-font-mono)', fontSize: '12.5px', color: 'var(--c3-ink-quiet)' },
});

export function EmptyState({
  message,
  action,
  ...rest
}: { message: string; action?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const s = useStyles();
  return (
    <div className={s.empty} {...rest}>
      <div className={s.emptyText}>{message}</div>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const s = useStyles();
  return (
    <div className={s.loading} role="status" aria-live="polite" aria-busy="true">
      {label}
    </div>
  );
}

export function ErrorState({
  message,
  correlationId,
  ...rest
}: { message: string; correlationId?: string } & HTMLAttributes<HTMLDivElement>) {
  const s = useStyles();
  return (
    <div className={s.error} role="alert" {...rest}>
      <div className={s.errorMsg}>{message}</div>
      {correlationId && <div className={s.ref}>Reference: {correlationId}</div>}
    </div>
  );
}
