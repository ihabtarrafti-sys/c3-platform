import { canonicalJson } from '../canonical.js';
import { HearthHarnessError } from '../errors.js';

export interface HarnessCommandResult {
  readonly command: string;
  readonly profile?: string;
  readonly status: 'PASS';
  readonly attestations: Readonly<Record<string, string | number | boolean>>;
}

export function parseProfile(
  args: readonly string[],
  fallback: 'merge' | 'full' = 'merge',
): 'merge' | 'full' {
  const index = args.indexOf('--profile');
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value !== 'merge' && value !== 'full') {
    throw new Error('Expected --profile merge or --profile full');
  }
  return value;
}

export function writeResult(result: HarnessCommandResult): void {
  process.stdout.write(`${canonicalJson(result)}\n`);
}

export interface SafeHarnessCommandError {
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

export function safeHarnessCommandError(
  error: unknown,
): SafeHarnessCommandError {
  if (error instanceof HearthHarnessError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
    };
  }
  const candidateCode =
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.code)
      ? error.code
      : 'HARNESS_COMMAND_FAILED';
  return {
    name: 'Error',
    code: candidateCode,
    message:
      'Harness command failed; sensitive runtime error text was suppressed',
  };
}

export function runCommand(main: () => HarnessCommandResult | Promise<HarnessCommandResult>): void {
  void Promise.resolve()
    .then(main)
    .then(writeResult)
    .catch((error: unknown) => {
      const safe = safeHarnessCommandError(error);
      process.stderr.write(`${canonicalJson({ status: 'FAIL', error: safe })}\n`);
      process.exitCode = 1;
    });
}
