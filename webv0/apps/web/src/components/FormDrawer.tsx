import type { ReactNode } from 'react';
import { Button, OverlayDrawer, makeStyles, mergeClasses } from '@fluentui/react-components';

/**
 * FormDrawer (B.13, Sprint 45) — governed data entry in a right-side Drawer,
 * replacing the S44 inline FormPanel. Same design-as-truthfulness taxonomy:
 * GOVERNED surfaces carry a Command-Black front rail and a "Governed request"
 * chip; DIRECT surfaces carry an ink rail and "Immediate · recorded". The
 * slide-in runs on the A.8 clock (240ms via the theme's durationGentle).
 *
 * Layout note: we render our OWN header/body/footer frame inside OverlayDrawer
 * rather than DrawerHeader/DrawerBody — the stock wrappers impose their own
 * grid and padding that fight the Command Desk anatomy.
 *
 * Dirty-guard (B.13 "never silently discard entered data"): field state lives
 * in the CALLER, not here — Esc/backdrop/close hide the drawer but reopening
 * restores exactly what was typed. Nothing is discarded until submit clears it.
 * Focus is trapped while open and returns to the invoking control on close
 * (Fluent modal behavior). Below 640px the drawer becomes a full-screen sheet.
 */

const useStyles = makeStyles({
  drawer: {
    width: '480px',
    maxWidth: '100vw',
    '@media (max-width: 639px)': { width: '100vw' },
  },
  frame: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--c3-surface-base)',
  },
  // E (S47): the drawer is MATTE by law; the rail is a quiet marker, not a
  // highlight — muted for governed, faint for direct, in both modes.
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', zIndex: 1 },
  railGoverned: { backgroundColor: 'var(--c3-ink-quiet)' },
  railDirect: { backgroundColor: 'var(--c3-ink-quiet)' },
  header: {
    display: 'flex',
    alignItems: 'center',
    columnGap: 'var(--c3-space-3)',
    padding: 'var(--c3-space-4) var(--c3-space-4) var(--c3-space-4) var(--c3-space-6)',
    borderBottom: '1px solid var(--c3-border-subtle)',
    flexShrink: 0,
  },
  eyebrow: {
    fontSize: '11px',
    lineHeight: '16px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: 'var(--c3-ink-strong)',
    whiteSpace: 'nowrap',
  },
  chip: {
    marginLeft: 'auto',
    fontSize: '10px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-quiet)',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: '999px',
    padding: '2px 8px',
    whiteSpace: 'nowrap',
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 'var(--c3-space-4) var(--c3-space-6)',
  },
  intro: {
    fontSize: '13px',
    lineHeight: '20px',
    color: 'var(--c3-ink-muted)',
    margin: '0 0 var(--c3-space-4)',
  },
  fields: { display: 'flex', flexDirection: 'column', rowGap: 'var(--c3-space-3)' },
  footer: {
    flexShrink: 0,
    borderTop: '1px solid var(--c3-border-subtle)',
    padding: 'var(--c3-space-3) var(--c3-space-6)',
    display: 'flex',
    justifyContent: 'flex-end',
    columnGap: 'var(--c3-space-2)',
    backgroundColor: 'var(--c3-ground-canvas)',
  },
});

export function FormDrawer({
  open,
  onClose,
  eyebrow,
  mode,
  intro,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
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
    <OverlayDrawer
      position="end"
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
      className={s.drawer}
      aria-label={eyebrow}
    >
      <div className={s.frame}>
        <div className={mergeClasses(s.rail, mode === 'governed' ? s.railGoverned : s.railDirect)} aria-hidden="true" />
        <div className={s.header}>
          <span className={s.eyebrow}>{eyebrow}</span>
          <span className={s.chip}>{mode === 'governed' ? 'Governed request' : 'Immediate · recorded'}</span>
          <Button appearance="subtle" size="small" aria-label="Close panel" data-testid="form-drawer-close" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className={s.body}>
          <p className={s.intro}>{intro}</p>
          <div className={s.fields}>{children}</div>
        </div>
        <div className={s.footer}>{footer}</div>
      </div>
    </OverlayDrawer>
  );
}
