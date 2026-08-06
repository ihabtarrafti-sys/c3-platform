import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { moneyActionsAvailable, moneyWitnessOf } from '../src/tablework/moneyWitness';

interface View {
  readonly rows: readonly string[];
}

const witnessedAt = Date.UTC(2026, 7, 6, 10, 30, 0);
const base = (overrides: Partial<{
  included: boolean;
  data: View | undefined;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
}> = {}) => ({
  included: true,
  data: { rows: ['one'] } as View | undefined,
  error: null as unknown,
  isLoading: false,
  isFetching: false,
  dataUpdatedAt: witnessedAt,
  ...overrides,
});

const derive = (overrides: Parameters<typeof base>[0] = {}, notFoundMessage?: string) =>
  moneyWitnessOf(base(overrides), {
    isEmpty: (view) => view.rows.length === 0,
    omittedReason: 'FINANCIALS_UNAVAILABLE',
    recheckMessage: 'Checking money again.',
    notFoundMessage,
  });

describe('moneyWitnessOf', () => {
  it('distinguishes loading, verified and positively witnessed emptiness', () => {
    expect(derive({ data: undefined, isLoading: true })).toEqual({ kind: 'loading' });
    expect(derive()).toEqual({ kind: 'verified', at: new Date(witnessedAt) });
    expect(derive({ data: { rows: [] } })).toEqual({ kind: 'proven-empty', at: new Date(witnessedAt) });
  });

  it('never promotes cached content or cached emptiness during a background check', () => {
    expect(derive({ isFetching: true })).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Checking money again.',
    });
    expect(derive({ data: { rows: [] }, isFetching: true })).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Checking money again.',
    });
  });

  it.each([401, 403])('redacts cached money after an authoritative HTTP %s refusal', (status) => {
    expect(derive({ error: new ApiError(status, 'FINANCE_REFUSED', 'No standing.') })).toEqual({
      kind: 'denied',
      reasonClass: 'FINANCE_REFUSED',
    });
  });

  it('redacts cached record data after an authoritative 404', () => {
    expect(
      derive(
        { error: new ApiError(404, 'MISSION_NOT_FOUND', 'Missing.') },
        'This financial record no longer resolves.',
      ),
    ).toEqual({ kind: 'fetch-failed', message: 'This financial record no longer resolves.' });
  });

  it('labels cached data stale after an ordinary failed refresh', () => {
    expect(derive({ error: new ApiError(503, 'UNAVAILABLE', 'Try again.') })).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Try again.',
    });
  });
});

describe('moneyActionsAvailable', () => {
  const current = { kind: 'verified', at: new Date(witnessedAt) } as const;
  const empty = { kind: 'proven-empty', at: new Date(witnessedAt) } as const;
  const stale = { kind: 'stale', verifiedAt: new Date(witnessedAt), message: 'Checking.' } as const;

  it('requires capability, foreground, a current source and current dependencies', () => {
    expect(moneyActionsAvailable(true, current, true, [empty])).toBe(true);
    expect(moneyActionsAvailable(false, current, true, [empty])).toBe(false);
    expect(moneyActionsAvailable(true, current, false, [empty])).toBe(false);
    expect(moneyActionsAvailable(true, stale, true, [empty])).toBe(false);
    expect(moneyActionsAvailable(true, current, true, [stale])).toBe(false);
  });
});
