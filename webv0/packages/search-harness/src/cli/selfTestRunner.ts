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

/**
 * Runs the RED/self-test suite with captured output. Raw assertion diffs may
 * contain planted sentinels, so neither stdout nor stderr is ever inherited or
 * reflected through the parent command.
 */
export function runHarnessRedSelfTests(
  paths: HarnessSelfTestPaths,
  runner: BufferedCommandRunner = defaultBufferedCommandRunner,
): void {
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
    ],
    {
      cwd: paths.harnessRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: 'pipe',
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    throw Object.assign(
      new Error('Search-harness RED/self-test suite failed'),
      { code: 'HARNESS_SELF_TEST_FAILED' },
    );
  }
}
