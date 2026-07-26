import { createHash } from "node:crypto";

import { canonicalJson, canonicalSha256 } from "../canonical.js";
import type { H1ActorMatrixPlan, H1ActorProfile } from "./actorMatrixPlan.js";
import type { H1BulkSeedMaterialization, H1BulkSeedRow } from "./bulkRows.js";
import type {
  H1CorpusPlan,
  H1Register,
  H1SourceIdentity,
} from "./corpusPlanner.js";
import {
  type H1AuthoritySeedRow,
  type H1TenantSlot,
  validatePhysicalSeedPlan,
} from "./seedPlan.js";

export class H1BoundedCorpusClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "H1BoundedCorpusClassificationError";
  }
}

export interface H1ExclusiveClassification {
  readonly b0: boolean;
  readonly o0: boolean;
}

export interface H1BoundedCorpusClassifierInputs {
  readonly fixture: unknown;
  readonly driftBaseline: unknown;
  readonly authoritativePredicates: unknown;
  readonly actorClasses: unknown;
  readonly corpusPlan: H1CorpusPlan;
  readonly actorMatrixPlan: H1ActorMatrixPlan;
  readonly bulkMaterialization: H1BulkSeedMaterialization;
}

export interface H1BoundedCorpusManifestInputs {
  readonly schemaVersion: 1;
  readonly artifactKind: "hearth-search-h1-bounded-classification-receipt";
  readonly measurementStatus: "NOT_YET_MEASURED";
  readonly baselineMeaning: "dae27a4-drift-baseline-only";
  readonly sourceCount: 100_037;
  readonly actorProfileCount: 140;
  readonly classificationCount: 14_005_180;
  readonly b0Count: number;
  readonly o0Count: number;
  readonly intersectionCount: 0;
  readonly unclassifiedCount: 0;
  readonly hardCanarySourceCount: 37;
  readonly hardCanaryClassificationCount: 5_180;
  readonly hardCanaryB0Count: number;
  readonly hardCanaryO0Count: number;
  readonly forbiddenCanarySourceCount: 27;
  readonly forbiddenCanaryClassificationCount: 3_780;
  readonly forbiddenCanaryB0Count: number;
  readonly forbiddenCanaryO0Count: number;
  readonly securityCollisionCanarySourceCount: 10;
  readonly securityCollisionCanaryClassificationCount: 1_400;
  readonly securityCollisionCanaryB0Count: number;
  readonly securityCollisionCanaryO0Count: number;
  readonly inputHashes: {
    readonly fixtureSha256: string;
    readonly driftBaselineSha256: string;
    readonly authoritativePredicatesSha256: string;
    readonly actorClassesSha256: string;
    readonly corpusPlanSha256: string;
    readonly actorMatrixPlanSha256: string;
    readonly bulkRowsSha256: string;
  };
  readonly sourceUniverseSha256: string;
  readonly b0O0PartitionSha256: string;
  readonly hardCanaryPartitionSha256: string;
  readonly forbiddenCanaryPartitionSha256: string;
  readonly securityCollisionCanaryPartitionSha256: string;
  readonly perProfileCountsSha256: string;
  readonly perRegisterCountsSha256: string;
}

export interface H1BoundedCorpusClassificationReceipt {
  readonly measurementStatus: "NOT_YET_MEASURED";
  readonly baselineMeaning: "dae27a4-drift-baseline-only";
  readonly manifestInputs: H1BoundedCorpusManifestInputs;
  readonly manifestSha256: string;
}

type JsonObject = Record<string, unknown>;

interface RawRow {
  readonly rowId: string;
  readonly tenantSlot: H1TenantSlot;
  readonly table: string;
  readonly values: Readonly<Record<string, unknown>>;
}

interface SourceEntry {
  readonly identity: H1SourceIdentity;
  readonly row: RawRow;
  readonly hardCanary: boolean;
  readonly hardCanaryKind:
    "forbidden_canary" | "security_collision_canary" | null;
}

interface DependencyRow extends RawRow {
  readonly recordId: string;
  readonly register: H1Register | null;
}

interface PreparedSource {
  readonly entry: SourceEntry;
  readonly staticFacts: Readonly<Record<string, unknown>>;
  readonly claimSubmitter: string | null;
  readonly ownerClaimSubmitter: string | null;
  readonly dependencies: ReadonlyMap<string, DependencyRow>;
}

interface ActorFacts {
  readonly profile: H1ActorProfile;
  readonly entitlement: Readonly<Record<string, unknown>>;
  readonly delegation: Readonly<Record<string, unknown>>;
}

interface EvaluationContext {
  readonly source: PreparedSource;
  readonly actor: ActorFacts;
  readonly roleSets: ReadonlyMap<string, ReadonlySet<string>>;
  readonly registerPredicates: ReadonlyMap<H1Register, JsonObject>;
}

interface RegisterCounts {
  sourceCount: number;
  b0Count: number;
  o0Count: number;
}

const REGISTERS = Object.freeze([
  "person",
  "mission",
  "agreement",
  "entity",
  "credential",
  "journey",
  "kit",
  "apparel",
  "approval",
  "team",
  "invoice",
  "claim",
  "distribution",
  "document",
  "term",
  "line",
  "beneficiary",
] as const satisfies readonly H1Register[]);

const TABLE_BY_REGISTER = Object.freeze({
  person: "person",
  mission: "mission",
  agreement: "agreement",
  entity: "entity",
  credential: "credential",
  journey: "journey",
  kit: "kit",
  apparel: "apparel",
  approval: "approval",
  team: "team",
  invoice: "invoice",
  claim: "claim",
  distribution: "distribution",
  document: "document",
  term: "agreement_term",
  line: "mission_line",
  beneficiary: "beneficiary",
} satisfies Readonly<Record<H1Register, string>>);

const ID_COLUMN_BY_TABLE: Readonly<Record<string, string>> = Object.freeze({
  person: "person_id",
  mission: "mission_id",
  agreement: "agreement_id",
  entity: "entity_id",
  credential: "credential_id",
  journey: "journey_id",
  kit: "kit_id",
  apparel: "apparel_id",
  approval: "approval_id",
  team: "team_id",
  invoice: "invoice_id",
  claim: "claim_id",
  distribution: "distribution_id",
  document: "document_id",
  agreement_term: "term_id",
  mission_line: "line_id",
  beneficiary: "beneficiary_id",
  comms_message: "message_id",
  comms_obligation: "obligation_id",
  comms_thread: "thread_id",
});

const REGISTER_BY_TABLE = new Map<string, H1Register>(
  Object.entries(TABLE_BY_REGISTER).map(([register, table]) => [
    table,
    register as H1Register,
  ]),
);

const DOCUMENT_OWNER_TABLE: Readonly<Record<string, string>> = Object.freeze({
  Person: "person",
  Mission: "mission",
  Credential: "credential",
  Entity: "entity",
  Agreement: "agreement",
  Invoice: "invoice",
  Claim: "claim",
  CommsMessage: "comms_message",
  CommsObligation: "comms_obligation",
});

const MISSING = Symbol("H1_MISSING_FACT");

function fail(message: string): never {
  throw new H1BoundedCorpusClassificationError(message);
}

function asRecord(value: unknown, path: string): JsonObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${path} must be a plain object`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${path} must be boolean`);
  }
  return value;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    fail(`${path} must equal ${String(expected)}`);
  }
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  path: string,
): string[] {
  const actual = asArray(value, path).map((entry, index) =>
    asString(entry, `${path}[${index}]`),
  );
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    fail(`${path} does not match the closed authority order`);
  }
  return actual;
}

function isRegister(value: string): value is H1Register {
  return REGISTERS.includes(value as H1Register);
}

function sourceKey(source: H1SourceIdentity): string {
  return JSON.stringify([source.tenantSlot, source.register, source.recordId]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSource(left: SourceEntry, right: SourceEntry): number {
  return (
    compareText(left.identity.tenantSlot, right.identity.tenantSlot) ||
    compareText(left.identity.register, right.identity.register) ||
    compareText(left.identity.recordId, right.identity.recordId) ||
    compareText(left.identity.recordKind ?? "", right.identity.recordKind ?? "")
  );
}

function parseSourceIdentity(
  value: unknown,
  tenantSlotFallback: H1TenantSlot | null,
  path: string,
): H1SourceIdentity {
  const source = asRecord(value, path);
  const tenantSlotValue = source["tenantSlot"] ?? tenantSlotFallback;
  if (tenantSlotValue !== "T01" && tenantSlotValue !== "T02") {
    fail(`${path}.tenantSlot is missing or unknown`);
  }
  const register = asString(source["register"], `${path}.register`);
  if (!isRegister(register)) {
    fail(`${path}.register is outside the closed 17-register set`);
  }
  const recordId = asString(source["recordId"], `${path}.recordId`);
  const recordKind = source["recordKind"];
  if (recordKind !== null && typeof recordKind !== "string") {
    fail(`${path}.recordKind must be a string or null`);
  }
  return Object.freeze({
    tenantSlot: tenantSlotValue,
    register,
    recordId,
    recordKind,
  });
}

function rawRow(row: H1AuthoritySeedRow | H1BulkSeedRow): RawRow {
  if (row.tenantSlot !== "T01" && row.tenantSlot !== "T02") {
    fail(`source row ${row.rowId} has no tenant`);
  }
  return Object.freeze({
    rowId: row.rowId,
    tenantSlot: row.tenantSlot,
    table: row.table,
    values: row.values,
  });
}

function assertSourceRowBinding(source: H1SourceIdentity, row: RawRow): void {
  const expectedTable = TABLE_BY_REGISTER[source.register];
  exact(row.table, expectedTable, `${row.rowId}.table`);
  exact(row.tenantSlot, source.tenantSlot, `${row.rowId}.tenantSlot`);
  const idColumn = ID_COLUMN_BY_TABLE[row.table];
  if (idColumn === undefined) {
    fail(`source row ${row.rowId} has no identity-column mapping`);
  }
  exact(row.values[idColumn], source.recordId, `${row.rowId}.${idColumn}`);
  if (source.register === "document") {
    exact(
      row.values["record_kind"],
      source.recordKind,
      `${row.rowId}.record_kind`,
    );
  } else {
    exact(source.recordKind, null, `${row.rowId}.recordKind`);
  }
}

function buildHardCanaryIndex(
  fixture: JsonObject,
): ReadonlyMap<string, "forbidden_canary" | "security_collision_canary"> {
  const hard = new Map<
    string,
    "forbidden_canary" | "security_collision_canary"
  >();
  const categories = {
    forbidden_canary: 0,
    security_collision_canary: 0,
  };
  const fixtures = asArray(fixture["fixtures"], "fixture.fixtures");
  exact(fixtures.length, 356, "fixture.fixtures.length");
  for (let index = 0; index < fixtures.length; index += 1) {
    const entry = asRecord(fixtures[index], `fixture.fixtures[${index}]`);
    const relevance = asString(
      entry["relevance"],
      `fixture.fixtures[${index}].relevance`,
    );
    if (
      relevance !== "forbidden_canary" &&
      relevance !== "security_collision_canary"
    ) {
      continue;
    }
    const source = parseSourceIdentity(
      entry["source"],
      null,
      `fixture.fixtures[${index}].source`,
    );
    const key = sourceKey(source);
    if (hard.has(key)) {
      fail(`duplicate hard canary source ${source.recordId}`);
    }
    hard.set(key, relevance);
    categories[relevance] += 1;
  }
  exact(categories.forbidden_canary, 27, "forbidden canary source count");
  exact(
    categories.security_collision_canary,
    10,
    "security collision canary source count",
  );
  exact(hard.size, 37, "hard canary source count");
  return hard;
}

function buildSourceUniverse(
  fixture: JsonObject,
  corpusPlan: H1CorpusPlan,
  bulkMaterialization: H1BulkSeedMaterialization,
): Readonly<{
  sources: readonly SourceEntry[];
  allRows: readonly RawRow[];
}> {
  if (
    corpusPlan.measurementStatus !== "NOT_YET_MEASURED" ||
    corpusPlan.authoritySources.length !== 597 ||
    corpusPlan.bulkRecords.length !== 99_403
  ) {
    fail("classifier requires the complete validated H1 corpus plan");
  }
  if (
    bulkMaterialization.measurementStatus !== "NOT_YET_MEASURED" ||
    bulkMaterialization.rowCount !== 99_403 ||
    bulkMaterialization.rows.length !== 99_403
  ) {
    fail("classifier requires all 99,403 generated physical bulk rows");
  }

  const physical = validatePhysicalSeedPlan(fixture["physicalSeedPlan"]);
  const hardCanaries = buildHardCanaryIndex(fixture);
  const countedAuthority = new Set(corpusPlan.authoritySources.map(sourceKey));
  exact(countedAuthority.size, 597, "counted authority source identity count");
  const sourceByKey = new Map<string, SourceEntry>();
  const allRows: RawRow[] = physical.rows
    .filter(
      (row): row is H1AuthoritySeedRow & { tenantSlot: H1TenantSlot } =>
        row.tenantSlot === "T01" || row.tenantSlot === "T02",
    )
    .map(rawRow);
  for (const row of physical.rows) {
    if (row.source === undefined) {
      continue;
    }
    const source = parseSourceIdentity(
      row.source,
      row.tenantSlot,
      `${row.rowId}.source`,
    );
    const sourceRow = rawRow(row);
    assertSourceRowBinding(source, sourceRow);
    const key = sourceKey(source);
    if (sourceByKey.has(key)) {
      fail(`duplicate authority source identity ${source.recordId}`);
    }
    const hardCanaryKind = hardCanaries.get(key) ?? null;
    if (!countedAuthority.has(key) && hardCanaryKind === null) {
      fail(
        `authority source ${source.recordId} is neither counted nor a canary`,
      );
    }
    if (countedAuthority.has(key) && hardCanaryKind !== null) {
      fail(`authority source ${source.recordId} is both counted and a canary`);
    }
    sourceByKey.set(
      key,
      Object.freeze({
        identity: source,
        row: sourceRow,
        hardCanary: hardCanaryKind !== null,
        hardCanaryKind,
      }),
    );
  }
  exact(sourceByKey.size, 634, "authority bounded source count");
  for (const key of countedAuthority) {
    if (!sourceByKey.has(key)) {
      fail("a counted authority source has no physical row");
    }
  }
  for (const key of hardCanaries.keys()) {
    if (!sourceByKey.has(key)) {
      fail("a hard canary has no physical row");
    }
  }

  const descriptorById = new Map(
    corpusPlan.bulkRecords.map((record) => [record.bulkRowId, record]),
  );
  exact(descriptorById.size, 99_403, "bulk descriptor identity count");
  for (const bulkRow of bulkMaterialization.rows) {
    const descriptor = descriptorById.get(bulkRow.rowId);
    if (descriptor === undefined) {
      fail(`bulk row ${bulkRow.rowId} has no generated descriptor`);
    }
    const sourceRow = rawRow(bulkRow);
    assertSourceRowBinding(descriptor.source, sourceRow);
    const key = sourceKey(descriptor.source);
    if (sourceByKey.has(key)) {
      fail(
        `bulk source ${descriptor.source.recordId} collides with the corpus`,
      );
    }
    sourceByKey.set(
      key,
      Object.freeze({
        identity: descriptor.source,
        row: sourceRow,
        hardCanary: false,
        hardCanaryKind: null,
      }),
    );
    allRows.push(sourceRow);
  }
  exact(
    descriptorById.size,
    bulkMaterialization.rows.length,
    "bulk row coverage",
  );
  exact(sourceByKey.size, 100_037, "bounded source universe count");
  exact(
    [...sourceByKey.values()].filter((source) => source.hardCanary).length,
    37,
    "bounded hard canary count",
  );
  exact(allRows.length, 100_081, "physical row universe count");
  return Object.freeze({
    sources: Object.freeze([...sourceByKey.values()].sort(compareSource)),
    allRows: Object.freeze(allRows),
  });
}

function buildDependencyIndex(
  rows: readonly RawRow[],
): ReadonlyMap<string, DependencyRow> {
  const index = new Map<string, DependencyRow>();
  for (const row of rows) {
    const idColumn = ID_COLUMN_BY_TABLE[row.table];
    if (idColumn === undefined) {
      continue;
    }
    const value = row.values[idColumn];
    if (typeof value !== "string" || value.length === 0) {
      fail(`${row.rowId}.${idColumn} is required for raw dependency indexing`);
    }
    const key = JSON.stringify([row.tenantSlot, row.table, value]);
    if (index.has(key)) {
      fail(`duplicate raw dependency ${row.tenantSlot}/${row.table}/${value}`);
    }
    index.set(
      key,
      Object.freeze({
        ...row,
        recordId: value,
        register: REGISTER_BY_TABLE.get(row.table) ?? null,
      }),
    );
  }
  return index;
}

function dependencyAt(
  index: ReadonlyMap<string, DependencyRow>,
  tenantSlot: H1TenantSlot,
  table: string,
  recordId: unknown,
  path: string,
): DependencyRow {
  if (typeof recordId !== "string" || recordId.length === 0) {
    fail(`${path} cannot be derived from the raw source row`);
  }
  const dependency = index.get(JSON.stringify([tenantSlot, table, recordId]));
  if (dependency === undefined) {
    fail(`${path} is missing from the materialized raw dependency rows`);
  }
  return dependency;
}

function prepareSource(
  entry: SourceEntry,
  dependencies: ReadonlyMap<string, DependencyRow>,
): PreparedSource {
  const values = entry.row.values;
  const staticFacts: Record<string, unknown> = {
    tenantSlot: entry.identity.tenantSlot,
  };
  const relationshipRows = new Map<string, DependencyRow>();
  let claimSubmitter: string | null = null;
  let ownerClaimSubmitter: string | null = null;

  if (entry.identity.register === "claim") {
    claimSubmitter = asString(
      values["submitted_by"],
      `${entry.row.rowId}.submitted_by`,
    );
  }
  if (
    entry.identity.register === "term" ||
    entry.identity.register === "line"
  ) {
    staticFacts["active"] = asBoolean(
      values["is_active"],
      `${entry.row.rowId}.is_active`,
    );
    const parent =
      entry.identity.register === "term"
        ? dependencyAt(
            dependencies,
            entry.identity.tenantSlot,
            "agreement",
            values["agreement_id"],
            `${entry.row.rowId}.agreement_id`,
          )
        : dependencyAt(
            dependencies,
            entry.identity.tenantSlot,
            "mission",
            values["mission_id"],
            `${entry.row.rowId}.mission_id`,
          );
    staticFacts["parentExists"] = parent !== undefined;
  }
  if (entry.identity.register === "document") {
    const ownerType = asString(
      values["owner_type"],
      `${entry.row.rowId}.owner_type`,
    );
    const ownerId = asString(values["owner_id"], `${entry.row.rowId}.owner_id`);
    const recordKind = asString(
      values["record_kind"],
      `${entry.row.rowId}.record_kind`,
    );
    const active = asBoolean(
      values["is_active"],
      `${entry.row.rowId}.is_active`,
    );
    staticFacts["ownerType"] = ownerType;
    staticFacts["ownerId"] = ownerId;
    staticFacts["recordKind"] = recordKind;
    staticFacts["active"] = active;
    const ownerTable = DOCUMENT_OWNER_TABLE[ownerType];
    if (ownerTable !== undefined) {
      const owner = dependencyAt(
        dependencies,
        entry.identity.tenantSlot,
        ownerTable,
        ownerId,
        `${entry.row.rowId}.document_owner`,
      );
      staticFacts["ownerExists"] = true;
      relationshipRows.set("document_owner", owner);
      if (owner.table === "claim") {
        ownerClaimSubmitter = asString(
          owner.values["submitted_by"],
          `${owner.rowId}.submitted_by`,
        );
      }
      if (
        owner.table === "comms_message" ||
        owner.table === "comms_obligation"
      ) {
        const thread = dependencyAt(
          dependencies,
          entry.identity.tenantSlot,
          "comms_thread",
          owner.values["thread_id"],
          `${entry.row.rowId}.owner_thread`,
        );
        relationshipRows.set("owner_thread", thread);
        if (
          thread.values["anchor_type"] === "Mission" &&
          typeof thread.values["anchor_id"] === "string"
        ) {
          const anchor = dependencyAt(
            dependencies,
            entry.identity.tenantSlot,
            "mission",
            thread.values["anchor_id"],
            `${entry.row.rowId}.thread_anchor`,
          );
          relationshipRows.set("thread_anchor", anchor);
        }
      }
    } else {
      staticFacts["ownerExists"] = false;
    }
  }

  return Object.freeze({
    entry,
    staticFacts: Object.freeze(staticFacts),
    claimSubmitter,
    ownerClaimSubmitter,
    dependencies: relationshipRows,
  });
}

function parseRoleSets(
  actorClasses: JsonObject,
): ReadonlyMap<string, ReadonlySet<string>> {
  const roles = exactStringArray(
    actorClasses["roles"],
    ["owner", "operations", "legal", "finance", "hr", "management", "visitor"],
    "actorClasses.roles",
  );
  const rawRoleSets = asRecord(
    actorClasses["roleSets"],
    "actorClasses.roleSets",
  );
  const roleSets = new Map<string, ReadonlySet<string>>();
  for (const [name, value] of Object.entries(rawRoleSets)) {
    const entries = asArray(value, `actorClasses.roleSets.${name}`).map(
      (entry, index) =>
        asString(entry, `actorClasses.roleSets.${name}[${index}]`),
    );
    if (entries.some((role) => !roles.includes(role))) {
      fail(`actorClasses.roleSets.${name} contains an unknown role`);
    }
    if (new Set(entries).size !== entries.length) {
      fail(`actorClasses.roleSets.${name} contains duplicates`);
    }
    roleSets.set(name, new Set(entries));
  }
  return roleSets;
}

function actorFacts(
  actorClasses: JsonObject,
  profile: H1ActorProfile,
): ActorFacts {
  const entitlementStates = asRecord(
    actorClasses["entitlementStates"],
    "actorClasses.entitlementStates",
  );
  const delegationStates = asRecord(
    actorClasses["delegationStates"],
    "actorClasses.delegationStates",
  );
  const entitlementState = asRecord(
    entitlementStates[profile.entitlementState],
    `actorClasses.entitlementStates.${profile.entitlementState}`,
  );
  const delegationState = asRecord(
    delegationStates[profile.delegationState],
    `actorClasses.delegationStates.${profile.delegationState}`,
  );
  const entitlementRowExists = asBoolean(
    entitlementState["rowExists"],
    `${profile.actorProfileId}.entitlement.rowExists`,
  );
  const entitlement: Record<string, unknown> = {
    rowExists: entitlementRowExists,
  };
  if (entitlementRowExists) {
    entitlement["moduleKey"] = asString(
      entitlementState["moduleKey"],
      `${profile.actorProfileId}.entitlement.moduleKey`,
    );
  }
  const delegation = {
    rowExists: asBoolean(
      delegationState["rowExists"],
      `${profile.actorProfileId}.delegation.rowExists`,
    ),
    granteeRelation: delegationState["granteeRelation"],
    startsOn: delegationState["startsOn"],
    endsOn: delegationState["endsOn"],
    revokedAt: delegationState["revokedAt"],
  };
  return Object.freeze({
    profile,
    entitlement: Object.freeze(entitlement),
    delegation: Object.freeze(delegation),
  });
}

function expandPredicate(
  expression: unknown,
  namedPredicates: JsonObject,
  path: string,
  stack: readonly string[] = [],
): JsonObject {
  const node = asRecord(expression, path);
  const op = asString(node["op"], `${path}.op`);
  if (op === "ref") {
    const name = asString(node["name"], `${path}.name`);
    if (stack.includes(name)) {
      fail(`predicate reference cycle at ${name}`);
    }
    if (!Object.hasOwn(namedPredicates, name)) {
      fail(`predicate reference ${name} is unknown`);
    }
    return expandPredicate(
      namedPredicates[name],
      namedPredicates,
      `${path}.ref(${name})`,
      [...stack, name],
    );
  }
  const allowed = new Set([
    "true",
    "false",
    "all",
    "any",
    "not",
    "role_in",
    "fact_eq",
    "fact_in",
    "date_lte",
    "date_gte",
    "owner_dispatch",
    "dependency_exists",
    "dependency_field_eq",
    "dependency_link_eq",
    "source_dependency_link_eq",
    "dependency_register_readable",
  ]);
  if (!allowed.has(op)) {
    fail(`${path} uses unsupported predicate operator ${op}`);
  }
  if (op === "all" || op === "any") {
    const args = asArray(node["args"], `${path}.args`);
    if (args.length === 0) fail(`${path}.args must not be empty`);
    return {
      ...node,
      args: args.map((arg, index) =>
        expandPredicate(arg, namedPredicates, `${path}.args[${index}]`, stack),
      ),
    };
  }
  if (op === "not") {
    return {
      ...node,
      arg: expandPredicate(node["arg"], namedPredicates, `${path}.arg`, stack),
    };
  }
  if (op === "owner_dispatch") {
    const cases = asRecord(node["cases"], `${path}.cases`);
    return {
      ...node,
      cases: Object.fromEntries(
        Object.entries(cases).map(([ownerType, branch]) => [
          ownerType,
          expandPredicate(
            branch,
            namedPredicates,
            `${path}.cases.${ownerType}`,
            stack,
          ),
        ]),
      ),
      default: expandPredicate(
        node["default"],
        namedPredicates,
        `${path}.default`,
        stack,
      ),
    };
  }
  return node;
}

function validateAuthorityPrograms(
  driftBaseline: JsonObject,
  predicates: JsonObject,
  actorClasses: JsonObject,
): Readonly<{
  roleSets: ReadonlyMap<string, ReadonlySet<string>>;
  registerPredicates: ReadonlyMap<H1Register, JsonObject>;
  baselineNarrowing: ReadonlyMap<H1Register, JsonObject>;
}> {
  exact(
    driftBaseline["driftBaselineVersion"],
    "HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1",
    "driftBaseline.driftBaselineVersion",
  );
  const lineage = asRecord(
    driftBaseline["baselineLineage"],
    "driftBaseline.baselineLineage",
  );
  exact(
    lineage["productCommit"],
    "dae27a400868c0c686788ab8e5520690dbf77334",
    "driftBaseline.baselineLineage.productCommit",
  );
  const noOracleClaim = asString(
    lineage["noOracleClaim"],
    "driftBaseline.baselineLineage.noOracleClaim",
  );
  if (!noOracleClaim.includes("not a disclosure oracle")) {
    fail("drift baseline no-oracle boundary is absent");
  }
  const composition = asRecord(
    driftBaseline["compositionRule"],
    "driftBaseline.compositionRule",
  );
  exact(
    composition["baselineIncludedSource"],
    "authoritativePredicates.registers[register].readableWhen AND registers[register].baselineNarrowing, reconstructed as the dae27a4 baseline",
    "driftBaseline.compositionRule.baselineIncludedSource",
  );
  exact(
    composition["deriveFactsFrom"],
    "raw source rows, raw dependency rows, and frozen actor facts only",
    "driftBaseline.compositionRule.deriveFactsFrom",
  );
  exact(
    composition["missingFact"],
    false,
    "driftBaseline.compositionRule.missingFact",
  );
  exact(
    predicates["predicateVersion"],
    "HEARTH-003-AUTHORITATIVE-PREDICATES-v2",
    "authoritativePredicates.predicateVersion",
  );
  exact(
    actorClasses["actorClassVersion"],
    "HEARTH-003-ACTOR-CLASSES-v2",
    "actorClasses.actorClassVersion",
  );
  const normalization = asRecord(
    actorClasses["normalization"],
    "actorClasses.normalization",
  );
  exact(
    normalization["claimSubmitter"],
    "exact stored submitted_by equality to actor.identity",
    "actorClasses.normalization.claimSubmitter",
  );
  exact(
    normalization["tenant"],
    "exact tenantSlot equality",
    "actorClasses.normalization.tenant",
  );

  const roleSets = parseRoleSets(actorClasses);
  const namedPredicates = asRecord(
    predicates["namedPredicates"],
    "authoritativePredicates.namedPredicates",
  );
  const predicateRegisters = asRecord(
    predicates["registers"],
    "authoritativePredicates.registers",
  );
  const baselineRegisters = asRecord(
    driftBaseline["registers"],
    "driftBaseline.registers",
  );
  exactStringArray(
    Object.keys(predicateRegisters),
    REGISTERS,
    "authoritativePredicates.registers",
  );
  exactStringArray(
    Object.keys(baselineRegisters),
    REGISTERS,
    "driftBaseline.registers",
  );
  const registerPredicates = new Map<H1Register, JsonObject>();
  const baselineNarrowing = new Map<H1Register, JsonObject>();
  for (const register of REGISTERS) {
    const predicateRegister = asRecord(
      predicateRegisters[register],
      `authoritativePredicates.registers.${register}`,
    );
    registerPredicates.set(
      register,
      expandPredicate(
        predicateRegister["readableWhen"],
        namedPredicates,
        `authoritativePredicates.registers.${register}.readableWhen`,
      ),
    );
    const baselineRegister = asRecord(
      baselineRegisters[register],
      `driftBaseline.registers.${register}`,
    );
    baselineNarrowing.set(
      register,
      expandPredicate(
        baselineRegister["baselineNarrowing"],
        {},
        `driftBaseline.registers.${register}.baselineNarrowing`,
      ),
    );
  }
  return Object.freeze({
    roleSets,
    registerPredicates,
    baselineNarrowing,
  });
}

function resolveFact(
  path: string,
  context: EvaluationContext,
): unknown | typeof MISSING {
  if (path === "actor.tenantSlot") return context.actor.profile.tenantSlot;
  if (path === "actor.role") return context.actor.profile.role;
  if (path === "actor.identity") return context.actor.profile.actorIdentity;
  if (path.startsWith("actor.entitlement.")) {
    const key = path.slice("actor.entitlement.".length);
    return Object.hasOwn(context.actor.entitlement, key)
      ? context.actor.entitlement[key]
      : MISSING;
  }
  if (path.startsWith("actor.delegation.")) {
    const key = path.slice("actor.delegation.".length);
    return Object.hasOwn(context.actor.delegation, key)
      ? context.actor.delegation[key]
      : MISSING;
  }
  if (path.startsWith("row.")) {
    const key = path.slice("row.".length);
    if (key === "submittedByRelation") {
      if (context.source.claimSubmitter === null) return MISSING;
      return context.source.claimSubmitter ===
        context.actor.profile.actorIdentity
        ? "actor_identity"
        : "other_submitter";
    }
    if (key === "ownerSubmittedByRelation") {
      if (context.source.ownerClaimSubmitter === null) return MISSING;
      return context.source.ownerClaimSubmitter ===
        context.actor.profile.actorIdentity
        ? "actor_identity"
        : "other_submitter";
    }
    return Object.hasOwn(context.source.staticFacts, key)
      ? context.source.staticFacts[key]
      : MISSING;
  }
  fail(`predicate requests unsupported fact path ${path}`);
}

function dependencyField(
  dependency: DependencyRow,
  path: string,
): unknown | typeof MISSING {
  if (path === "recordId") return dependency.recordId;
  return Object.hasOwn(dependency.values, path)
    ? dependency.values[path]
    : MISSING;
}

function evaluate(expression: JsonObject, context: EvaluationContext): boolean {
  const op = asString(expression["op"], "predicate.op");
  switch (op) {
    case "true":
      return true;
    case "false":
      return false;
    case "all":
      return asArray(expression["args"], "predicate.all.args").every((arg) =>
        evaluate(asRecord(arg, "predicate.all.arg"), context),
      );
    case "any":
      return asArray(expression["args"], "predicate.any.args").some((arg) =>
        evaluate(asRecord(arg, "predicate.any.arg"), context),
      );
    case "not":
      return !evaluate(
        asRecord(expression["arg"], "predicate.not.arg"),
        context,
      );
    case "role_in": {
      const setName = asString(expression["set"], "predicate.role_in.set");
      const roleSet = context.roleSets.get(setName);
      if (roleSet === undefined) fail(`unknown role set ${setName}`);
      return roleSet.has(context.actor.profile.role);
    }
    case "fact_eq": {
      const left = resolveFact(
        asString(expression["leftPath"], "predicate.fact_eq.leftPath"),
        context,
      );
      if (left === MISSING) return false;
      const right = Object.hasOwn(expression, "rightPath")
        ? resolveFact(
            asString(expression["rightPath"], "predicate.fact_eq.rightPath"),
            context,
          )
        : expression["rightValue"];
      return right !== MISSING && left === right;
    }
    case "fact_in": {
      const left = resolveFact(
        asString(expression["leftPath"], "predicate.fact_in.leftPath"),
        context,
      );
      if (left === MISSING) return false;
      return asArray(expression["values"], "predicate.fact_in.values").includes(
        left,
      );
    }
    case "date_lte":
    case "date_gte": {
      const left = resolveFact(
        asString(expression["leftPath"], `predicate.${op}.leftPath`),
        context,
      );
      const right = asString(
        expression["rightValue"],
        `predicate.${op}.rightValue`,
      );
      if (typeof left !== "string") return false;
      return op === "date_lte" ? left <= right : left >= right;
    }
    case "owner_dispatch": {
      const ownerType = resolveFact(
        asString(
          expression["ownerTypePath"],
          "predicate.owner_dispatch.ownerTypePath",
        ),
        context,
      );
      const cases = asRecord(
        expression["cases"],
        "predicate.owner_dispatch.cases",
      );
      const branch =
        typeof ownerType === "string" && Object.hasOwn(cases, ownerType)
          ? cases[ownerType]
          : expression["default"];
      return evaluate(
        asRecord(branch, "predicate.owner_dispatch.branch"),
        context,
      );
    }
    case "dependency_exists": {
      const relationship = asString(
        expression["relationship"],
        "predicate.dependency_exists.relationship",
      );
      const dependency = context.source.dependencies.get(relationship);
      return (
        dependency !== undefined &&
        dependency.table ===
          asString(expression["table"], "predicate.dependency_exists.table")
      );
    }
    case "dependency_field_eq": {
      const dependency = context.source.dependencies.get(
        asString(
          expression["relationship"],
          "predicate.dependency_field_eq.relationship",
        ),
      );
      if (dependency === undefined) return false;
      const value = dependencyField(
        dependency,
        asString(expression["field"], "predicate.dependency_field_eq.field"),
      );
      return value !== MISSING && value === expression["rightValue"];
    }
    case "dependency_link_eq": {
      const left = context.source.dependencies.get(
        asString(
          expression["leftRelationship"],
          "predicate.dependency_link_eq.leftRelationship",
        ),
      );
      const right = context.source.dependencies.get(
        asString(
          expression["rightRelationship"],
          "predicate.dependency_link_eq.rightRelationship",
        ),
      );
      if (left === undefined || right === undefined) return false;
      const leftValue = dependencyField(
        left,
        asString(
          expression["leftField"],
          "predicate.dependency_link_eq.leftField",
        ),
      );
      const rightValue = dependencyField(
        right,
        asString(
          expression["rightField"],
          "predicate.dependency_link_eq.rightField",
        ),
      );
      return (
        leftValue !== MISSING &&
        rightValue !== MISSING &&
        leftValue === rightValue
      );
    }
    case "source_dependency_link_eq": {
      const sourceValue = resolveFact(
        asString(
          expression["sourcePath"],
          "predicate.source_dependency_link_eq.sourcePath",
        ),
        context,
      );
      const dependency = context.source.dependencies.get(
        asString(
          expression["relationship"],
          "predicate.source_dependency_link_eq.relationship",
        ),
      );
      if (sourceValue === MISSING || dependency === undefined) return false;
      const dependencyValue = dependencyField(
        dependency,
        asString(
          expression["dependencyPath"],
          "predicate.source_dependency_link_eq.dependencyPath",
        ),
      );
      return dependencyValue !== MISSING && sourceValue === dependencyValue;
    }
    case "dependency_register_readable": {
      const dependency = context.source.dependencies.get(
        asString(
          expression["relationship"],
          "predicate.dependency_register_readable.relationship",
        ),
      );
      const register = asString(
        expression["register"],
        "predicate.dependency_register_readable.register",
      );
      if (
        dependency === undefined ||
        !isRegister(register) ||
        dependency.register !== register
      ) {
        return false;
      }
      const predicate = context.registerPredicates.get(register);
      if (predicate === undefined)
        fail(`missing register predicate ${register}`);
      const nestedSource = prepareSource(
        {
          identity: {
            tenantSlot: dependency.tenantSlot,
            register,
            recordId: dependency.recordId,
            recordKind: null,
          },
          row: dependency,
          hardCanary: false,
          hardCanaryKind: null,
        },
        new Map(),
      );
      return evaluate(predicate, { ...context, source: nestedSource });
    }
    default:
      fail(`unreachable predicate operator ${op}`);
  }
}

export function assertExclusiveB0O0(
  decision: H1ExclusiveClassification,
  coordinate = "classification",
): void {
  if (decision.b0 === decision.o0) {
    fail(`${coordinate} must be classified into exactly one of B0 or O0`);
  }
}

function classify(
  source: PreparedSource,
  actor: ActorFacts,
  roleSets: ReadonlyMap<string, ReadonlySet<string>>,
  registerPredicates: ReadonlyMap<H1Register, JsonObject>,
  baselineNarrowing: ReadonlyMap<H1Register, JsonObject>,
): H1ExclusiveClassification {
  const authoritative = registerPredicates.get(source.entry.identity.register);
  const narrowing = baselineNarrowing.get(source.entry.identity.register);
  if (authoritative === undefined || narrowing === undefined) {
    fail(`missing program for ${source.entry.identity.register}`);
  }
  const context: EvaluationContext = {
    source,
    actor,
    roleSets,
    registerPredicates,
  };
  const b0 = evaluate(authoritative, context) && evaluate(narrowing, context);
  const decision = Object.freeze({ b0, o0: !b0 });
  assertExclusiveB0O0(
    decision,
    `${source.entry.identity.recordId}/${actor.profile.actorProfileId}`,
  );
  return decision;
}

/**
 * Classifies the bounded 100,037-source synthetic universe without retaining
 * the 14,005,180 source/profile decisions as objects.
 */
export function classifyH1BoundedCorpus(
  inputs: H1BoundedCorpusClassifierInputs,
): H1BoundedCorpusClassificationReceipt {
  const fixture = asRecord(inputs.fixture, "fixture");
  const driftBaseline = asRecord(inputs.driftBaseline, "driftBaseline");
  const predicates = asRecord(
    inputs.authoritativePredicates,
    "authoritativePredicates",
  );
  const actorClasses = asRecord(inputs.actorClasses, "actorClasses");
  exact(
    fixture["fixtureVersion"],
    "HEARTH-003-FIXTURES-v5",
    "fixture.fixtureVersion",
  );
  const programs = validateAuthorityPrograms(
    driftBaseline,
    predicates,
    actorClasses,
  );
  const universe = buildSourceUniverse(
    fixture,
    inputs.corpusPlan,
    inputs.bulkMaterialization,
  );
  if (
    inputs.actorMatrixPlan.measurementStatus !== "NOT_YET_MEASURED" ||
    inputs.actorMatrixPlan.actorProfiles.length !== 140
  ) {
    fail("classifier requires the complete validated 140-profile actor matrix");
  }
  const actorProfiles = [...inputs.actorMatrixPlan.actorProfiles].sort(
    (left, right) => compareText(left.actorProfileId, right.actorProfileId),
  );
  if (
    new Set(actorProfiles.map((profile) => profile.actorProfileId)).size !== 140
  ) {
    fail("actor matrix contains duplicate actor profiles");
  }
  const actors = actorProfiles.map((profile) =>
    actorFacts(actorClasses, profile),
  );
  const dependencyIndex = buildDependencyIndex(universe.allRows);
  const sourceUniverseHash = createHash("sha256");
  const partitionHash = createHash("sha256");
  const hardCanaryHash = createHash("sha256");
  const forbiddenCanaryHash = createHash("sha256");
  const securityCollisionCanaryHash = createHash("sha256");
  const b0ByProfile = new Array<number>(140).fill(0);
  const o0ByProfile = new Array<number>(140).fill(0);
  const registerCounts = Object.fromEntries(
    REGISTERS.map((register) => [
      register,
      { sourceCount: 0, b0Count: 0, o0Count: 0 },
    ]),
  ) as Record<H1Register, RegisterCounts>;
  let b0Count = 0;
  let o0Count = 0;
  let hardCanaryB0Count = 0;
  let hardCanaryO0Count = 0;
  let forbiddenCanaryB0Count = 0;
  let forbiddenCanaryO0Count = 0;
  let securityCollisionCanaryB0Count = 0;
  let securityCollisionCanaryO0Count = 0;

  for (const sourceEntry of universe.sources) {
    const source = prepareSource(sourceEntry, dependencyIndex);
    const identityBytes = canonicalJson(sourceEntry.identity);
    sourceUniverseHash.update(identityBytes);
    sourceUniverseHash.update("\n");
    const bitset = new Uint8Array(Math.ceil(actorProfiles.length / 8));
    const perRegister = registerCounts[sourceEntry.identity.register];
    perRegister.sourceCount += 1;
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index];
      if (actor === undefined) fail("actor profile iteration underflow");
      const decision = classify(
        source,
        actor,
        programs.roleSets,
        programs.registerPredicates,
        programs.baselineNarrowing,
      );
      if (decision.b0) {
        const byteIndex = Math.floor(index / 8);
        const current = bitset[byteIndex];
        if (current === undefined) fail("classification bitset underflow");
        bitset[byteIndex] = current | (1 << (index % 8));
        b0Count += 1;
        b0ByProfile[index] = (b0ByProfile[index] ?? 0) + 1;
        perRegister.b0Count += 1;
        if (sourceEntry.hardCanary) hardCanaryB0Count += 1;
        if (sourceEntry.hardCanaryKind === "forbidden_canary") {
          forbiddenCanaryB0Count += 1;
        }
        if (sourceEntry.hardCanaryKind === "security_collision_canary") {
          securityCollisionCanaryB0Count += 1;
        }
      } else {
        o0Count += 1;
        o0ByProfile[index] = (o0ByProfile[index] ?? 0) + 1;
        perRegister.o0Count += 1;
        if (sourceEntry.hardCanary) hardCanaryO0Count += 1;
        if (sourceEntry.hardCanaryKind === "forbidden_canary") {
          forbiddenCanaryO0Count += 1;
        }
        if (sourceEntry.hardCanaryKind === "security_collision_canary") {
          securityCollisionCanaryO0Count += 1;
        }
      }
    }
    partitionHash.update(identityBytes);
    partitionHash.update("\0");
    partitionHash.update(bitset);
    partitionHash.update("\n");
    if (sourceEntry.hardCanary) {
      hardCanaryHash.update(identityBytes);
      hardCanaryHash.update("\0");
      hardCanaryHash.update(bitset);
      hardCanaryHash.update("\n");
    }
    if (sourceEntry.hardCanaryKind === "forbidden_canary") {
      forbiddenCanaryHash.update(identityBytes);
      forbiddenCanaryHash.update("\0");
      forbiddenCanaryHash.update(bitset);
      forbiddenCanaryHash.update("\n");
    }
    if (sourceEntry.hardCanaryKind === "security_collision_canary") {
      securityCollisionCanaryHash.update(identityBytes);
      securityCollisionCanaryHash.update("\0");
      securityCollisionCanaryHash.update(bitset);
      securityCollisionCanaryHash.update("\n");
    }
  }

  const classificationCount = 100_037 * 140;
  exact(
    b0Count + o0Count,
    classificationCount,
    "bounded classification partition count",
  );
  for (let index = 0; index < actorProfiles.length; index += 1) {
    exact(
      (b0ByProfile[index] ?? 0) + (o0ByProfile[index] ?? 0),
      100_037,
      `actor profile partition ${actorProfiles[index]?.actorProfileId}`,
    );
  }
  for (const register of REGISTERS) {
    const counts = registerCounts[register];
    exact(
      counts.b0Count + counts.o0Count,
      counts.sourceCount * 140,
      `${register} partition count`,
    );
  }
  exact(
    hardCanaryB0Count + hardCanaryO0Count,
    37 * 140,
    "hard canary classification partition count",
  );
  exact(
    forbiddenCanaryB0Count + forbiddenCanaryO0Count,
    27 * 140,
    "forbidden canary classification partition count",
  );
  exact(
    securityCollisionCanaryB0Count + securityCollisionCanaryO0Count,
    10 * 140,
    "security collision canary classification partition count",
  );
  const perProfileCounts = actorProfiles.map((profile, index) => ({
    actorProfileId: profile.actorProfileId,
    b0Count: b0ByProfile[index] ?? 0,
    o0Count: o0ByProfile[index] ?? 0,
  }));
  const perRegisterCountRows = REGISTERS.map((register) => ({
    register,
    ...registerCounts[register],
  }));

  const manifestInputs: H1BoundedCorpusManifestInputs = Object.freeze({
    schemaVersion: 1,
    artifactKind: "hearth-search-h1-bounded-classification-receipt",
    measurementStatus: "NOT_YET_MEASURED",
    baselineMeaning: "dae27a4-drift-baseline-only",
    sourceCount: 100_037,
    actorProfileCount: 140,
    classificationCount: 14_005_180,
    b0Count,
    o0Count,
    intersectionCount: 0,
    unclassifiedCount: 0,
    hardCanarySourceCount: 37,
    hardCanaryClassificationCount: 5_180,
    hardCanaryB0Count,
    hardCanaryO0Count,
    forbiddenCanarySourceCount: 27,
    forbiddenCanaryClassificationCount: 3_780,
    forbiddenCanaryB0Count,
    forbiddenCanaryO0Count,
    securityCollisionCanarySourceCount: 10,
    securityCollisionCanaryClassificationCount: 1_400,
    securityCollisionCanaryB0Count,
    securityCollisionCanaryO0Count,
    inputHashes: Object.freeze({
      fixtureSha256: canonicalSha256(fixture),
      driftBaselineSha256: canonicalSha256(driftBaseline),
      authoritativePredicatesSha256: canonicalSha256(predicates),
      actorClassesSha256: canonicalSha256(actorClasses),
      corpusPlanSha256: inputs.corpusPlan.manifestSha256,
      actorMatrixPlanSha256: inputs.actorMatrixPlan.manifestSha256,
      bulkRowsSha256: inputs.bulkMaterialization.rowsCanonicalSha256,
    }),
    sourceUniverseSha256: sourceUniverseHash.digest("hex"),
    b0O0PartitionSha256: partitionHash.digest("hex"),
    hardCanaryPartitionSha256: hardCanaryHash.digest("hex"),
    forbiddenCanaryPartitionSha256: forbiddenCanaryHash.digest("hex"),
    securityCollisionCanaryPartitionSha256:
      securityCollisionCanaryHash.digest("hex"),
    perProfileCountsSha256: canonicalSha256(perProfileCounts),
    perRegisterCountsSha256: canonicalSha256(perRegisterCountRows),
  });
  return Object.freeze({
    measurementStatus: "NOT_YET_MEASURED",
    baselineMeaning: "dae27a4-drift-baseline-only",
    manifestInputs,
    manifestSha256: canonicalSha256(manifestInputs),
  });
}
