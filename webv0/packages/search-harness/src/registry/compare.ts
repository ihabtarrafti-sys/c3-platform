import type {
  SunsetReasonCode,
  SunsetRegistryFailure,
  SunsetRegistrySnapshot,
} from './types';

function sameValue(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function compareOrderedValues(
  expected: readonly string[],
  actual: readonly string[],
  path: string,
  addedCode: SunsetReasonCode,
  removedCode: SunsetReasonCode,
  orderCode: SunsetReasonCode,
): SunsetRegistryFailure[] {
  const failures: SunsetRegistryFailure[] = [];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  for (const value of actual) {
    if (!expectedSet.has(value)) failures.push({ code: addedCode, path: `${path}.${value}`, actual: value });
  }
  for (const value of expected) {
    if (!actualSet.has(value)) {
      failures.push({ code: removedCode, path: `${path}.${value}`, expected: value });
    }
  }
  if (failures.length === 0 && !sameValue(expected, actual)) {
    failures.push({ code: orderCode, path, expected, actual });
  }
  return failures;
}

function compareRecordValues<T>(
  expected: Readonly<Record<string, T>>,
  actual: Readonly<Record<string, T>>,
  path: string,
  addedCode: SunsetReasonCode,
  removedCode: SunsetReasonCode,
  changedCode: SunsetReasonCode,
): SunsetRegistryFailure[] {
  const failures: SunsetRegistryFailure[] = [];
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  const expectedSet = new Set(expectedKeys);
  const actualSet = new Set(actualKeys);

  for (const key of actualKeys) {
    if (!expectedSet.has(key)) {
      failures.push({ code: addedCode, path: `${path}.${key}`, actual: actual[key] });
    }
  }
  for (const key of expectedKeys) {
    if (!actualSet.has(key)) {
      failures.push({ code: removedCode, path: `${path}.${key}`, expected: expected[key] });
    }
  }
  for (const key of expectedKeys) {
    if (!actualSet.has(key)) continue;
    if (!sameValue(expected[key], actual[key])) {
      failures.push({
        code: changedCode,
        path: `${path}.${key}`,
        expected: expected[key],
        actual: actual[key],
      });
    }
  }
  return failures;
}

function compareRoleCompositions(
  expected: SunsetRegistrySnapshot,
  actual: SunsetRegistrySnapshot,
): SunsetRegistryFailure[] {
  const failures: SunsetRegistryFailure[] = [];
  const actualRoles = new Set(Object.keys(actual.roleCapabilities));
  for (const role of Object.keys(expected.roleCapabilities)) {
    if (!actualRoles.has(role)) continue;
    const expectedVector = expected.roleCapabilities[role];
    const actualVector = actual.roleCapabilities[role];
    if (!expectedVector || !actualVector) continue;
    const vectorKeys = new Set([...Object.keys(expectedVector), ...Object.keys(actualVector)]);
    for (const capability of vectorKeys) {
      if (expectedVector[capability] !== actualVector[capability]) {
        failures.push({
          code: 'SUNSET_CAPABILITY_COMPOSITION_CHANGED',
          path: `roleCapabilities.${role}.${capability}`,
          expected: expectedVector[capability],
          actual: actualVector[capability],
        });
      }
    }
  }
  return failures;
}

function compareMatchFields(
  expected: SunsetRegistrySnapshot,
  actual: SunsetRegistrySnapshot,
): SunsetRegistryFailure[] {
  const failures: SunsetRegistryFailure[] = [];
  const kinds = new Set([...Object.keys(expected.matchFields), ...Object.keys(actual.matchFields)]);
  for (const kind of kinds) {
    const expectedFields = expected.matchFields[kind] ?? [];
    const actualFields = actual.matchFields[kind] ?? [];
    failures.push(
      ...compareOrderedValues(
        expectedFields,
        actualFields,
        `matchFields.${kind}`,
        'SUNSET_MATCH_FIELD_ADDED',
        'SUNSET_MATCH_FIELD_REMOVED',
        'SUNSET_MATCH_FIELD_ORDER_CHANGED',
      ),
    );
  }
  return failures;
}

function compareResponseFields(
  expected: SunsetRegistrySnapshot,
  actual: SunsetRegistrySnapshot,
): SunsetRegistryFailure[] {
  const failures: SunsetRegistryFailure[] = [];
  const surfaces = ['envelope', 'item', 'application', 'persistence'] as const;
  for (const surface of surfaces) {
    failures.push(
      ...compareOrderedValues(
        expected.responseFields[surface],
        actual.responseFields[surface],
        `responseFields.${surface}`,
        'SUNSET_RESPONSE_FIELD_ADDED',
        'SUNSET_RESPONSE_FIELD_REMOVED',
        'SUNSET_RESPONSE_FIELD_ORDER_CHANGED',
      ),
    );
  }
  return failures;
}

export function compareSunsetRegistry(
  expected: SunsetRegistrySnapshot,
  actual: SunsetRegistrySnapshot,
): SunsetRegistryFailure[] {
  return [
    ...compareOrderedValues(
      expected.roles,
      actual.roles,
      'roles',
      'SUNSET_ROLE_ADDED',
      'SUNSET_ROLE_REMOVED',
      'SUNSET_ROLE_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.capabilityKeys,
      actual.capabilityKeys,
      'capabilityKeys',
      'SUNSET_CAPABILITY_ADDED',
      'SUNSET_CAPABILITY_REMOVED',
      'SUNSET_CAPABILITY_ORDER_CHANGED',
    ),
    ...compareRoleCompositions(expected, actual),
    ...compareOrderedValues(
      expected.moduleKeys,
      actual.moduleKeys,
      'moduleKeys',
      'SUNSET_MODULE_KEY_ADDED',
      'SUNSET_MODULE_KEY_REMOVED',
      'SUNSET_MODULE_KEY_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.entitlementStates,
      actual.entitlementStates,
      'entitlementStates',
      'SUNSET_ENTITLEMENT_STATE_ADDED',
      'SUNSET_ENTITLEMENT_STATE_REMOVED',
      'SUNSET_ENTITLEMENT_STATE_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.entitlementSnapshots,
      actual.entitlementSnapshots,
      'entitlementSnapshots',
      'SUNSET_ENTITLEMENT_SNAPSHOT_ADDED',
      'SUNSET_ENTITLEMENT_SNAPSHOT_REMOVED',
      'SUNSET_ENTITLEMENT_SNAPSHOT_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.searchDomains,
      actual.searchDomains,
      'searchDomains',
      'SUNSET_SEARCH_KIND_ADDED',
      'SUNSET_SEARCH_KIND_REMOVED',
      'SUNSET_SEARCH_KIND_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.applicationResultKinds,
      actual.applicationResultKinds,
      'applicationResultKinds',
      'SUNSET_SEARCH_KIND_ADDED',
      'SUNSET_SEARCH_KIND_REMOVED',
      'SUNSET_SEARCH_KIND_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.contractResultKinds,
      actual.contractResultKinds,
      'contractResultKinds',
      'SUNSET_SEARCH_KIND_ADDED',
      'SUNSET_SEARCH_KIND_REMOVED',
      'SUNSET_SEARCH_KIND_ORDER_CHANGED',
    ),
    ...compareRecordValues(
      expected.gateClasses,
      actual.gateClasses,
      'gateClasses',
      'SUNSET_GATE_ADDED',
      'SUNSET_GATE_REMOVED',
      'SUNSET_GATE_CHANGED',
    ),
    ...compareRecordValues(
      expected.predicateRegisters,
      actual.predicateRegisters,
      'predicateRegisters',
      'SUNSET_PREDICATE_REGISTER_ADDED',
      'SUNSET_PREDICATE_REGISTER_REMOVED',
      'SUNSET_PREDICATE_REGISTER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.documentOwnerTypes,
      actual.documentOwnerTypes,
      'documentOwnerTypes',
      'SUNSET_OWNER_TYPE_ADDED',
      'SUNSET_OWNER_TYPE_REMOVED',
      'SUNSET_OWNER_TYPE_ORDER_CHANGED',
    ),
    ...compareOrderedValues(
      expected.recordKinds,
      actual.recordKinds,
      'recordKinds',
      'SUNSET_RECORD_KIND_ADDED',
      'SUNSET_RECORD_KIND_REMOVED',
      'SUNSET_RECORD_KIND_ORDER_CHANGED',
    ),
    ...compareMatchFields(expected, actual),
    ...compareResponseFields(expected, actual),
    ...compareRecordValues(
      expected.projections,
      actual.projections,
      'projections',
      'SUNSET_PROJECTION_ADDED',
      'SUNSET_PROJECTION_REMOVED',
      'SUNSET_PROJECTION_CHANGED',
    ),
    ...compareOrderedValues(
      expected.criticalSources,
      actual.criticalSources,
      'criticalSources',
      'SUNSET_CRITICAL_SOURCE_ADDED',
      'SUNSET_CRITICAL_SOURCE_REMOVED',
      'SUNSET_CRITICAL_SOURCE_ORDER_CHANGED',
    ),
    ...compareRecordValues(
      expected.criticalSourceFingerprints,
      actual.criticalSourceFingerprints,
      'criticalSourceFingerprints',
      'SUNSET_CRITICAL_SOURCE_ADDED',
      'SUNSET_CRITICAL_SOURCE_REMOVED',
      'SUNSET_CRITICAL_SOURCE_CHANGED',
    ),
  ];
}

export class SunsetRegistryError extends Error {
  readonly failures: readonly SunsetRegistryFailure[];

  constructor(failures: readonly SunsetRegistryFailure[]) {
    super(
      `Search sunset registry drifted:\n${failures
        .map((failure) => `${failure.code} ${failure.path}`)
        .join('\n')}`,
    );
    this.name = 'SunsetRegistryError';
    this.failures = failures;
  }
}

export function assertSunsetRegistry(
  expected: SunsetRegistrySnapshot,
  actual: SunsetRegistrySnapshot,
): void {
  const failures = compareSunsetRegistry(expected, actual);
  if (failures.length > 0) throw new SunsetRegistryError(failures);
}
