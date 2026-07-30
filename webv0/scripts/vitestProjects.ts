export const SEARCH_HARNESS_PROJECT = 'search-harness' as const;

const PRODUCT_PROJECTS = [
  'domain',
  'authz',
  'api-contracts',
  'application',
  'test-support',
  'web',
  'backup',
  'persistence',
  'api',
] as const;

export interface DedicatedVitestProjectExecution {
  readonly name: typeof SEARCH_HARNESS_PROJECT;
  readonly runner: 'harness-verify';
  readonly label: string;
}

export interface DeliberateVitestProjectExclusion {
  readonly name: string;
  readonly reason: string;
}

export interface VitestProjectExecutionPlan {
  readonly workspaceVitestProjects: readonly string[];
  readonly dedicatedProjects: readonly DedicatedVitestProjectExecution[];
  readonly deliberateExclusions: readonly DeliberateVitestProjectExclusion[];
}

const HARNESS_VERIFY_EXECUTION: DedicatedVitestProjectExecution = {
  name: SEARCH_HARNESS_PROJECT,
  runner: 'harness-verify',
  label: 'search harness safety verification',
};

export const GATE_PROJECT_PLAN: VitestProjectExecutionPlan = {
  workspaceVitestProjects: PRODUCT_PROJECTS,
  dedicatedProjects: [HARNESS_VERIFY_EXECUTION],
  deliberateExclusions: [],
};

export const TEST_PROJECT_PLANS = {
  all: GATE_PROJECT_PLAN,
  unit: {
    workspaceVitestProjects: [
      'domain',
      'authz',
      'application',
      'api-contracts',
      'test-support',
      'web',
    ],
    dedicatedProjects: [HARNESS_VERIFY_EXECUTION],
    deliberateExclusions: [
      {
        name: 'backup',
        reason: 'unit mode excludes embedded-database backup integration tests',
      },
      {
        name: 'persistence',
        reason: 'unit mode excludes persistence integration tests',
      },
      {
        name: 'api',
        reason: 'unit mode excludes authenticated API integration tests',
      },
    ],
  },
  db: {
    workspaceVitestProjects: ['persistence'],
    dedicatedProjects: [],
    deliberateExclusions: [
      {
        name: 'domain',
        reason: 'db mode is intentionally scoped to persistence integration',
      },
      {
        name: 'authz',
        reason: 'db mode is intentionally scoped to persistence integration',
      },
      {
        name: 'api-contracts',
        reason: 'db mode is intentionally scoped to persistence integration',
      },
      {
        name: 'application',
        reason: 'db mode is intentionally scoped to persistence integration',
      },
      {
        name: 'test-support',
        reason: 'db mode is intentionally scoped to persistence integration',
      },
      {
        name: 'web',
        reason: 'db mode is intentionally scoped to persistence integration',
      },
      {
        name: 'backup',
        reason: 'db mode excludes the separate backup integration profile',
      },
      {
        name: 'api',
        reason: 'db mode excludes the authenticated API integration profile',
      },
      {
        name: SEARCH_HARNESS_PROJECT,
        reason: 'db mode excludes the standing all-mode harness verification',
      },
    ],
  },
  api: {
    workspaceVitestProjects: ['api'],
    dedicatedProjects: [],
    deliberateExclusions: [
      {
        name: 'domain',
        reason: 'api mode is intentionally scoped to API integration',
      },
      {
        name: 'authz',
        reason: 'api mode is intentionally scoped to API integration',
      },
      {
        name: 'api-contracts',
        reason: 'api mode is intentionally scoped to API integration',
      },
      {
        name: 'application',
        reason: 'api mode is intentionally scoped to API integration',
      },
      {
        name: 'test-support',
        reason: 'api mode is intentionally scoped to API integration',
      },
      {
        name: 'web',
        reason: 'api mode is intentionally scoped to API integration',
      },
      {
        name: 'backup',
        reason: 'api mode excludes the separate backup integration profile',
      },
      {
        name: 'persistence',
        reason: 'api mode excludes the persistence-only integration profile',
      },
      {
        name: SEARCH_HARNESS_PROJECT,
        reason: 'api mode excludes the standing all-mode harness verification',
      },
    ],
  },
} as const satisfies Readonly<Record<string, VitestProjectExecutionPlan>>;

export type VitestTestMode = keyof typeof TEST_PROJECT_PLANS;

export type VitestProjectReconciliationFailureCode =
  | 'VITEST_WORKSPACE_PROJECTS_INVALID'
  | 'VITEST_EXECUTION_PLAN_INVALID'
  | 'VITEST_PROJECT_SET_MISMATCH';

export interface VitestProjectReconciliationDetails {
  readonly context: string;
  readonly configuredOnly: readonly string[];
  readonly executedOnly: readonly string[];
  readonly excludedOnly: readonly string[];
  readonly executedAndExcluded: readonly string[];
  readonly duplicateConfigured: readonly string[];
  readonly duplicateExecuted: readonly string[];
  readonly duplicateExcluded: readonly string[];
  readonly invalidExclusionReasons: readonly string[];
}

export class VitestProjectReconciliationError extends Error {
  readonly code: VitestProjectReconciliationFailureCode;
  readonly details: VitestProjectReconciliationDetails;

  constructor(
    code: VitestProjectReconciliationFailureCode,
    message: string,
    details: VitestProjectReconciliationDetails,
  ) {
    super(message);
    this.name = 'VitestProjectReconciliationError';
    this.code = code;
    this.details = Object.freeze({
      ...details,
      configuredOnly: Object.freeze([...details.configuredOnly]),
      executedOnly: Object.freeze([...details.executedOnly]),
      excludedOnly: Object.freeze([...details.excludedOnly]),
      executedAndExcluded: Object.freeze([...details.executedAndExcluded]),
      duplicateConfigured: Object.freeze([...details.duplicateConfigured]),
      duplicateExecuted: Object.freeze([...details.duplicateExecuted]),
      duplicateExcluded: Object.freeze([...details.duplicateExcluded]),
      invalidExclusionReasons: Object.freeze([
        ...details.invalidExclusionReasons,
      ]),
    });
  }
}

function emptyDetails(context: string): VitestProjectReconciliationDetails {
  return {
    context,
    configuredOnly: [],
    executedOnly: [],
    excludedOnly: [],
    executedAndExcluded: [],
    duplicateConfigured: [],
    duplicateExecuted: [],
    duplicateExcluded: [],
    invalidExclusionReasons: [],
  };
}

function assertProjectName(
  value: unknown,
  context: string,
  index: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw new VitestProjectReconciliationError(
      'VITEST_WORKSPACE_PROJECTS_INVALID',
      `Vitest project ${index} must have a canonical lowercase name without wildcards`,
      emptyDetails(context),
    );
  }
}

/**
 * Reads the actual runtime value exported by the pinned vitest.workspace.ts.
 * A future path/function/promise-style entry fails closed until this extractor
 * is deliberately extended; unnamed projects cannot be reconciled safely.
 */
export function configuredVitestProjectNames(
  workspaceDefinition: unknown,
  context = 'vitest.workspace.ts',
): readonly string[] {
  let definition = workspaceDefinition;
  if (typeof workspaceDefinition === 'object' && workspaceDefinition !== null) {
    const keys = Object.keys(workspaceDefinition);
    const record = workspaceDefinition as Readonly<Record<string, unknown>>;
    if (
      keys.length === 1 &&
      keys[0] === 'default' &&
      Object.hasOwn(record, 'default')
    ) {
      const wrappedDefault = record.default;
      if (Array.isArray(wrappedDefault)) {
        definition = wrappedDefault;
      }
    }
  }
  if (!Array.isArray(definition) || definition.length === 0) {
    throw new VitestProjectReconciliationError(
      'VITEST_WORKSPACE_PROJECTS_INVALID',
      'Vitest workspace must export a non-empty project array',
      emptyDetails(context),
    );
  }
  return definition.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || !('test' in entry)) {
      throw new VitestProjectReconciliationError(
        'VITEST_WORKSPACE_PROJECTS_INVALID',
        `Vitest workspace project ${index} is not an inline named project`,
        emptyDetails(context),
      );
    }
    const test = (entry as { readonly test?: unknown }).test;
    if (typeof test !== 'object' || test === null || !('name' in test)) {
      throw new VitestProjectReconciliationError(
        'VITEST_WORKSPACE_PROJECTS_INVALID',
        `Vitest workspace project ${index} is missing test.name`,
        emptyDetails(context),
      );
    }
    const name = (test as { readonly name?: unknown }).name;
    assertProjectName(name, context, index);
    return name;
  });
}

export function executedVitestProjectNames(
  plan: VitestProjectExecutionPlan,
): readonly string[] {
  for (const [index, execution] of plan.dedicatedProjects.entries()) {
    if (
      execution.runner !== 'harness-verify' ||
      execution.name !== SEARCH_HARNESS_PROJECT ||
      typeof execution.label !== 'string' ||
      execution.label.trim().length === 0
    ) {
      throw new VitestProjectReconciliationError(
        'VITEST_EXECUTION_PLAN_INVALID',
        `Dedicated Vitest execution ${index} is not bound to the search-harness verifier`,
        emptyDetails('Vitest execution plan'),
      );
    }
  }
  return [
    ...plan.workspaceVitestProjects,
    ...plan.dedicatedProjects.map(({ name }) => name),
  ];
}

function duplicateNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }
  return [...duplicates].sort();
}

export interface VitestProjectReconciliationInput {
  readonly context: string;
  readonly configuredProjects: readonly string[];
  readonly executedProjects: readonly string[];
  readonly deliberateExclusions: readonly DeliberateVitestProjectExclusion[];
}

/**
 * Requires configured = executed union deliberate exclusions, with all three
 * lists unique and executed/excluded disjoint. This catches both a newly
 * configured-but-unexecuted project and a stale/extra executed project.
 */
export function assertVitestProjectReconciliation(
  input: VitestProjectReconciliationInput,
): void {
  const {
    context,
    configuredProjects,
    executedProjects,
    deliberateExclusions,
  } = input;
  configuredProjects.forEach((name, index) =>
    assertProjectName(name, context, index),
  );
  executedProjects.forEach((name, index) =>
    assertProjectName(name, context, index),
  );
  deliberateExclusions.forEach(({ name }, index) =>
    assertProjectName(name, context, index),
  );

  const configured = new Set(configuredProjects);
  const executed = new Set(executedProjects);
  const excludedNames = deliberateExclusions.map(({ name }) => name);
  const excluded = new Set(excludedNames);
  const details: VitestProjectReconciliationDetails = {
    context,
    configuredOnly: [...configured]
      .filter((name) => !executed.has(name) && !excluded.has(name))
      .sort(),
    executedOnly: [...executed]
      .filter((name) => !configured.has(name))
      .sort(),
    excludedOnly: [...excluded]
      .filter((name) => !configured.has(name))
      .sort(),
    executedAndExcluded: [...executed]
      .filter((name) => excluded.has(name))
      .sort(),
    duplicateConfigured: duplicateNames(configuredProjects),
    duplicateExecuted: duplicateNames(executedProjects),
    duplicateExcluded: duplicateNames(excludedNames),
    invalidExclusionReasons: deliberateExclusions
      .filter(
        ({ reason }) =>
          typeof reason !== 'string' ||
          reason.length === 0 ||
          reason !== reason.trim(),
      )
      .map(({ name }) => name)
      .sort(),
  };
  if (
    Object.entries(details).some(
      ([key, value]) =>
        key !== 'context' && Array.isArray(value) && value.length > 0,
    )
  ) {
    throw new VitestProjectReconciliationError(
      'VITEST_PROJECT_SET_MISMATCH',
      `Vitest project reconciliation failed for ${context}: ${JSON.stringify(details)}`,
      details,
    );
  }
}
