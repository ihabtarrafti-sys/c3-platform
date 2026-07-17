import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input, makeStyles, mergeClasses } from '@fluentui/react-components';
import { api } from '../apiClient';

/**
 * GlobalSearch (S3 → S3.1) — the shell's one box: any id, name, number,
 * filename, or bank reference, across only what the actor's role may see
 * (the server enforces it; a visitor's results simply never contain
 * agreements or finance records). Ctrl+K focuses; Escape dismisses; Enter
 * opens the top hit. Identity fields only — money never appears here.
 *
 * S3.1 additions: debounced, CANCELLED-on-supersede requests (M-04);
 * type-filter chips; and the command-palette layer — matching "Go to …"
 * actions ride the same surface (find AND do).
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
  team: 'Teams',
  invoice: 'Invoices',
  claim: 'Claims',
  distribution: 'Distributions',
  document: 'Documents',
  term: 'Agreement terms',
  line: 'P&L lines',
  beneficiary: 'Beneficiaries',
};

/**
 * Where each hit navigates. Child records route through their OWNING record
 * (parentId): a term opens its agreement, a line/distribution its mission, a
 * beneficiary its person, a document whatever owns it. Kinds without a detail
 * page land on their register.
 */
function routeFor(kind: string, id: string, parentId: string | null): string {
  switch (kind) {
    case 'person':
      return `/people/${id}`;
    case 'mission':
      return `/missions/${id}`;
    case 'agreement':
      return `/agreements/${id}`;
    case 'approval':
      return `/approvals/${id}`;
    case 'team':
      return `/teams/${id}`;
    case 'claim':
      return `/claims/${id}`;
    case 'invoice':
      return '/invoices';
    case 'distribution':
    case 'line':
      return parentId ? `/missions/${parentId}` : '/missions';
    case 'term':
      return parentId ? `/agreements/${parentId}` : '/agreements';
    case 'beneficiary':
      return parentId ? `/people/${parentId}` : '/people';
    case 'document': {
      const [ownerType, ownerId] = (parentId ?? '').split(':');
      switch (ownerType) {
        case 'Agreement':
          return `/agreements/${ownerId}`;
        case 'Mission':
          return `/missions/${ownerId}`;
        case 'Person':
          return `/people/${ownerId}`;
        case 'Claim':
          return `/claims/${ownerId}`;
        case 'Invoice':
          return '/invoices';
        case 'Credential':
          return '/credentials';
        case 'Entity':
          return '/entities';
        default:
          return '/people';
      }
    }
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

/** S3.1 command palette: navigation ACTIONS matched on the same surface. */
const NAV_ACTIONS: ReadonlyArray<{ label: string; route: string }> = [
  { label: 'Go to Home', route: '/situation' },
  { label: 'Go to People', route: '/people' },
  { label: 'Go to Credentials', route: '/credentials' },
  { label: 'Go to Journeys', route: '/journeys' },
  { label: 'Go to Kit', route: '/kit' },
  { label: 'Go to Apparel', route: '/apparel' },
  { label: 'Go to Missions', route: '/missions' },
  { label: 'Go to Mission Finance', route: '/missions/finance' },
  { label: 'Go to Invoices', route: '/invoices' },
  { label: 'Go to Teams', route: '/teams' },
  { label: 'Go to Claims', route: '/claims' },
  { label: 'Go to Agreements', route: '/agreements' },
  { label: 'Go to Entities', route: '/entities' },
  { label: 'Go to Approvals', route: '/approvals' },
  { label: 'Go to Members', route: '/members' },
  { label: 'Go to Settings', route: '/settings' },
];

const useStyles = makeStyles({
  root: { position: 'relative', width: '260px', '@media (max-width: 899px)': { display: 'none' } },
  input: { width: '100%' },
  // Screen 05 (re-skin): the results panel is an EPHEMERAL floating surface —
  // the one place Blue Hour glass legitimately lives. (This also fixes the
  // undefined --c3-panel background it silently rode before.) The reduced-
  // effects contract collapses the brand glass tokens to opaque automatically.
  panel: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    maxHeight: '420px',
    overflowY: 'auto',
    backgroundColor: 'var(--c3-glass-fill-strong)',
    backdropFilter: 'blur(var(--c3-glass-blur)) saturate(var(--c3-glass-saturate))',
    border: '1px solid var(--c3-glass-edge)',
    borderRadius: 'var(--c3-radius-lg)',
    boxShadow: 'var(--c3-glass-shadow)',
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
  chips: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 8px 2px' },
  chip: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.06em',
    color: 'var(--c3-ink-mid)',
    backgroundColor: 'transparent',
    border: '1px solid var(--c3-hairline)',
    borderRadius: '999px',
    padding: '2px 9px',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'var(--c3-hover)' },
  },
  chipActive: {
    color: 'var(--c3-ink)',
    borderTopColor: 'var(--c3-brand)',
    borderRightColor: 'var(--c3-brand)',
    borderBottomColor: 'var(--c3-brand)',
    borderLeftColor: 'var(--c3-brand)',
    backgroundColor: 'var(--c3-hover)',
  },
});

export function GlobalSearch() {
  const s = useStyles();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // M-04: debounce keystrokes (one request per pause, not per key)…
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debouncedQ.length >= 2;
  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQ],
    // …and CANCEL a superseded request (react-query aborts the signal when
    // the key changes).
    queryFn: ({ signal }) => api.search(debouncedQ, signal),
    enabled,
    staleTime: 15_000,
  });
  const allResults = enabled ? (data?.results ?? []) : [];
  const results = kindFilter ? allResults.filter((r) => r.kind === kindFilter) : allResults;

  // S3.1 palette: matching navigation actions ride the same dropdown.
  const actions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return NAV_ACTIONS.filter((a) => a.label.toLowerCase().includes(needle)).slice(0, 5);
  }, [q]);

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

  function go(kind: string, id: string, parentId: string | null) {
    setOpen(false);
    setQ('');
    setKindFilter(null);
    navigate(routeFor(kind, id, parentId));
  }

  function goRoute(route: string) {
    setOpen(false);
    setQ('');
    setKindFilter(null);
    navigate(route);
  }

  // Stable group order regardless of arrival order.
  const kindsInOrder = Object.keys(KIND_LABEL).filter((k) => results.some((r) => r.kind === k));
  const chipKinds = Object.keys(KIND_LABEL).filter((k) => allResults.some((r) => r.kind === k));

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
          if (e.key === 'Enter' && (results.length > 0 || actions.length > 0)) {
            if (results.length > 0) {
              const top = results[0]!;
              go(top.kind, top.id, top.parentId);
            } else {
              goRoute(actions[0]!.route);
            }
          }
        }}
        data-testid="global-search"
        aria-label="Search anything"
      />
      {open && q.trim().length >= 2 && (
        <div className={s.panel} data-testid="search-results" role="listbox" aria-label="Search results">
          {chipKinds.length > 1 && (
            <div className={s.chips} data-testid="search-chips">
              <button type="button" className={mergeClasses(s.chip, kindFilter === null && s.chipActive)} onClick={() => setKindFilter(null)} data-testid="search-chip-all">
                All
              </button>
              {chipKinds.map((k) => (
                <button
                  type="button"
                  key={k}
                  className={mergeClasses(s.chip, kindFilter === k && s.chipActive)}
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                  data-testid={`search-chip-${k}`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          {results.length === 0 && actions.length === 0 && <div className={s.empty}>{isFetching ? 'Searching…' : 'No matches you can see.'}</div>}
          {actions.length > 0 && (
            <div>
              <div className={s.group}>Actions</div>
              {actions.map((a) => (
                <div key={a.route} className={s.hit} data-testid={`search-action-${a.route}`} role="option" aria-selected="false" onClick={() => goRoute(a.route)}>
                  <span className={s.hitTitle}>{a.label}</span>
                </div>
              ))}
            </div>
          )}
          {kindsInOrder.map((kind) => (
            <div key={kind}>
              <div className={s.group}>{KIND_LABEL[kind]}</div>
              {results
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <div
                    key={`${r.kind}-${r.id}`}
                    className={s.hit}
                    data-testid={`search-hit-${r.id}`}
                    role="option"
                    aria-selected="false"
                    onClick={() => go(r.kind, r.id, r.parentId)}
                  >
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
