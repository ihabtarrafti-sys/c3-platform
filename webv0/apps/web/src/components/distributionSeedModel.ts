export interface DistributionShareDraft {
  readonly personId: string;
  readonly personName: string;
  readonly bps: string;
}

export type DistributionSeedState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly lineId: string }
  | { readonly kind: 'verified'; readonly lineId: string; readonly rows: readonly DistributionShareDraft[] }
  | { readonly kind: 'fetch-failed'; readonly lineId: string; readonly message: string };

export type DistributionSeedAction =
  | { readonly type: 'start'; readonly lineId: string }
  | { readonly type: 'succeed'; readonly lineId: string; readonly rows: readonly DistributionShareDraft[] }
  | { readonly type: 'fail'; readonly lineId: string; readonly message: string }
  | { readonly type: 'replace-rows'; readonly rows: readonly DistributionShareDraft[] }
  | { readonly type: 'reset' };

export const EMPTY_DISTRIBUTION_SEED: DistributionSeedState = { kind: 'idle' };

/**
 * A seed request is a witnessed read, not a convenience default. Failure can
 * never collapse into a verified empty share list, and a late response for a
 * previously selected income line cannot overwrite the current selection.
 */
export function distributionSeedReducer(
  state: DistributionSeedState,
  action: DistributionSeedAction,
): DistributionSeedState {
  switch (action.type) {
    case 'start':
      return { kind: 'loading', lineId: action.lineId };
    case 'succeed':
      return state.kind === 'loading' && state.lineId === action.lineId
        ? { kind: 'verified', lineId: action.lineId, rows: action.rows }
        : state;
    case 'fail':
      return state.kind === 'loading' && state.lineId === action.lineId
        ? { kind: 'fetch-failed', lineId: action.lineId, message: action.message }
        : state;
    case 'replace-rows':
      return state.kind === 'verified' ? { ...state, rows: action.rows } : state;
    case 'reset':
      return EMPTY_DISTRIBUTION_SEED;
  }
}
