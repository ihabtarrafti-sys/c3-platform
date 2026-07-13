/**
 * exitManifest.test.ts — H-06: the erasure-authorizing manifest gate. A
 * hand-written, partial, wrong-tenant, wrong-schema, or stale manifest must NOT
 * authorize an irreversible tenant erasure.
 */
import { describe, expect, it } from 'vitest';
import { validateExitManifest, parseExitManifest, verifyExitBundle, ManifestRejectedError, type ExitManifest, type ManifestCheckContext, type ExitBundleReader } from '../src/exitManifest';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';
const HEX = (c: string) => c.repeat(64);

function validManifest(overrides: Partial<ExitManifest> = {}): ExitManifest {
  return {
    tenant: { id: TENANT_ID, slug: 'alpha', name: 'Alpha Org' },
    exportedAt: new Date().toISOString(),
    schemaVersion: ['0001_schema.sql', '0046_blob_tombstone.sql'],
    files: [{ name: 'person.jsonl', rows: 2, sha256: HEX('a') }],
    blobs: [{ bundleName: 'documents/DOC-0001__c.pdf', blobClass: 'document', sha256: HEX('b'), ownerRef: 'DOC-0001' }],
    note: 'export',
    ...overrides,
  };
}

const ctx = (over: Partial<ManifestCheckContext> = {}): ManifestCheckContext => ({
  tenantSlug: 'alpha',
  liveTenantId: TENANT_ID,
  liveMigrations: ['0001_schema.sql', '0046_blob_tombstone.sql'],
  ...over,
});

describe('H-06 — exit manifest validation', () => {
  it('accepts a well-formed, matching, current, fresh manifest', () => {
    expect(() => validateExitManifest(validManifest(), ctx())).not.toThrow();
  });

  it('rejects a hand-written / partial manifest (structure)', () => {
    expect(() => validateExitManifest({ tenant: { slug: 'alpha' } }, ctx())).toThrow(ManifestRejectedError);
    expect(() => parseExitManifest({})).toThrow(/not a JSON object|tenant is missing/);
    // a file entry with a bad sha256
    expect(() => validateExitManifest(validManifest({ files: [{ name: 'p.jsonl', rows: 1, sha256: 'nope' }] }), ctx())).toThrow(/sha256/);
  });

  it('rejects a manifest for a different tenant (slug OR id)', () => {
    expect(() => validateExitManifest(validManifest({ tenant: { id: TENANT_ID, slug: 'bravo', name: 'B' } }), ctx())).toThrow(/not 'alpha'/);
    expect(() => validateExitManifest(validManifest(), ctx({ liveTenantId: '99999999-8888-7777-6666-555555555555' }))).toThrow(/does not match the live tenant/);
  });

  it('rejects a manifest taken on a different (older) schema — forces a re-export', () => {
    expect(() => validateExitManifest(validManifest({ schemaVersion: ['0001_schema.sql'] }), ctx())).toThrow(/does not match the live schema/);
  });

  it('rejects a stale manifest unless the stale override is set; refuses a future timestamp', () => {
    const old = validManifest({ exportedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    expect(() => validateExitManifest(old, ctx())).toThrow(/stale/);
    expect(() => validateExitManifest(old, ctx({ allowStale: true }))).not.toThrow();
    const future = validManifest({ exportedAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    expect(() => validateExitManifest(future, ctx())).toThrow(/future/);
  });

  it('H-06: a FUTURE timestamp is refused EVEN WITH --allow-stale (the two time checks are independent)', () => {
    const future = validManifest({ exportedAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    expect(() => validateExitManifest(future, ctx({ allowStale: true }))).toThrow(/future/);
  });

  it('H-06: a divergent history with the SAME length + tip is refused (exact migration array, not just count+tip)', () => {
    const live = ctx({ liveMigrations: ['0001_schema.sql', '0002_rls.sql', '0046_blob_tombstone.sql'] });
    const forked = validManifest({ schemaVersion: ['0001_schema.sql', '0099_forked.sql', '0046_blob_tombstone.sql'] });
    expect(() => validateExitManifest(forked, live)).toThrow(/does not match the live schema/);
  });
});

describe('H-06 — verifyExitBundle re-verifies the ACTUAL bundle at exit', () => {
  const m = validManifest(); // person.jsonl (rows 2, sha a) + documents/DOC-0001__c.pdf (sha b)
  const good = (): ExitBundleReader => ({
    listEntries: async () => ['person.jsonl', 'documents/DOC-0001__c.pdf'],
    sha256Of: async (n) => (n === 'person.jsonl' ? HEX('a') : n === 'documents/DOC-0001__c.pdf' ? HEX('b') : null),
    rowCountOf: async (n) => (n === 'person.jsonl' ? 2 : null),
  });

  it('accepts a real, complete, matching bundle', async () => {
    await expect(verifyExitBundle(m, good())).resolves.toBeUndefined();
  });
  it('rejects a MISSING file named in the manifest', async () => {
    await expect(verifyExitBundle(m, { ...good(), listEntries: async () => ['documents/DOC-0001__c.pdf'] })).rejects.toThrow(/MISSING 'person.jsonl'/);
  });
  it('rejects an UNLISTED extra file (manifest/bundle mismatch)', async () => {
    await expect(verifyExitBundle(m, { ...good(), listEntries: async () => ['person.jsonl', 'documents/DOC-0001__c.pdf', 'sneaky.jsonl'] })).rejects.toThrow(/UNLISTED file 'sneaky.jsonl'/);
  });
  it('rejects a file hash mismatch', async () => {
    await expect(verifyExitBundle(m, { ...good(), sha256Of: async (n) => (n === 'person.jsonl' ? HEX('f') : HEX('b')) })).rejects.toThrow(/hash mismatch/);
  });
  it('rejects a --no-doc-bytes bundle whose indexed blob is absent', async () => {
    await expect(
      verifyExitBundle(m, { listEntries: async () => ['person.jsonl'], sha256Of: async (n) => (n === 'person.jsonl' ? HEX('a') : null), rowCountOf: async () => 2 }),
    ).rejects.toThrow(/MISSING 'documents\/DOC-0001__c.pdf'|absent from the bundle/);
  });
  it('rejects a row-count mismatch', async () => {
    await expect(verifyExitBundle(m, { ...good(), rowCountOf: async () => 999 })).rejects.toThrow(/row count 999/);
  });
});
