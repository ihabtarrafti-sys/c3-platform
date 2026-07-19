import { makeStyles } from '@fluentui/react-components';

/**
 * The C3 register look (B.6) — a governed list, not a spreadsheet grid.
 * Comfortable rows separated by hairlines, uppercase eyebrow headers, mono IDs,
 * a subtle hover, and a truthful footer count. Real <table> semantics.
 */
export const useRegisterStyles = makeStyles({
  // S46 instrument voice + S47 Direction E: the register is a T0 MATTE DATA
  // panel — fully opaque so numbers never fight a background. Soft E radius,
  // mono headers, tabular numerals.
  table: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: '14px',
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: 'var(--c3-surface-base)',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: 'var(--c3-radius-data)',
    boxShadow: 'var(--c3-e1)',
    overflow: 'hidden',
    // QA sweep: on narrow viewports a wide register must scroll INSIDE its
    // own container — never expand the page body past the viewport (the page
    // must not scroll horizontally; the room bar only spans the viewport).
    '@media (max-width: 640px)': { display: 'block', overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  },
  th: {
    textAlign: 'left',
    padding: '14px 16px 10px',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-quiet)',
    borderBottom: '1px solid var(--c3-border-subtle)',
    whiteSpace: 'nowrap',
  },
  /** Mono value cells — dates, windows, money (the instrument register). */
  mono: { fontFamily: 'var(--c3-font-mono)', fontSize: '13px' },
  td: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--c3-border-subtle)',
    color: 'var(--c3-ink-muted)',
    verticalAlign: 'middle',
  },
  row: {
    transitionProperty: 'background-color',
    transitionDuration: 'var(--c3-dur-state)',
    transitionTimingFunction: 'var(--c3-ease)',
    ':hover': { backgroundColor: 'var(--c3-hover)' },
  },
  idLink: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--c3-accent-blue)',
    textDecoration: 'none',
    ':hover': { textDecoration: 'underline' },
  },
  /** A link on a human NAME (not a code) — sans, per the type law:
   *  mono is reserved for codes, dates, and amounts (owner ruling #4). */
  nameLink: {
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--c3-accent-blue)',
    textDecoration: 'none',
    ':hover': { textDecoration: 'underline' },
  },
  name: { color: 'var(--c3-ink-strong)' },
  count: { marginTop: '12px', fontSize: '12.5px', color: 'var(--c3-ink-quiet)' },
});
