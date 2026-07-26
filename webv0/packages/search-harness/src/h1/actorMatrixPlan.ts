import { canonicalSha256 } from '../canonical.js';
import type {
  H1DelegationState,
  H1TenantSlot,
} from './seedPlan.js';

export type H1Role =
  | 'owner'
  | 'operations'
  | 'legal'
  | 'finance'
  | 'hr'
  | 'management'
  | 'visitor';
export type H1EntitlementState = 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
export type H1ParticipantState = 'P0' | 'P1';

export class H1ActorMatrixPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'H1ActorMatrixPlanError';
  }
}

export interface H1ActorProfile {
  readonly actorProfileId: string;
  readonly tenantSlot: H1TenantSlot;
  readonly role: H1Role;
  readonly entitlementState: H1EntitlementState;
  readonly delegationState: H1DelegationState;
  readonly participantState: H1ParticipantState;
  readonly corpusProfileId: string;
  readonly actorUserRowId: string;
  readonly actorUserId: string;
  readonly actorIdentity: string;
}

export interface H1NonDelegationAssignmentPlan {
  readonly assignmentId: string;
  readonly actorClass: string;
  readonly targetTenantSlot: H1TenantSlot;
  readonly actorProfileIds: readonly string[];
  readonly observationIds: readonly string[];
}

export interface H1DelegationAssignmentPlan {
  readonly assignmentId: string;
  readonly actorClass: string;
  readonly tenantSlot: H1TenantSlot;
  readonly bindingIds: readonly string[];
  readonly actorProfileIds: readonly string[];
}

export interface H1ActorMatrixManifestInputs {
  readonly schemaVersion: 1;
  readonly artifactKind: 'hearth-search-h1-actor-matrix-plan';
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly baselineUse: 'drift-detector-against-dae27a4';
  readonly actorClassVersion: 'HEARTH-003-ACTOR-CLASSES-v2';
  readonly measurementVersion: 'HEARTH-003-DELEGATION-MEASUREMENT-v2';
  readonly actorProfileCount: 140;
  readonly nonDelegationAssignmentCount: 699;
  readonly nonDelegationObservationCount: 37_030;
  readonly delegationAssignmentCount: 29;
  readonly delegationBindingCount: 370;
  readonly pairEdgeCount: 280;
  readonly noEffectControlCount: 20;
  readonly actorProfilesSha256: string;
  readonly nonDelegationExpansionSha256: string;
  readonly delegationExpansionSha256: string;
  readonly pairEdgesSha256: string;
  readonly noEffectControlsSha256: string;
}

export interface H1ActorMatrixPlan {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly actorProfiles: readonly H1ActorProfile[];
  readonly nonDelegationAssignments: readonly H1NonDelegationAssignmentPlan[];
  readonly delegationAssignments: readonly H1DelegationAssignmentPlan[];
  readonly manifestInputs: H1ActorMatrixManifestInputs;
  readonly manifestSha256: string;
}

const TENANTS = Object.freeze(['T01', 'T02'] as const);
const ROLES = Object.freeze([
  'owner',
  'operations',
  'legal',
  'finance',
  'hr',
  'management',
  'visitor',
] as const);
const ENTITLEMENT_STATES = Object.freeze([
  'E0',
  'E1',
  'E2',
  'E3',
  'E4',
] as const);
const DELEGATION_STATES = Object.freeze([
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
] as const);
const PARTICIPANT_STATES = Object.freeze(['P0', 'P1'] as const);
const EXPECTED_EXECUTION_IDS = Object.freeze([
  'H3M.D0',
  'H3M.D1',
  'H3M.D2',
  'H3M.D3',
  'H3M.D4',
  'H3M.E1',
  'H3M.E2',
  'H3M.E3',
  'H3M.E4',
  'H3M.P1',
]);

function fail(message: string): never {
  throw new H1ActorMatrixPlanError(message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${path} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function asInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    fail(`${path} must be a safe integer`);
  }
  return value as number;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    fail(`${path} must equal ${String(expected)}`);
  }
}

function assertExactSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (actual.length !== new Set(actual).size) {
    fail(`${path} contains duplicates`);
  }
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    fail(`${path} does not match the authority-declared set`);
  }
}

function parseClosedValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  const text = asString(value, path);
  if (!values.includes(text as T)) {
    fail(`${path} contains unknown value ${text}`);
  }
  return text as T;
}

function parseStringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((entry, index) =>
    asString(entry, `${path}[${index}]`),
  );
}

function parseActorProfile(value: unknown, path: string): H1ActorProfile {
  const profile = asRecord(value, path);
  return Object.freeze({
    actorProfileId: asString(
      profile['actorProfileId'],
      `${path}.actorProfileId`,
    ),
    tenantSlot: parseClosedValue(
      profile['tenantSlot'],
      TENANTS,
      `${path}.tenantSlot`,
    ),
    role: parseClosedValue(profile['role'], ROLES, `${path}.role`),
    entitlementState: parseClosedValue(
      profile['entitlementState'],
      ENTITLEMENT_STATES,
      `${path}.entitlementState`,
    ),
    delegationState: parseClosedValue(
      profile['delegationState'],
      DELEGATION_STATES,
      `${path}.delegationState`,
    ),
    participantState: parseClosedValue(
      profile['participantState'],
      PARTICIPANT_STATES,
      `${path}.participantState`,
    ),
    corpusProfileId: asString(
      profile['corpusProfileId'],
      `${path}.corpusProfileId`,
    ),
    actorUserRowId: asString(
      profile['actorUserRowId'],
      `${path}.actorUserRowId`,
    ),
    actorUserId: asString(profile['actorUserId'], `${path}.actorUserId`),
    actorIdentity: asString(
      profile['actorIdentity'],
      `${path}.actorIdentity`,
    ),
  });
}

function expectedProfileShape(
  actorProfileId: string,
): Readonly<{
  tenantSlot: H1TenantSlot;
  role: H1Role;
  entitlementState: H1EntitlementState;
  delegationState: H1DelegationState;
  participantState: H1ParticipantState;
  corpusProfileId: string;
}> {
  const parts = actorProfileId.split('.');
  const tenantSlot = parseClosedValue(parts[0], TENANTS, `${actorProfileId}.tenant`);
  const role = parseClosedValue(parts[1], ROLES, `${actorProfileId}.role`);
  const entitlementState = parseClosedValue(
    parts[2],
    ENTITLEMENT_STATES,
    `${actorProfileId}.entitlement`,
  );
  const delegationState = parseClosedValue(
    parts[3],
    DELEGATION_STATES,
    `${actorProfileId}.delegation`,
  );
  const participantState = parts.length === 6 ? 'P1' : 'P0';
  const expectedSuffix =
    participantState === 'P1' ? ['P1', 'base'] : ['base'];
  assertExactSet(
    parts.slice(4),
    expectedSuffix,
    `${actorProfileId} suffix`,
  );
  const corpusProfileId =
    participantState === 'P1'
      ? 'H3M.P1'
      : delegationState !== 'D0'
        ? `H3M.${delegationState}`
        : entitlementState === 'E0'
          ? 'H3M.D0'
          : `H3M.${entitlementState}`;
  return {
    tenantSlot,
    role,
    entitlementState,
    delegationState,
    participantState,
    corpusProfileId,
  };
}

function expectedActorProfileIds(): string[] {
  const ids: string[] = [];
  for (const tenant of TENANTS) {
    for (const role of ROLES) {
      for (const entitlement of ENTITLEMENT_STATES) {
        ids.push(`${tenant}.${role}.${entitlement}.D0.base`);
      }
      for (const delegation of DELEGATION_STATES.slice(1)) {
        ids.push(`${tenant}.${role}.E0.${delegation}.base`);
      }
      ids.push(`${tenant}.${role}.E1.D0.P1.base`);
    }
  }
  return ids;
}

function validateActorCatalog(
  measurement: Record<string, unknown>,
): readonly H1ActorProfile[] {
  const rawCatalog = asArray(
    measurement['actorProfileCatalog'],
    'delegationMeasurement.actorProfileCatalog',
  );
  exact(
    rawCatalog.length,
    140,
    'delegationMeasurement.actorProfileCatalog.length',
  );
  const profiles = rawCatalog.map((value, index) =>
    parseActorProfile(
      value,
      `delegationMeasurement.actorProfileCatalog[${index}]`,
    ),
  );
  assertExactSet(
    profiles.map((profile) => profile.actorProfileId),
    expectedActorProfileIds(),
    'actorProfileCatalog ids',
  );

  const identityByActor = new Map<
    string,
    Readonly<{
      actorUserRowId: string;
      actorUserId: string;
      actorIdentity: string;
    }>
  >();
  for (const profile of profiles) {
    const expected = expectedProfileShape(profile.actorProfileId);
    exact(
      profile.tenantSlot,
      expected.tenantSlot,
      `${profile.actorProfileId}.tenantSlot`,
    );
    exact(profile.role, expected.role, `${profile.actorProfileId}.role`);
    exact(
      profile.entitlementState,
      expected.entitlementState,
      `${profile.actorProfileId}.entitlementState`,
    );
    exact(
      profile.delegationState,
      expected.delegationState,
      `${profile.actorProfileId}.delegationState`,
    );
    exact(
      profile.participantState,
      expected.participantState,
      `${profile.actorProfileId}.participantState`,
    );
    exact(
      profile.corpusProfileId,
      expected.corpusProfileId,
      `${profile.actorProfileId}.corpusProfileId`,
    );

    const actorKey = `${profile.tenantSlot}.${profile.role}`;
    const identity = {
      actorUserRowId: profile.actorUserRowId,
      actorUserId: profile.actorUserId,
      actorIdentity: profile.actorIdentity,
    };
    const prior = identityByActor.get(actorKey);
    if (prior === undefined) {
      identityByActor.set(actorKey, identity);
    } else {
      exact(
        identity.actorUserRowId,
        prior.actorUserRowId,
        `${profile.actorProfileId}.actorUserRowId`,
      );
      exact(
        identity.actorUserId,
        prior.actorUserId,
        `${profile.actorProfileId}.actorUserId`,
      );
      exact(
        identity.actorIdentity,
        prior.actorIdentity,
        `${profile.actorProfileId}.actorIdentity`,
      );
    }
  }
  exact(identityByActor.size, 14, 'physical actor identity count');
  return Object.freeze(profiles);
}

interface ActorSelector {
  readonly tenantRelation: readonly ('same' | 'other')[];
  readonly roles?: readonly H1Role[];
  readonly entitlementStates?: readonly H1EntitlementState[];
  readonly delegationStates?: readonly H1DelegationState[];
  readonly participantStates?: readonly H1ParticipantState[];
}

function resolveRoles(
  value: unknown,
  roleSets: Record<string, unknown>,
  path: string,
): readonly H1Role[] {
  if (typeof value === 'string') {
    const match = /^\$roleSets\.([A-Z_]+)$/u.exec(value);
    if (match === null) {
      fail(`${path} has unknown role-set reference ${value}`);
    }
    const roleSetName = match[1];
    if (roleSetName === undefined || !(roleSetName in roleSets)) {
      fail(`${path} references unknown role set ${String(roleSetName)}`);
    }
    return parseStringArray(
      roleSets[roleSetName],
      `${path}.${roleSetName}`,
    ).map((role, index) =>
      parseClosedValue(role, ROLES, `${path}.${roleSetName}[${index}]`),
    );
  }
  return parseStringArray(value, path).map((role, index) =>
    parseClosedValue(role, ROLES, `${path}[${index}]`),
  );
}

function parseOptionalClosedArray<T extends string>(
  selector: Record<string, unknown>,
  key: string,
  values: readonly T[],
  path: string,
): readonly T[] | undefined {
  if (!Object.hasOwn(selector, key)) {
    return undefined;
  }
  return parseStringArray(selector[key], `${path}.${key}`).map(
    (entry, index) =>
      parseClosedValue(entry, values, `${path}.${key}[${index}]`),
  );
}

function parseActorSelectors(
  actorClasses: Record<string, unknown>,
): ReadonlyMap<string, ActorSelector> {
  const roleSets = asRecord(actorClasses['roleSets'], 'actorClasses.roleSets');
  const classes = asRecord(actorClasses['classes'], 'actorClasses.classes');
  const selectors = new Map<string, ActorSelector>();
  for (const [className, value] of Object.entries(classes)) {
    const path = `actorClasses.classes.${className}`;
    const raw = asRecord(value, path);
    const allowedKeys = new Set([
      'tenantRelation',
      'roles',
      'entitlementStates',
      'delegationStates',
      'participantStates',
      'claimSubmitterRelations',
      'meaning',
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowedKeys.has(key)) {
        fail(`${path} contains unknown selector property ${key}`);
      }
    }
    const tenantRelation = parseStringArray(
      raw['tenantRelation'],
      `${path}.tenantRelation`,
    ).map((relation, index) =>
      parseClosedValue(
        relation,
        ['same', 'other'] as const,
        `${path}.tenantRelation[${index}]`,
      ),
    );
    if (Object.hasOwn(raw, 'claimSubmitterRelations')) {
      parseStringArray(
        raw['claimSubmitterRelations'],
        `${path}.claimSubmitterRelations`,
      ).forEach((relation, index) => {
        parseClosedValue(
          relation,
          ['actor_identity', 'other_submitter'] as const,
          `${path}.claimSubmitterRelations[${index}]`,
        );
      });
    }
    if (Object.hasOwn(raw, 'meaning')) {
      asString(raw['meaning'], `${path}.meaning`);
    }
    selectors.set(
      className,
      Object.freeze({
        tenantRelation,
        roles: Object.hasOwn(raw, 'roles')
          ? resolveRoles(raw['roles'], roleSets, `${path}.roles`)
          : undefined,
        entitlementStates: parseOptionalClosedArray(
          raw,
          'entitlementStates',
          ENTITLEMENT_STATES,
          path,
        ),
        delegationStates: parseOptionalClosedArray(
          raw,
          'delegationStates',
          DELEGATION_STATES,
          path,
        ),
        participantStates: parseOptionalClosedArray(
          raw,
          'participantStates',
          PARTICIPANT_STATES,
          path,
        ),
      }),
    );
  }
  return selectors;
}

function profileMatchesSelector(
  profile: H1ActorProfile,
  selector: ActorSelector,
  targetTenantSlot: H1TenantSlot,
): boolean {
  const relation =
    profile.tenantSlot === targetTenantSlot ? 'same' : 'other';
  return (
    selector.tenantRelation.includes(relation) &&
    (selector.roles === undefined ||
      selector.roles.includes(profile.role)) &&
    (selector.entitlementStates === undefined ||
      selector.entitlementStates.includes(profile.entitlementState)) &&
    (selector.delegationStates === undefined ||
      selector.delegationStates.includes(profile.delegationState)) &&
    (selector.participantStates === undefined ||
      selector.participantStates.includes(profile.participantState))
  );
}

function validateProfileFields(
  value: Record<string, unknown>,
  profile: H1ActorProfile,
  path: string,
): void {
  exact(value['actorProfileId'], profile.actorProfileId, `${path}.actorProfileId`);
  exact(value['tenantSlot'], profile.tenantSlot, `${path}.tenantSlot`);
  exact(value['role'], profile.role, `${path}.role`);
  exact(
    value['entitlementState'],
    profile.entitlementState,
    `${path}.entitlementState`,
  );
  exact(
    value['delegationState'],
    profile.delegationState,
    `${path}.delegationState`,
  );
  exact(
    value['participantState'],
    profile.participantState,
    `${path}.participantState`,
  );
  exact(
    value['corpusProfileId'],
    profile.corpusProfileId,
    `${path}.corpusProfileId`,
  );
  exact(
    value['actorUserRowId'],
    profile.actorUserRowId,
    `${path}.actorUserRowId`,
  );
  exact(value['actorUserId'], profile.actorUserId, `${path}.actorUserId`);
  exact(
    value['actorIdentity'],
    profile.actorIdentity,
    `${path}.actorIdentity`,
  );
}

function validateSparseProfileFields(
  value: Record<string, unknown>,
  profile: H1ActorProfile,
  path: string,
): void {
  exact(value['actorProfileId'], profile.actorProfileId, `${path}.actorProfileId`);
  exact(value['tenantSlot'], profile.tenantSlot, `${path}.tenantSlot`);
  exact(value['role'], profile.role, `${path}.role`);
  exact(
    value['delegationState'],
    profile.delegationState,
    `${path}.delegationState`,
  );
  exact(
    value['corpusProfileId'],
    profile.corpusProfileId,
    `${path}.corpusProfileId`,
  );
  exact(
    value['actorUserRowId'],
    profile.actorUserRowId,
    `${path}.actorUserRowId`,
  );
  exact(value['actorUserId'], profile.actorUserId, `${path}.actorUserId`);
  exact(
    value['actorIdentity'],
    profile.actorIdentity,
    `${path}.actorIdentity`,
  );
}

function validateSuiteProfileIndexes(
  measurement: Record<string, unknown>,
  profileIds: ReadonlySet<string>,
): void {
  const suite = asRecord(
    measurement['h4AcceptanceProfileSuite'],
    'delegationMeasurement.h4AcceptanceProfileSuite',
  );
  assertExactSet(
    parseStringArray(
      suite['profileExecutionIds'],
      'h4AcceptanceProfileSuite.profileExecutionIds',
    ),
    EXPECTED_EXECUTION_IDS,
    'h4AcceptanceProfileSuite.profileExecutionIds',
  );
  const baseIds = asArray(
    suite['baseCartesianActorProfiles'],
    'h4AcceptanceProfileSuite.baseCartesianActorProfiles',
  ).map((value, index) =>
    asString(
      asRecord(
        value,
        `h4AcceptanceProfileSuite.baseCartesianActorProfiles[${index}]`,
      )['actorProfileId'],
      `h4AcceptanceProfileSuite.baseCartesianActorProfiles[${index}].actorProfileId`,
    ),
  );
  const expectedBaseIds = expectedActorProfileIds().filter(
    (id) => !id.includes('.P1.'),
  ).filter((id) => {
    const shape = expectedProfileShape(id);
    return shape.delegationState === 'D0';
  });
  assertExactSet(
    baseIds,
    expectedBaseIds,
    'h4AcceptanceProfileSuite.baseCartesianActorProfiles',
  );
  if (baseIds.some((id) => !profileIds.has(id))) {
    fail('baseCartesianActorProfiles references an unknown profile');
  }

  const participantIds = asArray(
    suite['participantActorProfiles'],
    'h4AcceptanceProfileSuite.participantActorProfiles',
  ).map((value, index) =>
    asString(
      asRecord(
        value,
        `h4AcceptanceProfileSuite.participantActorProfiles[${index}]`,
      )['actorProfileId'],
      `h4AcceptanceProfileSuite.participantActorProfiles[${index}].actorProfileId`,
    ),
  );
  const expectedParticipantIds = [...TENANTS].flatMap((tenant) =>
    [...ROLES].flatMap((role) => [
      `${tenant}.${role}.E1.D0.base`,
      `${tenant}.${role}.E1.D0.P1.base`,
    ]),
  );
  assertExactSet(
    participantIds,
    expectedParticipantIds,
    'h4AcceptanceProfileSuite.participantActorProfiles',
  );
}

/**
 * Validates the sparse 140-profile schedule and expands authority selectors
 * without consulting qrel relevance judgments.
 */
export function planH1ActorMatrix(
  actorClassesInput: unknown,
  delegationMeasurementInput: unknown,
): H1ActorMatrixPlan {
  const actorClasses = asRecord(actorClassesInput, 'actorClasses');
  exact(
    actorClasses['actorClassVersion'],
    'HEARTH-003-ACTOR-CLASSES-v2',
    'actorClasses.actorClassVersion',
  );
  exact(actorClasses['syntheticOnly'], true, 'actorClasses.syntheticOnly');
  assertExactSet(
    parseStringArray(actorClasses['tenants'], 'actorClasses.tenants'),
    TENANTS,
    'actorClasses.tenants',
  );
  assertExactSet(
    parseStringArray(actorClasses['roles'], 'actorClasses.roles'),
    ROLES,
    'actorClasses.roles',
  );
  const selectors = parseActorSelectors(actorClasses);

  const measurement = asRecord(
    delegationMeasurementInput,
    'delegationMeasurement',
  );
  exact(
    measurement['measurementVersion'],
    'HEARTH-003-DELEGATION-MEASUREMENT-v2',
    'delegationMeasurement.measurementVersion',
  );
  exact(
    measurement['actorClassArtifact'],
    'HEARTH-003-ACTOR-CLASSES-v2.json',
    'delegationMeasurement.actorClassArtifact',
  );
  exact(
    measurement['measurementStatus'],
    'NOT_YET_MEASURED',
    'delegationMeasurement.measurementStatus',
  );

  const actorProfiles = validateActorCatalog(measurement);
  const profileById = new Map(
    actorProfiles.map((profile) => [profile.actorProfileId, profile]),
  );
  validateSuiteProfileIndexes(measurement, new Set(profileById.keys()));

  const rawObservations = asArray(
    measurement['nonDelegationConcreteObservations'],
    'delegationMeasurement.nonDelegationConcreteObservations',
  );
  exact(
    rawObservations.length,
    37_030,
    'nonDelegationConcreteObservations.length',
  );
  const observationsById = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < rawObservations.length; index += 1) {
    const observation = asRecord(
      rawObservations[index],
      `nonDelegationConcreteObservations[${index}]`,
    );
    const observationId = asString(
      observation['observationId'],
      `nonDelegationConcreteObservations[${index}].observationId`,
    );
    if (observationsById.has(observationId)) {
      fail(`duplicate non-delegation observation ${observationId}`);
    }
    observationsById.set(observationId, observation);
  }

  const rawAssignments = asArray(
    measurement['nonDelegationLogicalAssignments'],
    'delegationMeasurement.nonDelegationLogicalAssignments',
  );
  exact(rawAssignments.length, 699, 'nonDelegationLogicalAssignments.length');
  const claimedObservationIds = new Set<string>();
  const nonDelegationAssignments: H1NonDelegationAssignmentPlan[] = [];
  for (let index = 0; index < rawAssignments.length; index += 1) {
    const path = `nonDelegationLogicalAssignments[${index}]`;
    const assignment = asRecord(rawAssignments[index], path);
    const assignmentId = asString(
      assignment['assignmentId'],
      `${path}.assignmentId`,
    );
    const actorClass = asString(
      assignment['actorClass'],
      `${path}.actorClass`,
    );
    const selector = selectors.get(actorClass);
    if (selector === undefined) {
      fail(`${path} references unknown actor class ${actorClass}`);
    }
    const targetTenantSlot = parseClosedValue(
      assignment['targetTenantSlot'],
      TENANTS,
      `${path}.targetTenantSlot`,
    );
    const expectedProfiles = actorProfiles
      .filter((profile) =>
        profileMatchesSelector(profile, selector, targetTenantSlot),
      )
      .sort((left, right) =>
        left.actorProfileId.localeCompare(right.actorProfileId),
      );
    const expectedExpansionCount = asInteger(
      assignment['expectedExpansionCount'],
      `${path}.expectedExpansionCount`,
    );
    exact(
      expectedExpansionCount,
      expectedProfiles.length,
      `${path}.expectedExpansionCount`,
    );
    const observationIds = parseStringArray(
      assignment['observationIds'],
      `${path}.observationIds`,
    );
    const expectedObservationIds = expectedProfiles.map(
      (profile) => `${assignmentId}.${profile.actorProfileId}`,
    );
    assertExactSet(
      observationIds,
      expectedObservationIds,
      `${path}.observationIds`,
    );

    for (const observationId of observationIds) {
      if (claimedObservationIds.has(observationId)) {
        fail(`observation ${observationId} belongs to multiple assignments`);
      }
      claimedObservationIds.add(observationId);
      const observation = observationsById.get(observationId);
      if (observation === undefined) {
        fail(`${path} references missing observation ${observationId}`);
      }
      const actorProfileId = asString(
        observation['actorProfileId'],
        `${observationId}.actorProfileId`,
      );
      const profile = profileById.get(actorProfileId);
      if (profile === undefined) {
        fail(`${observationId} references unknown actor profile`);
      }
      exact(
        observation['assignmentId'],
        assignmentId,
        `${observationId}.assignmentId`,
      );
      exact(
        observation['queryCaseId'],
        assignment['queryCaseId'],
        `${observationId}.queryCaseId`,
      );
      exact(
        observation['fixtureScenarioId'],
        assignment['fixtureScenarioId'],
        `${observationId}.fixtureScenarioId`,
      );
      exact(
        observation['actorClass'],
        actorClass,
        `${observationId}.actorClass`,
      );
      validateProfileFields(observation, profile, observationId);
    }

    nonDelegationAssignments.push(
      Object.freeze({
        assignmentId,
        actorClass,
        targetTenantSlot,
        actorProfileIds: Object.freeze(
          expectedProfiles.map((profile) => profile.actorProfileId),
        ),
        observationIds: Object.freeze(observationIds),
      }),
    );
  }
  exact(
    claimedObservationIds.size,
    observationsById.size,
    'claimed non-delegation observation count',
  );

  const rawBindings = asArray(
    measurement['concreteBindings'],
    'delegationMeasurement.concreteBindings',
  );
  exact(rawBindings.length, 370, 'delegationMeasurement.concreteBindings.length');
  const bindingsById = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < rawBindings.length; index += 1) {
    const binding = asRecord(
      rawBindings[index],
      `delegationMeasurement.concreteBindings[${index}]`,
    );
    const bindingId = asString(
      binding['bindingId'],
      `delegationMeasurement.concreteBindings[${index}].bindingId`,
    );
    if (bindingsById.has(bindingId)) {
      fail(`duplicate delegation binding ${bindingId}`);
    }
    bindingsById.set(bindingId, binding);
  }

  const rawDelegationAssignments = asArray(
    measurement['logicalAssignments'],
    'delegationMeasurement.logicalAssignments',
  );
  exact(
    rawDelegationAssignments.length,
    29,
    'delegationMeasurement.logicalAssignments.length',
  );
  const claimedBindingIds = new Set<string>();
  const delegationAssignments: H1DelegationAssignmentPlan[] = [];
  for (let index = 0; index < rawDelegationAssignments.length; index += 1) {
    const path = `delegationMeasurement.logicalAssignments[${index}]`;
    const assignment = asRecord(rawDelegationAssignments[index], path);
    const assignmentId = asString(
      assignment['assignmentId'],
      `${path}.assignmentId`,
    );
    const actorClass = asString(
      assignment['actorClass'],
      `${path}.actorClass`,
    );
    if (!selectors.has(actorClass)) {
      fail(`${path} references unknown actor class ${actorClass}`);
    }
    const tenantSlot = parseClosedValue(
      assignment['tenantSlot'],
      TENANTS,
      `${path}.tenantSlot`,
    );
    const bindingIds = parseStringArray(
      assignment['concreteBindingIds'],
      `${path}.concreteBindingIds`,
    );
    exact(
      bindingIds.length,
      asInteger(
        assignment['expectedExpansionCount'],
        `${path}.expectedExpansionCount`,
      ),
      `${path}.concreteBindingIds.length`,
    );
    if (new Set(bindingIds).size !== bindingIds.length) {
      fail(`${path}.concreteBindingIds contains duplicates`);
    }
    const actorProfileIds: string[] = [];
    for (const bindingId of bindingIds) {
      if (claimedBindingIds.has(bindingId)) {
        fail(`binding ${bindingId} belongs to multiple assignments`);
      }
      claimedBindingIds.add(bindingId);
      const binding = bindingsById.get(bindingId);
      if (binding === undefined) {
        fail(`${path} references missing binding ${bindingId}`);
      }
      exact(
        binding['logicalAssignmentId'],
        assignmentId,
        `${bindingId}.logicalAssignmentId`,
      );
      exact(
        binding['queryCaseId'],
        assignment['queryCaseId'],
        `${bindingId}.queryCaseId`,
      );
      exact(
        binding['fixtureScenarioId'],
        assignment['fixtureScenarioId'],
        `${bindingId}.fixtureScenarioId`,
      );
      exact(binding['actorClass'], actorClass, `${bindingId}.actorClass`);
      exact(binding['tenantSlot'], tenantSlot, `${bindingId}.tenantSlot`);
      const actorProfileId = asString(
        binding['actorProfileId'],
        `${bindingId}.actorProfileId`,
      );
      const profile = profileById.get(actorProfileId);
      if (profile === undefined) {
        fail(`${bindingId} references unknown actor profile`);
      }
      validateSparseProfileFields(binding, profile, bindingId);
      actorProfileIds.push(actorProfileId);
    }
    delegationAssignments.push(
      Object.freeze({
        assignmentId,
        actorClass,
        tenantSlot,
        bindingIds: Object.freeze(bindingIds),
        actorProfileIds: Object.freeze(actorProfileIds),
      }),
    );
  }
  exact(
    claimedBindingIds.size,
    bindingsById.size,
    'claimed delegation binding count',
  );

  const rawPairEdges = asArray(
    measurement['pairEdges'],
    'delegationMeasurement.pairEdges',
  );
  exact(rawPairEdges.length, 280, 'delegationMeasurement.pairEdges.length');
  const pairEdgeIds = new Set<string>();
  const structuralPairEdges: Record<string, unknown>[] = [];
  for (let index = 0; index < rawPairEdges.length; index += 1) {
    const path = `delegationMeasurement.pairEdges[${index}]`;
    const edge = asRecord(rawPairEdges[index], path);
    const pairEdgeId = asString(edge['pairEdgeId'], `${path}.pairEdgeId`);
    if (pairEdgeIds.has(pairEdgeId)) {
      fail(`duplicate pair edge ${pairEdgeId}`);
    }
    pairEdgeIds.add(pairEdgeId);
    const activeId = asString(edge['activeBindingId'], `${path}.activeBindingId`);
    const inactiveId = asString(
      edge['inactiveBindingId'],
      `${path}.inactiveBindingId`,
    );
    const active = bindingsById.get(activeId);
    const inactive = bindingsById.get(inactiveId);
    if (active === undefined || inactive === undefined) {
      fail(`${path} references a missing binding`);
    }
    exact(active['delegationState'], 'D1', `${path}.active.delegationState`);
    if (
      inactive['delegationState'] !== 'D0' &&
      inactive['delegationState'] !== 'D2' &&
      inactive['delegationState'] !== 'D3' &&
      inactive['delegationState'] !== 'D4'
    ) {
      fail(`${path}.inactive binding is not an inactive delegation state`);
    }
    for (const key of [
      'queryCaseId',
      'fixtureScenarioId',
      'tenantSlot',
      'role',
    ]) {
      exact(active[key], edge[key], `${path}.active.${key}`);
      exact(inactive[key], edge[key], `${path}.inactive.${key}`);
    }
    exact(active['pairKey'], inactive['pairKey'], `${path}.pairKey`);
    structuralPairEdges.push({
      activeBindingId: activeId,
      inactiveBindingId: inactiveId,
      pairEdgeId,
    });
  }

  const rawNoEffectControls = asArray(
    measurement['noEffectControls'],
    'delegationMeasurement.noEffectControls',
  );
  exact(
    rawNoEffectControls.length,
    20,
    'delegationMeasurement.noEffectControls.length',
  );
  const controlIds = new Set<string>();
  const structuralControls: Record<string, unknown>[] = [];
  for (let index = 0; index < rawNoEffectControls.length; index += 1) {
    const path = `delegationMeasurement.noEffectControls[${index}]`;
    const control = asRecord(rawNoEffectControls[index], path);
    const controlId = asString(control['controlId'], `${path}.controlId`);
    if (controlIds.has(controlId)) {
      fail(`duplicate no-effect control ${controlId}`);
    }
    controlIds.add(controlId);
    const actorProfileId = asString(
      control['actorProfileId'],
      `${path}.actorProfileId`,
    );
    const profile = profileById.get(actorProfileId);
    if (profile === undefined) {
      fail(`${path} references unknown actor profile`);
    }
    if (profile.role !== 'owner' && profile.role !== 'operations') {
      fail(`${path} is not an owner/operations no-effect control`);
    }
    validateSparseProfileFields(control, profile, path);
    structuralControls.push({
      actorProfileId,
      controlId,
      delegationState: profile.delegationState,
      role: profile.role,
      tenantSlot: profile.tenantSlot,
    });
  }

  const manifestInputs: H1ActorMatrixManifestInputs = Object.freeze({
    schemaVersion: 1,
    artifactKind: 'hearth-search-h1-actor-matrix-plan',
    measurementStatus: 'NOT_YET_MEASURED',
    baselineUse: 'drift-detector-against-dae27a4',
    actorClassVersion: 'HEARTH-003-ACTOR-CLASSES-v2',
    measurementVersion: 'HEARTH-003-DELEGATION-MEASUREMENT-v2',
    actorProfileCount: 140,
    nonDelegationAssignmentCount: 699,
    nonDelegationObservationCount: 37_030,
    delegationAssignmentCount: 29,
    delegationBindingCount: 370,
    pairEdgeCount: 280,
    noEffectControlCount: 20,
    actorProfilesSha256: canonicalSha256(actorProfiles),
    nonDelegationExpansionSha256: canonicalSha256(
      nonDelegationAssignments,
    ),
    delegationExpansionSha256: canonicalSha256(delegationAssignments),
    pairEdgesSha256: canonicalSha256(structuralPairEdges),
    noEffectControlsSha256: canonicalSha256(structuralControls),
  });

  return Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    actorProfiles,
    nonDelegationAssignments: Object.freeze(nonDelegationAssignments),
    delegationAssignments: Object.freeze(delegationAssignments),
    manifestInputs,
    manifestSha256: canonicalSha256(manifestInputs),
  });
}
