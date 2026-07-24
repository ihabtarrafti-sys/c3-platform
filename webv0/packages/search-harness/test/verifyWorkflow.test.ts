import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runHarnessRedSelfTests } from '../src/cli/selfTestRunner.js';
import { runH0VerificationWorkflow } from '../src/cli/verifyWorkflow.js';

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
        },
      },
      5,
    );

    expect(order).toEqual(['sunset-preflight', 'red-self-tests']);
    expect(result.attestations.redSelfTestsExecuted).toBe(true);
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
    ]);
    expect(thrown).toMatchObject({ code: 'HARNESS_SELF_TEST_FAILED' });
    expect(JSON.stringify(thrown)).not.toContain(sentinel);
    expect(JSON.stringify(thrown)).not.toContain(encodeURIComponent(sentinel));
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
  });
});
