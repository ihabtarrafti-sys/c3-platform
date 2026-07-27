import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseHarnessSelfTestReport,
  runHarnessRedSelfTests,
} from '../src/cli/selfTestRunner.js';
import { runH0VerificationWorkflow } from '../src/cli/verifyWorkflow.js';

function selfTestReport(count: number): string {
  return JSON.stringify({
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: count,
    numPassedTestSuites: 1,
    numPendingTests: 0,
    numPendingTestSuites: 0,
    numTodoTests: 0,
    numTotalTests: count,
    numTotalTestSuites: 1,
    startTime: 0,
    success: true,
    testResults: [
      {
        assertionResults: Array.from({ length: count }, (_, index) => ({
          status: 'passed',
          title: `test ${index + 1}`,
        })),
        endTime: 1,
        message: '',
        name: 'synthetic.test.ts',
        startTime: 0,
        status: 'passed',
      },
    ],
  });
}

describe('H0 verification fail-fast ordering', () => {
  it('runs the sunset preflight before RED/self-tests', () => {
    const order: string[] = [];
    const result = runH0VerificationWorkflow(
      {
        assertSunsetPreflight: () => {
          order.push('sunset-preflight');
        },
        runRedSelfTests: () => {
          order.push('red-self-tests');
          return {
            redSelfTestsExecuted: true,
            harnessTestCount: 386,
          };
        },
      },
      5,
    );

    expect(order).toEqual(['sunset-preflight', 'red-self-tests']);
    expect(result.attestations.redSelfTestsExecuted).toBe(true);
    expect(result.attestations.harnessTestCount).toBe(386);
  });

  it('RED: sunset drift prevents the test process from starting', () => {
    let testsStarted = false;
    expect(() =>
      runH0VerificationWorkflow(
        {
          assertSunsetPreflight: () => {
            throw new Error('synthetic sunset drift');
          },
          runRedSelfTests: () => {
            testsStarted = true;
            return {
              redSelfTestsExecuted: true,
              harnessTestCount: 1,
            };
          },
        },
        5,
      ),
    ).toThrow(/synthetic sunset drift/u);
    expect(testsStarted).toBe(false);
  });

  it('RED: pins the harness config and never reflects buffered child output', () => {
    const sentinel = 'HEARTH-CHILD-OUTPUT-PII-7f3a@example.invalid';
    let receivedArgs: readonly string[] = [];
    let thrown: unknown;
    try {
      runHarnessRedSelfTests(
        {
          executablePath: 'node',
          vitestPath: 'pinned/vitest.mjs',
          configPath: 'pinned/vitest.config.ts',
          harnessRoot: 'pinned/search-harness',
        },
        (_executablePath, args) => {
          receivedArgs = args;
          return {
            status: 1,
            stdout: sentinel,
            stderr: encodeURIComponent(sentinel),
          };
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(receivedArgs).toEqual([
      'pinned/vitest.mjs',
      'run',
      '--config',
      'pinned/vitest.config.ts',
      '--root',
      'pinned/search-harness',
      '--no-color',
      '--silent',
      '--reporter=json',
    ]);
    expect(thrown).toMatchObject({ code: 'HARNESS_SELF_TEST_FAILED' });
    expect(JSON.stringify(thrown)).not.toContain(sentinel);
    expect(JSON.stringify(thrown)).not.toContain(encodeURIComponent(sentinel));
  });

  it('binds the receipt to the JSON reporter assertion count', () => {
    expect(parseHarnessSelfTestReport(selfTestReport(386))).toEqual({
      redSelfTestsExecuted: true,
      harnessTestCount: 386,
    });
    expect(parseHarnessSelfTestReport(selfTestReport(1))).toEqual({
      redSelfTestsExecuted: true,
      harnessTestCount: 1,
    });
  });

  it('RED: a declared count cannot exceed the executed assertion results', () => {
    const forged = JSON.parse(selfTestReport(1)) as Record<string, unknown>;
    forged.numTotalTests = 386;
    forged.numPassedTests = 386;
    expect(() =>
      parseHarnessSelfTestReport(JSON.stringify(forged)),
    ).toThrow(/RED\/self-test suite failed/u);
  });

  it('RED: a failed test file cannot hide passed nested assertions', () => {
    const forged = JSON.parse(selfTestReport(1)) as {
      testResults: Array<Record<string, unknown>>;
    };
    forged.testResults[0]!.status = 'failed';
    expect(() =>
      parseHarnessSelfTestReport(JSON.stringify(forged)),
    ).toThrow(/RED\/self-test suite failed/u);
  });

  it.each([
    ['missing output', undefined],
    ['malformed JSON', '{"success":true'],
    ['zero tests', selfTestReport(0)],
    [
      'failed status',
      selfTestReport(1).replace('"status":"passed"', '"status":"failed"'),
    ],
    [
      'false success',
      selfTestReport(1).replace('"success":true', '"success":false'),
    ],
  ])('RED: rejects %s without reflecting child output', (_name, output) => {
    const sentinel = 'HEARTH-COUNT-OUTPUT-PII@example.invalid';
    let thrown: unknown;
    try {
      parseHarnessSelfTestReport(`${String(output)}${sentinel}`);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'HARNESS_SELF_TEST_FAILED' });
    expect(JSON.stringify(thrown)).not.toContain(sentinel);
  });

  it('RED: a real one-test suite reports one rather than a pinned count', () => {
    const packageRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const cacheRoot = join(packageRoot, '.cache');
    mkdirSync(cacheRoot, { recursive: true });
    const syntheticRoot = mkdtempSync(
      join(cacheRoot, 'harness-count-'),
    );
    try {
      const configPath = join(syntheticRoot, 'vitest.config.ts');
      const testPath = join(syntheticRoot, 'count.test.ts');
      writeFileSync(
        configPath,
        "export default { test: { globals: true, include: ['*.test.ts'] } };\n",
        'utf8',
      );
      writeFileSync(testPath, "test('one', () => {});\n", 'utf8');

      expect(
        runHarnessRedSelfTests({
          executablePath: process.execPath,
          vitestPath: join(
            packageRoot,
            '..',
            '..',
            'node_modules',
            'vitest',
            'vitest.mjs',
          ),
          configPath,
          harnessRoot: syntheticRoot,
        }).harnessTestCount,
      ).toBe(1);
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

  it('keeps the root gate sunset preflight ahead of every test process', () => {
    const packageRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const gateSource = readFileSync(
      join(packageRoot, '..', '..', 'scripts', 'gate.mts'),
      'utf8',
    );
    const testSource = readFileSync(
      join(packageRoot, '..', '..', 'scripts', 'test.mts'),
      'utf8',
    );
    const verifySource = readFileSync(
      join(packageRoot, 'src', 'cli', 'verify.ts'),
      'utf8',
    );
    const preflightIndex = gateSource.indexOf(
      "step('search harness sunset preflight'",
    );
    const reconciliationIndex = gateSource.indexOf(
      'assertVitestProjectReconciliation({',
    );
    const workspaceTestIndex = gateSource.indexOf(
      "step('test (unit + db + api)'",
    );
    const dedicatedProjectIndex = gateSource.indexOf(
      'for (const execution of GATE_PROJECT_PLAN.dedicatedProjects)',
    );

    expect(reconciliationIndex).toBeGreaterThanOrEqual(0);
    expect(preflightIndex).toBeGreaterThan(reconciliationIndex);
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceTestIndex).toBeGreaterThan(preflightIndex);
    expect(dedicatedProjectIndex).toBeGreaterThan(workspaceTestIndex);
    expect(gateSource).toContain("'--config',");
    expect(gateSource).toContain("'--workspace',");
    expect(gateSource).toContain(
      'GATE_PROJECT_PLAN.workspaceVitestProjects',
    );
    expect(testSource).toContain(
      'for (const [plannedMode, plannedExecution] of Object.entries(',
    );
    const verifySunsetIndex = verifySource.indexOf(
      'assertSearchSunsetPreflight();',
    );
    const verifySourcePlanIndex = verifySource.indexOf(
      'const source = prepareH1SourcePlan();',
    );
    const verifyRedIndex = verifySource.indexOf(
      'runHarnessRedSelfTests({',
    );
    const verifyPassIndex = verifySource.indexOf("status: 'PASS'");
    expect(verifySunsetIndex).toBeGreaterThanOrEqual(0);
    expect(verifySourcePlanIndex).toBeGreaterThan(
      verifySunsetIndex,
    );
    expect(verifyRedIndex).toBeGreaterThan(verifySourcePlanIndex);
    expect(verifyPassIndex).toBeGreaterThan(verifyRedIndex);
    expect(verifySource).toContain(
      'const selfTests = runHarnessRedSelfTests({',
    );
    expect(verifySource).toContain('...selfTests,');
    expect(verifySource).not.toContain('redSelfTestsExecuted: true');
    expect(verifySource).not.toContain('harnessTestCount:');
    expect(verifySource).not.toContain(
      'runH1VerificationWorkflow',
    );
  });
});
