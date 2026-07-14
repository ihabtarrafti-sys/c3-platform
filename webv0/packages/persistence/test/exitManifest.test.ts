/**
 * exitManifest.test.ts — H-06: the erasure-authorizing manifest gate. A
 * hand-written, partial, wrong-tenant, wrong-schema, or stale manifest must NOT
 * authorize an irreversible tenant erasure.
 */
import { describe, expect, it } from 'vitest';
import { validateExitManifest, parseExitManifest, verifyExitBundle, assertAuthorizingManifestPath, ManifestRejectedError, type ExitManifest, type ManifestCheckContext, type ExitBundleReader } from '../src/exitManifest';

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
    mode: 'full', // C1 (round-6 §4.2): the literal must be EXPLICITLY present — no default
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

// C1 (R5-N02, round-6 §4.2): authorization requires the EXPLICIT literal. The old parser
// normalized an ABSENT mode to 'full' — so deleting one field from a rows-only (diagnostic,
// non-authorizing) manifest made it authorizing. No normalization survives; and the CLI only
// accepts the canonical manifest.json filename, so the rows-only artifact is structurally
// unacceptable no matter which path an operator passes.
describe("C1 — exit authorization requires the explicit literal mode:'full'", () => {
  it("ROUND-6'S EXACT BYPASS: deleting the mode field from a rows-only manifest is REFUSED (no absent-mode normalization)", () => {
    // a current rows-only manifest: same tenant, same schema, real hashes — only the mode differs
    const rowsOnly = { ...validManifest(), mode: 'rows-only' } as Record<string, unknown>;
    delete rowsOnly.mode; // the one-field deletion that used to normalize to 'full'
    expect(() => parseExitManifest(rowsOnly)).toThrow(/EXPLICITLY 'full' or 'rows-only'/i);
    expect(() => validateExitManifest(rowsOnly, ctx())).toThrow(/EXPLICITLY 'full' or 'rows-only'/i);
  });

  it('a BLANK or unknown mode is refused (no coercion of any kind)', () => {
    expect(() => parseExitManifest({ ...validManifest(), mode: '' })).toThrow(/EXPLICITLY 'full' or 'rows-only'/i);
    expect(() => parseExitManifest({ ...validManifest(), mode: 'FULL' })).toThrow(/EXPLICITLY 'full' or 'rows-only'/i);
    expect(() => parseExitManifest({ ...validManifest(), mode: null })).toThrow(/EXPLICITLY 'full' or 'rows-only'/i);
  });

  it("the rows-only LITERAL is refused by the gate; the explicit 'full' literal passes", () => {
    expect(() => validateExitManifest(validManifest({ mode: 'rows-only' }), ctx())).toThrow(/rows-only|not 'full'/i);
    expect(() => validateExitManifest(validManifest({ mode: 'full' }), ctx())).not.toThrow();
  });

  it('--manifest accepts ONLY a file named manifest.json (the diagnostic artifact is refused by NAME, renamed paths included)', () => {
    expect(() => assertAuthorizingManifestPath('/exports/alpha/manifest.rows-only.json')).toThrow(/canonical manifest\.json/i);
    expect(() => assertAuthorizingManifestPath('C:\\exports\\alpha\\rows.json')).toThrow(/canonical manifest\.json/i);
    expect(() => assertAuthorizingManifestPath('/exports/alpha/manifest.json')).not.toThrow();
    expect(() => assertAuthorizingManifestPath('C:\\exports\\alpha\\manifest.json')).not.toThrow();
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
