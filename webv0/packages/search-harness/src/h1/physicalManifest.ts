import { canonicalSha256 } from "../canonical.js";

export class H1PhysicalManifestError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "H1PhysicalManifestError";
    this.code = code;
  }
}

export interface H1PhysicalManifestIdentity {
  readonly schemaVersion: 3;
  readonly artifactKind: "hearth-003-physical-domain-manifest";
  readonly sourceCommit: "dae27a400868c0c686788ab8e5520690dbf77334";
  readonly postgresVersion: "18.4";
  readonly migrationPinSetSha256: string;
  readonly manifestCanonicalSha256: string;
  readonly allTouchedTables: readonly string[];
  readonly allTouchedTablesSha256: string;
  readonly primaryKeysByTable: Readonly<Record<string, readonly string[]>>;
  readonly primaryKeysByTableSha256: string;
}

export interface H1PhysicalManifestTableAttestation {
  readonly schemaVersion: 1;
  readonly artifactKind: "hearth-search-h1-physical-manifest-table-attestation";
  readonly physicalManifestSha256: string;
  readonly migrationPinSetSha256: string;
  readonly h0TableCount: 29;
  readonly h0TablesSha256: string;
  readonly primaryKeysByTableSha256: string;
}

type JsonObject = Record<string, unknown>;

interface PhysicalManifestState {
  readonly manifestCanonicalSha256: string;
  readonly migrationPinSetSha256: string;
  readonly allTouchedTables: readonly string[];
  readonly allTouchedTablesSha256: string;
  readonly primaryKeysByTable: Readonly<Record<string, readonly string[]>>;
  readonly primaryKeysByTableSha256: string;
}

interface TableAttestationState {
  readonly physicalManifestSha256: string;
  readonly migrationPinSetSha256: string;
  readonly h0Tables: readonly string[];
  readonly h0TablesSha256: string;
  readonly primaryKeysByTableSha256: string;
}

const SAFE_SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const trustedPhysicalManifests = new WeakSet<object>();
const physicalManifestStates = new WeakMap<object, PhysicalManifestState>();
const trustedTableAttestations = new WeakSet<object>();
const tableAttestationStates = new WeakMap<object, TableAttestationState>();

function fail(code: string, detail: string): never {
  throw new H1PhysicalManifestError(code, detail);
}

function asObject(value: unknown, path: string): JsonObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("H1_PHYSICAL_MANIFEST_SHAPE_INVALID", `${path} is not an object`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    fail("H1_PHYSICAL_MANIFEST_SHAPE_INVALID", `${path} is not an array`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail("H1_PHYSICAL_MANIFEST_SHAPE_INVALID", `${path} is not a string`);
  }
  return value;
}

function asSafeIdentifier(value: unknown, path: string): string {
  const identifier = asString(value, path);
  if (!SAFE_SQL_IDENTIFIER.test(identifier)) {
    fail(
      "H1_PHYSICAL_MANIFEST_IDENTIFIER_UNSAFE",
      `${path} is not a safe PostgreSQL identifier`,
    );
  }
  return identifier;
}

function exact(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) {
    fail(
      "H1_PHYSICAL_MANIFEST_IDENTITY_MISMATCH",
      `${path} must equal ${JSON.stringify(expected)}`,
    );
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function immutablePrimaryKeys(
  tables: readonly string[],
  primaryKeys: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  const result = Object.create(null) as Record<string, readonly string[]>;
  for (const table of tables) {
    const columns = primaryKeys.get(table);
    if (columns === undefined) {
      fail(
        "H1_PHYSICAL_MANIFEST_PRIMARY_KEY_MISSING",
        `${table} has no parsed primary key`,
      );
    }
    result[table] = Object.freeze([...columns]);
  }
  return Object.freeze(result);
}

/**
 * Structurally parses the v3 physical manifest identity needed by H1. This
 * parser does not establish provenance by itself: the production caller reads
 * the input only through the externally rooted r6 verified-authority view.
 * Table and primary-key values are derived, never authored in this consumer.
 */
export function parseH1PhysicalManifest(
  input: unknown,
): H1PhysicalManifestIdentity {
  const manifest = asObject(input, "manifest");
  exact(manifest["schemaVersion"], 3, "manifest.schemaVersion");
  exact(
    manifest["artifactKind"],
    "hearth-003-physical-domain-manifest",
    "manifest.artifactKind",
  );
  exact(
    manifest["sourceCommit"],
    "dae27a400868c0c686788ab8e5520690dbf77334",
    "manifest.sourceCommit",
  );
  exact(manifest["postgresVersion"], "18.4", "manifest.postgresVersion");
  const migrationPinSetSha256 = asString(
    manifest["migrationPinSetSha256"],
    "manifest.migrationPinSetSha256",
  );
  if (!SHA256.test(migrationPinSetSha256)) {
    fail(
      "H1_PHYSICAL_MANIFEST_HASH_INVALID",
      "manifest.migrationPinSetSha256 is not lowercase 64-hex",
    );
  }

  const touchedTables = asArray(
    manifest["touchedTables"],
    "manifest.touchedTables",
  );
  if (touchedTables.length !== 29) {
    fail(
      "H1_PHYSICAL_MANIFEST_TABLE_COUNT_INVALID",
      `manifest.touchedTables has ${touchedTables.length} entries, expected 29`,
    );
  }

  const tableNames = new Set<string>();
  const primaryKeys = new Map<string, readonly string[]>();
  for (let tableIndex = 0; tableIndex < touchedTables.length; tableIndex += 1) {
    const tableEntry = asObject(
      touchedTables[tableIndex],
      `manifest.touchedTables[${tableIndex}]`,
    );
    const table = asSafeIdentifier(
      tableEntry["table"],
      `manifest.touchedTables[${tableIndex}].table`,
    );
    if (tableNames.has(table)) {
      fail(
        "H1_PHYSICAL_MANIFEST_TABLE_DUPLICATE",
        `manifest contains duplicate table ${table}`,
      );
    }
    tableNames.add(table);

    const columns = asArray(
      tableEntry["columns"],
      `manifest.touchedTables[${tableIndex}].columns`,
    );
    if (columns.length === 0) {
      fail(
        "H1_PHYSICAL_MANIFEST_COLUMN_SET_INVALID",
        `${table} has no columns`,
      );
    }
    const columnCounts = new Map<string, number>();
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const column = asObject(
        columns[columnIndex],
        `manifest.touchedTables[${tableIndex}].columns[${columnIndex}]`,
      );
      const columnName = asSafeIdentifier(
        column["name"],
        `manifest.touchedTables[${tableIndex}].columns[${columnIndex}].name`,
      );
      const ordinal = column["ordinal"];
      if (!Number.isSafeInteger(ordinal) || ordinal !== columnIndex + 1) {
        fail(
          "H1_PHYSICAL_MANIFEST_COLUMN_ORDER_INVALID",
          `${table}.${columnName} has non-contiguous ordinal ${String(ordinal)}`,
        );
      }
      const count = (columnCounts.get(columnName) ?? 0) + 1;
      columnCounts.set(columnName, count);
      if (count !== 1) {
        fail(
          "H1_PHYSICAL_MANIFEST_COLUMN_DUPLICATE",
          `${table} contains duplicate column ${columnName}`,
        );
      }
    }

    const constraints = asArray(
      tableEntry["constraints"],
      `manifest.touchedTables[${tableIndex}].constraints`,
    );
    const primaryConstraints: JsonObject[] = [];
    for (
      let constraintIndex = 0;
      constraintIndex < constraints.length;
      constraintIndex += 1
    ) {
      const constraint = asObject(
        constraints[constraintIndex],
        `manifest.touchedTables[${tableIndex}].constraints[${constraintIndex}]`,
      );
      asSafeIdentifier(
        constraint["name"],
        `manifest.touchedTables[${tableIndex}].constraints[${constraintIndex}].name`,
      );
      const type = asString(
        constraint["type"],
        `manifest.touchedTables[${tableIndex}].constraints[${constraintIndex}].type`,
      );
      if (type === "p") primaryConstraints.push(constraint);
    }
    if (primaryConstraints.length !== 1) {
      fail(
        "H1_PHYSICAL_MANIFEST_PRIMARY_KEY_COUNT_INVALID",
        `${table} has ${primaryConstraints.length} primary constraints, expected exactly one`,
      );
    }

    const primaryColumns = asArray(
      primaryConstraints[0]?.["columns"],
      `${table}.primaryKey.columns`,
    );
    if (primaryColumns.length === 0) {
      fail(
        "H1_PHYSICAL_MANIFEST_PRIMARY_KEY_EMPTY",
        `${table} primary key has no columns`,
      );
    }
    const seenPrimaryColumns = new Set<string>();
    const orderedPrimaryColumns: string[] = [];
    for (let index = 0; index < primaryColumns.length; index += 1) {
      const primaryColumn = asSafeIdentifier(
        primaryColumns[index],
        `${table}.primaryKey.columns[${index}]`,
      );
      if (seenPrimaryColumns.has(primaryColumn)) {
        fail(
          "H1_PHYSICAL_MANIFEST_PRIMARY_KEY_COLUMN_DUPLICATE",
          `${table} primary key repeats column ${primaryColumn}`,
        );
      }
      seenPrimaryColumns.add(primaryColumn);
      if (columnCounts.get(primaryColumn) !== 1) {
        fail(
          "H1_PHYSICAL_MANIFEST_PRIMARY_KEY_COLUMN_UNKNOWN",
          `${table} primary-key column ${primaryColumn} does not exist exactly once`,
        );
      }
      orderedPrimaryColumns.push(primaryColumn);
    }
    primaryKeys.set(table, Object.freeze(orderedPrimaryColumns));
  }

  const allTouchedTables = Object.freeze([...tableNames].sort(compareText));
  const primaryKeysByTable = immutablePrimaryKeys(
    allTouchedTables,
    primaryKeys,
  );
  const manifestCanonicalSha256 = canonicalSha256(manifest);
  const allTouchedTablesSha256 = canonicalSha256(allTouchedTables);
  const primaryKeysByTableSha256 = canonicalSha256(primaryKeysByTable);
  const identity: H1PhysicalManifestIdentity = Object.freeze({
    schemaVersion: 3,
    artifactKind: "hearth-003-physical-domain-manifest",
    sourceCommit: "dae27a400868c0c686788ab8e5520690dbf77334",
    postgresVersion: "18.4",
    migrationPinSetSha256,
    manifestCanonicalSha256,
    allTouchedTables,
    allTouchedTablesSha256,
    primaryKeysByTable,
    primaryKeysByTableSha256,
  });
  const state: PhysicalManifestState = {
    manifestCanonicalSha256,
    migrationPinSetSha256,
    allTouchedTables,
    allTouchedTablesSha256,
    primaryKeysByTable,
    primaryKeysByTableSha256,
  };
  trustedPhysicalManifests.add(identity);
  physicalManifestStates.set(identity, state);
  return identity;
}

function resolveTrustedManifest(
  identity: H1PhysicalManifestIdentity,
): PhysicalManifestState {
  const state = physicalManifestStates.get(identity);
  if (
    !trustedPhysicalManifests.has(identity) ||
    state === undefined ||
    identity.manifestCanonicalSha256 !== state.manifestCanonicalSha256 ||
    identity.migrationPinSetSha256 !== state.migrationPinSetSha256 ||
    identity.allTouchedTablesSha256 !== state.allTouchedTablesSha256 ||
    identity.primaryKeysByTableSha256 !== state.primaryKeysByTableSha256 ||
    canonicalSha256(identity.allTouchedTables) !==
      state.allTouchedTablesSha256 ||
    canonicalSha256(identity.primaryKeysByTable) !==
      state.primaryKeysByTableSha256
  ) {
    fail(
      "H1_PHYSICAL_MANIFEST_IDENTITY_FORGED",
      "physical manifest identity was not produced by this parser",
    );
  }
  return state;
}

/**
 * Reconciles the independently derived seedable-table union against every
 * touched table in the physical manifest. Either-direction drift is fatal.
 */
export function reconcileH1PhysicalManifestTables(
  identity: H1PhysicalManifestIdentity,
  authoritySeedableTables: readonly string[],
): H1PhysicalManifestTableAttestation {
  const state = resolveTrustedManifest(identity);
  const supplied = asArray(
    authoritySeedableTables,
    "authoritySeedableTables",
  ).map((table, index) =>
    asSafeIdentifier(table, `authoritySeedableTables[${index}]`),
  );
  if (new Set(supplied).size !== supplied.length) {
    fail(
      "H1_PHYSICAL_MANIFEST_RECONCILIATION_DUPLICATE",
      "authoritySeedableTables contains duplicate tables",
    );
  }
  const suppliedSet = new Set(supplied);
  const manifestSet = new Set(state.allTouchedTables);
  const missingFromAuthority = state.allTouchedTables.filter(
    (table) => !suppliedSet.has(table),
  );
  const missingFromManifest = supplied
    .filter((table) => !manifestSet.has(table))
    .sort(compareText);
  if (missingFromAuthority.length > 0 || missingFromManifest.length > 0) {
    fail(
      "H1_PHYSICAL_MANIFEST_RECONCILIATION_MISMATCH",
      `missing from authority=[${missingFromAuthority.join(",")}]; missing from manifest=[${missingFromManifest.join(",")}]`,
    );
  }

  const h0Tables = Object.freeze([...state.allTouchedTables]);
  const h0TablesSha256 = canonicalSha256(h0Tables);
  const attestation: H1PhysicalManifestTableAttestation = Object.freeze({
    schemaVersion: 1,
    artifactKind: "hearth-search-h1-physical-manifest-table-attestation",
    physicalManifestSha256: state.manifestCanonicalSha256,
    migrationPinSetSha256: state.migrationPinSetSha256,
    h0TableCount: 29,
    h0TablesSha256,
    primaryKeysByTableSha256: state.primaryKeysByTableSha256,
  });
  trustedTableAttestations.add(attestation);
  tableAttestationStates.set(attestation, {
    physicalManifestSha256: state.manifestCanonicalSha256,
    migrationPinSetSha256: state.migrationPinSetSha256,
    h0Tables,
    h0TablesSha256,
    primaryKeysByTableSha256: state.primaryKeysByTableSha256,
  });
  return attestation;
}

/**
 * Resolves a fresh frozen copy of all 29 H0 emptiness tables. Structural
 * lookalikes are rejected even when every public field is copied exactly.
 */
export function resolveH1H0EmptinessTableSet(
  attestation: H1PhysicalManifestTableAttestation,
): readonly string[] {
  const state = tableAttestationStates.get(attestation);
  if (
    !trustedTableAttestations.has(attestation) ||
    state === undefined ||
    attestation.physicalManifestSha256 !== state.physicalManifestSha256 ||
    attestation.migrationPinSetSha256 !== state.migrationPinSetSha256 ||
    attestation.h0TableCount !== state.h0Tables.length ||
    attestation.h0TablesSha256 !== state.h0TablesSha256 ||
    attestation.primaryKeysByTableSha256 !== state.primaryKeysByTableSha256 ||
    canonicalSha256(state.h0Tables) !== state.h0TablesSha256
  ) {
    fail(
      "H1_PHYSICAL_MANIFEST_ATTESTATION_FORGED",
      "table attestation was not produced by the reconciliation factory",
    );
  }
  return Object.freeze([...state.h0Tables]);
}
