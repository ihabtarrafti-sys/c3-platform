import type { ReactNode } from 'react';
import { makeStyles, mergeClasses } from '@fluentui/react-components';

/**
 * FormPanel (Sprint 44) — the Command Desk form surface, replacing the bare
 * Card every create-form used. The taxonomy is design-as-truthfulness:
 * GOVERNED surfaces carry a Command-Black rail and a "Governed request" chip
 * (nothing happens until an owner executes); DIRECT surfaces carry an ink
 * rail and an "Immediate · recorded" chip. Same honest copy, elevated frame.
 */

const useStyles = makeStyles({
  panel: {
    position: 'relative',
    backgroundColor: 'var(--c3-identity-white)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    boxShadow: 'var(--c3-e1)',
    maxWidth: '460px',
    marginBottom: 'var(--c3-space-5)',
    overflow: 'hidden',
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px' },
  railGoverned: { backgroundColor: 'var(--c3-command-black)' },
  railDirect: { backgroundColor: 'var(--c3-ink-35)' },
  head: {
    display: 'flex',
    alignItems: 'center',
    columnGap: 'var(--c3-space-3)',
    padding: 'var(--c3-space-4) var(--c3-space-5) 0',
  },
  eyebrow: {
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--c3-command-black)',
  },
  chip: {
    marginLeft: 'auto',
    fontSize: '10px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: '999px',
    padding: '2px 8px',
    whiteSpace: 'nowrap',
  },
  intro: {
    fontSize: '13px',
    lineHeight: '20px',
    color: 'var(--c3-ink-70)',
    padding: 'var(--c3-space-2) var(--c3-space-5) 0',
    margin: 0,
  },
  fields: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: 'var(--c3-space-3)',
    padding: 'var(--c3-space-4) var(--c3-space-5)',
  },
  footer: {
    borderTop: '1px solid var(--c3-hairline)',
    padding: 'var(--c3-space-3) var(--c3-space-5)',
    display: 'flex',
    justifyContent: 'flex-end',
    columnGap: 'var(--c3-space-2)',
    backgroundColor: 'var(--c3-paper-white)',
  },
});

export function FormPanel({
  eyebrow,
  mode,
  intro,
  children,
  footer,
}: {
  /** Uppercase taxonomy line, e.g. "New agreement" or "Add person". */
  eyebrow: string;
  /** governed = approval-gated; direct = immediate-but-audited. */
  mode: 'governed' | 'direct';
  /** The honest-copy line (kept verbatim from the certified surfaces). */
  intro: ReactNode;
  children: ReactNode;
  /** The submit control(s) — typically the existing GovernedAction trigger. */
  footer: ReactNode;
}) {
  const s = useStyles();
  return (
    <section className={s.panel} aria-label={eyebrow}>
      <div className={mergeClasses(s.rail, mode === 'governed' ? s.railGoverned : s.railDirect)} aria-hidden="true" />
      <div className={s.head}>
        <span className={s.eyebrow}>{eyebrow}</span>
        <span className={s.chip}>{mode === 'governed' ? 'Governed request' : 'Immediate · recorded'}</span>
      </div>
      <p className={s.intro}>{intro}</p>
      <div className={s.fields}>{children}</div>
      <div className={s.footer}>{footer}</div>
    </section>
  );
}
