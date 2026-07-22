/**
 * TruthValue.tsx — the truth-state primitive (v1.3.0 contract).
 *
 * A fact is rendered as what it IS: known, or one of the honest not-known
 * states. The pilot's obligation card uses known/unknown; the full vocabulary
 * is carried so future surfaces speak the same words. The `data-truth-state`
 * attribute is the contract hook.
 */
import type { ReactNode } from 'react';

export type TruthState =
  | 'known'
  | 'zero'
  | 'unknown'
  | 'missing-source'
  | 'withheld'
  | 'partial'
  | 'stale'
  | 'conflict';

interface ObligationFactProps {
  /** The fact's name (Delivery / Acceptance / Done). */
  label: string;
  /** Whether this independent truth is recorded. */
  state: Extract<TruthState, 'known' | 'unknown'>;
  /** The honest sentence under the fact name. */
  detail: string;
  /** The glyph in the ring (✓ when known; the fact's ordinal while unknown). */
  mark: ReactNode;
}

/** One of the obligation card's three INDEPENDENT truth rows. */
export function ObligationFact({ label, state, detail, mark }: ObligationFactProps) {
  return (
    <article className={`obligation-fact ${state}`} data-tablework="TruthValue" data-truth-state={state}>
      <i aria-hidden="true">{mark}</i>
      <span>
        <strong>{label}</strong>
        <br />
        {detail}
      </span>
    </article>
  );
}
