import type { RecordAuthorship } from '@c3web/domain';

interface AuthorshipMarkProps {
  authorship: RecordAuthorship;
  /** The person arm keeps the thread's compact avatar treatment. */
  compact?: boolean;
}

function initialsOf(label: string | null): string {
  if (!label?.trim()) return '·';
  return label
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * D-009's visible authorship contract. A person remains named and accountable;
 * deterministic and AI-assisted records never borrow a person's name or
 * avatar. The latter two state the binding line in their own markup because a
 * colour or icon cannot carry a governance distinction by itself.
 */
export function AuthorshipMark({ authorship, compact = false }: AuthorshipMarkProps) {
  if (authorship.kind === 'person') {
    // A missing display label must not collapse distinct people into the same
    // anonymous "Member". The stable id is less pretty, but stays accountable.
    const label = authorship.label?.trim() || `Member · ${authorship.userId}`;
    return (
      <div
        className={`authorship-mark person${compact ? ' compact' : ''}`}
        data-tablework="AuthorshipMark"
        data-authorship="person"
        data-author-id={authorship.userId}
        role="group"
        aria-label={`Person author · ${label}`}
      >
        <span className="avatar-dot actor-avatar" aria-hidden="true">
          {initialsOf(authorship.label)}
        </span>
        <span className="authorship-copy">
          <strong>{label}</strong>
          <small>Person · accountable author</small>
        </span>
      </div>
    );
  }

  if (authorship.kind === 'system') {
    return (
      <div
        className="authorship-mark system"
        data-tablework="AuthorshipMark"
        data-authorship="system"
        role="group"
        aria-label="Deterministic system authorship"
      >
        <span className="authorship-copy">
          <strong>System event</strong>
          <small className="authorship-detail">Rule · {authorship.rule}</small>
          <small className="authorship-boundary">May state facts · does not imply acceptance.</small>
        </span>
      </div>
    );
  }

  return (
    <div
      className="authorship-mark ai-assisted"
      data-tablework="AuthorshipMark"
      data-authorship="ai_assisted"
      role="group"
      aria-label="AI-assisted authorship awaiting human ratification"
    >
      <span className="authorship-copy">
        <strong>AI-assisted output</strong>
        <small className="authorship-detail">{authorship.provenance}</small>
        <small className="authorship-ratification">Not ratified by a human</small>
        <small className="authorship-boundary">May state facts · does not imply acceptance.</small>
      </span>
    </div>
  );
}
