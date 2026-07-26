#!/usr/bin/env node
/**
 * HEARTH-003 physical-domain validator
 *
 * Authority boundary:
 *   - the gold author supplies a complete, literal physicalSeedPlan;
 *   - this program proves that plan against the exact, pinned C3 migrations in
 *     a disposable PostgreSQL 18.4 instance;
 *   - it never derives truth from the current search result set.
 *
 * The validator deliberately uses C3's own startTestDatabase(), which applies
 * all migrations from an empty database.  pg_catalog is therefore the parser
 * for CHECK domains, FK targets, NOT NULL, PostgreSQL types, partial UNIQUE
 * indexes, constraint triggers, and RLS.  Static checks run first so obvious
 * contract mistakes have precise failures; PostgreSQL remains the final
 * authority.
 */

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  parseProjectionAuthoritySource,
  runProjectionAuthorityParserSelfTests,
  type ProjectionAuthorityParseResult,
  type ProjectionAuthoritySpec,
} from './HEARTH-003-projection-authority-parser.ts';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };

interface MigrationPin {
  readonly path: string;
  readonly sha256: string;
  readonly gitBlobSha: string;
}

interface ProjectionAuthorityPin extends MigrationPin {}

interface DelegationAuthorityPin {
  readonly artifact: string;
  readonly actorClassVersion: string;
  readonly canonicalTextSha256: string;
}

interface DelegationMeasurementAuthorityPin {
  readonly artifact: string;
  readonly measurementVersion: string;
  readonly canonicalTextSha256: string;
}

interface DelegationStateAuthority {
  readonly rowExists: boolean;
  readonly granteeRelation: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly revokedAt: string | null;
  readonly effectiveAtFrozenDate: boolean;
}

interface DelegationActorClassAuthority {
  readonly schemaVersion: number;
  readonly actorClassVersion: string;
  readonly frozenAsOfDate: string;
  readonly roles: readonly string[];
  readonly delegationStates: Readonly<Record<string, DelegationStateAuthority>>;
}

interface DelegationMeasurementCorpusProfile {
  readonly corpusProfileId: string;
  readonly delegationState: 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
  readonly frozenAsOfDate: string;
  readonly basePlanVersion: string;
  readonly baseAuthorityRowCount: number;
  readonly delegationRowCount: number;
  readonly expectedAuthorityRowCount: number;
  readonly exactDelegationRowIds: readonly string[];
  readonly rows: readonly SeedRow[];
}

interface ActorStateMeasurementProfile {
  readonly corpusProfileId: string;
  readonly stateComposition: {
    readonly entitlementState: string;
    readonly delegationState: string;
    readonly participantState: string;
  };
  readonly basePlanVersion?: string;
  readonly baseAuthorityRowCount?: number;
  readonly deltaRowCount?: number;
  readonly expectedAuthorityRowCount?: number;
  readonly exactDeltaRowIds?: readonly string[];
  readonly rows?: readonly SeedRow[];
  readonly aliasRule?: string;
}

interface MeasurementActorProfile {
  readonly actorProfileId: string;
  readonly tenantSlot: string;
  readonly role: string;
  readonly entitlementState: string;
  readonly delegationState: string;
  readonly participantState: string;
  readonly corpusProfileId: string;
  readonly actorUserRowId: string;
  readonly actorUserId: string;
  readonly actorIdentity: string;
}

interface NonDelegationLogicalAssignment {
  readonly assignmentId: string;
  readonly queryCaseId: string;
  readonly fixtureScenarioId: string;
  readonly queryClass: string;
  readonly query: string;
  readonly actorClass: string;
  readonly targetTenantSlot: string;
  readonly expectedExpansionCount: number;
  readonly observationIds: readonly string[];
  readonly authoritativeRelevant: readonly {
    readonly source: FixtureSource;
    readonly rankGroup: number;
  }[];
  readonly approvedSearchRelevantJudgments: readonly {
    readonly source: FixtureSource;
    readonly rankGroup: number;
  }[];
  readonly parityGapSources: readonly {
    readonly source: FixtureSource;
    readonly rankGroup: number;
  }[];
  readonly forbiddenSources: readonly FixtureSource[];
  readonly disclosureEnvelopeRule: string;
}

interface NonDelegationConcreteObservation extends MeasurementActorProfile {
  readonly observationId: string;
  readonly assignmentId: string;
  readonly queryCaseId: string;
  readonly fixtureScenarioId: string;
  readonly actorClass: string;
  readonly targetTenantSlot: string;
}

interface DelegationMeasurementBinding {
  readonly bindingId: string;
  readonly logicalAssignmentId: string;
  readonly queryCaseId: string;
  readonly fixtureScenarioId: string;
  readonly actorClass: string;
  readonly tenantSlot: string;
  readonly role: string;
  readonly delegationState: string;
  readonly corpusProfileId: string;
  readonly actorProfileId: string;
  readonly actorUserRowId: string;
  readonly actorUserId: string;
  readonly actorIdentity: string;
  readonly delegationRowId: string | null;
  readonly pairKey: string;
  readonly authoritativeApprovalReadExpected: boolean;
  readonly approvedSearchApprovalDomainExpected: boolean;
  readonly authoritativeRelevant: readonly {
    readonly source: FixtureSource;
    readonly rankGroup: number;
  }[];
  readonly approvedSearchRelevantJudgments: readonly {
    readonly source: FixtureSource;
    readonly rankGroup: number;
  }[];
  readonly parityGapSources: readonly {
    readonly source: FixtureSource;
    readonly rankGroup: number;
  }[];
  readonly forbiddenSources: readonly FixtureSource[];
}

interface DelegationMeasurementAuthority {
  readonly schemaVersion: number;
  readonly artifactKind: string;
  readonly measurementVersion: string;
  readonly syntheticOnly: true;
  readonly actorClassArtifact: string;
  readonly frozenAsOfDate: string;
  readonly corpusProfilesAreMutuallyExclusive: boolean;
  readonly corpusProfiles: readonly DelegationMeasurementCorpusProfile[];
  readonly h4AcceptanceProfileSuite: {
    readonly compositionRule: string;
    readonly profileExecutionIds: readonly string[];
    readonly entitlementProfiles: readonly ActorStateMeasurementProfile[];
    readonly participantProfiles: readonly ActorStateMeasurementProfile[];
    readonly baseCartesianActorProfiles: readonly MeasurementActorProfile[];
    readonly participantActorProfiles: readonly MeasurementActorProfile[];
    readonly completeRunRule: string;
    readonly absentStateRule: string;
  };
  readonly actorProfileCatalog: readonly MeasurementActorProfile[];
  readonly nonDelegationLogicalAssignments:
    readonly NonDelegationLogicalAssignment[];
  readonly nonDelegationConcreteObservations:
    readonly NonDelegationConcreteObservation[];
  readonly observationExpansionRule: JsonObject;
  readonly logicalAssignments: readonly {
    readonly assignmentId: string;
    readonly queryCaseId: string;
    readonly fixtureScenarioId: string;
    readonly actorClass: string;
    readonly tenantSlot: string;
    readonly expectedExpansionCount: number;
    readonly concreteBindingIds: readonly string[];
  }[];
  readonly concreteBindings: readonly DelegationMeasurementBinding[];
  readonly pairEdges: readonly {
    readonly pairEdgeId: string;
    readonly queryCaseId: string;
    readonly fixtureScenarioId: string;
    readonly tenantSlot: string;
    readonly role: string;
    readonly activeBindingId: string;
    readonly inactiveBindingId: string;
  }[];
  readonly noEffectControls: readonly JsonObject[];
  readonly clockContract: JsonObject;
}

interface ApprovedProjection {
  readonly kind: string;
  readonly id: string;
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly parentId: string | null;
}

interface SeedSource {
  readonly fixtureId?: string;
  readonly supportingRowId?: string;
  readonly register?: string;
  readonly recordId?: string;
  readonly recordKind?: string | null;
  readonly note?: string;
}

interface SeedRow {
  readonly rowId: string;
  readonly phase: number;
  readonly table: string;
  readonly tenantSlot: string | null;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly source?: SeedSource;
  readonly approvedProjection?: ApprovedProjection;
}

interface OverlayScenario {
  readonly scenarioId: string;
  readonly description?: string;
  readonly expected: 'accept' | 'reject';
  readonly expectedSqlState?: string | readonly string[];
  readonly expectedConstraint?: string | readonly string[];
  readonly removeRowIds?: readonly string[];
  readonly rows?: readonly SeedRow[];
  readonly authorityState?: {
    readonly kind: 'delegation';
    readonly state: 'D1' | 'D2' | 'D3' | 'D4';
    readonly tenantSlot: string;
    readonly role: string;
    readonly actorUserId: string;
    readonly actorIdentity: string;
    readonly actorProfileId: string;
    readonly frozenAsOfDate: string;
    readonly expectedHasActiveDelegation: boolean;
  };
}

interface PhysicalSeedPlan {
  readonly schemaVersion: number;
  readonly planVersion: string;
  readonly syntheticOnly: true;
  readonly sourceCommit: string;
  readonly migrationDirectory: string;
  readonly migrationFiles: readonly MigrationPin[];
  readonly projectionAuthoritySource: ProjectionAuthorityPin;
  readonly delegationAuthoritySource: DelegationAuthorityPin;
  readonly delegationMeasurementAuthoritySource: DelegationMeasurementAuthorityPin;
  readonly tenantIds: Readonly<Record<string, string>>;
  readonly rows: readonly SeedRow[];
  readonly overlayScenarios: readonly OverlayScenario[];
}

interface FixtureSource {
  readonly tenantSlot: string;
  readonly register: string;
  readonly recordId: string;
  readonly recordKind?: string | null;
}

interface ContractFixture {
  readonly fixtureId: string;
  readonly scenarioId: string;
  readonly source: FixtureSource;
  readonly approvedProjection: ApprovedProjection;
  readonly target: {
    readonly physicalField: string | null;
    readonly fieldClass: string;
    readonly editKind: string | null;
    readonly query: string;
  };
  readonly rowFacts: {
    readonly active?: boolean;
    readonly submittedByRelation?: string;
    readonly ownerType?: string;
  };
}

interface FixtureContract {
  readonly schemaVersion: number;
  readonly artifactKind: string;
  readonly fixtureVersion: string;
  readonly syntheticOnly: boolean;
  readonly fixtures: readonly ContractFixture[];
  readonly delegationMeasurementAuthority: DelegationMeasurementAuthorityPin;
  readonly physicalSeedPlan: PhysicalSeedPlan;
}

interface Cli {
  readonly repo: string;
  readonly contract: string;
  readonly qrels?: string;
  readonly manifest: string;
  readonly report: string;
}

interface CatalogColumn {
  readonly name: string;
  readonly ordinal: number;
  readonly dataType: string;
  readonly typeSchema: string;
  readonly typeName: string;
  readonly typeKind: string;
  readonly typeCategory: string;
  readonly notNull: boolean;
  readonly defaultExpression: string | null;
  readonly identity: string | null;
  readonly generated: string | null;
  readonly collation: string | null;
  readonly enumValues: readonly string[];
}

interface CatalogConstraint {
  readonly name: string;
  readonly type: string;
  readonly columns: readonly string[];
  readonly definition: string;
  readonly deferrable: boolean;
  readonly initiallyDeferred: boolean;
  readonly validated: boolean;
  readonly referencedTable: string | null;
  readonly referencedColumns: readonly string[];
}

interface CatalogIndex {
  readonly name: string;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly valid: boolean;
  readonly ready: boolean;
  readonly definition: string;
  readonly predicate: string | null;
}

interface CatalogTrigger {
  readonly name: string;
  readonly enabled: string;
  readonly definition: string;
  readonly function: string;
}

interface CatalogPolicy {
  readonly name: string;
  readonly permissive: string;
  readonly roles: readonly string[];
  readonly command: string;
  readonly using: string | null;
  readonly withCheck: string | null;
}

interface CatalogTable {
  readonly table: string;
  readonly rowLevelSecurity: boolean;
  readonly forceRowLevelSecurity: boolean;
  readonly columns: readonly CatalogColumn[];
  readonly constraints: readonly CatalogConstraint[];
  readonly indexes: readonly CatalogIndex[];
  readonly triggers: readonly CatalogTrigger[];
  readonly policies: readonly CatalogPolicy[];
}

interface CatalogFunction {
  readonly schema: string;
  readonly name: string;
  readonly identityArguments: string;
  readonly resultType: string;
  readonly language: string;
  readonly volatility: string;
  readonly parallelSafety: string;
  readonly securityDefiner: boolean;
  readonly leakproof: boolean;
  readonly configuration: readonly string[];
  readonly definitionSha256: string;
}

interface SchemaManifest {
  readonly schemaVersion: 3;
  readonly artifactKind: 'hearth-003-physical-domain-manifest';
  readonly sourceCommit: string;
  readonly postgresVersion: string;
  readonly migrationPinSetSha256: string;
  readonly projectionAuthoritySource: ProjectionAuthorityPin;
  readonly delegationAuthoritySource: DelegationAuthorityPin;
  readonly delegationMeasurementAuthoritySource: DelegationMeasurementAuthorityPin;
  readonly projectionAuthorityDerivation: {
    readonly parserPackageVersion: string;
    readonly projectionParserSourceSha256: string;
    readonly projectionAuthorityBlobSha256: string;
    readonly projectionSemanticSha256: string;
    readonly guardSemanticSha256: string;
    readonly combinedAuthoritySha256: string;
    readonly registerCount: number;
    readonly staticGuardRegisters: readonly string[];
    readonly guardProgram: ProjectionAuthorityParseResult['guardProgram'];
  };
  readonly touchedTables: readonly CatalogTable[];
  readonly publicFunctions: readonly CatalogFunction[];
}

interface CheckResult {
  readonly check: string;
  readonly status: 'PASS';
  readonly count?: number;
  readonly detail?: string;
}

interface RejectEvidence {
  readonly mutation: string;
  readonly sqlState: string;
  readonly constraint: string | null;
  readonly signal: string;
}

interface ValidationReport {
  readonly schemaVersion: 3;
  readonly artifactKind: 'hearth-003-physical-domain-validation-report';
  readonly outcome: 'PASS';
  readonly authority: 'Apex Lumen';
  readonly sourceCommit: string;
  readonly inputHashes: {
    readonly contractSha256: string;
    readonly qrelsSha256: string | null;
    readonly physicalSeedPlanSha256: string;
    readonly schemaManifestSha256: string;
    readonly validatorSourceSha256: string;
    readonly projectionParserSourceSha256: string;
    readonly projectionAuthorityBlobSha256: string;
    readonly projectionSemanticSha256: string;
    readonly guardSemanticSha256: string;
    readonly combinedAuthoritySha256: string;
    readonly delegationAuthoritySha256: string;
    readonly delegationMeasurementAuthoritySha256: string;
  };
  readonly checks: readonly CheckResult[];
  readonly negativeMutationEvidence: readonly RejectEvidence[];
}

interface FailureReport {
  readonly schemaVersion: 3;
  readonly artifactKind: 'hearth-003-physical-domain-validation-report';
  readonly outcome: 'FAIL';
  readonly authority: 'Apex Lumen';
  readonly inputHashes: {
    readonly contractSha256: string | null;
    readonly qrelsSha256: string | null;
    readonly validatorSourceSha256: string;
    readonly projectionParserSourceSha256: string;
  };
  readonly failure: {
    readonly name: string;
    readonly message: string;
  };
}

interface PgErrorShape extends Error {
  readonly code?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: string;
}

interface QueryResultLike {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

interface PgClientLike {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string, values?: readonly unknown[]): Promise<QueryResultLike>;
}

interface TestDatabaseLike {
  readonly adminUrl: string;
  readonly appUrl: string;
  readonly authUrl: string;
  stop(): Promise<void>;
}

class ValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40,64}$/;
const FULL_COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_TEXT_TYPES = new Set([
  'text',
  'character varying',
  'character',
  'name',
  'citext',
  'inet',
  'cidr',
  'macaddr',
  'time without time zone',
  'time with time zone',
  'interval',
]);
const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint']);
const NUMBER_TYPES = new Set(['numeric', 'real', 'double precision', 'money']);
const TIMESTAMP_TYPES = new Set(['timestamp with time zone', 'timestamp without time zone']);

function fail(message: string): never {
  throw new ValidationError(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const strictUtf8Decoder = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

function decodeStrictUtf8(bytes: Buffer, label: string): string {
  try {
    return strictUtf8Decoder.decode(bytes);
  } catch {
    fail(`${label} is not strict UTF-8`);
  }
}

function canonicalTextBytes(bytes: Buffer, label: string): Buffer {
  decodeStrictUtf8(bytes, label);
  assert(!bytes.includes(0), `${label} contains NUL`);
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] === 0x0a) index += 1;
      output.push(0x0a);
    } else {
      output.push(bytes[index]!);
    }
  }
  return Buffer.from(output);
}

function sha256CanonicalText(bytes: string | Buffer, label: string): string {
  return sha256(
    canonicalTextBytes(
      typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes,
      label,
    ),
  );
}

function canonicalTextEquals(left: Buffer, right: Buffer, label: string): boolean {
  return canonicalTextBytes(left, `${label} left`).equals(
    canonicalTextBytes(right, `${label} right`),
  );
}

function assertTextHashEolPortability(): void {
  const lf = Buffer.from('alpha  \nbeta\n', 'utf8');
  const expected = sha256CanonicalText(lf, 'hash portability LF control');
  for (const candidate of [
    Buffer.from('alpha  \r\nbeta\r\n', 'utf8'),
    Buffer.from('alpha  \rbeta\r', 'utf8'),
  ]) {
    assert(
      sha256CanonicalText(candidate, 'hash portability EOL variant') === expected,
      'canonical text hash is not LF/CRLF/lone-CR portable',
    );
  }
  for (const mutation of [
    Buffer.from('alpha \nbeta\n', 'utf8'),
    Buffer.from('alpha  \nbeta', 'utf8'),
    Buffer.from('alpha  \nBeta\n', 'utf8'),
  ]) {
    assert(
      sha256CanonicalText(mutation, 'hash portability RED mutation') !== expected,
      'canonical text hash ignored a substantive mutation',
    );
  }
}

assertTextHashEolPortability();

const VALIDATOR_SOURCE_SHA256 = sha256CanonicalText(
  readFileSync(fileURLToPath(import.meta.url)),
  'validator source',
);
const PROJECTION_PARSER_SOURCE_SHA256 = sha256CanonicalText(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'HEARTH-003-projection-authority-parser.ts',
    ),
  ),
  'projection authority parser source',
);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = canonicalize(input[key]);
    return output;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function stablePrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJsonFile<T>(path: string, label: string): { readonly bytes: Buffer; readonly value: T } {
  assert(existsSync(path), `${label} does not exist`);
  const bytes = readFileSync(path);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${label} is not valid UTF-8 JSON`);
  }
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  return { bytes, value: value as T };
}

function absolute(path: string): string {
  return resolve(path);
}

function parseCli(argv: readonly string[]): Cli {
  const accepted = new Set(['--repo', '--contract', '--qrels', '--manifest', '--report']);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(key !== undefined && accepted.has(key), `unknown or misplaced argument ${key ?? '<missing>'}`);
    assert(value !== undefined && !value.startsWith('--'), `${key} requires a value`);
    assert(!values.has(key), `${key} supplied more than once`);
    values.set(key, value);
  }
  for (const required of ['--repo', '--contract', '--manifest', '--report']) {
    assert(values.has(required), `missing required argument ${required}`);
  }
  const cli: Cli = {
    repo: absolute(values.get('--repo')!),
    contract: absolute(values.get('--contract')!),
    manifest: absolute(values.get('--manifest')!),
    report: absolute(values.get('--report')!),
    ...(values.has('--qrels') ? { qrels: absolute(values.get('--qrels')!) } : {}),
  };
  assert(cli.contract !== cli.manifest && cli.contract !== cli.report, 'outputs must not overwrite the contract');
  assert(cli.manifest !== cli.report, '--manifest and --report must be different paths');
  if (cli.qrels) assert(cli.qrels !== cli.manifest && cli.qrels !== cli.report, 'outputs must not overwrite qrels');
  return cli;
}

function quoteIdentifier(value: string): string {
  assert(SIMPLE_IDENTIFIER.test(value), `unsafe or unsupported SQL identifier ${JSON.stringify(value)}`);
  return `"${value}"`;
}

function repoPath(repo: string, path: string): string {
  assert(!isAbsolute(path), `pinned source path must be repository-relative: ${path}`);
  const normalized = path.replaceAll('\\', '/');
  assert(!normalized.split('/').includes('..'), `pinned source path escapes repository: ${path}`);
  const full = resolve(repo, ...normalized.split('/'));
  const rel = relative(repo, full);
  assert(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `pinned source path escapes repository: ${path}`);
  return full;
}

function git(repo: string, args: readonly string[], encoding: 'utf8' | 'buffer' = 'utf8'): string | Buffer {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: encoding === 'utf8' ? 'utf8' : 'buffer',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fail(`git verification failed for ${args[0] ?? '<missing-command>'}`);
  }
}

function validatePinShape(pin: MigrationPin, label: string): void {
  assert(pin !== null && typeof pin === 'object', `${label} must be an object`);
  assert(typeof pin.path === 'string' && pin.path.length > 0, `${label}.path must be non-empty`);
  assert(typeof pin.sha256 === 'string' && SHA256.test(pin.sha256), `${label}.sha256 must be lowercase SHA-256`);
  assert(typeof pin.gitBlobSha === 'string' && GIT_OBJECT.test(pin.gitBlobSha), `${label}.gitBlobSha must be a Git object id`);
}

function verifyPinnedFile(
  repo: string,
  commit: string,
  pin: MigrationPin,
  label: string,
): Buffer {
  validatePinShape(pin, label);
  const path = pin.path.replaceAll('\\', '/');
  const full = repoPath(repo, path);
  assert(existsSync(full), `${label} working file is missing`);
  const blobSha = String(git(repo, ['rev-parse', `${commit}:${path}`])).trim().toLowerCase();
  assert(blobSha === pin.gitBlobSha, `${label} Git blob does not match its declared pin`);
  const blob = git(repo, ['cat-file', 'blob', blobSha], 'buffer') as Buffer;
  assert(
    sha256CanonicalText(blob, `${label} Git blob`) === pin.sha256,
    `${label} SHA-256 does not match the pinned Git blob`,
  );
  const working = readFileSync(full);
  assert(
    canonicalTextEquals(working, blob, label),
    `${label} working text differs from the pinned Git blob`,
  );
  return blob;
}

function verifySourcePins(repo: string, plan: PhysicalSeedPlan): {
  readonly migrationPinSetSha256: string;
  readonly projectionAuthorityBytes: Buffer;
} {
  assert(FULL_COMMIT.test(plan.sourceCommit), 'physicalSeedPlan.sourceCommit must be a full lowercase 40-character commit');
  const resolvedCommit = String(git(repo, ['rev-parse', `${plan.sourceCommit}^{commit}`])).trim().toLowerCase();
  assert(resolvedCommit === plan.sourceCommit, 'physicalSeedPlan.sourceCommit does not resolve to itself');
  assert(typeof plan.migrationDirectory === 'string' && plan.migrationDirectory.length > 0, 'migrationDirectory is required');
  assert(Array.isArray(plan.migrationFiles), 'migrationFiles must be an array');
  assert(plan.migrationFiles.length === 95, `migrationFiles must pin exactly 95 files, found ${plan.migrationFiles.length}`);

  const directory = plan.migrationDirectory.replaceAll('\\', '/').replace(/\/+$/, '');
  assert(directory === 'webv0/packages/persistence/migrations', 'migrationDirectory must name C3 persistence migrations');
  const gitPaths = String(git(repo, ['ls-tree', '-r', '--name-only', plan.sourceCommit, '--', directory]))
    .split(/\r?\n/)
    .filter((path) => path.endsWith('.sql'))
    .sort();
  assert(gitPaths.length === 95, `pinned commit must contain exactly 95 ordered SQL migrations, found ${gitPaths.length}`);

  const declaredPaths = plan.migrationFiles.map((pin) => pin.path.replaceAll('\\', '/'));
  assert(new Set(declaredPaths).size === declaredPaths.length, 'migrationFiles contains duplicate paths');
  assert(
    JSON.stringify(declaredPaths) === JSON.stringify([...declaredPaths].sort()),
    'migrationFiles must be ordered lexically',
  );
  assert(JSON.stringify(declaredPaths) === JSON.stringify(gitPaths), 'migrationFiles is not the complete pinned migration set');
  for (let index = 0; index < plan.migrationFiles.length; index += 1) {
    const expectedPrefix = String(index + 1).padStart(4, '0');
    const fileName = declaredPaths[index]!.split('/').at(-1)!;
    assert(fileName.startsWith(`${expectedPrefix}_`), `migration ordinal ${index + 1} is not ${expectedPrefix}_*.sql`);
    verifyPinnedFile(repo, plan.sourceCommit, plan.migrationFiles[index]!, `migrationFiles[${index}]`);
  }

  assert(plan.projectionAuthoritySource !== undefined, 'projectionAuthoritySource is required');
  assert(
    plan.projectionAuthoritySource.path.replaceAll('\\', '/') === 'webv0/packages/persistence/src/searchSql.ts',
    'projectionAuthoritySource must pin searchSql.ts',
  );
  const projectionAuthorityBytes = verifyPinnedFile(
    repo,
    plan.sourceCommit,
    plan.projectionAuthoritySource,
    'projectionAuthoritySource',
  );

  return {
    migrationPinSetSha256: sha256(canonicalJson(plan.migrationFiles)),
    projectionAuthorityBytes,
  };
}

function verifyDelegationAuthority(
  contractPath: string,
  pin: DelegationAuthorityPin,
): DelegationActorClassAuthority {
  assert(
    pin.artifact === 'HEARTH-003-ACTOR-CLASSES-v2.json',
    'delegation authority artifact name is not frozen actor-classes v2',
  );
  const path = join(dirname(contractPath), pin.artifact);
  assert(existsSync(path), 'delegation actor-class authority artifact is missing');
  const bytes = readFileSync(path);
  assert(
    sha256CanonicalText(bytes, pin.artifact) === pin.canonicalTextSha256,
    'delegation actor-class authority hash differs from the physical plan pin',
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeStrictUtf8(bytes, pin.artifact));
  } catch {
    fail('delegation actor-class authority is not valid UTF-8 JSON');
  }
  const authority = parsed as DelegationActorClassAuthority;
  const roles = [
    'owner',
    'operations',
    'legal',
    'finance',
    'hr',
    'management',
    'visitor',
  ];
  assert(
    authority.schemaVersion === 1 &&
      authority.actorClassVersion === pin.actorClassVersion &&
      authority.frozenAsOfDate === '2035-06-15' &&
      valuesAreEqual(authority.roles, roles),
    'delegation actor-class authority envelope diverges',
  );
  const expectedStates = {
    D1: {
      rowExists: true,
      granteeRelation: 'actor_identity_after_normalization',
      startsOn: '2035-06-01',
      endsOn: '2035-06-30',
      revokedAt: null,
      effectiveAtFrozenDate: true,
    },
    D2: {
      rowExists: true,
      granteeRelation: 'actor_identity_after_normalization',
      startsOn: '2035-07-01',
      endsOn: '2035-07-31',
      revokedAt: null,
      effectiveAtFrozenDate: false,
    },
    D3: {
      rowExists: true,
      granteeRelation: 'actor_identity_after_normalization',
      startsOn: '2035-05-01',
      endsOn: '2035-05-31',
      revokedAt: null,
      effectiveAtFrozenDate: false,
    },
    D4: {
      rowExists: true,
      granteeRelation: 'actor_identity_after_normalization',
      startsOn: '2035-06-01',
      endsOn: '2035-06-30',
      revokedAt: '2035-06-10T00:00:00Z',
      effectiveAtFrozenDate: false,
    },
  };
  assert(
    valuesAreEqual(
      Object.fromEntries(
        Object.keys(expectedStates).map((state) => [
          state,
          authority.delegationStates?.[state],
        ]),
      ),
      expectedStates,
    ),
    'delegation D1-D4 authority definitions diverge',
  );
  return authority;
}

function verifyDelegationMeasurementAuthority(
  contractPath: string,
  pin: DelegationMeasurementAuthorityPin,
  plan: PhysicalSeedPlan,
): DelegationMeasurementAuthority {
  assert(
    pin.artifact === 'HEARTH-003-DELEGATION-MEASUREMENT-v1.json' &&
      pin.measurementVersion ===
        'HEARTH-003-DELEGATION-MEASUREMENT-v1' &&
      SHA256.test(pin.canonicalTextSha256),
    'delegation measurement pin is not the frozen v1 authority',
  );
  const path = join(dirname(contractPath), pin.artifact);
  assert(existsSync(path), 'delegation measurement authority artifact is missing');
  const bytes = readFileSync(path);
  assert(
    sha256CanonicalText(bytes, pin.artifact) === pin.canonicalTextSha256,
    'delegation measurement authority hash differs from the physical plan pin',
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeStrictUtf8(bytes, pin.artifact));
  } catch {
    fail('delegation measurement authority is not valid UTF-8 JSON');
  }
  const authority = parsed as DelegationMeasurementAuthority;
  assert(
    authority.schemaVersion === 1 &&
      authority.artifactKind ===
        'hearth-search-delegation-measurement-authority' &&
      authority.measurementVersion === pin.measurementVersion &&
      authority.syntheticOnly === true &&
      authority.actorClassArtifact ===
        plan.delegationAuthoritySource.artifact &&
      authority.frozenAsOfDate === '2035-06-15' &&
      authority.corpusProfilesAreMutuallyExclusive === true,
    'delegation measurement authority envelope diverges',
  );

  const expectedStates = ['D0', 'D1', 'D2', 'D3', 'D4'] as const;
  assert(
    isArrayValue(authority.corpusProfiles) &&
      authority.corpusProfiles.length === expectedStates.length,
    'delegation measurement authority must expose five corpus profiles',
  );
  const overlayRowById = new Map<string, SeedRow>();
  for (const scenario of plan.overlayScenarios) {
    if (scenario.authorityState?.kind !== 'delegation') continue;
    for (const row of scenario.rows ?? []) {
      assert(
        !overlayRowById.has(row.rowId),
        `duplicate delegation overlay row ${row.rowId}`,
      );
      overlayRowById.set(row.rowId, row);
    }
  }
  assert(
    overlayRowById.size === 56,
    `expected 56 exact D1-D4 authority rows, found ${overlayRowById.size}`,
  );

  const profileByState = new Map<string, DelegationMeasurementCorpusProfile>();
  const profileRowIds = new Set<string>();
  for (const profile of authority.corpusProfiles) {
    assert(
      expectedStates.includes(
        profile.delegationState as (typeof expectedStates)[number],
      ),
      `unknown delegation corpus state ${profile.delegationState}`,
    );
    assert(
      !profileByState.has(profile.delegationState),
      `duplicate corpus state ${profile.delegationState}`,
    );
    profileByState.set(profile.delegationState, profile);
    const expectedRowCount = profile.delegationState === 'D0' ? 0 : 14;
    assert(
      profile.corpusProfileId === `H3M.${profile.delegationState}` &&
        profile.frozenAsOfDate === authority.frozenAsOfDate &&
        profile.basePlanVersion === plan.planVersion &&
        profile.baseAuthorityRowCount === plan.rows.length &&
        profile.delegationRowCount === expectedRowCount &&
        profile.expectedAuthorityRowCount ===
          plan.rows.length + expectedRowCount &&
        isArrayValue(profile.rows) &&
        profile.rows.length === expectedRowCount &&
        isArrayValue(profile.exactDelegationRowIds) &&
        profile.exactDelegationRowIds.length === expectedRowCount,
      `delegation corpus profile ${profile.corpusProfileId} count or version diverges`,
    );
    const ids = profile.rows.map((row) => row.rowId);
    assert(
      valuesAreEqual(ids, profile.exactDelegationRowIds),
      `${profile.corpusProfileId} exact row-id list diverges from its rows`,
    );
    assert(
      new Set(ids).size === ids.length,
      `${profile.corpusProfileId} contains duplicate row ids`,
    );
    for (const row of profile.rows) {
      const overlay = overlayRowById.get(row.rowId);
      assert(
        overlay !== undefined && valuesAreEqual(row, overlay),
        `${profile.corpusProfileId} row ${row.rowId} is not byte-equivalent to its authority overlay`,
      );
      assert(
        row.table === 'delegation' &&
          row.rowId.endsWith(`.${profile.delegationState}.row`),
        `${profile.corpusProfileId} includes a row from another state`,
      );
      assert(
        !profileRowIds.has(row.rowId),
        `delegation row ${row.rowId} appears in more than one measured profile`,
      );
      profileRowIds.add(row.rowId);
    }
  }
  assert(
    profileByState.size === expectedStates.length &&
      profileRowIds.size === overlayRowById.size,
    'measured profiles do not partition the exact D1-D4 overlay authority',
  );

  const suite = authority.h4AcceptanceProfileSuite;
  assert(
    suite !== undefined &&
      valuesAreEqual(suite.profileExecutionIds, [
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
      ]) &&
      new Set(suite.profileExecutionIds).size === 10,
    'H4 must bind the exact ten-profile sparse measured suite',
  );
  assert(
    isArrayValue(suite.entitlementProfiles) &&
      suite.entitlementProfiles.length === 5 &&
      isArrayValue(suite.participantProfiles) &&
      suite.participantProfiles.length === 2 &&
      isArrayValue(suite.baseCartesianActorProfiles) &&
      suite.baseCartesianActorProfiles.length === 70 &&
      isArrayValue(suite.participantActorProfiles) &&
      suite.participantActorProfiles.length === 28,
    'H4 entitlement/participant profile matrices have the wrong cardinality',
  );
  const acceptedOverlayRowById = new Map<string, SeedRow>();
  for (const scenario of plan.overlayScenarios) {
    if (scenario.expected !== 'accept') continue;
    for (const row of scenario.rows ?? []) {
      acceptedOverlayRowById.set(row.rowId, row);
    }
  }
  for (const profile of suite.entitlementProfiles) {
    const state = profile.stateComposition.entitlementState;
    const expectedCount = state === 'E0' ? 0 : 2;
    const rows = profile.rows ?? [];
    assert(
      profile.corpusProfileId ===
        (state === 'E0' ? 'H3M.D0' : `H3M.${state}`) &&
        profile.stateComposition.delegationState === 'D0' &&
        profile.stateComposition.participantState === 'P0' &&
        rows.length === expectedCount &&
        (profile.deltaRowCount ?? expectedCount) === expectedCount &&
        (profile.expectedAuthorityRowCount ?? plan.rows.length) ===
          plan.rows.length + expectedCount &&
        valuesAreEqual(
          profile.exactDeltaRowIds ?? [],
          rows.map(({ rowId }) => rowId),
        ),
      `entitlement profile ${profile.corpusProfileId} diverges`,
    );
    for (const row of rows) {
      assert(
        row.table === 'tenant_module_entitlement' &&
          valuesAreEqual(acceptedOverlayRowById.get(row.rowId), row),
        `entitlement row ${row.rowId} is not an exact accepted authority row`,
      );
    }
  }
  const p0 = suite.participantProfiles[0]!;
  const p1 = suite.participantProfiles[1]!;
  assert(
    p0.corpusProfileId === 'H3M.E1' &&
      p0.stateComposition.participantState === 'P0' &&
      typeof p0.aliasRule === 'string' &&
      p1.corpusProfileId === 'H3M.P1' &&
      p1.stateComposition.entitlementState === 'E1' &&
      p1.stateComposition.delegationState === 'D0' &&
      p1.stateComposition.participantState === 'P1' &&
      p1.deltaRowCount === 16 &&
      p1.expectedAuthorityRowCount === plan.rows.length + 16 &&
      p1.rows?.length === 16 &&
      valuesAreEqual(
        p1.exactDeltaRowIds,
        p1.rows.map(({ rowId }) => rowId),
      ),
    'participant P0/P1 profile authority diverges',
  );
  const p1Rows = p1.rows ?? [];
  const p1EntitlementRows = p1Rows.filter(
    (row) => row.table === 'tenant_module_entitlement',
  );
  const p1ParticipantRows = p1Rows.filter(
    (row) => row.table === 'comms_thread_participant',
  );
  assert(
    p1EntitlementRows.length === 2 &&
      p1ParticipantRows.length === 14,
    'P1 profile must contain two E1 entitlements and fourteen participant rows',
  );
  for (const row of p1EntitlementRows) {
    assert(
      valuesAreEqual(acceptedOverlayRowById.get(row.rowId), row),
      `P1 entitlement row ${row.rowId} diverges from E1 authority`,
    );
  }
  const participantKeys = new Set<string>();
  for (const row of p1ParticipantRows) {
    const key = JSON.stringify([
      row.tenantSlot,
      row.values.thread_id,
      row.values.user_id,
    ]);
    assert(
      row.tenantSlot !== null &&
        row.values.tenant_id === plan.tenantIds[row.tenantSlot] &&
        row.values.role === 'member' &&
        row.values.removed_at === null &&
        !participantKeys.has(key),
      `invalid or duplicate P1 participant row ${row.rowId}`,
    );
    participantKeys.add(key);
    const actor = plan.rows.find(
      (candidate) =>
        candidate.table === 'app_user' &&
        candidate.values.id === row.values.user_id,
    );
    assert(
      actor !== undefined,
      `P1 participant row ${row.rowId} does not bind a physical actor`,
    );
  }
  assert(
    participantKeys.size === 14,
    'P1 participant profile does not cover all tenant/role actors',
  );
  for (const [
    label,
    profiles,
    expectedStatesForProfile,
  ] of [
    [
      'baseCartesianActorProfiles',
      suite.baseCartesianActorProfiles,
      ['E0', 'E1', 'E2', 'E3', 'E4'],
    ],
    [
      'participantActorProfiles',
      suite.participantActorProfiles,
      ['P0', 'P1'],
    ],
  ] as const) {
    const ids = new Set<string>();
    for (const profile of profiles) {
      assert(
        !ids.has(profile.actorProfileId) &&
          ['T01', 'T02'].includes(profile.tenantSlot) &&
          ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'].includes(profile.role) &&
          suite.profileExecutionIds.includes(profile.corpusProfileId),
        `${label} contains an invalid or duplicate actor profile`,
      );
      ids.add(profile.actorProfileId);
      const variedState =
        label === 'baseCartesianActorProfiles'
          ? profile.entitlementState
          : profile.participantState;
      const allowedStates: readonly string[] = expectedStatesForProfile;
      assert(
        allowedStates.includes(variedState),
        `${profile.actorProfileId} has an invalid measured state`,
      );
      const actorRow = plan.rows.find(
        (row) => row.rowId === profile.actorUserRowId,
      );
      assert(
        actorRow !== undefined &&
          actorRow.values.id === profile.actorUserId &&
          actorRow.values.email === profile.actorIdentity,
        `${profile.actorProfileId} is not bound to its physical actor row`,
      );
    }
  }
  assert(
    isArrayValue(authority.actorProfileCatalog) &&
      authority.actorProfileCatalog.length === 140 &&
      isArrayValue(authority.nonDelegationLogicalAssignments) &&
      authority.nonDelegationLogicalAssignments.length > 0 &&
      isArrayValue(authority.nonDelegationConcreteObservations) &&
      authority.nonDelegationConcreteObservations.length > 0,
    'non-delegation observation authority is missing or incomplete',
  );
  const actorProfileById = new Map<string, MeasurementActorProfile>();
  for (const profile of authority.actorProfileCatalog) {
    assert(
      typeof profile.actorProfileId === 'string' &&
        !actorProfileById.has(profile.actorProfileId) &&
        suite.profileExecutionIds.includes(profile.corpusProfileId),
      `invalid sparse actor profile ${profile.actorProfileId}`,
    );
    actorProfileById.set(profile.actorProfileId, profile);
    const actor = plan.rows.find(
      (row) => row.rowId === profile.actorUserRowId,
    );
    assert(
      actor !== undefined &&
        actor.values.id === profile.actorUserId &&
        actor.values.email === profile.actorIdentity,
      `${profile.actorProfileId} is not bound to its physical actor`,
    );
  }
  const observationById = new Map<
    string,
    NonDelegationConcreteObservation
  >();
  for (const observation of authority.nonDelegationConcreteObservations) {
    assert(
      typeof observation.observationId === 'string' &&
        !observationById.has(observation.observationId) &&
        observation.actorClass !==
          'same.approval.delegated_active' &&
        observation.actorClass !==
          'same.approval.delegated_inactive' &&
        valuesAreEqual(
          actorProfileById.get(observation.actorProfileId),
          {
            actorProfileId: observation.actorProfileId,
            tenantSlot: observation.tenantSlot,
            role: observation.role,
            entitlementState: observation.entitlementState,
            delegationState: observation.delegationState,
            participantState: observation.participantState,
            corpusProfileId: observation.corpusProfileId,
            actorUserRowId: observation.actorUserRowId,
            actorUserId: observation.actorUserId,
            actorIdentity: observation.actorIdentity,
          },
        ),
      `invalid non-delegation observation ${observation.observationId}`,
    );
    observationById.set(observation.observationId, observation);
  }
  const nonDelegationAssignmentIds = new Set<string>();
  let boundObservationCount = 0;
  for (const assignment of authority.nonDelegationLogicalAssignments) {
    assert(
      typeof assignment.assignmentId === 'string' &&
        !nonDelegationAssignmentIds.has(assignment.assignmentId) &&
        assignment.observationIds.length ===
          assignment.expectedExpansionCount &&
        new Set(assignment.observationIds).size ===
          assignment.expectedExpansionCount &&
        assignment.expectedExpansionCount > 0,
      `invalid non-delegation assignment ${assignment.assignmentId}`,
    );
    nonDelegationAssignmentIds.add(assignment.assignmentId);
    const authoritativeKeys = new Map(
      assignment.authoritativeRelevant.map(({ source, rankGroup }) => [
        sourceIdentityKey(
          source,
          `${assignment.assignmentId}.authoritativeRelevant`,
        ),
        rankGroup,
      ]),
    );
    const approvedKeys = new Map(
      assignment.approvedSearchRelevantJudgments.map(
        ({ source, rankGroup }) => [
          sourceIdentityKey(
            source,
            `${assignment.assignmentId}.approvedSearchRelevantJudgments`,
          ),
          rankGroup,
        ],
      ),
    );
    for (const [key, rankGroup] of approvedKeys) {
      assert(
        authoritativeKeys.get(key) === rankGroup,
        `${assignment.assignmentId} approved relevant judgment exceeds authoritative relevance`,
      );
    }
    const expectedGap = [...authoritativeKeys]
      .filter(([key]) => !approvedKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    const actualGap = assignment.parityGapSources
      .map(({ source, rankGroup }) => [
        sourceIdentityKey(
          source,
          `${assignment.assignmentId}.parityGapSources`,
        ),
        rankGroup,
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    assert(
      valuesAreEqual(actualGap, expectedGap),
      `${assignment.assignmentId} parity gap diverges`,
    );
    for (const observationId of assignment.observationIds) {
      const observation = observationById.get(observationId);
      assert(
        observation !== undefined &&
          observation.assignmentId === assignment.assignmentId &&
          observation.queryCaseId === assignment.queryCaseId &&
          observation.fixtureScenarioId ===
            assignment.fixtureScenarioId &&
          observation.actorClass === assignment.actorClass &&
          observation.targetTenantSlot ===
            assignment.targetTenantSlot,
        `${assignment.assignmentId} does not bind ${observationId}`,
      );
      boundObservationCount += 1;
    }
  }
  assert(
    boundObservationCount === observationById.size,
    'non-delegation observations are not bound exactly once',
  );

  assert(
    isArrayValue(authority.logicalAssignments) &&
      authority.logicalAssignments.length === 29 &&
      isArrayValue(authority.concreteBindings) &&
      authority.concreteBindings.length === 370 &&
      isArrayValue(authority.pairEdges) &&
      authority.pairEdges.length === 280 &&
      isArrayValue(authority.noEffectControls) &&
      authority.noEffectControls.length === 20,
    'delegation measurement expansion must be 29 logical, 370 concrete, 280 pairs, and 20 controls',
  );
  const nonBaseRoles = ['legal', 'finance', 'hr', 'management', 'visitor'];
  const bindingById = new Map<string, DelegationMeasurementBinding>();
  for (const binding of authority.concreteBindings) {
    assert(
      typeof binding.bindingId === 'string' &&
        !bindingById.has(binding.bindingId),
      `duplicate or invalid delegation binding ${binding.bindingId}`,
    );
    bindingById.set(binding.bindingId, binding);
    assert(
      nonBaseRoles.includes(binding.role) &&
        (binding.actorClass === 'same.approval.delegated_active' ||
          binding.actorClass === 'same.approval.delegated_inactive') &&
        profileByState.get(binding.delegationState)?.corpusProfileId ===
          binding.corpusProfileId,
      `binding ${binding.bindingId} has an invalid role, class, or corpus profile`,
    );
    const expectedActive =
      binding.actorClass === 'same.approval.delegated_active';
    assert(
      (expectedActive
        ? binding.delegationState === 'D1'
        : ['D0', 'D2', 'D3', 'D4'].includes(binding.delegationState)) &&
        binding.authoritativeApprovalReadExpected === expectedActive &&
        binding.approvedSearchApprovalDomainExpected === false,
      `binding ${binding.bindingId} has an invalid active/inactive expectation`,
    );
    const expectedDelegationRowId =
      binding.delegationState === 'D0'
        ? null
        : `H3D.${binding.tenantSlot}.${binding.role}.${binding.delegationState}.row`;
    assert(
      binding.delegationRowId === expectedDelegationRowId,
      `binding ${binding.bindingId} names the wrong physical delegation row`,
    );
    const actorRow = plan.rows.find(
      (row) => row.rowId === binding.actorUserRowId,
    );
    const membershipRow = plan.rows.find(
      (row) =>
        row.table === 'tenant_membership' &&
        row.tenantSlot === binding.tenantSlot &&
        row.values.user_id === binding.actorUserId,
    );
    const roleRow = plan.rows.find(
      (row) =>
        row.table === 'role_assignment' &&
        row.tenantSlot === binding.tenantSlot &&
        row.values.user_id === binding.actorUserId &&
        row.values.role === binding.role,
    );
    assert(
      actorRow?.table === 'app_user' &&
        actorRow.values.id === binding.actorUserId &&
        actorRow.values.email === binding.actorIdentity &&
        membershipRow !== undefined &&
        roleRow !== undefined,
      `binding ${binding.bindingId} is not bound to its physical actor`,
    );

    const authoritative = new Map(
      binding.authoritativeRelevant.map(({ source, rankGroup }) => [
        sourceIdentityKey(source, `${binding.bindingId}.authoritativeRelevant`),
        rankGroup,
      ]),
    );
    const approved = new Map(
      binding.approvedSearchRelevantJudgments.map(({ source, rankGroup }) => [
        sourceIdentityKey(
          source,
          `${binding.bindingId}.approvedSearchRelevantJudgments`,
        ),
        rankGroup,
      ]),
    );
    for (const [key, rankGroup] of approved) {
      assert(
        authoritative.get(key) === rankGroup,
        `${binding.bindingId} approved disclosure is not a rank-preserving subset of authoritative relevance`,
      );
    }
    const expectedGap = [...authoritative]
      .filter(([key]) => !approved.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    const actualGap = binding.parityGapSources
      .map(({ source, rankGroup }) => [
        sourceIdentityKey(source, `${binding.bindingId}.parityGapSources`),
        rankGroup,
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    assert(
      valuesAreEqual(actualGap, expectedGap),
      `${binding.bindingId} parity gap is not authoritative minus approved`,
    );
  }

  const assignmentIds = new Set<string>();
  for (const assignment of authority.logicalAssignments) {
    assert(
      typeof assignment.assignmentId === 'string' &&
        !assignmentIds.has(assignment.assignmentId),
      `duplicate delegation logical assignment ${assignment.assignmentId}`,
    );
    assignmentIds.add(assignment.assignmentId);
    const expectedExpansion =
      assignment.actorClass === 'same.approval.delegated_active' ? 5 : 20;
    assert(
      assignment.expectedExpansionCount === expectedExpansion &&
        assignment.concreteBindingIds.length === expectedExpansion &&
        new Set(assignment.concreteBindingIds).size === expectedExpansion,
      `${assignment.assignmentId} has the wrong concrete expansion`,
    );
    for (const bindingId of assignment.concreteBindingIds) {
      const binding = bindingById.get(bindingId);
      assert(
        binding !== undefined &&
          binding.logicalAssignmentId === assignment.assignmentId &&
          binding.queryCaseId === assignment.queryCaseId &&
          binding.fixtureScenarioId === assignment.fixtureScenarioId &&
          binding.actorClass === assignment.actorClass &&
          binding.tenantSlot === assignment.tenantSlot,
        `${assignment.assignmentId} does not bind concrete probe ${bindingId}`,
      );
    }
  }

  const pairIds = new Set<string>();
  for (const edge of authority.pairEdges) {
    assert(
      typeof edge.pairEdgeId === 'string' &&
        !pairIds.has(edge.pairEdgeId),
      `duplicate delegation pair edge ${edge.pairEdgeId}`,
    );
    pairIds.add(edge.pairEdgeId);
    const active = bindingById.get(edge.activeBindingId);
    const inactive = bindingById.get(edge.inactiveBindingId);
    assert(
      active !== undefined &&
        inactive !== undefined &&
        active.actorClass === 'same.approval.delegated_active' &&
        active.delegationState === 'D1' &&
        inactive.actorClass === 'same.approval.delegated_inactive' &&
        ['D0', 'D2', 'D3', 'D4'].includes(inactive.delegationState) &&
        active.queryCaseId === inactive.queryCaseId &&
        active.fixtureScenarioId === inactive.fixtureScenarioId &&
        active.tenantSlot === inactive.tenantSlot &&
        active.role === inactive.role &&
        active.actorUserId === inactive.actorUserId &&
        active.actorIdentity === inactive.actorIdentity &&
        active.queryCaseId === edge.queryCaseId &&
        active.fixtureScenarioId === edge.fixtureScenarioId &&
        active.tenantSlot === edge.tenantSlot &&
        active.role === edge.role,
      `${edge.pairEdgeId} is not a same-query same-actor D1/inactive pair`,
    );
  }

  const clock = requireObject(
    authority.clockContract,
    'delegation measurement clockContract',
  );
  assert(
    clock.anchorIso === '2035-06-15T12:00:00.000Z' &&
      clock.mode === 'offset-advancing-Date-only' &&
      valuesAreEqual(clock.untouchedClocks, [
        'setTimeout',
        'performance.now',
        'process.hrtime.bigint',
      ]),
    'delegation measurement clock contract diverges',
  );
  return authority;
}

function assertPlanShape(contract: FixtureContract): PhysicalSeedPlan {
  assert(
    contract.schemaVersion === 4 &&
      contract.artifactKind === 'hearth-search-gold-fixture-contract' &&
      contract.fixtureVersion === 'HEARTH-003-FIXTURES-v5',
    'fixture contract must be the coherent HEARTH-003 v5 authority artifact',
  );
  assert(contract.syntheticOnly === true, 'fixture contract must be syntheticOnly');
  assert(Array.isArray(contract.fixtures) && contract.fixtures.length > 0, 'fixture contract fixtures must be non-empty');
  const plan = contract.physicalSeedPlan;
  assert(plan !== undefined && plan !== null && typeof plan === 'object', 'physicalSeedPlan is required');
  assert(plan.schemaVersion === 4, 'physicalSeedPlan.schemaVersion must be 4');
  assert(
    plan.planVersion === 'HEARTH-003-PHYSICAL-SEED-PLAN-v4',
    'physicalSeedPlan.planVersion must be HEARTH-003-PHYSICAL-SEED-PLAN-v4',
  );
  assert(plan.syntheticOnly === true, 'physicalSeedPlan must be syntheticOnly');
  assert(plan.tenantIds !== null && typeof plan.tenantIds === 'object', 'physicalSeedPlan.tenantIds is required');
  assert(Object.keys(plan.tenantIds).length >= 2, 'physicalSeedPlan must bind at least two tenant slots');
  for (const [slot, id] of Object.entries(plan.tenantIds)) {
    assert(/^T\d{2}$/.test(slot), `invalid tenant slot ${slot}`);
    assert(typeof id === 'string' && UUID.test(id), `tenantIds.${slot} must be a UUID`);
  }
  assert(new Set(Object.values(plan.tenantIds)).size === Object.values(plan.tenantIds).length, 'tenantIds must be distinct');
  assert(
    plan.delegationAuthoritySource?.artifact ===
      'HEARTH-003-ACTOR-CLASSES-v2.json' &&
      plan.delegationAuthoritySource.actorClassVersion ===
        'HEARTH-003-ACTOR-CLASSES-v2' &&
      SHA256.test(plan.delegationAuthoritySource.canonicalTextSha256),
    'delegationAuthoritySource must bind the frozen actor-class v2 artifact',
  );
  assert(
    plan.delegationMeasurementAuthoritySource?.artifact ===
      'HEARTH-003-DELEGATION-MEASUREMENT-v1.json' &&
      plan.delegationMeasurementAuthoritySource.measurementVersion ===
        'HEARTH-003-DELEGATION-MEASUREMENT-v1' &&
      SHA256.test(
        plan.delegationMeasurementAuthoritySource.canonicalTextSha256,
      ) &&
      valuesAreEqual(
        contract.delegationMeasurementAuthority,
        plan.delegationMeasurementAuthoritySource,
      ),
    'fixture contract and physical plan must bind the same frozen delegation measurement authority',
  );
  assert(Array.isArray(plan.rows) && plan.rows.length > 0, 'physicalSeedPlan.rows must be non-empty');
  assert(Array.isArray(plan.overlayScenarios) && plan.overlayScenarios.length > 0, 'overlayScenarios must be non-empty');

  let priorPhase = Number.NEGATIVE_INFINITY;
  const rowIds = new Set<string>();
  for (const [index, row] of plan.rows.entries()) {
    validateSeedRowShape(row, `physicalSeedPlan.rows[${index}]`);
    assert(row.phase >= priorPhase, 'physicalSeedPlan.rows must already be in nondecreasing phase order');
    priorPhase = row.phase;
    assert(!rowIds.has(row.rowId), `duplicate physicalSeedPlan rowId ${row.rowId}`);
    rowIds.add(row.rowId);
    validateTenantBinding(row, plan.tenantIds, `physicalSeedPlan.rows[${index}]`);
  }

  const scenarioIds = new Set<string>();
  const delegationScenarioKeys = new Set<string>();
  let acceptedScenarioCount = 0;
  let rejectedScenarioCount = 0;
  for (const [scenarioIndex, scenario] of plan.overlayScenarios.entries()) {
    const label = `overlayScenarios[${scenarioIndex}]`;
    assert(typeof scenario.scenarioId === 'string' && scenario.scenarioId.length > 0, `${label}.scenarioId is required`);
    assert(!scenarioIds.has(scenario.scenarioId), `duplicate overlay scenario ${scenario.scenarioId}`);
    scenarioIds.add(scenario.scenarioId);
    assert(scenario.expected === 'accept' || scenario.expected === 'reject', `${label}.expected must be accept or reject`);
    if (scenario.expected === 'accept') acceptedScenarioCount += 1;
    else rejectedScenarioCount += 1;
    for (const rowId of scenario.removeRowIds ?? []) {
      assert(rowIds.has(rowId), `${label} removes unknown baseline rowId ${rowId}`);
    }
    const localIds = new Set<string>();
    for (const [rowIndex, row] of (scenario.rows ?? []).entries()) {
      validateSeedRowShape(row, `${label}.rows[${rowIndex}]`);
      assert(!localIds.has(row.rowId), `${label} has duplicate overlay rowId ${row.rowId}`);
      localIds.add(row.rowId);
      validateTenantBinding(row, plan.tenantIds, `${label}.rows[${rowIndex}]`);
    }
    const expectedStates = Array.isArray(scenario.expectedSqlState)
      ? scenario.expectedSqlState
      : scenario.expectedSqlState
        ? [scenario.expectedSqlState]
        : [];
    for (const state of expectedStates) assert(/^[0-9A-Z]{5}$/.test(state), `${label} has invalid expected SQLSTATE`);
    const expectedConstraints = Array.isArray(scenario.expectedConstraint)
      ? scenario.expectedConstraint
      : scenario.expectedConstraint
        ? [scenario.expectedConstraint]
        : [];
    for (const constraint of expectedConstraints) {
      assert(
        SIMPLE_IDENTIFIER.test(constraint),
        `${label} has invalid expected constraint`,
      );
    }
    if (scenario.expected === 'accept') {
      assert(
        expectedStates.length === 0 && expectedConstraints.length === 0,
        `${label} accept overlay may not declare rejection evidence`,
      );
    } else {
      assert(
        expectedStates.length > 0,
        `${label} reject overlay must declare expectedSqlState`,
      );
    }
    if (scenario.authorityState !== undefined) {
      const authorityState = scenario.authorityState;
      const roles = [
        'owner',
        'operations',
        'legal',
        'finance',
        'hr',
        'management',
        'visitor',
      ];
      const states = ['D1', 'D2', 'D3', 'D4'];
      assert(
        authorityState.kind === 'delegation' &&
          states.includes(authorityState.state) &&
          roles.includes(authorityState.role) &&
          Object.hasOwn(plan.tenantIds, authorityState.tenantSlot) &&
          UUID.test(authorityState.actorUserId) &&
          typeof authorityState.actorIdentity === 'string' &&
          authorityState.actorIdentity.length > 0 &&
          authorityState.actorProfileId ===
            `${authorityState.tenantSlot}.${authorityState.role}.E0.${authorityState.state}.base` &&
          authorityState.frozenAsOfDate === '2035-06-15' &&
          typeof authorityState.expectedHasActiveDelegation === 'boolean',
        `${label}.authorityState is not an exact delegation binding`,
      );
      assert(
        scenario.expected === 'accept' &&
          (scenario.rows ?? []).length === 1 &&
          scenario.rows?.[0]?.table === 'delegation' &&
          scenario.rows[0].tenantSlot === authorityState.tenantSlot,
        `${label} delegation authority state must bind one accepted delegation row`,
      );
      delegationScenarioKeys.add(
        `${authorityState.tenantSlot}\0${authorityState.role}\0${authorityState.state}`,
      );
    }
  }
  assert(
    acceptedScenarioCount > 0 && rejectedScenarioCount > 0,
    'overlayScenarios must prove both accept and reject branches',
  );
  const expectedDelegationKeys = Object.keys(plan.tenantIds).flatMap(
    (tenantSlot) =>
      [
        'owner',
        'operations',
        'legal',
        'finance',
        'hr',
        'management',
        'visitor',
      ].flatMap((role) =>
        ['D1', 'D2', 'D3', 'D4'].map(
          (state) => `${tenantSlot}\0${role}\0${state}`,
        ),
      ),
  );
  assert(
    valuesAreEqual(
      [...delegationScenarioKeys].sort(),
      expectedDelegationKeys.sort(),
    ),
    'delegation overlays must cover exactly two tenants x seven roles x D1-D4',
  );
  return plan;
}

function validateSeedRowShape(row: SeedRow, label: string): void {
  assert(row !== null && typeof row === 'object', `${label} must be an object`);
  assert(typeof row.rowId === 'string' && /^[A-Za-z0-9._:-]+$/.test(row.rowId), `${label}.rowId is invalid`);
  assert(Number.isSafeInteger(row.phase) && row.phase >= 0, `${label}.phase must be a non-negative safe integer`);
  assert(typeof row.table === 'string' && SIMPLE_IDENTIFIER.test(row.table), `${label}.table is invalid`);
  assert(row.tenantSlot === null || typeof row.tenantSlot === 'string', `${label}.tenantSlot must be string or null`);
  assert(row.values !== null && typeof row.values === 'object' && !Array.isArray(row.values), `${label}.values must be an object`);
  assert(Object.keys(row.values).length > 0, `${label}.values must be non-empty`);
  for (const key of Object.keys(row.values)) assert(SIMPLE_IDENTIFIER.test(key), `${label}.values has invalid column ${key}`);
  JSON.stringify(row.values);
}

function validateTenantBinding(
  row: SeedRow,
  tenantIds: Readonly<Record<string, string>>,
  label: string,
): void {
  if (row.tenantSlot === null) return;
  const tenantId = tenantIds[row.tenantSlot];
  assert(tenantId !== undefined, `${label} names unknown tenantSlot ${row.tenantSlot}`);
  if (row.table === 'tenant') {
    assert(row.values.id === tenantId, `${label} tenant row id does not bind tenantSlot`);
  } else {
    assert(row.values.tenant_id === tenantId, `${label} must carry tenant_id for its tenantSlot`);
  }
}

function baseType(dataType: string): string {
  return dataType.replace(/\(.+\)$/, '').trim();
}

function isValidDateOnly(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkPrimitiveCompatibility(value: JsonValue, column: CatalogColumn, label: string): void {
  if (value === null) {
    assert(!column.notNull, `${label} is null but the physical column is NOT NULL`);
    return;
  }
  const type = baseType(column.dataType);
  if (column.dataType.endsWith('[]') || column.typeCategory === 'A') {
    assert(Array.isArray(value), `${label} must be a JSON array for ${column.dataType}`);
    return;
  }
  if (column.typeKind === 'e') {
    assert(typeof value === 'string', `${label} must be a string for enum ${column.typeName}`);
    assert(column.enumValues.includes(value), `${label} is outside enum ${column.typeName}`);
    return;
  }
  if (type === 'uuid') {
    assert(typeof value === 'string' && UUID.test(value), `${label} must be a canonical UUID string`);
    return;
  }
  if (INTEGER_TYPES.has(type)) {
    assert(typeof value === 'number' && Number.isSafeInteger(value), `${label} must be a JSON safe integer for ${type}`);
    return;
  }
  if (NUMBER_TYPES.has(type)) {
    assert(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite JSON number for ${type}`);
    return;
  }
  if (type === 'boolean') {
    assert(typeof value === 'boolean', `${label} must be boolean`);
    return;
  }
  if (type === 'date') {
    assert(typeof value === 'string' && isValidDateOnly(value), `${label} must be an ISO calendar date`);
    return;
  }
  if (TIMESTAMP_TYPES.has(type)) {
    assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} must be an ISO timestamp`);
    return;
  }
  if (type === 'json' || type === 'jsonb') {
    JSON.stringify(value);
    return;
  }
  if (type === 'bytea') {
    assert(typeof value === 'string' && /^\\x[0-9a-f]*$/i.test(value), `${label} must be a PostgreSQL hex bytea string`);
    return;
  }
  if (SAFE_TEXT_TYPES.has(type)) {
    assert(typeof value === 'string', `${label} must be a string for ${type}`);
    return;
  }
  fail(`${label} uses unsupported physical type ${column.dataType}; validator must be extended before PASS`);
}

function staticPreflightRows(
  rows: readonly SeedRow[],
  tables: ReadonlyMap<string, CatalogTable>,
  label: string,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    const table = tables.get(row.table);
    assert(table !== undefined, `${label}[${rowIndex}] names missing physical table ${row.table}`);
    const columns = new Map(table.columns.map((column) => [column.name, column]));
    for (const [name, value] of Object.entries(row.values)) {
      const column = columns.get(name);
      assert(column !== undefined, `${label}[${rowIndex}] ${row.table}.${name} is not a physical column`);
      assert(column.generated === null, `${label}[${rowIndex}] supplies generated column ${row.table}.${name}`);
      checkPrimitiveCompatibility(value, column, `${label}[${rowIndex}] ${row.table}.${name}`);
      if (name.toLowerCase().includes('email') && typeof value === 'string') {
        assert(value.toLowerCase().endsWith('@synthetic.invalid'), `${label}[${rowIndex}] email is not synthetic.invalid`);
      }
    }
    for (const column of table.columns) {
      if (
        column.notNull &&
        column.defaultExpression === null &&
        column.identity === null &&
        column.generated === null
      ) {
        assert(
          Object.prototype.hasOwnProperty.call(row.values, column.name),
          `${label}[${rowIndex}] omits required no-default NOT NULL column ${row.table}.${column.name}`,
        );
      }
    }
  }
}

function valuesAreEqual(actual: unknown, expected: unknown): boolean {
  return canonicalJson(actual) === canonicalJson(expected);
}

function normalizeProjection(row: Record<string, unknown>): ApprovedProjection {
  const stringOrNull = (value: unknown, name: string): string | null => {
    assert(value === null || typeof value === 'string', `projection ${name} must be text or null`);
    return value;
  };
  assert(typeof row.kind === 'string', 'projection kind must be text');
  assert(typeof row.id === 'string', 'projection id must be text');
  return {
    kind: row.kind,
    id: row.id,
    title: stringOrNull(row.title, 'title'),
    subtitle: stringOrNull(row.subtitle, 'subtitle'),
    parentId: stringOrNull(row.parent_id, 'parent_id'),
  };
}

function errorShape(error: unknown): PgErrorShape {
  if (error instanceof Error) return error as PgErrorShape;
  return new Error('non-Error PostgreSQL rejection') as PgErrorShape;
}

function stableSignal(error: PgErrorShape): string {
  if (error.constraint) return `constraint:${error.constraint}`;
  if (error.column) return `column:${error.column}`;
  const message = error.message;
  for (const token of ['DISTRIBUTION_SUM_VIOLATION', 'DISTRIBUTION_BPS_VIOLATION']) {
    if (message.includes(token)) return `message-tag:${token}`;
  }
  return `sqlstate:${error.code ?? 'unknown'}`;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

function sanitizeFailureMessage(message: string, cli: Cli): string {
  let sanitized = message;
  for (const path of [cli.repo, cli.contract, cli.qrels, cli.manifest, cli.report].filter(Boolean) as string[]) {
    sanitized = sanitized.replaceAll(path, '<path>');
  }
  sanitized = sanitized.replace(/postgres(?:ql)?:\/\/\S+/gi, '<database-url>');
  return sanitized.slice(0, 2000);
}

async function loadCatalog(client: PgClientLike, touchedTableNames: readonly string[]): Promise<{
  readonly tables: readonly CatalogTable[];
  readonly functions: readonly CatalogFunction[];
}> {
  assert(touchedTableNames.length > 0, 'no touched tables were declared');
  const names = [...new Set(touchedTableNames)].sort();

  const tableRows = (
    await client.query(
      `SELECT c.relname AS table_name,
              c.relrowsecurity AS row_level_security,
              c.relforcerowsecurity AS force_row_level_security
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [names],
    )
  ).rows;
  assert(tableRows.length === names.length, 'one or more touched tables do not exist in public schema');

  const columnRows = (
    await client.query(
      `SELECT c.relname AS table_name,
              a.attname AS column_name,
              a.attnum AS ordinal,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              tn.nspname AS type_schema,
              t.typname AS type_name,
              t.typtype AS type_kind,
              t.typcategory AS type_category,
              a.attnotnull AS not_null,
              pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true) AS default_expression,
              NULLIF(a.attidentity, '') AS identity,
              NULLIF(a.attgenerated, '') AS generated,
              coll.collname AS collation,
              COALESCE((
                SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
                  FROM pg_catalog.pg_enum e
                 WHERE e.enumtypid = t.oid
              ), ARRAY[]::text[]) AS enum_values
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
         JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = a.attcollation
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum`,
      [names],
    )
  ).rows;

  const constraintRows = (
    await client.query(
      `SELECT c.relname AS table_name,
              con.conname AS constraint_name,
              con.contype AS constraint_type,
              con.condeferrable AS deferrable,
              con.condeferred AS initially_deferred,
              con.convalidated AS validated,
              pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
              COALESCE((
                SELECT array_agg(a.attname ORDER BY key.ord)
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_catalog.pg_attribute a
                    ON a.attrelid = con.conrelid AND a.attnum = key.attnum
              ), ARRAY[]::name[])::text[] AS columns,
              rn.nspname AS referenced_schema,
              rc.relname AS referenced_table,
              COALESCE((
                SELECT array_agg(a.attname ORDER BY key.ord)
                  FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_catalog.pg_attribute a
                    ON a.attrelid = con.confrelid AND a.attnum = key.attnum
              ), ARRAY[]::name[])::text[] AS referenced_columns
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
    LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname, con.conname`,
      [names],
    )
  ).rows;

  const indexRows = (
    await client.query(
      `SELECT c.relname AS table_name,
              ic.relname AS index_name,
              i.indisprimary AS is_primary,
              i.indisunique AS is_unique,
              i.indisvalid AS is_valid,
              i.indisready AS is_ready,
              pg_catalog.pg_get_indexdef(i.indexrelid, 0, true) AS definition,
              pg_catalog.pg_get_expr(i.indpred, i.indrelid, true) AS predicate
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname, ic.relname`,
      [names],
    )
  ).rows;

  const triggerRows = (
    await client.query(
      `SELECT c.relname AS table_name,
              t.tgname AS trigger_name,
              t.tgenabled AS enabled,
              pg_catalog.pg_get_triggerdef(t.oid, true) AS definition,
              pn.nspname || '.' || p.proname || '(' ||
                pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS function_name
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
         JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
          AND NOT t.tgisinternal
        ORDER BY c.relname, t.tgname`,
      [names],
    )
  ).rows;

  const policyRows = (
    await client.query(
      `SELECT tablename AS table_name,
              policyname AS policy_name,
              permissive,
              roles::text[] AS roles,
              cmd AS command,
              qual AS using_expression,
              with_check AS with_check_expression
         FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        ORDER BY tablename, policyname`,
      [names],
    )
  ).rows;

  const functionRows = (
    await client.query(
      `SELECT n.nspname AS schema_name,
              p.proname AS function_name,
              pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
              pg_catalog.pg_get_function_result(p.oid) AS result_type,
              l.lanname AS language,
              p.provolatile AS volatility,
              p.proparallel AS parallel_safety,
              p.prosecdef AS security_definer,
              p.proleakproof AS leakproof,
              COALESCE(p.proconfig, ARRAY[]::text[]) AS configuration,
              pg_catalog.pg_get_functiondef(p.oid) AS definition
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
        ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)`,
    )
  ).rows;

  const byTable = new Map<string, CatalogTable>();
  for (const tableRow of tableRows) {
    const name = String(tableRow.table_name);
    const columns = columnRows
      .filter((row) => row.table_name === name)
      .map(
        (row): CatalogColumn => ({
          name: String(row.column_name),
          ordinal: Number(row.ordinal),
          dataType: String(row.data_type),
          typeSchema: String(row.type_schema),
          typeName: String(row.type_name),
          typeKind: String(row.type_kind),
          typeCategory: String(row.type_category),
          notNull: Boolean(row.not_null),
          defaultExpression: row.default_expression === null ? null : String(row.default_expression),
          identity: row.identity === null ? null : String(row.identity),
          generated: row.generated === null ? null : String(row.generated),
          collation: row.collation === null ? null : String(row.collation),
          enumValues: Array.isArray(row.enum_values) ? row.enum_values.map(String) : [],
        }),
      );
    assert(columns.length > 0, `catalog returned no columns for ${name}`);

    const constraints = constraintRows
      .filter((row) => row.table_name === name)
      .map(
        (row): CatalogConstraint => ({
          name: String(row.constraint_name),
          type: String(row.constraint_type),
          columns: Array.isArray(row.columns) ? row.columns.map(String) : [],
          definition: String(row.definition),
          deferrable: Boolean(row.deferrable),
          initiallyDeferred: Boolean(row.initially_deferred),
          validated: Boolean(row.validated),
          referencedTable:
            row.referenced_table === null
              ? null
              : `${String(row.referenced_schema)}.${String(row.referenced_table)}`,
          referencedColumns: Array.isArray(row.referenced_columns)
            ? row.referenced_columns.map(String)
            : [],
        }),
      );

    const indexes = indexRows
      .filter((row) => row.table_name === name)
      .map(
        (row): CatalogIndex => ({
          name: String(row.index_name),
          primary: Boolean(row.is_primary),
          unique: Boolean(row.is_unique),
          valid: Boolean(row.is_valid),
          ready: Boolean(row.is_ready),
          definition: String(row.definition),
          predicate: row.predicate === null ? null : String(row.predicate),
        }),
      );

    const triggers = triggerRows
      .filter((row) => row.table_name === name)
      .map(
        (row): CatalogTrigger => ({
          name: String(row.trigger_name),
          enabled: String(row.enabled),
          definition: String(row.definition),
          function: String(row.function_name),
        }),
      );

    const policies = policyRows
      .filter((row) => row.table_name === name)
      .map(
        (row): CatalogPolicy => ({
          name: String(row.policy_name),
          permissive: String(row.permissive),
          roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
          command: String(row.command),
          using: row.using_expression === null ? null : String(row.using_expression),
          withCheck: row.with_check_expression === null ? null : String(row.with_check_expression),
        }),
      );

    byTable.set(name, {
      table: name,
      rowLevelSecurity: Boolean(tableRow.row_level_security),
      forceRowLevelSecurity: Boolean(tableRow.force_row_level_security),
      columns,
      constraints,
      indexes,
      triggers,
      policies,
    });
  }

  const functions = functionRows.map(
    (row): CatalogFunction => ({
      schema: String(row.schema_name),
      name: String(row.function_name),
      identityArguments: String(row.identity_arguments),
      resultType: String(row.result_type),
      language: String(row.language),
      volatility: String(row.volatility),
      parallelSafety: String(row.parallel_safety),
      securityDefiner: Boolean(row.security_definer),
      leakproof: Boolean(row.leakproof),
      configuration: Array.isArray(row.configuration) ? row.configuration.map(String) : [],
      definitionSha256: sha256(String(row.definition).replace(/\r\n?/gu, '\n')),
    }),
  );

  return { tables: names.map((name) => byTable.get(name)!), functions };
}

async function attestRuntimeMigrationLedger(
  client: PgClientLike,
  migrationPins: readonly MigrationPin[],
): Promise<void> {
  const result = await client.query(
    `SELECT id, checksum
       FROM _migrations
      ORDER BY id`,
  );
  assert(
    result.rows.length === migrationPins.length,
    `runtime migration ledger must contain exactly ${migrationPins.length} rows, found ${result.rows.length}`,
  );
  const expected = migrationPins.map((pin) => ({
    id: pin.path.replaceAll('\\', '/').split('/').at(-1)!,
    checksum: pin.sha256,
  }));
  const actual = result.rows.map((row) => ({
    id: String(row.id),
    checksum: row.checksum === null ? null : String(row.checksum),
  }));
  assert(
    valuesAreEqual(actual, expected),
    'runtime migration ledger filenames/checksums differ from the complete pinned set',
  );
}

function assertManifestSafe(manifest: SchemaManifest): void {
  const serialized = stablePrettyJson(manifest);
  assert(!/"[^"]*oid[^"]*"\s*:/i.test(serialized), 'manifest field names must not expose OIDs');
  assert(!/postgres(?:ql)?:\/\//i.test(serialized), 'manifest must not contain database URLs');
  assert(!/[A-Za-z]:\\\\(?:Users|Projects|Windows|Temp)\\\\/i.test(serialized), 'manifest must not contain absolute Windows paths');
  assert(!/\/(?:tmp|home|Users)\//.test(serialized), 'manifest must not contain absolute host paths');
}

function insertStatement(row: SeedRow): { readonly text: string; readonly values: readonly unknown[] } {
  const names = Object.keys(row.values).sort();
  assert(names.length > 0, `seed row ${row.rowId} has no values`);
  const columns = names.map(quoteIdentifier).join(', ');
  const placeholders = names.map((_, index) => `$${index + 1}`).join(', ');
  return {
    text: `INSERT INTO ${quoteIdentifier(row.table)} (${columns}) VALUES (${placeholders})`,
    values: names.map((name) => row.values[name]),
  };
}

async function insertRows(client: PgClientLike, rows: readonly SeedRow[]): Promise<void> {
  for (const row of rows) {
    const statement = insertStatement(row);
    await client.query(statement.text, statement.values);
  }
}

function primaryKeyColumns(table: CatalogTable): readonly string[] {
  const constraint = table.constraints.find((item) => item.type === 'p');
  assert(constraint !== undefined && constraint.columns.length > 0, `table ${table.table} has no primary key`);
  return constraint.columns;
}

function deleteStatement(
  row: SeedRow,
  table: CatalogTable,
): { readonly text: string; readonly values: readonly unknown[] } {
  const pk = primaryKeyColumns(table);
  const columns = pk.every((column) => Object.prototype.hasOwnProperty.call(row.values, column))
    ? pk
    : Object.keys(row.values).sort();
  assert(columns.length > 0, `cannot identify row ${row.rowId} for deletion`);
  const predicates = columns.map((column, index) => `${quoteIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`);
  return {
    text: `DELETE FROM ${quoteIdentifier(row.table)} WHERE ${predicates.join(' AND ')}`,
    values: columns.map((column) => row.values[column]),
  };
}

async function seedBaseline(client: PgClientLike, rows: readonly SeedRow[]): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await insertRows(client, rows);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const pg = errorShape(error);
    const signal = pg.constraint ? ` constraint ${pg.constraint}` : pg.column ? ` column ${pg.column}` : '';
    fail(`baseline physicalSeedPlan rejected with SQLSTATE ${pg.code ?? 'unknown'}${signal}`);
  }
}

interface PhysicalProfileDefinition {
  readonly corpusProfileId: string;
  readonly rows: readonly SeedRow[];
  readonly stateComposition: {
    readonly entitlementState: string;
    readonly delegationState: string;
    readonly participantState: string;
  };
}

function physicalProfileDefinitions(
  measurement: DelegationMeasurementAuthority,
): readonly PhysicalProfileDefinition[] {
  const delegation = measurement.corpusProfiles.map((profile) => ({
    corpusProfileId: profile.corpusProfileId,
    rows: profile.rows,
    stateComposition: {
      entitlementState: 'E0',
      delegationState: profile.delegationState,
      participantState: 'P0',
    },
  }));
  const entitlement =
    measurement.h4AcceptanceProfileSuite.entitlementProfiles
      .filter((profile) => profile.corpusProfileId !== 'H3M.D0')
      .map((profile) => ({
        corpusProfileId: profile.corpusProfileId,
        rows: profile.rows ?? [],
        stateComposition: profile.stateComposition,
      }));
  const participant =
    measurement.h4AcceptanceProfileSuite.participantProfiles
      .filter((profile) => profile.corpusProfileId === 'H3M.P1')
      .map((profile) => ({
        corpusProfileId: profile.corpusProfileId,
        rows: profile.rows ?? [],
        stateComposition: profile.stateComposition,
      }));
  const profiles = [...delegation, ...entitlement, ...participant];
  assert(
    valuesAreEqual(
      profiles.map(({ corpusProfileId }) => corpusProfileId),
      measurement.h4AcceptanceProfileSuite.profileExecutionIds,
    ),
    'physical profile definitions do not equal the ordered H4 execution suite',
  );
  return profiles;
}

interface PhysicalProfileEvidence {
  readonly profileExecutions: number;
  readonly presentDeltaRows: number;
  readonly measuredAbsenceReadbacks: number;
  readonly delegationPredicateActorChecks: number;
  readonly entitlementReadbacks: number;
  readonly participantReadbacks: number;
}

async function validatePhysicalMeasurementProfiles(
  adminClient: PgClientLike,
  appClient: PgClientLike,
  plan: PhysicalSeedPlan,
  measurement: DelegationMeasurementAuthority,
  tableMap: ReadonlyMap<string, CatalogTable>,
): Promise<PhysicalProfileEvidence> {
  const profiles = physicalProfileDefinitions(measurement);
  const actors = plan.rows
    .filter(
      (row) =>
        row.table === 'app_user' &&
        typeof row.values.id === 'string' &&
        typeof row.values.email === 'string',
    )
    .map((row) => ({
      rowId: row.rowId,
      tenantSlot:
        /^H3P\.app_user\.(T\d{2})\./.exec(row.rowId)?.[1] ?? '',
      role: row.rowId.split('.').at(-1) ?? '',
      userId: String(row.values.id),
      identity: String(row.values.email),
    }));
  assert(actors.length === 14, 'profile validation requires 14 physical actors');
  let presentDeltaRows = 0;
  let measuredAbsenceReadbacks = 0;
  let delegationPredicateActorChecks = 0;
  let entitlementReadbacks = 0;
  let participantReadbacks = 0;

  for (const profile of profiles) {
    const rows = [...profile.rows].sort(
      (left, right) =>
        left.phase - right.phase || left.rowId.localeCompare(right.rowId),
    );
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET CONSTRAINTS ALL DEFERRED');
      await insertRows(adminClient, rows);
      await adminClient.query('SET CONSTRAINTS ALL IMMEDIATE');
      await adminClient.query('COMMIT');
    } catch (error) {
      await adminClient.query('ROLLBACK').catch(() => undefined);
      const pg = errorShape(error);
      fail(
        `${profile.corpusProfileId} measured profile rejected with SQLSTATE ${pg.code ?? 'unknown'}`,
      );
    }
    presentDeltaRows += rows.length;
    try {
      for (const tenantSlot of Object.keys(plan.tenantIds).sort()) {
        const tenantId = plan.tenantIds[tenantSlot]!;
        const tenantActors = actors.filter(
          (actor) => actor.tenantSlot === tenantSlot,
        );
        assert(
          tenantActors.length === 7,
          `${profile.corpusProfileId}/${tenantSlot} lacks seven actors`,
        );
        const owner = tenantActors.find((actor) => actor.role === 'owner');
        assert(owner !== undefined, `${tenantSlot} has no owner actor`);
        await withRestrictedReadTransaction(
          appClient,
          'c3_app',
          { tenantId, userId: owner.userId },
          async () => {
            const delegationRows = await appClient.query(
              `SELECT grantee_identity,
                      (revoked_at IS NULL
                       AND starts_on <= $1::date
                       AND ends_on >= $1::date) AS active_at_frozen_date
                 FROM delegation
                ORDER BY grantee_identity`,
              [measurement.frozenAsOfDate],
            );
            const expectedDelegationCount =
              profile.stateComposition.delegationState === 'D0' ? 0 : 7;
            assert(
              delegationRows.rows.length === expectedDelegationCount,
              `${profile.corpusProfileId}/${tenantSlot} delegation readback diverges`,
            );
            if (expectedDelegationCount === 0) {
              measuredAbsenceReadbacks += 1;
            }
            const expectedActive =
              profile.stateComposition.delegationState === 'D1';
            for (const actor of tenantActors) {
              const match = delegationRows.rows.find(
                (row) => row.grantee_identity === actor.identity,
              );
              assert(
                expectedDelegationCount === 0
                  ? match === undefined
                  : match !== undefined &&
                      match.active_at_frozen_date === expectedActive,
                `${profile.corpusProfileId}/${actor.rowId} delegation predicate diverges`,
              );
              delegationPredicateActorChecks += 1;
            }

            const entitlementRows = await appClient.query(
              `SELECT module_key, state,
                      effective_from::text AS effective_from,
                      effective_until::text AS effective_until
                 FROM tenant_module_entitlement
                ORDER BY module_key`,
            );
            const expectedEntitlementCount =
              profile.stateComposition.entitlementState === 'E0' ? 0 : 1;
            assert(
              entitlementRows.rows.length === expectedEntitlementCount,
              `${profile.corpusProfileId}/${tenantSlot} entitlement readback diverges`,
            );
            if (expectedEntitlementCount === 0) {
              measuredAbsenceReadbacks += 1;
            }
            entitlementReadbacks += 1;

            const participantRows = await appClient.query(
              `SELECT thread_id, user_id::text AS user_id, role, removed_at
                 FROM comms_thread_participant
                ORDER BY thread_id, user_id`,
            );
            const expectedParticipantCount =
              profile.stateComposition.participantState === 'P1' ? 7 : 0;
            assert(
              participantRows.rows.length === expectedParticipantCount,
              `${profile.corpusProfileId}/${tenantSlot} participant readback diverges`,
            );
            if (expectedParticipantCount === 0) {
              measuredAbsenceReadbacks += 1;
            } else {
              assert(
                valuesAreEqual(
                  participantRows.rows.map((row) => String(row.user_id)).sort(),
                  tenantActors.map(({ userId }) => userId).sort(),
                ),
                `${profile.corpusProfileId}/${tenantSlot} participant actors diverge`,
              );
            }
            participantReadbacks += 1;
          },
        );
      }
    } finally {
      await adminClient.query('BEGIN');
      try {
        await adminClient.query('SET CONSTRAINTS ALL DEFERRED');
        for (const row of [...rows].reverse()) {
          const table = tableMap.get(row.table);
          assert(table !== undefined, `catalog missing ${row.table}`);
          const statement = deleteStatement(row, table);
          const result = await adminClient.query(
            statement.text,
            statement.values,
          );
          assert(
            result.rowCount === 1,
            `${profile.corpusProfileId} reset did not delete ${row.rowId}`,
          );
        }
        await adminClient.query('SET CONSTRAINTS ALL IMMEDIATE');
        await adminClient.query('COMMIT');
      } catch (error) {
        await adminClient.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
  }
  assert(
    profiles.length === 10 &&
      presentDeltaRows === 80 &&
      measuredAbsenceReadbacks === 40 &&
      delegationPredicateActorChecks === 140 &&
      entitlementReadbacks === 20 &&
      participantReadbacks === 20,
    'physical H4 profile evidence counts diverge',
  );
  return {
    profileExecutions: profiles.length,
    presentDeltaRows,
    measuredAbsenceReadbacks,
    delegationPredicateActorChecks,
    entitlementReadbacks,
    participantReadbacks,
  };
}

async function validateOverlayScenarios(
  client: PgClientLike,
  scenarios: readonly OverlayScenario[],
  baselineById: ReadonlyMap<string, SeedRow>,
  tables: ReadonlyMap<string, CatalogTable>,
  delegationAuthority: DelegationActorClassAuthority,
): Promise<readonly CheckResult[]> {
  const results: CheckResult[] = [];
  const baselineRows = [...baselineById.values()];
  assert(
    baselineRows.every((row) => row.table !== 'delegation'),
    'delegation baseline must contain exactly zero rows',
  );
  const initialDelegationCount = await client.query(
    'SELECT count(*)::int AS count FROM delegation',
  );
  assert(
    initialDelegationCount.rows[0]?.count === 0,
    'live delegation baseline must contain exactly zero rows',
  );
  let delegationScenarioCount = 0;
  let delegationResetCount = 0;
  for (const scenario of scenarios) {
    let rejection: PgErrorShape | null = null;
    await client.query('BEGIN');
    try {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const rowId of scenario.removeRowIds ?? []) {
        const row = baselineById.get(rowId);
        assert(row !== undefined, `overlay ${scenario.scenarioId} removes unknown row ${rowId}`);
        const table = tables.get(row.table)!;
        const statement = deleteStatement(row, table);
        const result = await client.query(statement.text, statement.values);
        assert(result.rowCount === 1, `overlay ${scenario.scenarioId} did not remove exactly one ${rowId}`);
      }
      await insertRows(client, scenario.rows ?? []);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      if (scenario.authorityState?.kind === 'delegation') {
        const binding = scenario.authorityState;
        const row = scenario.rows?.[0];
        assert(row !== undefined, `delegation overlay ${scenario.scenarioId} has no row`);
        const state = delegationAuthority.delegationStates[binding.state];
        assert(state !== undefined, `delegation overlay ${scenario.scenarioId} has unknown state`);
        const actorUser = baselineRows.find(
          (candidate) =>
            candidate.table === 'app_user' &&
            candidate.values.id === binding.actorUserId,
        );
        const membership = baselineRows.find(
          (candidate) =>
            candidate.table === 'tenant_membership' &&
            candidate.tenantSlot === binding.tenantSlot &&
            candidate.values.user_id === binding.actorUserId,
        );
        const roleAssignment = baselineRows.find(
          (candidate) =>
            candidate.table === 'role_assignment' &&
            candidate.tenantSlot === binding.tenantSlot &&
            candidate.values.user_id === binding.actorUserId &&
            candidate.values.role === binding.role,
        );
        const ownerUser = baselineRows.find(
          (candidate) =>
            candidate.table === 'app_user' &&
            candidate.values.email ===
              `hearth.h3.${binding.tenantSlot.toLowerCase()}.owner@synthetic.invalid`,
        );
        assert(
          actorUser?.values.email === binding.actorIdentity &&
            membership !== undefined &&
            roleAssignment !== undefined &&
            ownerUser !== undefined,
          `delegation overlay ${scenario.scenarioId} is not bound to one physical actor profile and tenant`,
        );
        const expectedColumns = [
          'created_at',
          'delegation_id',
          'ends_on',
          'granted_by',
          'grantee_identity',
          'id',
          'reason',
          'revoke_reason',
          'revoked_at',
          'revoked_by',
          'starts_on',
          'tenant_id',
          'updated_at',
          'version',
        ];
        assert(
          valuesAreEqual(Object.keys(row.values).sort(), expectedColumns),
          `delegation overlay ${scenario.scenarioId} does not author every physical column`,
        );
        const expectedRevokedBy =
          state.revokedAt === null ? null : ownerUser.values.email;
        assert(
          row.values.tenant_id ===
            (baselineRows.find(
              (candidate) =>
                candidate.table === 'tenant' &&
                candidate.tenantSlot === binding.tenantSlot,
            )?.values.id ?? null) &&
            row.values.grantee_identity === binding.actorIdentity &&
            row.values.granted_by === ownerUser.values.email &&
            row.values.starts_on === state.startsOn &&
            row.values.ends_on === state.endsOn &&
            row.values.revoked_at === state.revokedAt &&
            row.values.revoked_by === expectedRevokedBy &&
            row.values.revoke_reason ===
              (state.revokedAt === null
                ? null
                : 'HEARTH-003 synthetic revoked-state oracle.') &&
            row.values.version === (state.revokedAt === null ? 0 : 1) &&
            row.values.created_at === '2035-04-01T00:00:00.000Z' &&
            row.values.updated_at ===
              (state.revokedAt === null
                ? '2035-04-01T00:00:00.000Z'
                : state.revokedAt) &&
            row.values.reason ===
              `HEARTH-003 synthetic isolated ${binding.state} delegation for ${binding.tenantSlot} ${binding.role}.`,
          `delegation overlay ${scenario.scenarioId} diverges from its authority state`,
        );
        const effective = await client.query(
          `SELECT EXISTS (
             SELECT 1
               FROM delegation
              WHERE grantee_identity = $1
                AND revoked_at IS NULL
                AND starts_on <= $2::date
                AND ends_on >= $2::date
           ) AS active,
           (SELECT count(*)::int
              FROM delegation
             WHERE tenant_id = $3::uuid
               AND delegation_id = $4) AS exact_rows`,
          [
            binding.actorIdentity.trim().toLowerCase(),
            binding.frozenAsOfDate,
            row.values.tenant_id,
            row.values.delegation_id,
          ],
        );
        assert(
          effective.rows[0]?.active === binding.expectedHasActiveDelegation &&
            binding.expectedHasActiveDelegation ===
              state.effectiveAtFrozenDate &&
            effective.rows[0]?.exact_rows === 1,
          `delegation overlay ${scenario.scenarioId} failed live active-state semantics`,
        );
        delegationScenarioCount += 1;
      }
    } catch (error) {
      rejection = errorShape(error);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }

    if (scenario.authorityState?.kind === 'delegation') {
      const reset = await client.query(
        'SELECT count(*)::int AS count FROM delegation',
      );
      assert(
        reset.rows[0]?.count === 0,
        `delegation overlay ${scenario.scenarioId} survived transaction rollback`,
      );
      delegationResetCount += 1;
    }

    if (scenario.expected === 'accept') {
      assert(rejection === null, `overlay ${scenario.scenarioId} unexpectedly rejected with SQLSTATE ${rejection?.code ?? 'unknown'}`);
    } else {
      assert(rejection !== null, `overlay ${scenario.scenarioId} unexpectedly satisfied all physical domains`);
      const expectedStates = Array.isArray(scenario.expectedSqlState)
        ? scenario.expectedSqlState
        : scenario.expectedSqlState
          ? [scenario.expectedSqlState]
          : [];
      if (expectedStates.length > 0) {
        assert(
          rejection.code !== undefined && expectedStates.includes(rejection.code),
          `overlay ${scenario.scenarioId} rejected with unapproved SQLSTATE ${rejection.code ?? 'unknown'}`,
        );
      }
      const expectedConstraints = Array.isArray(scenario.expectedConstraint)
        ? scenario.expectedConstraint
        : scenario.expectedConstraint
          ? [scenario.expectedConstraint]
          : [];
      if (expectedConstraints.length > 0) {
        assert(
          rejection.constraint !== undefined &&
            expectedConstraints.includes(rejection.constraint),
          `overlay ${scenario.scenarioId} rejected on unapproved constraint ${rejection.constraint ?? '<none>'}`,
        );
      }
    }
    results.push({
      check: `actor-overlay:${scenario.scenarioId}`,
      status: 'PASS',
      detail:
        scenario.expected === 'accept'
          ? 'accept'
          : `reject:${rejection?.code ?? 'unknown'}:${rejection?.constraint ?? '<none>'}`,
    });
  }
  assert(
    delegationScenarioCount === 56 && delegationResetCount === 56,
    'delegation overlay execution/reset matrix must be exactly 56/56',
  );
  results.push(
    {
      check: 'delegation-d1-d4-live-state-matrix',
      status: 'PASS',
      count: delegationScenarioCount,
      detail:
        '2 tenants x 7 roles x D1-D4; exact hasActiveDelegation predicate at 2035-06-15',
    },
    {
      check: 'delegation-overlay-transaction-reset',
      status: 'PASS',
      count: delegationResetCount,
      detail: 'delegation row count returned to zero after every isolated overlay',
    },
  );
  return results;
}

type RestrictedRole = 'c3_app' | 'c3_auth';

interface ActorContext {
  readonly tenantId: string;
  readonly userId: string;
}

async function withRestrictedReadTransaction<T>(
  client: PgClientLike,
  role: RestrictedRole,
  context: ActorContext | null,
  action: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query('SET LOCAL row_security = on');
    if (context !== null) {
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [context.tenantId, context.userId],
      );
      const bound = await client.query(
        'SELECT current_tenant_id()::text AS tenant_id, current_user_id()::text AS user_id',
      );
      assert(
        bound.rows[0]?.tenant_id === context.tenantId &&
          bound.rows[0]?.user_id === context.userId,
        `${role} transaction did not bind the exact tenant/user context`,
      );
    }
    const result = await action();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function attestRestrictedRole(
  client: PgClientLike,
  role: RestrictedRole,
): Promise<void> {
  await withRestrictedReadTransaction(client, role, null, async () => {
    const result = await client.query(
      `SELECT session_user::text AS session_user,
              current_user::text AS current_user,
              rolsuper,
              rolbypassrls,
              current_setting('row_security') AS row_security
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    assert(result.rows.length === 1, `${role} role attestation returned no role`);
    const row = result.rows[0]!;
    assert(
      row.session_user === role && row.current_user === role,
      `${role} connection is not using the expected session/current role`,
    );
    assert(
      row.rolsuper === false && row.rolbypassrls === false,
      `${role} must be NOSUPERUSER NOBYPASSRLS`,
    );
    assert(row.row_security === 'on', `${role} must keep row_security on`);
  });
}

function canonicalRowSet(rows: readonly Record<string, unknown>[]): readonly string[] {
  return rows.map((row) => canonicalJson(row)).sort();
}

async function tableIdentityRows(
  client: PgClientLike,
  table: CatalogTable,
  tenantId?: string,
): Promise<readonly string[]> {
  const primaryKey = primaryKeyColumns(table);
  const selected = [
    ...(table.columns.some((column) => column.name === 'tenant_id')
      ? ['tenant_id']
      : []),
    ...primaryKey.filter((column) => column !== 'tenant_id'),
  ];
  assert(selected.length > 0, `table ${table.table} has no stable identity columns`);
  const columns = selected.map(quoteIdentifier).join(', ');
  const where = tenantId === undefined ? '' : ' WHERE tenant_id = $1::uuid';
  const order = selected.map(quoteIdentifier).join(', ');
  const result = await client.query(
    `SELECT ${columns} FROM ${quoteIdentifier(table.table)}${where} ORDER BY ${order}`,
    tenantId === undefined ? [] : [tenantId],
  );
  return canonicalRowSet(result.rows);
}

async function expectPermissionDenied(
  client: PgClientLike,
  role: RestrictedRole,
  sql: string,
  label: string,
  mode: 'read' | 'write' = 'read',
): Promise<void> {
  let rejection: PgErrorShape | null = null;
  await client.query(mode === 'read' ? 'BEGIN READ ONLY' : 'BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query('SET LOCAL row_security = on');
    await client.query(sql);
  } catch (error) {
    rejection = errorShape(error);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
  assert(rejection !== null, `${label} unexpectedly succeeded`);
  assert(
    rejection.code === '42501',
    `${label} rejected with ${rejection.code ?? 'unknown'} instead of 42501`,
  );
}

interface ProjectionValidationEvidence {
  readonly totalFixtures: number;
  readonly includedFixtures: number;
  readonly staticallyExcludedFixtures: number;
  readonly crossTenantDenials: number;
}

interface GuardRuntimeInput {
  readonly query: string;
  readonly scalarValue: string | null;
  readonly listValues: readonly string[];
}

interface GuardBranchEvidence {
  readonly hitPositive: number;
  readonly hitNegative: number;
  readonly claimNull: number;
  readonly claimEqual: number;
  readonly claimDistinctDenied: number;
  readonly documentSingleton: number;
  readonly documentNonmatchingDenied: number;
  readonly documentEmptyDenied: number;
  readonly documentMiddleMember: number;
  readonly temporarilyAdmittedStaticRows: number;
}

function escapeLikeForPostgres(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function guardedProjectionLookup(
  spec: ProjectionAuthoritySpec,
  guardProgram: ProjectionAuthorityParseResult['guardProgram'],
  input: GuardRuntimeInput,
  exactTenantSource: boolean,
): { readonly text: string; readonly values: readonly unknown[] } {
  assert(
    guardProgram.baseHit.columnTransform === 'lower' &&
      guardProgram.baseHit.operator === 'LIKE' &&
      guardProgram.baseHit.join === 'OR' &&
      guardProgram.baseHit.queryTransform ===
        'postgres_like_escape_contains',
    'guard compiler does not recognize the derived hit program',
  );
  const values: unknown[] = [spec.kind];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const like = `%${escapeLikeForPostgres(input.query)}%`;
  const hit = spec.match
    .map(
      (column) =>
        `lower(${quoteIdentifier(column)}) LIKE ${next(like)}`,
    )
    .join(' OR ');
  const guards = [`(${hit})`];
  if (spec.extraWhere !== null) {
    assert(
      SIMPLE_IDENTIFIER.test(spec.extraWhere),
      `guard compiler requires extension for extraWhere ${spec.kind}.${spec.extraWhere}`,
    );
    guards.push(`(${quoteIdentifier(spec.extraWhere)})`);
  }
  if (spec.kind === guardProgram.scalarNullableGate.register) {
    assert(
      guardProgram.scalarNullableGate.activeWhen === 'not_null' &&
        guardProgram.scalarNullableGate.operator === '=',
      'guard compiler does not recognize the derived scalar gate',
    );
    if (input.scalarValue !== null) {
      guards.push(
        `${quoteIdentifier(
          guardProgram.scalarNullableGate.column,
        )} = ${next(input.scalarValue)}`,
      );
    }
  }
  if (spec.kind === guardProgram.listGate.register) {
    assert(
      guardProgram.listGate.operator === 'IN' &&
        guardProgram.listGate.emptyBehavior === 'false' &&
        guardProgram.listGate.elementBinding === 'all',
      'guard compiler does not recognize the derived list gate',
    );
    if (input.listValues.length === 0) {
      guards.push('false');
    } else {
      guards.push(
        `${quoteIdentifier(
          guardProgram.listGate.column,
        )} IN (${input.listValues.map((value) => next(value)).join(', ')})`,
      );
    }
  }
  if (exactTenantSource) {
    guards.push(`tenant_id = ${next(inputTenantMarker)}::uuid`);
  }
  guards.push(`${quoteIdentifier(spec.id)} = ${next(inputRecordMarker)}::text`);
  return {
    text: `SELECT $1::text AS kind,
                 ${spec.id}::text AS id,
                 (${spec.title})::text AS title,
                 (${spec.subtitle})::text AS subtitle,
                 (${spec.parent})::text AS parent_id
            FROM ${quoteIdentifier(spec.table)}
           WHERE ${guards.join(' AND ')}`,
    values,
  };
}

const inputTenantMarker = Symbol('tenant marker');
const inputRecordMarker = Symbol('record marker');

function bindGuardLookupMarkers(
  statement: ReturnType<typeof guardedProjectionLookup>,
  tenantId: string | null,
  recordId: string,
): { readonly text: string; readonly values: readonly unknown[] } {
  return {
    text: statement.text,
    values: statement.values.map((value) =>
      value === inputTenantMarker
        ? tenantId
        : value === inputRecordMarker
          ? recordId
          : value,
    ),
  };
}

function rlsIdentityProjectionLookup(
  spec: ProjectionAuthoritySpec,
  tenantId: string,
  recordId: string,
): { readonly text: string; readonly values: readonly unknown[] } {
  return {
    text: `SELECT $1::text AS kind,
                  ${spec.id}::text AS id,
                  (${spec.title})::text AS title,
                  (${spec.subtitle})::text AS subtitle,
                  (${spec.parent})::text AS parent_id
             FROM ${quoteIdentifier(spec.table)}
            WHERE tenant_id = $2::uuid
              AND ${quoteIdentifier(spec.id)} = $3::text`,
    values: [spec.kind, tenantId, recordId],
  };
}

function expectedStaticGuardOutcome(
  row: SeedRow,
  spec: ProjectionAuthoritySpec,
): boolean {
  if (spec.extraWhere === null) return true;
  assert(
    SIMPLE_IDENTIFIER.test(spec.extraWhere),
    `static guard ${spec.kind}.${spec.extraWhere} requires validator extension before PASS`,
  );
  const value = row.values[spec.extraWhere];
  assert(
    typeof value === 'boolean',
    `fixture ${row.source?.fixtureId ?? row.rowId} must author Boolean ${spec.extraWhere}`,
  );
  return value;
}

async function validateProjections(
  appClient: PgClientLike,
  contract: FixtureContract,
  plan: PhysicalSeedPlan,
  projectionAuthority: ProjectionAuthorityParseResult,
  actorUserIdByTenantSlot: ReadonlyMap<string, string>,
): Promise<ProjectionValidationEvidence> {
  const specByRegister = new Map(
    projectionAuthority.specs.map((spec) => [spec.kind, spec]),
  );
  assert(specByRegister.size === 17, 'pinned projection authority must contain 17 registers');
  const fixtureById = new Map<string, ContractFixture>();
  for (const fixture of contract.fixtures) {
    assert(typeof fixture.fixtureId === 'string' && fixture.fixtureId.length > 0, 'fixtureId is required');
    assert(!fixtureById.has(fixture.fixtureId), `duplicate fixtureId ${fixture.fixtureId}`);
    fixtureById.set(fixture.fixtureId, fixture);
  }

  const rowsByFixture = new Map<string, SeedRow[]>();
  for (const row of plan.rows) {
    const fixtureId = row.source?.fixtureId;
    if (!fixtureId) continue;
    const list = rowsByFixture.get(fixtureId) ?? [];
    list.push(row);
    rowsByFixture.set(fixtureId, list);
  }
  assert(rowsByFixture.size === fixtureById.size, 'not every fixture has exactly one physicalSeedPlan source row');

  const resolved = contract.fixtures.map((fixture) => {
    const physicalRows = rowsByFixture.get(fixture.fixtureId) ?? [];
    assert(
      physicalRows.length === 1,
      `fixture ${fixture.fixtureId} must map to exactly one physical row`,
    );
    const row = physicalRows[0]!;
    const register = row.source?.register ?? fixture.source.register;
    assert(
      register === fixture.source.register,
      `fixture ${fixture.fixtureId} physical register diverges`,
    );
    const spec = specByRegister.get(register);
    assert(
      spec !== undefined,
      `fixture ${fixture.fixtureId} uses unsupported projection register ${register}`,
    );
    assert(
      row.table === spec.table,
      `fixture ${fixture.fixtureId} maps register ${register} to wrong table ${row.table}`,
    );
    assert(
      row.tenantSlot === fixture.source.tenantSlot,
      `fixture ${fixture.fixtureId} tenantSlot diverges`,
    );
    assert(
      row.values[spec.id] === fixture.source.recordId,
      `fixture ${fixture.fixtureId} recordId diverges from physical row`,
    );
    if (row.approvedProjection !== undefined) {
      assert(
        valuesAreEqual(row.approvedProjection, fixture.approvedProjection),
        `fixture ${fixture.fixtureId} has two divergent approvedProjection copies`,
      );
    }
    const included = expectedStaticGuardOutcome(row, spec);
    if (spec.extraWhere !== null) {
      assert(
        fixture.rowFacts.active === included,
        `fixture ${fixture.fixtureId} rowFacts.active diverges from derived static guard`,
      );
    }
    return { fixture, row, register, spec, included };
  });

  let includedFixtures = 0;
  let staticallyExcludedFixtures = 0;
  let crossTenantDenials = 0;
  for (const tenantSlot of Object.keys(plan.tenantIds).sort()) {
    const tenantId = plan.tenantIds[tenantSlot]!;
    const userId = actorUserIdByTenantSlot.get(tenantSlot);
    assert(userId !== undefined, `no physical actor user for ${tenantSlot}`);
    await withRestrictedReadTransaction(
      appClient,
      'c3_app',
      { tenantId, userId },
      async () => {
        for (const item of resolved) {
          if (item.fixture.source.tenantSlot === tenantSlot) {
            const result = await appClient.query(
              ...(() => {
                const statement = bindGuardLookupMarkers(
                  guardedProjectionLookup(
                    item.spec,
                    projectionAuthority.guardProgram,
                    {
                      query: item.fixture.source.recordId.toLowerCase(),
                      scalarValue: null,
                      listValues:
                        item.spec.kind ===
                        projectionAuthority.guardProgram.listGate.register
                          ? [String(
                              item.row.values[
                                projectionAuthority.guardProgram.listGate
                                  .column
                              ],
                            )]
                          : [],
                    },
                    false,
                  ),
                  null,
                  item.fixture.source.recordId,
                );
                return [statement.text, statement.values] as const;
              })(),
            );
            const expectedCount = item.included ? 1 : 0;
            assert(
              result.rows.length === expectedCount,
              `fixture ${item.fixture.fixtureId} source-derived search projection resolved ${result.rows.length} rows instead of ${expectedCount}`,
            );
            if (item.included) {
              const actual = normalizeProjection(result.rows[0]!);
              assert(
                valuesAreEqual(actual, item.fixture.approvedProjection),
                `fixture ${item.fixture.fixtureId} source-derived search projection differs from approvedProjection`,
              );
              includedFixtures += 1;
            } else {
              staticallyExcludedFixtures += 1;
            }
          } else {
            const sourceTenantId =
              plan.tenantIds[item.fixture.source.tenantSlot];
            assert(
              sourceTenantId !== undefined,
              `fixture ${item.fixture.fixtureId} names unknown tenantSlot`,
            );
            const statement = rlsIdentityProjectionLookup(
              item.spec,
              sourceTenantId,
              item.fixture.source.recordId,
            );
            const denied = await appClient.query(
              statement.text,
              statement.values,
            );
            assert(
              denied.rows.length === 0,
              `fixture ${item.fixture.fixtureId} crossed the c3_app RLS tenant boundary`,
            );
            crossTenantDenials += 1;
          }
        }
      },
    );
  }
  assert(
    includedFixtures + staticallyExcludedFixtures === contract.fixtures.length,
    'not every fixture received one same-tenant projection outcome',
  );
  assert(
    crossTenantDenials === contract.fixtures.length,
    'not every fixture received one opposite-tenant RLS denial',
  );
  return {
    totalFixtures: contract.fixtures.length,
    includedFixtures,
    staticallyExcludedFixtures,
    crossTenantDenials,
  };
}

function updateRowBooleanStatement(
  row: SeedRow,
  table: CatalogTable,
  column: string,
  value: boolean,
): { readonly text: string; readonly values: readonly unknown[] } {
  const primaryKey = primaryKeyColumns(table);
  const columns = primaryKey.every((key) => Object.hasOwn(row.values, key))
    ? [...primaryKey]
    : [
        'tenant_id',
        ...Object.keys(row.values).filter(
          (key) =>
            key !== 'tenant_id' &&
            row.source?.recordId !== undefined &&
            row.values[key] === row.source.recordId,
        ),
      ];
  assert(
    columns.length === 2 &&
      columns.every((key) => Object.hasOwn(row.values, key)),
    `row ${row.rowId} has no exact authored primary/business identity`,
  );
  const predicates = columns.map(
    (key, index) =>
      `${quoteIdentifier(key)} IS NOT DISTINCT FROM $${index + 2}`,
  );
  return {
    text: `UPDATE ${quoteIdentifier(row.table)}
              SET ${quoteIdentifier(column)} = $1
            WHERE ${predicates.join(' AND ')}`,
    values: [value, ...columns.map((key) => row.values[key])],
  };
}

async function setStaticGuardRows(
  adminClient: PgClientLike,
  rows: readonly SeedRow[],
  tableMap: ReadonlyMap<string, CatalogTable>,
  value: boolean,
): Promise<void> {
  await adminClient.query('BEGIN');
  try {
    for (const row of rows) {
      const table = tableMap.get(row.table);
      assert(table !== undefined, `catalog missing ${row.table}`);
      const statement = updateRowBooleanStatement(
        row,
        table,
        'is_active',
        value,
      );
      const result = await adminClient.query(
        statement.text,
        statement.values,
      );
      assert(
        result.rowCount === 1,
        `static-guard mutation did not identify exactly ${row.rowId}`,
      );
    }
    await adminClient.query('COMMIT');
  } catch (error) {
    await adminClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function validateRuntimeGuardBranches(
  adminClient: PgClientLike,
  appClient: PgClientLike,
  contract: FixtureContract,
  plan: PhysicalSeedPlan,
  projectionAuthority: ProjectionAuthorityParseResult,
  actorUserIdByTenantSlot: ReadonlyMap<string, string>,
  tableMap: ReadonlyMap<string, CatalogTable>,
): Promise<GuardBranchEvidence> {
  const specByRegister = new Map(
    projectionAuthority.specs.map((spec) => [spec.kind, spec]),
  );
  const rowByFixture = new Map(
    plan.rows
      .filter((row) => typeof row.source?.fixtureId === 'string')
      .map((row) => [row.source!.fixtureId!, row]),
  );
  const items = contract.fixtures.map((fixture) => {
    const row = rowByFixture.get(fixture.fixtureId);
    const spec = specByRegister.get(fixture.source.register);
    assert(
      row !== undefined && spec !== undefined,
      `guard proof cannot resolve ${fixture.fixtureId}`,
    );
    return { fixture, row, spec };
  });
  const staticRows = items
    .filter(({ row, spec }) => !expectedStaticGuardOutcome(row, spec))
    .map(({ row }) => row);
  assert(
    staticRows.length === 3,
    `guard proof expected three static exclusions, found ${staticRows.length}`,
  );
  await setStaticGuardRows(adminClient, staticRows, tableMap, true);

  let hitPositive = 0;
  let hitNegative = 0;
  let claimNull = 0;
  let claimEqual = 0;
  let claimDistinctDenied = 0;
  let documentSingleton = 0;
  let documentNonmatchingDenied = 0;
  let documentEmptyDenied = 0;
  let documentMiddleMember = 0;
  try {
    for (const tenantSlot of Object.keys(plan.tenantIds).sort()) {
      const tenantId = plan.tenantIds[tenantSlot]!;
      const userId = actorUserIdByTenantSlot.get(tenantSlot);
      assert(userId !== undefined, `guard proof has no actor for ${tenantSlot}`);
      await withRestrictedReadTransaction(
        appClient,
        'c3_app',
        { tenantId, userId },
        async () => {
          for (const { fixture, row, spec } of items.filter(
            (item) => item.fixture.source.tenantSlot === tenantSlot,
          )) {
            const recordId = fixture.source.recordId;
            const actualListValue =
              spec.kind === projectionAuthority.guardProgram.listGate.register
                ? String(
                    row.values[
                      projectionAuthority.guardProgram.listGate.column
                    ],
                  )
                : '';
            const admitted: GuardRuntimeInput = {
              query: recordId.toLowerCase(),
              scalarValue: null,
              listValues: actualListValue ? [actualListValue] : [],
            };
            const positive = bindGuardLookupMarkers(
              guardedProjectionLookup(
                spec,
                projectionAuthority.guardProgram,
                admitted,
                false,
              ),
              null,
              recordId,
            );
            const positiveResult = await appClient.query(
              positive.text,
              positive.values,
            );
            assert(
              positiveResult.rows.length === 1,
              `${fixture.fixtureId} did not fire the positive hit guard`,
            );
            hitPositive += 1;

            const absentQuery =
              `__hearth_guard_absent_${sha256(fixture.fixtureId).slice(0, 20)}__`;
            for (const column of spec.match) {
              const physical = row.values[column];
              assert(
                physical === null ||
                  physical === undefined ||
                  !String(physical).toLowerCase().includes(
                    absentQuery.toLowerCase(),
                  ),
                `${fixture.fixtureId} negative hit sentinel collides with ${column}`,
              );
            }
            const negative = bindGuardLookupMarkers(
              guardedProjectionLookup(
                spec,
                projectionAuthority.guardProgram,
                { ...admitted, query: absentQuery },
                false,
              ),
              null,
              recordId,
            );
            const negativeResult = await appClient.query(
              negative.text,
              negative.values,
            );
            assert(
              negativeResult.rows.length === 0,
              `${fixture.fixtureId} did not fire the negative hit guard`,
            );
            hitNegative += 1;

            if (
              spec.kind ===
              projectionAuthority.guardProgram.scalarNullableGate.register
            ) {
              const physicalValue = String(
                row.values[
                  projectionAuthority.guardProgram.scalarNullableGate.column
                ],
              );
              for (const [label, scalarValue, expected] of [
                ['null', null, 1],
                ['equal', physicalValue, 1],
                [
                  'distinct',
                  `distinct.${sha256(fixture.fixtureId).slice(0, 16)}@synthetic.invalid`,
                  0,
                ],
              ] as const) {
                const statement = bindGuardLookupMarkers(
                  guardedProjectionLookup(
                    spec,
                    projectionAuthority.guardProgram,
                    {
                      query: recordId.toLowerCase(),
                      scalarValue,
                      listValues: [],
                    },
                    false,
                  ),
                  null,
                  recordId,
                );
                const result = await appClient.query(
                  statement.text,
                  statement.values,
                );
                assert(
                  result.rows.length === expected,
                  `${fixture.fixtureId} scalar ${label} branch did not discriminate`,
                );
                if (label === 'null') claimNull += 1;
                else if (label === 'equal') claimEqual += 1;
                else claimDistinctDenied += 1;
              }
            }

            if (
              spec.kind ===
              projectionAuthority.guardProgram.listGate.register
            ) {
              const actual = actualListValue;
              const different =
                `NoMatch${sha256(fixture.fixtureId).slice(0, 12)}`;
              for (const [label, listValues, expected] of [
                ['singleton', [actual], 1],
                ['nonmatching', [different], 0],
                ['empty', [], 0],
                ['middle', [`Left${different}`, actual, `Right${different}`], 1],
              ] as const) {
                const statement = bindGuardLookupMarkers(
                  guardedProjectionLookup(
                    spec,
                    projectionAuthority.guardProgram,
                    {
                      query: recordId.toLowerCase(),
                      scalarValue: null,
                      listValues,
                    },
                    false,
                  ),
                  null,
                  recordId,
                );
                const result = await appClient.query(
                  statement.text,
                  statement.values,
                );
                assert(
                  result.rows.length === expected,
                  `${fixture.fixtureId} document ${label} branch did not discriminate`,
                );
                if (label === 'singleton') documentSingleton += 1;
                else if (label === 'nonmatching')
                  documentNonmatchingDenied += 1;
                else if (label === 'empty') documentEmptyDenied += 1;
                else documentMiddleMember += 1;
              }
            }
          }
        },
      );
    }
  } finally {
    await setStaticGuardRows(adminClient, staticRows, tableMap, false);
  }

  assert(
    hitPositive === 356 &&
      hitNegative === 356 &&
      claimNull === 22 &&
      claimEqual === 22 &&
      claimDistinctDenied === 22 &&
      documentSingleton === 31 &&
      documentNonmatchingDenied === 31 &&
      documentEmptyDenied === 31 &&
      documentMiddleMember === 31,
    'complete runtime guard branch counts diverge',
  );
  return {
    hitPositive,
    hitNegative,
    claimNull,
    claimEqual,
    claimDistinctDenied,
    documentSingleton,
    documentNonmatchingDenied,
    documentEmptyDenied,
    documentMiddleMember,
    temporarilyAdmittedStaticRows: staticRows.length,
  };
}

function validateOwnClaimActorBindings(
  contract: FixtureContract,
  plan: PhysicalSeedPlan,
  projectionAuthority: ProjectionAuthorityParseResult,
): number {
  const claimRegister =
    projectionAuthority.guardProgram.scalarNullableGate.register;
  const claimColumn =
    projectionAuthority.guardProgram.scalarNullableGate.column;
  const rowByFixture = new Map(
    plan.rows
      .filter((row) => typeof row.source?.fixtureId === 'string')
      .map((row) => [row.source!.fixtureId!, row]),
  );
  let count = 0;
  for (const fixture of contract.fixtures) {
    if (
      fixture.source.register !== claimRegister ||
      fixture.rowFacts.submittedByRelation !== 'actor_identity'
    ) {
      continue;
    }
    const row = rowByFixture.get(fixture.fixtureId);
    assert(row !== undefined, `own claim ${fixture.fixtureId} has no row`);
    const hrActor = plan.rows.find(
      (candidate) =>
        candidate.rowId ===
        `H3P.app_user.${fixture.source.tenantSlot}.hr`,
    );
    assert(
      typeof hrActor?.values.email === 'string' &&
        row.values[claimColumn] === hrActor.values.email,
      `own claim ${fixture.fixtureId} is not bound to the real HR actor identity`,
    );
    count += 1;
  }
  assert(count === 9, `expected nine own-claim actor bindings, found ${count}`);
  return count;
}

function visibilityProbeRows(plan: PhysicalSeedPlan): readonly SeedRow[] {
  const baselineGroups = new Set(
    plan.rows
      .filter((row) => row.tenantSlot !== null)
      .map((row) => `${row.table}\0${row.tenantSlot}`),
  );
  const selected = new Map<string, SeedRow>();
  for (const scenario of plan.overlayScenarios) {
    if (scenario.expected !== 'accept') continue;
    for (const row of scenario.rows ?? []) {
      if (row.tenantSlot === null) continue;
      const key = `${row.table}\0${row.tenantSlot}`;
      if (!baselineGroups.has(key) && !selected.has(key)) {
        selected.set(key, row);
      }
    }
  }
  return [...selected.values()].sort(
    (left, right) =>
      left.phase - right.phase || left.rowId.localeCompare(right.rowId),
  );
}

async function seedVisibilityProbeRows(
  adminClient: PgClientLike,
  rows: readonly SeedRow[],
): Promise<void> {
  await adminClient.query('BEGIN');
  try {
    await adminClient.query('SET CONSTRAINTS ALL DEFERRED');
    await insertRows(adminClient, rows);
    await adminClient.query('SET CONSTRAINTS ALL IMMEDIATE');
    await adminClient.query('COMMIT');
  } catch (error) {
    await adminClient.query('ROLLBACK').catch(() => undefined);
    const rejection = errorShape(error);
    fail(
      `visibility probe rows rejected with SQLSTATE ${rejection.code ?? 'unknown'} constraint ${rejection.constraint ?? '<none>'}`,
    );
  }
}

interface RlsVisibilityEvidence {
  readonly checks: readonly CheckResult[];
  readonly actorUserIdByTenantSlot: ReadonlyMap<string, string>;
  readonly appReadableTables: readonly string[];
  readonly policyCoverageCount: number;
}

async function validateNonSuperuserRlsVisibility(
  adminClient: PgClientLike,
  appClient: PgClientLike,
  authClient: PgClientLike,
  plan: PhysicalSeedPlan,
  catalog: readonly CatalogTable[],
): Promise<RlsVisibilityEvidence> {
  await attestRestrictedRole(appClient, 'c3_app');
  await attestRestrictedRole(authClient, 'c3_auth');

  const tableByName = new Map(catalog.map((table) => [table.table, table]));
  const rlsTables = catalog.filter((table) => table.rowLevelSecurity);
  assert(rlsTables.length === 27, `expected 27 touched RLS tables, found ${rlsTables.length}`);
  const policyCount = rlsTables.reduce(
    (count, table) => count + table.policies.length,
    0,
  );
  assert(policyCount === 29, `expected 29 touched RLS policies, found ${policyCount}`);

  const appReadableTables: CatalogTable[] = [];
  await withRestrictedReadTransaction(appClient, 'c3_app', null, async () => {
    for (const table of rlsTables) {
      const privilege = await appClient.query(
        "SELECT has_table_privilege(current_user, $1, 'SELECT') AS allowed",
        [`public.${table.table}`],
      );
      if (privilege.rows[0]?.allowed === true) appReadableTables.push(table);
    }
  });
  appReadableTables.sort((left, right) => left.table.localeCompare(right.table));
  assert(
    appReadableTables.length === 25,
    `expected 25 c3_app-readable touched RLS tables, found ${appReadableTables.length}`,
  );

  const controlPlaneNames = ['role_assignment', 'tenant_membership'] as const;
  const controlPlaneTables = controlPlaneNames.map((name) => {
    const table = tableByName.get(name);
    assert(table !== undefined && table.rowLevelSecurity, `${name} RLS catalog entry is missing`);
    return table;
  });
  const appNames = new Set(appReadableTables.map((table) => table.table));
  for (const table of controlPlaneTables) {
    assert(!appNames.has(table.table), `${table.table} must not be directly readable by c3_app`);
  }
  assert(
    new Set([...appReadableTables, ...controlPlaneTables].map((table) => table.table)).size ===
      rlsTables.length,
    'non-superuser role matrix does not cover every touched RLS table',
  );

  const actors = plan.rows
    .filter(
      (row) =>
        row.table === 'tenant_membership' &&
        row.tenantSlot !== null &&
        typeof row.values.user_id === 'string',
    )
    .map((row) => ({
      tenantSlot: row.tenantSlot!,
      tenantId: plan.tenantIds[row.tenantSlot!]!,
      userId: String(row.values.user_id),
    }))
    .sort(
      (left, right) =>
        left.tenantSlot.localeCompare(right.tenantSlot) ||
        left.userId.localeCompare(right.userId),
    );
  assert(actors.length === 14, `expected 14 physical actors, found ${actors.length}`);
  assert(new Set(actors.map((actor) => actor.userId)).size === 14, 'physical actor user IDs must be unique');
  for (const tenantSlot of Object.keys(plan.tenantIds)) {
    assert(
      actors.filter((actor) => actor.tenantSlot === tenantSlot).length === 7,
      `${tenantSlot} must expose exactly seven physical actors`,
    );
  }
  const actorUserIdByTenantSlot = new Map<string, string>();
  for (const actor of actors) {
    if (!actorUserIdByTenantSlot.has(actor.tenantSlot)) {
      actorUserIdByTenantSlot.set(actor.tenantSlot, actor.userId);
    }
  }

  const expectedIdentitySets = new Map<string, readonly string[]>();
  for (const table of appReadableTables) {
    for (const [tenantSlot, tenantId] of Object.entries(plan.tenantIds)) {
      expectedIdentitySets.set(
        `${table.table}\0${tenantSlot}`,
        await tableIdentityRows(adminClient, table, tenantId),
      );
    }
  }

  await withRestrictedReadTransaction(appClient, 'c3_app', null, async () => {
    for (const table of appReadableTables) {
      const rows = await tableIdentityRows(appClient, table);
      assert(
        rows.length === 0,
        `${table.table} exposed rows to c3_app without tenant context`,
      );
    }
  });

  let actorTableComparisons = 0;
  let contextResetChecks = 0;
  const resetProbeTable = appReadableTables[0]!;
  for (const actor of actors) {
    await withRestrictedReadTransaction(
      appClient,
      'c3_app',
      { tenantId: actor.tenantId, userId: actor.userId },
      async () => {
        for (const table of appReadableTables) {
          const actual = await tableIdentityRows(appClient, table);
          const expected =
            expectedIdentitySets.get(`${table.table}\0${actor.tenantSlot}`) ??
            [];
          assert(
            valuesAreEqual(actual, expected),
            `${table.table} c3_app identity set diverges for ${actor.tenantSlot}`,
          );
          actorTableComparisons += 1;
        }
      },
    );
    await withRestrictedReadTransaction(appClient, 'c3_app', null, async () => {
      const rows = await tableIdentityRows(appClient, resetProbeTable);
      assert(
        rows.length === 0,
        `c3_app tenant context survived transaction end after ${actor.tenantSlot}`,
      );
      contextResetChecks += 1;
    });
  }

  const identityTableNames = [
    'tenant',
    'app_user',
    'tenant_membership',
    'role_assignment',
  ] as const;
  for (const table of identityTableNames) {
    await expectPermissionDenied(
      appClient,
      'c3_app',
      `SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`,
      `c3_app direct identity read ${table}`,
    );
  }

  const expectedControlPlane = new Map<string, readonly string[]>();
  for (const tableName of identityTableNames) {
    const table = tableByName.get(tableName);
    assert(table !== undefined, `${tableName} catalog entry is missing`);
    expectedControlPlane.set(
      tableName,
      await tableIdentityRows(adminClient, table),
    );
  }
  await withRestrictedReadTransaction(authClient, 'c3_auth', null, async () => {
    for (const tableName of identityTableNames) {
      const table = tableByName.get(tableName)!;
      const actual = await tableIdentityRows(authClient, table);
      assert(
        valuesAreEqual(actual, expectedControlPlane.get(tableName)),
        `c3_auth control-plane identity set diverges for ${tableName}`,
      );
    }
  });
  const firstTenantSlot = Object.keys(plan.tenantIds).sort()[0]!;
  const firstAuthActor = actors.find(
    (actor) => actor.tenantSlot === firstTenantSlot,
  )!;
  await withRestrictedReadTransaction(
    authClient,
    'c3_auth',
    {
      tenantId: firstAuthActor.tenantId,
      userId: firstAuthActor.userId,
    },
    async () => {
      for (const table of controlPlaneTables) {
        const actual = await tableIdentityRows(authClient, table);
        assert(
          valuesAreEqual(actual, expectedControlPlane.get(table.table)),
          `${table.table} c3_auth resolution policy was incorrectly tenant-narrowed`,
        );
      }
    },
  );

  for (const table of appReadableTables) {
    await expectPermissionDenied(
      authClient,
      'c3_auth',
      `SELECT 1 FROM ${quoteIdentifier(table.table)} LIMIT 1`,
      `c3_auth business read ${table.table}`,
    );
  }
  await expectPermissionDenied(
    authClient,
    'c3_auth',
    'UPDATE app_user SET display_name = display_name WHERE false',
    'c3_auth identity write',
    'write',
  );

  const coveredPolicies = new Set<string>();
  for (const table of appReadableTables) {
    for (const policy of table.policies) {
      coveredPolicies.add(`${table.table}\0${policy.name}`);
    }
  }
  for (const table of controlPlaneTables) {
    for (const policy of table.policies) {
      coveredPolicies.add(`${table.table}\0${policy.name}`);
    }
  }
  const declaredPolicies = new Set(
    rlsTables.flatMap((table) =>
      table.policies.map((policy) => `${table.table}\0${policy.name}`),
    ),
  );
  assert(
    valuesAreEqual([...coveredPolicies].sort(), [...declaredPolicies].sort()),
    'non-superuser policy coverage does not equal the manifest policy set',
  );

  return {
    actorUserIdByTenantSlot,
    appReadableTables: appReadableTables.map((table) => table.table),
    policyCoverageCount: coveredPolicies.size,
    checks: [
      {
        check: 'restricted-role-attestation',
        status: 'PASS',
        count: 2,
        detail: 'c3_app and c3_auth session/current roles are NOSUPERUSER NOBYPASSRLS with row_security=on',
      },
      {
        check: 'app-role-missing-context-denial',
        status: 'PASS',
        count: appReadableTables.length,
        detail: 'every c3_app-readable touched RLS table returned the empty set without app.tenant_id',
      },
      {
        check: 'app-role-rls-actor-matrix',
        status: 'PASS',
        count: actorTableComparisons,
        detail: `${actors.length} physical actors x ${appReadableTables.length} exact catalog-PK sets; no explicit tenant predicate`,
      },
      {
        check: 'transaction-local-context-reset',
        status: 'PASS',
        count: contextResetChecks,
      },
      {
        check: 'auth-role-control-plane-policy',
        status: 'PASS',
        count: identityTableNames.length,
        detail: 'exact cross-tenant identity sets; tenant_membership and role_assignment use their combined permissive auth-resolution policy behavior',
      },
      {
        check: 'restricted-role-grant-denials',
        status: 'PASS',
        count: identityTableNames.length + appReadableTables.length + 1,
        detail: 'c3_app identity reads, c3_auth business reads, and c3_auth identity write rejected with 42501',
      },
      {
        check: 'non-superuser-rls-policy-coverage',
        status: 'PASS',
        count: coveredPolicies.size,
        detail: 'all 29 manifest policies reached through c3_app or c3_auth; permissive control-plane policies are proven as their intended combined OR behavior',
      },
    ],
  };
}

async function validateStaticGuardNegativeControls(
  appClient: PgClientLike,
  plan: PhysicalSeedPlan,
  projectionAuthority: ProjectionAuthorityParseResult,
  actorUserIdByTenantSlot: ReadonlyMap<string, string>,
  tableByName: ReadonlyMap<string, CatalogTable>,
): Promise<number> {
  let count = 0;
  for (const spec of projectionAuthority.specs) {
    if (spec.extraWhere === null) continue;
    assert(
      SIMPLE_IDENTIFIER.test(spec.extraWhere),
      `static guard ${spec.kind}.${spec.extraWhere} negative control requires validator extension before PASS`,
    );
    const table = tableByName.get(spec.table);
    assert(table !== undefined, `static guard table ${spec.table} is absent`);
    const column = table.columns.find(
      (candidate) => candidate.name === spec.extraWhere,
    );
    assert(
      column?.dataType === 'boolean',
      `static guard ${spec.kind}.${spec.extraWhere} must be a Boolean column`,
    );
    const row = plan.rows.find(
      (candidate) =>
        candidate.source?.register === spec.kind &&
        candidate.source?.fixtureId !== undefined &&
        candidate.values[spec.extraWhere!] === true,
    );
    assert(
      row !== undefined && row.tenantSlot !== null,
      `static guard ${spec.kind}.${spec.extraWhere} has no active fixture control`,
    );
    const tenantId = plan.tenantIds[row.tenantSlot];
    const userId = actorUserIdByTenantSlot.get(row.tenantSlot);
    assert(
      tenantId !== undefined && userId !== undefined,
      `static guard ${spec.kind} has no actor context`,
    );

    await appClient.query('BEGIN');
    try {
      await appClient.query('SET LOCAL ROLE c3_app');
      await appClient.query('SET LOCAL row_security = on');
      await appClient.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [tenantId, userId],
      );
      const update = await appClient.query(
        `UPDATE ${quoteIdentifier(spec.table)}
            SET ${quoteIdentifier(spec.extraWhere)} = false
          WHERE tenant_id = $1::uuid
            AND ${quoteIdentifier(spec.id)} = $2::text`,
        [tenantId, row.values[spec.id]],
      );
      assert(
        update.rowCount === 1,
        `static guard ${spec.kind} mutation did not update exactly one row`,
      );
      const statement = bindGuardLookupMarkers(
        guardedProjectionLookup(
          spec,
          projectionAuthority.guardProgram,
          {
            query: String(row.values[spec.id]).toLowerCase(),
            scalarValue: null,
            listValues:
              spec.kind === projectionAuthority.guardProgram.listGate.register
                ? [
                    String(
                      row.values[
                        projectionAuthority.guardProgram.listGate.column
                      ],
                    ),
                  ]
                : [],
          },
          false,
        ),
        null,
        String(row.values[spec.id]),
      );
      const result = await appClient.query(
        statement.text,
        statement.values,
      );
      assert(
        result.rows.length === 0,
        `static guard ${spec.kind}.${spec.extraWhere} did not remove its mutated candidate`,
      );
      count += 1;
    } finally {
      await appClient.query('ROLLBACK').catch(() => undefined);
    }
  }
  assert(
    count === projectionAuthority.staticGuardRegisters.length,
    'not every derived static guard received a negative control',
  );
  return count;
}

async function requireRows(client: PgClientLike, table: string): Promise<void> {
  const result = await client.query(`SELECT count(*)::integer AS count FROM ${quoteIdentifier(table)}`);
  assert(Number(result.rows[0]?.count ?? 0) > 0, `negative suite requires at least one ${table} row`);
}

async function expectDatabaseReject(
  client: PgClientLike,
  mutation: string,
  action: () => Promise<void>,
  expected: {
    readonly sqlStates: readonly string[];
    readonly constraints?: readonly string[];
    readonly messageTags?: readonly string[];
  },
): Promise<RejectEvidence> {
  let rejection: PgErrorShape | null = null;
  await client.query('BEGIN');
  try {
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await action();
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) {
    rejection = errorShape(error);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
  assert(rejection !== null, `negative mutation ${mutation} was accepted`);
  assert(
    rejection.code !== undefined && expected.sqlStates.includes(rejection.code),
    `negative mutation ${mutation} rejected with unexpected SQLSTATE ${rejection.code ?? 'unknown'}`,
  );
  if (expected.constraints && expected.constraints.length > 0) {
    assert(
      rejection.constraint !== undefined && expected.constraints.includes(rejection.constraint),
      `negative mutation ${mutation} rejected on unexpected constraint ${rejection.constraint ?? '<none>'}`,
    );
  }
  if (expected.messageTags && expected.messageTags.length > 0) {
    assert(
      expected.messageTags.some((tag) => rejection!.message.includes(tag)),
      `negative mutation ${mutation} did not emit its required invariant signal`,
    );
  }
  return {
    mutation,
    sqlState: rejection.code,
    constraint: rejection.constraint ?? null,
    signal: stableSignal(rejection),
  };
}

async function runNegativeMutationSuite(client: PgClientLike): Promise<readonly RejectEvidence[]> {
  for (const table of [
    'tenant',
    'approval',
    'agreement_term',
    'mission_line',
    'document',
    'invoice',
    'mission',
    'distribution',
  ]) {
    await requireRows(client, table);
  }

  const evidence: RejectEvidence[] = [];

  evidence.push(
    await expectDatabaseReject(
      client,
      'invoice-status-draft',
      async () => {
        await client.query(
          `UPDATE invoice
              SET status = 'Draft'
            WHERE id = (SELECT id FROM invoice ORDER BY tenant_id, invoice_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23514'], constraints: ['invoice_status_check'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'approval-operation-whitelist',
      async () => {
        await client.query(
          `INSERT INTO approval
           SELECT (pg_catalog.jsonb_populate_record(
             NULL::approval,
             to_jsonb(a) || jsonb_build_object(
               'id', gen_random_uuid(),
               'approval_id', 'APR-H3-NEG-OP',
               'operation_type', 'ZeroOnly263'
             )
           )).*
             FROM approval a
            ORDER BY tenant_id, approval_id
            LIMIT 1`,
        );
      },
      { sqlStates: ['23514'], constraints: ['approval_operation_type_check'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'journey-creator-not-null',
      async () => {
        await client.query(
          `UPDATE journey
              SET created_by_approval_id = NULL
            WHERE id = (SELECT id FROM journey ORDER BY tenant_id, journey_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23502'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'journey-creator-same-tenant-foreign-key',
      async () => {
        await client.query(
          `UPDATE journey
              SET created_by_approval_id = 'APR-H3-MISSING-CREATOR'
            WHERE id = (SELECT id FROM journey ORDER BY tenant_id, journey_id LIMIT 1)`,
        );
      },
      {
        sqlStates: ['23503'],
        constraints: ['journey_tenant_id_created_by_approval_id_fkey'],
      },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'missing-not-null',
      async () => {
        await client.query(
          `INSERT INTO tenant (id, slug)
           VALUES ('f0000000-0000-4000-8000-000000000001'::uuid, 'hearth-negative-missing-name')`,
        );
      },
      { sqlStates: ['23502'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'wrong-bigint-type',
      async () => {
        await client.query(
          `UPDATE document
              SET size_bytes = $1
            WHERE id = (SELECT id FROM document ORDER BY tenant_id, document_id LIMIT 1)`,
          ['not-a-bigint'],
        );
      },
      { sqlStates: ['22P02'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'missing-foreign-key-target',
      async () => {
        await client.query(
          `UPDATE invoice
              SET mission_id = 'MSN-H3-MISSING-FK'
            WHERE id = (SELECT id FROM invoice ORDER BY tenant_id, invoice_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23503'], constraints: ['invoice_mission_fk'] },
    ),
  );

  const crossTenant = await client.query(
    `SELECT i.id::text AS invoice_pk, m.mission_id
       FROM invoice i
       JOIN mission m ON m.tenant_id <> i.tenant_id
      WHERE NOT EXISTS (
        SELECT 1
          FROM mission own
         WHERE own.tenant_id = i.tenant_id
           AND own.mission_id = m.mission_id
      )
      ORDER BY i.tenant_id, i.invoice_id, m.tenant_id, m.mission_id
      LIMIT 1`,
  );
  assert(crossTenant.rows.length === 1, 'negative suite cannot construct an unambiguous cross-tenant FK probe');
  evidence.push(
    await expectDatabaseReject(
      client,
      'cross-tenant-composite-foreign-key',
      async () => {
        await client.query(`UPDATE invoice SET mission_id = $1 WHERE id = $2::uuid`, [
          crossTenant.rows[0]!.mission_id,
          crossTenant.rows[0]!.invoice_pk,
        ]);
      },
      { sqlStates: ['23503'], constraints: ['invoice_mission_fk'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'agreement-term-bad-shape',
      async () => {
        await client.query(
          `UPDATE agreement_term
              SET kind = 'Salary',
                  amount_minor = NULL,
                  currency = NULL,
                  percent_bps = 100
            WHERE id = (SELECT id FROM agreement_term ORDER BY tenant_id, term_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23514'], constraints: ['agreement_term_shape'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'expense-line-with-reference-number',
      async () => {
        await client.query(
          `UPDATE mission_line
              SET direction = 'Expense',
                  category = 'Travel',
                  payment_status = NULL,
                  received_amount_minor = NULL,
                  received_usd_per_unit = NULL,
                  payment_source_label = NULL,
                  ref_no = 'H3-EXPENSE-REF-FORBIDDEN'
            WHERE id = (
              SELECT ml.id
                FROM mission_line ml
               WHERE NOT EXISTS (
                 SELECT 1
                   FROM distribution d
                  WHERE d.tenant_id = ml.tenant_id
                    AND d.line_id = ml.line_id
                    AND d.status = 'Live'
               )
                 AND NOT EXISTS (
                 SELECT 1
                   FROM invoice i
                  WHERE i.tenant_id = ml.tenant_id
                    AND i.line_id = ml.line_id
                    AND i.status = 'Issued'
               )
               ORDER BY ml.tenant_id, ml.line_id
               LIMIT 1
            )`,
        );
      },
      { sqlStates: ['23514'], constraints: ['mission_line_payment_shape'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'document-bad-sha256',
      async () => {
        await client.query(
          `UPDATE document
              SET sha256 = 'not-a-sha256'
            WHERE id = (SELECT id FROM document ORDER BY tenant_id, document_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23514'], constraints: ['document_sha256_check'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'duplicate-live-invoice-line',
      async () => {
        await client.query(
          `INSERT INTO invoice
           SELECT (pg_catalog.jsonb_populate_record(
             NULL::invoice,
             to_jsonb(i) || jsonb_build_object(
               'id', gen_random_uuid(),
               'invoice_id', 'INV-H3-NEG-DUP',
               'invoice_number', 'H3-NEG-DUP-' || i.invoice_number
             )
           )).*
             FROM invoice i
            WHERE i.status = 'Issued'
            ORDER BY tenant_id, invoice_id
            LIMIT 1`,
        );
      },
      { sqlStates: ['23505'], constraints: ['invoice_one_live_per_line'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'invoice-total-exact',
      async () => {
        await client.query(
          `UPDATE invoice
              SET total_minor = subtotal_minor + vat_minor + 1
            WHERE id = (SELECT id FROM invoice ORDER BY tenant_id, invoice_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23514'], constraints: ['invoice_total_exact'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'invoice-void-shape',
      async () => {
        await client.query(
          `UPDATE invoice
              SET status = 'Voided',
                  voided_reason = NULL
            WHERE id = (SELECT id FROM invoice ORDER BY tenant_id, invoice_id LIMIT 1)`,
        );
      },
      { sqlStates: ['23514'], constraints: ['invoice_void_shape'] },
    ),
  );

  evidence.push(
    await expectDatabaseReject(
      client,
      'distribution-exact-sum',
      async () => {
        await client.query(
          `UPDATE distribution
              SET org_cut_minor = org_cut_minor + 1
            WHERE id = (SELECT id FROM distribution ORDER BY tenant_id, distribution_id LIMIT 1)`,
        );
      },
      { sqlStates: ['P0001'], messageTags: ['DISTRIBUTION_SUM_VIOLATION'] },
    ),
  );

  return evidence;
}

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}

function requireStringArray(
  value: unknown,
  label: string,
): readonly string[] {
  assert(Array.isArray(value), `${label} must be an array`);
  const result = value.map((entry, index) => {
    assert(
      typeof entry === 'string' && entry.length > 0,
      `${label}[${index}] must be a non-empty string`,
    );
    return entry;
  });
  assert(new Set(result).size === result.length, `${label} contains duplicates`);
  return result;
}

function sourceIdentityKey(sourceValue: unknown, label: string): string {
  const source = requireObject(sourceValue, label);
  assert(
    typeof source.tenantSlot === 'string' &&
      typeof source.register === 'string' &&
      typeof source.recordId === 'string',
    `${label} has an incomplete source identity`,
  );
  assert(
    source.recordKind === null ||
      source.recordKind === undefined ||
      typeof source.recordKind === 'string',
    `${label}.recordKind must be string or null`,
  );
  return JSON.stringify([
    source.tenantSlot,
    source.register,
    source.recordKind ?? null,
    source.recordId,
  ]);
}

function seedRowSourceIdentity(row: SeedRow, label: string): string {
  assert(
    row.tenantSlot !== null &&
      typeof row.source?.register === 'string' &&
      typeof row.source.recordId === 'string',
    `${label} has no searchable source identity`,
  );
  return JSON.stringify([
    row.tenantSlot,
    row.source.register,
    row.source.recordKind ?? null,
    row.source.recordId,
  ]);
}

function validateQrelsBinding(
  qrels: unknown,
  contract: FixtureContract,
  plan: PhysicalSeedPlan,
  measurement: DelegationMeasurementAuthority,
): number {
  const object = requireObject(qrels, 'qrels');
  assert(
    object.artifactKind === 'hearth-search-hand-adjudicated-qrels',
    'qrels artifactKind must be hearth-search-hand-adjudicated-qrels',
  );
  assert(
    object.querySetVersion === 'HEARTH-003-QRELS-v5',
    'qrels querySetVersion must be HEARTH-003-QRELS-v5',
  );
  assert(object.syntheticOnly === true, 'qrels must be syntheticOnly');
  assert(
    object.fixtureArtifact === 'HEARTH-003-FIXTURE-CONTRACT-v5.json' &&
      object.delegationMeasurementArtifact ===
        plan.delegationMeasurementAuthoritySource.artifact &&
      contract.fixtureVersion === 'HEARTH-003-FIXTURES-v5',
    'qrels, fixture contract, and delegation measurement versions are not a coherent v5 set',
  );
  assert(Array.isArray(object.cases), 'qrels must expose its authority-authored cases array');
  assert(object.cases.length === 280, `qrels must contain exactly 280 adjudicated cases, found ${object.cases.length}`);
  const delegationProbeMaterialization = requireObject(
    object.delegationProbeMaterialization,
    'qrels.delegationProbeMaterialization',
  );
  const declaredDelegationOverlayIds = requireStringArray(
    delegationProbeMaterialization.physicalOverlayScenarioIds,
    'qrels.delegationProbeMaterialization.physicalOverlayScenarioIds',
  );
  const physicalDelegationOverlayIds = plan.overlayScenarios
    .filter((scenario) => scenario.authorityState?.kind === 'delegation')
    .map((scenario) => scenario.scenarioId)
    .sort();
  assert(
    delegationProbeMaterialization.frozenAsOfDate === '2035-06-15' &&
      delegationProbeMaterialization.activeActorClass ===
        'same.approval.delegated_active' &&
      valuesAreEqual(delegationProbeMaterialization.activeStates, ['D1']) &&
      delegationProbeMaterialization.inactiveActorClass ===
        'same.approval.delegated_inactive' &&
      valuesAreEqual(
        delegationProbeMaterialization.inactiveStates,
        ['D0', 'D2', 'D3', 'D4'],
      ) &&
      valuesAreEqual(
        [...declaredDelegationOverlayIds].sort(),
        physicalDelegationOverlayIds,
      ) &&
      valuesAreEqual(
        delegationProbeMaterialization.measuredCorpusProfileIds,
        measurement.corpusProfiles.map(({ corpusProfileId }) => corpusProfileId),
      ) &&
      delegationProbeMaterialization.logicalAssignmentCount === 29 &&
      delegationProbeMaterialization.concreteBindingCount === 370 &&
      delegationProbeMaterialization.pairEdgeCount === 280 &&
      delegationProbeMaterialization.actorProfileCatalogCount ===
        measurement.actorProfileCatalog.length &&
      delegationProbeMaterialization.nonDelegationLogicalAssignmentCount ===
        measurement.nonDelegationLogicalAssignments.length &&
      delegationProbeMaterialization.nonDelegationConcreteObservationCount ===
        measurement.nonDelegationConcreteObservations.length,
    'qrel delegation probe mapping does not bind the exact D1-D4 physical matrix',
  );

  const amendmentLedger = requireObject(
    object.oracleAmendmentLedger,
    'qrels.oracleAmendmentLedger',
  );
  const amendmentCases = amendmentLedger.cases;
  assert(
    Array.isArray(amendmentCases) && amendmentCases.length === 7,
    'qrels oracle amendment ledger must declare exactly seven v2-to-v3 cases',
  );

  const fixtureById = new Map<string, ContractFixture>();
  for (const fixture of contract.fixtures) {
    assert(!fixtureById.has(fixture.fixtureId), `duplicate fixture ${fixture.fixtureId}`);
    fixtureById.set(fixture.fixtureId, fixture);
  }
  const rowByFixtureId = new Map<string, SeedRow>();
  const rowBySupportingId = new Map<string, SeedRow>();
  const corpusSources = new Set<string>();
  for (const row of plan.rows) {
    if (row.source?.fixtureId) {
      assert(
        !rowByFixtureId.has(row.source.fixtureId),
        `multiple physical rows bind fixture ${row.source.fixtureId}`,
      );
      rowByFixtureId.set(row.source.fixtureId, row);
    }
    if (row.source?.supportingRowId) {
      assert(
        !rowBySupportingId.has(row.source.supportingRowId),
        `multiple physical rows bind supporting row ${row.source.supportingRowId}`,
      );
      rowBySupportingId.set(row.source.supportingRowId, row);
    }
    if (
      row.tenantSlot !== null &&
      typeof row.source?.register === 'string' &&
      typeof row.source.recordId === 'string'
    ) {
      const key = seedRowSourceIdentity(row, `physical row ${row.rowId}`);
      assert(!corpusSources.has(key), `duplicate searchable source ${key}`);
      corpusSources.add(key);
    }
  }
  assert(
    rowByFixtureId.size === fixtureById.size,
    'not every contract fixture has exactly one physical row',
  );

  const caseById = new Map<string, Record<string, unknown>>();
  const bindingById = new Map(
    measurement.concreteBindings.map((binding) => [
      binding.bindingId,
      binding,
    ]),
  );
  const nonDelegationAssignmentById = new Map(
    measurement.nonDelegationLogicalAssignments.map((assignment) => [
      assignment.assignmentId,
      assignment,
    ]),
  );
  const nonDelegationObservationById = new Map(
    measurement.nonDelegationConcreteObservations.map((observation) => [
      observation.observationId,
      observation,
    ]),
  );
  const observedNonDelegationAssignmentIds = new Set<string>();
  const observedMeasurementBindingIds = new Set<string>();
  let delegatedProbeAssignmentCount = 0;
  const delegatedProbeCaseIds = new Set<string>();
  for (const [caseIndex, caseValue] of object.cases.entries()) {
    const qrel = requireObject(caseValue, `qrels.cases[${caseIndex}]`);
    const caseId = qrel.queryCaseId;
    assert(
      typeof caseId === 'string' && caseId.length > 0,
      `qrels.cases[${caseIndex}].queryCaseId is required`,
    );
    assert(!caseById.has(caseId), `duplicate qrel case ${caseId}`);
    caseById.set(caseId, qrel);
    assert(qrel.syntheticOnly === true, `${caseId} must be syntheticOnly`);
    assert(
      typeof qrel.query === 'string' && qrel.query.length > 0,
      `${caseId}.query is required`,
    );
    const probeActorClasses = requireStringArray(
      qrel.probeActorClasses,
      `${caseId}.probeActorClasses`,
    );
    const delegatedAssignments = probeActorClasses.filter(
      (actorClass) =>
        actorClass === 'same.approval.delegated_active' ||
        actorClass === 'same.approval.delegated_inactive',
    ).length;
    delegatedProbeAssignmentCount += delegatedAssignments;
    if (delegatedAssignments > 0) delegatedProbeCaseIds.add(caseId);
    const nonDelegationAssignmentIds = requireStringArray(
      qrel.nonDelegationMeasurementAssignmentIds,
      `${caseId}.nonDelegationMeasurementAssignmentIds`,
    );
    const expectedNonDelegationAssignmentIds =
      measurement.nonDelegationLogicalAssignments
        .filter((assignment) => assignment.queryCaseId === caseId)
        .map((assignment) => assignment.assignmentId);
    assert(
      valuesAreEqual(
        nonDelegationAssignmentIds,
        expectedNonDelegationAssignmentIds,
      ),
      `${caseId} does not bind its exact non-delegation assignments`,
    );
    for (const assignmentId of nonDelegationAssignmentIds) {
      assert(
        !observedNonDelegationAssignmentIds.has(assignmentId),
        `non-delegation assignment ${assignmentId} is attached twice`,
      );
      observedNonDelegationAssignmentIds.add(assignmentId);
    }
    const measurementBindingIds = requireStringArray(
      qrel.delegationMeasurementBindingIds,
      `${caseId}.delegationMeasurementBindingIds`,
    );
    const expectedBindingIds = measurement.concreteBindings
      .filter((binding) => binding.queryCaseId === caseId)
      .map((binding) => binding.bindingId);
    assert(
      valuesAreEqual(measurementBindingIds, expectedBindingIds),
      `${caseId} does not bind its exact delegation measurement probes`,
    );
    for (const bindingId of measurementBindingIds) {
      assert(
        !observedMeasurementBindingIds.has(bindingId),
        `delegation binding ${bindingId} is attached to more than one qrel`,
      );
      observedMeasurementBindingIds.add(bindingId);
    }
    const qrelTarget = requireObject(qrel.target, `${caseId}.target`);
    const fixtureIds = requireStringArray(qrel.fixtureIds, `${caseId}.fixtureIds`);
    for (const [fixtureIndex, fixtureId] of fixtureIds.entries()) {
      const fixture = fixtureById.get(fixtureId);
      const physicalRow = rowByFixtureId.get(fixtureId);
      assert(fixture !== undefined && physicalRow !== undefined, `${caseId} references unknown fixture ${fixtureId}`);
      assert(
        fixture.scenarioId === qrel.fixtureScenarioId,
        `${caseId} fixture ${fixtureId} scenario diverges`,
      );
      assert(
        fixture.target.query === qrel.query &&
          (fixtureIndex !== 0 ||
            (fixture.source.register === qrelTarget.register &&
              fixture.target.physicalField === qrelTarget.physicalField &&
              fixture.target.fieldClass === qrelTarget.fieldClass &&
              fixture.target.editKind === qrelTarget.editKind)),
        `${caseId} target/query diverges from fixture ${fixtureId}`,
      );
      assert(
        valuesAreEqual(
          physicalRow.approvedProjection,
          fixture.approvedProjection,
        ),
        `${caseId} fixture ${fixtureId} projection diverges from its physical row`,
      );
    }

    assert(Array.isArray(qrel.sourceJudgments), `${caseId}.sourceJudgments must be an array`);
    const judgmentTiers = new Map<string, number>();
    const judgmentObjects: Record<string, unknown>[] = [];
    const judgmentFixtureIds: string[] = [];
    const judgmentSupportingIds: string[] = [];
    for (const [judgmentIndex, judgmentValue] of qrel.sourceJudgments.entries()) {
      const judgment = requireObject(
        judgmentValue,
        `${caseId}.sourceJudgments[${judgmentIndex}]`,
      );
      judgmentObjects.push(judgment);
      const fixtureId =
        judgment.fixtureId === null ? null : judgment.fixtureId;
      const supportingRowId =
        judgment.supportingRowId === undefined ||
        judgment.supportingRowId === null
          ? null
          : judgment.supportingRowId;
      assert(
        (typeof fixtureId === 'string') !==
          (typeof supportingRowId === 'string'),
        `${caseId} judgment must name exactly one fixtureId or supportingRowId`,
      );
      const row =
        typeof fixtureId === 'string'
          ? rowByFixtureId.get(fixtureId)
          : rowBySupportingId.get(String(supportingRowId));
      assert(row !== undefined, `${caseId} judgment resolves no physical row`);
      const actualKey = sourceIdentityKey(
        judgment.source,
        `${caseId} judgment source`,
      );
      assert(
        actualKey === seedRowSourceIdentity(row, `${caseId} judgment row`),
        `${caseId} judgment source diverges from its physical row`,
      );
      assert(
        Number.isSafeInteger(judgment.rankGroup) &&
          Number(judgment.rankGroup) >= 0,
        `${caseId} judgment rankGroup is invalid`,
      );
      assert(!judgmentTiers.has(actualKey), `${caseId} duplicates judgment source ${actualKey}`);
      judgmentTiers.set(actualKey, Number(judgment.rankGroup));
      if (typeof fixtureId === 'string') judgmentFixtureIds.push(fixtureId);
      else judgmentSupportingIds.push(String(supportingRowId));
    }

    assert(
      Array.isArray(qrel.authoritativeRankGroups),
      `${caseId}.authoritativeRankGroups must be an array`,
    );
    const rankedTiers = new Map<string, number>();
    for (const [groupIndex, groupValue] of qrel.authoritativeRankGroups.entries()) {
      const group = requireObject(
        groupValue,
        `${caseId}.authoritativeRankGroups[${groupIndex}]`,
      );
      assert(
        Number.isSafeInteger(group.tier) && Number(group.tier) >= 0,
        `${caseId} rank tier is invalid`,
      );
      for (const key of requireStringArray(
        group.sourceKeys,
        `${caseId}.authoritativeRankGroups[${groupIndex}].sourceKeys`,
      )) {
        assert(corpusSources.has(key), `${caseId} rank source is absent from the physical corpus`);
        assert(!rankedTiers.has(key), `${caseId} duplicates ranked source ${key}`);
        rankedTiers.set(key, Number(group.tier));
      }
    }
    assert(
      valuesAreEqual(
        [...judgmentTiers.entries()].sort(),
        [...rankedTiers.entries()].sort(),
      ),
      `${caseId} rank groups do not equal its physical source judgments`,
    );
    assert(
      valuesAreEqual(
        [...new Set(judgmentFixtureIds)].sort(),
        [...new Set(judgmentFixtureIds.filter((id) => fixtureIds.includes(id)))].sort(),
      ),
      `${caseId} judgment fixture lies outside fixtureIds`,
    );
    const declaredSupportingIds =
      qrel.supportingRowIds === undefined
        ? []
        : requireStringArray(
            qrel.supportingRowIds,
            `${caseId}.supportingRowIds`,
          );
    assert(
      valuesAreEqual(
        [...judgmentSupportingIds].sort(),
        [...declaredSupportingIds].sort(),
      ),
      `${caseId} supportingRowIds do not equal support judgments`,
    );

    assert(Array.isArray(qrel.forbiddenSources), `${caseId}.forbiddenSources must be an array`);
    const forbiddenKeys = new Set<string>();
    for (const [sourceIndex, source] of qrel.forbiddenSources.entries()) {
      const key = sourceIdentityKey(
        source,
        `${caseId}.forbiddenSources[${sourceIndex}]`,
      );
      assert(corpusSources.has(key), `${caseId} forbidden source is absent from the physical corpus`);
      forbiddenKeys.add(key);
    }
    assert(Array.isArray(qrel.hardFailIfReturned), `${caseId}.hardFailIfReturned must be an array`);
    for (const [hardFailIndex, hardFailValue] of qrel.hardFailIfReturned.entries()) {
      const hardFail = requireObject(
        hardFailValue,
        `${caseId}.hardFailIfReturned[${hardFailIndex}]`,
      );
      const key = sourceIdentityKey(
        hardFail.source,
        `${caseId}.hardFailIfReturned[${hardFailIndex}].source`,
      );
      assert(
        corpusSources.has(key) && forbiddenKeys.has(key),
        `${caseId} hard-fail source is not a real declared forbidden source`,
      );
    }

    for (const bindingId of measurementBindingIds) {
      const binding = bindingById.get(bindingId);
      assert(binding !== undefined, `${caseId} names unknown binding ${bindingId}`);
      assert(
        binding.fixtureScenarioId === qrel.fixtureScenarioId &&
          binding.queryCaseId === caseId,
        `${bindingId} diverges from its qrel identity`,
      );
      const actorMemberships = new Set(['same.all', binding.actorClass]);
      const expectedAuthoritative = judgmentObjects
        .filter((judgment) =>
          requireStringArray(
            judgment.authoritativeActorClasses,
            `${caseId}.authoritativeActorClasses`,
          ).some((actorClass) => actorMemberships.has(actorClass)),
        )
        .map((judgment) => ({
          source: judgment.source as FixtureSource,
          rankGroup: Number(judgment.rankGroup),
        }));
      const expectedApprovedRelevant = judgmentObjects
        .filter((judgment) =>
          requireStringArray(
            judgment.approvedActorClasses,
            `${caseId}.approvedActorClasses`,
          ).some((actorClass) => actorMemberships.has(actorClass)),
        )
        .map((judgment) => ({
          source: judgment.source as FixtureSource,
          rankGroup: Number(judgment.rankGroup),
        }));
      assert(
        valuesAreEqual(binding.authoritativeRelevant, expectedAuthoritative) &&
          valuesAreEqual(
            binding.approvedSearchRelevantJudgments,
            expectedApprovedRelevant,
          ) &&
          valuesAreEqual(binding.forbiddenSources, qrel.forbiddenSources),
        `${bindingId} does not reproduce the independent qrel judgments`,
      );
    }
    for (const assignmentId of nonDelegationAssignmentIds) {
      const assignment = nonDelegationAssignmentById.get(assignmentId);
      assert(
        assignment !== undefined &&
          assignment.queryCaseId === caseId &&
          assignment.fixtureScenarioId === qrel.fixtureScenarioId &&
          probeActorClasses.includes(assignment.actorClass),
        `${caseId} names invalid non-delegation assignment ${assignmentId}`,
      );
      const memberships = new Set(['same.all', assignment.actorClass]);
      const expectedAuthoritative = judgmentObjects
        .filter((judgment) =>
          requireStringArray(
            judgment.authoritativeActorClasses,
            `${caseId}.authoritativeActorClasses`,
          ).some((actorClass) => memberships.has(actorClass)),
        )
        .map((judgment) => ({
          source: judgment.source as FixtureSource,
          rankGroup: Number(judgment.rankGroup),
        }));
      const expectedApprovedRelevant = judgmentObjects
        .filter((judgment) =>
          requireStringArray(
            judgment.approvedActorClasses,
            `${caseId}.approvedActorClasses`,
          ).some((actorClass) => memberships.has(actorClass)),
        )
        .map((judgment) => ({
          source: judgment.source as FixtureSource,
          rankGroup: Number(judgment.rankGroup),
        }));
      assert(
        assignment.query === qrel.query &&
          assignment.queryClass === qrel.queryClass &&
          valuesAreEqual(
            assignment.authoritativeRelevant,
            expectedAuthoritative,
          ) &&
          valuesAreEqual(
            assignment.approvedSearchRelevantJudgments,
            expectedApprovedRelevant,
          ) &&
          valuesAreEqual(
            assignment.forbiddenSources,
            qrel.forbiddenSources,
          ),
        `${assignmentId} does not reproduce its independent qrel judgments`,
      );
      for (const observationId of assignment.observationIds) {
        const observation =
          nonDelegationObservationById.get(observationId);
        assert(
          observation !== undefined &&
            observation.assignmentId === assignmentId &&
            observation.queryCaseId === caseId,
          `${observationId} does not bind its qrel assignment`,
        );
      }
    }
  }

  const amendmentIds = new Set<string>();
  for (const [index, amendmentValue] of amendmentCases.entries()) {
    const amendment = requireObject(
      amendmentValue,
      `qrels.oracleAmendmentLedger.cases[${index}]`,
    );
    assert(
      typeof amendment.queryCaseId === 'string' &&
        typeof amendment.fixtureId === 'string' &&
        typeof amendment.newQuery === 'string',
      `qrels oracle amendment ${index} is incomplete`,
    );
    assert(
      !amendmentIds.has(amendment.queryCaseId),
      `duplicate oracle amendment ${amendment.queryCaseId}`,
    );
    amendmentIds.add(amendment.queryCaseId);
    const qrel = caseById.get(amendment.queryCaseId);
    assert(qrel !== undefined, `oracle amendment names unknown qrel ${amendment.queryCaseId}`);
    assert(
      qrel.query === amendment.newQuery &&
        (qrel.fixtureIds as readonly unknown[]).includes(amendment.fixtureId),
      `oracle amendment ${amendment.queryCaseId} does not bind its current qrel/fixture`,
    );
  }
  assert(
    delegatedProbeAssignmentCount === 29 &&
      delegatedProbeCaseIds.size === 15 &&
      observedMeasurementBindingIds.size === 370 &&
      bindingById.size === 370 &&
      observedNonDelegationAssignmentIds.size ===
        nonDelegationAssignmentById.size,
    `delegation qrel binding must cover 29 assignments, 15 cases, and 370 concrete probes; found ${delegatedProbeAssignmentCount}/${delegatedProbeCaseIds.size}/${observedMeasurementBindingIds.size}`,
  );
  return object.cases.length;
}

async function validate(cli: Cli): Promise<void> {
  assert(existsSync(cli.repo), '--repo does not exist');
  assert(existsSync(join(cli.repo, '.git')), '--repo is not the c3-fable Git worktree');

  const contractInput = parseJsonFile<FixtureContract>(cli.contract, 'fixture contract');
  const contractHash = sha256CanonicalText(
    contractInput.bytes,
    'fixture contract input',
  );
  const plan = assertPlanShape(contractInput.value);
  const pinEvidence = verifySourcePins(cli.repo, plan);
  const delegationAuthority = verifyDelegationAuthority(
    cli.contract,
    plan.delegationAuthoritySource,
  );
  const delegationMeasurementAuthority =
    verifyDelegationMeasurementAuthority(
      cli.contract,
      plan.delegationMeasurementAuthoritySource,
      plan,
    );
  const physicalSeedPlanHash = sha256(canonicalJson(plan));

  let qrelsHash: string | null = null;
  let qrelsCount: number | null = null;
  if (cli.qrels) {
    const qrelsInput = parseJsonFile<unknown>(cli.qrels, 'qrels');
    qrelsHash = sha256CanonicalText(qrelsInput.bytes, 'qrels input');
    qrelsCount = validateQrelsBinding(
      qrelsInput.value,
      contractInput.value,
      plan,
      delegationMeasurementAuthority,
    );
  }

  assert(
    !process.env.DATABASE_ADMIN_URL &&
      !process.env.DATABASE_URL &&
      !process.env.DATABASE_AUTH_URL &&
      !process.env.DATABASE_BACKUP_URL,
    'validator refuses inherited database URLs; it must own a disposable embedded PostgreSQL',
  );

  const webRoot = join(cli.repo, 'webv0');
  const testSupportPath = join(webRoot, 'packages', 'test-support', 'src', 'index.ts');
  assert(existsSync(testSupportPath), 'C3 startTestDatabase implementation is missing');
  const testSupport = (await import(pathToFileURL(testSupportPath).href)) as {
    readonly startTestDatabase?: () => Promise<TestDatabaseLike>;
  };
  assert(typeof testSupport.startTestDatabase === 'function', 'startTestDatabase export is unavailable');

  const requireFromWeb = createRequire(join(webRoot, 'package.json'));
  const pg = requireFromWeb('pg') as { readonly Client: new (spec: { connectionString: string }) => PgClientLike };
  const typescript = requireFromWeb('typescript') as unknown;
  const projectionAuthoritySourceText = decodeStrictUtf8(
    pinEvidence.projectionAuthorityBytes,
    'pinned searchSql.ts Git blob',
  );
  const projectionAuthority = parseProjectionAuthoritySource(
    projectionAuthoritySourceText,
    typescript,
  );
  const projectionParserSelfTests =
    runProjectionAuthorityParserSelfTests(
      projectionAuthoritySourceText,
      typescript,
    );
  assert(
    projectionAuthority.typescriptVersion === '5.9.3',
    `projection authority parser requires TypeScript 5.9.3, found ${projectionAuthority.typescriptVersion}`,
  );
  assert(
    projectionParserSelfTests.baselineSemanticHash ===
      projectionAuthority.semanticHash,
    'projection parser self-test baseline diverges from the live derivation',
  );

  const database = await testSupport.startTestDatabase();
  const client = new pg.Client({ connectionString: database.adminUrl });
  const appClient = new pg.Client({ connectionString: database.appUrl });
  const authClient = new pg.Client({ connectionString: database.authUrl });
  let connected = false;
  let appConnected = false;
  let authConnected = false;
  try {
    await client.connect();
    connected = true;
    await appClient.connect();
    appConnected = true;
    await authClient.connect();
    authConnected = true;
    await client.query("SET client_encoding TO 'UTF8'");
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('SET search_path TO public, pg_catalog');
    for (const restrictedClient of [appClient, authClient]) {
      await restrictedClient.query("SET client_encoding TO 'UTF8'");
      await restrictedClient.query("SET TIME ZONE 'UTC'");
      await restrictedClient.query('SET search_path TO public, pg_catalog');
    }

    const versionRows = await client.query('SHOW server_version');
    const postgresVersion = String(versionRows.rows[0]?.server_version ?? '');
    assert(/^18\.4(?:\s|$)/.test(postgresVersion), `validator requires PostgreSQL 18.4, found ${postgresVersion || 'unknown'}`);
    await attestRuntimeMigrationLedger(client, plan.migrationFiles);

    const measurementRows = physicalProfileDefinitions(
      delegationMeasurementAuthority,
    ).flatMap(({ rows }) => rows);
    const allRows = [
      ...plan.rows,
      ...plan.overlayScenarios.flatMap((scenario) => scenario.rows ?? []),
      ...measurementRows,
    ];
    const touchedNames = [...new Set(allRows.map((row) => row.table))].sort();
    const catalog = await loadCatalog(client, touchedNames);
    const tableMap = new Map(catalog.tables.map((table) => [table.table, table]));

    staticPreflightRows(plan.rows, tableMap, 'physicalSeedPlan.rows');
    for (const scenario of plan.overlayScenarios) {
      staticPreflightRows(scenario.rows ?? [], tableMap, `overlayScenarios.${scenario.scenarioId}.rows`);
    }
    staticPreflightRows(
      measurementRows,
      tableMap,
      'delegationMeasurementAuthority.h4AcceptanceProfileSuite.rows',
    );

    const manifest: SchemaManifest = {
      schemaVersion: 3,
      artifactKind: 'hearth-003-physical-domain-manifest',
      sourceCommit: plan.sourceCommit,
      postgresVersion,
      migrationPinSetSha256: pinEvidence.migrationPinSetSha256,
      projectionAuthoritySource: plan.projectionAuthoritySource,
      delegationAuthoritySource: plan.delegationAuthoritySource,
      delegationMeasurementAuthoritySource:
        plan.delegationMeasurementAuthoritySource,
      projectionAuthorityDerivation: {
        parserPackageVersion: projectionAuthority.typescriptVersion,
        projectionParserSourceSha256: PROJECTION_PARSER_SOURCE_SHA256,
        projectionAuthorityBlobSha256: sha256CanonicalText(
          pinEvidence.projectionAuthorityBytes,
          'projection authority Git blob',
        ),
        projectionSemanticSha256:
          projectionAuthority.projectionSemanticHash,
        guardSemanticSha256: projectionAuthority.guardSemanticHash,
        combinedAuthoritySha256: projectionAuthority.semanticHash,
        registerCount: projectionAuthority.specs.length,
        staticGuardRegisters:
          projectionAuthority.staticGuardRegisters,
        guardProgram: projectionAuthority.guardProgram,
      },
      touchedTables: catalog.tables,
      publicFunctions: catalog.functions,
    };
    assertManifestSafe(manifest);
    const manifestText = stablePrettyJson(manifest);
    const manifestHash = sha256CanonicalText(
      manifestText,
      'schema manifest output',
    );

    await seedBaseline(client, plan.rows);
    const baselineById = new Map(plan.rows.map((row) => [row.rowId, row]));
    const overlayChecks = await validateOverlayScenarios(
      client,
      plan.overlayScenarios,
      baselineById,
      tableMap,
      delegationAuthority,
    );
    const physicalProfileEvidence =
      await validatePhysicalMeasurementProfiles(
        client,
        appClient,
        plan,
        delegationMeasurementAuthority,
        tableMap,
      );
    const negativeEvidence = await runNegativeMutationSuite(client);
    const visibilityRows = visibilityProbeRows(plan);
    assert(
      visibilityRows.length === 6,
      `expected six accepted visibility probe rows, found ${visibilityRows.length}`,
    );
    await seedVisibilityProbeRows(client, visibilityRows);
    const rlsEvidence = await validateNonSuperuserRlsVisibility(
      client,
      appClient,
      authClient,
      plan,
      catalog.tables,
    );
    const projectionEvidence = await validateProjections(
      appClient,
      contractInput.value,
      plan,
      projectionAuthority,
      rlsEvidence.actorUserIdByTenantSlot,
    );
    const ownClaimActorBindingCount = validateOwnClaimActorBindings(
      contractInput.value,
      plan,
      projectionAuthority,
    );
    const guardBranchEvidence = await validateRuntimeGuardBranches(
      client,
      appClient,
      contractInput.value,
      plan,
      projectionAuthority,
      rlsEvidence.actorUserIdByTenantSlot,
      tableMap,
    );
    const staticGuardNegativeControlCount =
      await validateStaticGuardNegativeControls(
        appClient,
        plan,
        projectionAuthority,
        rlsEvidence.actorUserIdByTenantSlot,
        tableMap,
      );
    const acceptedOverlayCount = plan.overlayScenarios.filter(
      (scenario) => scenario.expected === 'accept',
    ).length;
    const rejectedOverlayCount = plan.overlayScenarios.filter(
      (scenario) => scenario.expected === 'reject',
    ).length;
    const acceptedMutationOverlayCount = plan.overlayScenarios.filter(
      (scenario) =>
        scenario.expected === 'accept' &&
        ((scenario.rows?.length ?? 0) > 0 ||
          (scenario.removeRowIds?.length ?? 0) > 0),
    ).length;
    const acceptedAbsenceOverlayCount = plan.overlayScenarios.filter(
      (scenario) =>
        scenario.expected === 'accept' &&
        (scenario.rows?.length ?? 0) === 0 &&
        (scenario.removeRowIds?.length ?? 0) === 0,
    ).length;
    assert(
      acceptedMutationOverlayCount === 66 &&
        acceptedAbsenceOverlayCount === 4,
      `accepted overlay accounting must be 66 SQL mutations and four absence assertions, found ${acceptedMutationOverlayCount}/${acceptedAbsenceOverlayCount}`,
    );

    const checks: CheckResult[] = [
      {
        check: 'pinned-migration-git-blobs',
        status: 'PASS',
        count: plan.migrationFiles.length,
        detail: 'complete ordered canonical-text equality to reviewed Git blobs',
      },
      {
        check: 'text-hash-eol-portability',
        status: 'PASS',
        count: 10,
        detail:
          'migration/search pins, contract, qrels, validator/parser source, actor-class and measurement sources, manifest, and pg_get_functiondef use strict UTF-8 LF-canonical hashing; semantic objects use canonical JSON; LF/CRLF/lone-CR equivalence and substantive RED controls fired',
      },
      {
        check: 'postgres-version',
        status: 'PASS',
        detail: postgresVersion,
      },
      {
        check: 'runtime-migration-ledger',
        status: 'PASS',
        count: plan.migrationFiles.length,
        detail: 'no missing or extra ledger rows; every checksum equals its pinned Git blob',
      },
      {
        check: 'pg-catalog-domain-manifest',
        status: 'PASS',
        count: catalog.tables.length,
        detail: 'columns constraints indexes triggers functions and RLS recorded; policy behavior is separately exercised below',
      },
      {
        check: 'pinned-search-authority-ast-derivation',
        status: 'PASS',
        count: projectionAuthority.specs.length,
        detail: `TypeScript ${projectionAuthority.typescriptVersion}; projection=${projectionAuthority.projectionSemanticHash};guard=${projectionAuthority.guardSemanticHash};combined=${projectionAuthority.semanticHash}`,
      },
      {
        check: 'projection-source-structure-parity',
        status: 'PASS',
        detail: 'DOMAIN_SPECS and domainBlock projection/guard consumers parsed from the exact pinned Git blob',
      },
      {
        check: 'projection-parser-negative-controls',
        status: 'PASS',
        count: 8,
        detail: 'projection/claim-column semantic tamper controls changed hashes; dead base hit, extraWhere, claim, document list, false-to-true, and unknown fifth guard push were rejected',
      },
      {
        check: 'projection-static-guards',
        status: 'PASS',
        count: projectionAuthority.staticGuardRegisters.length,
        detail: projectionAuthority.staticGuardRegisters.join(','),
      },
      {
        check: 'static-column-type-nullability-preflight',
        status: 'PASS',
        count: allRows.length,
        detail: `baseline=${plan.rows.length};overlays=${plan.overlayScenarios.flatMap((scenario) => scenario.rows ?? []).length};measured_profile_rows=${measurementRows.length}`,
      },
      {
        check: 'baseline-physical-seed-plan',
        status: 'PASS',
        count: plan.rows.length,
        detail: 'all deferred constraints forced immediate before commit',
      },
      ...overlayChecks,
      {
        check: 'overlay-branch-coverage',
        status: 'PASS',
        count: plan.overlayScenarios.length,
        detail: `accept=${acceptedOverlayCount};accept_sql_mutation=${acceptedMutationOverlayCount};accept_absence_assertion=${acceptedAbsenceOverlayCount};reject=${rejectedOverlayCount}`,
      },
      {
        check: 'h4-sparse-profile-physical-readback',
        status: 'PASS',
        count: physicalProfileEvidence.profileExecutions,
        detail: `profile_delta_rows=${physicalProfileEvidence.presentDeltaRows};measured_absence_readbacks=${physicalProfileEvidence.measuredAbsenceReadbacks};delegation_actor_predicates=${physicalProfileEvidence.delegationPredicateActorChecks};entitlement_readbacks=${physicalProfileEvidence.entitlementReadbacks};participant_readbacks=${physicalProfileEvidence.participantReadbacks};disposable database only`,
      },
      {
        check: 'negative-domain-mutation-suite',
        status: 'PASS',
        count: negativeEvidence.length,
      },
      {
        check: 'visibility-probe-materialization',
        status: 'PASS',
        count: visibilityRows.length,
        detail: 'accepted E1/P1/D1 rows fill the three zero-baseline RLS tables in both tenants',
      },
      ...rlsEvidence.checks,
      {
        check: 'source-derived-natural-guarded-projection-through-c3-app',
        status: 'PASS',
        count: projectionEvidence.totalFixtures,
        detail: `included=${projectionEvidence.includedFixtures};static_guard_excluded=${projectionEvidence.staticallyExcludedFixtures};opposite_tenant_denials=${projectionEvidence.crossTenantDenials}`,
      },
      {
        check: 'source-derived-complete-runtime-guard-branches',
        status: 'PASS',
        count:
          guardBranchEvidence.hitPositive +
          guardBranchEvidence.hitNegative +
          guardBranchEvidence.claimNull +
          guardBranchEvidence.claimEqual +
          guardBranchEvidence.claimDistinctDenied +
          guardBranchEvidence.documentSingleton +
          guardBranchEvidence.documentNonmatchingDenied +
          guardBranchEvidence.documentEmptyDenied +
          guardBranchEvidence.documentMiddleMember,
        detail: `hit_positive=${guardBranchEvidence.hitPositive};hit_negative=${guardBranchEvidence.hitNegative};claim_null=${guardBranchEvidence.claimNull};claim_equal=${guardBranchEvidence.claimEqual};claim_distinct_denied=${guardBranchEvidence.claimDistinctDenied};document_singleton=${guardBranchEvidence.documentSingleton};document_nonmatching_denied=${guardBranchEvidence.documentNonmatchingDenied};document_empty_false=${guardBranchEvidence.documentEmptyDenied};document_middle_member=${guardBranchEvidence.documentMiddleMember};temporarily_admitted_static=${guardBranchEvidence.temporarilyAdmittedStaticRows}`,
      },
      {
        check: 'own-claim-physical-actor-identity-binding',
        status: 'PASS',
        count: ownClaimActorBindingCount,
        detail:
          'each actor_identity claim submitted_by equals its same-tenant physical HR app_user email',
      },
      {
        check: 'projection-static-guard-negative-controls',
        status: 'PASS',
        count: staticGuardNegativeControlCount,
      },
      ...(qrelsCount === null
        ? []
        : [
            {
              check: 'qrel-to-fixture-row-projection-binding',
              status: 'PASS' as const,
              count: qrelsCount,
              detail:
                'queries/targets/scenarios, fixture/support rows, source identities, rank tiers, forbidden sources, projections, seven amendment-ledger entries, 29 delegation assignments, 370 per-case bindings, and 280 pair edges are bound',
            },
          ]),
    ];

    const report: ValidationReport = {
      schemaVersion: 3,
      artifactKind: 'hearth-003-physical-domain-validation-report',
      outcome: 'PASS',
      authority: 'Apex Lumen',
      sourceCommit: plan.sourceCommit,
      inputHashes: {
        contractSha256: contractHash,
        qrelsSha256: qrelsHash,
        physicalSeedPlanSha256: physicalSeedPlanHash,
        schemaManifestSha256: manifestHash,
        validatorSourceSha256: VALIDATOR_SOURCE_SHA256,
        projectionParserSourceSha256: PROJECTION_PARSER_SOURCE_SHA256,
        projectionAuthorityBlobSha256: sha256CanonicalText(
          pinEvidence.projectionAuthorityBytes,
          'projection authority Git blob',
        ),
        projectionSemanticSha256:
          projectionAuthority.projectionSemanticHash,
        guardSemanticSha256: projectionAuthority.guardSemanticHash,
        combinedAuthoritySha256: projectionAuthority.semanticHash,
        delegationAuthoritySha256:
          plan.delegationAuthoritySource.canonicalTextSha256,
        delegationMeasurementAuthoritySha256:
          plan.delegationMeasurementAuthoritySource.canonicalTextSha256,
      },
      checks,
      negativeMutationEvidence: negativeEvidence,
    };

    const reportText = stablePrettyJson(report);
    assert(!/postgres(?:ql)?:\/\//i.test(reportText), 'report must not contain database URLs');
    atomicWrite(cli.manifest, manifestText);
    atomicWrite(cli.report, reportText);
    process.stdout.write(
      `HEARTH-003 physical-domain and RLS visibility validation PASS: ${plan.rows.length} baseline rows, ${projectionEvidence.totalFixtures} source-derived projections, ${rlsEvidence.policyCoverageCount} policies, ${negativeEvidence.length} negative probes\n`,
    );
  } finally {
    if (authConnected) await authClient.end().catch(() => undefined);
    if (appConnected) await appClient.end().catch(() => undefined);
    if (connected) await client.end().catch(() => undefined);
    await database.stop().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  let parsedCli: Cli | null = null;
  let failureContractHash: string | null = null;
  let failureQrelsHash: string | null = null;

  try {
    parsedCli = parseCli(process.argv.slice(2));
    if (existsSync(parsedCli.contract)) {
      failureContractHash = sha256CanonicalText(
        readFileSync(parsedCli.contract),
        'failure-report fixture contract input',
      );
    }
    if (parsedCli.qrels && existsSync(parsedCli.qrels)) {
      failureQrelsHash = sha256CanonicalText(
        readFileSync(parsedCli.qrels),
        'failure-report qrels input',
      );
    }
    await validate(parsedCli);
  } catch (error) {
    const caught = error instanceof Error ? error : new Error('unknown validator failure');
    if (parsedCli) {
      const failure: FailureReport = {
        schemaVersion: 3,
        artifactKind: 'hearth-003-physical-domain-validation-report',
        outcome: 'FAIL',
        authority: 'Apex Lumen',
        inputHashes: {
          contractSha256: failureContractHash,
          qrelsSha256: failureQrelsHash,
          validatorSourceSha256: VALIDATOR_SOURCE_SHA256,
          projectionParserSourceSha256: PROJECTION_PARSER_SOURCE_SHA256,
        },
        failure: {
          name: caught.name,
          message: sanitizeFailureMessage(caught.message, parsedCli),
        },
      };
      try {
        atomicWrite(parsedCli.report, stablePrettyJson(failure));
      } catch {
        // The primary failure remains authoritative even when its requested
        // destination is unwritable.
      }
    }
    process.stderr.write(`HEARTH-003 physical-domain validation FAIL: ${caught.message}\n`);
    process.exitCode = 1;
  }
}

void main().then(() => {
  process.exit(process.exitCode ?? 0);
});
