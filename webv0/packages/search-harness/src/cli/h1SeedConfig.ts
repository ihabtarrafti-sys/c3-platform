import { HearthHarnessError } from '../errors.js';
import type { H1ProtectedEndpointInventory } from '../h1/externalTargetProbe.js';
import type { H1AcceptanceCorpusProfileId } from '../h1/seedPlan.js';

export type H1SeedRunConfigFailureCode =
  | 'H1_SEED_RUN_ARGUMENTS_INVALID'
  | 'H1_SEED_RUN_CONFIG_INVALID';

export class H1SeedRunConfigError extends HearthHarnessError<H1SeedRunConfigFailureCode> {
  constructor(
    code: H1SeedRunConfigFailureCode,
    message: string,
  ) {
    super(code, message);
  }
}

export interface H1SeedRunConfig {
  readonly schemaVersion: 1;
  readonly artifactKind: 'hearth-search-h1-external-seed-run';
  readonly corpusProfileId: H1AcceptanceCorpusProfileId;
  readonly seedAdminUrl: string;
  readonly acknowledgement: string;
  readonly runId: string;
  readonly protectedInventory: H1ProtectedEndpointInventory;
  readonly statementTimeoutMs: number;
}

const CONFIG_KEYS = Object.freeze([
  'acknowledgement',
  'artifactKind',
  'corpusProfileId',
  'protectedInventory',
  'runId',
  'schemaVersion',
  'seedAdminUrl',
  'statementTimeoutMs',
]);
const INVENTORY_KEYS = Object.freeze([
  'endpoints',
  'schemaVersion',
]);
const ENDPOINT_KEYS = Object.freeze([
  'clusterIdentitySha256',
  'label',
  'url',
]);
const PROFILE_IDS = new Set<H1AcceptanceCorpusProfileId>([
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
const SHA256 = /^[a-f0-9]{64}$/u;

function fail(
  code: H1SeedRunConfigFailureCode,
  message: string,
): never {
  throw new H1SeedRunConfigError(code, message);
}

function record(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(
      'H1_SEED_RUN_CONFIG_INVALID',
      'H1 seed run config must be a plain JSON object',
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const observed = Object.keys(value).sort();
  if (
    observed.length !== expected.length ||
    observed.some((key, index) => key !== expected[index])
  ) {
    fail(
      'H1_SEED_RUN_CONFIG_INVALID',
      'H1 seed run config has missing or unknown fields',
    );
  }
}

function nonBlank(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  );
}

/**
 * The run config is deliberately a file, not environment variables or argv:
 * the seed credential must not be inherited by the measured API environment
 * and must not be exposed in the process command line.
 */
export function parseH1SeedRunConfig(
  value: unknown,
): H1SeedRunConfig {
  const config = record(value);
  exactKeys(config, CONFIG_KEYS);
  if (
    config['schemaVersion'] !== 1 ||
    config['artifactKind'] !==
      'hearth-search-h1-external-seed-run' ||
    !nonBlank(config['seedAdminUrl']) ||
    !nonBlank(config['acknowledgement']) ||
    !nonBlank(config['runId']) ||
    typeof config['corpusProfileId'] !== 'string' ||
    !PROFILE_IDS.has(
      config['corpusProfileId'] as H1AcceptanceCorpusProfileId,
    ) ||
    !Number.isSafeInteger(config['statementTimeoutMs']) ||
    (config['statementTimeoutMs'] as number) < 1 ||
    (config['statementTimeoutMs'] as number) > 300_000
  ) {
    fail(
      'H1_SEED_RUN_CONFIG_INVALID',
      'H1 seed run config has an invalid identity or bounded value',
    );
  }

  const inventory = record(config['protectedInventory']);
  exactKeys(inventory, INVENTORY_KEYS);
  if (
    inventory['schemaVersion'] !== 1 ||
    !Array.isArray(inventory['endpoints']) ||
    inventory['endpoints'].length !== 3
  ) {
    fail(
      'H1_SEED_RUN_CONFIG_INVALID',
      'H1 protected endpoint inventory is malformed',
    );
  }
  const endpoints = inventory['endpoints'].map((value) => {
    const endpoint = record(value);
    exactKeys(endpoint, ENDPOINT_KEYS);
    if (
      !nonBlank(endpoint['label']) ||
      !nonBlank(endpoint['url']) ||
      typeof endpoint['clusterIdentitySha256'] !== 'string' ||
      !SHA256.test(endpoint['clusterIdentitySha256'])
    ) {
      fail(
        'H1_SEED_RUN_CONFIG_INVALID',
        'H1 protected endpoint inventory entry is malformed',
      );
    }
    return Object.freeze({
      label: endpoint['label'],
      url: endpoint['url'],
      clusterIdentitySha256: endpoint['clusterIdentitySha256'],
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'hearth-search-h1-external-seed-run',
    corpusProfileId:
      config['corpusProfileId'] as H1AcceptanceCorpusProfileId,
    seedAdminUrl: config['seedAdminUrl'],
    acknowledgement: config['acknowledgement'],
    runId: config['runId'],
    protectedInventory: Object.freeze({
      schemaVersion: 1,
      endpoints: Object.freeze(endpoints),
    }),
    statementTimeoutMs: config['statementTimeoutMs'] as number,
  });
}

export function parseH1SeedRunConfigPath(
  args: readonly string[],
): string {
  if (
    args.length !== 2 ||
    args[0] !== '--run-config' ||
    !nonBlank(args[1])
  ) {
    fail(
      'H1_SEED_RUN_ARGUMENTS_INVALID',
      'Expected exactly --run-config followed by a non-blank JSON file path',
    );
  }
  return args[1];
}
