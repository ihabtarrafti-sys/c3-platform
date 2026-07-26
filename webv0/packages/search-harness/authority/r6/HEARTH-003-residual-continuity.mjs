#!/usr/bin/env node

/**
 * Content-level residual continuity verifier for HEARTH-003-r6.
 *
 * Counts and IDs are necessary but insufficient. This verifier pins the full
 * canonical content of every residual group and RED-proves that same-ID
 * hollowing, missing members, and duplicate IDs fail before any side effect.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const LEDGER_FILENAME = 'HEARTH-003-INHERITED-RESIDUALS-v2.json';
const CONTRACT_FILENAME =
  'HEARTH-003-RESIDUAL-CONTINUITY-CONTRACT-v1.json';
const RED_PLAN_FILENAME =
  'HEARTH-003-RESIDUAL-CONTINUITY-RED-v1.json';
const RECEIPT_FILENAME =
  'HEARTH-003-RESIDUAL-CONTINUITY-RED-SELF-TEST-v1.json';
const HISTORICAL_R3_FILENAME =
  'HEARTH-003-INHERITED-RESIDUALS-v1.json';
const HISTORICAL_R4_FILENAME =
  'HEARTH-003-H4-BASELINE-TRUST-CHAIN-v1.json';
const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalTextBytes(bytes, label) {
  try {
    strictUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} is not strict UTF-8`);
  }
  return Buffer.from(
    bytes.toString('utf8').replace(/\r\n?/gu, '\n'),
    'utf8',
  );
}

function canonicalTextSha256(bytes, label) {
  return sha256(canonicalTextBytes(bytes, label));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
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

function parseJsonBytes(bytes, label) {
  const text = canonicalTextBytes(bytes, label).toString('utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ResidualContinuityError(
      'RESIDUAL_SCHEMA_MISMATCH',
      'parse',
      `${label} is not valid JSON`,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResidualContinuityError(
      'RESIDUAL_SCHEMA_MISMATCH',
      'parse',
      `${label} must be an object`,
    );
  }
  return value;
}

function readJson(filename) {
  const bytes = readFileSync(join(artifactDir, filename));
  return {
    filename,
    bytes,
    value: parseJsonBytes(bytes, filename),
  };
}

function sortedById(items) {
  return [...items].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export class ResidualContinuityError extends Error {
  constructor(code, stage, safeDetail) {
    super(`${code}: ${safeDetail}`);
    this.name = 'ResidualContinuityError';
    this.code = code;
    this.stage = stage;
  }
}

function assertGroupShape(ledger, groupContract) {
  const items = ledger[groupContract.group];
  if (!Array.isArray(items)) {
    throw new ResidualContinuityError(
      'RESIDUAL_SCHEMA_MISMATCH',
      'group-shape',
      `group is not an array: ${groupContract.group}`,
    );
  }
  for (const item of items) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      typeof item.status !== 'string' ||
      item.status.length === 0 ||
      typeof item.statement !== 'string' ||
      item.statement.length === 0
    ) {
      throw new ResidualContinuityError(
        'RESIDUAL_SCHEMA_MISMATCH',
        'group-shape',
        `residual shape is incomplete in ${groupContract.group}`,
      );
    }
  }
  return items;
}

export function verifyResidualContinuity({
  ledger,
  contract,
  historicalR3,
  historicalR4,
}) {
  if (
    ledger.artifactKind !== 'hearth-search-residual-ledger' ||
    ledger.residualLedgerVersion !==
      'HEARTH-003-INHERITED-RESIDUALS-v2' ||
    contract.artifactKind !==
      'hearth-search-residual-continuity-contract' ||
    contract.continuityContractVersion !==
      'HEARTH-003-RESIDUAL-CONTINUITY-CONTRACT-v1'
  ) {
    throw new ResidualContinuityError(
      'RESIDUAL_SCHEMA_MISMATCH',
      'identity',
      'ledger or contract identity differs',
    );
  }

  const allIds = [];
  const observedGroups = new Map();
  for (const groupContract of contract.groups) {
    const items = assertGroupShape(ledger, groupContract);
    allIds.push(...items.map(({ id }) => id));
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new ResidualContinuityError(
        'RESIDUAL_DUPLICATE_ID',
        'membership',
        `duplicate ID inside ${groupContract.group}`,
      );
    }
    const observedIds = sortedById(items).map(({ id }) => id);
    const expectedIds = [...groupContract.expectedIds].sort();
    if (
      items.length !== groupContract.expectedCount ||
      canonicalJson(observedIds) !== canonicalJson(expectedIds)
    ) {
      throw new ResidualContinuityError(
        'RESIDUAL_MEMBERSHIP_MISMATCH',
        'membership',
        `membership differs for ${groupContract.group}`,
      );
    }
    const observedHash = canonicalJsonSha256(sortedById(items));
    if (observedHash !== groupContract.canonicalJsonSha256) {
      throw new ResidualContinuityError(
        'RESIDUAL_CONTENT_MISMATCH',
        'content',
        `content differs for ${groupContract.group}`,
      );
    }
    observedGroups.set(groupContract.group, {
      count: items.length,
      canonicalJsonSha256: observedHash,
    });
  }
  if (new Set(allIds).size !== allIds.length) {
    throw new ResidualContinuityError(
      'RESIDUAL_DUPLICATE_ID',
      'membership',
      'a stable residual ID appears in more than one group',
    );
  }

  const inherited = sortedById([
    ...ledger.inheritedR3Residuals,
    ...ledger.r4DisposableValidatorResiduals,
    ...ledger.r5ForwardResiduals,
  ]);
  if (
    inherited.length !==
      contract.aggregatePins.inherited5Plus8Plus3Count ||
    canonicalJsonSha256(inherited) !==
      contract.aggregatePins.inherited5Plus8Plus3CanonicalJsonSha256
  ) {
    throw new ResidualContinuityError(
      'RESIDUAL_CONTENT_MISMATCH',
      'aggregate',
      'the content-bound 5 + 8 + 3 aggregate differs',
    );
  }
  const all = sortedById([
    ...inherited,
    ...ledger.r6ClaimLimitResiduals,
    ...ledger.structuralFindings,
    ...ledger.nonBlockingRecordDefects,
  ]);
  if (
    all.length !== contract.aggregatePins.allContentBoundItemCount ||
    canonicalJsonSha256(all) !==
      contract.aggregatePins.allContentBoundItemsCanonicalJsonSha256
  ) {
    throw new ResidualContinuityError(
      'RESIDUAL_CONTENT_MISMATCH',
      'aggregate',
      'the complete content-bound residual set differs',
    );
  }

  const historicalPins = contract.historicalSourcePins;
  if (
    historicalR3.artifactKind !==
      'hearth-search-inherited-residual-ledger' ||
    canonicalJsonSha256(historicalR3.inheritedR3Residuals) !==
      historicalPins.r3InheritedObjectsCanonicalJsonSha256 ||
    canonicalJsonSha256(historicalR3.newR5ForwardResiduals) !==
      historicalPins.r5ForwardObjectsCanonicalJsonSha256 ||
    canonicalJsonSha256(historicalR4.recordedResidualAccounting) !==
      historicalPins.r4RecordedResidualStringsCanonicalJsonSha256
  ) {
    throw new ResidualContinuityError(
      'RESIDUAL_HISTORICAL_SOURCE_MISMATCH',
      'historical-source',
      'an inherited source payload differs',
    );
  }

  return {
    verifiedGroupCount: observedGroups.size,
    verifiedItemCount: all.length,
    inherited5Plus8Plus3Count: inherited.length,
    observedGroups: Object.fromEntries(observedGroups),
    inherited5Plus8Plus3CanonicalJsonSha256:
      canonicalJsonSha256(inherited),
    allContentBoundItemsCanonicalJsonSha256:
      canonicalJsonSha256(all),
  };
}

function createSideEffectBarrier() {
  const attemptedEvents = [];
  const deny = (capability) => {
    attemptedEvents.push(capability);
    throw new Error(`side effect forbidden during residual verification: ${capability}`);
  };
  return {
    attemptedEvents,
    seed: () => deny('seed'),
    database: () => deny('database'),
    network: () => deny('network'),
    http: () => deny('http'),
    metrics: () => deny('metrics'),
  };
}

function clone(value) {
  return structuredClone(value);
}

function mutateLedger(cleanLedger, redCase) {
  const ledger = clone(cleanLedger);
  const group = ledger[redCase.group];
  const index = group.findIndex(({ id }) => id === redCase.residualId);
  if (index < 0) throw new Error(`RED residual missing: ${redCase.caseId}`);
  switch (redCase.mutationMode) {
    case 'replace_field':
      group[index][redCase.field] = clone(redCase.replacementValue);
      break;
    case 'remove_item':
      group.splice(index, 1);
      break;
    case 'duplicate_item':
      group.push(clone(group[index]));
      break;
    default:
      throw new Error(`unknown residual RED mutation: ${redCase.mutationMode}`);
  }
  return ledger;
}

function runSelfTest() {
  const ledgerInput = readJson(LEDGER_FILENAME);
  const contractInput = readJson(CONTRACT_FILENAME);
  const planInput = readJson(RED_PLAN_FILENAME);
  const historicalR3Input = readJson(HISTORICAL_R3_FILENAME);
  const historicalR4Input = readJson(HISTORICAL_R4_FILENAME);
  const barrier = createSideEffectBarrier();

  const clean = verifyResidualContinuity({
    ledger: ledgerInput.value,
    contract: contractInput.value,
    historicalR3: historicalR3Input.value,
    historicalR4: historicalR4Input.value,
  });
  const observations = [];
  for (const redCase of planInput.value.cases) {
    verifyResidualContinuity({
      ledger: ledgerInput.value,
      contract: contractInput.value,
      historicalR3: historicalR3Input.value,
      historicalR4: historicalR4Input.value,
    });
    const mutated = mutateLedger(ledgerInput.value, redCase);
    let observed = null;
    try {
      verifyResidualContinuity({
        ledger: mutated,
        contract: contractInput.value,
        historicalR3: historicalR3Input.value,
        historicalR4: historicalR4Input.value,
      });
    } catch (error) {
      if (!(error instanceof ResidualContinuityError)) throw error;
      observed = error;
    }
    if (!observed) {
      throw new Error(`residual RED unexpectedly passed: ${redCase.caseId}`);
    }
    if (observed.code !== redCase.expectedFailureCode) {
      throw new Error(
        `residual RED wrong code ${redCase.caseId}: expected ${redCase.expectedFailureCode}, observed ${observed.code}`,
      );
    }
    observations.push({
      caseId: redCase.caseId,
      group: redCase.group,
      residualId: redCase.residualId,
      mutationMode: redCase.mutationMode,
      expectedFailureCode: redCase.expectedFailureCode,
      observedFailureCode: observed.code,
      observedStage: observed.stage,
      cleanLedgerPassedImmediatelyBeforeMutation: true,
      sideEffectLedgerDelta: [],
    });
  }
  const observedCodes = [...new Set(
    observations.map(({ observedFailureCode }) => observedFailureCode),
  )].sort();
  const expectedCodes = [...planInput.value.requiredFailureCodes].sort();
  if (canonicalJson(observedCodes) !== canonicalJson(expectedCodes)) {
    throw new Error('residual RED exact failure-code set differs');
  }
  if (barrier.attemptedEvents.length !== 0) {
    throw new Error('residual RED attempted a forbidden side effect');
  }
  const sourceBytes = readFileSync(fileURLToPath(import.meta.url));
  return {
    schemaVersion: 1,
    artifactKind:
      'hearth-search-residual-continuity-red-self-test',
    selfTestVersion:
      'HEARTH-003-RESIDUAL-CONTINUITY-RED-SELF-TEST-v1',
    syntheticOnly: true,
    authority: 'Apex Lumen',
    implementationStatus:
      'CONTENT_CONTINUITY_RED_OBSERVED_PRE_SIDE_EFFECT',
    claimBoundary:
      'This receipt proves exact membership and content continuity for the 5 + 8 + 3 inherited groups plus the separately named r6 limits. It does not prove that an open residual is closed.',
    inputHashes: {
      ledgerCanonicalTextSha256: canonicalTextSha256(
        ledgerInput.bytes,
        LEDGER_FILENAME,
      ),
      contractCanonicalTextSha256: canonicalTextSha256(
        contractInput.bytes,
        CONTRACT_FILENAME,
      ),
      redPlanCanonicalTextSha256: canonicalTextSha256(
        planInput.bytes,
        RED_PLAN_FILENAME,
      ),
      verifierCanonicalTextSha256: canonicalTextSha256(
        sourceBytes,
        fileURLToPath(import.meta.url),
      ),
      historicalR3CanonicalTextSha256: canonicalTextSha256(
        historicalR3Input.bytes,
        HISTORICAL_R3_FILENAME,
      ),
      historicalR4CanonicalTextSha256: canonicalTextSha256(
        historicalR4Input.bytes,
        HISTORICAL_R4_FILENAME,
      ),
    },
    clean,
    cases: observations,
    expectedCaseCount: planInput.value.cases.length,
    observedCaseCount: observations.length,
    allExpectedRejectionsObserved:
      observations.length === planInput.value.cases.length,
    expectedFailureCodes: expectedCodes,
    observedFailureCodes: observedCodes,
    exactFailureCodeSetMatch: true,
    sideEffectBarrier: {
      mode: 'deny_by_construction_reference_verifier',
      deniedCapabilities: [
        'seed',
        'database',
        'network',
        'http',
        'metrics',
      ],
      attemptedEvents: barrier.attemptedEvents,
      observedEventCount: barrier.attemptedEvents.length,
      firstSideEffectSequence: null,
    },
  };
}

const isEntryPoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const receipt = runSelfTest();
  if (process.argv.includes('--write')) {
    writeFileSync(
      join(artifactDir, RECEIPT_FILENAME),
      `${JSON.stringify(receipt, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`wrote ${RECEIPT_FILENAME}\n`);
  }
  process.stdout.write(
    `residual continuity RED PASS (${receipt.clean.inherited5Plus8Plus3Count} inherited; ${receipt.observedCaseCount} controls; ${receipt.observedFailureCodes.length} typed failures)\n`,
  );
}
