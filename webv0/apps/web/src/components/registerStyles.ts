import { makeStyles } from '@fluentui/react-components';

/**
 * The C3 register look (B.6) — a governed list, not a spreadsheet grid.
 * Comfortable rows separated by hairlines, uppercase eyebrow headers, mono IDs,
 * a subtle hover, and a truthful footer count. Real <table> semantics.
 */
export const useRegisterStyles = makeStyles({
  // S46 approved relaxation #2/#3 — the instrument voice + command density:
  // mono headers on the 0.14em register, tabular numerals throughout, the
  // table itself allowed to breathe across the full work area.
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' },
  th: {
    textAlign: 'left',
    padding: '0 16px 10px',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    borderBottom: '1px solid var(--c3-hairline)',
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
    ':hover': { backgroundColor: 'rgba(13,13,13,0.02)' },
  },
  idLink: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--c3-command-black)',
    textDecoration: 'none',
    ':hover': { textDecoration: 'underline' },
  },
  name: { color: 'var(--c3-command-black)' },
  count: { marginTop: '12px', fontSize: '12.5px', color: 'var(--c3-ink-50)' },
});
