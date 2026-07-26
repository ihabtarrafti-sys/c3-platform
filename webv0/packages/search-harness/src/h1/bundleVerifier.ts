import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export type JsonObject = Record<string, unknown>;

interface IdentityBinding {
  pointer: string;
  value: unknown;
}

interface SlotContract {
  slot: string;
  filename: string;
  contentKind: 'json' | 'text';
  identities?: IdentityBinding[];
}

interface CrossBinding {
  bindingId: string;
  fromSlot: string;
  fromPointer: string;
  toSlot: string;
  toPointer?: string;
  expectedFrom:
    | 'toFilename'
    | 'toCanonicalTextSha256'
    | 'toCanonicalJsonSha256'
    | 'literal'
    | 'toPointer'
    | 'toPointerCanonicalJsonSha256'
    | 'toPointerCanonicalJsonLfSha256';
  value?: unknown;
}

interface SlotContentBinding {
  bindingId: string;
  slot: string;
  expectedCanonicalByteLength?: number;
  expectedCanonicalTextSha256: string;
}

export interface BundleContract extends JsonObject {
  manifestIdentity?: JsonObject;
  slots: SlotContract[];
  crossBindings?: CrossBinding[];
  slotContentBindings?: SlotContentBinding[];
}

interface ManifestEntry {
  filename: string;
  canonicalByteLength: number;
  canonicalTextSha256: string;
  canonicalJsonSha256?: string;
}

interface HashManifest extends JsonObject {
  artifacts: ManifestEntry[];
}

export interface BundleEntry {
  slot: string;
  filename: string;
  bytes: Uint8Array;
}

export interface VerifiedArtifact {
  filename: string;
  bytes: Uint8Array;
  parsed: JsonObject | null;
  manifestEntry: Readonly<ManifestEntry>;
}

export interface VerifiedBundle {
  manifestCanonicalTextSha256: string;
  verifiedSlotCount: number;
  identityAssertionCount: number;
  crossBindingCount: number;
  slotContentBindingCount: number;
  verified: ReadonlyMap<string, VerifiedArtifact>;
}

const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

export class AuthorityBundleError extends Error {
  constructor(
    readonly code: string,
    readonly stage: string,
    safeDetail: string,
  ) {
    super(`${code}: ${safeDetail}`);
    this.name = 'AuthorityBundleError';
  }
}

function fail(code: string, stage: string, detail: string): never {
  throw new AuthorityBundleError(code, stage, detail);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalTextBytes(
  inputBytes: Uint8Array,
  label = 'content',
): Uint8Array {
  const bytes = Buffer.from(inputBytes);
  try {
    strictUtf8.decode(bytes);
  } catch {
    fail(
      'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
      'canonical-text',
      `${label} is not strict UTF-8`,
    );
  }
  if (bytes.includes(0)) {
    fail(
      'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
      'canonical-text',
      `${label} contains NUL`,
    );
  }
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] === 0x0a) index += 1;
      output.push(0x0a);
    } else {
      const value = bytes[index];
      if (value === undefined) {
        fail(
          'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
          'canonical-text',
          `${label} could not be canonicalized`,
        );
      }
      output.push(value);
    }
  }
  return Buffer.from(output);
}

export function canonicalTextSha256(
  bytes: Uint8Array,
  label = 'content',
): string {
  return sha256(canonicalTextBytes(bytes, label));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const rendered = JSON.stringify(canonicalize(value));
  if (rendered === undefined) {
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'canonical-json',
      'value is not canonical-JSON serializable',
    );
  }
  return rendered;
}

export function canonicalJsonSha256(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function canonicalJsonLfSha256(value: unknown): string {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonBytes(
  bytes: Uint8Array,
  label = 'JSON content',
): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.from(canonicalTextBytes(bytes, label)).toString('utf8'),
    );
  } catch (error) {
    if (error instanceof AuthorityBundleError) throw error;
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'artifact-identity',
      `${label} is not valid JSON`,
    );
  }
  if (!isObject(value)) {
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'artifact-identity',
      `${label} is not a JSON object`,
    );
  }
  return value;
}

function pointerValue(
  root: unknown,
  pointer: string | undefined,
): { exists: boolean; value: unknown } {
  if (pointer === '') return { exists: true, value: root };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    fail(
      'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
      'cross-binding',
      'authority contract contains an invalid JSON pointer',
    );
  }
  let value: unknown = root;
  for (const rawPart of pointer.slice(1).split('/')) {
    const part = rawPart.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (!isObject(value) && !Array.isArray(value)) {
      return { exists: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(value, part)) {
      return { exists: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[part];
  }
  return { exists: true, value };
}

function portableFilename(filename: unknown): filename is string {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    filename === filename.trim() &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('..') &&
    !/[\u0000-\u001f\u007f]/u.test(filename)
  );
}

function exactDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value));
}

function assertUnique(values: string[], detail: string): void {
  if (new Set(values).size !== values.length) {
    fail('AUTHORITY_BUNDLE_DUPLICATE_SLOT', 'closed-slot-set', detail);
  }
}

function parseContract(value: JsonObject): BundleContract {
  if (!Array.isArray(value.slots)) {
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'closed-slot-set',
      'authority contract has no slot array',
    );
  }
  const slots = value.slots as SlotContract[];
  const logicalSlots = slots.map(({ slot }) => slot);
  const filenames = slots.map(({ filename }) => filename);
  if (
    logicalSlots.some((slot) => typeof slot !== 'string') ||
    filenames.some((filename) => !portableFilename(filename))
  ) {
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'closed-slot-set',
      'authority contract has a non-portable slot',
    );
  }
  assertUnique(
    logicalSlots,
    'authority contract repeats a logical slot',
  );
  assertUnique(filenames, 'authority contract repeats a filename');
  for (const slot of slots) {
    if (!['json', 'text'].includes(slot.contentKind)) {
      fail(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'closed-slot-set',
        `authority contract has an unknown content kind for ${slot.slot}`,
      );
    }
  }
  return value as BundleContract;
}

function parseManifest(
  manifestBytes: Uint8Array,
  contract: BundleContract,
): HashManifest {
  const manifest = parseJsonBytes(
    manifestBytes,
    'authority hash manifest',
  );
  for (const [key, expected] of Object.entries(
    contract.manifestIdentity ?? {},
  )) {
    if (!Object.is(manifest[key], expected)) {
      fail(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'manifest-identity',
        `manifest identity field ${key} differs`,
      );
    }
  }
  if (!Array.isArray(manifest.artifacts)) {
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'manifest-identity',
      'manifest artifacts is not an array',
    );
  }
  const artifacts = manifest.artifacts as ManifestEntry[];
  const filenames = artifacts.map(({ filename }) => filename);
  if (filenames.some((filename) => !portableFilename(filename))) {
    fail(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'manifest-identity',
      'manifest contains a non-portable filename',
    );
  }
  assertUnique(filenames, 'manifest repeats an artifact filename');
  return { ...manifest, artifacts };
}

function expectedFromBinding(
  binding: CrossBinding,
  target: VerifiedArtifact,
): unknown {
  switch (binding.expectedFrom) {
    case 'toFilename':
      return target.filename;
    case 'toCanonicalTextSha256':
      return target.manifestEntry.canonicalTextSha256;
    case 'toCanonicalJsonSha256':
      if (typeof target.manifestEntry.canonicalJsonSha256 !== 'string') {
        fail(
          'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
          'cross-binding',
          `target has no canonical JSON hash: ${binding.bindingId}`,
        );
      }
      return target.manifestEntry.canonicalJsonSha256;
    case 'literal':
      return binding.value;
    case 'toPointer':
    case 'toPointerCanonicalJsonSha256':
    case 'toPointerCanonicalJsonLfSha256': {
      if (target.parsed === null) {
        fail(
          'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
          'cross-binding',
          `target is not JSON: ${binding.bindingId}`,
        );
      }
      const pointer = pointerValue(target.parsed, binding.toPointer);
      if (!pointer.exists) {
        fail(
          'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
          'cross-binding',
          `target pointer is absent: ${binding.bindingId}`,
        );
      }
      if (binding.expectedFrom === 'toPointer') return pointer.value;
      if (
        binding.expectedFrom === 'toPointerCanonicalJsonSha256'
      ) {
        return canonicalJsonSha256(pointer.value);
      }
      return canonicalJsonLfSha256(pointer.value);
    }
  }
}

export function verifyAuthorityBundle(input: {
  manifestBytes: Uint8Array;
  externallyPinnedManifestSha256: string;
  contract: JsonObject;
  entries: BundleEntry[];
}): VerifiedBundle {
  const observedRoot = canonicalTextSha256(
    input.manifestBytes,
    'authority hash manifest',
  );
  if (observedRoot !== input.externallyPinnedManifestSha256) {
    fail(
      'AUTHORITY_BUNDLE_ROOT_HASH_MISMATCH',
      'external-root',
      'authority hash manifest does not match the external root',
    );
  }

  const contract = parseContract(input.contract);
  const manifest = parseManifest(input.manifestBytes, contract);

  const entrySlots = input.entries.map(({ slot }) => slot);
  assertUnique(entrySlots, 'input repeats a logical slot');
  const expectedSlots = new Set(contract.slots.map(({ slot }) => slot));
  const observedSlots = new Set(entrySlots);
  const missingSlots = exactDifference(expectedSlots, observedSlots);
  if (missingSlots.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
      'closed-slot-set',
      `required logical slot is missing: ${missingSlots[0]}`,
    );
  }
  const unexpectedSlots = exactDifference(observedSlots, expectedSlots);
  if (unexpectedSlots.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_UNEXPECTED_ARTIFACT',
      'closed-slot-set',
      `unexpected logical slot: ${unexpectedSlots[0]}`,
    );
  }

  const expectedFilenames = new Set(
    contract.slots.map(({ filename }) => filename),
  );
  const manifestFilenames = new Set(
    manifest.artifacts.map(({ filename }) => filename),
  );
  const omitted = exactDifference(expectedFilenames, manifestFilenames);
  if (omitted.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
      'closed-slot-set',
      `manifest omits ${omitted[0]}`,
    );
  }
  const extra = exactDifference(manifestFilenames, expectedFilenames);
  if (extra.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_UNEXPECTED_ARTIFACT',
      'closed-slot-set',
      `manifest contains unexpected ${extra[0]}`,
    );
  }

  const verified = new Map<string, VerifiedArtifact>();
  for (const slotContract of contract.slots) {
    const entry = input.entries.find(
      ({ slot }) => slot === slotContract.slot,
    );
    if (entry === undefined) {
      fail(
        'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
        'closed-slot-set',
        `required logical slot is missing: ${slotContract.slot}`,
      );
    }
    if (
      !portableFilename(entry.filename) ||
      entry.filename !== slotContract.filename
    ) {
      fail(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'slot-filename',
        `logical slot ${slotContract.slot} has the wrong filename`,
      );
    }
    const manifestEntry = manifest.artifacts.find(
      ({ filename }) => filename === slotContract.filename,
    );
    if (manifestEntry === undefined) {
      fail(
        'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
        'closed-slot-set',
        `manifest omits ${slotContract.filename}`,
      );
    }
    const canonicalBytes = canonicalTextBytes(
      entry.bytes,
      slotContract.filename,
    );
    if (
      canonicalBytes.length !== manifestEntry.canonicalByteLength ||
      sha256(canonicalBytes) !== manifestEntry.canonicalTextSha256
    ) {
      fail(
        'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
        'artifact-content',
        `content hash differs for ${slotContract.filename}`,
      );
    }
    let parsed: JsonObject | null = null;
    if (slotContract.contentKind === 'json') {
      parsed = parseJsonBytes(entry.bytes, slotContract.filename);
      if (
        canonicalJsonSha256(parsed) !==
        manifestEntry.canonicalJsonSha256
      ) {
        fail(
          'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
          'artifact-canonical-json',
          `canonical JSON hash differs for ${slotContract.filename}`,
        );
      }
      for (const identity of slotContract.identities ?? []) {
        const observed = pointerValue(parsed, identity.pointer);
        if (
          !observed.exists ||
          canonicalJson(observed.value) !==
            canonicalJson(identity.value)
        ) {
          fail(
            'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
            'artifact-identity',
            `identity ${identity.pointer} differs for ${slotContract.filename}`,
          );
        }
      }
    }
    verified.set(slotContract.slot, {
      filename: slotContract.filename,
      bytes: Buffer.from(entry.bytes),
      parsed,
      manifestEntry: { ...manifestEntry },
    });
  }

  for (const binding of contract.crossBindings ?? []) {
    const source = verified.get(binding.fromSlot);
    const target = verified.get(binding.toSlot);
    if (
      source === undefined ||
      source.parsed === null ||
      target === undefined
    ) {
      fail(
        'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        'cross-binding',
        `binding inputs are unavailable: ${binding.bindingId}`,
      );
    }
    const observed = pointerValue(source.parsed, binding.fromPointer);
    const expected = expectedFromBinding(binding, target);
    if (
      !observed.exists ||
      canonicalJson(observed.value) !== canonicalJson(expected)
    ) {
      fail(
        'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        'cross-binding',
        `cross-binding differs: ${binding.bindingId}`,
      );
    }
  }

  for (const binding of contract.slotContentBindings ?? []) {
    const target = verified.get(binding.slot);
    if (
      target === undefined ||
      target.manifestEntry.canonicalTextSha256 !==
        binding.expectedCanonicalTextSha256 ||
      (binding.expectedCanonicalByteLength !== undefined &&
        target.manifestEntry.canonicalByteLength !==
          binding.expectedCanonicalByteLength)
    ) {
      fail(
        'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        'cross-binding',
        `slot content binding differs: ${binding.bindingId}`,
      );
    }
  }

  return {
    manifestCanonicalTextSha256: observedRoot,
    verifiedSlotCount: verified.size,
    identityAssertionCount: contract.slots.reduce(
      (count, slot) => count + (slot.identities?.length ?? 0),
      0,
    ),
    crossBindingCount: contract.crossBindings?.length ?? 0,
    slotContentBindingCount:
      contract.slotContentBindings?.length ?? 0,
    verified,
  };
}
