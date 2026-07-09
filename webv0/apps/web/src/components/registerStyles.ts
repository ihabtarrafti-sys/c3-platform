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
    backgroundColor: 'var(--c3-surface-data)',
    border: '1px solid var(--c3-line)',
    borderRadius: 'var(--c3-radius-data)',
    boxShadow: 'var(--c3-e1)',
    overflow: 'hidden',
  },
  th: {
    textAlign: 'left',
    padding: '14px 16px 10px',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-muted)',
    borderBottom: '1px solid var(--c3-line)',
    whiteSpace: 'nowrap',
  },
  /** Mono value cells — dates, windows, money (the instrument register). */
  mono: { fontFamily: 'var(--c3-font-mono)', fontSize: '13px' },
  td: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--c3-hairline)',
    color: 'var(--c3-ink-70)',
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
    color: 'var(--c3-brand-ink)',
    textDecoration: 'none',
    ':hover': { textDecoration: 'underline' },
  },
  name: { color: 'var(--c3-command-black)' },
  count: { marginTop: '12px', fontSize: '12.5px', color: 'var(--c3-ink-50)' },
});
