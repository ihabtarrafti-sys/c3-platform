#!/usr/bin/env node

/**
 * Freeze the closed HEARTH-003-r6 authority bundle.
 *
 * The slot set comes only from BUNDLE-CONTRACT-v2. The output excludes itself;
 * Neural's separately recorded canonical-text hash is the external root.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILENAME = 'HEARTH-003-BUNDLE-CONTRACT-v2.json';
const OUTPUT_FILENAME = 'HEARTH-003-SHA256SUMS-v7.json';
const PRODUCT_COMMIT = 'dae27a400868c0c686788ab8e5520690dbf77334';
const R5_ROOT =
  'fe1fdd3fb4e9624b32485bc7967f98c663ff3c3f311dca61d887243927776249';
const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalTextBytes(bytes, label) {
  strictUtf8.decode(bytes);
  if (bytes.includes(0)) throw new Error(`${label} contains NUL`);
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

function canonicalTextSha256(bytes, label) {
  return sha256(canonicalTextBytes(bytes, label));
}

function canonicalize(value) {
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

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalJsonSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function parseJson(bytes, label) {
  return JSON.parse(canonicalTextBytes(bytes, label).toString('utf8'));
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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
    throw new Error(`non-portable authority filename: ${filename}`);
  }
}

function expandLfTo(bytes, lineEnding) {
  const output = [];
  for (const byte of bytes) {
    if (byte === 0x0a) output.push(...lineEnding);
    else output.push(byte);
  }
  return Buffer.from(output);
}

function assertEolPortability(bytes, label) {
  const canonical = canonicalTextBytes(bytes, label);
  const expected = sha256(canonical);
  for (const [variant, lineEnding] of [
    ['CRLF', [0x0d, 0x0a]],
    ['CR', [0x0d]],
  ]) {
    const expanded = expandLfTo(canonical, lineEnding);
    if (canonicalTextSha256(expanded, `${label} ${variant}`) !== expected) {
      throw new Error(`EOL portability failed for ${label} ${variant}`);
    }
  }
  const substantiveMutation = Buffer.concat([
    canonical,
    Buffer.from('substantive-change', 'utf8'),
  ]);
  if (
    canonicalTextSha256(substantiveMutation, `${label} RED`) === expected
  ) {
    throw new Error(`substantive text RED did not change ${label}`);
  }
}

const contractBytes = readFileSync(join(artifactDir, CONTRACT_FILENAME));
const contract = parseJson(contractBytes, CONTRACT_FILENAME);
if (
  contract.bundleContractVersion !==
    'HEARTH-003-BUNDLE-CONTRACT-v2' ||
  contract.manifestIdentity.schemaVersion !== 6 ||
  contract.manifestIdentity.hashManifestVersion !==
    'HEARTH-003-SHA256SUMS-v7' ||
  contract.manifestIdentity.sourceCommit !== PRODUCT_COMMIT
) {
  throw new Error('bundle contract identity is not the r6 closed tuple');
}
if (!Array.isArray(contract.slots) || contract.slots.length !== 37) {
  throw new Error(
    `bundle contract slot count is ${contract.slots?.length}, expected 37`,
  );
}
const slots = contract.slots.map(({ slot }) => slot);
const filenames = contract.slots.map(({ filename }) => filename);
if (
  new Set(slots).size !== slots.length ||
  new Set(filenames).size !== filenames.length
) {
  throw new Error('bundle contract repeats a slot or filename');
}
const caseFolded = filenames.map((filename) => filename.toLowerCase());
if (new Set(caseFolded).size !== caseFolded.length) {
  throw new Error('bundle contract contains a case-fold collision');
}

const artifacts = contract.slots
  .map((slot) => {
    validatePortableFilename(slot.slot);
    validatePortableFilename(slot.filename);
    if (
      slot.slot !== slot.filename ||
      !['text', 'json'].includes(slot.contentKind)
    ) {
      throw new Error(`invalid r6 slot definition: ${slot.slot}`);
    }
    const bytes = readFileSync(join(artifactDir, slot.filename));
    const canonicalBytes = canonicalTextBytes(bytes, slot.filename);
    assertEolPortability(bytes, slot.filename);
    const entry = {
      filename: slot.filename,
      contentKind: slot.contentKind,
      canonicalByteLength: canonicalBytes.length,
      canonicalTextSha256: sha256(canonicalBytes),
    };
    if (slot.contentKind === 'json') {
      entry.canonicalJsonSha256 = canonicalJsonSha256(
        parseJson(bytes, slot.filename),
      );
    }
    return entry;
  })
  .sort((left, right) => compareAscii(left.filename, right.filename));

const artifactByName = new Map(
  artifacts.map((entry) => [entry.filename, entry]),
);
const contractEntry = artifactByName.get(CONTRACT_FILENAME);
const validationEntry = artifactByName.get(
  'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json',
);
const policyEntry = artifactByName.get(
  'HEARTH-003-POLICY-DEPENDENCIES-v2.json',
);
if (!contractEntry || !validationEntry || !policyEntry) {
  throw new Error('r6 semantic anchor slot is absent');
}

const manifest = {
  schemaVersion: 6,
  artifactKind: 'hearth-search-authority-content-hashes',
  hashManifestVersion: 'HEARTH-003-SHA256SUMS-v7',
  authority: 'Apex Lumen',
  authoredOn: '2026-07-26',
  sourceRepositoryIdentity:
    'local read-only C3 product repository pinned by exact Git commit',
  sourceCommit: PRODUCT_COMMIT,
  contentHashAlgorithm: 'SHA-256',
  canonicalTextHashAlgorithm:
    'strict UTF-8; CRLF and lone CR normalize to LF; terminal-newline and every other byte remain significant',
  canonicalJsonHashAlgorithms: [
    {
      algorithmId: 'canonical-json-keysort-no-lf-v1',
      definition:
        'SHA-256 over UTF-8 JSON.stringify after recursively sorting object keys; array order and JSON scalar semantics preserved; no trailing LF',
      defaultForBundleCanonicalJsonSha256: true,
    },
    {
      algorithmId: 'canonical-json-keysort-plus-one-lf-v1',
      definition:
        'SHA-256 over the same key-sorted JSON bytes followed by exactly one byte 0x0A',
      legacyFieldsOnly: [
        'HEARTH-003-PHYSICAL-DOMAIN-MANIFEST-v3#/migrationPinSetSha256',
        'HEARTH-003-PHYSICAL-DOMAIN-VALIDATION-v3#/inputHashes/physicalSeedPlanSha256',
      ],
    },
  ],
  bundleContract: {
    artifact: CONTRACT_FILENAME,
    canonicalTextSha256: contractEntry.canonicalTextSha256,
    canonicalJsonSha256: contractEntry.canonicalJsonSha256,
    closedSlotCount: contract.slots.length,
    identityAssertionCount: contract.slots.reduce(
      (count, slot) => count + (slot.identities?.length ?? 0),
      0,
    ),
    crossBindingCount: contract.crossBindings.length,
    slotContentBindingCount: contract.slotContentBindings.length,
  },
  r5FixFirstBaseline: {
    authorityRevision: 'HEARTH-003-r5',
    authorityCommit:
      '915b4354cdb41a75b98053b3db51226222d2718e',
    manifestCanonicalTextSha256: R5_ROOT,
    use:
      'opaque immutable input to the actual-r5 ten-case bundle RED only',
  },
  hashPathInventory: [
    {
      pathClass: 'bundle-text-and-source',
      hashMode: 'canonical-text',
      consumers: [
        'r6 freezer',
        'bundle verifier v2',
        'R6 Authority Validation',
        'Neural separate recomputation',
      ],
      everySlotTestedWithLfCrLfAndCr: true,
      everySlotSubstantiveMutationChangedHash: true,
    },
    {
      pathClass: 'bundle-json',
      hashModes: [
        'canonical-text',
        'canonical-json-keysort-no-lf-v1',
      ],
      everyJsonSlotUsesBothHashes: true,
    },
    {
      pathClass: 'legacy-physical-semantic-json',
      hashMode: 'canonical-json-keysort-plus-one-lf-v1',
      bindingCount: 2,
      historicalValuesNotRepinned: true,
    },
    {
      pathClass: 'product-dependency-git-blobs',
      hashMode: 'canonical-text then framed tree hash',
      productCommit: PRODUCT_COMMIT,
      fileCounts: [18, 95, 113],
      entryLedgerRecomputedInBundle:
        'r6 materializer recomputes all three framed tree hashes from POLICY-DEPENDENCIES-v2 entry metadata',
      gitBlobVerificationBoundary:
        'the in-bundle recomputation does not reread dae27a4 Git blobs; Neural separate recomputation and eventual H4 read-path evidence retain that responsibility',
    },
    {
      pathClass: 'postgres-function-definitions',
      hashMode:
        'pg_get_functiondef output with CRLF and lone CR normalized to LF',
      consumerFixOnly: true,
      frozenValueUnchanged: true,
    },
    {
      pathClass: 'future-raw-http-capture',
      hashMode: 'exact bytes without normalization',
      excludedBecause: 'NOT_YET_MEASURED',
    },
    {
      pathClass: 'closed-root-manifest',
      hashMode: 'canonical-text',
      selfExcluded: true,
      externalPinRequired: true,
    },
  ],
  eolSensitiveComparisonInventory: {
    slotCount: artifacts.length,
    canonicalTextPaths: artifacts.map(({ filename }) => filename),
    everyPathTestedWithLfCrLfAndCr: true,
    everyPathSubstantiveMutationChangedHash: true,
    rawFutureCaptureDeliberatelyExcludedFromNormalization: true,
  },
  authorityValidation: {
    artifact: 'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json',
    canonicalTextSha256: validationEntry.canonicalTextSha256,
    canonicalJsonSha256: validationEntry.canonicalJsonSha256,
    outcome: 'PASS_R6_AUTHORITY_PREMEASUREMENT_ONLY',
    implementationStatus: 'NOT_YET_MEASURED',
  },
  policyDependencies: {
    artifact: 'HEARTH-003-POLICY-DEPENDENCIES-v2.json',
    canonicalTextSha256: policyEntry.canonicalTextSha256,
    canonicalJsonSha256: policyEntry.canonicalJsonSha256,
    sourceCommit: PRODUCT_COMMIT,
    applicationPolicyDependencySha256:
      'c440971239e10dc0b7d3a09646f2b3d71635c9f7d4b31e72e46b303e590ac1cf',
    migrationStateSha256:
      '0440365537129073377bbea05aa3b760f25573d4c008aab473b7f59e1072a585',
    completeDependencyTreeSha256:
      'bf76302b44c4ab3b5dab68270616dfa1a802f5720563008e3b56d2f09b585d1a',
  },
  selfExcluded: OUTPUT_FILENAME,
  selfExclusionReason:
    'The manifest cannot contain its own hash without a fixed point. Neural records its canonical-text SHA-256 outside this bundle.',
  provenance:
    'Apex Lumen authored the authority. SHA-256, local unsigned Git history, and Neural separate recomputation provide accidental-drift evidence only. Real PKI or an append-only external anchor remains an owner decision.',
  globalMeasurementStatus: 'NOT_YET_MEASURED',
  artifacts,
};

const outputBytes = Buffer.from(
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
const outputPath = join(artifactDir, OUTPUT_FILENAME);
if (process.argv.includes('--write')) {
  writeFileSync(outputPath, outputBytes);
  process.stdout.write(`wrote ${OUTPUT_FILENAME}\n`);
} else {
  const observed = readFileSync(outputPath);
  if (
    !canonicalTextBytes(observed, OUTPUT_FILENAME).equals(
      canonicalTextBytes(outputBytes, `${OUTPUT_FILENAME} generated`),
    )
  ) {
    throw new Error(`${OUTPUT_FILENAME} differs from the r6 freezer`);
  }
  process.stdout.write(`verified ${OUTPUT_FILENAME}\n`);
}
process.stdout.write(
  `HEARTH-003-r6 freeze PASS (${artifacts.length} closed artifacts; ${contract.crossBindings.length} cross-bindings; ${contract.slotContentBindings.length} fixed content bindings; every hash path inventoried)\n`,
);
