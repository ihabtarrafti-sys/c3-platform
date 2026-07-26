#!/usr/bin/env node

/**
 * Materialize the HEARTH-003-r6 authority validation receipt.
 *
 * This script validates already-authored authority inputs. It never writes or
 * amends qrels, fixtures, predicates, baselines, residuals, RED receipts, or
 * product files. Its sole optional output is R6-AUTHORITY-VALIDATION-v1.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import { verifyResidualContinuity } from './HEARTH-003-residual-continuity.mjs';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILENAME = 'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json';
const PRODUCT_COMMIT = 'dae27a400868c0c686788ab8e5520690dbf77334';
const R5_AUTHORITY_COMMIT = '915b4354cdb41a75b98053b3db51226222d2718e';
const R5_ROOT =
  'fe1fdd3fb4e9624b32485bc7967f98c663ff3c3f311dca61d887243927776249';
const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

const INPUTS = {
  gitattributes: '.gitattributes',
  actorClasses: 'HEARTH-003-ACTOR-CLASSES-v2.json',
  authoritativeFieldScope:
    'HEARTH-003-AUTHORITATIVE-FIELD-SCOPE-v1.json',
  authoritativePredicates:
    'HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json',
  driftBaseline:
    'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json',
  residualLedger: 'HEARTH-003-INHERITED-RESIDUALS-v2.json',
  residualContract:
    'HEARTH-003-RESIDUAL-CONTINUITY-CONTRACT-v1.json',
  residualRedPlan:
    'HEARTH-003-RESIDUAL-CONTINUITY-RED-v1.json',
  residualRedReceipt:
    'HEARTH-003-RESIDUAL-CONTINUITY-RED-SELF-TEST-v1.json',
  residualVerifier: 'HEARTH-003-residual-continuity.mjs',
  driftRedPlan:
    'HEARTH-003-DISCLOSURE-DRIFT-RED-CONTROLS-v1.json',
  driftRedReceipt:
    'HEARTH-003-DISCLOSURE-DRIFT-RED-SELF-TEST-v1.json',
  driftChecker: 'HEARTH-003-disclosure-drift-checker.mjs',
  metricReceipt: 'HEARTH-003-METRIC-SATISFIABILITY-v2.json',
  metricSource: 'HEARTH-003-metric-satisfiability-v2.mjs',
  bundleRedPlan: 'HEARTH-003-BUNDLE-MIXING-RED-v2.json',
  bundleRedReceipt:
    'HEARTH-003-BUNDLE-MIXING-RED-SELF-TEST-v2.json',
  bundleVerifier: 'HEARTH-003-authority-bundle-verifier-v2.mjs',
  bundleRedRunner: 'HEARTH-003-bundle-mixing-self-test-v2.mjs',
  implementationDrift:
    'HEARTH-003-IMPLEMENTATION-DRIFT-DIFF-v1.json',
  implementationDriftSource:
    'HEARTH-003-r6-disclosure-drift-diff.ts',
  qrelsV7: 'HEARTH-003-QRELS-v7.json',
  fixture: 'HEARTH-003-FIXTURE-CONTRACT-v5.json',
  coverage: 'HEARTH-003-COVERAGE-v7.json',
  delegation: 'HEARTH-003-DELEGATION-MEASUREMENT-v2.json',
  trust: 'HEARTH-003-H4-BASELINE-TRUST-CHAIN-v3.json',
  physicalManifest: 'HEARTH-003-PHYSICAL-DOMAIN-MANIFEST-v3.json',
  physicalValidation:
    'HEARTH-003-PHYSICAL-DOMAIN-VALIDATION-v3.json',
  policyDependencies: 'HEARTH-003-POLICY-DEPENDENCIES-v2.json',
  projectionParser: 'HEARTH-003-projection-authority-parser.ts',
  physicalValidator: 'HEARTH-003-physical-domain-validator.ts',
  goldAuthority: 'HEARTH-003-r6-GOLD-SET-AUTHORITY.md',
  materializationContract:
    'HEARTH-003-r6-MATERIALIZATION-CONTRACT.md',
  freezer: 'HEARTH-003-r6-freeze-hashes.mjs',
};

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

function canonicalJsonLfSha256(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function uint64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function dependencyTreeSha256(tree, label) {
  assert(
    tree.framing === 'C3_HEARTH_DEPENDENCY_TREE_V1' &&
      Array.isArray(tree.entries) &&
      tree.fileCount === tree.entries.length,
    `${label} dependency tree shape differs`,
  );
  const ordered = [...tree.entries].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.path, 'utf8'),
      Buffer.from(right.path, 'utf8'),
    ),
  );
  assert(
    new Set(ordered.map(({ path }) => path)).size === ordered.length,
    `${label} repeats a dependency path`,
  );
  const chunks = [
    Buffer.from('C3_HEARTH_DEPENDENCY_TREE_V1\0', 'ascii'),
    uint32(ordered.length),
  ];
  for (const entry of ordered) {
    assert(
      ['100644', '100755'].includes(entry.mode) &&
        ['text', 'binary'].includes(entry.contentKind) &&
        Number.isSafeInteger(entry.canonicalByteLength) &&
        entry.canonicalByteLength >= 0 &&
        /^[0-9a-f]{64}$/u.test(entry.canonicalContentSha256),
      `${label} contains an invalid framed entry: ${entry.path}`,
    );
    const pathBytes = Buffer.from(entry.path, 'utf8');
    chunks.push(
      Buffer.from(entry.mode, 'ascii'),
      Buffer.from([entry.contentKind === 'text' ? 0x01 : 0x02]),
      uint32(pathBytes.length),
      pathBytes,
      uint64(entry.canonicalByteLength),
      Buffer.from(entry.canonicalContentSha256, 'hex'),
    );
  }
  return sha256(Buffer.concat(chunks));
}

function parseInput(filename) {
  const bytes = readFileSync(join(artifactDir, filename));
  const canonicalBytes = canonicalTextBytes(bytes, filename);
  const isJson = filename.endsWith('.json');
  return {
    filename,
    bytes,
    canonicalTextSha256: sha256(canonicalBytes),
    value: isJson
      ? JSON.parse(canonicalBytes.toString('utf8'))
      : null,
  };
}

function parseHistoricalJson(filename) {
  const bytes = execFileSync(
    'git',
    ['show', `${R5_AUTHORITY_COMMIT}:${filename}`],
    {
      cwd: artifactDir,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return JSON.parse(
    canonicalTextBytes(bytes, `${R5_AUTHORITY_COMMIT}:${filename}`)
      .toString('utf8'),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(left, right, label) {
  assert(
    canonicalJson(left) === canonicalJson(right),
    `${label} differs`,
  );
}

function replaceJudgmentKey(value, from, to) {
  if (Array.isArray(value)) {
    return value.map((item) => replaceJudgmentKey(item, from, to));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key === from ? to : key,
        replaceJudgmentKey(item, from, to),
      ]),
    );
  }
  return value;
}

function containsObjectKey(value, targetKey) {
  if (Array.isArray(value)) {
    return value.some((item) => containsObjectKey(item, targetKey));
  }
  if (value && typeof value === 'object') {
    return (
      Object.prototype.hasOwnProperty.call(value, targetKey) ||
      Object.values(value).some((item) =>
        containsObjectKey(item, targetKey),
      )
    );
  }
  return false;
}

function collectProjectionFields(expression, result = new Set()) {
  if (expression && typeof expression === 'object') {
    if (expression.op === 'field') result.add(expression.path);
    if (Array.isArray(expression)) {
      for (const item of expression) {
        collectProjectionFields(item, result);
      }
    } else {
      for (const value of Object.values(expression)) {
        collectProjectionFields(value, result);
      }
    }
  }
  return result;
}

const loaded = Object.fromEntries(
  Object.entries(INPUTS).map(([key, filename]) => [
    key,
    parseInput(filename),
  ]),
);
const materializerSourceBytes = readFileSync(fileURLToPath(import.meta.url));

const qrelsV6 = parseHistoricalJson('HEARTH-003-QRELS-v6.json');
const historicalResiduals = parseHistoricalJson(
  'HEARTH-003-INHERITED-RESIDUALS-v1.json',
);
const historicalTrust = parseHistoricalJson(
  'HEARTH-003-H4-BASELINE-TRUST-CHAIN-v1.json',
);
const qrelsV7 = loaded.qrelsV7.value;
const baseline = loaded.driftBaseline.value;
const fieldScope = loaded.authoritativeFieldScope.value;
const fixture = loaded.fixture.value;
const residualReceipt = loaded.residualRedReceipt.value;
const driftReceipt = loaded.driftRedReceipt.value;
const metricReceipt = loaded.metricReceipt.value;
const bundleReceipt = loaded.bundleRedReceipt.value;
const implementationDrift = loaded.implementationDrift.value;
const physicalManifest = loaded.physicalManifest.value;
const physicalValidation = loaded.physicalValidation.value;
const policyDependencies = loaded.policyDependencies.value;
const trust = loaded.trust.value;

assert(
  qrelsV7.querySetVersion === 'HEARTH-003-QRELS-v7' &&
    qrelsV7.cases.length === 280,
  'QRELS-v7 identity or case count differs',
);
assert(
  !containsObjectKey(qrelsV7, 'approvedActorClasses'),
  'QRELS-v7 retains an approval-authority judgment key',
);
let baselineJudgmentCount = 0;
for (const queryCase of qrelsV7.cases) {
  for (const judgment of queryCase.sourceJudgments) {
    assert(
      Array.isArray(judgment.baselineActorClasses),
      `qrel judgment lacks baselineActorClasses: ${queryCase.caseId}`,
    );
    baselineJudgmentCount += 1;
  }
}
assert(
  baselineJudgmentCount === 315,
  `baseline judgment count is ${baselineJudgmentCount}, expected 315`,
);
const v7CasesWithHistoricalKey = replaceJudgmentKey(
  qrelsV7.cases,
  'baselineActorClasses',
  'approvedActorClasses',
);
equal(
  v7CasesWithHistoricalKey,
  qrelsV6.cases,
  'QRELS-v6 to v7 normalized judgment transition',
);

const registerNames = Object.keys(baseline.registers);
equal(
  registerNames,
  Object.keys(loaded.authoritativePredicates.value.registers),
  'baseline/authoritative register order',
);
equal(
  registerNames,
  Object.keys(fieldScope.registers),
  'baseline/field-scope register order',
);
assert(registerNames.length === 17, 'baseline must cover 17 registers');
let matchFieldCount = 0;
let projectionExpressionCount = 0;
let projectionFieldReferenceCount = 0;
const contentExceptions = [];
for (const [register, policy] of Object.entries(baseline.registers)) {
  assert(
    policy.authoritativeReadableRef === `${register}.readableWhen`,
    `baseline authoritative ref differs for ${register}`,
  );
  const scope = fieldScope.registers[register];
  const scopeFields = new Set(
    ['E', 'L', 'F', 'N', 'J', 'nestedF', 'nestedN'].flatMap(
      (classification) => scope[classification] ?? [],
    ),
  );
  for (const field of policy.mayMatch) {
    matchFieldCount += 1;
    assert(
      scope[field.class]?.includes(field.field),
      `baseline field is outside DTO scope: ${register}.${field.field}`,
    );
    if (field.class === 'N') contentExceptions.push(`${register}.${field.field}`);
  }
  for (const expression of Object.values(policy.publicProjection)) {
    if (expression.op !== 'literal') projectionExpressionCount += 1;
    for (const field of collectProjectionFields(expression)) {
      projectionFieldReferenceCount += 1;
      assert(
        scopeFields.has(field),
        `baseline projection field is outside DTO scope: ${register}.${field}`,
      );
    }
  }
}
assert(matchFieldCount === 64, `baseline match field count is ${matchFieldCount}`);
assert(
  projectionExpressionCount === 68,
  `baseline projection expression count is ${projectionExpressionCount}`,
);
equal(
  contentExceptions,
  ['claim.description', 'term.label', 'line.refNo'],
  'H0-H4 content exceptions',
);
assert(
  baseline.baselineLineage.productCommit === PRODUCT_COMMIT &&
    baseline.baselineLineage.noOracleClaim.includes(
      'not a disclosure oracle',
    ),
  'baseline claim boundary differs',
);

const residualContinuity = verifyResidualContinuity({
  ledger: loaded.residualLedger.value,
  contract: loaded.residualContract.value,
  historicalR3: historicalResiduals,
  historicalR4: historicalTrust,
});
assert(
  residualContinuity.inherited5Plus8Plus3Count === 16 &&
    residualReceipt.allExpectedRejectionsObserved === true &&
    residualReceipt.observedCaseCount === 6 &&
    residualReceipt.sideEffectBarrier.observedEventCount === 0,
  'residual continuity receipt differs',
);

assert(
  driftReceipt.baselineCleanOutcome === 'PASS' &&
    driftReceipt.allExpectedFailuresObserved === true &&
    driftReceipt.logicalProjectionRecipeValidatedFixtureCount === 356,
  'B0 drift RED receipt differs',
);
assert(
  metricReceipt.satisfiabilityVersion ===
      'HEARTH-003-METRIC-SATISFIABILITY-v2' &&
    metricReceipt.targetSatisfiabilityRedControl
      .observedFailureCode === 'UNSATISFIABLE_ACCEPTANCE_TARGET',
  'metric satisfiability receipt differs',
);
assert(
  metricReceipt.measurementStatus === 'NOT_YET_MEASURED',
  'metric receipt overclaims measurement',
);

assert(
  bundleReceipt.baseline.authorityRevision === 'HEARTH-003-r5' &&
    bundleReceipt.baseline.authorityCommit === R5_AUTHORITY_COMMIT &&
    bundleReceipt.baseline.manifestCanonicalTextSha256 === R5_ROOT &&
    bundleReceipt.baseline.verifiedSlotCount === 37 &&
    bundleReceipt.aggregate.observedCaseCount === 10 &&
    bundleReceipt.aggregate.allExpectedRejectionsObserved === true &&
    bundleReceipt.sideEffectBarrier.observedEventCount === 0,
  'actual-r5 bundle RED receipt differs',
);

assert(
  implementationDrift.overallOutcome ===
      'PASS_PINNED_BASELINE_RECONSTRUCTION_EQUAL' &&
    implementationDrift.sourceBaselineReconstruction.observationCount ===
      49840 &&
    implementationDrift.sourceBaselineReconstruction.mismatchCount === 0 &&
    implementationDrift.matchFieldBaselineReconstruction
      .baselineLogicalMatchFieldCount === 64 &&
    implementationDrift.matchFieldBaselineReconstruction
      .mismatchRegisterCount === 0,
  'implementation drift receipt differs',
);

const policyPins = {
  productCommit: PRODUCT_COMMIT,
  applicationPolicyDependencySha256:
    'c440971239e10dc0b7d3a09646f2b3d71635c9f7d4b31e72e46b303e590ac1cf',
  migrationStateSha256:
    '0440365537129073377bbea05aa3b760f25573d4c008aab473b7f59e1072a585',
  completeDependencyTreeSha256:
    'bf76302b44c4ab3b5dab68270616dfa1a802f5720563008e3b56d2f09b585d1a',
};
assert(
  policyDependencies.sourceCommit === policyPins.productCommit,
  'policy dependency product commit differs',
);
equal(
  policyDependencies.h0Bindings,
  {
    applicationPolicyDependencySha256:
      policyPins.applicationPolicyDependencySha256,
    migrationStateSha256: policyPins.migrationStateSha256,
    completeDependencyTreeSha256:
      policyPins.completeDependencyTreeSha256,
  },
  'policy dependency H0 pins',
);
equal(
  {
    productCommit: trust.policyDependencyBinding.sourceCommit,
    ...trust.policyDependencyBinding.h0Bindings,
  },
  policyPins,
  'trust-chain policy dependency pins',
);
assert(
  policyDependencies.treeHashContract.includes(
    '0x01 for text; 0x02 for binary',
  ),
  'dependency tree contract omits the kind-byte mapping',
);
const dependencyTreeRecomputation = {
  algorithm: 'C3_HEARTH_DEPENDENCY_TREE_V1',
  kindBytes: {
    text: '0x01',
    binary: '0x02',
  },
  applicationPolicy: {
    fileCount: policyDependencies.applicationPolicy.fileCount,
    recomputedTreeSha256: dependencyTreeSha256(
      policyDependencies.applicationPolicy,
      'applicationPolicy',
    ),
  },
  migrationState: {
    fileCount: policyDependencies.migrationState.fileCount,
    recomputedTreeSha256: dependencyTreeSha256(
      policyDependencies.migrationState,
      'migrationState',
    ),
  },
  completeDependencyTree: {
    fileCount: policyDependencies.completeDependencyTree.fileCount,
    recomputedTreeSha256: dependencyTreeSha256(
      policyDependencies.completeDependencyTree,
      'completeDependencyTree',
    ),
  },
};
assert(
  dependencyTreeRecomputation.applicationPolicy.fileCount === 18 &&
    dependencyTreeRecomputation.migrationState.fileCount === 95 &&
    dependencyTreeRecomputation.completeDependencyTree.fileCount ===
      113,
  'dependency tree entry counts differ from the pinned 18/95/113 sets',
);
assert(
  dependencyTreeRecomputation.applicationPolicy
    .recomputedTreeSha256 ===
      policyDependencies.applicationPolicy.treeSha256 &&
    dependencyTreeRecomputation.migrationState
      .recomputedTreeSha256 ===
      policyDependencies.migrationState.treeSha256 &&
    dependencyTreeRecomputation.completeDependencyTree
      .recomputedTreeSha256 ===
      policyDependencies.completeDependencyTree.treeSha256,
  'in-bundle dependency tree recomputation differs',
);

const pinnedFieldFinding =
  loaded.authoritativeFieldScope.value
    .postDerivationPinnedBaselineFinding;
const benchmarkRule =
  loaded.authoritativePredicates.value
    .defaultBenchmarkRecallEligibility;
const r3BindingResidual =
  loaded.residualLedger.value.inheritedR3Residuals.find(
    ({ id }) => id === 'R3-RES-03-QREL_BINDING_ORIGIN',
  );
assert(
  pinnedFieldFinding?.pinnedBaselineArtifact ===
      INPUTS.driftBaseline &&
    pinnedFieldFinding.pinnedBaselineSourceCommit ===
      PRODUCT_COMMIT &&
    pinnedFieldFinding.pinnedBaselinePhysicalFieldCount === 64 &&
    pinnedFieldFinding
      .pinnedBaselineFieldsContainedInAuthoritativeDtoScope === 64 &&
    pinnedFieldFinding.separateDisclosureOracleExists === false &&
    !Object.prototype.hasOwnProperty.call(
      loaded.authoritativeFieldScope.value,
      'postDerivationApprovedEnvelopeFinding',
    ) &&
    !Object.prototype.hasOwnProperty.call(
      pinnedFieldFinding,
      'approvedPhysicalFieldCount',
    ) &&
    !Object.prototype.hasOwnProperty.call(
      pinnedFieldFinding,
      'approvedEnvelopeRemainsSeparatelyVersioned',
    ),
  'field-scope leaf still asserts a separate approved envelope',
);
assert(
  benchmarkRule.includes('pinned-baseline drift') &&
    benchmarkRule.includes('not an approval oracle') &&
    benchmarkRule.includes(
      'not inputs to authoritative field-scope derivation',
    ) &&
    !benchmarkRule.includes('approved match-field registry'),
  'authoritative-predicate leaf still asserts a separate registry',
);
assert(
  r3BindingResidual?.statement.includes(
    'postDerivationApprovedEnvelopeFinding',
  ) &&
    r3BindingResidual.statement.includes(
      'postDerivationPinnedBaselineFinding',
    ) &&
    r3BindingResidual.statement.includes(
      'qrelPhysicalFieldBindings',
    ) &&
    r3BindingResidual.statement.includes(
      'Neither the binding map nor the renamed finding derives field scope, confers approval',
    ),
  'R3-RES-03 does not quarantine both sibling keys',
);

const migrationPinSetSha256 = canonicalJsonLfSha256(
  fixture.physicalSeedPlan.migrationFiles,
);
const physicalSeedPlanSha256 = canonicalJsonLfSha256(
  fixture.physicalSeedPlan,
);
assert(
  physicalManifest.migrationPinSetSha256 === migrationPinSetSha256,
  'legacy migration pin sorted-JSON-plus-LF binding differs',
);
assert(
  physicalValidation.inputHashes.physicalSeedPlanSha256 ===
    physicalSeedPlanSha256,
  'legacy physical seed-plan sorted-JSON-plus-LF binding differs',
);
assert(
  physicalValidation.inputHashes.contractSha256 ===
      loaded.fixture.canonicalTextSha256 &&
    physicalValidation.inputHashes.qrelsSha256 ===
      'a55881d8ab8e988ef4c6ef21bf8f9830ca56b45d1e7d1b2d3610960fedf6f7e4',
  'physical v3 base-scope binding differs',
);

const hashNameByInput = {
  gitattributes: 'gitattributesCanonicalTextSha256',
  actorClasses: 'actorClassesCanonicalTextSha256',
  authoritativeFieldScope:
    'authoritativeFieldScopeCanonicalTextSha256',
  authoritativePredicates:
    'authoritativePredicatesCanonicalTextSha256',
  driftBaseline: 'driftBaselineCanonicalTextSha256',
  residualLedger: 'residualLedgerCanonicalTextSha256',
  residualContract: 'residualContractCanonicalTextSha256',
  residualRedPlan: 'residualRedPlanCanonicalTextSha256',
  residualRedReceipt: 'residualRedReceiptCanonicalTextSha256',
  residualVerifier: 'residualVerifierCanonicalTextSha256',
  driftRedPlan: 'driftRedPlanCanonicalTextSha256',
  driftRedReceipt: 'driftRedReceiptCanonicalTextSha256',
  driftChecker: 'driftCheckerCanonicalTextSha256',
  metricReceipt: 'metricReceiptCanonicalTextSha256',
  metricSource: 'metricSourceCanonicalTextSha256',
  bundleRedPlan: 'bundleRedPlanCanonicalTextSha256',
  bundleRedReceipt: 'bundleRedReceiptCanonicalTextSha256',
  bundleVerifier: 'bundleVerifierCanonicalTextSha256',
  bundleRedRunner: 'bundleRedRunnerCanonicalTextSha256',
  implementationDrift:
    'implementationDriftCanonicalTextSha256',
  implementationDriftSource:
    'implementationDriftSourceCanonicalTextSha256',
  qrelsV7: 'qrelsV7CanonicalTextSha256',
  fixture: 'fixtureCanonicalTextSha256',
  coverage: 'coverageCanonicalTextSha256',
  delegation: 'delegationCanonicalTextSha256',
  trust: 'trustCanonicalTextSha256',
  physicalManifest: 'physicalManifestCanonicalTextSha256',
  physicalValidation: 'physicalValidationCanonicalTextSha256',
  policyDependencies: 'policyDependenciesCanonicalTextSha256',
  projectionParser: 'projectionParserCanonicalTextSha256',
  physicalValidator: 'physicalValidatorCanonicalTextSha256',
  goldAuthority: 'goldAuthorityCanonicalTextSha256',
  materializationContract:
    'materializationContractCanonicalTextSha256',
  freezer: 'freezerCanonicalTextSha256',
};
const inputHashes = Object.fromEntries(
  Object.entries(hashNameByInput).map(([input, hashName]) => [
    hashName,
    loaded[input].canonicalTextSha256,
  ]),
);
inputHashes.materializerCanonicalTextSha256 = canonicalTextSha256(
  materializerSourceBytes,
  fileURLToPath(import.meta.url),
);

const validation = {
  schemaVersion: 1,
  artifactKind: 'hearth-search-r6-authority-validation',
  validationVersion: 'HEARTH-003-R6-AUTHORITY-VALIDATION-v1',
  syntheticOnly: true,
  authority: 'Apex Lumen',
  outcome: 'PASS_R6_AUTHORITY_PREMEASUREMENT_ONLY',
  implementationStatus: 'NOT_YET_MEASURED',
  claimBoundary:
    'This validates the authored r6 authority package, content continuity, drift sensitivity, and cross-binding inputs. It does not authorize the dae27a4 baseline, prove leak safety, execute H1/H4, or certify any measured metric.',
  inputHashes,
  qrelsTransition: {
    qrelsV6Artifact: INPUTS.qrelsV6,
    qrelsV6CasesCanonicalJsonSha256:
      canonicalJsonSha256(qrelsV6.cases),
    qrelsV7Artifact: INPUTS.qrelsV7,
    qrelsV7CasesCanonicalJsonSha256:
      canonicalJsonSha256(qrelsV7.cases),
    qrelsV7CasesNormalizedToV6KeyCanonicalJsonSha256:
      canonicalJsonSha256(v7CasesWithHistoricalKey),
    normalizedJudgmentEquality: true,
    changedJudgmentKeyCount: baselineJudgmentCount,
    judgmentValueChanges: 0,
    queryTextChanges: 0,
    expectedSourceChanges: 0,
  },
  baselineBound: {
    registerCount: registerNames.length,
    matchFieldCount,
    projectionExpressionCount,
    projectionFieldReferenceCount,
    sourceObservationCount:
      implementationDrift.sourceBaselineReconstruction.observationCount,
    label: 'B0/O0_PINNED_IMPLEMENTATION_DRIFT_ONLY',
  },
  residualContinuity,
  policyDependencyBindings: policyPins,
  dependencyTreeRecomputation,
  leafRelabelAssertions: {
    authoritativeFieldScopeLegacyKeyQuarantined: true,
    authoritativePredicateRegistryClaimRemoved: true,
    r3ResidualNamesBothSiblingKeys: true,
  },
  legacyCanonicalJsonBindings: {
    algorithm: 'canonical-json-keysort-plus-one-lf-v1',
    terminalByteHex: '0A',
    migrationPinSetSha256,
    physicalSeedPlanSha256,
  },
  basePhysicalProofScope: {
    artifact: INPUTS.physicalValidation,
    status: 'OPEN_BEFORE_H4',
    sourceRevision: 'r4-era report over QRELS-v5 and Fixture-v5',
    notReearnedForR6Semantics: true,
  },
  textSlotBindings: {
    gitattributesCanonicalTextSha256:
      inputHashes.gitattributesCanonicalTextSha256,
    goldAuthorityCanonicalTextSha256:
      inputHashes.goldAuthorityCanonicalTextSha256,
    materializationContractCanonicalTextSha256:
      inputHashes.materializationContractCanonicalTextSha256,
    freezerCanonicalTextSha256:
      inputHashes.freezerCanonicalTextSha256,
  },
  checks: [
    {
      check: 'qrels-v7-semantic-key-transition',
      status: 'PASS',
      count: baselineJudgmentCount,
    },
    {
      check: 'b0-o0-reconstruction-bound',
      status: 'PASS',
      count:
        implementationDrift.sourceBaselineReconstruction.observationCount,
    },
    {
      check: 'drift-red-sensitivity',
      status: 'PASS',
      count: driftReceipt.observedCaseCount,
    },
    {
      check: 'residual-content-continuity',
      status: 'PASS',
      count: residualContinuity.inherited5Plus8Plus3Count,
    },
    {
      check: 'actual-r5-bundle-red',
      status: 'PASS',
      count: bundleReceipt.aggregate.observedCaseCount,
    },
    {
      check: 'policy-dependency-semantic-pins',
      status: 'PASS',
      count: 4,
    },
    {
      check: 'policy-dependency-tree-recomputation',
      status: 'PASS',
      count: 3,
    },
    {
      check: 'legacy-leaf-relabel-and-quarantine',
      status: 'PASS',
      count: 3,
    },
    {
      check: 'legacy-canonical-json-lf-cross-bindings',
      status: 'PASS',
      count: 2,
    },
    {
      check: 'metric-target-satisfiability',
      status: 'PASS',
      count: metricReceipt.queryClassCount ?? 8,
    },
  ],
  doesNotProve: [
    'that B0 is authorized, correct, complete, or leak-free',
    'that H1 seeded the corpus',
    'that any application response traversed reads.forActor and RLS',
    'that any latency, Recall, or MRR metric was captured',
    'that Physical Validation v3 was rerun for r6 semantics',
    'that H4 may emit RECORD',
  ],
};

const outputBytes = Buffer.from(
  `${JSON.stringify(validation, null, 2)}\n`,
  'utf8',
);
const outputPath = join(artifactDir, OUTPUT_FILENAME);
if (process.argv.includes('--write')) {
  writeFileSync(outputPath, outputBytes);
  process.stdout.write(`wrote ${OUTPUT_FILENAME}\n`);
} else {
  const observed = readFileSync(outputPath);
  assert(
    canonicalTextBytes(observed, OUTPUT_FILENAME).equals(
      canonicalTextBytes(outputBytes, `${OUTPUT_FILENAME} generated`),
    ),
    `${OUTPUT_FILENAME} differs from the r6 materializer`,
  );
  process.stdout.write(`verified ${OUTPUT_FILENAME}\n`);
}
process.stdout.write(
  `HEARTH-003-r6 authority materialization PASS (${qrelsV7.cases.length} qrels; ${matchFieldCount} baseline fields; ${residualContinuity.inherited5Plus8Plus3Count} inherited residuals; NOT_YET_MEASURED)\n`,
);
