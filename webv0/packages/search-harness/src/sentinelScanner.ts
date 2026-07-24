import { createHash } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';
import { z } from 'zod';
import { canonicalJson, canonicalSha256 } from './canonical.js';
import { HearthHarnessError } from './errors.js';
import {
  CorpusManifestV1Schema,
  ReviewerSignatureV1Schema,
  SearchQrelSetV1Schema,
} from './schemas.js';

export const REQUIRED_SENTINEL_ARTIFACT_KINDS = [
  'response',
  'error',
  'log',
  'trace',
  'explain',
  'run-manifest',
] as const;

export type SentinelArtifactKind =
  (typeof REQUIRED_SENTINEL_ARTIFACT_KINDS)[number];

export interface ForbiddenSentinel {
  readonly id: string;
  readonly value: string;
  readonly category?:
    | 'account-data'
    | 'free-form-content'
    | 'money'
    | 'object-key'
    | 'pii'
    | 'synthetic-leak';
}

export interface SentinelArtifact {
  readonly kind: SentinelArtifactKind;
  readonly label: string;
  /**
   * Complete final serialized bytes for one logical capture. H2 collectors
   * must concatenate transport/logger chunks before constructing an artifact;
   * chunk fragments are not independently certifiable inputs.
   */
  readonly content: unknown;
}

export interface SentinelArtifactExpectation {
  readonly kind: SentinelArtifactKind;
  readonly label: string;
  readonly contentSha256: string;
  readonly byteLength: number;
}

export interface ForbiddenSentinelExpectation {
  readonly id: string;
  readonly valueSha256: string;
  readonly category: NonNullable<ForbiddenSentinel['category']> | null;
}

export interface SentinelScanExpectationInput {
  readonly corpusManifest: unknown;
  readonly qrelSet: unknown;
  readonly mustNeverMatchRegistry: unknown;
  /**
   * H0 verifies these structural bindings but cannot authenticate their
   * external origin: H1 must source them from verified signed artifacts.
   * Recomputing them from co-drifted objects at this call site does not
   * establish an independent trust boundary.
   */
  readonly committedCorpusManifestSha256: string;
  readonly committedQrelSetSha256: string;
  readonly committedMustNeverMatchRegistrySha256: string;
  /** Exact capture inventory, including every captured EXPLAIN. */
  readonly expectedArtifacts: readonly SentinelArtifactExpectation[];
}

export interface SentinelScanExpectation {
  readonly provenanceAssurance: 'structural-bindings-only';
  readonly expectedArtifacts: readonly SentinelArtifactExpectation[];
  readonly corpusManifestSha256: string;
  readonly qrelSetSha256: string;
  readonly mustNeverMatchRegistrySha256: string;
  readonly sentinelInventorySha256: string;
}

export type SentinelScanFailureCode =
  | 'FORBIDDEN_SENTINEL_DETECTED'
  | 'SENTINEL_ARTIFACT_MISSING'
  | 'SENTINEL_ARTIFACT_CONTENT_MISMATCH'
  | 'SENTINEL_ARTIFACT_SET_MISMATCH'
  | 'SENTINEL_ARTIFACT_UNSCANNABLE'
  | 'SENTINEL_EXPECTATION_INVALID'
  | 'SENTINEL_INVENTORY_INVALID'
  | 'SENTINEL_INVENTORY_MISMATCH';

export class SentinelScanError extends HearthHarnessError<SentinelScanFailureCode> {
  constructor(
    code: SentinelScanFailureCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, details);
  }
}

export interface SentinelScanAttestation {
  readonly provenanceAssurance: 'structural-bindings-only';
  readonly artifactCount: number;
  readonly sentinelCount: number;
  readonly coveredKinds: readonly SentinelArtifactKind[];
  readonly scannedArtifacts: readonly SentinelArtifactExpectation[];
  readonly sentinelInventorySha256: string;
  readonly corpusManifestSha256: string;
  readonly qrelSetSha256: string;
  readonly mustNeverMatchRegistrySha256: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_NORMALIZATION_DEPTH = 16;
const MAX_ENCODING_TRANSFORM_DEPTH = 12;
const MAX_ENCODING_VARIANTS = 4_096;
const trustedSentinelScanExpectations = new WeakSet<object>();

const sentinelCategorySchema = z.enum([
  'account-data',
  'free-form-content',
  'money',
  'object-key',
  'pii',
  'synthetic-leak',
]);
const forbiddenSentinelSchema = z
  .object({
    id: z.string().min(1).max(160).refine((value) => value === value.trim()),
    value: z.string().min(8).max(16_384),
    category: sentinelCategorySchema.optional(),
  })
  .strict();
const artifactExpectationSchema = z
  .object({
    kind: z.enum(REQUIRED_SENTINEL_ARTIFACT_KINDS),
    label: z.string(),
    contentSha256: z.string().regex(SHA256_HEX),
    byteLength: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  })
  .strict();
const reviewerSignaturePairSchema = z
  .tuple([ReviewerSignatureV1Schema, ReviewerSignatureV1Schema])
  .superRefine((reviewers, context) => {
    const authorities = new Set(reviewers.map(({ authority }) => authority));
    if (
      authorities.size !== 2 ||
      !authorities.has('hearth') ||
      !authorities.has('neural-security') ||
      reviewers[0].reviewerId === reviewers[1].reviewerId ||
      reviewers[0].signatureKeyId === reviewers[1].signatureKeyId ||
      reviewers[0].detachedSignatureSha256 ===
        reviewers[1].detachedSignatureSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'must-never-match registry requires distinct Hearth and Neural/security review commitments',
      });
    }
  });

export const MustNeverMatchRegistryPayloadV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    registryKind: z.literal('hearth-search-must-never-match'),
    syntheticOnly: z.literal(true),
    registryVersion: z.string().min(1).max(128),
    datasetVersion: z.string().min(1).max(128),
    querySetVersion: z.string().min(1).max(128),
    corpusManifestSha256: z.string().regex(SHA256_HEX),
    corpusCanaryCountsSha256: z.string().regex(SHA256_HEX),
    qrelSetSha256: z.string().regex(SHA256_HEX),
    applicationPolicyDependencySha256: z.string().regex(SHA256_HEX),
    migrationStateSha256: z.string().regex(SHA256_HEX),
    sentinels: z.array(forbiddenSentinelSchema).min(1),
  })
  .strict();

export const MustNeverMatchRegistryEnvelopeV1Schema = z
  .object({
    payload: MustNeverMatchRegistryPayloadV1Schema,
    review: z
      .object({
        payloadSha256: z.string().regex(SHA256_HEX),
        reviewers: reviewerSignaturePairSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((registry, context) => {
    if (
      registry.review.payloadSha256 !== canonicalSha256(registry.payload)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['review', 'payloadSha256'],
        message: 'reviewed payload commitment does not match registry payload',
      });
    }
  });

export type MustNeverMatchRegistryPayloadV1 = z.infer<
  typeof MustNeverMatchRegistryPayloadV1Schema
>;
export type MustNeverMatchRegistryEnvelopeV1 = z.infer<
  typeof MustNeverMatchRegistryEnvelopeV1Schema
>;

function isSentinelArtifactKind(
  value: unknown,
): value is SentinelArtifactKind {
  return (
    typeof value === 'string' &&
    (REQUIRED_SENTINEL_ARTIFACT_KINDS as readonly string[]).includes(value)
  );
}

function requireSentinelArtifactKind(
  value: unknown,
  code:
    | 'SENTINEL_ARTIFACT_SET_MISMATCH'
    | 'SENTINEL_ARTIFACT_UNSCANNABLE',
): SentinelArtifactKind {
  if (!isSentinelArtifactKind(value)) {
    const invalidKind =
      typeof value === 'string' ? value : typeof value;
    throw new SentinelScanError(
      code,
      'Harness artifact kind is outside the closed capture-surface vocabulary',
      {
        artifactKindSha256: createHash('sha256')
          .update(invalidKind)
          .digest('hex'),
      },
    );
  }
  return value;
}

function normalizedValue(
  value: unknown,
  seen: Set<object>,
  depth: number,
): unknown {
  if (depth > MAX_NORMALIZATION_DEPTH) {
    throw new Error('artifact nesting exceeds the scanner limit');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error('artifact contains a non-serializable value');
  }
  if (nodeUtilTypes.isProxy(value)) {
    throw new Error('artifact proxies cannot be reflected safely');
  }
  if (seen.has(value)) {
    throw new Error('artifact contains a cycle');
  }
  seen.add(value);
  try {
    if (value instanceof Uint8Array) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(value);
      if (decoded.includes('\u0000')) {
        throw new Error('artifact byte encoding is not normalized UTF-8');
      }
      return decoded;
    }
    if (nodeUtilTypes.isNativeError(value)) {
      throw new Error(
        'artifact Error objects require final serialized text or bytes',
      );
    }
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        'toJSON' in value
      ) {
        throw new Error(
          'artifact arrays require the intrinsic Array prototype and serializer',
        );
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(descriptors);
      if (
        keys.length !== value.length + 1 ||
        !Object.hasOwn(descriptors, 'length')
      ) {
        throw new Error(
          'artifact arrays must be dense and contain no extra properties',
        );
      }
      const normalized: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          'get' in descriptor ||
          'set' in descriptor
        ) {
          throw new Error(
            'artifact arrays require dense data-property entries',
          );
        }
        normalized.push(
          normalizedValue(descriptor.value, seen, depth + 1),
        );
      }
      return normalized;
    }
    const valuePrototype = Object.getPrototypeOf(value);
    if (
      valuePrototype !== Object.prototype &&
      valuePrototype !== null
    ) {
      throw new Error('artifact object has an unsupported prototype');
    }
    if ('toJSON' in value) {
      throw new Error(
        'custom or inherited serialization must be scanned as final captured bytes',
      );
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('artifact contains symbol-keyed data');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const normalized: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key]!;
      if ('get' in descriptor || 'set' in descriptor) {
        throw new Error('artifact contains an accessor');
      }
      normalized[key] = normalizedValue(
        descriptor.value,
        seen,
        depth + 1,
      );
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

function artifactText(artifact: SentinelArtifact): string {
  try {
    const normalized = normalizedValue(artifact.content, new Set(), 0);
    if (artifact.kind === 'error' && typeof normalized !== 'string') {
      throw new Error(
        'error artifacts require final serialized text or bytes',
      );
    }
    const text =
      typeof normalized === 'string' ? normalized : canonicalJson(normalized);
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (
      byteLength > MAX_ARTIFACT_BYTES ||
      text.includes('\u0000')
    ) {
      throw new Error('artifact is oversized or not normalized UTF-8 text');
    }
    return text;
  } catch {
    throw new SentinelScanError(
      'SENTINEL_ARTIFACT_UNSCANNABLE',
      'Harness artifact cannot be deterministically serialized for scanning',
      {
        artifactKind: artifact.kind,
        artifactLabelSha256: createHash('sha256')
          .update(artifact.label)
          .digest('hex'),
      },
    );
  }
}

function validArtifactLabel(label: string): boolean {
  return (
    label.length > 0 &&
    label.length <= 256 &&
    label === label.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(label)
  );
}

export function commitSentinelArtifactContent(
  artifact: SentinelArtifact,
): SentinelArtifactExpectation {
  const kind = requireSentinelArtifactKind(
    artifact.kind,
    'SENTINEL_ARTIFACT_UNSCANNABLE',
  );
  if (
    !validArtifactLabel(artifact.label)
  ) {
    throw new SentinelScanError(
      'SENTINEL_ARTIFACT_UNSCANNABLE',
      'Harness artifact requires a non-blank trimmed label',
      { artifactKind: artifact.kind },
    );
  }
  const text = artifactText(artifact);
  return Object.freeze({
    kind,
    label: artifact.label,
    contentSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    byteLength: Buffer.byteLength(text, 'utf8'),
  });
}

export function commitForbiddenSentinel(
  sentinel: ForbiddenSentinel,
): ForbiddenSentinelExpectation {
  return Object.freeze({
    id: sentinel.id,
    valueSha256: createHash('sha256')
      .update(sentinel.value, 'utf8')
      .digest('hex'),
    category: sentinel.category ?? null,
  });
}

function tolerantPercentDecode(value: string): string {
  return value.replace(/(?:%[a-f0-9]{2})+/giu, (encodedRun) => {
    const bytes = encodedRun
      .split('%')
      .filter((part) => part.length > 0)
      .map((part) => Number.parseInt(part, 16));
    return Buffer.from(bytes).toString('utf8');
  });
}

function validateInventory(
  sentinels: readonly ForbiddenSentinel[],
): readonly ForbiddenSentinel[] {
  if (sentinels.length === 0) {
    throw new SentinelScanError(
      'SENTINEL_INVENTORY_INVALID',
      'Sentinel inventory must be non-empty',
    );
  }
  const ids = new Set<string>();
  const values = new Set<string>();
  for (const sentinel of sentinels) {
    if (
      sentinel.id.trim().length === 0 ||
      sentinel.id !== sentinel.id.trim() ||
      sentinel.value.length < 8
    ) {
      throw new SentinelScanError(
        'SENTINEL_INVENTORY_INVALID',
        'Sentinel inventory contains a blank ID or a value shorter than 8 characters',
      );
    }
    if (ids.has(sentinel.id) || values.has(sentinel.value)) {
      throw new SentinelScanError(
        'SENTINEL_INVENTORY_INVALID',
        'Sentinel inventory contains a duplicate ID or value',
      );
    }
    ids.add(sentinel.id);
    values.add(sentinel.value);
  }
  return sentinels;
}

function artifactKey(
  artifact: SentinelArtifact | SentinelArtifactExpectation,
): string {
  return JSON.stringify([artifact.kind, artifact.label]);
}

function validateExpectedArtifacts(
  expectedArtifacts: readonly SentinelArtifactExpectation[],
): void {
  const expectedArtifactKeys = new Set(
    expectedArtifacts.map((artifact) => {
      requireSentinelArtifactKind(
        artifact.kind,
        'SENTINEL_ARTIFACT_SET_MISMATCH',
      );
      return artifactKey(artifact);
    }),
  );
  if (
    expectedArtifacts.length === 0 ||
    expectedArtifactKeys.size !== expectedArtifacts.length ||
    expectedArtifacts.some(
      ({ label, contentSha256, byteLength }) =>
        !validArtifactLabel(label) ||
        !SHA256_HEX.test(contentSha256) ||
        !Number.isSafeInteger(byteLength) ||
        byteLength < 0 ||
        byteLength > MAX_ARTIFACT_BYTES,
    )
  ) {
    throw new SentinelScanError(
      'SENTINEL_ARTIFACT_SET_MISMATCH',
      'Expected artifact inventory must be non-empty, labeled, and unique',
    );
  }
  for (const requiredKind of REQUIRED_SENTINEL_ARTIFACT_KINDS) {
    if (
      !expectedArtifacts.some(
        (artifact) => artifact.kind === requiredKind,
      )
    ) {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_MISSING',
        'Expected artifact inventory omits a required capture surface',
        { artifactKind: requiredKind },
      );
    }
  }
}

interface TrustedSentinelScanExpectationState
  extends SentinelScanExpectation {
  readonly sentinels: readonly ForbiddenSentinel[];
}

function expectationFailure(message: string): never {
  throw new SentinelScanError(
    'SENTINEL_EXPECTATION_INVALID',
    message,
  );
}

/**
 * Builds the only whole-run scanner expectation accepted by
 * `scanHarnessArtifacts`.
 *
 * Sentinel values are derived from the structurally reviewed
 * must-never-match registry and bound to exact canonical corpus/qrel bytes.
 * H0 does not authenticate detached signatures or the origin of the three
 * expected hashes; H1 must supply that external trust root before this
 * structural attestation can contribute to a record-ready run.
 */
export function createSentinelScanExpectation(
  input: SentinelScanExpectationInput,
): SentinelScanExpectation {
  if (
    !SHA256_HEX.test(input.committedCorpusManifestSha256) ||
    !SHA256_HEX.test(input.committedQrelSetSha256) ||
    !SHA256_HEX.test(input.committedMustNeverMatchRegistrySha256)
  ) {
    expectationFailure(
      'Sentinel expectation requires full canonical artifact commitments',
    );
  }

  let corpusManifest: z.infer<typeof CorpusManifestV1Schema>;
  let qrelSet: z.infer<typeof SearchQrelSetV1Schema>;
  let registry: MustNeverMatchRegistryEnvelopeV1;
  let expectedArtifacts: readonly SentinelArtifactExpectation[];
  try {
    corpusManifest = CorpusManifestV1Schema.parse(input.corpusManifest);
    qrelSet = SearchQrelSetV1Schema.parse(input.qrelSet);
    registry = MustNeverMatchRegistryEnvelopeV1Schema.parse(
      input.mustNeverMatchRegistry,
    );
    expectedArtifacts = z
      .array(artifactExpectationSchema)
      .parse(input.expectedArtifacts);
  } catch {
    expectationFailure(
      'Sentinel expectation artifacts must satisfy their strict schemas',
    );
  }

  const corpusManifestSha256 = canonicalSha256(corpusManifest);
  const qrelSetSha256 = canonicalSha256(qrelSet);
  const mustNeverMatchRegistrySha256 = canonicalSha256(registry);
  if (
    corpusManifestSha256 !== input.committedCorpusManifestSha256 ||
    qrelSetSha256 !== input.committedQrelSetSha256 ||
    mustNeverMatchRegistrySha256 !==
      input.committedMustNeverMatchRegistrySha256
  ) {
    expectationFailure(
      'Sentinel expectation artifact bytes do not match committed dependencies',
    );
  }

  const payload = registry.payload;
  if (
    payload.corpusManifestSha256 !== corpusManifestSha256 ||
    payload.corpusCanaryCountsSha256 !==
      canonicalSha256(corpusManifest.canaryCounts) ||
    payload.qrelSetSha256 !== qrelSetSha256 ||
    payload.datasetVersion !== corpusManifest.datasetVersion ||
    payload.querySetVersion !== qrelSet.querySetVersion ||
    payload.applicationPolicyDependencySha256 !==
      qrelSet.applicationPolicyDependencySha256 ||
    payload.migrationStateSha256 !== qrelSet.migrationStateSha256
  ) {
    expectationFailure(
      'Must-never-match registry dependencies do not match the corpus and qrel artifacts',
    );
  }

  const inventory = validateInventory(payload.sentinels);
  const registrySentinelIds = new Set(inventory.map(({ id }) => id));
  const qrelSentinelIds = new Set(
    qrelSet.cases.flatMap(({ forbiddenSentinelIds }) =>
      forbiddenSentinelIds,
    ),
  );
  if (
    registrySentinelIds.size !== qrelSentinelIds.size ||
    [...registrySentinelIds].some((id) => !qrelSentinelIds.has(id))
  ) {
    throw new SentinelScanError(
      'SENTINEL_INVENTORY_MISMATCH',
      'Signed qrels and the must-never-match registry require the same exact sentinel IDs',
      {
        qrelSentinelCount: qrelSentinelIds.size,
        registrySentinelCount: registrySentinelIds.size,
      },
    );
  }

  validateExpectedArtifacts(expectedArtifacts);
  const frozenArtifacts = Object.freeze(
    expectedArtifacts.map((artifact) => Object.freeze({ ...artifact })),
  );
  const frozenInventory = Object.freeze(
    inventory.map((sentinel) => Object.freeze({ ...sentinel })),
  );
  const expectation: TrustedSentinelScanExpectationState = Object.freeze({
    provenanceAssurance: 'structural-bindings-only',
    expectedArtifacts: frozenArtifacts,
    corpusManifestSha256,
    qrelSetSha256,
    mustNeverMatchRegistrySha256,
    sentinelInventorySha256: canonicalSha256(
      frozenInventory.map(commitForbiddenSentinel),
    ),
    sentinels: frozenInventory,
  });
  trustedSentinelScanExpectations.add(expectation);
  return expectation;
}

function tolerantJsonEscapeDecode(value: string): string {
  return value.replace(
    /\\u([a-f0-9]{4})|\\(["\\/bfnrt])/giu,
    (_escape, unicode: string | undefined, simple: string | undefined) => {
      if (unicode !== undefined) {
        return String.fromCharCode(Number.parseInt(unicode, 16));
      }
      const decoded: Readonly<Record<string, string>> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      return decoded[simple ?? ''] ?? _escape;
    },
  );
}

function utf16RoundTrips(
  bytes: Uint8Array,
  value: string,
  encoding: 'utf-16be' | 'utf-16le',
): boolean {
  let encoded = Buffer.from(value, 'utf16le');
  if (encoding === 'utf-16be') encoded.swap16();
  const hasMatchingBom =
    (encoding === 'utf-16le' && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (encoding === 'utf-16be' && bytes[0] === 0xfe && bytes[1] === 0xff);
  if (hasMatchingBom) {
    encoded = Buffer.concat([
      Buffer.from(encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff]),
      encoded,
    ]);
  }
  return Buffer.from(bytes).equals(encoded);
}

function base64DecodedVariants(text: string): readonly string[] {
  const decoded = new Set<string>();
  for (const match of text.matchAll(
    /(?<![A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{12,}={0,2})(?![A-Za-z0-9+/_-])/gu,
  )) {
    const token = match[1]!;
    for (const encoding of ['base64', 'base64url'] as const) {
      try {
        const bytes = Buffer.from(token, encoding);
        if (bytes.length === 0) continue;
        const normalizedInput = token.replace(/=+$/u, '');
        const normalizedRoundTrip = bytes
          .toString(encoding)
          .replace(/=+$/u, '');
        if (normalizedRoundTrip !== normalizedInput) continue;
        try {
          decoded.add(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          );
        } catch {
          // The same token may still be normalized UTF-16.
        }
        for (const utf16Encoding of [
          'utf-16le',
          'utf-16be',
        ] as const) {
          if (bytes.length < 16 || bytes.length % 2 !== 0) continue;
          try {
            const value = new TextDecoder(
              utf16Encoding,
              { fatal: true },
            ).decode(bytes);
            if (utf16RoundTrips(bytes, value, utf16Encoding)) {
              decoded.add(value);
            }
          } catch {
            // Invalid surrogate structure is not a normalized text encoding.
          }
        }
      } catch {
        // A base64-looking ordinary token is not an encoded capture field.
      }
    }
  }
  return [...decoded];
}

type EncodingRepresentation =
  | 'base64'
  | 'json-escaped'
  | 'percent-encoded'
  | 'raw';

interface EncodingVariant {
  readonly value: string;
  readonly representation: EncodingRepresentation;
  readonly depth: number;
}

function encodedVariantGraph(text: string): readonly EncodingVariant[] {
  const variants: EncodingVariant[] = [
    { value: text, representation: 'raw', depth: 0 },
  ];
  const seen = new Set<string>([text]);
  for (let cursor = 0; cursor < variants.length; cursor += 1) {
    const current = variants[cursor]!;
    const candidates: Array<
      readonly [string, Exclude<EncodingRepresentation, 'raw'>]
    > = [];
    const percentDecoded = tolerantPercentDecode(
      current.value.replace(/\+/gu, ' '),
    );
    if (percentDecoded !== current.value) {
      candidates.push([percentDecoded, 'percent-encoded']);
    }
    const jsonDecoded = tolerantJsonEscapeDecode(current.value);
    if (jsonDecoded !== current.value) {
      candidates.push([jsonDecoded, 'json-escaped']);
    }
    for (const decoded of base64DecodedVariants(current.value)) {
      if (decoded !== current.value) candidates.push([decoded, 'base64']);
    }

    if (
      current.depth >= MAX_ENCODING_TRANSFORM_DEPTH &&
      candidates.some(([candidate]) => !seen.has(candidate))
    ) {
      throw new Error('encoded artifact exceeds the transform-depth limit');
    }
    for (const [candidate, representation] of candidates) {
      if (seen.has(candidate)) continue;
      if (variants.length >= MAX_ENCODING_VARIANTS) {
        throw new Error('encoded artifact exceeds the transform-variant limit');
      }
      seen.add(candidate);
      variants.push({
        value: candidate,
        representation:
          current.representation === 'raw'
            ? representation
            : current.representation,
        depth: current.depth + 1,
      });
    }
  }
  return variants;
}

function representationMatch(
  text: string,
  sentinel: ForbiddenSentinel,
):
  | 'base64'
  | 'json-escaped'
  | 'percent-encoded'
  | 'raw'
  | 'sql-escaped'
  | null {
  const jsonEncoded = JSON.stringify(sentinel.value).slice(1, -1);
  const sqlEncoded = sentinel.value.replace(/'/gu, "''");
  for (const variant of encodedVariantGraph(text)) {
    if (variant.value.includes(sentinel.value)) {
      return variant.representation;
    }
    if (
      jsonEncoded !== sentinel.value &&
      variant.value.includes(jsonEncoded)
    ) {
      return variant.representation === 'raw'
        ? 'json-escaped'
        : variant.representation;
    }
    if (
      sqlEncoded !== sentinel.value &&
      variant.value.includes(sqlEncoded)
    ) {
      return 'sql-escaped';
    }
  }
  return null;
}

export function scanSentinelArtifact(
  artifact: SentinelArtifact,
  sentinels: readonly ForbiddenSentinel[],
): void {
  const kind = requireSentinelArtifactKind(
    artifact.kind,
    'SENTINEL_ARTIFACT_UNSCANNABLE',
  );
  if (!validArtifactLabel(artifact.label)) {
    throw new SentinelScanError(
      'SENTINEL_ARTIFACT_UNSCANNABLE',
      'Harness artifact requires a non-blank label',
      { artifactKind: artifact.kind },
    );
  }
  const inventory = validateInventory(sentinels);
  for (const sentinel of inventory) {
    let labelRepresentation: ReturnType<typeof representationMatch>;
    try {
      labelRepresentation = representationMatch(artifact.label, sentinel);
    } catch {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_UNSCANNABLE',
        'Harness artifact label encoding exceeds deterministic scanner limits',
        { artifactKind: artifact.kind },
      );
    }
    if (labelRepresentation !== null) {
      throw new SentinelScanError(
        'FORBIDDEN_SENTINEL_DETECTED',
        'Forbidden sentinel detected in a harness artifact label',
        {
          artifactKind: kind,
          representation: labelRepresentation,
          sentinelIdSha256: createHash('sha256')
            .update(sentinel.id)
            .digest('hex'),
        },
      );
    }
  }
  const text = artifactText(artifact);
  for (const sentinel of inventory) {
    let representation: ReturnType<typeof representationMatch>;
    try {
      representation = representationMatch(text, sentinel);
    } catch {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_UNSCANNABLE',
        'Harness artifact encoding exceeds deterministic scanner limits',
        {
          artifactKind: artifact.kind,
          artifactLabelSha256: createHash('sha256')
            .update(artifact.label)
            .digest('hex'),
        },
      );
    }
    if (representation !== null) {
      throw new SentinelScanError(
        'FORBIDDEN_SENTINEL_DETECTED',
        'Forbidden sentinel detected in a harness artifact',
        {
          artifactKind: artifact.kind,
          artifactLabelSha256: createHash('sha256')
            .update(artifact.label)
            .digest('hex'),
          representation,
          sentinelIdSha256: createHash('sha256')
            .update(sentinel.id)
            .digest('hex'),
        },
      );
    }
  }
}

/**
 * Scans every required capture surface, including Amendment 5's EXPLAIN and
 * run-manifest additions. Missing surfaces fail closed.
 */
export function scanHarnessArtifacts(
  artifacts: readonly SentinelArtifact[],
  expectation: SentinelScanExpectation,
): SentinelScanAttestation {
  if (!trustedSentinelScanExpectations.has(expectation)) {
    throw new SentinelScanError(
      'SENTINEL_EXPECTATION_INVALID',
      'Whole-run sentinel scan requires a factory-issued structurally bound expectation',
    );
  }
  const trusted =
    expectation as TrustedSentinelScanExpectationState;
  const inventory = trusted.sentinels;
  const covered = new Set<SentinelArtifactKind>();
  const actualArtifactKeys = new Set<string>();
  const expectedArtifacts = new Map(
    trusted.expectedArtifacts.map((artifactExpectation) => [
      artifactKey(artifactExpectation),
      artifactExpectation,
    ]),
  );
  const scannedArtifacts: SentinelArtifactExpectation[] = [];
  for (const artifact of artifacts) {
    const kind = requireSentinelArtifactKind(
      artifact.kind,
      'SENTINEL_ARTIFACT_UNSCANNABLE',
    );
    const key = artifactKey(artifact);
    if (actualArtifactKeys.has(key)) {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_SET_MISMATCH',
        'Captured artifact inventory contains a duplicate kind/label pair',
        {
          artifactKind: artifact.kind,
          artifactLabelSha256: createHash('sha256')
            .update(artifact.label)
            .digest('hex'),
        },
      );
    }
    actualArtifactKeys.add(key);
    const expected = expectedArtifacts.get(key);
    if (!expected) {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_SET_MISMATCH',
        'Captured artifact is absent from the enumerated run inventory',
        {
          artifactKind: artifact.kind,
          artifactLabelSha256: createHash('sha256')
            .update(artifact.label)
            .digest('hex'),
        },
      );
    }
    const commitment = commitSentinelArtifactContent(artifact);
    if (
      commitment.contentSha256 !== expected.contentSha256 ||
      commitment.byteLength !== expected.byteLength
    ) {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_CONTENT_MISMATCH',
        'Captured artifact bytes do not match the independently committed inventory',
        {
          artifactKind: artifact.kind,
          artifactLabelSha256: createHash('sha256')
            .update(artifact.label)
            .digest('hex'),
        },
      );
    }
    scanSentinelArtifact(artifact, inventory);
    scannedArtifacts.push(commitment);
    covered.add(kind);
  }

  for (const requiredKind of REQUIRED_SENTINEL_ARTIFACT_KINDS) {
    if (!covered.has(requiredKind)) {
      throw new SentinelScanError(
        'SENTINEL_ARTIFACT_MISSING',
        'Required sentinel-scan artifact surface is missing',
        { artifactKind: requiredKind },
      );
    }
  }

  const expectedArtifactKeys = new Set(expectedArtifacts.keys());
  if (
    actualArtifactKeys.size !== expectedArtifactKeys.size ||
    [...expectedArtifactKeys].some((key) => !actualArtifactKeys.has(key))
  ) {
    throw new SentinelScanError(
      'SENTINEL_ARTIFACT_SET_MISMATCH',
      'Captured artifacts do not exactly match the enumerated run inventory',
      {
        actualArtifactCount: actualArtifactKeys.size,
        expectedArtifactCount: expectedArtifactKeys.size,
      },
    );
  }

  return Object.freeze({
    provenanceAssurance: 'structural-bindings-only',
    artifactCount: artifacts.length,
    sentinelCount: inventory.length,
    coveredKinds: Object.freeze([...covered]),
    scannedArtifacts: Object.freeze(scannedArtifacts),
    sentinelInventorySha256: trusted.sentinelInventorySha256,
    corpusManifestSha256: trusted.corpusManifestSha256,
    qrelSetSha256: trusted.qrelSetSha256,
    mustNeverMatchRegistrySha256:
      trusted.mustNeverMatchRegistrySha256,
  });
}
