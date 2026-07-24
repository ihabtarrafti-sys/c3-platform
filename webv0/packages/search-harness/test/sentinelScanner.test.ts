import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  REQUIRED_SENTINEL_ARTIFACT_KINDS,
  SentinelScanError,
  commitForbiddenSentinel,
  commitSentinelArtifactContent,
  createSentinelScanExpectation,
  scanHarnessArtifacts,
  scanSentinelArtifact,
  type ForbiddenSentinel,
  type SentinelArtifactExpectation,
  type SentinelArtifact,
  type SentinelArtifactKind,
  type SentinelScanExpectationInput,
  type SentinelScanFailureCode,
} from '../src/sentinelScanner.js';
import { canonicalSha256 } from '../src/canonical.js';

const sentinel: ForbiddenSentinel = {
  id: 'synthetic-pii-1',
  value: 'HEARTH-PII-9f2c@example.invalid',
  category: 'pii',
};

const cleanArtifacts = (): SentinelArtifact[] =>
  REQUIRED_SENTINEL_ARTIFACT_KINDS.map((kind) => ({
    kind,
    label: `${kind}.json`,
    content:
      kind === 'error'
        ? '{"message":"clean","stack":"Error: clean","type":"Error"}'
        : { status: 'clean', kind },
  }));

const qrelHearthReviewer = {
  authority: 'hearth',
  reviewerId: 'hearth-qrel-reviewer',
  signatureKeyId: 'hearth-qrel-key',
  detachedSignatureSha256: 'a'.repeat(64),
} as const;
const qrelNeuralReviewer = {
  authority: 'neural-security',
  reviewerId: 'neural-qrel-reviewer',
  signatureKeyId: 'neural-qrel-key',
  detachedSignatureSha256: 'b'.repeat(64),
} as const;
const registryHearthReviewer = {
  authority: 'hearth',
  reviewerId: 'hearth-registry-reviewer',
  signatureKeyId: 'hearth-registry-key',
  detachedSignatureSha256: 'c'.repeat(64),
} as const;
const registryNeuralReviewer = {
  authority: 'neural-security',
  reviewerId: 'neural-registry-reviewer',
  signatureKeyId: 'neural-registry-key',
  detachedSignatureSha256: 'd'.repeat(64),
} as const;

const corpusManifest = () => ({
  schemaVersion: 1 as const,
  manifestKind: 'hearth-search-corpus' as const,
  syntheticOnly: true as const,
  harnessVersion: 'harness-v1',
  generatorVersion: 'generator-v1',
  datasetVersion: 'dataset-v1',
  seedRunId: 'seed-run-1',
  tenantSlots: ['tenant-a', 'tenant-b'],
  sourceIdentities: [],
  canaryCounts: { forbidden_sentinel: 1 },
});

const qrelSet = (sentinelIds: readonly string[] = [sentinel.id]) => ({
  schemaVersion: 1 as const,
  qrelKind: 'hearth-search-qrels' as const,
  syntheticOnly: true as const,
  querySetVersion: 'qrels-v1',
  applicationPolicyDependencySha256: 'e'.repeat(64),
  migrationStateSha256: 'f'.repeat(64),
  cases: [
    {
      schemaVersion: 1 as const,
      queryCaseId: 'zero-forbidden-field',
      queryClass: 'zero_result' as const,
      query: 'zz',
      applicableProfiles: ['owner-active-current'],
      authoritativeRelevant: { 'owner-active-current': [] },
      forbiddenSources: { 'owner-active-current': [] },
      forbiddenSentinelIds: [...sentinelIds],
      rationale: 'Must never match forbidden synthetic fields.',
      adjudicators: [
        qrelHearthReviewer,
        qrelNeuralReviewer,
      ] as const,
    },
  ],
});

function reviewedRegistry(
  corpus: ReturnType<typeof corpusManifest>,
  qrels: ReturnType<typeof qrelSet>,
  sentinels: readonly ForbiddenSentinel[] = [sentinel],
) {
  const payload = {
    schemaVersion: 1 as const,
    registryKind: 'hearth-search-must-never-match' as const,
    syntheticOnly: true as const,
    registryVersion: 'must-never-match-v1',
    datasetVersion: corpus.datasetVersion,
    querySetVersion: qrels.querySetVersion,
    corpusManifestSha256: canonicalSha256(corpus),
    corpusCanaryCountsSha256: canonicalSha256(corpus.canaryCounts),
    qrelSetSha256: canonicalSha256(qrels),
    applicationPolicyDependencySha256:
      qrels.applicationPolicyDependencySha256,
    migrationStateSha256: qrels.migrationStateSha256,
    sentinels: sentinels.map((entry) => ({ ...entry })),
  };
  return {
    payload,
    review: {
      payloadSha256: canonicalSha256(payload),
      reviewers: [
        registryHearthReviewer,
        registryNeuralReviewer,
      ] as const,
    },
  };
}

function expectationInput(options: {
  readonly sentinels?: readonly ForbiddenSentinel[];
  readonly qrelSentinelIds?: readonly string[];
  readonly expectedArtifacts?: readonly SentinelArtifactExpectation[];
} = {}): SentinelScanExpectationInput {
  const corpus = corpusManifest();
  const sentinels = options.sentinels ?? [sentinel];
  const qrels = qrelSet(
    options.qrelSentinelIds ?? sentinels.map(({ id }) => id),
  );
  const registry = reviewedRegistry(corpus, qrels, sentinels);
  return {
    corpusManifest: corpus,
    qrelSet: qrels,
    mustNeverMatchRegistry: registry,
    committedCorpusManifestSha256: canonicalSha256(corpus),
    committedQrelSetSha256: canonicalSha256(qrels),
    committedMustNeverMatchRegistrySha256: canonicalSha256(registry),
    expectedArtifacts:
      options.expectedArtifacts ??
      cleanArtifacts().map(commitSentinelArtifactContent),
  };
}

const exactExpectation = () =>
  createSentinelScanExpectation(expectationInput());

function expectScanCode(
  action: () => unknown,
  code: SentinelScanFailureCode,
): SentinelScanError {
  try {
    action();
    throw new Error('expected sentinel scanner to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SentinelScanError);
    expect((error as SentinelScanError).code).toBe(code);
    return error as SentinelScanError;
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('forbidden-sentinel scanner', () => {
  it('attests all six required capture surfaces', () => {
    const expectation = exactExpectation();
    expect(
      scanHarnessArtifacts(cleanArtifacts(), expectation),
    ).toEqual({
      provenanceAssurance: 'structural-bindings-only',
      artifactCount: 6,
      sentinelCount: 1,
      coveredKinds: REQUIRED_SENTINEL_ARTIFACT_KINDS,
      scannedArtifacts: expectation.expectedArtifacts,
      sentinelInventorySha256: canonicalSha256([
        commitForbiddenSentinel(sentinel),
      ]),
      corpusManifestSha256: expectation.corpusManifestSha256,
      qrelSetSha256: expectation.qrelSetSha256,
      mustNeverMatchRegistrySha256:
        expectation.mustNeverMatchRegistrySha256,
    });
  });

  it.each(REQUIRED_SENTINEL_ARTIFACT_KINDS)(
    'RED: catches a raw sentinel in %s artifacts',
    (kind) => {
      const error = expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind, label: `${kind}.json`, content: `before ${sentinel.value} after` },
            [sentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
      expect(error.details).toMatchObject({
        artifactKind: kind,
        representation: 'raw',
        sentinelIdSha256: sha256Text(sentinel.id),
      });
    },
  );

  it.each(REQUIRED_SENTINEL_ARTIFACT_KINDS)(
    'RED: catches a percent-encoded sentinel in %s artifacts',
    (kind) => {
      const encoded = encodeURIComponent(sentinel.value);
      const error = expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind, label: `${kind}.json`, content: `url=${encoded}` },
            [sentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
      expect(error.details).toMatchObject({
        artifactKind: kind,
        representation: 'percent-encoded',
      });
    },
  );

  it('RED: catches fully and partially percent-encoded forms', () => {
    const fullyEncoded = [...Buffer.from(sentinel.value)]
      .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
      .join('');
    for (const content of [
      fullyEncoded,
      sentinel.value.replace('@', '%40'),
    ]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'trace', label: 'trace.json', content },
            [sentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
    }
  });

  it('RED: catches JSON-escaped sentinel values in structured artifacts', () => {
    const escapedSentinel: ForbiddenSentinel = {
      id: 'synthetic-json-escape',
      value: 'HEARTH"JSON\\PII_73f9',
      category: 'synthetic-leak',
    };
    const error = expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'response',
            label: 'response.json',
            content: { nested: { value: escapedSentinel.value } },
          },
          [escapedSentinel],
        ),
      'FORBIDDEN_SENTINEL_DETECTED',
    );
    expect(error.details.representation).toBe('json-escaped');
  });

  it('RED: catches Unicode-escaped, nested-JSON, triple-percent, and base64 forms', () => {
    const unicodeEscaped = [...sentinel.value]
      .map((character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
      )
      .join('');
    const triplePercentEncoded = encodeURIComponent(
      encodeURIComponent(encodeURIComponent(sentinel.value)),
    );
    const base64Encoded = Buffer.from(sentinel.value, 'utf8').toString(
      'base64',
    );
    const base64Container = Buffer.from(
      `before:${sentinel.value}:after`,
      'utf8',
    ).toString('base64');
    const nestedBase64 = Buffer.from(base64Encoded, 'utf8').toString(
      'base64',
    );
    const nulWrappedBase64 = Buffer.from(
      `prefix\u0000${sentinel.value}\u0000suffix`,
      'utf8',
    ).toString('base64');
    for (const content of [
      `{"value":"${unicodeEscaped}"}`,
      JSON.stringify({
        body: JSON.stringify({ value: unicodeEscaped }),
      }),
      triplePercentEncoded,
      base64Encoded,
      base64Container,
      encodeURIComponent(base64Encoded),
      nestedBase64,
      nulWrappedBase64,
    ]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'log', label: 'encoded-log.json', content },
            [sentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
    }
  });

  it('RED: catches UTF-16LE/BE base64, including bounded nested transforms', () => {
    const utf16Le = Buffer.from(sentinel.value, 'utf16le');
    const utf16Be = Buffer.from(utf16Le);
    utf16Be.swap16();
    const encodedForms = [
      utf16Le.toString('base64'),
      utf16Be.toString('base64'),
      encodeURIComponent(utf16Le.toString('base64')),
      Buffer.from(utf16Be.toString('base64'), 'utf8').toString('base64'),
    ];
    for (const content of encodedForms) {
      const error = expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'log', label: 'utf16-base64.log', content },
            [sentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
      expect(error.details.representation).toBe('base64');
    }

    const unicodeSentinel: ForbiddenSentinel = {
      id: 'synthetic-unicode-pii',
      value: '秘密漏洩禁止値八八四二',
      category: 'pii',
    };
    const unicodeLe = Buffer.from(unicodeSentinel.value, 'utf16le');
    const unicodeBe = Buffer.from(unicodeLe);
    unicodeBe.swap16();
    for (const bytes of [
      unicodeLe,
      unicodeBe,
      Buffer.concat([Buffer.from([0xff, 0xfe]), unicodeLe]),
      Buffer.concat([Buffer.from([0xfe, 0xff]), unicodeBe]),
    ]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            {
              kind: 'response',
              label: 'unicode-utf16-base64.json',
              content: bytes.toString('base64'),
            },
            [unicodeSentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
    }

    let overNested = utf16Le.toString('base64');
    for (let index = 0; index < 13; index += 1) {
      overNested = Buffer.from(overNested, 'utf8').toString('base64');
    }
    expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'trace',
            label: 'deep-utf16-base64.log',
            content: overNested,
          },
          [sentinel],
        ),
      'SENTINEL_ARTIFACT_UNSCANNABLE',
    );
  });

  it('RED: preserves prototype-named keys during deterministic serialization', () => {
    const content = JSON.parse(
      `{"__proto__":${JSON.stringify(sentinel.value)}}`,
    );
    expectScanCode(
      () =>
        scanSentinelArtifact(
          { kind: 'response', label: 'prototype-key.json', content },
          [sentinel],
        ),
      'FORBIDDEN_SENTINEL_DETECTED',
    );
  });

  it('RED: catches SQL-doubled quote rendering in EXPLAIN output', () => {
    const sqlSentinel: ForbiddenSentinel = {
      id: 'synthetic-plan-quote',
      value: "HEARTH'PLAN_73f9",
      category: 'synthetic-leak',
    };
    for (const content of [
      "Filter: (note = 'HEARTH''PLAN_73f9')",
      Buffer.from(
        "Filter: (note = 'HEARTH''PLAN_73f9')",
        'utf8',
      ).toString('base64'),
    ]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            {
              kind: 'explain',
              label: 'plan.json',
              content,
            },
            [sqlSentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
    }
  });

  it('RED: fails closed when percent nesting exceeds the normalization limit', () => {
    let encoded = sentinel.value;
    for (let index = 0; index < 13; index += 1) {
      encoded = encodeURIComponent(encoded);
    }
    expectScanCode(
      () =>
        scanSentinelArtifact(
          { kind: 'trace', label: 'deeply-encoded.txt', content: encoded },
          [sentinel],
        ),
      'SENTINEL_ARTIFACT_UNSCANNABLE',
    );
  });

  it('RED: requires Amendment 5 EXPLAIN and run-manifest coverage', () => {
    for (const omitted of ['explain', 'run-manifest'] as const) {
      const error = expectScanCode(
        () =>
          scanHarnessArtifacts(
            cleanArtifacts().filter((artifact) => artifact.kind !== omitted),
            exactExpectation(),
          ),
        'SENTINEL_ARTIFACT_MISSING',
      );
      expect(error.details.artifactKind).toBe(omitted);
    }
  });

  it('requires final serialized Error bytes and scans them completely', () => {
    for (const [label, content] of [
      [
        'captured-error.json',
        JSON.stringify({
          message: `failed: ${sentinel.value}`,
          stack: `Error: failed: ${sentinel.value}`,
          type: 'Error',
        }),
      ],
      [
        'captured-error-property.json',
        JSON.stringify({
          details: { query: sentinel.value },
          message: 'safe',
          stack: 'Error: safe',
          type: 'Error',
        }),
      ],
      [
        'captured-aggregate-error.json',
        JSON.stringify({
          aggregateErrors: [
            {
              message: sentinel.value,
              stack: `Error: ${sentinel.value}`,
              type: 'Error',
            },
          ],
          message: 'safe',
          stack: 'AggregateError: safe',
          type: 'AggregateError',
        }),
      ],
    ] as const) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'error', label, content },
            [sentinel],
          ),
        'FORBIDDEN_SENTINEL_DETECTED',
      );
    }
    for (const content of [
      new Error(`failed: ${sentinel.value}`),
      Object.assign(new Error('safe'), {
        details: { query: sentinel.value },
      }),
      new AggregateError([new Error(sentinel.value)], 'safe'),
    ]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'error', label: 'raw-error-object', content },
            [sentinel],
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      );
    }
    expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'run-manifest',
            label: 'run-manifest.json',
            content: new Date(),
          },
          [sentinel],
        ),
      'SENTINEL_ARTIFACT_UNSCANNABLE',
    );
  });

  it('RED: rejects accessors, cycles, compressed bytes, invalid UTF-8, and UTF-16', () => {
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => sentinel.value,
    });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get: () => sentinel.value,
    });
    Object.defineProperty(accessorArray, 'length', { value: 1 });
    const customArray = [0];
    Object.defineProperty(customArray, 'toJSON', {
      value: () => [sentinel.value],
    });
    for (const content of [
      accessor,
      cycle,
      accessorArray,
      customArray,
      gzipSync(sentinel.value),
      Uint8Array.from([0xff, 0xfe, 0xfd]),
      Buffer.from(sentinel.value, 'utf16le'),
    ]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'response', label: 'unscannable.bin', content },
            [sentinel],
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      );
    }
  });

  it('RED: rejects Array subclasses and inherited custom serializers', () => {
    class LeakyArray extends Array<unknown> {
      toJSON() {
        return [sentinel.value];
      }
    }
    const subclass = new LeakyArray();
    subclass.push('safe-dense-entry');
    const customPrototype = ['safe-dense-entry'];
    Object.setPrototypeOf(customPrototype, {
      toJSON: () => [sentinel.value],
    });
    const proxyTarget = ['safe-dense-entry'];
    Object.defineProperty(proxyTarget, 'hiddenSecret', {
      configurable: true,
      enumerable: true,
      value: sentinel.value,
    });
    const hidingProxy = new Proxy(proxyTarget, {
      ownKeys: () => ['0', 'length'],
      getOwnPropertyDescriptor: (target, property) =>
        Reflect.getOwnPropertyDescriptor(target, property),
    });

    for (const content of [subclass, customPrototype, hidingProxy]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'response', label: 'leaky-array.json', content },
            [sentinel],
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      );
    }
  });

  it('RED: never invokes own or inherited Error field getters', () => {
    let getterReads = 0;
    class GetterError extends Error {}
    Object.defineProperty(GetterError.prototype, 'message', {
      configurable: true,
      get: () => {
        getterReads += 1;
        return sentinel.value;
      },
    });
    const inheritedGetter = new GetterError();
    const ownGetter = new Error('safe');
    Object.defineProperty(ownGetter, 'stack', {
      configurable: true,
      get: () => {
        getterReads += 1;
        return sentinel.value;
      },
    });

    for (const content of [inheritedGetter, ownGetter]) {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            { kind: 'error', label: 'getter-error.json', content },
            [sentinel],
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      );
    }
    expect(getterReads).toBe(0);
  });

  it('RED: rejects custom Error subclasses with inherited data fields', () => {
    class InheritedDataError extends Error {}
    Object.defineProperty(InheritedDataError.prototype, 'message', {
      configurable: true,
      value: sentinel.value,
    });
    const content = new InheritedDataError();
    Object.defineProperty(content, 'stack', {
      configurable: true,
      value: 'Error: safe',
    });

    expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'error',
            label: 'inherited-data-error.json',
            content,
          },
          [sentinel],
        ),
      'SENTINEL_ARTIFACT_UNSCANNABLE',
    );
  });

  it('RED: requires final bytes for serializer-visible Error prototype fields', () => {
    const inheritedKey = 'hearthInheritedLeak';
    const priorInherited = Object.getOwnPropertyDescriptor(
      Error.prototype,
      inheritedKey,
    );
    const priorCause = Object.getOwnPropertyDescriptor(
      Error.prototype,
      'cause',
    );
    const priorConstructor = Object.getOwnPropertyDescriptor(
      Error.prototype,
      'constructor',
    );
    const poisonedConstructor = function PoisonedErrorConstructor() {};
    Object.defineProperty(poisonedConstructor, 'name', {
      configurable: true,
      value: sentinel.value,
    });
    Object.defineProperties(Error.prototype, {
      [inheritedKey]: {
        configurable: true,
        enumerable: true,
        value: sentinel.value,
      },
      cause: {
        configurable: true,
        value: new Error(sentinel.value),
      },
      constructor: {
        configurable: true,
        value: poisonedConstructor,
        writable: true,
      },
    });
    try {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            {
              kind: 'error',
              label: 'raw-prototype-poisoned-error',
              content: new Error('safe'),
            },
            [sentinel],
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      );
    } finally {
      for (const [key, descriptor] of [
        [inheritedKey, priorInherited],
        ['cause', priorCause],
        ['constructor', priorConstructor],
      ] as const) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(Error.prototype, key);
        } else {
          Object.defineProperty(Error.prototype, key, descriptor);
        }
      }
    }
  });

  it('RED: rejects Object.prototype serializer pollution', () => {
    const prior = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toJSON',
    );
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value: () => ({ secret: sentinel.value }),
    });
    try {
      expectScanCode(
        () =>
          scanSentinelArtifact(
            {
              kind: 'error',
              label: 'prototype-pollution.json',
              content: { safe: true },
            },
            [sentinel],
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      );
    } finally {
      if (prior === undefined) {
        Reflect.deleteProperty(Object.prototype, 'toJSON');
      } else {
        Object.defineProperty(Object.prototype, 'toJSON', prior);
      }
    }
  });

  it('RED: scans safe artifact labels and never returns a sentinel label', () => {
    const labelSentinel: ForbiddenSentinel = {
      id: 'synthetic-label',
      value: 'HEARTH-SAFE-LABEL-9f2c',
      category: 'synthetic-leak',
    };
    const error = expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'log',
            label: labelSentinel.value,
            content: 'clean',
          },
          [labelSentinel],
        ),
      'FORBIDDEN_SENTINEL_DETECTED',
    );
    expect(JSON.stringify(error.details)).not.toContain(labelSentinel.value);
  });

  it('RED: rejects custom Error serialization until final bytes are captured', () => {
    class PrivateError extends Error {
      readonly #secret: string;

      constructor(secret: string) {
        super('safe');
        this.#secret = secret;
      }

      toJSON() {
        return { secret: this.#secret };
      }
    }
    expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'error',
            label: 'custom-error',
            content: new PrivateError(sentinel.value),
          },
          [sentinel],
        ),
      'SENTINEL_ARTIFACT_UNSCANNABLE',
    );
  });

  it('rejects weak or duplicate sentinel inventories', () => {
    expectScanCode(
      () =>
        scanSentinelArtifact(
          { kind: 'log', label: 'log.json', content: '' },
          [{ id: 'short', value: 'tiny' }],
        ),
      'SENTINEL_INVENTORY_INVALID',
    );
    const duplicateValue: ForbiddenSentinel = {
      id: 'synthetic-pii-duplicate',
      value: sentinel.value,
      category: 'pii',
    };
    expectScanCode(
      () =>
        createSentinelScanExpectation(
          expectationInput({
            sentinels: [sentinel, duplicateValue],
            qrelSentinelIds: [sentinel.id, duplicateValue.id],
          }),
        ),
      'SENTINEL_INVENTORY_INVALID',
    );
  });

  it('RED: reconciles the exact sentinel and artifact inventories', () => {
    const omittedSentinel: ForbiddenSentinel = {
      id: 'omitted-sentinel',
      value: 'HEARTH-OMITTED-SENTINEL-7f31',
      category: 'synthetic-leak',
    };
    expectScanCode(
      () =>
        createSentinelScanExpectation(
          expectationInput({
            sentinels: [sentinel, omittedSentinel],
            qrelSentinelIds: [sentinel.id],
          }),
        ),
      'SENTINEL_INVENTORY_MISMATCH',
    );
    expectScanCode(
      () =>
        scanHarnessArtifacts(
          [
            ...cleanArtifacts(),
            {
              kind: 'explain',
              label: 'unlisted-plan.json',
              content: { plan: 'clean' },
            },
          ],
          exactExpectation(),
        ),
      'SENTINEL_ARTIFACT_SET_MISMATCH',
    );
    const expectationWithMissingPlan = createSentinelScanExpectation(
      expectationInput({
        expectedArtifacts: [
          ...cleanArtifacts().map(commitSentinelArtifactContent),
          {
            kind: 'explain',
            label: 'missing-plan.json',
            contentSha256: 'a'.repeat(64),
            byteLength: 1,
          },
        ],
      }),
    );
    expectScanCode(
      () =>
        scanHarnessArtifacts(
          cleanArtifacts(),
          expectationWithMissingPlan,
        ),
      'SENTINEL_ARTIFACT_SET_MISMATCH',
    );
  });

  it('RED: derives sentinels from structurally pinned artifacts and rejects drift', () => {
    const secondSentinel: ForbiddenSentinel = {
      id: 'synthetic-account-2',
      value: 'HEARTH-ACCOUNT-8842-DO-NOT-MATCH',
      category: 'account-data',
    };
    const captured = cleanArtifacts().map((artifact) =>
      artifact.kind === 'log'
        ? { ...artifact, content: `log=${secondSentinel.value}` }
        : artifact,
    );
    const expectation = createSentinelScanExpectation(
      expectationInput({
        sentinels: [sentinel, secondSentinel],
        expectedArtifacts: captured.map(commitSentinelArtifactContent),
      }),
    );
    expectScanCode(
      () => scanHarnessArtifacts(captured, expectation),
      'FORBIDDEN_SENTINEL_DETECTED',
    );

    const corpus = corpusManifest();
    const fullQrels = qrelSet([sentinel.id, secondSentinel.id]);
    const fullRegistry = reviewedRegistry(
      corpus,
      fullQrels,
      [sentinel, secondSentinel],
    );
    const omittedQrels = qrelSet([sentinel.id]);
    const omittedRegistry = reviewedRegistry(
      corpus,
      omittedQrels,
      [sentinel],
    );
    expectScanCode(
      () =>
        createSentinelScanExpectation({
          corpusManifest: corpus,
          qrelSet: omittedQrels,
          mustNeverMatchRegistry: omittedRegistry,
          committedCorpusManifestSha256: canonicalSha256(corpus),
          committedQrelSetSha256: canonicalSha256(fullQrels),
          committedMustNeverMatchRegistrySha256:
            canonicalSha256(fullRegistry),
          expectedArtifacts:
            cleanArtifacts().map(commitSentinelArtifactContent),
        }),
      'SENTINEL_EXPECTATION_INVALID',
    );

    expectScanCode(
      () =>
        scanHarnessArtifacts(cleanArtifacts(), {
          ...exactExpectation(),
        }),
      'SENTINEL_EXPECTATION_INVALID',
    );
  });

  it('RED: refuses clean placeholder bytes under a correctly inventoried label', () => {
    const captured = cleanArtifacts();
    const substituted = captured.map((artifact) =>
      artifact.kind === 'response'
        ? { ...artifact, content: { status: 'different-clean-placeholder' } }
        : artifact,
    );
    expectScanCode(
      () =>
        scanHarnessArtifacts(
          substituted,
          createSentinelScanExpectation(
            expectationInput({
              expectedArtifacts:
                captured.map(commitSentinelArtifactContent),
            }),
          ),
        ),
      'SENTINEL_ARTIFACT_CONTENT_MISMATCH',
    );
  });

  it('RED: binds sentinel values to the committed registry artifact', () => {
    const substituted: ForbiddenSentinel = {
      ...sentinel,
      value: 'SAFE-SUBSTITUTED-SENTINEL-VALUE',
    };
    const original = expectationInput();
    const corpus = corpusManifest();
    const qrels = qrelSet();
    const substitutedRegistry = reviewedRegistry(
      corpus,
      qrels,
      [substituted],
    );
    expectScanCode(
      () =>
        createSentinelScanExpectation({
          ...original,
          corpusManifest: corpus,
          qrelSet: qrels,
          mustNeverMatchRegistry: substitutedRegistry,
        }),
      'SENTINEL_EXPECTATION_INVALID',
    );
  });

  it('RED: rejects unknown runtime artifact kinds without reflecting them', () => {
    const unknownKind = sentinel.value;
    const injected = {
      kind: unknownKind as SentinelArtifactKind,
      label: 'unknown.json',
      content: { status: 'clean' },
    };
    const actions: ReadonlyArray<
      readonly [() => unknown, SentinelScanFailureCode]
    > = [
      [
        () => scanSentinelArtifact(injected, [sentinel]),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      ],
      [
        () => commitSentinelArtifactContent(injected),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      ],
      [
        () =>
          scanHarnessArtifacts(
            [...cleanArtifacts(), injected],
            exactExpectation(),
          ),
        'SENTINEL_ARTIFACT_UNSCANNABLE',
      ],
      [
        () =>
          createSentinelScanExpectation(
            expectationInput({
              expectedArtifacts: [
                ...cleanArtifacts().map(commitSentinelArtifactContent),
                {
                  kind: unknownKind as SentinelArtifactKind,
                  label: injected.label,
                  contentSha256: 'a'.repeat(64),
                  byteLength: 1,
                },
              ],
            }),
          ),
        'SENTINEL_EXPECTATION_INVALID',
      ],
    ];

    for (const [action, code] of actions) {
      const error = expectScanCode(action, code);
      expect(JSON.stringify(error)).not.toContain(unknownKind);
    }
  });

  it('RED: never reflects a sentinel-bearing inventory ID in errors', () => {
    const sentinelIdEqualsValue: ForbiddenSentinel = {
      id: 'HEARTH-ID-SECRET',
      value: 'HEARTH-ID-SECRET',
      category: 'synthetic-leak',
    };
    const error = expectScanCode(
      () =>
        scanSentinelArtifact(
          {
            kind: 'error',
            label: 'error.json',
            content: sentinelIdEqualsValue.value,
          },
          [sentinelIdEqualsValue],
        ),
      'FORBIDDEN_SENTINEL_DETECTED',
    );
    expect(error.details).toMatchObject({
      sentinelIdSha256: sha256Text(sentinelIdEqualsValue.id),
    });
    expect(JSON.stringify(error)).not.toContain(sentinelIdEqualsValue.value);
  });

  it('exports the exact required surface vocabulary', () => {
    const kinds: readonly SentinelArtifactKind[] =
      REQUIRED_SENTINEL_ARTIFACT_KINDS;
    expect(kinds).toEqual([
      'response',
      'error',
      'log',
      'trace',
      'explain',
      'run-manifest',
    ]);
  });
});
