export interface DistributionShareDraft {
  readonly personId: string;
  readonly personName: string;
  readonly bps: string;
}

export type DistributionSeedState =
  | { readonly kind: 'idle'; readonly requestToken: number }
  | { readonly kind: 'loading'; readonly lineId: string; readonly requestToken: number }
  | {
      readonly kind: 'verified';
      readonly lineId: string;
      readonly requestToken: number;
      readonly rows: readonly DistributionShareDraft[];
    }
  | { readonly kind: 'fetch-failed'; readonly lineId: string; readonly requestToken: number; readonly message: string };

export type DistributionSeedAction =
  | { readonly type: 'start'; readonly lineId: string; readonly requestToken: number }
  | {
      readonly type: 'succeed';
      readonly lineId: string;
      readonly requestToken: number;
      readonly rows: readonly DistributionShareDraft[];
    }
  | { readonly type: 'fail'; readonly lineId: string; readonly requestToken: number; readonly message: string }
  | { readonly type: 'replace-rows'; readonly rows: readonly DistributionShareDraft[] }
  | { readonly type: 'reset' };

export const EMPTY_DISTRIBUTION_SEED: DistributionSeedState = { kind: 'idle', requestToken: 0 };

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
      return action.requestToken > state.requestToken
        ? { kind: 'loading', lineId: action.lineId, requestToken: action.requestToken }
        : state;
    case 'succeed':
      return state.kind === 'loading' && state.requestToken === action.requestToken && state.lineId === action.lineId
        ? { kind: 'verified', lineId: action.lineId, requestToken: action.requestToken, rows: action.rows }
        : state;
    case 'fail':
      return state.kind === 'loading' && state.requestToken === action.requestToken && state.lineId === action.lineId
        ? { kind: 'fetch-failed', lineId: action.lineId, requestToken: action.requestToken, message: action.message }
        : state;
    case 'replace-rows':
      return state.kind === 'verified' ? { ...state, rows: action.rows } : state;
    case 'reset':
      return { kind: 'idle', requestToken: state.requestToken };
  }
}
