import { describe, expect, it } from 'vitest';
import {
  MONEY_CONTINUITY_LENSES,
  joinMissionMoneyWitnesses,
} from '../src/tablework/moneyContinuityModel';

const early = new Date('2026-08-06T08:00:00.000Z');
const late = new Date('2026-08-06T09:00:00.000Z');

describe('Money Continuity truth', () => {
  it('keeps the runtime lens set closed and explicit', () => {
    expect(MONEY_CONTINUITY_LENSES).toEqual([
      'mission',
      'portfolio',
      'invoices',
      'claims',
      'subscriptions',
      'agreements',
    ]);
  });

  it('does not issue a joint current witness while either source is loading', () => {
    expect(
      joinMissionMoneyWitnesses({
        pnl: { kind: 'verified', at: late },
        distributions: { kind: 'loading' },
      }),
    ).toEqual({ kind: 'loading' });
  });

  it('preserves authoritative refusal and failed-read standing without borrowing the other source', () => {
    expect(
      joinMissionMoneyWitnesses({
        pnl: { kind: 'fetch-failed', message: 'P&L unavailable.' },
        distributions: { kind: 'denied', reasonClass: 'HTTP_403' },
      }),
    ).toEqual({ kind: 'denied', reasonClass: 'distributions:HTTP_403' });

    expect(
      joinMissionMoneyWitnesses({
        pnl: { kind: 'fetch-failed', message: 'P&L unavailable.' },
        distributions: { kind: 'verified', at: late },
      }),
    ).toEqual({ kind: 'fetch-failed', message: 'P&L: P&L unavailable.' });
  });

  it('never upgrades a stale source and uses the earliest independent witness time', () => {
    expect(
      joinMissionMoneyWitnesses({
        pnl: { kind: 'verified', at: late },
        distributions: { kind: 'stale', verifiedAt: early, message: 'Checking again.' },
      }),
    ).toEqual({
      kind: 'stale',
      verifiedAt: early,
      message: 'distributions is being checked again.',
    });
  });

  it('claims a proven-empty joint view only when both independent records are proven empty', () => {
    expect(
      joinMissionMoneyWitnesses({
        pnl: { kind: 'proven-empty', at: late },
        distributions: { kind: 'proven-empty', at: early },
      }),
    ).toEqual({ kind: 'proven-empty', at: early });

    expect(
      joinMissionMoneyWitnesses({
        pnl: { kind: 'verified', at: late },
        distributions: { kind: 'proven-empty', at: early },
      }),
    ).toEqual({ kind: 'verified', at: early });
  });
});
