/**
 * collections.tsx — the Tablework collection/record family (pivot W0-3;
 * Aura contract 05, Dawn's Finance-screen craft as the local bar).
 *
 * CollectionFrame: title + bounded disclosed count + scope line + local
 * actions + the filter row + active-filter summary + results. Counts are
 * actor-scoped and disclosure-safe — the count line is whatever the caller's
 * ALREADY-DISCLOSED data supports, never a total the role can't see.
 *
 * ComparisonTable: side-by-side comparison only (contract 05); the scroll
 * region is keyboard-reachable (tabindex + label). Column-rhythm decisions
 * that repeat across registers get RECORDED for Aura, never silently local.
 *
 * StatusBadge / states: API-identical ports of the Fluent B.8/A.12 components
 * (variant map, copy, roles, testids verbatim) so pages convert mechanically.
 */
import { useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { WorkSurface } from './materials';

/** Document-title parity with the Fluent PageHeader. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `C3 — ${title}`;
  }, [title]);
}

interface CollectionFrameProps {
  /** The register's name (also sets the document title, PageHeader parity). */
  title: string;
  titleTestId?: string;
  /** The kicker word above the title (e.g. "Register"). */
  kicker?: string;
  /** The bounded disclosed count / context line (e.g. "12 shown"). */
  count?: ReactNode;
  /** What this collection covers, honestly (scope explanation). */
  scope?: ReactNode;
  /** Local create/request actions. */
  actions?: ReactNode;
  /** The filter row (search, chips, saved views). */
  filters?: ReactNode;
  /** The active-filter summary line (contract 05). */
  filterSummary?: ReactNode;
  children: ReactNode;
}

export function CollectionFrame({ title, titleTestId, kicker, count, scope, actions, filters, filterSummary, children }: CollectionFrameProps) {
  usePageTitle(title);
  return (
    <WorkSurface tier="raised" tablework="CollectionFrame" className="collection-frame">
      <header className="surface-heading">
        <div>
          {kicker ? <p className="eyebrow">{kicker}</p> : null}
          <h1 className="collection-title" data-testid={titleTestId}>
            {title}
          </h1>
          {count ? <p className="collection-count">{count}</p> : null}
          {scope ? <p className="collection-scope">{scope}</p> : null}
        </div>
        {actions ? (
          <div className="panel-actions" role="group" aria-label="Actions">
            {actions}
          </div>
        ) : null}
      </header>
      {filters ? <div className="collection-filters">{filters}</div> : null}
      {filterSummary ? <p className="collection-filter-summary">{filterSummary}</p> : null}
      {children}
    </WorkSurface>
  );
}

/** Side-by-side comparison only; the scroll region is keyboard-reachable. */
export function ComparisonTable({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <div className="comparison-scroll" tabIndex={0} aria-label={label} data-tablework="ComparisonTable" data-testid={testId}>
      <table className="data-grid" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

/** A list-register row: identity + facts + the row's next action. */
export function RecordRow({ children, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className="record-row" data-tablework="RecordRow ObjectIdentity">
      {children}
    </div>
  );
}

// ── StatusBadge (B.8, API-identical) ─────────────────────────────────────────

export type StatusVariant = 'ready' | 'pending' | 'blocked' | 'neutral' | 'info' | 'signal';

const STATUS_COLOR: Record<StatusVariant, string> = {
  ready: 'var(--c3-state-success)',
  pending: 'var(--c3-state-warning)',
  blocked: 'var(--c3-state-danger)',
  neutral: 'var(--c3-ink-quiet)',
  info: 'var(--c3-state-info)',
  // S46 (approved relaxation #4): Signal Red as TEXT for the one state that
  // demands the eye — agreement "Expired". Never on governed flows.
  signal: 'var(--c3-state-danger)',
};

export function StatusBadge({ variant, children, ...rest }: { variant: StatusVariant; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  const color = STATUS_COLOR[variant];
  return (
    <span className="status-badge" style={{ color }} {...rest}>
      <span className="status-dot" style={{ backgroundColor: color }} aria-hidden="true" />
      {children}
    </span>
  );
}

// ── Truthful data-surface states (A.12, API-identical) ───────────────────────
// empty !== unavailable !== denied !== error; zero only when zero is the truth;
// failures always carry a correlation reference.

export function EmptyState({ message, action, ...rest }: { message: string; action?: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="tw-empty-state" {...rest}>
      <div>{message}</div>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="tw-loading-state" role="status" aria-live="polite" aria-busy="true">
      {label}
    </div>
  );
}

export function ErrorState({ message, correlationId, ...rest }: { message: string; correlationId?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="tw-error-state" role="alert" {...rest}>
      <div className="tw-error-message">{message}</div>
      {correlationId && <div className="tw-error-ref">Reference: {correlationId}</div>}
    </div>
  );
}

// ── FactList (the DefinitionList port — record facts as a dl) ────────────────

export interface DefItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** data-testid applied to the value cell. */
  testId?: string;
}

function isEmpty(v: ReactNode): boolean {
  return v === null || v === undefined || v === '';
}

export function FactList({ items }: { items: DefItem[] }) {
  return (
    <dl className="fact-list" data-tablework="FactClusters">
      {items.map((it, i) => (
        <div className="fact-pair" key={i}>
          <dt>{it.label}</dt>
          <dd className={it.mono ? 'mono' : undefined} data-testid={it.testId}>
            {isEmpty(it.value) ? (
              <span className="unknown-value" aria-label="not set">
                —
              </span>
            ) : (
              it.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
