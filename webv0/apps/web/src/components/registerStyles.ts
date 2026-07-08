import { makeStyles } from '@fluentui/react-components';

/**
 * The C3 register look (B.6) — a governed list, not a spreadsheet grid.
 * Comfortable rows separated by hairlines, uppercase eyebrow headers, mono IDs,
 * a subtle hover, and a truthful footer count. Real <table> semantics.
 */
export const useRegisterStyles = makeStyles({
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: {
    textAlign: 'left',
    padding: '0 16px 10px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    borderBottom: '1px solid var(--c3-hairline)',
    whiteSpace: 'nowrap',
  },
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
