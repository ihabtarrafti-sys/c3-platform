import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input, makeStyles } from '@fluentui/react-components';
import { api } from '../apiClient';

/**
 * GlobalSearch (S3) — the shell's one box: any id or name, across only what
 * the actor's role may see (the server enforces it; a visitor's results
 * simply never contain agreements). Ctrl+K focuses; Escape dismisses; Enter
 * opens the top hit. Identity fields only — money never appears here.
 */

const KIND_LABEL: Record<string, string> = {
  person: 'People',
  mission: 'Missions',
  agreement: 'Agreements',
  entity: 'Entities',
  credential: 'Credentials',
  journey: 'Journeys',
  kit: 'Kit',
  apparel: 'Apparel',
  approval: 'Approvals',
};

/** Where each hit navigates. Kinds without a detail page land on their register. */
function routeFor(kind: string, id: string): string {
  switch (kind) {
    case 'person':
      return `/people/${id}`;
    case 'mission':
      return `/missions/${id}`;
    case 'agreement':
      return `/agreements/${id}`;
    case 'approval':
      return `/approvals/${id}`;
    case 'entity':
      return '/entities';
    case 'credential':
      return '/credentials';
    case 'journey':
      return '/journeys';
    case 'kit':
      return '/kit';
    case 'apparel':
      return '/apparel';
    default:
      return '/people';
  }
}

const useStyles = makeStyles({
  root: { position: 'relative', width: '260px', '@media (max-width: 899px)': { display: 'none' } },
  input: { width: '100%' },
  panel: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    maxHeight: '420px',
    overflowY: 'auto',
    backgroundColor: 'var(--c3-panel)',
    border: '1px solid var(--c3-line)',
    borderRadius: 'var(--c3-radius)',
    boxShadow: 'var(--c3-e2)',
    zIndex: 40,
    padding: '6px',
  },
  group: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-muted)',
    padding: '8px 10px 4px',
  },
  hit: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '1px',
    padding: '7px 10px',
    borderRadius: '8px',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'var(--c3-hover)' },
  },
  hitTitle: { fontSize: '13.5px', color: 'var(--c3-ink)', display: 'flex', alignItems: 'baseline', columnGap: '8px' },
  hitId: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-muted)' },
  hitSub: { fontSize: '12px', color: 'var(--c3-ink-muted)' },
  empty: { padding: '12px 10px', fontSize: '13px', color: 'var(--c3-ink-muted)' },
});

export function GlobalSearch() {
  const s = useStyles();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const deferredQ = useDeferredValue(q.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const enabled = deferredQ.length >= 2;
  const { data, isFetching } = useQuery({
    queryKey: ['search', deferredQ],
    queryFn: () => api.search(deferredQ),
    enabled,
    staleTime: 15_000,
  });
  const results = enabled ? (data?.results ?? []) : [];

  // Ctrl/Cmd+K focuses the box from anywhere in the shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-away dismisses.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  function go(kind: string, id: string) {
    setOpen(false);
    setQ('');
    navigate(routeFor(kind, id));
  }

  // Stable group order regardless of arrival order.
  const kindsInOrder = Object.keys(KIND_LABEL).filter((k) => results.some((r) => r.kind === k));

  return (
    <div className={s.root} ref={rootRef}>
      <Input
        className={s.input}
        ref={inputRef}
        value={q}
        placeholder="Search anything…  Ctrl+K"
        onChange={(_, d) => {
          setQ(d.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Enter' && results.length > 0) {
            const top = results[0]!;
            go(top.kind, top.id);
          }
        }}
        data-testid="global-search"
        aria-label="Search anything"
      />
      {open && q.trim().length >= 2 && (
        <div className={s.panel} data-testid="search-results" role="listbox" aria-label="Search results">
          {results.length === 0 && <div className={s.empty}>{isFetching ? 'Searching…' : 'No matches you can see.'}</div>}
          {kindsInOrder.map((kind) => (
            <div key={kind}>
              <div className={s.group}>{KIND_LABEL[kind]}</div>
              {results
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <div key={`${r.kind}-${r.id}`} className={s.hit} data-testid={`search-hit-${r.id}`} role="option" aria-selected="false" onClick={() => go(r.kind, r.id)}>
                    <span className={s.hitTitle}>
                      {r.title}
                      <span className={s.hitId}>{r.id}</span>
                    </span>
                    {r.subtitle && <span className={s.hitSub}>{r.subtitle}</span>}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
