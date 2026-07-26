import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  AuthorityBundleError,
  canonicalJson,
  canonicalJsonSha256,
  isObject,
  parseJsonBytes,
  type BundleContract,
  type JsonObject,
  type VerifiedBundle,
  verifyAuthorityBundle,
} from './bundleVerifier.js';

export const R6_EXTERNAL_MANIFEST_ROOT =
  '0370dc21c8b51b86e9ddc1f58273abf6a4587dca29b6ff23ce875e024ee64706';

export const R6_AUTHORITY_MODEL =
  'PINNED_BASELINE_DRIFT_DETECTOR_NOT_DISCLOSURE_ORACLE';

const MANIFEST_FILENAME = 'HEARTH-003-SHA256SUMS-v7.json';
const CONTRACT_FILENAME = 'HEARTH-003-BUNDLE-CONTRACT-v2.json';
const PRODUCT_BASELINE_COMMIT =
  'dae27a400868c0c686788ab8e5520690dbf77334';

const defaultAuthorityDirectory = fileURLToPath(
  new URL('../../authority/r6/', import.meta.url),
);

export interface SideEffectEvent {
  sequence: number;
  capability: 'seed' | 'database' | 'network' | 'http' | 'metrics';
}

export interface SideEffectLedger {
  attemptedEvents: SideEffectEvent[];
}

export interface R6PreflightReport {
  authorityModel: typeof R6_AUTHORITY_MODEL;
  externallyPinnedManifestRoot: string;
  verifiedSlotCount: number;
  identityAssertionCount: number;
  crossBindingCount: number;
  slotContentBindingCount: number;
  qrelCaseCount: number;
  qrelJudgmentCount: number;
  residualGroupCount: number;
  residualItemCount: number;
  baselineRegisterCount: number;
  baselineMatchFieldCount: number;
  baselineProjectionExpressionCount: number;
  baselineProjectionFieldReferenceCount: number;
  baselineObservationCount: number;
  driftRedControlCount: number;
  acceptanceTargetCount: number;
  measurementStatus: 'NOT_YET_MEASURED';
  doesNotProve: readonly string[];
}

export interface R6PreflightOptions {
  authorityDirectory?: string;
  readFile?: (path: string) => Uint8Array;
  listDirectory?: (path: string) => readonly string[];
  sideEffectLedger?: SideEffectLedger;
  afterVerifiedCapability?:
    | 'seed'
    | 'database'
    | 'network'
    | 'http'
    | 'metrics';
  afterVerified?: () => void;
  redDiscriminationFaultForTest?: 'skip-first-mutation';
}

export interface R6AuthorityLoadOptions {
  authorityDirectory?: string;
  readFile?: (path: string) => Uint8Array;
  listDirectory?: (path: string) => readonly string[];
  redDiscriminationFaultForTest?: 'skip-first-mutation';
}

export interface R6VerifiedAuthorityView {
  readonly slots: readonly string[];
  readJson(slot: string): Readonly<JsonObject>;
  readText(slot: string): string;
}

export interface LoadedR6VerifiedAuthority {
  readonly report: R6PreflightReport;
  readonly authority: R6VerifiedAuthorityView;
}

export class R6AuthorityPreflightError extends Error {
  constructor(
    readonly code: string,
    readonly stage: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'R6AuthorityPreflightError';
  }
}

function fail(code: string, stage: string, detail: string): never {
  throw new R6AuthorityPreflightError(code, stage, detail);
}

function object(
  value: unknown,
  label: string,
  stage = 'semantic',
): JsonObject {
  if (!isObject(value)) {
    fail('R6_AUTHORITY_SEMANTIC_MISMATCH', stage, `${label} is not an object`);
  }
  return value;
}

function array(
  value: unknown,
  label: string,
  stage = 'semantic',
): unknown[] {
  if (!Array.isArray(value)) {
    fail('R6_AUTHORITY_SEMANTIC_MISMATCH', stage, `${label} is not an array`);
  }
  return value;
}

function exact(
  observed: unknown,
  expected: unknown,
  label: string,
  stage = 'semantic',
): void {
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    fail('R6_AUTHORITY_SEMANTIC_MISMATCH', stage, `${label} differs`);
  }
}

function parsed(bundle: VerifiedBundle, slot: string): JsonObject {
  const artifact = bundle.verified.get(slot);
  if (artifact === undefined || artifact.parsed === null) {
    fail(
      'R6_AUTHORITY_SEMANTIC_MISMATCH',
      'semantic-input',
      `${slot} is unavailable as verified JSON`,
    );
  }
  return artifact.parsed;
}

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, key));
  }
  if (!isObject(value)) return false;
  return (
    Object.prototype.hasOwnProperty.call(value, key) ||
    Object.values(value).some((item) => containsKey(item, key))
  );
}

function renameJudgmentKey(
  value: unknown,
  state: { count: number },
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => renameJudgmentKey(item, state));
  }
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'approvedActorClasses') {
      fail(
        'R6_QREL_SEMANTIC_MISMATCH',
        'qrels-key-transition',
        'QRELS-v7 retains approvedActorClasses',
      );
    }
    const renamed =
      key === 'baselineActorClasses' ? 'approvedActorClasses' : key;
    if (key === 'baselineActorClasses') state.count += 1;
    result[renamed] = renameJudgmentKey(child, state);
  }
  return result;
}

interface ResidualSummary {
  groupCount: number;
  itemCount: number;
  inheritedCount: number;
  inheritedHash: string;
  allHash: string;
  observedGroups: JsonObject;
}

function residualItems(value: unknown, group: string): JsonObject[] {
  return array(value, group, 'residual-continuity').map((item) => {
    const candidate = object(item, `${group} item`, 'residual-continuity');
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      typeof candidate.status !== 'string' ||
      candidate.status.length === 0 ||
      typeof candidate.statement !== 'string' ||
      candidate.statement.length === 0
    ) {
      fail(
        'R6_RESIDUAL_SCHEMA_MISMATCH',
        'residual-continuity',
        `${group} contains an incomplete residual`,
      );
    }
    return candidate;
  });
}

function sortedResiduals(items: JsonObject[]): JsonObject[] {
  return [...items].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
}

function verifyResidualContinuity(bundle: VerifiedBundle): ResidualSummary {
  const ledger = parsed(bundle, 'HEARTH-003-INHERITED-RESIDUALS-v2.json');
  const contract = parsed(
    bundle,
    'HEARTH-003-RESIDUAL-CONTINUITY-CONTRACT-v1.json',
  );
  exact(
    ledger.artifactKind,
    'hearth-search-residual-ledger',
    'residual ledger kind',
    'residual-continuity',
  );
  exact(
    contract.continuityContractVersion,
    'HEARTH-003-RESIDUAL-CONTINUITY-CONTRACT-v1',
    'residual contract version',
    'residual-continuity',
  );

  const groups = array(
    contract.groups,
    'residual groups',
    'residual-continuity',
  );
  const allIds: string[] = [];
  const groupsByName = new Map<string, JsonObject[]>();
  const observedGroups: JsonObject = {};
  for (const rawGroup of groups) {
    const group = object(
      rawGroup,
      'residual group contract',
      'residual-continuity',
    );
    if (
      typeof group.group !== 'string' ||
      typeof group.expectedCount !== 'number' ||
      typeof group.canonicalJsonSha256 !== 'string'
    ) {
      fail(
        'R6_RESIDUAL_SCHEMA_MISMATCH',
        'residual-continuity',
        'residual group contract is incomplete',
      );
    }
    const items = residualItems(ledger[group.group], group.group);
    const ids = items.map(({ id }) => String(id));
    if (new Set(ids).size !== ids.length) {
      fail(
        'R6_RESIDUAL_DUPLICATE_ID',
        'residual-continuity',
        `duplicate residual ID in ${group.group}`,
      );
    }
    const expectedIds = array(
      group.expectedIds,
      `${group.group} expected IDs`,
      'residual-continuity',
    )
      .map(String)
      .sort();
    exact(
      [...ids].sort(),
      expectedIds,
      `${group.group} residual IDs`,
      'residual-continuity',
    );
    if (items.length !== group.expectedCount) {
      fail(
        'R6_RESIDUAL_MEMBERSHIP_MISMATCH',
        'residual-continuity',
        `${group.group} count differs`,
      );
    }
    const hash = canonicalJsonSha256(sortedResiduals(items));
    exact(
      hash,
      group.canonicalJsonSha256,
      `${group.group} content hash`,
      'residual-continuity',
    );
    allIds.push(...ids);
    groupsByName.set(group.group, items);
    observedGroups[group.group] = {
      count: items.length,
      canonicalJsonSha256: hash,
    };
  }
  if (new Set(allIds).size !== allIds.length) {
    fail(
      'R6_RESIDUAL_DUPLICATE_ID',
      'residual-continuity',
      'a residual ID appears in more than one group',
    );
  }

  const required = (name: string): JsonObject[] => {
    const items = groupsByName.get(name);
    if (items === undefined) {
      fail(
        'R6_RESIDUAL_MEMBERSHIP_MISMATCH',
        'residual-continuity',
        `required group is absent: ${name}`,
      );
    }
    return items;
  };
  const inherited = sortedResiduals([
    ...required('inheritedR3Residuals'),
    ...required('r4DisposableValidatorResiduals'),
    ...required('r5ForwardResiduals'),
  ]);
  const all = sortedResiduals([
    ...inherited,
    ...required('r6ClaimLimitResiduals'),
    ...required('structuralFindings'),
    ...required('nonBlockingRecordDefects'),
  ]);
  const aggregate = object(
    contract.aggregatePins,
    'residual aggregate pins',
    'residual-continuity',
  );
  const inheritedHash = canonicalJsonSha256(inherited);
  const allHash = canonicalJsonSha256(all);
  exact(
    inherited.length,
    aggregate.inherited5Plus8Plus3Count,
    'inherited residual count',
    'residual-continuity',
  );
  exact(
    inheritedHash,
    aggregate.inherited5Plus8Plus3CanonicalJsonSha256,
    'inherited residual hash',
    'residual-continuity',
  );
  exact(
    all.length,
    aggregate.allContentBoundItemCount,
    'complete residual count',
    'residual-continuity',
  );
  exact(
    allHash,
    aggregate.allContentBoundItemsCanonicalJsonSha256,
    'complete residual hash',
    'residual-continuity',
  );

  const validation = parsed(
    bundle,
    'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json',
  );
  const receipt = object(
    validation.residualContinuity,
    'validation residual receipt',
    'residual-continuity',
  );
  exact(
    receipt.observedGroups,
    observedGroups,
    'validation residual groups',
    'residual-continuity',
  );
  exact(
    receipt.inherited5Plus8Plus3CanonicalJsonSha256,
    inheritedHash,
    'validation inherited residual hash',
    'residual-continuity',
  );
  exact(
    receipt.allContentBoundItemsCanonicalJsonSha256,
    allHash,
    'validation complete residual hash',
    'residual-continuity',
  );

  return {
    groupCount: groups.length,
    itemCount: all.length,
    inheritedCount: inherited.length,
    inheritedHash,
    allHash,
    observedGroups,
  };
}

interface QrelSummary {
  caseCount: number;
  judgmentCount: number;
}

function verifyQrels(bundle: VerifiedBundle): QrelSummary {
  const qrels = parsed(bundle, 'HEARTH-003-QRELS-v7.json');
  const validation = parsed(
    bundle,
    'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json',
  );
  exact(
    qrels.querySetVersion,
    'HEARTH-003-QRELS-v7',
    'QRELS version',
    'qrels',
  );
  if (containsKey(qrels, 'approvedActorClasses')) {
    fail(
      'R6_QREL_SEMANTIC_MISMATCH',
      'qrels',
      'QRELS-v7 contains approvedActorClasses',
    );
  }
  const cases = array(qrels.cases, 'QRELS cases', 'qrels');
  exact(cases.length, 280, 'QRELS case count', 'qrels');
  const caseIds: string[] = [];
  let judgmentCount = 0;
  for (const rawCase of cases) {
    const queryCase = object(rawCase, 'QREL case', 'qrels');
    if (
      typeof queryCase.queryCaseId !== 'string' ||
      queryCase.queryCaseId.length === 0 ||
      typeof queryCase.queryClass !== 'string' ||
      typeof queryCase.query !== 'string'
    ) {
      fail(
        'R6_QREL_SCHEMA_MISMATCH',
        'qrels',
        'QREL case identity/query shape is incomplete',
      );
    }
    caseIds.push(queryCase.queryCaseId);
    const judgments = array(
      queryCase.sourceJudgments,
      `${queryCase.queryCaseId} judgments`,
      'qrels',
    );
    for (const rawJudgment of judgments) {
      const judgment = object(rawJudgment, 'QREL judgment', 'qrels');
      const source = object(
        judgment.source,
        `${queryCase.queryCaseId} judgment source`,
        'qrels',
      );
      if (
        !(
          typeof judgment.fixtureId === 'string' ||
          (judgment.fixtureId === null &&
            typeof judgment.supportingRowId === 'string')
        ) ||
        typeof source.tenantSlot !== 'string' ||
        typeof source.register !== 'string' ||
        typeof source.recordId !== 'string' ||
        !(
          source.recordKind === null ||
          typeof source.recordKind === 'string'
        ) ||
        typeof judgment.rankGroup !== 'number' ||
        !Array.isArray(judgment.authoritativeActorClasses) ||
        !Array.isArray(judgment.baselineActorClasses)
      ) {
        fail(
          'R6_QREL_SCHEMA_MISMATCH',
          'qrels',
          `${queryCase.queryCaseId} has an incomplete judgment`,
        );
      }
      judgmentCount += 1;
    }
  }
  if (new Set(caseIds).size !== caseIds.length) {
    fail(
      'R6_QREL_SCHEMA_MISMATCH',
      'qrels',
      'QRELS repeats a queryCaseId',
    );
  }
  exact(judgmentCount, 315, 'QRELS judgment count', 'qrels');

  const transition = object(
    validation.qrelsTransition,
    'QRELS transition receipt',
    'qrels-key-transition',
  );
  const state = { count: 0 };
  const normalized = renameJudgmentKey(cases, state);
  const normalizedHash = canonicalJsonSha256(normalized);
  exact(
    state.count,
    transition.changedJudgmentKeyCount,
    'QRELS renamed judgment-key count',
    'qrels-key-transition',
  );
  exact(
    state.count,
    315,
    'QRELS baselineActorClasses key count',
    'qrels-key-transition',
  );
  exact(
    canonicalJsonSha256(cases),
    transition.qrelsV7CasesCanonicalJsonSha256,
    'QRELS-v7 cases hash',
    'qrels-key-transition',
  );
  exact(
    normalizedHash,
    transition.qrelsV7CasesNormalizedToV6KeyCanonicalJsonSha256,
    'normalized QRELS-v7 cases hash',
    'qrels-key-transition',
  );
  exact(
    normalizedHash,
    transition.qrelsV6CasesCanonicalJsonSha256,
    'QRELS-v6 key-only equivalence hash',
    'qrels-key-transition',
  );
  exact(
    {
      normalizedJudgmentEquality: transition.normalizedJudgmentEquality,
      judgmentValueChanges: transition.judgmentValueChanges,
      queryTextChanges: transition.queryTextChanges,
      expectedSourceChanges: transition.expectedSourceChanges,
    },
    {
      normalizedJudgmentEquality: true,
      judgmentValueChanges: 0,
      queryTextChanges: 0,
      expectedSourceChanges: 0,
    },
    'QRELS-v6 to v7 key-only transition',
    'qrels-key-transition',
  );
  return { caseCount: cases.length, judgmentCount };
}

function collectProjectionFields(
  expression: unknown,
  result = new Set<string>(),
): Set<string> {
  if (Array.isArray(expression)) {
    for (const item of expression) collectProjectionFields(item, result);
  } else if (isObject(expression)) {
    if (expression.op === 'field' && typeof expression.path === 'string') {
      result.add(expression.path);
    }
    for (const value of Object.values(expression)) {
      collectProjectionFields(value, result);
    }
  }
  return result;
}

interface PredicateContext extends JsonObject {
  actor: JsonObject;
  row: JsonObject;
  dependencies: JsonObject[];
}

function pathValue(
  root: unknown,
  path: unknown,
): { exists: boolean; value: unknown } {
  if (typeof path !== 'string' || path.length === 0) {
    return { exists: false, value: undefined };
  }
  let value = root;
  for (const part of path.split('.')) {
    if (
      (!isObject(value) && !Array.isArray(value)) ||
      !Object.prototype.hasOwnProperty.call(value, part)
    ) {
      return { exists: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[part];
  }
  return { exists: true, value };
}

function dependencyFor(
  context: PredicateContext,
  relationship: unknown,
): JsonObject | null {
  if (typeof relationship !== 'string') {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'assertPinnedBaselineConformance',
      'dependency relationship is not a string',
    );
  }
  const matches = context.dependencies.filter(
    ({ relationship: candidate }) => candidate === relationship,
  );
  if (matches.length > 1) {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'assertPinnedBaselineConformance',
      `duplicate dependency relationship: ${relationship}`,
    );
  }
  return matches[0] ?? null;
}

function evaluatePredicate(
  rawExpression: unknown,
  context: PredicateContext,
  namedPredicates: JsonObject,
  registers: JsonObject,
  actorClasses: JsonObject,
  stack: string[] = [],
): boolean {
  const expression = object(
    rawExpression,
    'predicate expression',
    'assertPinnedBaselineConformance',
  );
  switch (expression.op) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'ref': {
      if (typeof expression.name !== 'string') {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          'predicate ref has no name',
        );
      }
      if (stack.includes(expression.name)) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          `predicate cycle: ${[...stack, expression.name].join(' -> ')}`,
        );
      }
      const target = namedPredicates[expression.name];
      if (target === undefined) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          `unknown predicate ref: ${expression.name}`,
        );
      }
      return evaluatePredicate(
        target,
        context,
        namedPredicates,
        registers,
        actorClasses,
        [...stack, expression.name],
      );
    }
    case 'all': {
      const args = array(
        expression.args,
        'all predicate args',
        'assertPinnedBaselineConformance',
      );
      if (args.length === 0) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          'all predicate has no arguments',
        );
      }
      return args.every((arg) =>
        evaluatePredicate(
          arg,
          context,
          namedPredicates,
          registers,
          actorClasses,
          stack,
        ),
      );
    }
    case 'any': {
      const args = array(
        expression.args,
        'any predicate args',
        'assertPinnedBaselineConformance',
      );
      if (args.length === 0) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          'any predicate has no arguments',
        );
      }
      return args.some((arg) =>
        evaluatePredicate(
          arg,
          context,
          namedPredicates,
          registers,
          actorClasses,
          stack,
        ),
      );
    }
    case 'not':
      return !evaluatePredicate(
        expression.arg,
        context,
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    case 'role_in': {
      const roleSets = object(
        actorClasses.roleSets,
        'actor role sets',
        'assertPinnedBaselineConformance',
      );
      if (typeof expression.set !== 'string') {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          'role_in set is not a string',
        );
      }
      const roles = array(
        roleSets[expression.set],
        `role set ${expression.set}`,
        'assertPinnedBaselineConformance',
      );
      if (roles.length === 0) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          `role set is empty: ${expression.set}`,
        );
      }
      return roles.includes(context.actor.role);
    }
    case 'fact_eq': {
      const left = pathValue(context, expression.leftPath);
      if (!left.exists) return false;
      if (Object.prototype.hasOwnProperty.call(expression, 'rightPath')) {
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
        expression.rightValues.some((value) =>
          Object.is(value, left.value),
        )
      );
    }
    case 'date_lte': {
      const left = pathValue(context, expression.leftPath);
      return (
        left.exists &&
        typeof left.value === 'string' &&
        typeof expression.rightValue === 'string' &&
        left.value <= expression.rightValue
      );
    }
    case 'date_gte': {
      const left = pathValue(context, expression.leftPath);
      return (
        left.exists &&
        typeof left.value === 'string' &&
        typeof expression.rightValue === 'string' &&
        left.value >= expression.rightValue
      );
    }
    case 'owner_dispatch': {
      const ownerType = pathValue(context, expression.ownerTypePath);
      if (!ownerType.exists || typeof ownerType.value !== 'string') {
        return false;
      }
      const cases = isObject(expression.cases)
        ? expression.cases
        : {};
      const branch = cases[ownerType.value] ?? expression.default;
      if (branch === undefined) return false;
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
      const dependency = dependencyFor(
        context,
        expression.relationship,
      );
      return (
        dependency !== null &&
        (expression.table === undefined ||
          dependency.table === expression.table)
      );
    }
    case 'dependency_field_eq': {
      const dependency = dependencyFor(
        context,
        expression.relationship,
      );
      return (
        dependency !== null &&
        typeof expression.field === 'string' &&
        Object.is(
          dependency[expression.field],
          expression.rightValue,
        )
      );
    }
    case 'dependency_link_eq': {
      const left = dependencyFor(
        context,
        expression.leftRelationship,
      );
      const right = dependencyFor(
        context,
        expression.rightRelationship,
      );
      return (
        left !== null &&
        right !== null &&
        typeof expression.leftField === 'string' &&
        typeof expression.rightField === 'string' &&
        Object.is(
          left[expression.leftField],
          right[expression.rightField],
        )
      );
    }
    case 'source_dependency_link_eq': {
      const source = pathValue(context, expression.sourcePath);
      const dependency = dependencyFor(
        context,
        expression.relationship,
      );
      return (
        source.exists &&
        dependency !== null &&
        typeof expression.dependencyPath === 'string' &&
        Object.is(
          source.value,
          dependency[expression.dependencyPath],
        )
      );
    }
    case 'dependency_register_readable': {
      const dependency = dependencyFor(
        context,
        expression.relationship,
      );
      const register =
        typeof expression.register === 'string'
          ? registers[expression.register]
          : undefined;
      if (dependency === null || !isObject(register)) return false;
      const dependencyRow = isObject(dependency.row)
        ? dependency.row
        : dependency;
      const dependencies = Array.isArray(dependency.dependencies)
        ? dependency.dependencies.map((item) =>
            object(
              item,
              'nested dependency',
              'assertPinnedBaselineConformance',
            ),
          )
        : [];
      return evaluatePredicate(
        register.readableWhen,
        { ...context, row: dependencyRow, dependencies },
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    }
    case 'register_readable': {
      const referenced = pathValue(context, expression.rowPath);
      const register =
        typeof expression.register === 'string'
          ? registers[expression.register]
          : undefined;
      if (!referenced.exists || !isObject(register)) return false;
      const referencedRow = object(
        referenced.value,
        'referenced readable row',
        'assertPinnedBaselineConformance',
      );
      return evaluatePredicate(
        register.readableWhen,
        { ...context, row: referencedRow },
        namedPredicates,
        registers,
        actorClasses,
        stack,
      );
    }
    default:
      fail(
        'R6_DRIFT_RED_SCHEMA_MISMATCH',
        'assertPinnedBaselineConformance',
        `unknown predicate operator: ${String(expression.op)}`,
      );
  }
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/gu, (_match, character: string) =>
    character.toUpperCase(),
  );
}

function optionalObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function logicalRowForFixture(
  fixture: JsonObject,
  projectionRecipe: JsonObject,
): JsonObject {
  const physicalRow = optionalObject(fixture.physicalRow);
  const logical: JsonObject = {};
  for (const source of [
    optionalObject(physicalRow.values),
    optionalObject(fixture.matchFields),
    optionalObject(fixture.projectionInputs),
  ]) {
    for (const [key, value] of Object.entries(source)) {
      logical[snakeToCamel(key)] = value;
    }
  }
  for (const [key, value] of Object.entries(
    optionalObject(fixture.rowFacts),
  )) {
    logical[key] = value;
  }
  const source = object(
    fixture.source,
    'fixture source',
    'assertPinnedBaselineConformance',
  );
  logical.recordKind = source.recordKind;
  for (const field of collectProjectionFields(projectionRecipe)) {
    if (!(field in logical)) logical[field] = null;
  }
  return logical;
}

function evaluateProjection(
  rawExpression: unknown,
  logicalRow: JsonObject,
): unknown {
  const expression = object(
    rawExpression,
    'projection expression',
    'assertPinnedBaselineConformance',
  );
  switch (expression.op) {
    case 'literal':
      return expression.value;
    case 'null':
      return null;
    case 'field':
      if (
        typeof expression.path !== 'string' ||
        !(expression.path in logicalRow)
      ) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          `missing logical projection field: ${String(expression.path)}`,
        );
      }
      return logicalRow[expression.path];
    case 'coalesce':
      for (const arg of array(
        expression.args,
        'coalesce args',
        'assertPinnedBaselineConformance',
      )) {
        const value = evaluateProjection(arg, logicalRow);
        if (value !== null) return value;
      }
      return null;
    case 'concat_ws': {
      const values = array(
        expression.args,
        'concat_ws args',
        'assertPinnedBaselineConformance',
      )
        .map((arg) => evaluateProjection(arg, logicalRow))
        .filter((value) => value !== null);
      if (
        typeof expression.separator !== 'string' ||
        values.some((value) => typeof value !== 'string')
      ) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          'concat_ws requires string or null operands',
        );
      }
      return values.join(expression.separator);
    }
    case 'null_if_empty': {
      const value = evaluateProjection(expression.arg, logicalRow);
      return value === '' ? null : value;
    }
    case 'concat': {
      const values = array(
        expression.args,
        'concat args',
        'assertPinnedBaselineConformance',
      ).map((arg) => evaluateProjection(arg, logicalRow));
      if (values.some((value) => typeof value !== 'string')) {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'assertPinnedBaselineConformance',
          'concat requires non-null string operands',
        );
      }
      return values.join('');
    }
    default:
      fail(
        'R6_DRIFT_RED_SCHEMA_MISMATCH',
        'assertPinnedBaselineConformance',
        `unknown projection operator: ${String(expression.op)}`,
      );
  }
}

class ExecutableBaselineDriftError extends Error {
  constructor(
    readonly code: string,
    readonly observedAt: 'assertPinnedBaselineConformance',
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ExecutableBaselineDriftError';
  }
}

const strictCaptureUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

function parseRawSearchCapture(rawBytes: Uint8Array): JsonObject {
  let payload: unknown;
  try {
    payload = JSON.parse(strictCaptureUtf8.decode(rawBytes));
  } catch {
    throw new ExecutableBaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'assertPinnedBaselineConformance',
      'response is not strict UTF-8 JSON',
    );
  }
  if (
    !isObject(payload) ||
    Object.keys(payload).length !== 1 ||
    !Array.isArray(payload.results)
  ) {
    throw new ExecutableBaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'assertPinnedBaselineConformance',
      'response root does not equal the closed results shape',
    );
  }
  return payload;
}

function fixtureSource(fixture: JsonObject): JsonObject {
  return object(
    fixture.source,
    'fixture source',
    'assertPinnedBaselineConformance',
  );
}

function pinnedBaselineProjection(fixture: JsonObject): JsonObject {
  return object(
    fixture.approvedProjection,
    'fixture baseline projection',
    'assertPinnedBaselineConformance',
  );
}

function resolveResult(
  rawResult: unknown,
  fixtures: JsonObject[],
  actorTenantSlot: unknown,
): JsonObject {
  const result = object(
    rawResult,
    'search result',
    'assertPinnedBaselineConformance',
  );
  exact(
    Object.keys(result).sort(),
    ['id', 'kind', 'parentId', 'subtitle', 'title'],
    'closed search result shape',
    'assertPinnedBaselineConformance',
  );
  if (typeof result.kind !== 'string' || typeof result.id !== 'string') {
    throw new ExecutableBaselineDriftError(
      'BASELINE_INVALID_RESPONSE',
      'assertPinnedBaselineConformance',
      'result kind/id are not strings',
    );
  }
  const matches = fixtures.filter((fixture) => {
    const source = fixtureSource(fixture);
    const projection = pinnedBaselineProjection(fixture);
    return (
      source.tenantSlot === actorTenantSlot &&
      projection.kind === result.kind &&
      projection.id === result.id
    );
  });
  if (matches.length !== 1) {
    throw new ExecutableBaselineDriftError(
      'BASELINE_SOURCE_RESOLUTION_FAILURE',
      'assertPinnedBaselineConformance',
      `canonical source match count is ${matches.length}`,
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw new ExecutableBaselineDriftError(
      'BASELINE_SOURCE_RESOLUTION_FAILURE',
      'assertPinnedBaselineConformance',
      'canonical source could not be resolved',
    );
  }
  return match;
}

function sourceIsInPinnedBaseline(input: {
  fixture: JsonObject;
  actor: JsonObject;
  policy: JsonObject;
  authoritative: JsonObject;
  actorClasses: JsonObject;
}): boolean {
  const source = fixtureSource(input.fixture);
  const policyRegisters = object(
    input.policy.registers,
    'baseline registers',
    'assertPinnedBaselineConformance',
  );
  const authorityRegisters = object(
    input.authoritative.registers,
    'authoritative registers',
    'assertPinnedBaselineConformance',
  );
  if (typeof source.register !== 'string') {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'assertPinnedBaselineConformance',
      'fixture register is not a string',
    );
  }
  const registerPolicy = object(
    policyRegisters[source.register],
    `baseline register ${source.register}`,
    'assertPinnedBaselineConformance',
  );
  const registerAuthority = object(
    authorityRegisters[source.register],
    `authoritative register ${source.register}`,
    'assertPinnedBaselineConformance',
  );
  const dependencies = Array.isArray(input.fixture.dependencies)
    ? input.fixture.dependencies.map((item) =>
        object(
          item,
          'fixture dependency',
          'assertPinnedBaselineConformance',
        ),
      )
    : [];
  const context: PredicateContext = {
    actor: input.actor,
    row: {
      ...optionalObject(input.fixture.rowFacts),
      tenantSlot: source.tenantSlot,
      recordKind: source.recordKind,
    },
    dependencies,
  };
  const namedPredicates = object(
    input.authoritative.namedPredicates,
    'authoritative named predicates',
    'assertPinnedBaselineConformance',
  );
  return (
    evaluatePredicate(
      registerAuthority.readableWhen,
      context,
      namedPredicates,
      authorityRegisters,
      input.actorClasses,
    ) &&
    evaluatePredicate(
      registerPolicy.baselineNarrowing,
      context,
      {},
      authorityRegisters,
      input.actorClasses,
    )
  );
}

function computeFixtureProjection(
  fixture: JsonObject,
  policy: JsonObject,
): JsonObject {
  const source = fixtureSource(fixture);
  if (typeof source.register !== 'string') {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'assertPinnedBaselineConformance',
      'fixture register is not a string',
    );
  }
  const registers = object(
    policy.registers,
    'baseline registers',
    'assertPinnedBaselineConformance',
  );
  const register = object(
    registers[source.register],
    `baseline register ${source.register}`,
    'assertPinnedBaselineConformance',
  );
  const recipe = object(
    register.publicProjection,
    `${source.register} public projection`,
    'assertPinnedBaselineConformance',
  );
  const logicalRow = logicalRowForFixture(fixture, recipe);
  return Object.fromEntries(
    Object.entries(recipe).map(([key, expression]) => [
      key,
      evaluateProjection(expression, logicalRow),
    ]),
  );
}

function assertExecutablePinnedBaselineConformance(input: {
  rawBytes: Uint8Array;
  fixtures: JsonObject[];
  actor: JsonObject;
  policy: JsonObject;
  authoritative: JsonObject;
  actorClasses: JsonObject;
}): number {
  const payload = parseRawSearchCapture(input.rawBytes);
  const results = array(
    payload.results,
    'search results',
    'assertPinnedBaselineConformance',
  );
  const identities = new Set<string>();
  for (const rawResult of results) {
    const fixture = resolveResult(
      rawResult,
      input.fixtures,
      input.actor.tenantSlot,
    );
    const source = fixtureSource(fixture);
    const identity = canonicalJson([
      source.tenantSlot,
      source.register,
      source.recordKind,
      source.recordId,
    ]);
    if (identities.has(identity)) {
      throw new ExecutableBaselineDriftError(
        'BASELINE_DUPLICATE_SOURCE',
        'assertPinnedBaselineConformance',
        'response repeats a canonical source',
      );
    }
    identities.add(identity);
    if (!sourceIsInPinnedBaseline({ ...input, fixture })) {
      throw new ExecutableBaselineDriftError(
        'BASELINE_SOURCE_DRIFT',
        'assertPinnedBaselineConformance',
        'resolved source lies outside B0',
      );
    }
    const expectedProjection = computeFixtureProjection(
      fixture,
      input.policy,
    );
    exact(
      expectedProjection,
      pinnedBaselineProjection(fixture),
      `fixture projection ${String(fixture.fixtureId)}`,
      'assertPinnedBaselineConformance',
    );
    if (canonicalJson(rawResult) !== canonicalJson(expectedProjection)) {
      throw new ExecutableBaselineDriftError(
        'BASELINE_PROJECTION_DRIFT',
        'assertPinnedBaselineConformance',
        'public projection differs from the dae27a4 baseline',
      );
    }
  }
  return results.length;
}

function locateUniqueResult(
  payload: JsonObject,
  kind: unknown,
  id: unknown,
): { result: JsonObject; index: number } {
  const matches = array(
    payload.results,
    'search results',
    'drift-red',
  )
    .map((value, index) => ({
      result: object(value, 'search result', 'drift-red'),
      index,
    }))
    .filter(
      ({ result }) => result.kind === kind && result.id === id,
    );
  if (matches.length !== 1) {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'drift-red',
      `RED target match count is ${matches.length}`,
    );
  }
  const match = matches[0];
  if (match === undefined) {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'drift-red',
      'RED target could not be located',
    );
  }
  return match;
}

interface ExecutedDriftRedSummary {
  cleanResultCount: number;
  projectionValidatedCount: number;
  observations: {
    controlId: unknown;
    observedFailureCode: string;
    observedAt: string;
  }[];
}

function executeDriftRedControls(input: {
  plan: JsonObject;
  fixtures: JsonObject[];
  actorClasses: JsonObject;
  policy: JsonObject;
  authoritative: JsonObject;
  fault?: 'skip-first-mutation';
}): ExecutedDriftRedSummary {
  let projectionValidatedCount = 0;
  for (const fixture of input.fixtures) {
    exact(
      computeFixtureProjection(fixture, input.policy),
      pinnedBaselineProjection(fixture),
      `logical projection recipe ${String(fixture.fixtureId)}`,
      'drift-red',
    );
    projectionValidatedCount += 1;
  }

  const baseline = object(input.plan.baseline, 'RED baseline', 'drift-red');
  const actor = object(baseline.actor, 'RED baseline actor', 'drift-red');
  const cleanFixture = input.fixtures.find(
    ({ fixtureId }) => fixtureId === baseline.cleanFixtureId,
  );
  if (cleanFixture === undefined) {
    fail(
      'R6_DRIFT_RED_SCHEMA_MISMATCH',
      'drift-red',
      'clean RED fixture is missing',
    );
  }
  const baselinePayload = {
    results: [pinnedBaselineProjection(cleanFixture)],
  };
  const baselineRawBytes = Buffer.from(
    JSON.stringify(baselinePayload),
    'utf8',
  );
  const cleanResultCount = assertExecutablePinnedBaselineConformance({
    rawBytes: baselineRawBytes,
    fixtures: input.fixtures,
    actor,
    policy: input.policy,
    authoritative: input.authoritative,
    actorClasses: input.actorClasses,
  });

  const observations: ExecutedDriftRedSummary['observations'] = [];
  const controls = array(
    input.plan.controls,
    'drift RED controls',
    'drift-red',
  ).map((value) => object(value, 'drift RED control', 'drift-red'));
  controls.forEach((control, controlIndex) => {
    const mutatedPayload = JSON.parse(
      baselineRawBytes.toString('utf8'),
    ) as JsonObject;
    const locate = object(
      control.locateBaselineBy,
      'RED baseline locator',
      'drift-red',
    );
    const target = locateUniqueResult(
      mutatedPayload,
      locate.kind,
      locate.id,
    );
    const skipMutation =
      input.fault === 'skip-first-mutation' && controlIndex === 0;
    if (!skipMutation) {
      if (
        control.mutationMode ===
        'replace_result_with_fixture_public_projection'
      ) {
        const replacement = input.fixtures.find(
          ({ fixtureId }) =>
            fixtureId === control.replacementProjectionFromFixture,
        );
        if (replacement === undefined) {
          fail(
            'R6_DRIFT_RED_SCHEMA_MISMATCH',
            'drift-red',
            `replacement fixture is missing: ${String(control.fixtureId)}`,
          );
        }
        const results = array(
          mutatedPayload.results,
          'mutated search results',
          'drift-red',
        );
        results[target.index] = pinnedBaselineProjection(replacement);
      } else if (
        control.mutationMode ===
        'replace_public_projection_value_with_forbidden_fixture_value'
      ) {
        const from = object(
          control.forbiddenValueFrom,
          'forbidden-value source',
          'drift-red',
        );
        const sourceFixture = input.fixtures.find(
          ({ fixtureId }) => fixtureId === from.fixtureId,
        );
        if (sourceFixture === undefined) {
          fail(
            'R6_DRIFT_RED_SCHEMA_MISMATCH',
            'drift-red',
            `field fixture is missing: ${String(control.fixtureId)}`,
          );
        }
        const physicalRow = object(
          sourceFixture.physicalRow,
          'forbidden-value physical row',
          'drift-red',
        );
        const values = object(
          physicalRow.values,
          'forbidden-value physical values',
          'drift-red',
        );
        if (
          typeof from.physicalField !== 'string' ||
          !(from.physicalField in values)
        ) {
          fail(
            'R6_DRIFT_RED_SCHEMA_MISMATCH',
            'drift-red',
            'forbidden physical field is unavailable',
          );
        }
        target.result.title = values[from.physicalField];
      } else {
        fail(
          'R6_DRIFT_RED_SCHEMA_MISMATCH',
          'drift-red',
          `unknown RED mutation mode: ${String(control.mutationMode)}`,
        );
      }
    }

    const mutatedRawBytes = Buffer.from(
      JSON.stringify(mutatedPayload),
      'utf8',
    );
    let observed: ExecutableBaselineDriftError | null = null;
    try {
      assertExecutablePinnedBaselineConformance({
        rawBytes: mutatedRawBytes,
        fixtures: input.fixtures,
        actor,
        policy: input.policy,
        authoritative: input.authoritative,
        actorClasses: input.actorClasses,
      });
    } catch (error) {
      if (!(error instanceof ExecutableBaselineDriftError)) throw error;
      observed = error;
    }
    if (observed === null) {
      fail(
        'R6_DRIFT_RED_NOT_DISCRIMINATING',
        'drift-red',
        `RED control unexpectedly passed: ${String(control.controlId)}`,
      );
    }
    exact(
      {
        code: observed.code,
        observedAt: observed.observedAt,
      },
      {
        code: control.expectedFailureCode,
        observedAt: control.expectedObservedAt,
      },
      `${String(control.controlId)} executable RED failure`,
      'drift-red',
    );
    observations.push({
      controlId: control.controlId,
      observedFailureCode: observed.code,
      observedAt: observed.observedAt,
    });
  });

  return {
    cleanResultCount,
    projectionValidatedCount,
    observations,
  };
}

interface BaselineSummary {
  registerCount: number;
  matchFieldCount: number;
  projectionExpressionCount: number;
  projectionFieldReferenceCount: number;
  observationCount: number;
  driftRedControlCount: number;
}

function verifyBaselineAndRed(
  bundle: VerifiedBundle,
  fault?: 'skip-first-mutation',
): BaselineSummary {
  const baseline = parsed(
    bundle,
    'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json',
  );
  const predicates = parsed(
    bundle,
    'HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json',
  );
  const fieldScope = parsed(
    bundle,
    'HEARTH-003-AUTHORITATIVE-FIELD-SCOPE-v1.json',
  );
  const actors = parsed(
    bundle,
    'HEARTH-003-DELEGATION-MEASUREMENT-v2.json',
  );
  const actorClasses = parsed(
    bundle,
    'HEARTH-003-ACTOR-CLASSES-v2.json',
  );
  const fixtures = parsed(
    bundle,
    'HEARTH-003-FIXTURE-CONTRACT-v5.json',
  );
  const validation = parsed(
    bundle,
    'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json',
  );
  const implementationDiff = parsed(
    bundle,
    'HEARTH-003-IMPLEMENTATION-DRIFT-DIFF-v1.json',
  );
  const registerPolicies = object(
    baseline.registers,
    'baseline registers',
    'baseline',
  );
  const predicateRegisters = object(
    predicates.registers,
    'predicate registers',
    'baseline',
  );
  const scopeRegisters = object(
    fieldScope.registers,
    'field-scope registers',
    'baseline',
  );
  const registerNames = Object.keys(registerPolicies);
  exact(
    registerNames,
    Object.keys(predicateRegisters),
    'baseline/predicate register order',
    'baseline',
  );
  exact(
    registerNames,
    Object.keys(scopeRegisters),
    'baseline/field-scope register order',
    'baseline',
  );
  exact(registerNames.length, 17, 'baseline register count', 'baseline');

  let matchFieldCount = 0;
  let projectionExpressionCount = 0;
  let projectionFieldReferenceCount = 0;
  const contentExceptions: string[] = [];
  for (const register of registerNames) {
    const policy = object(
      registerPolicies[register],
      `${register} baseline`,
      'baseline',
    );
    const scope = object(
      scopeRegisters[register],
      `${register} field scope`,
      'baseline',
    );
    exact(
      policy.authoritativeReadableRef,
      `${register}.readableWhen`,
      `${register} authoritative readable ref`,
      'baseline',
    );
    const scopeFields = new Set(
      ['E', 'L', 'F', 'N', 'J', 'nestedF', 'nestedN'].flatMap((key) =>
        Array.isArray(scope[key]) ? (scope[key] as unknown[]).map(String) : [],
      ),
    );
    for (const rawField of array(
      policy.mayMatch,
      `${register} mayMatch`,
      'baseline',
    )) {
      const field = object(rawField, `${register} match field`, 'baseline');
      if (
        typeof field.field !== 'string' ||
        typeof field.class !== 'string' ||
        !Array.isArray(scope[field.class]) ||
        !(scope[field.class] as unknown[]).includes(field.field)
      ) {
        fail(
          'R6_BASELINE_SCOPE_MISMATCH',
          'baseline',
          `${register} has a match field outside authoritative DTO scope`,
        );
      }
      matchFieldCount += 1;
      if (field.class === 'N') {
        contentExceptions.push(`${register}.${field.field}`);
      }
    }
    const projection = object(
      policy.publicProjection,
      `${register} projection`,
      'baseline',
    );
    for (const expression of Object.values(projection)) {
      const node = object(
        expression,
        `${register} projection expression`,
        'baseline',
      );
      if (node.op !== 'literal') projectionExpressionCount += 1;
      const fields = collectProjectionFields(node);
      projectionFieldReferenceCount += fields.size;
      for (const field of fields) {
        if (!scopeFields.has(field)) {
          fail(
            'R6_BASELINE_SCOPE_MISMATCH',
            'baseline',
            `${register}.${field} projection is outside authoritative DTO scope`,
          );
        }
      }
    }
  }
  exact(matchFieldCount, 64, 'baseline match-field count', 'baseline');
  exact(
    projectionExpressionCount,
    68,
    'baseline projection-expression count',
    'baseline',
  );
  exact(
    projectionFieldReferenceCount,
    83,
    'baseline projection-field-reference count',
    'baseline',
  );
  exact(
    contentExceptions,
    ['claim.description', 'term.label', 'line.refNo'],
    'baseline H0-H4 content exceptions',
    'baseline',
  );
  const lineage = object(
    baseline.baselineLineage,
    'baseline lineage',
    'baseline',
  );
  exact(
    lineage.productCommit,
    PRODUCT_BASELINE_COMMIT,
    'baseline product commit',
    'baseline',
  );
  if (
    typeof lineage.noOracleClaim !== 'string' ||
    !lineage.noOracleClaim.includes('not a disclosure oracle')
  ) {
    fail(
      'R6_BASELINE_CLAIM_MISMATCH',
      'baseline',
      'baseline permanent no-oracle claim is absent',
    );
  }

  const actorProfiles = array(
    actors.actorProfileCatalog,
    'delegation actor profiles',
    'baseline',
  );
  const fixtureRows = array(
    fixtures.fixtures,
    'fixtures',
    'baseline',
  ).map((value) => object(value, 'fixture', 'baseline'));
  const observationCount = actorProfiles.length * fixtureRows.length;
  const bound = object(
    validation.baselineBound,
    'validation baseline bound',
    'baseline',
  );
  exact(
    {
      registerCount: registerNames.length,
      matchFieldCount,
      projectionExpressionCount,
      projectionFieldReferenceCount,
      sourceObservationCount: observationCount,
      label: bound.label,
    },
    bound,
    'validation B0/O0 bound',
    'baseline',
  );
  exact(
    bound.label,
    'B0/O0_PINNED_IMPLEMENTATION_DRIFT_ONLY',
    'B0/O0 bound label',
    'baseline',
  );
  exact(
    implementationDiff.overallOutcome,
    'PASS_PINNED_BASELINE_RECONSTRUCTION_EQUAL',
    'implementation drift outcome',
    'baseline',
  );
  const sourceReconstruction = object(
    implementationDiff.sourceBaselineReconstruction,
    'source baseline reconstruction',
    'baseline',
  );
  exact(
    {
      observationCount: sourceReconstruction.observationCount,
      mismatchCount: sourceReconstruction.mismatchCount,
      outcome: sourceReconstruction.outcome,
    },
    {
      observationCount,
      mismatchCount: 0,
      outcome: 'PINNED_BASELINE_EQUAL',
    },
    'source baseline reconstruction',
    'baseline',
  );
  const projectionReconstruction = object(
    implementationDiff.projectionBaselineReconstruction,
    'projection baseline reconstruction',
    'baseline',
  );
  exact(
    {
      logicalRecipeToFixtureBaselineProjectionCount:
        projectionReconstruction.logicalRecipeToFixtureBaselineProjectionCount,
      livePostgresSourceDerivedNaturalIncludedCount:
        projectionReconstruction.livePostgresSourceDerivedNaturalIncludedCount,
      livePostgresStaticGuardExcludedCount:
        projectionReconstruction.livePostgresStaticGuardExcludedCount,
      separateStaticGuardNegativeControlCount:
        projectionReconstruction.separateStaticGuardNegativeControlCount,
      outcome: projectionReconstruction.outcome,
    },
    {
      logicalRecipeToFixtureBaselineProjectionCount: 356,
      livePostgresSourceDerivedNaturalIncludedCount: 353,
      livePostgresStaticGuardExcludedCount: 3,
      separateStaticGuardNegativeControlCount: 3,
      outcome: 'PINNED_BASELINE_EQUAL',
    },
    'exact projection reconstruction receipt',
    'baseline',
  );

  const redPlan = parsed(
    bundle,
    'HEARTH-003-DISCLOSURE-DRIFT-RED-CONTROLS-v1.json',
  );
  const redReceipt = parsed(
    bundle,
    'HEARTH-003-DISCLOSURE-DRIFT-RED-SELF-TEST-v1.json',
  );
  const planControls = array(
    redPlan.controls,
    'drift RED controls',
    'drift-red',
  ).map((value) => object(value, 'drift RED control', 'drift-red'));
  const receiptControls = array(
    redReceipt.controls,
    'drift RED receipts',
    'drift-red',
  ).map((value) => object(value, 'drift RED receipt', 'drift-red'));
  exact(planControls.length, 2, 'drift RED plan count', 'drift-red');
  exact(receiptControls.length, 2, 'drift RED receipt count', 'drift-red');

  const executedRed = executeDriftRedControls({
    plan: redPlan,
    fixtures: fixtureRows,
    actorClasses,
    policy: baseline,
    authoritative: predicates,
    fault,
  });
  exact(
    executedRed.cleanResultCount,
    redReceipt.baselineResolvedResultCount,
    'executable RED clean result count',
    'drift-red',
  );
  exact(
    executedRed.projectionValidatedCount,
    redReceipt.logicalProjectionRecipeValidatedFixtureCount,
    'executable projection validation count',
    'drift-red',
  );
  for (const plan of planControls) {
    const receipt = receiptControls.find(
      ({ controlId }) => controlId === plan.controlId,
    );
    if (receipt === undefined) {
      fail(
        'R6_DRIFT_RED_MISMATCH',
        'drift-red',
        `missing RED receipt for ${String(plan.controlId)}`,
      );
    }
    exact(
      {
        controlId: receipt.controlId,
        classification: receipt.classification,
        fixtureId: receipt.fixtureId,
        mutationMode: receipt.mutationMode,
        expectedFailureCode: receipt.expectedFailureCode,
        observedFailureCode: receipt.observedFailureCode,
        observedAt: receipt.observedAt,
        metricsStarted: receipt.metricsStarted,
        rawForbiddenValueRetained: receipt.rawForbiddenValueRetained,
      },
      {
        controlId: plan.controlId,
        classification: plan.classification,
        fixtureId: plan.fixtureId,
        mutationMode: plan.mutationMode,
        expectedFailureCode: plan.expectedFailureCode,
        observedFailureCode: plan.expectedFailureCode,
        observedAt: plan.expectedObservedAt,
        metricsStarted: false,
        rawForbiddenValueRetained: false,
      },
      `${String(plan.controlId)} exact RED receipt`,
      'drift-red',
    );
  }
  exact(
    receiptControls.map(({ observedFailureCode }) => observedFailureCode),
    ['BASELINE_SOURCE_DRIFT', 'BASELINE_PROJECTION_DRIFT'],
    'B0/O0 and exact projection RED failures',
    'drift-red',
  );
  exact(
    executedRed.observations,
    receiptControls.map(
      ({ controlId, observedFailureCode, observedAt }) => ({
        controlId,
        observedFailureCode,
        observedAt,
      }),
    ),
    'executable B0/O0 RED observations',
    'drift-red',
  );
  exact(
    {
      baselineCleanOutcome: redReceipt.baselineCleanOutcome,
      expectedControlCount: redReceipt.expectedControlCount,
      observedControlCount: redReceipt.observedControlCount,
      allExpectedFailuresObserved: redReceipt.allExpectedFailuresObserved,
      metricsStarted: redReceipt.metricsStarted,
      rawForbiddenValueRetained: redReceipt.rawForbiddenValueRetained,
    },
    {
      baselineCleanOutcome: 'PASS',
      expectedControlCount: 2,
      observedControlCount: 2,
      allExpectedFailuresObserved: true,
      metricsStarted: false,
      rawForbiddenValueRetained: false,
    },
    'drift RED aggregate',
    'drift-red',
  );

  return {
    registerCount: registerNames.length,
    matchFieldCount,
    projectionExpressionCount,
    projectionFieldReferenceCount,
    observationCount,
    driftRedControlCount: receiptControls.length,
  };
}

function targetFailure(target: JsonObject): string | null {
  if (target.comparator !== 'gte') {
    return 'UNSUPPORTED_ACCEPTANCE_COMPARATOR';
  }
  if (
    typeof target.target !== 'number' ||
    typeof target.ceiling !== 'number'
  ) {
    return 'INVALID_ACCEPTANCE_TARGET';
  }
  if (
    target.target > target.ceiling &&
    target.unsatisfiedDisposition !==
      'GOVERNANCE_BLOCKED_PINNED_BASELINE_TARGET'
  ) {
    return 'UNSATISFIABLE_ACCEPTANCE_TARGET';
  }
  return null;
}

function verifyTargetSatisfiability(bundle: VerifiedBundle): number {
  const metric = parsed(
    bundle,
    'HEARTH-003-METRIC-SATISFIABILITY-v2.json',
  );
  exact(
    metric.measurementStatus,
    'NOT_YET_MEASURED',
    'metric measurement status',
    'target-satisfiability',
  );
  const targets = array(
    metric.acceptanceTargets,
    'acceptance targets',
    'target-satisfiability',
  ).map((value) => object(value, 'acceptance target', 'target-satisfiability'));
  if (targets.length === 0) {
    fail(
      'R6_TARGET_SATISFIABILITY_MISMATCH',
      'target-satisfiability',
      'acceptance target list is empty',
    );
  }
  for (const target of targets) {
    const failure = targetFailure(target);
    if (failure !== null) {
      fail(
        failure,
        'target-satisfiability',
        String(target.targetId),
      );
    }
  }
  const exactId = targets.find(
    ({ targetId }) => targetId === 'absolute-exact-id-recall-at-1',
  );
  if (exactId === undefined) {
    fail(
      'R6_TARGET_SATISFIABILITY_MISMATCH',
      'target-satisfiability',
      'absolute exact-ID target is absent',
    );
  }
  const redMutation = {
    ...exactId,
    unsatisfiedDisposition: null,
  };
  exact(
    targetFailure(redMutation),
    'UNSATISFIABLE_ACCEPTANCE_TARGET',
    'target-satisfiability RED discrimination',
    'target-satisfiability',
  );
  const redReceipt = object(
    metric.targetSatisfiabilityRedControl,
    'target satisfiability RED receipt',
    'target-satisfiability',
  );
  exact(
    {
      expectedFailureCode: redReceipt.expectedFailureCode,
      observedFailureCode: redReceipt.observedFailureCode,
      targetId: redReceipt.targetId,
      seederStarted: redReceipt.seederStarted,
      httpRequestCount: redReceipt.httpRequestCount,
      metricsStarted: redReceipt.metricsStarted,
    },
    {
      expectedFailureCode: 'UNSATISFIABLE_ACCEPTANCE_TARGET',
      observedFailureCode: 'UNSATISFIABLE_ACCEPTANCE_TARGET',
      targetId: 'absolute-exact-id-recall-at-1',
      seederStarted: false,
      httpRequestCount: 0,
      metricsStarted: false,
    },
    'target-satisfiability RED receipt',
    'target-satisfiability',
  );
  if (
    typeof metric.recordTokenRule !== 'string' ||
    !metric.recordTokenRule.includes('RECORD remains unavailable')
  ) {
    fail(
      'R6_TARGET_SATISFIABILITY_MISMATCH',
      'target-satisfiability',
      'RECORD prohibition is absent',
    );
  }
  return targets.length;
}

function verifySemantics(
  bundle: VerifiedBundle,
  fault?: 'skip-first-mutation',
): R6PreflightReport {
  const residual = verifyResidualContinuity(bundle);
  const qrels = verifyQrels(bundle);
  const baseline = verifyBaselineAndRed(bundle, fault);
  const acceptanceTargetCount = verifyTargetSatisfiability(bundle);
  const validation = parsed(
    bundle,
    'HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json',
  );
  exact(
    {
      outcome: validation.outcome,
      implementationStatus: validation.implementationStatus,
    },
    {
      outcome: 'PASS_R6_AUTHORITY_PREMEASUREMENT_ONLY',
      implementationStatus: 'NOT_YET_MEASURED',
    },
    'r6 premeasurement claim boundary',
    'claim-boundary',
  );
  const doesNotProve = array(
    validation.doesNotProve,
    'r6 doesNotProve',
    'claim-boundary',
  ).map(String);
  if (
    !doesNotProve.includes(
      'that B0 is authorized, correct, complete, or leak-free',
    ) ||
    !doesNotProve.includes('that H4 may emit RECORD')
  ) {
    fail(
      'R6_BASELINE_CLAIM_MISMATCH',
      'claim-boundary',
      'drift-detector limits are incomplete',
    );
  }
  return {
    authorityModel: R6_AUTHORITY_MODEL,
    externallyPinnedManifestRoot:
      bundle.manifestCanonicalTextSha256,
    verifiedSlotCount: bundle.verifiedSlotCount,
    identityAssertionCount: bundle.identityAssertionCount,
    crossBindingCount: bundle.crossBindingCount,
    slotContentBindingCount: bundle.slotContentBindingCount,
    qrelCaseCount: qrels.caseCount,
    qrelJudgmentCount: qrels.judgmentCount,
    residualGroupCount: residual.groupCount,
    residualItemCount: residual.itemCount,
    baselineRegisterCount: baseline.registerCount,
    baselineMatchFieldCount: baseline.matchFieldCount,
    baselineProjectionExpressionCount:
      baseline.projectionExpressionCount,
    baselineProjectionFieldReferenceCount:
      baseline.projectionFieldReferenceCount,
    baselineObservationCount: baseline.observationCount,
    driftRedControlCount: baseline.driftRedControlCount,
    acceptanceTargetCount,
    measurementStatus: 'NOT_YET_MEASURED',
    doesNotProve,
  };
}

function defaultListDirectory(path: string): readonly string[] {
  return readdirSync(path, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile()) {
      fail(
        'AUTHORITY_BUNDLE_UNEXPECTED_ARTIFACT',
        'closed-directory-set',
        `authority directory contains non-file entry ${entry.name}`,
      );
    }
    return entry.name;
  });
}

function exactDirectorySet(
  actual: readonly string[],
  expected: readonly string[],
): void {
  const duplicates = actual.filter(
    (name, index) => actual.indexOf(name) !== index,
  );
  if (duplicates.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_DUPLICATE_SLOT',
      'closed-directory-set',
      `authority directory repeats ${duplicates[0]}`,
    );
  }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((name) => !actualSet.has(name));
  if (missing.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING',
      'closed-directory-set',
      `authority directory is missing ${missing[0]}`,
    );
  }
  const extra = [...actualSet].filter((name) => !expectedSet.has(name));
  if (extra.length > 0) {
    fail(
      'AUTHORITY_BUNDLE_UNEXPECTED_ARTIFACT',
      'closed-directory-set',
      `authority directory contains unexpected ${extra[0]}`,
    );
  }
}

function deepFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (isObject(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

function createVerifiedAuthorityView(
  verified: VerifiedBundle,
  contract: BundleContract,
): R6VerifiedAuthorityView {
  const copied = new Map<
    string,
    { contentKind: 'json' | 'text'; bytes: Uint8Array }
  >();
  for (const slot of contract.slots) {
    const artifact = verified.verified.get(slot.slot);
    if (artifact === undefined) {
      fail(
        'R6_AUTHORITY_SLOT_UNKNOWN',
        'authority-view',
        `verified slot is unavailable: ${slot.slot}`,
      );
    }
    copied.set(slot.slot, {
      contentKind: slot.contentKind,
      bytes: new Uint8Array(artifact.bytes),
    });
  }
  const slots = Object.freeze(contract.slots.map(({ slot }) => slot));

  const entry = (
    slot: string,
  ): { contentKind: 'json' | 'text'; bytes: Uint8Array } => {
    const value = copied.get(slot);
    if (value === undefined) {
      fail(
        'R6_AUTHORITY_SLOT_UNKNOWN',
        'authority-view',
        `unknown logical slot: ${slot}`,
      );
    }
    return value;
  };

  return Object.freeze({
    slots,
    readJson(slot: string): Readonly<JsonObject> {
      const value = entry(slot);
      if (value.contentKind !== 'json') {
        fail(
          'R6_AUTHORITY_SLOT_NOT_JSON',
          'authority-view',
          `logical slot is not JSON: ${slot}`,
        );
      }
      const fresh = parseJsonBytes(
        new Uint8Array(value.bytes),
        `verified authority slot ${slot}`,
      );
      return deepFreeze(fresh) as Readonly<JsonObject>;
    },
    readText(slot: string): string {
      const value = entry(slot);
      if (value.contentKind !== 'text') {
        fail(
          'R6_AUTHORITY_SLOT_NOT_TEXT',
          'authority-view',
          `logical slot is not text: ${slot}`,
        );
      }
      try {
        return new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(new Uint8Array(value.bytes));
      } catch {
        fail(
          'R6_AUTHORITY_SLOT_TEXT_INVALID',
          'authority-view',
          `verified text slot is not strict UTF-8: ${slot}`,
        );
      }
    },
  });
}

function loadR6VerifiedAuthorityCore(
  options: R6AuthorityLoadOptions,
): LoadedR6VerifiedAuthority {
  const authorityDirectory =
    options.authorityDirectory ?? defaultAuthorityDirectory;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path));
  const listDirectory = options.listDirectory ?? defaultListDirectory;

  try {
    const manifestBytes = readFile(
      join(authorityDirectory, MANIFEST_FILENAME),
    );
    const contractBytes = readFile(
      join(authorityDirectory, CONTRACT_FILENAME),
    );
    const contractValue = parseJsonBytes(contractBytes, CONTRACT_FILENAME);
    const contract = contractValue as BundleContract;
    if (!Array.isArray(contract.slots)) {
      fail(
        'AUTHORITY_BUNDLE_IDENTITY_MISMATCH',
        'closed-directory-set',
        'authority contract has no slot array',
      );
    }
    const filenames = contract.slots.map(({ filename }) => filename);
    exactDirectorySet(listDirectory(authorityDirectory), [
      ...filenames,
      MANIFEST_FILENAME,
    ]);
    const entries = contract.slots.map((slot) => ({
      slot: slot.slot,
      filename: slot.filename,
      bytes: readFile(join(authorityDirectory, slot.filename)),
    }));
    const verified = verifyAuthorityBundle({
      manifestBytes,
      externallyPinnedManifestSha256: R6_EXTERNAL_MANIFEST_ROOT,
      contract: contractValue,
      entries,
    });
    const report = verifySemantics(
      verified,
      options.redDiscriminationFaultForTest,
    );
    const authority = createVerifiedAuthorityView(verified, contract);
    return Object.freeze({
      report: deepFreeze(report) as R6PreflightReport,
      authority,
    });
  } catch (error) {
    if (
      error instanceof AuthorityBundleError ||
      error instanceof R6AuthorityPreflightError
    ) {
      throw error;
    }
    const detail =
      error instanceof Error ? error.message : 'unknown preflight error';
    fail(
      'R6_AUTHORITY_PREFLIGHT_FAILED',
      'authority-load',
      `${basename(authorityDirectory)}: ${detail}`,
    );
  }
}

export function loadR6VerifiedAuthority(
  options: R6AuthorityLoadOptions = {},
): LoadedR6VerifiedAuthority {
  return loadR6VerifiedAuthorityCore(options);
}

export function runR6AuthorityPreflight(
  options: R6PreflightOptions = {},
): R6PreflightReport {
  const ledger = options.sideEffectLedger ?? { attemptedEvents: [] };
  const loaded = loadR6VerifiedAuthorityCore(options);
  if (options.afterVerified !== undefined) {
    ledger.attemptedEvents.push({
      sequence: ledger.attemptedEvents.length + 1,
      capability: options.afterVerifiedCapability ?? 'seed',
    });
    options.afterVerified();
  }
  return loaded.report;
}
