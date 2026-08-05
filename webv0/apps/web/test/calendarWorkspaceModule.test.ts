import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { calendarTruthOf } from '../src/pages/CalendarPage';

const witnessedAt = Date.parse('2026-08-05T08:00:00.000Z');
const emptyCalendar = { items: [], horizonDays: 90, todayIso: '2026-08-05' };
const populatedCalendar = { ...emptyCalendar, items: [{} as never] };

describe('Calendar Workspace OS witness', () => {
  it('distinguishes loading, verified, proven-empty and cached revalidation', () => {
    const base = {
      canView: true,
      data: undefined,
      error: null,
      isLoading: true,
      isFetching: false,
      dataUpdatedAt: 0,
    };

    expect(calendarTruthOf(base)).toEqual({ kind: 'loading' });
    expect(
      calendarTruthOf({ ...base, data: emptyCalendar, isLoading: false, dataUpdatedAt: witnessedAt }).kind,
    ).toBe('proven-empty');
    expect(
      calendarTruthOf({ ...base, data: populatedCalendar, isLoading: false, dataUpdatedAt: witnessedAt }).kind,
    ).toBe('verified');
    expect(
      calendarTruthOf({
        ...base,
        data: populatedCalendar,
        isLoading: false,
        isFetching: true,
        dataUpdatedAt: witnessedAt,
      }),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The calendar horizon is being checked again.',
    });
    expect(
      calendarTruthOf({
        ...base,
        data: emptyCalendar,
        isLoading: false,
        isFetching: true,
        dataUpdatedAt: witnessedAt,
      }).kind,
    ).toBe('stale');
  });

  it('treats standing refusals as denials and keeps recoverable failures distinct from emptiness', () => {
    const base = {
      canView: true,
      data: populatedCalendar,
      error: null,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: witnessedAt,
    };

    expect(calendarTruthOf({ ...base, canView: false })).toEqual({
      kind: 'denied',
      reasonClass: 'SITUATION_UNAVAILABLE',
    });
    expect(calendarTruthOf({ ...base, error: new ApiError(401, 'UNAUTHENTICATED', 'Token rejected.') })).toEqual({
      kind: 'denied',
      reasonClass: 'UNAUTHENTICATED',
    });
    expect(calendarTruthOf({ ...base, error: new ApiError(403, 'SITUATION_DENIED', 'No standing.') })).toEqual({
      kind: 'denied',
      reasonClass: 'SITUATION_DENIED',
    });
    expect(calendarTruthOf({ ...base, error: new ApiError(503, 'UNAVAILABLE', 'Try again.') }).kind).toBe('stale');
    expect(
      calendarTruthOf({
        ...base,
        data: undefined,
        dataUpdatedAt: 0,
        error: new ApiError(503, 'UNAVAILABLE', 'Try again.'),
      }).kind,
    ).toBe('fetch-failed');
  });
});
