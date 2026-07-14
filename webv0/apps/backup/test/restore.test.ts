import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { disposableDbName, assertDisposableDbName, REQUIRED_FIXTURES, resolveExportTenant, verifyBlobRecovery, verifyBlobArchiveRecovery, strongSample, type Rng } from '../src/restore';
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

  it('round-2 no-silent-skip: a class WITH objects but a null sample FAILS (never skipped)', async () => {
    const gap: ValidatedBlobInventory = {
      document: { count: 5, sample: null }, // objects exist but nothing verifiable
      photo: { count: 0, sample: null },
      intake: { count: 0, sample: null },
    };
    await expect(verifyBlobRecovery(gap, fetch)).rejects.toThrow(/count-positive\/sample-null must NOT be skipped/i);
  });
});

describe('verifyBlobArchiveRecovery — H-08 Option A (recover from the independent copy)', () => {
  const inv = (): ValidatedBlobInventory => ({
    document: { count: 2, sample: { storageKey: 'tid/doc', sha256: sha('doc-bytes') } },
    photo: { count: 1, sample: { storageKey: 'tid/photo', sha256: sha('photo-bytes') } },
    intake: { count: 0, sample: null },
  });
  // R3-N06: the archive indexes the COMPLETE set (2 documents + 1 photo, matching inv()).
  const archive = () => ({
    key: 'daily/x.dump.age.blobs.age',
    sha256: sha('archive'),
    bytes: 123,
    entryCount: 3,
    entries: [
      { storageKey: 'tid/doc', sha256: sha('doc-bytes'), cls: 'document' as const },
      { storageKey: 'tid/doc2', sha256: sha('doc2-bytes'), cls: 'document' as const },
      { storageKey: 'tid/photo', sha256: sha('photo-bytes'), cls: 'photo' as const },
    ],
  });
  const fullStore = (): Record<string, Buffer> => ({
    'tid/doc': Buffer.from('doc-bytes'),
    'tid/doc2': Buffer.from('doc2-bytes'),
    'tid/photo': Buffer.from('photo-bytes'),
  });
  const extractOf = (store: Record<string, Buffer>) => async (k: string) => store[k] ?? null;

  it('recovers EVERY indexed object FROM THE ARCHIVE (complete index, live bucket untouched)', async () => {
    const res = await verifyBlobArchiveRecovery(inv(), archive(), extractOf(fullStore()));
    expect(res.verifiedClasses.sort()).toEqual(['document', 'photo']);
  });

  it('FAILS when an indexed object is missing from the archive', async () => {
    const store = fullStore();
    delete store['tid/doc2']; // indexed but unextractable
    await expect(verifyBlobArchiveRecovery(inv(), archive(), extractOf(store))).rejects.toThrow(/UNRECOVERABLE from the independent archive/);
  });

  it('FAILS on a hash mismatch in the archive', async () => {
    const store = fullStore();
    store['tid/doc2'] = Buffer.from('TAMPERED');
    await expect(verifyBlobArchiveRecovery(inv(), archive(), extractOf(store))).rejects.toThrow(/hash mismatch in archive/);
  });

  it('R3-N06 completeness: the archive index count must match the census — a short class FAILS', async () => {
    const invExtra: ValidatedBlobInventory = { ...inv(), intake: { count: 3, sample: { storageKey: 'x', sha256: sha('x') } } };
    await expect(verifyBlobArchiveRecovery(invExtra, archive(), extractOf(fullStore()))).rejects.toThrow(/intake — manifest inventory 3 != archive index 0/i);
  });
});

describe('R4-N12: the drill sampler is sound, deterministic, and injectable', () => {
  // A deterministic LCG in [0,1) so a drill can prove EXACTLY which entries it sha-checks.
  const seededRng = (seed: number): Rng => {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  };
  // 30 documents + 4 photos = 34 entries (> DRILL_SHA_SAMPLE of 25). Each object's bytes are
  // its own key, so sha(bytes) === entry.sha256; a "corruption" rewrites the bytes.
  const bigArchive = () => {
    const entries = [
      ...Array.from({ length: 30 }, (_v, i) => ({ storageKey: `tid/doc-${i}`, sha256: sha(`tid/doc-${i}`), cls: 'document' as const })),
      ...Array.from({ length: 4 }, (_v, i) => ({ storageKey: `tid/photo-${i}`, sha256: sha(`tid/photo-${i}`), cls: 'photo' as const })),
    ];
    return { key: 'daily/x.dump.age.blobs.age', sha256: sha('a'), bytes: 1, entryCount: entries.length, entries };
  };
  const bigInv = (): ValidatedBlobInventory => ({
    document: { count: 30, sample: { storageKey: 'tid/doc-0', sha256: sha('tid/doc-0') } },
    photo: { count: 4, sample: { storageKey: 'tid/photo-0', sha256: sha('tid/photo-0') } },
    intake: { count: 0, sample: null },
  });
  const storeOf = (a: ReturnType<typeof bigArchive>): Record<string, Buffer> =>
    Object.fromEntries(a.entries.map((e) => [e.storageKey, Buffer.from(e.storageKey)]));
  const extractOf = (store: Record<string, Buffer>) => async (k: string) => store[k] ?? null;

  it('is DETERMINISTIC under a seeded RNG (the old Math.random sort was not) and covers every class', () => {
    const a = bigArchive();
    const s1 = strongSample(a.entries, 25, seededRng(7)).map((e) => e.storageKey).sort();
    const s2 = strongSample(a.entries, 25, seededRng(7)).map((e) => e.storageKey).sort();
    expect(s1).toEqual(s2); // same seed → identical sample (RED on the non-injectable Math.random sort)
    expect(new Set(s1).size).toBe(s1.length); // without replacement — no key twice
    expect(s1.length).toBeGreaterThanOrEqual(25);
    const classes = new Set(strongSample(a.entries, 25, seededRng(7)).map((e) => e.cls));
    expect(classes).toContain('document');
    expect(classes).toContain('photo'); // every non-empty class represented
  });

  it('a sha-corruption INSIDE the sample is caught', async () => {
    const a = bigArchive();
    const sampled = new Set(strongSample(a.entries, 25, seededRng(7)).map((e) => e.storageKey));
    const inKey = [...sampled][0]!;
    const store = storeOf(a);
    store[inKey] = Buffer.from('CORRUPT'); // present but wrong bytes
    await expect(verifyBlobArchiveRecovery(bigInv(), a, extractOf(store), seededRng(7))).rejects.toThrow(/hash mismatch in archive/);
  });

  it('a MISSING object OUTSIDE the sample is still caught (full key presence, not just the sample)', async () => {
    const a = bigArchive();
    const sampled = new Set(strongSample(a.entries, 25, seededRng(7)).map((e) => e.storageKey));
    const outKey = a.entries.find((e) => !sampled.has(e.storageKey))!.storageKey;
    const store = storeOf(a);
    delete store[outKey]; // unextractable
    await expect(verifyBlobArchiveRecovery(bigInv(), a, extractOf(store), seededRng(7))).rejects.toThrow(/UNRECOVERABLE from the independent archive/);
  });

  it('a clean big archive passes (every object extracts; the sample hash-verifies)', async () => {
    const a = bigArchive();
    const res = await verifyBlobArchiveRecovery(bigInv(), a, extractOf(storeOf(a)), seededRng(7));
    expect(res.verifiedClasses.sort()).toEqual(['document', 'photo']);
  });

  // R5-N11: the stratified draw never EXCEEDS the ≤25 budget (the old forced-first-entry top-up
  // could push it to 26+), samples WITHIN each non-empty class, and every non-empty class is
  // represented by a genuinely random pick (not its first entry).
  it('R5-N11: is a stratified draw capped at the budget, every non-empty class represented', () => {
    // 30 docs + 4 photos + 6 intake = 40 entries (> 25). All three classes non-empty.
    const entries = [
      ...Array.from({ length: 30 }, (_v, i) => ({ storageKey: `tid/doc-${i}`, sha256: sha(`tid/doc-${i}`), cls: 'document' as const })),
      ...Array.from({ length: 4 }, (_v, i) => ({ storageKey: `tid/photo-${i}`, sha256: sha(`tid/photo-${i}`), cls: 'photo' as const })),
      ...Array.from({ length: 6 }, (_v, i) => ({ storageKey: `tid/intake-${i}`, sha256: sha(`tid/intake-${i}`), cls: 'intake' as const })),
    ];
    const s = strongSample(entries, 25, seededRng(3));
    expect(s.length).toBeLessThanOrEqual(25); // never over budget (RED on the old top-up)
    expect(s.length).toBe(25); // 40 entries → the budget is fully used
    expect(new Set(s.map((e) => e.storageKey)).size).toBe(s.length); // without replacement
    const byClass = new Set(s.map((e) => e.cls));
    expect(byClass).toEqual(new Set(['document', 'photo', 'intake'])); // every non-empty class present
    // The document class is under-quota (15 of 30), so WHICH 15 is a genuine random draw — not the
    // first 15 by position. Two different RNGs must produce different in-class picks (old code force-
    // added entry[0] of a missed class, a fixed index; here nothing is chosen by position).
    const seed3 = strongSample(entries, 25, seededRng(3)).filter((e) => e.cls === 'document').map((e) => e.storageKey).sort();
    const seed99 = strongSample(entries, 25, seededRng(99)).filter((e) => e.cls === 'document').map((e) => e.storageKey).sort();
    expect(seed3).not.toEqual(seed99); // different RNG → different in-class draw (no forced index)
  });

  it('R5-N11: a present-but-CORRUPT entry OUTSIDE the sample is ACCEPTED (the honest sampling contract)', async () => {
    const a = bigArchive();
    const sampled = new Set(strongSample(a.entries, 25, seededRng(7)).map((e) => e.storageKey));
    const outKey = a.entries.find((e) => !sampled.has(e.storageKey))!.storageKey;
    const store = storeOf(a);
    store[outKey] = Buffer.from('CORRUPT-BUT-PRESENT'); // wrong bytes, but the object still extracts
    // The drill sha-checks only the SAMPLE — an out-of-sample corruption is NOT caught. That is the
    // documented contract (a real recovery re-hashes everything for free while downloading it); we
    // assert it TRUTHFULLY rather than pretending the sample proves the whole archive's integrity.
    const res = await verifyBlobArchiveRecovery(bigInv(), a, extractOf(store), seededRng(7));
    expect(res.verifiedClasses.sort()).toEqual(['document', 'photo']);
  });

  // R5-N11 DISCRIMINATOR: the forced-first-entry BIAS itself. A tiny class (5 photos) swamped by a
  // huge one (400 docs): the old global 25-of-405 draw almost never hit a photo, so it force-added
  // photo-0 EVERY time — a fixed-index over-sample where photo-1..4 were essentially never checked.
  // The stratified draw gives photos a real quota and picks WITHIN the class, so every photo is
  // sampled. Assertion: across many seeds, non-first photos are sampled at least as often as photo-0.
  it('R5-N11: no forced-first-entry bias — a swamped small class is sampled uniformly, not always entry[0]', () => {
    const entries = [
      ...Array.from({ length: 400 }, (_v, i) => ({ storageKey: `tid/doc-${i}`, sha256: sha(`tid/doc-${i}`), cls: 'document' as const })),
      ...Array.from({ length: 5 }, (_v, i) => ({ storageKey: `tid/photo-${i}`, sha256: sha(`tid/photo-${i}`), cls: 'photo' as const })),
    ];
    let firstCount = 0;
    let otherCount = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const e of strongSample(entries, 25, seededRng(seed))) {
        if (e.cls !== 'photo') continue;
        if (e.storageKey === 'tid/photo-0') firstCount++; else otherCount++;
      }
    }
    // Stratified: photos get quota 5 (== class size) → all 5 sampled every seed (other=240, first=60).
    // Old forced-first-entry: photo-0 dominates, photo-1..4 near-zero → otherCount < firstCount (RED).
    expect(otherCount).toBeGreaterThan(firstCount);
  });
});
