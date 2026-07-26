import { readFile } from 'node:fs/promises';

import { Client } from 'pg';

import type { MeasuredProcessEnvironment } from '../credentials.js';
import {
  assertTrustedH1DatabaseSeedReceiptForExecution,
  buildH1DatabaseSeedReceiptBinding,
  seedH1Database,
  type H1DatabaseSeedReceipt,
  type H1DatabaseSideEffectLedger,
} from '../h1/databaseSeeder.js';
import type { H1SqlClient } from '../h1/disposableDatabase.js';
import {
  probeExternalOwnedDisposableTarget,
  type H1ExternalTargetProbeLedger,
  type H1RetainedSeedTransaction,
} from '../h1/externalTargetProbe.js';
import {
  attestH1ProfileExecution,
  buildH1ProfileDatabasePlan,
  prepareH1SourcePlan,
  type H1ProfileDatabasePlan,
  type H1VerifiedProfileExecutionAttestation,
} from '../h1/sourcePlan.js';
import { HearthHarnessError } from '../errors.js';
import type { HarnessCommandResult } from './common.js';
import {
  H1SeedRunConfigError,
  parseH1SeedRunConfig,
  type H1SeedRunConfig,
} from './h1SeedConfig.js';

interface H1SeedWorkflowDependencies {
  readonly prepareSourcePlan: typeof prepareH1SourcePlan;
  readonly loadRunConfig: () => Promise<H1SeedRunConfig>;
  readonly connect: (
    exactSeedAdminUrl: string,
    connectionTimeoutMs: number,
  ) => Promise<H1SqlClient>;
  readonly buildProfilePlan: typeof buildH1ProfileDatabasePlan;
  readonly attestProfileExecution: typeof attestH1ProfileExecution;
  readonly probeTarget: typeof probeExternalOwnedDisposableTarget;
  readonly seedDatabase: typeof seedH1Database;
}

export interface H1SeedCommandResult extends HarnessCommandResult {
  readonly command: 'search:harness:seed';
  readonly profile: string;
  readonly attestations: {
    readonly safetyStage: 'H1';
    readonly certificationScope:
      'deterministic-corpus-seed-and-postgresql-readback';
    readonly baselineMeaning: 'dae27a4-drift-baseline-only';
    readonly recordReady: false;
    readonly h4BaselineRecorded: false;
    readonly sourcePlanSha256: string;
    readonly profilePlanSha256: string;
    readonly externallyPinnedAuthorityRoot: string;
    readonly authorityPhysicalRowCount: 692;
    readonly deterministicBulkRowCount: 99_403;
    readonly intendedSearchableCount: 100_000;
    readonly boundedSourceCount: 100_037;
    readonly hardCanarySourceCount: 37;
    readonly databaseRowCount: number;
    readonly databaseReadbackRowCount: number;
    readonly databaseReadbackSha256: string;
    readonly databaseCorpusSha256: string;
    readonly targetBindingSha256: string;
    readonly probeEventCount: number;
    readonly databaseEventCount: number;
  };
}

export class H1SeedWorkflowError extends HearthHarnessError<'H1_SEED_WORKFLOW_ATTESTATION_INVALID'> {
  constructor() {
    super(
      'H1_SEED_WORKFLOW_ATTESTATION_INVALID',
      'H1 seed workflow did not observe exact trusted execution evidence',
    );
  }
}

function exactEvents(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function assertH1SeedWorkflowEventSequence(
  probeLedger: H1ExternalTargetProbeLedger,
  databaseLedger: H1DatabaseSideEffectLedger,
): void {
  const probeEvents = probeLedger.attemptedEvents.map(
    ({ capability }) => capability,
  );
  const databaseEvents = databaseLedger.attemptedEvents.map(
    ({ capability }) => capability,
  );
  if (
    !exactEvents(probeEvents, [
      'database-probe-connect',
      'database-probe-identity',
      'database-probe-transaction',
      'database-probe-lock',
      'database-probe-read',
      'database-probe-handoff',
    ]) ||
    !exactEvents(databaseEvents, [
      'database-retained-transaction-consume',
      'database-commit',
    ])
  ) {
    throw new H1SeedWorkflowError();
  }
}

function assertReceiptMatchesExecutionPlan(
  receipt: H1DatabaseSeedReceipt,
  profilePlan: H1ProfileDatabasePlan,
  verifiedProfileExecution:
    H1VerifiedProfileExecutionAttestation,
  retainedTransaction: H1RetainedSeedTransaction,
): void {
  const expected = buildH1DatabaseSeedReceiptBinding({
    authorityRows: profilePlan.authorityRows,
    bulkRows: profilePlan.bulkRows,
    corpusProfileId: profilePlan.corpusProfileId,
    expectedCounts: profilePlan.expectedCounts,
    migrationPins: profilePlan.migrationPins,
    profileRows: profilePlan.profileRows,
    retainedTransaction,
    verifiedProfileExecution,
  });
  const keys = Object.keys(expected) as Array<
    keyof typeof expected
  >;
  if (
    receipt.profilePlanSha256 !== profilePlan.planSha256 ||
    receipt.totalRowCount !== profilePlan.totalPhysicalRowCount ||
    keys.some((key) => receipt[key] !== expected[key])
  ) {
    throw new H1SeedWorkflowError();
  }
}

async function loadRunConfig(
  runConfigPath: string,
): Promise<H1SeedRunConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(runConfigPath, 'utf8'),
    ) as unknown;
  } catch {
    throw new H1SeedRunConfigError(
      'H1_SEED_RUN_CONFIG_INVALID',
      'H1 seed run config could not be read as JSON',
    );
  }
  return parseH1SeedRunConfig(parsed);
}

async function connectExternalPostgres(
  exactSeedAdminUrl: string,
  connectionTimeoutMs: number,
): Promise<H1SqlClient> {
  const client = new Client({
    connectionString: exactSeedAdminUrl,
    application_name: 'c3-hearth-search-h1-seeder',
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: connectionTimeoutMs,
  });
  try {
    await client.connect();
  } catch (error) {
    try {
      await client.end();
    } catch {
      // The probe converts the original connect failure to a credential-safe
      // typed error. Cleanup cannot safely expose driver detail either.
    }
    throw error;
  }
  return {
    async query(text, values) {
      const result = await client.query(
        text,
        values === undefined ? undefined : [...values],
      );
      return {
        rows: result.rows as Readonly<Record<string, unknown>>[],
        rowCount: result.rowCount,
      };
    },
    async end() {
      await client.end();
    },
  };
}

/**
 * Executes one, and only one, acceptance profile. The complete r6 source plan
 * and executable drift RED controls are evaluated before the run-config file
 * is read and before any database capability can be reached.
 */
async function executeH1SeedWorkflow(
  measuredEnvironment: MeasuredProcessEnvironment,
  dependencies: H1SeedWorkflowDependencies,
): Promise<H1SeedCommandResult> {
  const source = dependencies.prepareSourcePlan();
  const config = await dependencies.loadRunConfig();
  const profilePlan = dependencies.buildProfilePlan(
    source,
    config.corpusProfileId,
  );
  const verifiedProfileExecution =
    dependencies.attestProfileExecution(profilePlan);
  const probeLedger: H1ExternalTargetProbeLedger = {
    attemptedEvents: [],
  };
  const databaseLedger: H1DatabaseSideEffectLedger = {
    attemptedEvents: [],
  };

  const probed = await dependencies.probeTarget({
    seedAdminUrl: config.seedAdminUrl,
    acknowledgement: config.acknowledgement,
    runId: config.runId,
    protectedInventory: config.protectedInventory,
    measuredEnvironment,
    probeTimeoutMs: config.statementTimeoutMs,
    verifiedProfileExecution,
    connect: dependencies.connect,
    sideEffectLedger: probeLedger,
  });

  let receipt: H1DatabaseSeedReceipt;
  try {
    receipt = await dependencies.seedDatabase({
      verifiedProfileExecution,
      retainedTransaction: probed.transaction,
      corpusProfileId: profilePlan.corpusProfileId,
      authorityRows: profilePlan.authorityRows,
      profileRows: profilePlan.profileRows,
      bulkRows: profilePlan.bulkRows,
      expectedCounts: profilePlan.expectedCounts,
      migrationPins: profilePlan.migrationPins,
      statementTimeoutMs: config.statementTimeoutMs,
      sideEffectLedger: databaseLedger,
    });
  } finally {
    await probed.closeIfUnconsumed();
  }

  assertH1SeedWorkflowEventSequence(probeLedger, databaseLedger);
  assertTrustedH1DatabaseSeedReceiptForExecution(
    receipt,
    verifiedProfileExecution,
    probed.transaction,
  );
  assertReceiptMatchesExecutionPlan(
    receipt,
    profilePlan,
    verifiedProfileExecution,
    probed.transaction,
  );

  return {
    command: 'search:harness:seed',
    profile: config.corpusProfileId,
    status: 'PASS',
    attestations: {
      safetyStage: 'H1',
      certificationScope:
        'deterministic-corpus-seed-and-postgresql-readback',
      baselineMeaning: 'dae27a4-drift-baseline-only',
      recordReady: false,
      h4BaselineRecorded: false,
      sourcePlanSha256: source.manifestSha256,
      profilePlanSha256: profilePlan.planSha256,
      externallyPinnedAuthorityRoot:
        source.manifestInputs.externallyPinnedAuthorityRoot,
      authorityPhysicalRowCount: 692,
      deterministicBulkRowCount: 99_403,
      intendedSearchableCount: 100_000,
      boundedSourceCount: 100_037,
      hardCanarySourceCount: 37,
      databaseRowCount: receipt.totalRowCount,
      databaseReadbackRowCount: receipt.readbackRowCount,
      databaseReadbackSha256: receipt.framedReadbackSha256,
      databaseCorpusSha256: receipt.corpusSha256,
      targetBindingSha256: receipt.targetBindingSha256,
      probeEventCount: probeLedger.attemptedEvents.length,
      databaseEventCount: databaseLedger.attemptedEvents.length,
    },
  };
}

/**
 * The only H1 seed PASS surface. Every capability is hardwired here: callers
 * provide only the measured environment and a credential-bearing config-file
 * path. Tests cannot substitute a mock SQL adapter or fabricate event ledgers
 * into a production PASS.
 */
export function runH1SeedWorkflow(
  measuredEnvironment: MeasuredProcessEnvironment,
  runConfigPath: string,
): Promise<H1SeedCommandResult> {
  return executeH1SeedWorkflow(measuredEnvironment, {
    prepareSourcePlan: prepareH1SourcePlan,
    loadRunConfig: () => loadRunConfig(runConfigPath),
    connect: connectExternalPostgres,
    buildProfilePlan: buildH1ProfileDatabasePlan,
    attestProfileExecution: attestH1ProfileExecution,
    probeTarget: probeExternalOwnedDisposableTarget,
    seedDatabase: seedH1Database,
  });
}
