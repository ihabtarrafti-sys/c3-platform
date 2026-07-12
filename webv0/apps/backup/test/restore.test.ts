import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { disposableDbName, assertDisposableDbName, REQUIRED_FIXTURES, resolveExportTenant, verifyBlobRecovery } from '../src/restore';
import type { ValidatedBlobInventory } from '../src/signing';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

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

describe('H-08: object-store recovery verification (restore drill)', () => {
  const inv = (): ValidatedBlobInventory => ({
    document: { count: 2, sample: { storageKey: 'tid/doc', sha256: sha('doc-bytes') } },
    photo: { count: 1, sample: { storageKey: 'tid/photo', sha256: sha('photo-bytes') } },
    intake: { count: 0, sample: null }, // empty class — nothing to prove, skipped
  });
  const store: Record<string, Buffer> = { 'tid/doc': Buffer.from('doc-bytes'), 'tid/photo': Buffer.from('photo-bytes') };
  const fetch = async (k: string): Promise<Buffer | null> => store[k] ?? null;

  it('verifies a representative object of every NON-EMPTY class and skips empty ones', async () => {
    const res = await verifyBlobRecovery(inv(), fetch);
    expect(res.verifiedClasses).toEqual(['document', 'photo']); // intake skipped (count 0)
  });

  it('FAILS if a class object is missing (unrecoverable)', async () => {
    const missing = { ...store };
    delete missing['tid/photo'];
    const f = async (k: string): Promise<Buffer | null> => missing[k] ?? null;
    await expect(verifyBlobRecovery(inv(), f)).rejects.toThrow(/photo object 'tid\/photo' is UNRECOVERABLE/);
  });

  it('FAILS if a class object is corrupt (hash mismatch)', async () => {
    const corrupt: Record<string, Buffer> = { ...store, 'tid/doc': Buffer.from('tampered') };
    const f = async (k: string): Promise<Buffer | null> => corrupt[k] ?? null;
    await expect(verifyBlobRecovery(inv(), f)).rejects.toThrow(/document object 'tid\/doc' hash mismatch/);
  });

  it('an all-empty inventory verifies nothing (no objects to recover)', async () => {
    const empty: ValidatedBlobInventory = {
      document: { count: 0, sample: null },
      photo: { count: 0, sample: null },
      intake: { count: 0, sample: null },
    };
    expect((await verifyBlobRecovery(empty, fetch)).verifiedClasses).toEqual([]);
  });
});
