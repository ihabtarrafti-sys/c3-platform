import type { ReactNode } from 'react';
import { TruthPanel, type WitnessState } from './TruthPanel';

type TruthPanelTestIds = Partial<
  Record<'loading' | 'verified' | 'empty' | 'denied' | 'failed' | 'stale', string>
>;

/**
 * The six-state contract calls both a failed refresh and an in-flight refresh
 * `stale`: either way, cached content is not current and actions must pause.
 * Their prose is not interchangeable. This adapter keeps the state vocabulary
 * intact while refusing to call a request that is still running a failure.
 */
export function RecheckingTruthPanel({
  state,
  rechecking,
  emptyLabel,
  testids,
  children,
}: {
  readonly state: WitnessState;
  readonly rechecking: boolean;
  readonly emptyLabel: string;
  readonly testids?: TruthPanelTestIds;
  readonly children?: ReactNode;
}) {
  if (rechecking && state.kind === 'stale') {
    return (
      <div data-truth="stale" data-testid={testids?.stale}>
        <div className="boundary-note" role="status">
          Showing the last verified view while a new check is in progress. It has not failed; act on nothing time-sensitive until the witness returns.
        </div>
        {children}
      </div>
    );
  }

  return (
    <TruthPanel state={state} emptyLabel={emptyLabel} testids={testids}>
      {children}
    </TruthPanel>
  );
}
