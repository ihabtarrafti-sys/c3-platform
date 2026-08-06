import type { WitnessState } from './TruthPanel';

export type MoneyContinuityLens =
  | 'mission'
  | 'portfolio'
  | 'invoices'
  | 'claims'
  | 'subscriptions'
  | 'agreements';

export const MONEY_CONTINUITY_LENSES: readonly MoneyContinuityLens[] = [
  'mission',
  'portfolio',
  'invoices',
  'claims',
  'subscriptions',
  'agreements',
];

export const MONEY_CONTINUITY_EXTERNAL_ROUTES: ReadonlyArray<{
  readonly lens: Exclude<MoneyContinuityLens, 'mission'>;
  readonly pathname: string;
}> = [
  { lens: 'portfolio', pathname: '/missions/finance' },
  { lens: 'invoices', pathname: '/invoices' },
  { lens: 'claims', pathname: '/claims' },
  { lens: 'subscriptions', pathname: '/subscriptions' },
  { lens: 'agreements', pathname: '/agreements' },
];

export function moneyContinuityHrefFor(lens: MoneyContinuityLens, missionId: string): string {
  if (lens === 'mission') return `/missions/${missionId}/comms?open=finance`;
  const route = MONEY_CONTINUITY_EXTERNAL_ROUTES.find((candidate) => candidate.lens === lens);
  // The closed lens union makes this unreachable. Keeping the fallback local
  // avoids turning an accidental extension into an unrelated workspace route.
  if (!route) return `/missions/${missionId}/comms?open=finance`;
  return `${route.pathname}?workspace=${encodeURIComponent(missionId)}`;
}

export interface MissionMoneyWitnesses {
  readonly pnl: WitnessState;
  readonly distributions: WitnessState;
}

function witnessAt(state: WitnessState): Date | null {
  if (state.kind === 'verified' || state.kind === 'proven-empty') return state.at;
  if (state.kind === 'stale') return state.verifiedAt;
  return null;
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

/**
 * Join the two independent mission-money witnesses without upgrading either.
 * The result is window standing only: it never derives settlement, solvency,
 * readiness, or mission completion from financial records.
 */
export function joinMissionMoneyWitnesses({ pnl, distributions }: MissionMoneyWitnesses): WitnessState {
  const sources = [
    { label: 'P&L', state: pnl },
    { label: 'distributions', state: distributions },
  ] as const;

  const denied = sources.filter((source) => source.state.kind === 'denied');
  if (denied.length > 0) {
    return {
      kind: 'denied',
      reasonClass: denied
        .map((source) => `${source.label}:${source.state.kind === 'denied' ? source.state.reasonClass : 'denied'}`)
        .join(','),
    };
  }

  const failed = sources.filter((source) => source.state.kind === 'fetch-failed');
  if (failed.length > 0) {
    return {
      kind: 'fetch-failed',
      message: failed
        .map((source) => `${source.label}: ${source.state.kind === 'fetch-failed' ? source.state.message : 'The read failed.'}`)
        .join(' '),
    };
  }

  if (sources.some((source) => source.state.kind === 'loading')) return { kind: 'loading' };

  const witnessedAt = sources
    .map((source) => witnessAt(source.state))
    .filter((at): at is Date => at !== null);
  if (witnessedAt.length !== sources.length) {
    return { kind: 'fetch-failed', message: 'A mission money source has no current witness.' };
  }
  const at = witnessedAt.reduce(earlier);

  const stale = sources.filter((source) => source.state.kind === 'stale');
  if (stale.length > 0) {
    return {
      kind: 'stale',
      verifiedAt: at,
      message: `${stale.map((source) => source.label).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} being checked again.`,
    };
  }

  if (sources.every((source) => source.state.kind === 'proven-empty')) return { kind: 'proven-empty', at };
  return { kind: 'verified', at };
}
