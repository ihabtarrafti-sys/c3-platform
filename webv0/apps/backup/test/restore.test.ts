import { describe, it, expect } from 'vitest';
import { disposableDbName, assertDisposableDbName, REQUIRED_FIXTURES, resolveExportTenant } from '../src/restore';

describe('restore safety helpers', () => {
  it('generates a uniquely-named disposable drill database', () => {
    const name = disposableDbName(new Date('2026-07-07T02:15:00Z'), 'abc');
    expect(name).toMatch(/^c3_restore_drill_20260707021500_abc$/);
    expect(() => assertDisposableDbName(name)).not.toThrow();
  });

  it('refuses to treat the live/system database as disposable', () => {
    expect(() => assertDisposableDbName('railway')).toThrow();
    expect(() => assertDisposableDbName('postgres')).toThrow();
    expect(() => assertDisposableDbName('c3_app')).toThrow();
    expect(() => assertDisposableDbName('c3_restore_drill_bad')).toThrow(/disposable/);
  });

  it('pins the required certification fixtures', () => {
    expect(REQUIRED_FIXTURES.persons).toContain('PER-0001');
    expect(REQUIRED_FIXTURES.approvals).toEqual(['APR-0001', 'APR-0002']);
  });
});

describe('composed per-org restore option (B-5 / A-5)', () => {
  it('is opt-in: unset or empty means no export step', () => {
    expect(resolveExportTenant(undefined)).toBeNull();
    expect(resolveExportTenant('')).toBeNull();
    expect(resolveExportTenant('   ')).toBeNull();
  });

  it('accepts a well-formed tenant slug (trimmed)', () => {
    expect(resolveExportTenant('geekay')).toBe('geekay');
    expect(resolveExportTenant('  certbeta  ')).toBe('certbeta');
    expect(resolveExportTenant('alpha-2')).toBe('alpha-2');
  });

  it('fails closed on a malformed slug rather than silently skipping', () => {
    expect(() => resolveExportTenant('Alpha')).toThrow(/tenant slug/i);
    expect(() => resolveExportTenant('a b')).toThrow();
    expect(() => resolveExportTenant("x'; DROP")).toThrow();
  });
});
