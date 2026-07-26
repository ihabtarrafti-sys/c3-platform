#!/usr/bin/env node

/**
 * Apex Lumen's pinned Wave-1 disclosure-drift reference checker.
 *
 * This module deliberately imports no product search, search SQL, seeder, or
 * harness code. It consumes the B0/O0 reconstruction of the implementation
 * pinned at dae27a4, raw corpus fixtures, and exact serialized response bytes.
 * It detects movement from that baseline. It cannot prove that the baseline is
 * authorized, correct, complete, or leak-free.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

const POLICY_FILENAME =
  'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json';
const AUTHORITATIVE_FILENAME =
  'HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json';
const ACTOR_FILENAME = 'HEARTH-003-ACTOR-CLASSES-v2.json';
const FIXTURE_FILENAME = 'HEARTH-003-FIXTURE-CONTRACT-v5.json';
const CONTROL_FILENAME =
  'HEARTH-003-DISCLOSURE-DRIFT-RED-CONTROLS-v1.json';
const RECEIPT_FILENAME =
  'HEARTH-003-DISCLOSURE-DRIFT-RED-SELF-TEST-v1.json';

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

function parseArtifact(filename) {
  const bytes = readFileSync(join(artifactDir, filename));
  return {
    bytes,
    value: JSON.parse(
      canonicalTextBytes(bytes, filename).toString('utf8'),
    ),
  };
}

function pathValue(root, path) {
  const parts = path.split('.');
  let value = root;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !(part in value)) {
      return { exists: false, value: undefined };
    }
    value = value[part];
  }
  return { exists: true, value };
}

function resolveRoleSet(actorClasses, set) {
  const roles = actorClasses.roleSets[set];
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error(`unknown or empty role set: ${set}`);
  }
  return roles;
}

function dependencyFor(context, relationship) {
  const matches = (context.dependencies ?? []).filter(
    (candidate) => candidate.relationship === relationship,
  );
  if (matches.length > 1) {
    throw new Error(`duplicate dependency relationship: ${relationship}`);
  }
  return matches[0] ?? null;
}

export function evaluatePredicate(
  expression,
  context,
  namedPredicates,
  registers,
  actorClasses,
  stack = [],
) {
  if (!expression || typeof expression !== 'object') {
    throw new Error('predicate must be an object');
  }
  switch (expression.op) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'ref': {
      if (stack.includes(expression.name)) {
        throw new Error(`predicate cycle: ${[...stack, expression.name].join(' -> ')}`);
      }
      const target = namedPredicates[expression.name];
      if (!target) throw new Error(`unknown predicate ref: ${expression.name}`);
      return evaluatePredicate(
        target,
        context,
        namedPredicates,
        registers,
        actorClasses,
        [...stack, expression.name],
      );
    }
    case 'all':
      if (!Array.isArray(expression.args) || expression.args.length === 0) {
        throw new Error('all requires nonempty args');
      }
      return expression.args.every((arg) =>
        evaluatePredicate(
          arg,
          context,
          namedPredicates,
          registers,
          actorClasses,
          stack,
        ),
      );
    case 'any':
      if (!Array.isArray(expression.args) || expression.args.length === 0) {
        throw new Error('any requires nonempty args');
      }
      return expression.args.some((arg) =>
        evaluatePredicate(
          arg,
          context,
          namedPredicates,
          registers,
          actorClasses,
          stack,
        ),
      );
    case 'not':
      return !evaluatePredicate(
        expression.arg,
        context,
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    case 'role_in':
      return resolveRoleSet(actorClasses, expression.set).includes(
        context.actor.role,
      );
    case 'fact_eq': {
      const left = pathValue(context, expression.leftPath);
      if (!left.exists) return false;
      if ('rightPath' in expression) {
        const right = pathValue(context, expression.rightPath);
        return right.exists && Object.is(left.value, right.value);
      }
      return Object.is(left.value, expression.rightValue);
    }
    case 'fact_in': {
      const left = pathValue(context, expression.leftPath);
      return (
        left.exists &&
        Array.isArray(expression.rightValues) &&
        expression.rightValues.some((value) => Object.is(value, left.value))
      );
    }
    case 'date_lte': {
      const left = pathValue(context, expression.leftPath);
      return (
        left.exists &&
        typeof left.value === 'string' &&
        left.value <= expression.rightValue
      );
    }
    case 'date_gte': {
      const left = pathValue(context, expression.leftPath);
      return (
        left.exists &&
        typeof left.value === 'string' &&
        left.value >= expression.rightValue
      );
    }
    case 'owner_dispatch': {
      const ownerType = pathValue(context, expression.ownerTypePath);
      if (!ownerType.exists || typeof ownerType.value !== 'string') return false;
      const branch = expression.cases?.[ownerType.value] ?? expression.default;
      if (!branch) return false;
      return evaluatePredicate(
        branch,
        context,
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    }
    case 'dependency_exists': {
      const dependency = dependencyFor(context, expression.relationship);
      if (!dependency) return false;
      return !expression.table || dependency.table === expression.table;
    }
    case 'dependency_field_eq': {
      const dependency = dependencyFor(context, expression.relationship);
      if (!dependency) return false;
      return Object.is(dependency[expression.field], expression.rightValue);
    }
    case 'dependency_link_eq': {
      const left = dependencyFor(context, expression.leftRelationship);
      const right = dependencyFor(context, expression.rightRelationship);
      if (!left || !right) return false;
      return Object.is(
        left[expression.leftField],
        right[expression.rightField],
      );
    }
    case 'source_dependency_link_eq': {
      const source = pathValue(context, expression.sourcePath);
      const dependency = dependencyFor(context, expression.relationship);
      if (!source.exists || !dependency) return false;
      return Object.is(source.value, dependency[expression.dependencyPath]);
    }
    case 'dependency_register_readable': {
      const dependency = dependencyFor(context, expression.relationship);
      const register = registers[expression.register];
      if (!dependency || !register) return false;
      return evaluatePredicate(
        register.readableWhen,
        {
          ...context,
          row: dependency.row ?? dependency,
          dependencies: dependency.dependencies ?? [],
        },
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    }
    case 'register_readable': {
      const referenced = pathValue(context, expression.rowPath);
      const register = registers[expression.register];
      if (!referenced.exists || !register) return false;
      return evaluatePredicate(
        register.readableWhen,
        { ...context, row: referenced.value },
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    }
    default:
      throw new Error(`unknown predicate operator: ${expression.op}`);
  }
}

function snakeToCamel(value) {
  return value.replace(/_([a-z0-9])/gu, (_match, character) =>
    character.toUpperCase(),
  );
}

function collectProjectionFields(expression, result = new Set()) {
  if (!expression || typeof expression !== 'object') return result;
  if (expression.op === 'field') result.add(expression.path);
  for (const value of Object.values(expression)) {
    if (Array.isArray(value)) {
      for (const item of value) collectProjectionFields(item, result);
    } else if (value && typeof value === 'object') {
      collectProjectionFields(value, result);
    }
  }
  return result;
}

function logicalRowForFixture(fixture, projectionRecipe) {
  const logical = {};
  for (const source of [
    fixture.physicalRow?.values ?? {},
    fixture.matchFields ?? {},
    fixture.projectionInputs ?? {},
  ]) {
    for (const [key, value] of Object.entries(source)) {
      logical[snakeToCamel(key)] = value;
    }
  }
  for (const [key, value] of Object.entries(fixture.rowFacts ?? {})) {
    logical[key] = value;
  }
  logical.recordKind = fixture.source.recordKind;
  for (const field of collectProjectionFields(projectionRecipe)) {
    if (!(field in logical)) logical[field] = null;
  }
  return logical;
}

function evaluateProjection(expression, logicalRow) {
  switch (expression.op) {
    case 'literal':
      return expression.value;
    case 'null':
      return null;
    case 'field':
      if (!(expression.path in logicalRow)) {
        throw new Error(`missing logical projection field: ${expression.path}`);
      }
      return logicalRow[expression.path];
    case 'coalesce':
      for (const arg of expression.args) {
        const value = evaluateProjection(arg, logicalRow);
        if (value !== null) return value;
      }
      return null;
    case 'concat_ws': {
      const values = expression.args
        .map((arg) => evaluateProjection(arg, logicalRow))
        .filter((value) => value !== null);
      if (values.some((value) => typeof value !== 'string')) {
        throw new Error('concat_ws requires string or null operands');
      }
      return values.join(expression.separator);
    }
    case 'null_if_empty': {
      const value = evaluateProjection(expression.arg, logicalRow);
      return value === '' ? null : value;
    }
    case 'concat': {
      const values = expression.args.map((arg) =>
        evaluateProjection(arg, logicalRow),
      );
      if (values.some((value) => typeof value !== 'string')) {
        throw new Error('concat requires non-null string operands');
      }
      return values.join('');
    }
    default:
      throw new Error(`unknown projection operator: ${expression.op}`);
  }
}

export class BaselineDriftError extends Error {
  constructor(code, stage, safeDetail) {
    super(`${code}: ${safeDetail}`);
    this.name = 'BaselineDriftError';
    this.code = code;
    this.observedAt = stage;
  }
}

export function parseRawSearchCapture(bytes) {
  let text;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    throw new BaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'parseRawSearchCapture',
      'response is not strict UTF-8',
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'parseRawSearchCapture',
      'response is not JSON',
    );
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !Array.isArray(payload.results)
  ) {
    throw new BaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'parseRawSearchCapture',
      'response root does not equal the closed results shape',
    );
  }
  return payload;
}

function resolveResult(result, fixtures, actorTenantSlot) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new BaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'resolveBaselineResult',
      'result is not an object',
    );
  }
  const expectedKeys = ['id', 'kind', 'parentId', 'subtitle', 'title'];
  const observedKeys = Object.keys(result).sort();
  if (canonicalJson(observedKeys) !== canonicalJson(expectedKeys)) {
    throw new BaselineDriftError(
      'BASELINE_RESPONSE_SHAPE_DRIFT',
      'resolveBaselineResult',
      'result keys differ from the closed five-field shape',
    );
  }
  if (typeof result.kind !== 'string' || typeof result.id !== 'string') {
    throw new BaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'resolveBaselineResult',
      'result kind/id are not strings',
    );
  }
  const matches = fixtures.filter(
    (fixture) =>
      fixture.source.tenantSlot === actorTenantSlot &&
      fixture.approvedProjection.kind === result.kind &&
      fixture.approvedProjection.id === result.id,
  );
  if (matches.length !== 1) {
    throw new BaselineDriftError(
      'BASELINE_SOURCE_RESOLUTION_FAILURE',
      'resolveBaselineResult',
      `canonical source match count is ${matches.length}`,
    );
  }
  return matches[0];
}

export function sourceIsInPinnedBaseline({
  fixture,
  actor,
  policy,
  authoritative,
  actorClasses,
}) {
  const registerPolicy = policy.registers[fixture.source.register];
  const registerAuthority = authoritative.registers[fixture.source.register];
  if (!registerPolicy || !registerAuthority) {
    throw new Error(`unknown register: ${fixture.source.register}`);
  }
  const context = {
    actor,
    row: {
      ...(fixture.rowFacts ?? {}),
      tenantSlot: fixture.source.tenantSlot,
      recordKind: fixture.source.recordKind,
    },
    dependencies: fixture.dependencies ?? [],
  };
  const authoritativeReadable = evaluatePredicate(
    registerAuthority.readableWhen,
    context,
    authoritative.namedPredicates,
    authoritative.registers,
    actorClasses,
  );
  const baselineNarrowing = evaluatePredicate(
    registerPolicy.baselineNarrowing,
    context,
    {},
    authoritative.registers,
    actorClasses,
  );
  return authoritativeReadable && baselineNarrowing;
}

export function assertPinnedBaselineConformance({
  rawBytes,
  fixtures,
  actor,
  policy,
  authoritative,
  actorClasses,
}) {
  const payload = parseRawSearchCapture(rawBytes);
  const identities = new Set();
  const resolved = [];
  for (const result of payload.results) {
    const fixture = resolveResult(result, fixtures, actor.tenantSlot);
    const identity = canonicalJson([
      fixture.source.tenantSlot,
      fixture.source.register,
      fixture.source.recordKind,
      fixture.source.recordId,
    ]);
    if (identities.has(identity)) {
      throw new BaselineDriftError(
        'BASELINE_DUPLICATE_SOURCE',
        'assertPinnedBaselineConformance',
        'response repeats a canonical source',
      );
    }
    identities.add(identity);
    if (
      !sourceIsInPinnedBaseline({
        fixture,
        actor,
        policy,
        authoritative,
        actorClasses,
      })
    ) {
      throw new BaselineDriftError(
        'BASELINE_SOURCE_DRIFT',
        'assertPinnedBaselineConformance',
        'resolved source lies outside B0',
      );
    }
    const registerPolicy = policy.registers[fixture.source.register];
    const logicalRow = logicalRowForFixture(
      fixture,
      registerPolicy.publicProjection,
    );
    const expectedProjection = Object.fromEntries(
      Object.entries(registerPolicy.publicProjection).map(
        ([key, expression]) => [
          key,
          evaluateProjection(expression, logicalRow),
        ],
      ),
    );
    if (
      canonicalJson(expectedProjection) !==
      canonicalJson(fixture.approvedProjection)
    ) {
      throw new Error(
        `fixture projection differs from the pinned recipe: ${fixture.fixtureId}`,
      );
    }
    if (canonicalJson(result) !== canonicalJson(expectedProjection)) {
      throw new BaselineDriftError(
        'BASELINE_PROJECTION_DRIFT',
        'assertPinnedBaselineConformance',
        'public projection differs from the dae27a4 baseline',
      );
    }
    resolved.push({ identity, fixtureId: fixture.fixtureId });
  }
  return { resultCount: resolved.length, resolved };
}

function locateUniqueResult(payload, kind, id) {
  const matches = payload.results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.kind === kind && result.id === id);
  if (matches.length !== 1) {
    throw new Error(`RED target match count is ${matches.length}`);
  }
  return matches[0];
}

function runSelfTest() {
  const policyArtifact = parseArtifact(POLICY_FILENAME);
  const authoritativeArtifact = parseArtifact(AUTHORITATIVE_FILENAME);
  const actorArtifact = parseArtifact(ACTOR_FILENAME);
  const fixtureArtifact = parseArtifact(FIXTURE_FILENAME);
  const controlArtifact = parseArtifact(CONTROL_FILENAME);
  const policy = policyArtifact.value;
  const authoritative = authoritativeArtifact.value;
  const actorClasses = actorArtifact.value;
  const fixtureContract = fixtureArtifact.value;
  const plan = controlArtifact.value;
  const actor = plan.baseline.actor;
  const cleanFixture = fixtureContract.fixtures.find(
    ({ fixtureId }) => fixtureId === plan.baseline.cleanFixtureId,
  );
  if (!cleanFixture) throw new Error('clean RED fixture is missing');

  let projectionValidatedCount = 0;
  for (const fixture of fixtureContract.fixtures) {
    const registerPolicy = policy.registers[fixture.source.register];
    if (!registerPolicy) throw new Error(`missing policy register ${fixture.source.register}`);
    const logicalRow = logicalRowForFixture(
      fixture,
      registerPolicy.publicProjection,
    );
    const computed = Object.fromEntries(
      Object.entries(registerPolicy.publicProjection).map(
        ([key, expression]) => [key, evaluateProjection(expression, logicalRow)],
      ),
    );
    if (canonicalJson(computed) !== canonicalJson(fixture.approvedProjection)) {
      throw new Error(
        `logical projection recipe differs from the pinned fixture baseline: ${fixture.fixtureId}`,
      );
    }
    projectionValidatedCount += 1;
  }

  const baselinePayload = { results: [cleanFixture.approvedProjection] };
  const baselineRawBytes = Buffer.from(JSON.stringify(baselinePayload), 'utf8');
  const cleanOutcome = assertPinnedBaselineConformance({
    rawBytes: baselineRawBytes,
    fixtures: fixtureContract.fixtures,
    actor,
    policy,
    authoritative,
    actorClasses,
  });
  const observations = [];

  for (const control of plan.controls) {
    const mutatedPayload = JSON.parse(baselineRawBytes.toString('utf8'));
    const target = locateUniqueResult(
      mutatedPayload,
      control.locateBaselineBy.kind,
      control.locateBaselineBy.id,
    );
    let forbiddenIdentityOrValue;
    let mutationJsonPointer;
    if (
      control.mutationMode ===
      'replace_result_with_fixture_public_projection'
    ) {
      const replacement = fixtureContract.fixtures.find(
        ({ fixtureId }) =>
          fixtureId === control.replacementProjectionFromFixture,
      );
      if (!replacement) throw new Error(`missing replacement fixture ${control.fixtureId}`);
      mutatedPayload.results[target.index] = replacement.approvedProjection;
      forbiddenIdentityOrValue = canonicalJson(control.replacementCanonicalSource);
      mutationJsonPointer = `/results/${target.index}`;
    } else if (
      control.mutationMode ===
      'replace_public_projection_value_with_forbidden_fixture_value'
    ) {
      const sourceFixture = fixtureContract.fixtures.find(
        ({ fixtureId }) =>
          fixtureId === control.forbiddenValueFrom.fixtureId,
      );
      if (!sourceFixture) throw new Error(`missing field fixture ${control.fixtureId}`);
      const forbiddenValue =
        sourceFixture.physicalRow.values[
          control.forbiddenValueFrom.physicalField
        ];
      mutatedPayload.results[target.index].title = forbiddenValue;
      forbiddenIdentityOrValue = String(forbiddenValue);
      mutationJsonPointer = `/results/${target.index}/title`;
    } else {
      throw new Error(`unknown RED mutation mode: ${control.mutationMode}`);
    }
    const mutatedRawBytes = Buffer.from(JSON.stringify(mutatedPayload), 'utf8');
    let observed;
    try {
      assertPinnedBaselineConformance({
        rawBytes: mutatedRawBytes,
        fixtures: fixtureContract.fixtures,
        actor,
        policy,
        authoritative,
        actorClasses,
      });
      throw new Error(`RED control unexpectedly passed: ${control.controlId}`);
    } catch (error) {
      if (!(error instanceof BaselineDriftError)) throw error;
      observed = error;
    }
    if (
      observed.code !== control.expectedFailureCode ||
      observed.observedAt !== control.expectedObservedAt
    ) {
      throw new Error(
        `RED control wrong failure ${control.controlId}: ${observed.code}/${observed.observedAt}`,
      );
    }
    observations.push({
      controlId: control.controlId,
      fixtureId: control.fixtureId,
      actorProfileId: plan.baseline.actorProfileId,
      corpusProfileId: plan.baseline.corpusProfileId,
      mutationMode: control.mutationMode,
      mutationJsonPointer,
      classification: control.classification,
      forbiddenIdentityOrValueSha256: sha256(
        Buffer.from(forbiddenIdentityOrValue, 'utf8'),
      ),
      mutatedCaptureSha256: sha256(mutatedRawBytes),
      expectedFailureCode: control.expectedFailureCode,
      observedFailureCode: observed.code,
      observedAt: observed.observedAt,
      metricsStarted: false,
      rawForbiddenValueRetained: false,
    });
  }

  const sourceBytes = readFileSync(fileURLToPath(import.meta.url));
  return {
    schemaVersion: 1,
    artifactKind:
      'hearth-search-disclosure-drift-red-self-test-receipt',
    selfTestVersion:
      'HEARTH-003-DISCLOSURE-DRIFT-RED-SELF-TEST-v1',
    syntheticOnly: true,
    authority: 'Apex Lumen',
    implementationStatus:
      'PINNED_BASELINE_DRIFT_RED_OBSERVED_NOT_MEASURED_H1_H4_RECEIPT',
    claimBoundary:
      'This receipt proves detector sensitivity: the reference parser/resolver/checker rejects one outside-B0 source and one changed projection. It does not prove that dae27a4 is authorized, correct, complete, or leak-free. H1 must repeat the plan on measured application bytes before metrics.',
    inputHashes: {
      controlPlanCanonicalTextSha256: canonicalTextSha256(
        controlArtifact.bytes,
        CONTROL_FILENAME,
      ),
      driftBaselineCanonicalTextSha256: canonicalTextSha256(
        policyArtifact.bytes,
        POLICY_FILENAME,
      ),
      authoritativePredicatesCanonicalTextSha256: canonicalTextSha256(
        authoritativeArtifact.bytes,
        AUTHORITATIVE_FILENAME,
      ),
      actorClassesCanonicalTextSha256: canonicalTextSha256(
        actorArtifact.bytes,
        ACTOR_FILENAME,
      ),
      fixtureContractCanonicalTextSha256: canonicalTextSha256(
        fixtureArtifact.bytes,
        FIXTURE_FILENAME,
      ),
      driftCheckerCanonicalTextSha256: canonicalTextSha256(
        sourceBytes,
        fileURLToPath(import.meta.url),
      ),
    },
    baselineRawCaptureSha256: sha256(baselineRawBytes),
    baselineCleanOutcome: 'PASS',
    baselineResolvedResultCount: cleanOutcome.resultCount,
    logicalProjectionRecipeValidatedFixtureCount:
      projectionValidatedCount,
    controls: observations,
    expectedControlCount: plan.controls.length,
    observedControlCount: observations.length,
    allExpectedFailuresObserved:
      observations.length === plan.controls.length,
    metricsStarted: false,
    rawForbiddenValueRetained: false,
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
    `disclosure drift RED PASS (${receipt.observedControlCount} controls; ${receipt.logicalProjectionRecipeValidatedFixtureCount} projections)\n`,
  );
}
