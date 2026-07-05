import { describe, it, expect } from 'vitest';
import {
  formatPersonId,
  formatApprovalId,
  isPersonId,
  isApprovalId,
  PENDING_ADD_PERSON_TARGET,
} from '../src/businessIds';

describe('canonical business IDs', () => {
  it('formats zero-padded to 4 digits and grows beyond', () => {
    expect(formatPersonId(1)).toBe('PER-0001');
    expect(formatPersonId(42)).toBe('PER-0042');
    expect(formatPersonId(10000)).toBe('PER-10000');
    expect(formatApprovalId(7)).toBe('APR-0007');
  });

  it('rejects non-positive / non-integer sequences (never MAX+1 fudge)', () => {
    expect(() => formatPersonId(0)).toThrow();
    expect(() => formatPersonId(-1)).toThrow();
    expect(() => formatPersonId(1.5)).toThrow();
  });

  it('guards recognise only correctly-shaped IDs', () => {
    expect(isPersonId('PER-0001')).toBe(true);
    expect(isPersonId('PER-1')).toBe(false);
    expect(isPersonId('APR-0001')).toBe(false);
    expect(isApprovalId('APR-0009')).toBe(true);
    expect(isApprovalId(PENDING_ADD_PERSON_TARGET)).toBe(false);
  });

  it('the AddPerson pending target is not a real person id', () => {
    expect(PENDING_ADD_PERSON_TARGET).toBe('PENDING-ADDPERSON');
    expect(isPersonId(PENDING_ADD_PERSON_TARGET)).toBe(false);
  });
});
