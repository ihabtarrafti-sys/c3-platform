/**
 * exitManifest.test.ts — H-06: the erasure-authorizing manifest gate. A
 * hand-written, partial, wrong-tenant, wrong-schema, or stale manifest must NOT
 * authorize an irreversible tenant erasure.
 */
import { describe, expect, it } from 'vitest';
import { validateExitManifest, parseExitManifest, ManifestRejectedError, type ExitManifest, type ManifestCheckContext } from '../src/exitManifest';

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
});
