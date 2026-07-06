import { Link } from 'react-router-dom';
import { makeStyles } from '@fluentui/react-components';

/**
 * Breadcrumbs (B.3) — 2-level hierarchy (register → record). The current leaf is
 * not a link; separators are decorative.
 */
export interface Crumb {
  label: string;
  to?: string;
}

const useStyles = makeStyles({
  nav: { marginBottom: '10px' },
  list: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: '6px',
    rowGap: '2px',
    listStyle: 'none',
    margin: 0,
    padding: 0,
    fontSize: '12.5px',
  },
  item: { display: 'flex', alignItems: 'center', columnGap: '6px' },
  link: { color: 'var(--c3-ink-50)', textDecoration: 'none', ':hover': { textDecoration: 'underline' } },
  current: { color: 'var(--c3-ink-70)' },
  sep: { color: 'var(--c3-ink-35)' },
});

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const s = useStyles();
  return (
    <nav aria-label="Breadcrumb" className={s.nav}>
      <ol className={s.list}>
        {crumbs.map((c, i) => (
          <li key={i} className={s.item}>
            {i > 0 && (
              <span className={s.sep} aria-hidden="true">
                /
              </span>
            )}
            {c.to ? (
              <Link className={s.link} to={c.to}>
                {c.label}
              </Link>
            ) : (
              <span className={s.current} aria-current="page">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
