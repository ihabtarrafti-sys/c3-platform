import { ApiError } from '../api';
import { truthStateOf, type WitnessState } from './TruthPanel';

export interface MoneyWitnessFacts<T> {
  readonly included: boolean;
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

export interface MoneyWitnessOptions<T> {
  readonly isEmpty: (data: T) => boolean;
  readonly omittedReason: string;
  readonly recheckMessage: string;
  /** A record-scoped 404 is authoritative: prior data belongs to a record that
   * no longer resolves and must not survive as stale content. */
  readonly notFoundMessage?: string;
}

/**
 * The shared money witness. Money pages predate the six-state contract, so the
 * order here is deliberately stronger than a visual loading/error split:
 * standing refusals and record disappearance revoke cached projections before
 * emptiness or stale rendering is considered.
 */
export function moneyWitnessOf<T>(
  facts: MoneyWitnessFacts<T>,
  options: MoneyWitnessOptions<T>,
): WitnessState {
  if (!facts.included) return { kind: 'denied', reasonClass: options.omittedReason };

  if (facts.error instanceof ApiError && (facts.error.status === 401 || facts.error.status === 403)) {
    return { kind: 'denied', reasonClass: facts.error.code || `HTTP_${facts.error.status}` };
  }

  if (options.notFoundMessage && facts.error instanceof ApiError && facts.error.status === 404) {
    return { kind: 'fetch-failed', message: options.notFoundMessage };
  }

  const base = truthStateOf(
    {
      data: facts.data,
      error: facts.error,
      isLoading: facts.isLoading,
      dataUpdatedAt: facts.dataUpdatedAt,
    },
    options.isEmpty,
  );

  // React Query may retain a successful cache while a background request is
  // running. Neither cached content nor cached emptiness is current until that
  // request returns, even though there is not yet an error to report.
  if (
    facts.isFetching &&
    facts.data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(facts.dataUpdatedAt > 0 ? facts.dataUpdatedAt : 0),
      message: options.recheckMessage,
    };
  }

  return base;
}

export function isCurrentMoneyWitness(
  truth: WitnessState,
): truth is Extract<WitnessState, { readonly kind: 'verified' | 'proven-empty' }> {
  return truth.kind === 'verified' || truth.kind === 'proven-empty';
}

/** Capability, visibility and every read dependency must all be current. */
export function moneyActionsAvailable(
  capability: boolean,
  truth: WitnessState,
  foreground = true,
  dependencies: readonly WitnessState[] = [],
): boolean {
  return capability && foreground && isCurrentMoneyWitness(truth) && dependencies.every(isCurrentMoneyWitness);
}
