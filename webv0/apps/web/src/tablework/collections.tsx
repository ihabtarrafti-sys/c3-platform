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
import { Link } from 'react-router-dom';
import { WorkSurface } from './materials';

/**
 * RecordLink — the mono business-ID link (PER-0001, APR-0007, MSN-0003…).
 *
 * ⚠️ Do NOT hand-roll this as `<Link className="mono">`. `.mono` is defined
 * ONLY as `.data-grid td.mono` and `.fact-list dd.mono` — it styles the CELL,
 * not an anchor inside it — so a `className="mono"` anchor renders completely
 * unstyled. That shipped: four sites across ApprovalsPage and
 * ApprovalDetailPage were live on the demo spine rendering in the body font.
 *
 * Every register repeats this pattern, so it is a kit primitive rather than a
 * per-screen class. RECORDED for Aura: the ID link takes the kit's caption
 * size (matching `td.mono`), not the Fluent-era hard-coded 13px.
 */
export function RecordLink({
  to,
  children,
  ...rest
}: {
  to: string;
  children: ReactNode;
  /** Spelled `data-testid` (not `testId`) so call sites keep the exact
   *  attribute the frozen oracle pins — converting the spelling would be a
   *  silent testid change. */
  'data-testid'?: string;
}) {
  return (
    <Link className="record-link" to={to} {...rest}>
      {children}
    </Link>
  );
}

/** Document-title parity with the Fluent PageHeader. Empty titles no-op so
 *  callers with nothing honest to say leave the tab name alone. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    if (title) document.title = `C3 — ${title}`;
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
  /**
   * Identity for the filter row. Without these the slot rendered a bare
   * `<div class="collection-filters">` with no role, label or testid — and
   * because its flex applies only to that wrapper, a screen that nested its own
   * labelled div turned the whole row into ONE flex item and collapsed the
   * chips into a block stack. Two screens worked around it in two DIFFERENT
   * ways; these props are the one answer both were reaching for.
   */
  filtersLabel?: string;
  filtersTestId?: string;
  /** The active-filter summary line (contract 05). */
  filterSummary?: ReactNode;
  children: ReactNode;
}

export function CollectionFrame({ title, titleTestId, kicker, count, scope, actions, filters, filtersLabel, filtersTestId, filterSummary, children }: CollectionFrameProps) {
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
      {filters ? (
        <div
          className="collection-filters"
          role={filtersLabel ? 'group' : undefined}
          aria-label={filtersLabel}
          data-testid={filtersTestId}
        >
          {filters}
        </div>
      ) : null}
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

/**
 * SectionHeading — the sub-section label, as a REAL heading.
 *
 * Five sites across three screens independently reached for
 * `<p className="eyebrow">`, which looks exactly right and **announces nothing**:
 * a section label that is not a heading is invisible to anyone navigating by
 * headings. They reached for it because the kit made the correct thing look
 * wrong — `tablework.css` styles `h2` only CONTEXTUALLY (`surface-heading`,
 * `record-section`, `receipt`, `conversation-header`, `obligation-card`,
 * `float-header`), so a bare `<h2>` falls through to the UA's own sizing and
 * margins. This is the eyebrow treatment ON a heading element, with that
 * fall-through closed.
 *
 * `level` exists because heading RANK is a document-structure decision the
 * screen owns, not the component: inside a `RecordPage` whose title is the
 * `<h1>` these are `<h2>`, but a section nested under another heading needs
 * `<h3>` to avoid a skipped level, which is its own a11y defect.
 */
export function SectionHeading({
  children,
  level = 2,
  ...rest
}: { children: ReactNode; level?: 2 | 3 } & HTMLAttributes<HTMLHeadingElement>) {
  const Tag = (level === 3 ? 'h3' : 'h2') as 'h2' | 'h3';
  return (
    <Tag className="section-heading" {...rest}>
      {children}
    </Tag>
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
  // A literal "-" is data-entry shorthand for "not set" — it gets the honest
  // labelled marker, never a bare hyphen (DefinitionList parity).
  return v === null || v === undefined || v === '' || v === '-';
}

/**
 * D2 — `literal` marks a list whose labels AND values came from OUTSIDE the org,
 * and it turns off both of this component's editorial touches:
 *
 *  - the uppercase `<dt>`, right for a label we authored and wrong for a key off
 *    the wire (a guest's own "fullName" was being shown back as "FULLNAME"), and
 *  - the `isEmpty` substitution, which rewrites a value of "-" into a labelled
 *    "not set" marker — reasonable for our own data-entry shorthand, but a
 *    misreading of a hyphen that someone outside the org deliberately typed.
 *
 * Both are the same rule: do not restyle or reinterpret data we did not write.
 * Opt-in, so every authored list already converted is untouched.
 */
export function FactList({ items, literal }: { items: DefItem[]; literal?: boolean }) {
  return (
    <dl className={literal ? 'fact-list is-literal' : 'fact-list'} data-tablework="FactClusters">
      {items.map((it, i) => (
        <div className="fact-pair" key={i}>
          <dt>{it.label}</dt>
          <dd className={it.mono ? 'mono' : undefined} data-testid={it.testId}>
            {!literal && isEmpty(it.value) ? (
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
