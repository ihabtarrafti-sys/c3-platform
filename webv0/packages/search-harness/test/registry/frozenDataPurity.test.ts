import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FROZEN_SUNSET_COVERAGE_MANIFEST,
  FROZEN_SUNSET_REGISTRY,
  hashSunsetTreeEntries,
  parseCanonicalFrozenJson,
  parseFrozenSunsetCoverageManifest,
  parseFrozenSunsetRegistry,
  listSunsetEnforcementTreeFiles,
  searchHarnessWebv0Root,
  SUNSET_FROZEN_DATA_FILES,
} from '../../src/registry';

describe('H0 frozen sunset data purity', () => {
  it('excludes only the two data-only JSON values from the enforcement tree', () => {
    expect(SUNSET_FROZEN_DATA_FILES).toEqual([
      'packages/search-harness/src/registry/frozenManifest.json',
      'packages/search-harness/src/registry/frozenCoverageManifest.json',
    ]);
    for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
      expect(relativePath.endsWith('.json')).toBe(true);
      const source = readFileSync(
        resolve(searchHarnessWebv0Root(), relativePath),
        'utf8',
      );
      expect(() =>
        parseCanonicalFrozenJson(source, relativePath),
      ).not.toThrow();
    }
    const enforcementFiles = listSunsetEnforcementTreeFiles();
    expect(enforcementFiles).toContain(
      'packages/search-harness/test/registry/fixtures/enforcement-probe.json',
    );
    for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
      expect(enforcementFiles).not.toContain(relativePath);
    }
  });

  it.each([
    ['import', 'import "./liveSnapshot.js"; export default {};'],
    ['call', '{"roles": buildLiveSunsetRegistrySnapshot()}'],
    ['control flow', '{"roles": true ? [] : ["owner"]}'],
    ['comment', '{"roles": [] /* silently weaken */}'],
  ])('RED: %s source cannot enter a frozen data file', (_name, source) => {
    expect(() => parseCanonicalFrozenJson(source, 'adversarial.json')).toThrow(
      /not valid JSON/u,
    );
  });

  it('RED: duplicate keys and non-canonical source cannot create ambiguous values', () => {
    expect(() =>
      parseCanonicalFrozenJson(
        '{"plannedCoverageOnly":false,"plannedCoverageOnly":true}\n',
        'duplicate.json',
      ),
    ).toThrow(/not canonical JSON/u);
    expect(() =>
      parseCanonicalFrozenJson('{"roles":[]}', 'compact.json'),
    ).toThrow(/not canonical JSON/u);
  });

  it('accepts Git-normalized LF or CRLF without weakening canonical structure', () => {
    const canonical = `${JSON.stringify({ roles: ['owner'] }, null, 2)}\n`;
    expect(parseCanonicalFrozenJson(canonical, 'lf.json')).toEqual({
      roles: ['owner'],
    });
    expect(
      parseCanonicalFrozenJson(
        canonical.replace(/\n/gu, '\r\n'),
        'crlf.json',
      ),
    ).toEqual({ roles: ['owner'] });
  });

  it('RED: length-framed tree hashing cannot merge or split NUL-bearing files', () => {
    const legacySingle = 'a\u0000x\u0000b\u0000y\u0000';
    const legacySplit = [
      'a',
      '\u0000',
      'x',
      '\u0000',
      'b',
      '\u0000',
      'y',
      '\u0000',
    ].join('');
    expect(legacySingle).toBe(legacySplit);

    expect(
      hashSunsetTreeEntries([
        { relativePath: 'a', content: 'x\u0000b\u0000y' },
      ]),
    ).not.toBe(
      hashSunsetTreeEntries([
        { relativePath: 'a', content: 'x' },
        { relativePath: 'b', content: 'y' },
      ]),
    );
  });

  it('canonicalizes LF, CRLF, and bare CR only for text fingerprints', () => {
    const textHash = (content: string | Uint8Array) =>
      hashSunsetTreeEntries([{ relativePath: 'example.txt', content }]);
    const lf = 'alpha\nbeta\n';
    const crlf = 'alpha\r\nbeta\r\n';
    const bareCr = 'alpha\rbeta\r';

    expect(textHash(crlf)).toBe(textHash(lf));
    expect(textHash(bareCr)).toBe(textHash(lf));
    expect(textHash('alpha\nchanged\n')).not.toBe(textHash(lf));

    const binaryHashes = [
      new Uint8Array([0x61, 0x0a, 0x62, 0x0a]),
      new Uint8Array([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]),
      new Uint8Array([0x61, 0x0d, 0x62, 0x0d]),
    ].map(textHash);
    expect(new Set(binaryHashes).size).toBe(binaryHashes.length);
  });

  it('RED: strict registry parsing rejects live-derivation directives and unknown fields', () => {
    expect(() =>
      parseFrozenSunsetRegistry({
        ...structuredClone(FROZEN_SUNSET_REGISTRY),
        deriveFromLive: 'buildLiveSunsetRegistrySnapshot',
      }),
    ).toThrow();
    expect(() =>
      parseFrozenSunsetRegistry({
        ...structuredClone(FROZEN_SUNSET_REGISTRY),
        criticalSourceFingerprints: {
          ...FROZEN_SUNSET_REGISTRY.criticalSourceFingerprints,
          'packages/search-harness#enforcement-tree': 'live-derived',
        },
      }),
    ).toThrow();
  });

  it('RED: strict coverage parsing rejects generated surfaces and shape drift', () => {
    expect(() =>
      parseFrozenSunsetCoverageManifest({
        ...structuredClone(FROZEN_SUNSET_COVERAGE_MANIFEST),
        surfaces: {
          ...structuredClone(FROZEN_SUNSET_COVERAGE_MANIFEST.surfaces),
          generatedFromLiveRegistry: {
            artifactVersion: 'live',
            entries: [],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseFrozenSunsetCoverageManifest({
        ...structuredClone(FROZEN_SUNSET_COVERAGE_MANIFEST),
        plannedCoverageOnly: 'derive-at-runtime',
      }),
    ).toThrow();
  });

  it('deep-freezes parsed manifests so runtime mutation cannot weaken checks', () => {
    expect(Object.isFrozen(FROZEN_SUNSET_REGISTRY)).toBe(true);
    expect(Object.isFrozen(FROZEN_SUNSET_REGISTRY.roles)).toBe(true);
    expect(Object.isFrozen(FROZEN_SUNSET_COVERAGE_MANIFEST)).toBe(true);
    expect(
      Object.isFrozen(
        FROZEN_SUNSET_COVERAGE_MANIFEST.surfaces.qrels.entries,
      ),
    ).toBe(true);
  });
});
