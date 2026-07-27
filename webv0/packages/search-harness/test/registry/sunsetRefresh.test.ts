import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/canonical';
import {
  FROZEN_SUNSET_COVERAGE_MANIFEST,
  FROZEN_SUNSET_REGISTRY,
  SUNSET_COVERAGE_MANIFEST_VERSION,
  SUNSET_COVERAGE_SURFACES,
  SUNSET_FROZEN_DATA_FILES,
  applySunsetRefreshPlan,
  applySunsetRefreshSources,
  assertFreshSunsetPreflightReceipt,
  buildLiveSunsetRegistrySnapshot,
  buildSearchSunsetRefreshPlan,
  buildSunsetCoverageManifest,
  createSearchSunsetRefreshPlanWithDependencies,
  inspectSunsetRefreshGitEvidence,
  parseSunsetRefreshRequest,
  publicSunsetRefreshPlan,
  searchHarnessWebv0Root,
  serializeCanonicalFrozenJson,
} from '../../src/registry';
import type {
  SunsetFrozenDataFile,
  SunsetRefreshGitDependencies,
  SunsetRefreshGitEvidence,
  SunsetRefreshIo,
  SunsetRefreshPlan,
  SunsetRegistrySnapshot,
} from '../../src/registry';

const REGISTRY_FILE = SUNSET_FROZEN_DATA_FILES[0];
const COVERAGE_FILE = SUNSET_FROZEN_DATA_FILES[1];

function frozenSources(): Record<SunsetFrozenDataFile, string> {
  return {
    [REGISTRY_FILE]:
      serializeCanonicalFrozenJson(FROZEN_SUNSET_REGISTRY),
    [COVERAGE_FILE]:
      serializeCanonicalFrozenJson(
        FROZEN_SUNSET_COVERAGE_MANIFEST,
      ),
  };
}

function liveWithFingerprint(fill: string): SunsetRegistrySnapshot {
  return {
    ...FROZEN_SUNSET_REGISTRY,
    criticalSourceFingerprints: {
      ...FROZEN_SUNSET_REGISTRY.criticalSourceFingerprints,
      'apps/api/src#tree': fill.repeat(64),
    },
  };
}

function buildPlan(fill = 'a'): SunsetRefreshPlan {
  return buildSearchSunsetRefreshPlan(
    {
      gitHead: '1'.repeat(40),
      trackedFingerprintInputCount: 123,
      untrackedFingerprintInputCount: 0,
      fingerprintInputSetSha256: '2'.repeat(64),
      fingerprintInputIndexSha256: '3'.repeat(64),
    },
    frozenSources(),
    FROZEN_SUNSET_REGISTRY,
    FROZEN_SUNSET_COVERAGE_MANIFEST,
    liveWithFingerprint(fill),
  );
}

function gitEvidence(
  plan: SunsetRefreshPlan,
): SunsetRefreshGitEvidence {
  return {
    gitHead: plan.gitHead,
    trackedFingerprintInputCount:
      plan.trackedFingerprintInputCount,
    untrackedFingerprintInputCount:
      plan.untrackedFingerprintInputCount,
    fingerprintInputSetSha256:
      plan.fingerprintInputSetSha256,
    fingerprintInputIndexSha256:
      plan.fingerprintInputIndexSha256,
  };
}

function memoryIo(
  initial: Readonly<Record<SunsetFrozenDataFile, string>>,
  failReplaceCalls: ReadonlySet<number> = new Set(),
): {
  readonly io: SunsetRefreshIo;
  readonly values: Record<SunsetFrozenDataFile, string>;
  readonly replaceCount: () => number;
} {
  const values = { ...initial };
  let replacements = 0;
  return {
    values,
    replaceCount: () => replacements,
    io: {
      read: (relativePath) => values[relativePath],
      replace: (relativePath, source) => {
        replacements += 1;
        if (failReplaceCalls.has(replacements)) {
          throw new Error('synthetic write failure');
        }
        values[relativePath] = source;
      },
    },
  };
}

function fakeGitDependencies(options: {
  readonly status?: string;
  readonly omitTrackedPath?: string;
  readonly unsafeFlagPath?: string;
  readonly unsafeModePath?: string;
  readonly mismatchedBlobPath?: string;
  readonly worktreeCrLf?: boolean;
} = {}): {
  readonly webv0Root: string;
  readonly dependencies: SunsetRefreshGitDependencies;
} {
  const repoRoot = 'C:\\synthetic\\repo';
  const webv0Root = `${repoRoot}\\webv0`;
  const oid = 'a'.repeat(40);
  const inputPaths = [
    'webv0/packages/domain/src/example.ts',
    ...SUNSET_FROZEN_DATA_FILES.map(
      (relativePath) => `webv0/${relativePath}`,
    ),
  ].sort();
  const trackedPaths = inputPaths.filter(
    (relativePath) => relativePath !== options.omitTrackedPath,
  );
  const stageSource = `${trackedPaths
    .map(
      (relativePath) =>
        `${
          relativePath === options.unsafeModePath
            ? '120000'
            : '100644'
        } ${oid} 0\t${relativePath}`,
    )
    .join('\u0000')}\u0000`;
  const flagSource = `${trackedPaths
    .map(
      (relativePath) =>
        `${
          relativePath === options.unsafeFlagPath ? 'h' : 'H'
        } ${relativePath}`,
    )
    .join('\u0000')}\u0000`;

  return {
    webv0Root,
    dependencies: {
      listFingerprintInputFiles: () => [
        'packages/domain/src/example.ts',
      ],
      readIndexBlobs: (_root, bindings) =>
        bindings.map(({ relativePath }) =>
          Buffer.from(`content:${relativePath}\n`, 'utf8'),
        ),
      readWorktreeFile: (absolutePath) => {
        const relativePath = absolutePath
          .slice(repoRoot.length + 1)
          .replaceAll('\\', '/');
        return Buffer.from(
          relativePath === options.mismatchedBlobPath
            ? `changed:${relativePath}\n`
            : `content:${relativePath}${
                options.worktreeCrLf ? '\r\n' : '\n'
              }`,
          'utf8',
        );
      },
      runGit: (_workingDirectory, args) => {
        if (args[0] === 'status') return options.status ?? '';
        if (
          args[0] === 'rev-parse' &&
          args[1] === '--show-toplevel'
        ) {
          return `${repoRoot}\n`;
        }
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return `${'1'.repeat(40)}\n`;
        }
        if (args[0] === 'ls-files' && args[1] === '--stage') {
          return stageSource;
        }
        if (args[0] === 'ls-files' && args[1] === '-v') {
          return flagSource;
        }
        throw new Error(`unexpected git command: ${args.join(' ')}`);
      },
    },
  };
}

describe('H0 deterministic sunset refresh', () => {
  it('re-derives both checked-in artifacts byte-for-byte', () => {
    const sources = frozenSources();
    expect(
      serializeCanonicalFrozenJson(
        buildSunsetCoverageManifest(FROZEN_SUNSET_REGISTRY),
      ),
    ).toBe(sources[COVERAGE_FILE]);

    for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
      expect(
        readFileSync(
          resolve(searchHarnessWebv0Root(), relativePath),
          'utf8',
        ),
      ).toBe(sources[relativePath]);
    }
  });

  it('constructs both candidates from the live snapshot path', () => {
    const live = buildLiveSunsetRegistrySnapshot();
    const plan = buildSearchSunsetRefreshPlan(
      {
        gitHead: '1'.repeat(40),
        trackedFingerprintInputCount: 123,
        untrackedFingerprintInputCount: 0,
        fingerprintInputSetSha256: '2'.repeat(64),
        fingerprintInputIndexSha256: '3'.repeat(64),
      },
      frozenSources(),
      FROZEN_SUNSET_REGISTRY,
      FROZEN_SUNSET_COVERAGE_MANIFEST,
      live,
    );
    expect(plan.candidateSources[REGISTRY_FILE]).toBe(
      serializeCanonicalFrozenJson(live),
    );
    expect(plan.candidateSources[COVERAGE_FILE]).toBe(
      serializeCanonicalFrozenJson(
        buildSunsetCoverageManifest(live),
      ),
    );
  });

  it('accepts only preflight, preview, or digest-bound apply', () => {
    expect(parseSunsetRefreshRequest([])).toEqual({
      mode: 'preflight',
    });
    expect(parseSunsetRefreshRequest(['--refresh'])).toEqual({
      mode: 'preview',
    });
    expect(
      parseSunsetRefreshRequest([
        '--refresh',
        '--apply',
        'a'.repeat(64),
      ]),
    ).toEqual({
      mode: 'apply',
      expectedPlanSha256: 'a'.repeat(64),
    });
    for (const args of [
      ['--apply', 'a'.repeat(64)],
      ['--refresh', '--apply'],
      ['--refresh', '--apply', 'not-a-digest'],
      ['--refresh', '--unknown'],
    ]) {
      expect(() => parseSunsetRefreshRequest(args)).toThrow(
        expect.objectContaining({
          code: 'SUNSET_REFRESH_ARGUMENTS_INVALID',
        }),
      );
    }
  });

  it('RED: invalid CLI arguments stay inside the sanitized command boundary', () => {
    const webv0Root = searchHarnessWebv0Root();
    const child = spawnSync(
      process.execPath,
      [
        resolve(
          webv0Root,
          'node_modules',
          'tsx',
          'dist',
          'cli.mjs',
        ),
        resolve(
          webv0Root,
          'packages',
          'search-harness',
          'src',
          'cli',
          'sunsetPreflight.ts',
        ),
        '--invalid-refresh-argument',
      ],
      {
        cwd: webv0Root,
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    expect(child.status).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr).toContain(
      '"code":"SUNSET_REFRESH_ARGUMENTS_INVALID"',
    );
    expect(child.stderr).not.toContain(webv0Root);
    expect(child.stderr).not.toContain('refresh.ts');
    expect(child.stderr).not.toContain('at ');
  });

  it('requires clean, tracked, ordinary, byte-matching Git inputs', () => {
    const valid = fakeGitDependencies();
    const evidence = inspectSunsetRefreshGitEvidence(
      valid.webv0Root,
      valid.dependencies,
    );
    expect(evidence).toMatchObject({
      gitHead: '1'.repeat(40),
      trackedFingerprintInputCount: 3,
      untrackedFingerprintInputCount: 0,
    });
    expect(evidence.fingerprintInputSetSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(evidence.fingerprintInputIndexSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    const crlf = fakeGitDependencies({ worktreeCrLf: true });
    expect(() =>
      inspectSunsetRefreshGitEvidence(
        crlf.webv0Root,
        crlf.dependencies,
      ),
    ).not.toThrow();

    const cases = [
      [
        fakeGitDependencies({ status: ' M webv0/input.ts' }),
        'SUNSET_REFRESH_WORKTREE_NOT_CLEAN',
      ],
      [
        fakeGitDependencies({
          omitTrackedPath:
            'webv0/packages/domain/src/example.ts',
        }),
        'SUNSET_REFRESH_UNTRACKED_FINGERPRINT_INPUT',
      ],
      [
        fakeGitDependencies({
          unsafeFlagPath:
            'webv0/packages/domain/src/example.ts',
        }),
        'SUNSET_REFRESH_INDEX_FLAG_UNSAFE',
      ],
      [
        fakeGitDependencies({
          unsafeModePath:
            'webv0/packages/domain/src/example.ts',
        }),
        'SUNSET_REFRESH_INDEX_FLAG_UNSAFE',
      ],
      [
        fakeGitDependencies({
          mismatchedBlobPath:
            'webv0/packages/domain/src/example.ts',
        }),
        'SUNSET_REFRESH_WORKTREE_INDEX_MISMATCH',
      ],
    ] as const;
    for (const [testCase, code] of cases) {
      expect(() =>
        inspectSunsetRefreshGitEvidence(
          testCase.webv0Root,
          testCase.dependencies,
        ),
      ).toThrow(expect.objectContaining({ code }));
    }
  });

  it('RED: a changed second planning audit prevents plan creation', () => {
    const firstEvidence = gitEvidence(buildPlan());
    const secondEvidence = {
      ...firstEvidence,
      fingerprintInputIndexSha256: 'f'.repeat(64),
    };
    let inspections = 0;

    expect(() =>
      createSearchSunsetRefreshPlanWithDependencies({
        inspectGitEvidence: () => {
          inspections += 1;
          return inspections === 1
            ? firstEvidence
            : secondEvidence;
        },
        readFrozenArtifact: (relativePath) =>
          frozenSources()[relativePath],
        buildLiveRegistry: () =>
          liveWithFingerprint('a'),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'SUNSET_REFRESH_INPUT_CHANGED_DURING_PLAN',
      }),
    );
    expect(inspections).toBe(2);
  });

  it('RED: fresh preflight requires the exact canonical PASS verdict', () => {
    const receipt = {
      command: 'search:harness:sunset-preflight',
      status: 'PASS',
      attestations: {
        safetyStage: 'H0',
        sunsetCoverageManifest: SUNSET_COVERAGE_MANIFEST_VERSION,
        sunsetCoverageSurfaceCount: SUNSET_COVERAGE_SURFACES.length,
      },
    };
    const canonicalReceipt = `${canonicalJson(receipt)}\n`;
    expect(() =>
      assertFreshSunsetPreflightReceipt(canonicalReceipt),
    ).not.toThrow();

    for (const source of [
      '',
      `${canonicalJson({ ...receipt, status: 'FAIL' })}\n`,
      `${canonicalJson({
        ...receipt,
        command: 'unrelated-command',
      })}\n`,
      JSON.stringify(receipt),
      `${canonicalJson({
        ...receipt,
        attestations: {
          ...receipt.attestations,
          sunsetCoverageSurfaceCount: 0,
        },
      })}\n`,
    ]) {
      expect(() =>
        assertFreshSunsetPreflightReceipt(source),
      ).toThrow(
        expect.objectContaining({
          code: 'SUNSET_REFRESH_FRESH_PREFLIGHT_FAILED',
        }),
      );
    }
  });

  it('prints the exact registry and coverage falsifiers for one changed input', () => {
    const plan = buildPlan();
    expect(plan.falsifiers.registry).toHaveLength(1);
    expect(plan.falsifiers.registry[0]).toMatchObject({
      code: 'SUNSET_CRITICAL_SOURCE_CHANGED',
      path: 'criticalSourceFingerprints.apps/api/src#tree',
    });
    expect(plan.falsifiers.coverage).toHaveLength(
      SUNSET_COVERAGE_SURFACES.length * 2,
    );
    for (const delta of plan.coverageDeltas) {
      expect(delta.retainedFactCount).toBe(
        FROZEN_SUNSET_COVERAGE_MANIFEST.surfaces[delta.surface]
          .entries.length - 1,
      );
      expect(delta.addedFacts).toHaveLength(1);
      expect(delta.removedFacts).toHaveLength(1);
      expect(delta.bindingChanges).toHaveLength(1);
    }
    expect(plan.artifacts).toHaveLength(2);
    expect(plan.artifacts.every(({ changed }) => changed)).toBe(true);
    expect(plan.claimCeiling).toBe(
      'mechanical-rebaseline-only-source-correctness-unverified',
    );
  });

  it('encodes missing comparator values so additions and removals remain printable', () => {
    const role = Object.keys(
      FROZEN_SUNSET_REGISTRY.roleCapabilities,
    )[0]!;
    const vector =
      FROZEN_SUNSET_REGISTRY.roleCapabilities[role]!;
    const existingCapability = Object.keys(vector)[0]!;
    const additionsAndRemovals: SunsetRegistrySnapshot[] = [
      {
        ...FROZEN_SUNSET_REGISTRY,
        roleCapabilities: {
          ...FROZEN_SUNSET_REGISTRY.roleCapabilities,
          [role]: {
            ...vector,
            syntheticCapability: false,
          },
        },
      },
      {
        ...FROZEN_SUNSET_REGISTRY,
        roleCapabilities: {
          ...FROZEN_SUNSET_REGISTRY.roleCapabilities,
          [role]: Object.fromEntries(
            Object.entries(vector).filter(
              ([capability]) =>
                capability !== existingCapability,
            ),
          ),
        },
      },
    ];

    for (const live of additionsAndRemovals) {
      const plan = buildSearchSunsetRefreshPlan(
        {
          gitHead: '1'.repeat(40),
          trackedFingerprintInputCount: 123,
          untrackedFingerprintInputCount: 0,
          fingerprintInputSetSha256: '2'.repeat(64),
          fingerprintInputIndexSha256: '3'.repeat(64),
        },
        frozenSources(),
        FROZEN_SUNSET_REGISTRY,
        FROZEN_SUNSET_COVERAGE_MANIFEST,
        live,
      );
      const failure = plan.falsifiers.registry.find(
        ({ code }) =>
          code === 'SUNSET_CAPABILITY_COMPOSITION_CHANGED',
      );
      expect(failure).toBeDefined();
      expect([failure?.expected, failure?.actual]).toContainEqual({
        state: 'absent',
      });
      expect(plan.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('binds apply to the complete plan and keeps artifact bytes private', () => {
    const first = buildPlan('a');
    const second = buildPlan('b');
    expect(first.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.planSha256).not.toBe(first.planSha256);

    const published = publicSunsetRefreshPlan(first);
    expect(published.planSha256).toBe(first.planSha256);
    expect(published).not.toHaveProperty('previousSources');
    expect(published).not.toHaveProperty('candidateSources');
  });

  it('RED: the actual apply guard rejects stale digest or Git evidence before writing', () => {
    const plan = buildPlan();
    const staleGitEvidence = {
      ...gitEvidence(plan),
      fingerprintInputIndexSha256: 'f'.repeat(64),
    };

    for (const [digest, evidence] of [
      ['f'.repeat(64), gitEvidence(plan)],
      [plan.planSha256, staleGitEvidence],
    ] as const) {
      const memory = memoryIo(plan.previousSources);
      expect(() =>
        applySunsetRefreshPlan(
          digest,
          plan,
          evidence,
          memory.io,
          () => {},
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'SUNSET_REFRESH_PLAN_STALE',
        }),
      );
      expect(memory.replaceCount()).toBe(0);
      expect(memory.values).toEqual(plan.previousSources);
    }
  });

  it.each([
    ['first replacement', new Set([1])],
    ['second replacement', new Set([2])],
  ])(
    'RED: %s failure restores both exact prior artifacts',
    (_name, failures) => {
      const plan = buildPlan();
      const memory = memoryIo(plan.previousSources, failures);

      expect(() =>
        applySunsetRefreshSources(plan, memory.io, () => {}),
      ).toThrow(
        expect.objectContaining({
          code: 'SUNSET_REFRESH_WRITE_FAILED',
        }),
      );
      expect(memory.values).toEqual(plan.previousSources);
    },
  );

  it('RED: post-write verification failure restores both exact artifacts', () => {
    const plan = buildPlan();
    const memory = memoryIo(plan.previousSources);

    expect(() =>
      applySunsetRefreshSources(plan, memory.io, () => {
        throw new Error('synthetic verification failure');
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'SUNSET_REFRESH_WRITE_FAILED',
      }),
    );
    expect(memory.values).toEqual(plan.previousSources);
  });

  it('RED: a replacement that silently writes nothing cannot PASS', () => {
    const plan = buildPlan();
    const values = { ...plan.previousSources };
    const io: SunsetRefreshIo = {
      read: (relativePath) => values[relativePath],
      replace: () => {},
    };

    expect(() =>
      applySunsetRefreshSources(plan, io, () => {}),
    ).toThrow(
      expect.objectContaining({
        code: 'SUNSET_REFRESH_WRITE_FAILED',
      }),
    );
    expect(values).toEqual(plan.previousSources);
  });

  it('RED: stale artifact bytes prevent the first replacement', () => {
    const plan = buildPlan();
    const initial = {
      ...plan.previousSources,
      [REGISTRY_FILE]: `${plan.previousSources[REGISTRY_FILE]} `,
    };
    const memory = memoryIo(initial);

    expect(() =>
      applySunsetRefreshSources(plan, memory.io, () => {}),
    ).toThrow(
      expect.objectContaining({
        code: 'SUNSET_REFRESH_PLAN_STALE',
      }),
    );
    expect(memory.replaceCount()).toBe(0);
  });

  it('RED: incomplete rollback reports the partial write instead of PASS', () => {
    const plan = buildPlan();
    const memory = memoryIo(
      plan.previousSources,
      new Set([2, 4]),
    );

    expect(() =>
      applySunsetRefreshSources(plan, memory.io, () => {}),
    ).toThrow(
      expect.objectContaining({
        code: 'SUNSET_REFRESH_ROLLBACK_FAILED',
      }),
    );
    expect(memory.values[COVERAGE_FILE]).toBe(
      plan.candidateSources[COVERAGE_FILE],
    );
    expect(memory.values[REGISTRY_FILE]).toBe(
      plan.previousSources[REGISTRY_FILE],
    );
  });
});
