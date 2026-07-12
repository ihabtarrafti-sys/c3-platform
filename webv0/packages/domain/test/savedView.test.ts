import { describe, expect, it } from 'vitest';
import {
  savedViewCreateInputSchema,
  savedViewUpdateInputSchema,
  SAVED_VIEW_REGISTERS,
  SAVED_VIEW_STATE_MAX_BYTES,
} from '../src/savedView';

describe('saved view schemas (Track B)', () => {
  const okState = { q: 'lol', team: 'LoL', status: 'active', sort: 'name' };

  it('accepts a valid create; the register must be known', () => {
    expect(savedViewCreateInputSchema.safeParse({ register: 'people', name: 'LoL roster', state: okState }).success).toBe(true);
    expect(savedViewCreateInputSchema.safeParse({ register: 'nope', name: 'x', state: okState }).success).toBe(false);
    for (const r of SAVED_VIEW_REGISTERS) {
      expect(savedViewCreateInputSchema.safeParse({ register: r, name: 'v', state: {} }).success).toBe(true);
    }
  });

  it('requires a name and bounds the serialised state', () => {
    expect(savedViewCreateInputSchema.safeParse({ register: 'people', name: '   ', state: okState }).success).toBe(false);
    const huge = { blob: 'x'.repeat(SAVED_VIEW_STATE_MAX_BYTES) };
    expect(savedViewCreateInputSchema.safeParse({ register: 'people', name: 'big', state: huge }).success).toBe(false);
  });

  it('an update must change at least one of name/state', () => {
    expect(savedViewUpdateInputSchema.safeParse({}).success).toBe(false);
    expect(savedViewUpdateInputSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(savedViewUpdateInputSchema.safeParse({ state: okState }).success).toBe(true);
  });
});
