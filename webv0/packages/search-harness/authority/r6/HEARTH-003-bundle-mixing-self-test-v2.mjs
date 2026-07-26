#!/usr/bin/env node

/**
 * HEARTH-003 B4 r5-native bundle-mixing RED self-test.
 *
 * Baseline bytes come only from immutable authority commit 915b4354... .
 * All artifact mutations are derived from the verifier's clean `verified` map.
 * The runtime side-effect barrier is armed after every input is loaded and
 * remains armed through the full clean-plus-RED suite.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleVerificationError,
  canonicalJson,
  canonicalJsonSha256,
  canonicalTextBytes,
  canonicalTextSha256,
  parseJsonBytes,
  sha256,
  verifyAuthorityBundle,
} from './HEARTH-003-authority-bundle-verifier-v2.mjs';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const childProcess = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const Module = require('node:module');

const artifactDir = dirname(fileURLToPath(import.meta.url));
const PLAN_FILENAME = 'HEARTH-003-BUNDLE-MIXING-RED-v2.json';
const VERIFIER_FILENAME = 'HEARTH-003-authority-bundle-verifier-v2.mjs';
const RUNNER_FILENAME = 'HEARTH-003-bundle-mixing-self-test-v2.mjs';
const RECEIPT_FILENAME =
  'HEARTH-003-BUNDLE-MIXING-RED-SELF-TEST-v2.json';

function canonicalReceiptBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function gitBlob(commit, filename) {
  return childProcess.execFileSync(
    'git',
    [
      '-c',
      `safe.directory=${artifactDir.replaceAll('\\', '/')}`,
      'show',
      `${commit}:${filename}`,
    ],
    {
      cwd: artifactDir,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    },
  );
}

function assertEqual(observed, expected, label) {
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error(
      `${label} differs: expected ${canonicalJson(expected)}, observed ${canonicalJson(observed)}`,
    );
  }
}

function exactSorted(values) {
  return [...new Set(values)].sort();
}

function countIdentityAssertions(contract) {
  return contract.slots.reduce(
    (count, slot) => count + (slot.identities?.length ?? 0),
    0,
  );
}

function loadAllInputs() {
  const planBytes = fs.readFileSync(join(artifactDir, PLAN_FILENAME));
  const verifierBytes = fs.readFileSync(
    join(artifactDir, VERIFIER_FILENAME),
  );
  const runnerBytes = fs.readFileSync(join(artifactDir, RUNNER_FILENAME));
  const plan = parseJsonBytes(planBytes, PLAN_FILENAME);

  assertEqual(plan.schemaVersion, 2, 'RED plan schemaVersion');
  assertEqual(
    plan.redPlanVersion,
    'HEARTH-003-BUNDLE-MIXING-RED-v2',
    'RED plan version',
  );
  assertEqual(
    plan.cases.length,
    plan.acceptance.expectedCaseCount,
    'RED plan case count',
  );

  const commit = plan.baseline.authorityCommit;
  const manifestBytes = gitBlob(
    commit,
    plan.baseline.manifestFilename,
  );
  const contractBytes = gitBlob(
    commit,
    plan.baseline.contractFilename,
  );
  const frozenVerifierBytes = gitBlob(
    commit,
    plan.baseline.frozenVerifierFilename,
  );
  assertEqual(
    canonicalTextSha256(
      manifestBytes,
      plan.baseline.manifestFilename,
    ),
    plan.baseline.manifestCanonicalTextSha256,
    'immutable r5 manifest root',
  );
  assertEqual(
    canonicalTextSha256(
      contractBytes,
      plan.baseline.contractFilename,
    ),
    plan.baseline.contractCanonicalTextSha256,
    'immutable r5 contract hash',
  );
  assertEqual(
    canonicalTextSha256(
      frozenVerifierBytes,
      plan.baseline.frozenVerifierFilename,
    ),
    plan.baseline.frozenVerifierCanonicalTextSha256,
    'immutable r5 verifier hash',
  );

  const manifest = parseJsonBytes(
    manifestBytes,
    plan.baseline.manifestFilename,
  );
  const contract = parseJsonBytes(
    contractBytes,
    plan.baseline.contractFilename,
  );
  assertEqual(
    contract.slots.length,
    plan.baseline.expectedVerifiedSlotCount,
    'immutable r5 contract slot count',
  );
  assertEqual(
    countIdentityAssertions(contract),
    plan.baseline.expectedIdentityAssertionCount,
    'immutable r5 identity assertion count',
  );
  assertEqual(
    contract.crossBindings.length,
    plan.baseline.expectedCrossBindingCount,
    'immutable r5 cross-binding count',
  );

  const manifestFilenameSet = new Set(
    manifest.artifacts.map(({ filename }) => filename),
  );
  const entries = contract.slots.map(({ slot, filename }) => {
    if (!manifestFilenameSet.has(filename)) {
      throw new Error(`immutable r5 manifest omits ${filename}`);
    }
    return {
      slot,
      filename,
      bytes: gitBlob(commit, filename),
    };
  });

  const verifierImports = [
    ...verifierBytes
      .toString('utf8')
      .matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu),
  ].map((match) => match[1]);
  assertEqual(
    verifierImports.sort(),
    ['node:crypto', 'node:util'],
    'pure verifier import surface',
  );

  return {
    plan,
    planBytes,
    verifierBytes,
    runnerBytes,
    manifestBytes,
    contractBytes,
    frozenVerifierBytes,
    manifest,
    contract,
    entries,
    verifierImports,
  };
}

function effectiveContract(inputs) {
  const contract = JSON.parse(JSON.stringify(inputs.contract));
  contract.crossBindings.push(
    ...inputs.plan.pointerModePositiveControls.map((binding) => ({
      ...binding,
    })),
  );
  contract.slotContentBindings =
    inputs.plan.closureSlotContentBindings.map((binding) => ({
      ...binding,
    }));
  return contract;
}

function entriesFromVerified(verified, contract) {
  return contract.slots.map(({ slot }) => {
    const source = verified.get(slot);
    if (!source) {
      throw new Error(`clean verified map omits ${slot}`);
    }
    return {
      slot,
      filename: source.filename,
      bytes: Buffer.from(source.bytes),
    };
  });
}

function setPointer(root, pointer, replacementValue) {
  if (
    typeof pointer !== 'string' ||
    !pointer.startsWith('/') ||
    pointer === '/'
  ) {
    throw new Error(`unsupported mutation pointer ${pointer}`);
  }
  const parts = pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (
      parent === null ||
      typeof parent !== 'object' ||
      !(part in parent)
    ) {
      throw new Error(`mutation pointer is absent: ${pointer}`);
    }
    parent = parent[part];
  }
  const finalPart = parts.at(-1);
  if (
    parent === null ||
    typeof parent !== 'object' ||
    !(finalPart in parent)
  ) {
    throw new Error(`mutation pointer is absent: ${pointer}`);
  }
  parent[finalPart] = replacementValue;
}

function replaceManifestEntry(manifest, filename, bytes) {
  const entry = manifest.artifacts.find(
    (candidate) => candidate.filename === filename,
  );
  if (!entry) throw new Error(`manifest entry is absent: ${filename}`);
  const canonicalBytes = canonicalTextBytes(bytes, filename);
  entry.canonicalByteLength = canonicalBytes.length;
  entry.canonicalTextSha256 = sha256(canonicalBytes);
  if (filename.endsWith('.json')) {
    entry.canonicalJsonSha256 = canonicalJsonSha256(
      parseJsonBytes(bytes, filename),
    );
  }
}

function createTimeline() {
  let sequence = 0;
  const events = [];
  return {
    mark(event, detail = {}) {
      sequence += 1;
      events.push({ sequence, event, ...detail });
      return sequence;
    },
    current() {
      return sequence;
    },
    events,
  };
}

function installSideEffectBarrier(timeline) {
  const attemptedEvents = [];
  const restorers = [];
  const patchedRuntimeEntrypoints = [];
  let armed = true;

  const deny = (capability, entrypoint) => {
    const sequence = timeline.mark('side-effect-attempt', {
      capability,
      entrypoint,
    });
    const event = { sequence, capability, entrypoint };
    attemptedEvents.push(event);
    const error = new Error(
      `B4_SIDE_EFFECT_ATTEMPT: ${capability} via ${entrypoint}`,
    );
    error.code = 'B4_SIDE_EFFECT_ATTEMPT';
    throw error;
  };

  const patch = (target, key, capability, label) => {
    if (!target || typeof target[key] !== 'function') return;
    const original = target[key];
    target[key] = function deniedRuntimeEntrypoint() {
      return deny(capability, label);
    };
    patchedRuntimeEntrypoints.push(label);
    restorers.push(() => {
      target[key] = original;
    });
  };

  for (const key of [
    'writeFile',
    'writeFileSync',
    'appendFile',
    'appendFileSync',
    'rename',
    'renameSync',
    'unlink',
    'unlinkSync',
    'rm',
    'rmSync',
    'mkdir',
    'mkdirSync',
    'truncate',
    'truncateSync',
    'copyFile',
    'copyFileSync',
  ]) {
    patch(fs, key, 'filesystem-mutation', `node:fs.${key}`);
  }
  for (const key of [
    'exec',
    'execFile',
    'execFileSync',
    'execSync',
    'fork',
    'spawn',
    'spawnSync',
  ]) {
    patch(
      childProcess,
      key,
      'child-process-or-seeder-start',
      `node:child_process.${key}`,
    );
  }
  for (const [moduleObject, moduleName, keys] of [
    [http, 'node:http', ['request', 'get']],
    [https, 'node:https', ['request', 'get']],
    [net, 'node:net', ['connect', 'createConnection']],
    [tls, 'node:tls', ['connect']],
    [dgram, 'node:dgram', ['createSocket']],
  ]) {
    for (const key of keys) {
      patch(moduleObject, key, 'network-or-http', `${moduleName}.${key}`);
    }
  }

  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function deniedFetch() {
      return deny('network-or-http', 'globalThis.fetch');
    };
    patchedRuntimeEntrypoints.push('globalThis.fetch');
    restorers.push(() => {
      globalThis.fetch = originalFetch;
    });
  }

  const originalModuleLoad = Module._load;
  Module._load = function guardedModuleLoad(request, parent, isMain) {
    if (
      /\b(pg|postgres|database|metric|prom-client|opentelemetry)\b/iu.test(
        String(request),
      )
    ) {
      return deny(
        'database-or-metrics-module-load',
        `node:module._load:${request}`,
      );
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  patchedRuntimeEntrypoints.push(
    'node:module._load(database-or-metrics-pattern)',
  );
  restorers.push(() => {
    Module._load = originalModuleLoad;
  });

  return {
    attemptedEvents,
    patchedRuntimeEntrypoints,
    isArmed() {
      return armed;
    },
    disarm() {
      if (!armed) return;
      for (const restore of restorers.reverse()) restore();
      armed = false;
    },
  };
}

function mutateCase(redCase, clean, baseline, timeline) {
  let manifestBytes = Buffer.from(baseline.manifestBytes);
  let externallySuppliedRoot =
    baseline.plan.baseline.manifestCanonicalTextSha256;
  let mutationRoot = externallySuppliedRoot;
  const entries = entriesFromVerified(clean.verified, baseline.contract);
  let originalCanonicalTextSha256 = null;
  let mutatedCanonicalTextSha256 = null;
  let sourceBytesOrigin = 'cleanVerifiedMap';

  const findEntry = () => {
    const entry = entries.find(
      (candidate) => candidate.slot === redCase.logicalSlot,
    );
    if (!entry) {
      throw new Error(`mutation slot is absent: ${redCase.logicalSlot}`);
    }
    return entry;
  };

  switch (redCase.mutationMode) {
    case 'append_manifest_canonical_lf_keep_external_root': {
      sourceBytesOrigin = 'rootVerifiedImmutableManifestBytes';
      originalCanonicalTextSha256 = canonicalTextSha256(
        manifestBytes,
        baseline.plan.baseline.manifestFilename,
      );
      manifestBytes = Buffer.concat([
        manifestBytes,
        Buffer.from(redCase.appendUtf8, 'utf8'),
      ]);
      mutationRoot = canonicalTextSha256(
        manifestBytes,
        `${redCase.caseId} manifest`,
      );
      mutatedCanonicalTextSha256 = mutationRoot;
      break;
    }
    case 'omit_verified_slot': {
      const entry = findEntry();
      originalCanonicalTextSha256 = canonicalTextSha256(
        entry.bytes,
        entry.filename,
      );
      const index = entries.indexOf(entry);
      entries.splice(index, 1);
      mutatedCanonicalTextSha256 = null;
      break;
    }
    case 'add_unexpected_slot': {
      sourceBytesOrigin = 'syntheticClosedSetProbe';
      const bytes = Buffer.from('synthetic unexpected B4 slot\n', 'utf8');
      entries.push({
        slot: redCase.logicalSlot,
        filename: 'unexpected-synthetic-b4-slot.txt',
        bytes,
      });
      mutatedCanonicalTextSha256 = canonicalTextSha256(
        bytes,
        redCase.logicalSlot,
      );
      break;
    }
    case 'duplicate_verified_slot': {
      const entry = findEntry();
      originalCanonicalTextSha256 = canonicalTextSha256(
        entry.bytes,
        entry.filename,
      );
      entries.push({
        slot: entry.slot,
        filename: entry.filename,
        bytes: Buffer.from(entry.bytes),
      });
      mutatedCanonicalTextSha256 = originalCanonicalTextSha256;
      break;
    }
    case 'append_verified_bytes_keep_manifest':
    case 'append_verified_bytes_rehash_manifest_repin': {
      const entry = findEntry();
      originalCanonicalTextSha256 = canonicalTextSha256(
        entry.bytes,
        entry.filename,
      );
      entry.bytes = Buffer.concat([
        Buffer.from(entry.bytes),
        Buffer.from(redCase.appendUtf8, 'utf8'),
      ]);
      mutatedCanonicalTextSha256 = canonicalTextSha256(
        entry.bytes,
        entry.filename,
      );
      if (
        redCase.mutationMode ===
        'append_verified_bytes_rehash_manifest_repin'
      ) {
        const manifest = parseJsonBytes(
          baseline.manifestBytes,
          baseline.plan.baseline.manifestFilename,
        );
        replaceManifestEntry(manifest, entry.filename, entry.bytes);
        manifestBytes = canonicalReceiptBytes(manifest);
        mutationRoot = canonicalTextSha256(
          manifestBytes,
          `${redCase.caseId} manifest`,
        );
        externallySuppliedRoot = mutationRoot;
      }
      break;
    }
    case 'mutate_verified_json_pointer_rehash_manifest_repin': {
      const entry = findEntry();
      originalCanonicalTextSha256 = canonicalTextSha256(
        entry.bytes,
        entry.filename,
      );
      const parsed = parseJsonBytes(entry.bytes, entry.filename);
      setPointer(parsed, redCase.jsonPointer, redCase.replacementValue);
      entry.bytes = canonicalReceiptBytes(parsed);
      mutatedCanonicalTextSha256 = canonicalTextSha256(
        entry.bytes,
        entry.filename,
      );
      const manifest = parseJsonBytes(
        baseline.manifestBytes,
        baseline.plan.baseline.manifestFilename,
      );
      replaceManifestEntry(manifest, entry.filename, entry.bytes);
      manifestBytes = canonicalReceiptBytes(manifest);
      mutationRoot = canonicalTextSha256(
        manifestBytes,
        `${redCase.caseId} manifest`,
      );
      externallySuppliedRoot = mutationRoot;
      break;
    }
    default:
      throw new Error(
        `unknown RED mutation mode: ${redCase.mutationMode}`,
      );
  }

  const mutationAppliedSequence = timeline.mark('mutation-applied', {
    caseId: redCase.caseId,
    logicalSlot: redCase.logicalSlot,
  });
  return {
    manifestBytes,
    externallySuppliedRoot,
    mutationRoot,
    entries,
    originalCanonicalTextSha256,
    mutatedCanonicalTextSha256,
    sourceBytesOrigin,
    mutationAppliedSequence,
  };
}

export function runSelfTest() {
  const inputs = loadAllInputs();
  const timeline = createTimeline();
  const effective = effectiveContract(inputs);
  const barrier = installSideEffectBarrier(timeline);
  const barrierArmedSequence = timeline.mark('side-effect-barrier-armed');

  let receipt;
  try {
    const actualCleanStartSequence = timeline.mark(
      'actual-r5-clean-verify-start',
    );
    const actualClean = verifyAuthorityBundle({
      manifestBytes: inputs.manifestBytes,
      externallyPinnedManifestSha256:
        inputs.plan.baseline.manifestCanonicalTextSha256,
      contract: inputs.contract,
      entries: inputs.entries,
    });
    const actualCleanPassSequence = timeline.mark(
      'actual-r5-clean-verify-pass',
    );

    assertEqual(
      actualClean.verifiedSlotCount,
      inputs.plan.baseline.expectedVerifiedSlotCount,
      'actual r5 verified slot count',
    );
    assertEqual(
      actualClean.identityAssertionCount,
      inputs.plan.baseline.expectedIdentityAssertionCount,
      'actual r5 identity count',
    );
    assertEqual(
      actualClean.crossBindingCount,
      inputs.plan.baseline.expectedCrossBindingCount,
      'actual r5 cross-binding count',
    );

    const effectiveCleanStartSequence = timeline.mark(
      'effective-clean-verify-start',
    );
    const effectiveClean = verifyAuthorityBundle({
      manifestBytes: inputs.manifestBytes,
      externallyPinnedManifestSha256:
        inputs.plan.baseline.manifestCanonicalTextSha256,
      contract: effective,
      entries: inputs.entries,
    });
    const effectiveCleanPassSequence = timeline.mark(
      'effective-clean-verify-pass',
    );
    assertEqual(
      effectiveClean.crossBindingCount,
      inputs.plan.baseline.expectedCrossBindingCount +
        inputs.plan.pointerModePositiveControls.length,
      'effective cross-binding count',
    );
    assertEqual(
      effectiveClean.slotContentBindingCount,
      inputs.plan.closureSlotContentBindings.length,
      'effective slot-content binding count',
    );

    const observations = [];
    for (const redCase of inputs.plan.cases) {
      const effectLedgerStartIndex = barrier.attemptedEvents.length;
      const cleanVerifyStartSequence = timeline.mark(
        'case-clean-verify-start',
        { caseId: redCase.caseId },
      );
      const clean = verifyAuthorityBundle({
        manifestBytes: inputs.manifestBytes,
        externallyPinnedManifestSha256:
          inputs.plan.baseline.manifestCanonicalTextSha256,
        contract: effective,
        entries: inputs.entries,
      });
      const cleanVerifyPassSequence = timeline.mark(
        'case-clean-verify-pass',
        { caseId: redCase.caseId },
      );
      const mutation = mutateCase(
        redCase,
        clean,
        {
          ...inputs,
          contract: effective,
        },
        timeline,
      );
      const mutatedVerifyStartSequence = timeline.mark(
        'case-mutated-verify-start',
        { caseId: redCase.caseId },
      );

      let observed = null;
      try {
        verifyAuthorityBundle({
          manifestBytes: mutation.manifestBytes,
          externallyPinnedManifestSha256:
            mutation.externallySuppliedRoot,
          contract: effective,
          entries: mutation.entries,
        });
      } catch (error) {
        if (!(error instanceof BundleVerificationError)) throw error;
        observed = error;
      }
      if (!observed) {
        throw new Error(
          `bundle-mixing RED unexpectedly passed: ${redCase.caseId}`,
        );
      }
      const failureObservedSequence = timeline.mark(
        'case-expected-failure-observed',
        {
          caseId: redCase.caseId,
          code: observed.code,
          stage: observed.stage,
        },
      );
      if (
        observed.code !== redCase.expectedFailureCode ||
        observed.stage !== redCase.expectedStage
      ) {
        throw new Error(
          `bundle-mixing RED wrong verdict ${redCase.caseId}: expected ${redCase.expectedFailureCode}/${redCase.expectedStage}, observed ${observed.code}/${observed.stage}`,
        );
      }
      const effectLedgerDelta = barrier.attemptedEvents.slice(
        effectLedgerStartIndex,
      );
      if (effectLedgerDelta.length !== 0) {
        throw new Error(
          `bundle-mixing RED attempted a side effect: ${redCase.caseId}`,
        );
      }

      observations.push({
        caseId: redCase.caseId,
        logicalSlot: redCase.logicalSlot,
        mutationMode: redCase.mutationMode,
        sourceBytesOrigin: mutation.sourceBytesOrigin,
        originalCanonicalTextSha256:
          mutation.originalCanonicalTextSha256,
        mutatedCanonicalTextSha256:
          mutation.mutatedCanonicalTextSha256,
        manifestTreatment: redCase.manifestTreatment,
        baselineRoot:
          inputs.plan.baseline.manifestCanonicalTextSha256,
        mutationRoot: mutation.mutationRoot,
        externallySuppliedRoot: mutation.externallySuppliedRoot,
        expectedFailureCode: redCase.expectedFailureCode,
        expectedStage: redCase.expectedStage,
        observedFailureCode: observed.code,
        observedStage: observed.stage,
        cleanBundlePassedImmediatelyBeforeMutation: true,
        unexpectedPass: false,
        wrongFailureCodeOrStage: false,
        cleanVerifyStartSequence,
        cleanVerifyPassSequence,
        mutationAppliedSequence: mutation.mutationAppliedSequence,
        mutatedVerifyStartSequence,
        failureObservedSequence,
        firstSideEffectSequence: null,
        observedSideEffectEvents: effectLedgerDelta,
        observedSideEffectEventCount: effectLedgerDelta.length,
      });
    }

    const expectedCodes = exactSorted(
      inputs.plan.requiredFailureCodes,
    );
    const observedCodes = exactSorted(
      observations.map(({ observedFailureCode }) => observedFailureCode),
    );
    assertEqual(observedCodes, expectedCodes, 'exact RED failure code set');
    assertEqual(
      observations.length,
      inputs.plan.acceptance.expectedCaseCount,
      'observed RED case count',
    );
    const expectedClosureSlots = exactSorted(
      inputs.plan.closureSlotContentBindings.map(({ slot }) => slot),
    );
    const observedClosureSlots = exactSorted(
      observations
        .filter(
          ({ expectedFailureCode }) =>
            expectedFailureCode ===
            'AUTHORITY_BUNDLE_CROSS_BINDING_MISMATCH',
        )
        .map(({ logicalSlot }) => logicalSlot),
    );
    assertEqual(
      observedClosureSlots,
      expectedClosureSlots,
      'four-slot closure coverage',
    );
    if (barrier.attemptedEvents.length !== 0) {
      throw new Error('runtime side-effect ledger is not empty');
    }
    const suiteValidatedSequence = timeline.mark(
      'suite-acceptance-validated',
    );

    receipt = {
      schemaVersion: 2,
      artifactKind:
        'hearth-search-authority-bundle-mixing-red-self-test',
      selfTestVersion:
        'HEARTH-003-BUNDLE-MIXING-RED-SELF-TEST-v2',
      syntheticOnly: true,
      authority: 'Apex Lumen',
      implementationStatus:
        'AUTHORITY_REFERENCE_R5_NATIVE_RED_OBSERVED_BEFORE_SIDE_EFFECTS',
      claimBoundary:
        'This receipt proves the pure v2 verifier clean-verifies the immutable actual-r5 37-slot/38-identity/33-cross-binding bundle at Neural root fe1fdd3f..., positively exercises three forward pointer modes, and rejects ten in-memory mutations including all four formerly substitutable text slots under four supplemental exact-content bindings. It neither amends the recorded r5 bundle nor creates a production contract, and it is not an H1/H4 measurement certificate. The future reviewed bundle contract remains the production carrier of equivalent bindings.',
      baseline: {
        authorityRevision: inputs.plan.baseline.authorityRevision,
        authorityCommit: inputs.plan.baseline.authorityCommit,
        manifestFilename: inputs.plan.baseline.manifestFilename,
        manifestCanonicalTextSha256:
          actualClean.manifestCanonicalTextSha256,
        contractFilename: inputs.plan.baseline.contractFilename,
        contractCanonicalTextSha256:
          inputs.plan.baseline.contractCanonicalTextSha256,
        frozenVerifierFilename:
          inputs.plan.baseline.frozenVerifierFilename,
        frozenVerifierCanonicalTextSha256:
          inputs.plan.baseline.frozenVerifierCanonicalTextSha256,
        verifiedSlotCount: actualClean.verifiedSlotCount,
        identityAssertionCount: actualClean.identityAssertionCount,
        originalCrossBindingCount: actualClean.crossBindingCount,
        actualR5ContractCleanBundlePassed: true,
        actualCleanStartSequence,
        actualCleanPassSequence,
      },
      effectiveAuthorityReferenceContract: {
        verifiedSlotCount: effectiveClean.verifiedSlotCount,
        originalCrossBindingCount:
          inputs.plan.baseline.expectedCrossBindingCount,
        pointerModePositiveControlCount:
          inputs.plan.pointerModePositiveControls.length,
        effectiveCrossBindingCount: effectiveClean.crossBindingCount,
        supplementalSlotContentBindingCount:
          effectiveClean.slotContentBindingCount,
        effectiveCleanBundlePassed: true,
        effectiveCleanStartSequence,
        effectiveCleanPassSequence,
        pointerModePositiveControls:
          inputs.plan.pointerModePositiveControls.map((binding) => ({
            bindingId: binding.bindingId,
            expectedFrom: binding.expectedFrom,
            outcome: 'PASS',
          })),
        closureSlotContentBindings:
          inputs.plan.closureSlotContentBindings.map((binding) => ({
            ...binding,
            cleanOutcome: 'PASS',
          })),
      },
      inputHashes: {
        redPlanCanonicalTextSha256: canonicalTextSha256(
          inputs.planBytes,
          PLAN_FILENAME,
        ),
        verifierV2CanonicalTextSha256: canonicalTextSha256(
          inputs.verifierBytes,
          VERIFIER_FILENAME,
        ),
        runnerV2CanonicalTextSha256: canonicalTextSha256(
          inputs.runnerBytes,
          RUNNER_FILENAME,
        ),
        baselineManifestCanonicalTextSha256:
          actualClean.manifestCanonicalTextSha256,
        baselineContractCanonicalTextSha256: canonicalTextSha256(
          inputs.contractBytes,
          inputs.plan.baseline.contractFilename,
        ),
        baselineFrozenVerifierCanonicalTextSha256:
          canonicalTextSha256(
            inputs.frozenVerifierBytes,
            inputs.plan.baseline.frozenVerifierFilename,
          ),
      },
      verifierPurityAttestation: {
        staticImports: inputs.verifierImports,
        allowedStaticImports: ['node:crypto', 'node:util'],
        forbiddenSideEffectModuleImports: [],
        outcome: 'PASS',
      },
      cases: observations,
      aggregate: {
        expectedCaseCount:
          inputs.plan.acceptance.expectedCaseCount,
        observedCaseCount: observations.length,
        allCasesObserved: true,
        allExpectedRejectionsObserved: true,
        requiredFailureCodesExpected: expectedCodes,
        requiredFailureCodesObserved: observedCodes,
        exactFailureCodeSetMatched: true,
        cleanReverifiedBeforeEveryMutation: true,
        everyArtifactMutationUsedCleanVerifiedBytes:
          observations
            .filter(
              ({ logicalSlot }) => logicalSlot !== 'root-manifest',
            )
            .filter(
              ({ sourceBytesOrigin }) =>
                sourceBytesOrigin !== 'syntheticClosedSetProbe',
            )
            .every(
              ({ sourceBytesOrigin }) =>
                sourceBytesOrigin === 'cleanVerifiedMap',
            ),
        counterexampleSlotCoverage: observedClosureSlots,
        allFourFormerlySubstitutableSlotsRejectedIndependently: true,
      },
      sideEffectBarrier: {
        armedAfterAllImmutableInputsLoaded: true,
        barrierArmedSequence,
        armedThroughSuiteAcceptanceValidation: barrier.isArmed(),
        suiteValidatedSequence,
        mode: 'runtime-entrypoint-deny-and-record',
        deniedCapabilities:
          inputs.plan.runtimeSideEffectContract.deniedCapabilities,
        patchedRuntimeEntrypoints:
          barrier.patchedRuntimeEntrypoints,
        attemptedEvents: [...barrier.attemptedEvents],
        observedEventCount: barrier.attemptedEvents.length,
        firstSideEffectSequence:
          barrier.attemptedEvents[0]?.sequence ?? null,
        receiptWritePermittedOnlyAfterBarrierDisarm: true,
      },
      verificationTimeline: {
        finalSequenceBeforeReceiptConstruction: timeline.current(),
        events: timeline.events,
      },
    };

  } finally {
    barrier.disarm();
  }

  if (!receipt) {
    throw new Error('B4 self-test did not produce a receipt');
  }
  receipt.sideEffectBarrier.barrierDisarmedAfterSuiteValidation = true;
  receipt.sideEffectBarrier.barrierArmedDuringReceiptWrite = false;
  receipt.receiptIntegrity = {
    algorithm: 'sha256',
    canonicalization: 'recursive-key-sort-json-utf8-no-trailing-lf',
    scope: 'final receipt object before receiptIntegrity is added',
    canonicalJsonSha256ExcludingReceiptIntegrity:
      canonicalJsonSha256(receipt),
  };
  const receiptBytes = canonicalReceiptBytes(receipt);
  fs.writeFileSync(join(artifactDir, RECEIPT_FILENAME), receiptBytes);

  return {
    receipt,
    receiptBytes,
    receiptFilename: RECEIPT_FILENAME,
    receiptCanonicalTextSha256: canonicalTextSha256(
      receiptBytes,
      RECEIPT_FILENAME,
    ),
    receiptCanonicalJsonSha256: canonicalJsonSha256(receipt),
    receiptByteLength: receiptBytes.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runSelfTest();
  process.stdout.write(
    `${JSON.stringify(
      {
        outcome: 'PASS',
        receiptFilename: result.receiptFilename,
        receiptByteLength: result.receiptByteLength,
        receiptCanonicalTextSha256:
          result.receiptCanonicalTextSha256,
        receiptCanonicalJsonSha256:
          result.receiptCanonicalJsonSha256,
        verifiedSlotCount:
          result.receipt.baseline.verifiedSlotCount,
        originalCrossBindingCount:
          result.receipt.baseline.originalCrossBindingCount,
        effectiveCrossBindingCount:
          result.receipt.effectiveAuthorityReferenceContract
            .effectiveCrossBindingCount,
        supplementalSlotContentBindingCount:
          result.receipt.effectiveAuthorityReferenceContract
            .supplementalSlotContentBindingCount,
        observedCaseCount:
          result.receipt.aggregate.observedCaseCount,
        requiredFailureCodesObserved:
          result.receipt.aggregate.requiredFailureCodesObserved,
        counterexampleSlotCoverage:
          result.receipt.aggregate.counterexampleSlotCoverage,
        observedSideEffectEventCount:
          result.receipt.sideEffectBarrier.observedEventCount,
      },
      null,
      2,
    )}\n`,
  );
}
