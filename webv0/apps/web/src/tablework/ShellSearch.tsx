/**
 * ShellSearch.tsx — the shell's one box on the Tablework frame (pivot W0-1).
 *
 * The LOGIC is the Fluent GlobalSearch's, verbatim (shared shellModel routing
 * table + the same debounce/cancel, ⌘K focus, click-away, Enter-opens-top,
 * kind chips); only the material changed: the results panel is an ephemeral
 * non-modal Float (glass, fallback-first via .search-float in tablework.css).
 * Testids byte-identical — the e2e search spec is the oracle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
import { KIND_LABEL, NAV_ACTIONS, routeFor } from '../shellModel';

export function ShellSearch() {
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
    // …and CANCEL a superseded request (react-query aborts on key change).
    queryFn: ({ signal }) => api.search(debouncedQ, signal),
    enabled,
    staleTime: 15_000,
  });
  const allResults = enabled ? (data?.results ?? []) : [];
  const results = kindFilter ? allResults.filter((r) => r.kind === kindFilter) : allResults;

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
    <div className="shell-search" ref={rootRef} data-tablework="Hearthless-Search">
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder="Search anything…  Ctrl+K"
        onChange={(e) => {
          setQ(e.target.value);
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
        <div className="search-float" data-tablework="FloatSurface" data-material="float" data-testid="search-results" role="listbox" aria-label="Search results">
          {chipKinds.length > 1 && (
            <div className="search-chips" data-testid="search-chips">
              <button type="button" className={kindFilter === null ? 'search-chip active' : 'search-chip'} onClick={() => setKindFilter(null)} data-testid="search-chip-all">
                All
              </button>
              {chipKinds.map((k) => (
                <button
                  type="button"
                  key={k}
                  className={kindFilter === k ? 'search-chip active' : 'search-chip'}
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                  data-testid={`search-chip-${k}`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          {results.length === 0 && actions.length === 0 && <div className="search-empty">{isFetching ? 'Searching…' : 'No matches you can see.'}</div>}
          {actions.length > 0 && (
            <div>
              <div className="search-group">Actions</div>
              {actions.map((a) => (
                <div key={a.route} className="search-hit" data-testid={`search-action-${a.route}`} role="option" aria-selected="false" onClick={() => goRoute(a.route)}>
                  <span className="search-hit-title">{a.label}</span>
                </div>
              ))}
            </div>
          )}
          {kindsInOrder.map((kind) => (
            <div key={kind}>
              <div className="search-group">{KIND_LABEL[kind]}</div>
              {results
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <div
                    key={`${r.kind}-${r.id}`}
                    className="search-hit"
                    data-testid={`search-hit-${r.id}`}
                    role="option"
                    aria-selected="false"
                    onClick={() => go(r.kind, r.id, r.parentId)}
                  >
                    <span className="search-hit-title">
                      {r.title}
                      <span className="search-hit-id">{r.id}</span>
                    </span>
                    {r.subtitle && <span className="search-hit-sub">{r.subtitle}</span>}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
