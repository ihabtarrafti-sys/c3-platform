#!/usr/bin/env node

/**
 * Closed-set, fail-first authority-bundle verifier v2.
 *
 * This module is intentionally pure: it imports only hashing and UTF-8
 * primitives, accepts already-loaded bytes, and performs no filesystem,
 * process, database, network, HTTP, or metrics work. Consumers must use the
 * returned verified bytes instead of reopening filenames.
 *
 * v2 preserves every v1 verification stage and adds:
 *   - target JSON-pointer equality (`toPointer`);
 *   - target pointer canonical-JSON SHA-256, without a trailing LF;
 *   - target pointer canonical-JSON SHA-256 with exactly one trailing LF;
 *   - explicit exact-content bindings for otherwise identity-free text slots.
 */

import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

export class BundleVerificationError extends Error {
  constructor(code, stage, safeDetail) {
    super(`${code}: ${safeDetail}`);
    this.name = 'BundleVerificationError';
    this.code = code;
    this.stage = stage;
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalTextBytes(inputBytes, label = 'content') {
  const bytes = Buffer.from(inputBytes);
  try {
    strictUtf8.decode(bytes);
  } catch {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
      'canonical-text',
      `${label} is not strict UTF-8`,
    );
  }
  if (bytes.includes(0)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
      'canonical-text',
      `${label} contains NUL`,
    );
  }
  const output = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] === 0x0a) index += 1;
      output.push(0x0a);
    } else {
      output.push(bytes[index]);
    }
  }
  return Buffer.from(output);
}

export function canonicalTextSha256(bytes, label = 'content') {
  return sha256(canonicalTextBytes(bytes, label));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalJsonSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

export function canonicalJsonLfSha256(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
}

export function parseJsonBytes(bytes, label = 'JSON content') {
  try {
    return JSON.parse(canonicalTextBytes(bytes, label).toString('utf8'));
  } catch (error) {
    if (error instanceof BundleVerificationError) throw error;
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'artifact-identity',
      `${label} is not valid JSON`,
    );
  }
}

export function pointerValue(root, pointer) {
  if (pointer === '') return { exists: true, value: root };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
      'cross-binding',
      'authority contract contains an invalid JSON pointer',
    );
  }
  let value = root;
  for (const rawPart of pointer.slice(1).split('/')) {
    const part = rawPart.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (
      value === null ||
      typeof value !== 'object' ||
      !(part in value)
    ) {
      return { exists: false, value: undefined };
    }
    value = value[part];
  }
  return { exists: true, value };
}

function validatePortableFilename(filename) {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename !== filename.trim() ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    /[\u0000-\u001f\u007f]/u.test(filename)
  ) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'closed-slot-set',
      'artifact filename is not portable',
    );
  }
}

function uniqueValues(values) {
  return new Set(values).size === values.length;
}

function manifestEntryByFilename(manifest, filename) {
  return manifest.artifacts.find(
    (candidate) => candidate.filename === filename,
  );
}

function verifyManifestIdentity(manifest, contract) {
  if (!manifest || typeof manifest !== 'object') {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'manifest-identity',
      'authority hash manifest is not an object',
    );
  }
  for (const [key, expected] of Object.entries(
    contract.manifestIdentity ?? {},
  )) {
    if (!Object.is(manifest[key], expected)) {
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'manifest-identity',
        `manifest identity field ${key} differs`,
      );
    }
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'manifest-identity',
      'manifest artifacts is not an array',
    );
  }
  const filenames = manifest.artifacts.map(({ filename }) => filename);
  if (!uniqueValues(filenames)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_DUPLICATE_SLOT',
      'manifest-identity',
      'manifest repeats an artifact filename',
    );
  }
}

function verifyContractShape(contract) {
  if (!contract || !Array.isArray(contract.slots)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
      'closed-slot-set',
      'authority contract has no slot array',
    );
  }
  const logicalSlots = contract.slots.map(({ slot }) => slot);
  const filenames = contract.slots.map(({ filename }) => filename);
  if (!uniqueValues(logicalSlots) || !uniqueValues(filenames)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_DUPLICATE_SLOT',
      'closed-slot-set',
      'authority contract repeats a logical slot or filename',
    );
  }
  for (const slot of contract.slots) {
    validatePortableFilename(slot.filename);
    if (!['json', 'text'].includes(slot.contentKind)) {
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'closed-slot-set',
        `authority contract has an unknown content kind for ${slot.slot}`,
      );
    }
  }
}

function exactSetDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function expectedFromBinding(binding, to) {
  switch (binding.expectedFrom) {
    case 'toFilename':
      return to.filename;
    case 'toCanonicalTextSha256':
      return to.manifestEntry.canonicalTextSha256;
    case 'toCanonicalJsonSha256':
      if (typeof to.manifestEntry.canonicalJsonSha256 !== 'string') {
        throw new BundleVerificationError(
          'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
          'cross-binding',
          `target has no canonical JSON hash: ${binding.bindingId}`,
        );
      }
      return to.manifestEntry.canonicalJsonSha256;
    case 'literal':
      return binding.value;
    case 'toPointer':
    case 'toPointerCanonicalJsonSha256':
    case 'toPointerCanonicalJsonLfSha256': {
      if (to.parsed === null) {
        throw new BundleVerificationError(
          'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
          'cross-binding',
          `target is not JSON: ${binding.bindingId}`,
        );
      }
      const target = pointerValue(to.parsed, binding.toPointer);
      if (!target.exists) {
        throw new BundleVerificationError(
          'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
          'cross-binding',
          `target pointer is absent: ${binding.bindingId}`,
        );
      }
      if (binding.expectedFrom === 'toPointer') return target.value;
      if (binding.expectedFrom === 'toPointerCanonicalJsonSha256') {
        return canonicalJsonSha256(target.value);
      }
      return canonicalJsonLfSha256(target.value);
    }
    default:
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        'cross-binding',
        `unknown cross-binding mode: ${binding.bindingId}`,
      );
  }
}

/**
 * Verify a complete authority bundle.
 *
 * @param {object} input
 * @param {Uint8Array} input.manifestBytes
 * @param {string} input.externallyPinnedManifestSha256
 * @param {object} input.contract
 * @param {{slot:string,filename:string,bytes:Uint8Array}[]} input.entries
 */
export function verifyAuthorityBundle({
  manifestBytes,
  externallyPinnedManifestSha256,
  contract,
  entries,
}) {
  const observedRoot = canonicalTextSha256(
    manifestBytes,
    'authority hash manifest',
  );
  if (observedRoot !== externallyPinnedManifestSha256) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_ROOT_HASH_MISMATCH',
      'external-root',
      'authority hash manifest does not match the external root',
    );
  }

  verifyContractShape(contract);
  const manifest = parseJsonBytes(manifestBytes, 'authority hash manifest');
  verifyManifestIdentity(manifest, contract);

  if (!Array.isArray(entries)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
      'closed-slot-set',
      'bundle entries are not an array',
    );
  }
  const slotCounts = new Map();
  for (const entry of entries) {
    slotCounts.set(entry.slot, (slotCounts.get(entry.slot) ?? 0) + 1);
  }
  if ([...slotCounts.values()].some((count) => count > 1)) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_DUPLICATE_SLOT',
      'closed-slot-set',
      'input repeats a logical slot',
    );
  }

  const expectedSlots = new Set(contract.slots.map(({ slot }) => slot));
  const observedSlots = new Set(entries.map(({ slot }) => slot));
  const missingSlots = exactSetDifference(expectedSlots, observedSlots);
  if (missingSlots.length > 0) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
      'closed-slot-set',
      `required logical slot is missing: ${missingSlots[0]}`,
    );
  }
  const unexpectedSlots = exactSetDifference(observedSlots, expectedSlots);
  if (unexpectedSlots.length > 0) {
    throw new BundleVerificationError(
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
  const missingManifestSlots = exactSetDifference(
    expectedFilenames,
    manifestFilenames,
  );
  if (missingManifestSlots.length > 0) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
      'closed-slot-set',
      `manifest omits ${missingManifestSlots[0]}`,
    );
  }
  const unexpectedManifestSlots = exactSetDifference(
    manifestFilenames,
    expectedFilenames,
  );
  if (unexpectedManifestSlots.length > 0) {
    throw new BundleVerificationError(
      'AUTHORITY_BUNDLE_UNEXPECTED_ARTIFACT',
      'closed-slot-set',
      `manifest contains unexpected ${unexpectedManifestSlots[0]}`,
    );
  }

  const verified = new Map();
  for (const slotContract of contract.slots) {
    const entry = entries.find(
      (candidate) => candidate.slot === slotContract.slot,
    );
    validatePortableFilename(entry.filename);
    if (entry.filename !== slotContract.filename) {
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'slot-filename',
        `logical slot ${slotContract.slot} has the wrong filename`,
      );
    }

    const manifestEntry = manifestEntryByFilename(
      manifest,
      slotContract.filename,
    );
    const canonicalBytes = canonicalTextBytes(
      entry.bytes,
      slotContract.filename,
    );
    const observedTextSha256 = sha256(canonicalBytes);
    if (
      canonicalBytes.length !== manifestEntry.canonicalByteLength ||
      observedTextSha256 !== manifestEntry.canonicalTextSha256
    ) {
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
        'artifact-content',
        `content hash differs for ${slotContract.filename}`,
      );
    }

    let parsed = null;
    if (slotContract.contentKind === 'json') {
      parsed = parseJsonBytes(entry.bytes, slotContract.filename);
      const observedJsonSha256 = canonicalJsonSha256(parsed);
      if (manifestEntry.canonicalJsonSha256 !== observedJsonSha256) {
        throw new BundleVerificationError(
          'AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH',
          'artifact-canonical-json',
          `canonical JSON hash differs for ${slotContract.filename}`,
        );
      }
      for (const identity of slotContract.identities ?? []) {
        const observed = pointerValue(parsed, identity.pointer);
        if (
          !observed.exists ||
          canonicalJson(observed.value) !== canonicalJson(identity.value)
        ) {
          throw new BundleVerificationError(
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
    const from = verified.get(binding.fromSlot);
    const to = verified.get(binding.toSlot);
    if (!from || from.parsed === null || !to) {
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        'cross-binding',
        `binding inputs are unavailable: ${binding.bindingId}`,
      );
    }
    const observed = pointerValue(from.parsed, binding.fromPointer);
    const expected = expectedFromBinding(binding, to);
    if (
      !observed.exists ||
      canonicalJson(observed.value) !== canonicalJson(expected)
    ) {
      throw new BundleVerificationError(
        'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        'cross-binding',
        `cross-binding differs: ${binding.bindingId}`,
      );
    }
  }

  for (const binding of contract.slotContentBindings ?? []) {
    const target = verified.get(binding.slot);
    if (
      !target ||
      target.manifestEntry.canonicalTextSha256 !==
        binding.expectedCanonicalTextSha256 ||
      (binding.expectedCanonicalByteLength !== undefined &&
        target.manifestEntry.canonicalByteLength !==
          binding.expectedCanonicalByteLength)
    ) {
      throw new BundleVerificationError(
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
    slotContentBindingCount: contract.slotContentBindings?.length ?? 0,
    verified,
  };
}
