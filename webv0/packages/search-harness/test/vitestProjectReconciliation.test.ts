import { describe, expect, it } from 'vitest';

import workspaceDefinition from '../../../vitest.workspace.js';
import {
  GATE_PROJECT_PLAN,
  TEST_PROJECT_PLANS,
  VitestProjectReconciliationError,
  assertVitestProjectReconciliation,
  configuredVitestProjectNames,
  executedVitestProjectNames,
  type VitestProjectExecutionPlan,
} from '../../../scripts/vitestProjects.js';

function expectMismatch(action: () => void): VitestProjectReconciliationError {
  try {
    action();
    throw new Error('expected Vitest project reconciliation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(VitestProjectReconciliationError);
    expect((error as VitestProjectReconciliationError).code).toBe(
      'VITEST_PROJECT_SET_MISMATCH',
    );
    return error as VitestProjectReconciliationError;
  }
}

function reconcileGate(
  configuredProjects: readonly string[],
  executedProjects = executedVitestProjectNames(GATE_PROJECT_PLAN),
): void {
  assertVitestProjectReconciliation({
    context: 'RED gate fixture',
    configuredProjects,
    executedProjects,
    deliberateExclusions: GATE_PROJECT_PLAN.deliberateExclusions,
  });
}

describe('Vitest workspace/execution reconciliation', () => {
  const configuredProjects =
    configuredVitestProjectNames(workspaceDefinition);

  it('reconciles the real gate and every deliberate test-mode exclusion', () => {
    expect(() => reconcileGate(configuredProjects)).not.toThrow();
    expect(
      configuredVitestProjectNames({ default: workspaceDefinition }),
    ).toEqual(configuredProjects);
    let wrapperReads = 0;
    const getterWrapper = Object.defineProperty({}, 'default', {
      enumerable: true,
      get: () => {
        wrapperReads += 1;
        return workspaceDefinition;
      },
    });
    expect(configuredVitestProjectNames(getterWrapper)).toEqual(
      configuredProjects,
    );
    expect(wrapperReads).toBe(1);
    for (const [mode, plan] of Object.entries(TEST_PROJECT_PLANS)) {
      expect(() =>
        assertVitestProjectReconciliation({
          context: `test mode ${mode}`,
          configuredProjects,
          executedProjects: executedVitestProjectNames(plan),
          deliberateExclusions: plan.deliberateExclusions,
        }),
      ).not.toThrow();
    }
  });

  it('RED: adding a throwaway workspace project without execution fails the gate', () => {
    const mutatedWorkspace = [
      ...workspaceDefinition,
      {
        test: {
          name: 'throwaway-unexecuted',
          root: './throwaway-unexecuted',
        },
      },
    ];
    const error = expectMismatch(() =>
      reconcileGate(configuredVitestProjectNames(mutatedWorkspace)),
    );
    expect(error.details.configuredOnly).toEqual(['throwaway-unexecuted']);
  });

  it('RED: dropping one configured project from the executed set fails the gate', () => {
    const executedWithoutApi = executedVitestProjectNames(
      GATE_PROJECT_PLAN,
    ).filter((project) => project !== 'api');
    const error = expectMismatch(() =>
      reconcileGate(configuredProjects, executedWithoutApi),
    );
    expect(error.details.configuredOnly).toEqual(['api']);
  });

  it('RED: an executed project absent from the workspace fails the other direction', () => {
    const error = expectMismatch(() =>
      reconcileGate(configuredProjects, [
        ...executedVitestProjectNames(GATE_PROJECT_PLAN),
        'phantom-executed',
      ]),
    );
    expect(error.details.executedOnly).toEqual(['phantom-executed']);
  });

  it('RED: stale, overlapping, and duplicate exclusions cannot bless drift', () => {
    const error = expectMismatch(() =>
      assertVitestProjectReconciliation({
        context: 'RED exclusion fixture',
        configuredProjects,
        executedProjects: executedVitestProjectNames(GATE_PROJECT_PLAN),
        deliberateExclusions: [
          { name: 'api', reason: 'overlaps execution' },
          { name: 'phantom-exclusion', reason: '' },
          { name: 'phantom-exclusion', reason: 'duplicate' },
        ],
      }),
    );
    expect(error.details.executedAndExcluded).toEqual(['api']);
    expect(error.details.excludedOnly).toEqual(['phantom-exclusion']);
    expect(error.details.duplicateExcluded).toEqual(['phantom-exclusion']);
    expect(error.details.invalidExclusionReasons).toEqual([
      'phantom-exclusion',
    ]);
  });

  it('fails closed on dynamic, unnamed, or wildcard workspace projects', () => {
    const inheritedDefault = Object.assign(
      Object.create({ default: workspaceDefinition }) as object,
      { other: true },
    );
    for (const invalidWorkspace of [
      ['./vitest.extra.config.ts'],
      [{ test: {} }],
      [{ test: { name: 'project-*' } }],
      inheritedDefault,
    ]) {
      expect(() =>
        configuredVitestProjectNames(invalidWorkspace),
      ).toThrowError(
        expect.objectContaining({
          code: 'VITEST_WORKSPACE_PROJECTS_INVALID',
        }),
      );
    }
  });

  it('cannot count a different project as executed by the fixed harness verifier', () => {
    const mismatchedDedicatedPlan = {
      workspaceVitestProjects: GATE_PROJECT_PLAN.workspaceVitestProjects,
      dedicatedProjects: [
        {
          name: 'api',
          runner: 'harness-verify',
          label: 'misbound verifier',
        },
      ],
      deliberateExclusions: [],
    } as unknown as VitestProjectExecutionPlan;

    expect(() =>
      executedVitestProjectNames(mismatchedDedicatedPlan),
    ).toThrowError(
      expect.objectContaining({
        code: 'VITEST_EXECUTION_PLAN_INVALID',
      }),
    );
  });
});
