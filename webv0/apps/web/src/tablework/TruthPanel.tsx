/**
 * TruthPanel.tsx — THE SIX-STATE TRUTHFULNESS CONTRACT (Comms chapter Phase A).
 *
 * Born from the Battle-#2 hybrid ruling: Intel's contract vocabulary, rebuilt
 * in Tablework grammar. Every data region renders exactly ONE of six truth
 * states, and stamps it as a machine-checkable artifact (`data-truth`):
 *
 *   loading       — the witness is still out; claim nothing.
 *   verified      — a successful witness returned CONTENT; the region renders
 *                   it (children), stamped with when it was checked.
 *   proven-empty  — a successful witness returned NOTHING. Emptiness is a
 *                   POSITIVE claim and it is EARNED: this state is structurally
 *                   unreachable from an errored query (see truthStateOf).
 *   denied        — the server refused the read as a matter of standing; the
 *                   denial renders as denial with its reason class, never as
 *                   an empty list (instance 21's law).
 *   fetch-failed  — the witness never came back (network/5xx). A failure is a
 *                   failure — never a zero, never a greenfield line.
 *   stale         — a prior witness exists but the latest attempt failed; the
 *                   region may show the old truth ONLY under an explicit stale
 *                   stamp, and dependent actions should stop trusting it.
 *
 * Instance 48 rides the design: the artifact IS the `data-truth` attribute —
 * tests and tooling assert against it, never against prose.
 *
 * TWO ALTITUDES, TWO ARTIFACTS (deliberate): this file is the REGION contract
 * (`data-truth` — did the witness come back, and what did it prove); the
 * existing TruthValue.tsx is the FACT contract (`data-truth-state` — a single
 * fact's epistemic state inside a verified region). A region is verified while
 * a fact within it is honestly unknown. They compose; they never compete.
 */
import type { ReactNode } from 'react';

export type WitnessState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'verified'; readonly at: Date }
  | { readonly kind: 'proven-empty'; readonly at: Date }
  | { readonly kind: 'denied'; readonly reasonClass: string }
  | { readonly kind: 'fetch-failed'; readonly message: string }
  | { readonly kind: 'stale'; readonly verifiedAt: Date; readonly message: string };

/** The minimal query facts the deriver consumes (react-query compatible,
 *  but deliberately structural — no dependency on the library's types). */
export interface TruthQueryFacts<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  /** When the library knows a previous successful fetch exists (stale path). */
  readonly dataUpdatedAt?: number;
}

/** An error the API layer classified as a standing denial (403-shaped). */
function deniedReasonOf(error: unknown): string | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: number }).status;
    if (status === 403) {
      const code = (error as { code?: string }).code;
      return code ?? 'denied';
    }
  }
  return null;
}

/**
 * THE ONE DERIVER. Consumers never hand-roll the mapping — a hand-rolled
 * branch is exactly where instance 21 lived on the shipped comms surface.
 *
 * Law 1, enforced by ORDER: the error branches (fetch-failed / denied / stale)
 * are decided BEFORE emptiness is ever consulted — 'proven-empty' cannot be
 * derived from an errored query, structurally.
 */
export function truthStateOf<T>(q: TruthQueryFacts<T>, isEmpty: (data: T) => boolean): WitnessState {
  if (q.isLoading) return { kind: 'loading' };
  if (q.error !== null && q.error !== undefined) {
    const denied = deniedReasonOf(q.error);
    const message = q.error instanceof Error ? q.error.message : 'The request failed.';
    if (denied !== null) return { kind: 'denied', reasonClass: denied };
    if (q.data !== undefined && q.dataUpdatedAt) {
      return { kind: 'stale', verifiedAt: new Date(q.dataUpdatedAt), message };
    }
    return { kind: 'fetch-failed', message };
  }
  if (q.data === undefined) return { kind: 'loading' };
  // Successful truth carries the witness's timestamp, not render time. A
  // rerender without a refetch must not make old data look freshly checked.
  const witnessedAt = new Date(q.dataUpdatedAt || Date.now());
  if (isEmpty(q.data)) return { kind: 'proven-empty', at: witnessedAt };
  return { kind: 'verified', at: witnessedAt };
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * The rendering half of the contract. `children` render ONLY under `verified`
 * (and, dimmed under an explicit stamp, `stale`). Every other state renders
 * its own artifact-stamped surface.
 */
export function TruthPanel({
  state,
  emptyLabel,
  testids,
  children,
}: {
  state: WitnessState;
  /** The honest empty sentence for THIS region ("No messages yet…"). It renders
   *  ONLY inside the proven-empty artifact — emptiness earned by a witness. */
  emptyLabel: string;
  /** Adopting regions keep their pinned test ids (passed per state so the
   *  LITERAL stays in the adopting file, where the source-pins expect it). */
  testids?: Partial<Record<'loading' | 'verified' | 'empty' | 'denied' | 'failed' | 'stale', string>>;
  children?: ReactNode;
}) {
  switch (state.kind) {
    case 'loading':
      return (
        <p className="boundary-note" data-truth="loading" data-testid={testids?.loading}>
          Checking…
        </p>
      );
    case 'verified':
      return (
        <div data-truth="verified" data-testid={testids?.verified}>
          {children}
        </div>
      );
    case 'proven-empty':
      return (
        <p className="boundary-note" data-truth="proven-empty" data-testid={testids?.empty}>
          {emptyLabel} <small>(verified empty at {hhmm(state.at)} — a checked fact, not a guess)</small>
        </p>
      );
    case 'denied':
      return (
        <div className="field-error-block" role="note" data-truth="denied" data-testid={testids?.denied}>
          This is a DENIAL, not an empty record — your standing does not include this read ({state.reasonClass}).
        </div>
      );
    case 'fetch-failed':
      return (
        <div className="field-error-block" role="alert" data-truth="fetch-failed" data-testid={testids?.failed}>
          This could not be loaded — a FAILURE, not an empty record. {state.message}
        </div>
      );
    case 'stale':
      return (
        <div data-truth="stale">
          <div className="field-error-block" role="alert">
            Showing the last verified view ({hhmm(state.verifiedAt)}) — the latest check FAILED: {state.message}. Treat
            with care; act on nothing time-sensitive.
          </div>
          {children}
        </div>
      );
  }
}
