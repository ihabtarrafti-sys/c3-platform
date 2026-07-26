#!/usr/bin/env node

/**
 * Mechanical pinned-baseline ceiling and satisfiability calculation for
 * HEARTH-003-r6.
 *
 * G remains the independently adjudicated Recall/MRR truth. J0 is only the
 * frozen prediction of G intersect B0, where B0 is reconstructed from the C3
 * search implementation pinned at dae27a4. Neither J0 nor B0 is an
 * authorization or disclosure oracle.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const QRELS_FILENAME = 'HEARTH-003-QRELS-v7.json';
const LEGACY_MEASUREMENT_FILENAME =
  'HEARTH-003-DELEGATION-MEASUREMENT-v1.json';
const MEASUREMENT_FILENAME =
  'HEARTH-003-DELEGATION-MEASUREMENT-v2.json';
const BASELINE_FILENAME =
  'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json';
const COVERAGE_SOURCE_FILENAME = 'HEARTH-003-COVERAGE-v6.json';
const COVERAGE_OUTPUT_FILENAME = 'HEARTH-003-COVERAGE-v7.json';
const FIXTURE_FILENAME = 'HEARTH-003-FIXTURE-CONTRACT-v5.json';
const OUTPUT_FILENAME = 'HEARTH-003-METRIC-SATISFIABILITY-v2.json';
const PRODUCT_BASELINE_COMMIT =
  'dae27a400868c0c686788ab8e5520690dbf77334';
const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseArtifact(filename) {
  const bytes = readFileSync(join(artifactDir, filename));
  return {
    bytes,
    value: JSON.parse(
      canonicalTextBytes(bytes, filename).toString('utf8'),
    ),
  };
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function fraction(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error('zero denominator');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    n: (sign * numerator) / divisor,
    d: (sign * denominator) / divisor,
  };
}

function add(left, right) {
  return fraction(
    left.n * right.d + right.n * left.d,
    left.d * right.d,
  );
}

function divide(value, count) {
  if (count <= 0) throw new Error('mean of empty collection');
  return fraction(value.n, value.d * BigInt(count));
}

function mean(values) {
  if (values.length === 0) throw new Error('mean of empty collection');
  return divide(
    values.reduce((total, value) => add(total, value), fraction(0n)),
    values.length,
  );
}

function decimal(value) {
  return Number(value.n) / Number(value.d);
}

function renderFraction(value) {
  return {
    numerator: Number(value.n),
    denominator: Number(value.d),
    fraction: `${value.n}/${value.d}`,
    decimal: decimal(value),
  };
}

function sourceKey(source) {
  return JSON.stringify([
    source.tenantSlot,
    source.register,
    source.recordKind ?? null,
    source.recordId,
  ]);
}

function scoreObservation(authoritativeRelevant, baselineRelevantPredictions) {
  const authoritativeKeys = new Set(
    authoritativeRelevant.map(({ source }) => sourceKey(source)),
  );
  if (authoritativeKeys.size === 0) return null;
  const orderedBaseline = [...baselineRelevantPredictions]
    .sort(
      (left, right) =>
        left.rankGroup - right.rankGroup ||
        (sourceKey(left.source) < sourceKey(right.source)
          ? -1
          : sourceKey(left.source) > sourceKey(right.source)
            ? 1
            : 0),
    )
    .slice(0, 10);
  if (
    orderedBaseline.some(
      ({ source }) => !authoritativeKeys.has(sourceKey(source)),
    )
  ) {
    throw new Error('J0 pinned-baseline prediction is not a subset of G');
  }
  const recalled = new Set(
    orderedBaseline
      .map(({ source }) => sourceKey(source))
      .filter((key) => authoritativeKeys.has(key)),
  );
  const firstRelevantIndex = orderedBaseline.findIndex(({ source }) =>
    authoritativeKeys.has(sourceKey(source)),
  );
  return {
    recall: fraction(BigInt(recalled.size), BigInt(authoritativeKeys.size)),
    reciprocalRank:
      firstRelevantIndex < 0
        ? fraction(0n)
        : fraction(1n, BigInt(firstRelevantIndex + 1)),
    authoritativeCount: authoritativeKeys.size,
    baselinePredictionCount: orderedBaseline.length,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function moveSemanticField(record, from, to, label) {
  assert(
    Object.hasOwn(record, from),
    `${label} is missing legacy field ${from}`,
  );
  assert(
    !Object.hasOwn(record, to),
    `${label} already contains replacement field ${to}`,
  );
  record[to] = record[from];
  delete record[from];
}

function countOwnKey(value, expectedKey) {
  if (Array.isArray(value)) {
    return value.reduce(
      (count, item) => count + countOwnKey(item, expectedKey),
      0,
    );
  }
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce(
    (count, [key, item]) =>
      count +
      (key === expectedKey ? 1 : 0) +
      countOwnKey(item, expectedKey),
    0,
  );
}

function buildMeasurementV2(legacyMeasurement, legacyBytes) {
  const measurement = deepClone(legacyMeasurement);
  measurement.schemaVersion = 2;
  measurement.artifactKind =
    'hearth-search-delegation-baseline-measurement';
  measurement.measurementVersion =
    'HEARTH-003-DELEGATION-MEASUREMENT-v2';
  measurement.measurementStatus = 'NOT_YET_MEASURED';
  measurement.semanticAmendment = {
    sourceArtifact: LEGACY_MEASUREMENT_FILENAME,
    sourceCanonicalTextSha256: canonicalTextSha256(
      legacyBytes,
      LEGACY_MEASUREMENT_FILENAME,
    ),
    amendmentClass:
      'remedy-c claim correction and semantic field rename only',
    productBaselineCommit: PRODUCT_BASELINE_COMMIT,
    sourceRowsChanged: 0,
    actorProfilesChanged: 0,
    logicalAssignmentsChanged: 0,
    concreteBindingsChanged: 0,
    pairEdgesChanged: 0,
    baselinePredictionValuesChanged: 0,
    claimBoundary:
      'baselineRelevantPredictions and B0/O0 describe equality or movement relative to dae27a4. They are not authorization, approval, disclosure, or leak-safety oracles.',
  };

  for (const assignment of measurement.nonDelegationLogicalAssignments) {
    moveSemanticField(
      assignment,
      'approvedSearchRelevantJudgments',
      'baselineRelevantPredictions',
      assignment.assignmentId,
    );
    moveSemanticField(
      assignment,
      'disclosureEnvelopeRule',
      'baselineDriftRule',
      assignment.assignmentId,
    );
    assignment.baselineDriftRule =
      'Expand HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1 over the complete measured corpus for the bound actor profile before any response exists; store B0/O0 separately from G. Equality to B0 is baseline conformance only, not authorization or leak-safety evidence.';
  }

  for (const binding of measurement.concreteBindings) {
    moveSemanticField(
      binding,
      'approvedSearchApprovalDomainExpected',
      'baselineApprovalDomainExpected',
      binding.bindingId,
    );
    moveSemanticField(
      binding,
      'approvedSearchRelevantJudgments',
      'baselineRelevantPredictions',
      binding.bindingId,
    );
  }

  measurement.observationExpansionRule = {
    ...measurement.observationExpansionRule,
    fullBaselineExpansion:
      'For every observation, expand HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1 over the complete measured corpus into B0/O0 before any response exists. This detects movement from dae27a4 and does not certify the baseline.',
  };
  delete measurement.observationExpansionRule.fullDisclosureExpansion;

  measurement.qualityAndBaselineRule = {
    authoritativeRelevant:
      'Recall is computed only from independently adjudicated authoritativeRelevant (G). A nonempty G may never be replaced by a pinned-baseline prediction.',
    baselineRelevantPredictions:
      'baselineRelevantPredictions is J0: the qrel-local prediction of G intersect B0 used for baseline-ceiling diagnostics only. It is not an authorization or leak whitelist.',
    baselineActorSurface:
      'B0/O0 is expanded from the separately versioned dae27a4 drift baseline. Inside B0 means equal to the pinned baseline only; outside B0 is a drift finding.',
    parityGap:
      'parityGapSources = authoritativeRelevant minus baselineRelevantPredictions',
    requiredSubset:
      'baselineRelevantPredictions must be a subset of authoritativeRelevant. No authorization or completeness claim follows from B0 membership.',
  };
  delete measurement.dualOracleRule;

  assert(
    countOwnKey(measurement, 'approvedSearchRelevantJudgments') === 0,
    'v2 still contains approvedSearchRelevantJudgments',
  );
  assert(
    countOwnKey(measurement, 'approvedSearchApprovalDomainExpected') === 0,
    'v2 still contains approvedSearchApprovalDomainExpected',
  );
  assert(
    countOwnKey(measurement, 'disclosureEnvelopeRule') === 0,
    'v2 still contains disclosureEnvelopeRule',
  );
  assert(
    countOwnKey(measurement, 'dualOracleRule') === 0,
    'v2 still contains dualOracleRule',
  );
  assert(
    countOwnKey(measurement, 'baselineRelevantPredictions') === 1070,
    'v2 baselineRelevantPredictions count does not reconcile',
  );

  return measurement;
}

function calculateCeilings(qrels, measurement) {
  const assignmentScores = [];
  let positiveNonDelegationAssignments = 0;
  let positiveDelegationAssignments = 0;

  for (const assignment of measurement.nonDelegationLogicalAssignments) {
    const score = scoreObservation(
      assignment.authoritativeRelevant,
      assignment.baselineRelevantPredictions,
    );
    if (!score) continue;
    positiveNonDelegationAssignments += 1;
    assignmentScores.push({
      queryCaseId: assignment.queryCaseId,
      queryClass: assignment.queryClass,
      assignmentId: assignment.assignmentId,
      recall: score.recall,
      reciprocalRank: score.reciprocalRank,
    });
  }

  const bindingById = new Map(
    measurement.concreteBindings.map((binding) => [
      binding.bindingId,
      binding,
    ]),
  );
  for (const assignment of measurement.logicalAssignments) {
    const positiveBindingScores = assignment.concreteBindingIds
      .map((bindingId) => {
        const binding = bindingById.get(bindingId);
        if (!binding) throw new Error(`missing binding ${bindingId}`);
        return scoreObservation(
          binding.authoritativeRelevant,
          binding.baselineRelevantPredictions,
        );
      })
      .filter(Boolean);
    if (positiveBindingScores.length === 0) continue;
    positiveDelegationAssignments += 1;
    const firstBinding = bindingById.get(assignment.concreteBindingIds[0]);
    assignmentScores.push({
      queryCaseId: assignment.queryCaseId,
      queryClass: firstBinding.queryClass,
      assignmentId: assignment.assignmentId,
      recall: mean(positiveBindingScores.map(({ recall }) => recall)),
      reciprocalRank: mean(
        positiveBindingScores.map(
          ({ reciprocalRank }) => reciprocalRank,
        ),
      ),
    });
  }

  const qrelById = new Map(
    qrels.cases.map((queryCase) => [queryCase.queryCaseId, queryCase]),
  );
  const caseScores = [];
  for (const [queryCaseId, queryCase] of qrelById) {
    if (queryCase.queryClass === 'zero_result') continue;
    const scores = assignmentScores.filter(
      (assignment) => assignment.queryCaseId === queryCaseId,
    );
    if (scores.length === 0) {
      throw new Error(`positive query case has no positive assignment: ${queryCaseId}`);
    }
    caseScores.push({
      queryCaseId,
      queryClass: queryCase.queryClass,
      recall: mean(scores.map(({ recall }) => recall)),
      reciprocalRank: mean(
        scores.map(({ reciprocalRank }) => reciprocalRank),
      ),
      positiveAssignmentCount: scores.length,
    });
  }

  const queryClasses = [
    'exact_id',
    'exact_name',
    'prefix',
    'substring',
    'multi_token',
    'common_ambiguous',
    'typo_fuzzy',
  ];
  const perClass = Object.fromEntries(
    queryClasses.map((queryClass) => {
      const cases = caseScores.filter(
        (queryCase) => queryCase.queryClass === queryClass,
      );
      const recallSum = cases.reduce(
        (total, queryCase) => add(total, queryCase.recall),
        fraction(0n),
      );
      const rrSum = cases.reduce(
        (total, queryCase) => add(total, queryCase.reciprocalRank),
        fraction(0n),
      );
      return [
        queryClass,
        {
          caseCount: cases.length,
          caseRecallSum: renderFraction(recallSum),
          recallAt10Ceiling: renderFraction(
            divide(recallSum, cases.length),
          ),
          caseReciprocalRankSum: renderFraction(rrSum),
          mrrAt10Ceiling: renderFraction(divide(rrSum, cases.length)),
        },
      ];
    }),
  );
  const overallRecallSum = caseScores.reduce(
    (total, queryCase) => add(total, queryCase.recall),
    fraction(0n),
  );
  const overallRrSum = caseScores.reduce(
    (total, queryCase) => add(total, queryCase.reciprocalRank),
    fraction(0n),
  );

  const affectedCases = caseScores
    .filter(({ recall }) => recall.n !== recall.d)
    .map(({ queryCaseId, queryClass, recall }) => ({
      queryCaseId,
      queryClass,
      caseRecallCeiling: renderFraction(recall),
    }));
  const gapJudgments = qrels.cases.flatMap((queryCase) =>
    queryCase.sourceJudgments
      .filter(
        (judgment) =>
          judgment.authoritativeActorClasses.some(
            (actorClass) =>
              !judgment.baselineActorClasses.includes(actorClass),
          ),
      )
      .map((judgment) => ({
        queryCaseId: queryCase.queryCaseId,
        reason: judgment.gapReason,
      })),
  );
  const gapFamilyCounts = Object.fromEntries(
    [...new Set(gapJudgments.map(({ reason }) => reason))]
      .sort()
      .map((reason) => [
        reason,
        gapJudgments.filter((judgment) => judgment.reason === reason).length,
      ]),
  );

  return {
    positiveNonDelegationAssignments,
    positiveDelegationAssignments,
    positiveAssignmentCount:
      positiveNonDelegationAssignments + positiveDelegationAssignments,
    positiveCaseCount: caseScores.length,
    zeroResultCaseCount: qrels.cases.filter(
      ({ queryClass }) => queryClass === 'zero_result',
    ).length,
    perClass,
    overall: {
      caseRecallSum: renderFraction(overallRecallSum),
      recallAt10Ceiling: renderFraction(
        divide(overallRecallSum, caseScores.length),
      ),
      caseReciprocalRankSum: renderFraction(overallRrSum),
      mrrAt10Ceiling: renderFraction(
        divide(overallRrSum, caseScores.length),
      ),
      exactIdRecallAt1Ceiling:
        perClass.exact_id.recallAt10Ceiling,
    },
    affectedCaseCount: affectedCases.length,
    affectedCases,
    affectedExactIdCaseCount: affectedCases.filter(
      ({ queryClass }) => queryClass === 'exact_id',
    ).length,
    gapJudgmentCount: gapJudgments.length,
    gapAffectedCaseCount: new Set(
      gapJudgments.map(({ queryCaseId }) => queryCaseId),
    ).size,
    gapFamilyCounts,
  };
}

class SatisfiabilityError extends Error {
  constructor(code, targetId) {
    super(`${code}: ${targetId}`);
    this.code = code;
    this.targetId = targetId;
  }
}

function checkTargets(targets) {
  for (const target of targets) {
    if (target.comparator !== 'gte') {
      throw new Error(
        `unsupported target comparator ${target.comparator}: ${target.targetId}`,
      );
    }
    if (
      target.unsatisfiedDisposition !== null &&
      target.unsatisfiedDisposition !==
        'GOVERNANCE_BLOCKED_PINNED_BASELINE_TARGET'
    ) {
      throw new Error(
        `unsupported target disposition ${target.unsatisfiedDisposition}: ${target.targetId}`,
      );
    }
    if (
      target.target > target.ceiling &&
      target.unsatisfiedDisposition !==
        'GOVERNANCE_BLOCKED_PINNED_BASELINE_TARGET'
    ) {
      throw new SatisfiabilityError(
        'UNSATISFIABLE_ACCEPTANCE_TARGET',
        target.targetId,
      );
    }
  }
  return true;
}

function renderJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildOutputs() {
  const qrelsArtifact = parseArtifact(QRELS_FILENAME);
  const legacyMeasurementArtifact = parseArtifact(
    LEGACY_MEASUREMENT_FILENAME,
  );
  const baselineArtifact = parseArtifact(BASELINE_FILENAME);
  const coverageSourceArtifact = parseArtifact(
    COVERAGE_SOURCE_FILENAME,
  );
  const fixtureArtifact = parseArtifact(FIXTURE_FILENAME);
  const measurement = buildMeasurementV2(
    legacyMeasurementArtifact.value,
    legacyMeasurementArtifact.bytes,
  );
  const measurementBytes = renderJsonBytes(measurement);

  assert(
    qrelsArtifact.value.querySetVersion === 'HEARTH-003-QRELS-v7',
    'metric input is not QRELS-v7',
  );
  assert(
    qrelsArtifact.value.disclosureDriftBaselineArtifact ===
      BASELINE_FILENAME,
    'QRELS-v7 does not bind the r6 drift baseline',
  );
  assert(
    qrelsArtifact.value.delegationMeasurementArtifact ===
      LEGACY_MEASUREMENT_FILENAME,
    'QRELS-v7 legacy delegation source binding drifted',
  );
  assert(
    qrelsArtifact.value.r6AuthorityAmendmentLedger?.baselineMeaning ===
      'Values predict the dae27a4 implementation baseline; no separate approval or authorization source backs them.',
    'QRELS-v7 does not declare baselineActorClasses semantics',
  );
  assert(
    countOwnKey(qrelsArtifact.value, 'approvedActorClasses') === 0 &&
      countOwnKey(qrelsArtifact.value, 'baselineActorClasses') === 315,
    'QRELS-v7 actor-class semantic rename does not reconcile',
  );
  assert(
    baselineArtifact.value.driftBaselineVersion ===
      'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1' &&
      baselineArtifact.value.baselineLineage.productCommit ===
        PRODUCT_BASELINE_COMMIT,
    'drift baseline identity or product pin differs',
  );
  assert(
    baselineArtifact.value.baselineSemantics.permanentLimit.startsWith(
      'Inside B0 is not evidence that the baseline is authorized, correct, complete, leak-free,',
    ) &&
      baselineArtifact.value.baselineLineage.noOracleClaim.includes(
        'not a disclosure oracle',
      ),
    'drift baseline permanent limit is missing',
  );

  const ceilings = calculateCeilings(
    qrelsArtifact.value,
    measurement,
  );
  const targets = [
    {
      targetId: 'absolute-exact-id-recall-at-1',
      metricPlane: 'raw_authoritative_quality',
      target: 1,
      comparator: 'gte',
      ceiling: ceilings.overall.exactIdRecallAt1Ceiling.decimal,
      satisfiedByPerfectPinnedBaseline: false,
      unsatisfiedDisposition:
        'GOVERNANCE_BLOCKED_PINNED_BASELINE_TARGET',
      requiredQualityVerdict:
        'TARGET_FAIL_KNOWN_PINNED_BASELINE_CEILING',
      nonNormalizationRule:
        'The target remains 1.00. It is not lowered to 109/120 and cannot be replaced by pinned-baseline hit@1.',
    },
    {
      targetId: 'absolute-overall-recall-at-10',
      metricPlane: 'raw_authoritative_quality',
      target: 0.9,
      comparator: 'gte',
      ceiling: ceilings.overall.recallAt10Ceiling.decimal,
      satisfiedByPerfectPinnedBaseline: true,
      unsatisfiedDisposition: null,
    },
    {
      targetId: 'absolute-mrr-at-10',
      metricPlane: 'raw_authoritative_quality',
      target: 0.8,
      comparator: 'gte',
      ceiling: ceilings.overall.mrrAt10Ceiling.decimal,
      satisfiedByPerfectPinnedBaseline: true,
      unsatisfiedDisposition: null,
    },
    ...Object.entries(ceilings.perClass).map(
      ([queryClass, value]) => ({
        targetId: `absolute-${queryClass}-recall-at-10`,
        metricPlane: 'raw_authoritative_quality',
        target: 0.8,
        comparator: 'gte',
        ceiling: value.recallAt10Ceiling.decimal,
        satisfiedByPerfectPinnedBaseline:
          value.recallAt10Ceiling.decimal >= 0.8,
        unsatisfiedDisposition: null,
      }),
    ),
  ];
  checkTargets(targets);

  const redTargets = targets.map((target) => ({ ...target }));
  const redTarget = redTargets.find(
    ({ targetId }) => targetId === 'absolute-exact-id-recall-at-1',
  );
  redTarget.unsatisfiedDisposition = null;
  let redObserved = null;
  try {
    checkTargets(redTargets);
  } catch (error) {
    if (!(error instanceof SatisfiabilityError)) throw error;
    redObserved = {
      mutation:
        'remove the pinned-baseline governance classification from the known impossible exact-id absolute target',
      expectedFailureCode: 'UNSATISFIABLE_ACCEPTANCE_TARGET',
      observedFailureCode: error.code,
      targetId: error.targetId,
      seederStarted: false,
      httpRequestCount: 0,
      metricsStarted: false,
    };
  }
  if (
    !redObserved ||
    redObserved.observedFailureCode !==
      redObserved.expectedFailureCode
  ) {
    throw new Error('target-satisfiability RED control did not fire');
  }

  if (
    ceilings.positiveNonDelegationAssignments !== 456 ||
    ceilings.positiveDelegationAssignments !== 16 ||
    ceilings.positiveAssignmentCount !== 472 ||
    ceilings.positiveCaseCount !== 255 ||
    ceilings.gapJudgmentCount !== 41 ||
    ceilings.gapAffectedCaseCount !== 38 ||
    ceilings.affectedExactIdCaseCount !== 9 ||
    ceilings.overall.exactIdRecallAt1Ceiling.fraction !== '109/120' ||
    ceilings.overall.recallAt10Ceiling.fraction !== '1421/1530' ||
    ceilings.overall.mrrAt10Ceiling.fraction !== '1423/1530'
  ) {
    throw new Error('metric-ceiling charter facts do not reconcile');
  }

  const sourceBytes = readFileSync(fileURLToPath(import.meta.url));
  const metric = {
    schemaVersion: 2,
    artifactKind: 'hearth-search-metric-target-satisfiability',
    satisfiabilityVersion: 'HEARTH-003-METRIC-SATISFIABILITY-v2',
    syntheticOnly: true,
    authority: 'Apex Lumen',
    measurementStatus: 'NOT_YET_MEASURED',
    implementationStatus:
      'PRE_CAPTURE_PINNED_BASELINE_REFERENCE_CALCULATION_ONLY',
    claimBoundary:
      'This calculation preserves independently adjudicated G and computes a quality ceiling against the dae27a4 B0 baseline. It is not measured H1/H4 evidence and does not certify authorization, disclosure correctness, leak safety, or baseline completeness.',
    inputHashes: {
      qrelsCanonicalTextSha256: canonicalTextSha256(
        qrelsArtifact.bytes,
        QRELS_FILENAME,
      ),
      legacyDelegationMeasurementCanonicalTextSha256:
        canonicalTextSha256(
          legacyMeasurementArtifact.bytes,
          LEGACY_MEASUREMENT_FILENAME,
        ),
      delegationMeasurementV2CanonicalTextSha256: canonicalTextSha256(
        measurementBytes,
        MEASUREMENT_FILENAME,
      ),
      disclosureDriftBaselineCanonicalTextSha256:
        canonicalTextSha256(
          baselineArtifact.bytes,
          BASELINE_FILENAME,
        ),
      evaluatorCanonicalTextSha256: canonicalTextSha256(
        sourceBytes,
        fileURLToPath(import.meta.url),
      ),
    },
    definitions: {
      G: 'authoritativeRelevant; independently human-adjudicated actor-readable relevance and the only Recall/MRR denominator',
      J0: 'baselineRelevantPredictions; the frozen pre-H1 prediction of G intersect B0, used only for pinned-baseline compatibility diagnostics',
      B0: 'the source, field, and projection set reconstructed from the C3 search implementation pinned at dae27a4 for actor profile a',
      O0: 'the remainder of the explicitly bounded 17-kind synthetic measurement universe',
      C0: 'C0(q,a) = |G(q,a) intersect B0(a)| / |G(q,a)|',
      operativeRule:
        'H1 must recompute C0 from B0 before capture and compare G intersect B0 with J0. Any difference is a fail-closed baseline-prediction mismatch. J0 is never substituted for G or treated as authorization truth.',
    },
    aggregation: {
      observation:
        'Score the first ten ideal J0 sources by rankGroup then canonical source key. Empty G is excluded from Recall/MRR.',
      assignment:
        'Macro-average positive physical observations or Delegation bindings inside each logical assignment.',
      case:
        'Macro-average positive assignments inside each logical query case.',
      class:
        'Macro-average case scores inside each query class.',
      overall:
        'Macro-average all 255 positive logical cases directly; query classes are not equally reweighted.',
      expansionCountNeverWeights: true,
    },
    ceilings,
    acceptanceTargets: targets,
    verdictPlanes: {
      runIntegrity: {
        values: [
          'VALID_MEASUREMENT',
          'NON_RECORDABLE'
        ],
        rule: 'Chain, runtime authorization, baseline-drift, capture, timing, receipt, repeat, and manifest closure only. Quality-target failure does not retroactively make a complete measurement nonexistent.'
      },
      rawAuthoritativeQuality: {
        values: [
          'QUALITY_TARGET_PASS',
          'TARGET_FAIL_KNOWN_PINNED_BASELINE_CEILING',
          'QUALITY_TARGET_FAIL'
        ],
        rule: 'Compute unchanged Recall/MRR against G and preserve every HEARTH-001 absolute target. The present ideal dae27a4 baseline necessarily fails exact-id Recall@1=1.00.'
      },
      pinnedBaselineDiagnostic: {
        exactIdMetricName: 'pinned-baseline exact-ID hit@1',
        permittedValueForPerfectImplementation: 1,
        substitutionForbidden:
          'This diagnostic may not be named Recall@1, placed in the G metric plane, used to erase G minus B0, or cited as authorization evidence.'
      }
    },
    currentIdealDisposition:
      'BASELINE_CAPTURED · QUALITY_TARGET_FAIL · KNOWN_PINNED_BASELINE_CEILING',
    recordTokenRule:
      'RECORD remains unavailable while an absolute quality target fails. A valid failing baseline may be captured and compared but must not be called RECORD.',
    targetSatisfiabilityRedControl: redObserved,
    qrelAmendmentRule:
      'No independently adjudicated G judgment was changed to make a target pass. Any future G judgment change is a separately declared Lumen authority amendment and requires Neural review.',
  };

  const coverage = deepClone(coverageSourceArtifact.value);
  coverage.schemaVersion = 6;
  coverage.coverageVersion = 'HEARTH-003-COVERAGE-v7';
  coverage.measurementStatus = 'NOT_YET_MEASURED';
  coverage.canonicalArtifactHashesBeforeCommit = {
    delegationMeasurementV2CanonicalJsonSha256:
      canonicalJsonSha256(measurement),
    qrelsV7CanonicalJsonSha256:
      canonicalJsonSha256(qrelsArtifact.value),
    fixtureContractCanonicalJsonSha256:
      canonicalJsonSha256(fixtureArtifact.value),
    disclosureDriftBaselineV1CanonicalJsonSha256:
      canonicalJsonSha256(baselineArtifact.value),
    metricSatisfiabilityV2CanonicalJsonSha256:
      canonicalJsonSha256(metric),
  };
  delete coverage.r5Closure;
  coverage.r6ClaimCorrection = {
    claimBoundary:
      'Coverage counts are unchanged synthetic inventory facts. B0/O0 and J0 measure equality or movement relative to dae27a4 only; they are not authorization, approval, disclosure, or leak-safety oracles.',
    preservedGoldAuthority: {
      independentlyAdjudicatedG: true,
      qrelCaseCount: qrelsArtifact.value.cases.length,
      sourceJudgmentValueChanges: 0,
      rankGroupChanges: 0,
    },
    pinnedBaselineDrift: {
      productCommit: PRODUCT_BASELINE_COMMIT,
      registerCount: Object.keys(
        baselineArtifact.value.registers,
      ).length,
      mayMatchFieldCount: Object.values(
        baselineArtifact.value.registers,
      ).reduce(
        (count, register) => count + register.mayMatch.length,
        0,
      ),
      syntheticH0H4NClassExceptionCount:
        baselineArtifact.value
          .h0ThroughH4SyntheticMeasurementExceptions.length,
      sourcePolicyReconstructionObservationCount: 49840,
      sourcePolicyReconstructionMismatchCount: 0,
      implementationOutsideBaselineMatchFieldCount: 0,
      interpretation:
        'Zero mismatch means the frozen reconstruction equals the pinned baseline. It does not prove that baseline correct.',
    },
    baselineDriftRed: {
      historicalMutationCount: 2,
      historicalDetectorSensitivityObserved: true,
      interpretation:
        'The historical mutations prove detector sensitivity only. They are not baseline-correctness evidence and are not measured H1/H4 receipts.',
    },
    metricSatisfiability: {
      positiveNonDelegationAssignmentCount:
        ceilings.positiveNonDelegationAssignments,
      positiveDelegationAssignmentCount:
        ceilings.positiveDelegationAssignments,
      positiveAssignmentCount: ceilings.positiveAssignmentCount,
      positiveLogicalCaseCount: ceilings.positiveCaseCount,
      pinnedBaselineGapJudgmentCount: ceilings.gapJudgmentCount,
      pinnedBaselineGapAffectedCaseCount:
        ceilings.gapAffectedCaseCount,
      affectedExactIdCaseCount:
        ceilings.affectedExactIdCaseCount,
      exactIdRecallAt1Ceiling:
        ceilings.overall.exactIdRecallAt1Ceiling.fraction,
      overallRecallAt10Ceiling:
        ceilings.overall.recallAt10Ceiling.fraction,
      overallMrrAt10Ceiling:
        ceilings.overall.mrrAt10Ceiling.fraction,
      targetGuardRedCode:
        redObserved.observedFailureCode,
    },
    projectionExecutionEvidence: {
      logicalRecipeFixtureCount: 356,
      liveNaturalIncludedCount: 353,
      staticGuardExcludedCount: 3,
      separateStaticGuardNegativeControlCount: 3,
      evidenceBoundary:
        'Separate JavaScript and PostgreSQL evaluators consume the same pinned recipes. Agreement is dual-execution evidence, not a separate disclosure specification.',
    },
  };

  return {
    metric,
    measurement,
    coverage,
    bytes: {
      metric: renderJsonBytes(metric),
      measurement: measurementBytes,
      coverage: renderJsonBytes(coverage),
    },
  };
}

const isEntryPoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const outputs = buildOutputs();
  if (process.argv.includes('--write')) {
    writeFileSync(
      join(artifactDir, MEASUREMENT_FILENAME),
      outputs.bytes.measurement,
    );
    writeFileSync(
      join(artifactDir, OUTPUT_FILENAME),
      outputs.bytes.metric,
    );
    writeFileSync(
      join(artifactDir, COVERAGE_OUTPUT_FILENAME),
      outputs.bytes.coverage,
    );
    process.stdout.write(`wrote ${MEASUREMENT_FILENAME}\n`);
    process.stdout.write(`wrote ${OUTPUT_FILENAME}\n`);
    process.stdout.write(`wrote ${COVERAGE_OUTPUT_FILENAME}\n`);
  }
  process.stdout.write(
    `metric satisfiability PASS (${outputs.metric.ceilings.overall.exactIdRecallAt1Ceiling.fraction} exact-id pinned-baseline ceiling; RED ${outputs.metric.targetSatisfiabilityRedControl.observedFailureCode}; NOT_YET_MEASURED)\n`,
  );
}

export { buildOutputs };
