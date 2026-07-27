import { spawnSync } from 'node:child_process';

export interface HarnessSelfTestPaths {
  readonly executablePath: string;
  readonly vitestPath: string;
  readonly configPath: string;
  readonly harnessRoot: string;
}

interface BufferedCommandResult {
  readonly status: number | null;
  readonly error?: unknown;
  readonly stdout?: string | null;
}

interface BufferedCommandOptions {
  readonly cwd: string;
  readonly encoding: 'utf8';
  readonly maxBuffer: number;
  readonly stdio: 'pipe';
}

type BufferedCommandRunner = (
  executablePath: string,
  args: readonly string[],
  options: BufferedCommandOptions,
) => BufferedCommandResult;

const defaultBufferedCommandRunner: BufferedCommandRunner = (
  executablePath,
  args,
  options,
) => spawnSync(executablePath, [...args], options);

export interface HarnessSelfTestReceipt {
  readonly redSelfTestsExecuted: true;
  readonly harnessTestCount: number;
}

function failHarnessSelfTests(): never {
  throw Object.assign(
    new Error('Search-harness RED/self-test suite failed'),
    { code: 'HARNESS_SELF_TEST_FAILED' },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function zeroSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value === 0
  );
}

export function parseHarnessSelfTestReport(
  source: unknown,
): HarnessSelfTestReceipt {
  if (typeof source !== 'string' || source.length === 0) {
    return failHarnessSelfTests();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return failHarnessSelfTests();
  }
  if (!isRecord(parsed) || parsed.success !== true) {
    return failHarnessSelfTests();
  }
  if (
    !zeroSafeInteger(parsed.numFailedTests) ||
    !zeroSafeInteger(parsed.numPendingTests) ||
    !zeroSafeInteger(parsed.numTodoTests) ||
    !zeroSafeInteger(parsed.numFailedTestSuites) ||
    !zeroSafeInteger(parsed.numPendingTestSuites) ||
    !Array.isArray(parsed.testResults)
  ) {
    return failHarnessSelfTests();
  }

  let assertionCount = 0;
  for (const testResult of parsed.testResults) {
    if (
      !isRecord(testResult) ||
      testResult.status !== 'passed' ||
      !Array.isArray(testResult.assertionResults)
    ) {
      return failHarnessSelfTests();
    }
    for (const assertion of testResult.assertionResults) {
      if (!isRecord(assertion) || assertion.status !== 'passed') {
        return failHarnessSelfTests();
      }
      assertionCount += 1;
    }
  }

  if (
    !positiveSafeInteger(assertionCount) ||
    parsed.numTotalTests !== assertionCount ||
    parsed.numPassedTests !== assertionCount
  ) {
    return failHarnessSelfTests();
  }

  return {
    redSelfTestsExecuted: true,
    harnessTestCount: assertionCount,
  };
}

/**
 * Runs the RED/self-test suite with captured output. Raw assertion diffs may
 * contain planted sentinels, so neither stdout nor stderr is ever inherited or
 * reflected through the parent command.
 */
export function runHarnessRedSelfTests(
  paths: HarnessSelfTestPaths,
  runner: BufferedCommandRunner = defaultBufferedCommandRunner,
): HarnessSelfTestReceipt {
  const result = runner(
    paths.executablePath,
    [
      paths.vitestPath,
      'run',
      '--config',
      paths.configPath,
      '--root',
      paths.harnessRoot,
      '--no-color',
      '--silent',
      '--reporter=json',
    ],
    {
      cwd: paths.harnessRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: 'pipe',
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    return failHarnessSelfTests();
  }
  return parseHarnessSelfTestReport(result.stdout);
}
