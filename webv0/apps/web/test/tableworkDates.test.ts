/**
 * tableworkDates.test.ts — the F3/UX2 date DISPLAY capability. ISO in,
 * DD/MM/YYYY out; empty is empty; a non-ISO string is never reshaped.
 */
import { describe, expect, it } from 'vitest';
import { formatDisplayDate } from '../src/tablework/dates';

describe('formatDisplayDate — ISO → DD/MM/YYYY for human display', () => {
  it('reorders a stored ISO date', () => {
    expect(formatDisplayDate('2027-07-31')).toBe('31/07/2027');
    expect(formatDisplayDate('1999-05-20')).toBe('20/05/1999');
    expect(formatDisplayDate('2026-01-02')).toBe('02/01/2026'); // zero-padding preserved
  });

  it('renders nothing for empty/nullish (the caller shows its not-set marker)', () => {
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate(null)).toBe('');
    expect(formatDisplayDate(undefined)).toBe('');
  });

  it('passes a non-ISO string through untouched — never invents a reading', () => {
    expect(formatDisplayDate('2026-07')).toBe('2026-07'); // not a full date
    expect(formatDisplayDate('31/07/2027')).toBe('31/07/2027'); // already display form
    expect(formatDisplayDate('not a date')).toBe('not a date');
    expect(formatDisplayDate('2026-07-01T16:00')).toBe('2026-07-01T16:00'); // datetime, not a bare date
  });
});
