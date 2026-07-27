import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  canonicalJson,
  canonicalSha256,
  sha256Hex,
} from '../canonical.js';
import {
  assertSunsetCoverage,
  buildSunsetCoverageManifest,
  compareSunsetCoverage,
  SUNSET_COVERAGE_MANIFEST_VERSION,
  SUNSET_COVERAGE_SURFACES,
} from './coverage.js';
import type {
  SunsetCoverageFailure,
  SunsetCoverageManifest,
  SunsetCoverageSurface,
} from './coverage.js';
import {
  assertSunsetRegistry,
  compareSunsetRegistry,
} from './compare.js';
import {
  parseFrozenSunsetCoverageManifest,
} from './frozenCoverageManifest.js';
import {
  parseCanonicalFrozenJson,
  serializeCanonicalFrozenJson,
  SUNSET_FROZEN_DATA_FILES,
} from './frozenData.js';
import type {
  SunsetFrozenDataFile,
} from './frozenData.js';
import {
  parseFrozenSunsetRegistry,
} from './frozenManifest.js';
import {
  buildLiveSunsetRegistrySnapshot,
  canonicalizeSunsetFingerprintBytes,
  listSunsetFingerprintInputFiles,
  searchHarnessWebv0Root,
} from './liveSnapshot.js';
import type {
  SunsetRegistryFailure,
  SunsetRegistrySnapshot,
} from './types.js';

const REGISTRY_FILE =
  'packages/search-harness/src/registry/frozenManifest.json' as const;
const COVERAGE_FILE =
  'packages/search-harness/src/registry/frozenCoverageManifest.json' as const;
const APPLY_ORDER = [COVERAGE_FILE, REGISTRY_FILE] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type SunsetRefreshRequest =
  | { readonly mode: 'preflight' }
  | { readonly mode: 'preview' }
  | {
      readonly mode: 'apply';
      readonly expectedPlanSha256: string;
    };

export interface SunsetRefreshGitEvidence {
  readonly gitHead: string;
  readonly trackedFingerprintInputCount: number;
  readonly untrackedFingerprintInputCount: 0;
  readonly fingerprintInputSetSha256: string;
  readonly fingerprintInputIndexSha256: string;
}

export interface SunsetRefreshArtifactEvidence {
  readonly relativePath: SunsetFrozenDataFile;
  readonly previousSha256: string;
  readonly previousByteCount: number;
  readonly candidateSha256: string;
  readonly candidateByteCount: number;
  readonly changed: boolean;
}

export interface SunsetRefreshBindingChange {
  readonly plannedRecordId: string;
  readonly previousFactKey: string | null;
  readonly candidateFactKey: string | null;
}

export interface SunsetRefreshCoverageDelta {
  readonly surface: SunsetCoverageSurface;
  readonly previousArtifactVersion: string;
  readonly candidateArtifactVersion: string;
  readonly previousFactSetSha256: string;
  readonly candidateFactSetSha256: string;
  readonly retainedFactCount: number;
  readonly addedFacts: readonly string[];
  readonly removedFacts: readonly string[];
  readonly bindingChanges: readonly SunsetRefreshBindingChange[];
}

export interface SunsetRefreshFalsifiers {
  readonly registry: readonly SunsetRegistryFailure[];
  readonly coverage: readonly SunsetCoverageFailure[];
}

export interface SunsetRefreshPlanEvidence
  extends SunsetRefreshGitEvidence {
  readonly claimCeiling:
    'mechanical-rebaseline-only-source-correctness-unverified';
  readonly nodeVersion: string;
  readonly typescriptVersion: string;
  readonly artifacts: readonly SunsetRefreshArtifactEvidence[];
  readonly previousCriticalSourcesSha256: string;
  readonly candidateCriticalSourcesSha256: string;
  readonly previousCriticalSourceFingerprintsSha256: string;
  readonly candidateCriticalSourceFingerprintsSha256: string;
  readonly coverageDeltas: readonly SunsetRefreshCoverageDelta[];
  readonly falsifiers: SunsetRefreshFalsifiers;
}

export interface SunsetRefreshPlan extends SunsetRefreshPlanEvidence {
  readonly planSha256: string;
  readonly previousSources: Readonly<
    Record<SunsetFrozenDataFile, string>
  >;
  readonly candidateSources: Readonly<
    Record<SunsetFrozenDataFile, string>
  >;
}

export interface AppliedSunsetRefresh {
  readonly plan: SunsetRefreshPlan;
  readonly postWriteArtifactSha256: Readonly<
    Record<SunsetFrozenDataFile, string>
  >;
  readonly postWriteRegistryFailureCount: 0;
  readonly postWriteCoverageFailureCount: 0;
  readonly freshPreflightPassed: true;
}

export interface SunsetRefreshIo {
  readonly read: (relativePath: SunsetFrozenDataFile) => string;
  readonly replace: (
    relativePath: SunsetFrozenDataFile,
    source: string,
  ) => void;
}

export interface SunsetRefreshGitDependencies {
  readonly runGit: (
    workingDirectory: string,
    args: readonly string[],
  ) => string;
  readonly listFingerprintInputFiles: () => readonly string[];
  readonly readIndexBlobs: (
    repoRoot: string,
    bindings: readonly SunsetRefreshIndexBinding[],
  ) => readonly Uint8Array[];
  readonly readWorktreeFile: (absolutePath: string) => Uint8Array;
}

export interface SunsetRefreshIndexBinding {
  readonly relativePath: string;
  readonly oid: string;
}

export interface SunsetRefreshPlanDependencies {
  readonly inspectGitEvidence: () => SunsetRefreshGitEvidence;
  readonly readFrozenArtifact: (
    relativePath: SunsetFrozenDataFile,
  ) => string;
  readonly buildLiveRegistry: () => SunsetRegistrySnapshot;
}

function refreshFailure(code: string): Error {
  return Object.assign(new Error('Search sunset refresh failed'), {
    code,
  });
}

export function parseSunsetRefreshRequest(
  args: readonly string[],
): SunsetRefreshRequest {
  if (args.length === 0) return { mode: 'preflight' };
  if (args.length === 1 && args[0] === '--refresh') {
    return { mode: 'preview' };
  }
  if (
    args.length === 3 &&
    args[0] === '--refresh' &&
    args[1] === '--apply' &&
    SHA256_PATTERN.test(args[2] ?? '')
  ) {
    return {
      mode: 'apply',
      expectedPlanSha256: args[2]!,
    };
  }
  throw refreshFailure('SUNSET_REFRESH_ARGUMENTS_INVALID');
}

function normalizedRepoPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function runGit(
  workingDirectory: string,
  args: readonly string[],
): string {
  const result = spawnSync(
    'git',
    ['-C', workingDirectory, ...args],
    {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  if (
    result.status !== 0 ||
    result.error !== undefined ||
    typeof result.stdout !== 'string'
  ) {
    throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
  }
  return result.stdout;
}

function readIndexBlobs(
  repoRoot: string,
  bindings: readonly SunsetRefreshIndexBinding[],
): readonly Uint8Array[] {
  const child = spawnSync(
    'git',
    ['-C', repoRoot, 'cat-file', '--batch'],
    {
      input: `${bindings.map(({ oid }) => oid).join('\n')}\n`,
      maxBuffer: 256 * 1024 * 1024,
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  if (
    child.status !== 0 ||
    child.error !== undefined ||
    !Buffer.isBuffer(child.stdout)
  ) {
    throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
  }

  const blobs: Buffer[] = [];
  let cursor = 0;
  for (const binding of bindings) {
    const headerEnd = child.stdout.indexOf(0x0a, cursor);
    if (headerEnd < 0) {
      throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
    }
    const header = child.stdout
      .subarray(cursor, headerEnd)
      .toString('ascii');
    const match =
      /^([a-f0-9]{40}|[a-f0-9]{64}) blob ([0-9]+)$/u.exec(
        header,
      );
    const size = Number(match?.[2]);
    if (
      !match ||
      match[1] !== binding.oid ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (
      contentEnd >= child.stdout.length ||
      child.stdout[contentEnd] !== 0x0a
    ) {
      throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
    }
    blobs.push(Buffer.from(child.stdout.subarray(
      contentStart,
      contentEnd,
    )));
    cursor = contentEnd + 1;
  }
  if (cursor !== child.stdout.length) {
    throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
  }
  return blobs;
}

const DEFAULT_GIT_DEPENDENCIES: SunsetRefreshGitDependencies = {
  runGit,
  listFingerprintInputFiles: listSunsetFingerprintInputFiles,
  readIndexBlobs,
  readWorktreeFile: (absolutePath) => readFileSync(absolutePath),
};

interface SunsetRefreshIndexEntry {
  readonly mode: string;
  readonly oid: string;
}

function nulRecords(source: string): readonly string[] {
  if (source.length === 0) return [];
  if (!source.endsWith('\u0000')) {
    throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
  }
  return source.slice(0, -1).split('\u0000');
}

function parseIndexEntries(
  source: string,
): ReadonlyMap<string, SunsetRefreshIndexEntry> {
  const entries = new Map<string, SunsetRefreshIndexEntry>();
  for (const record of nulRecords(source)) {
    const match =
      /^([0-9]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([\s\S]+)$/u.exec(
        record,
      );
    if (!match || entries.has(match[3]!)) {
      throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
    }
    entries.set(match[3]!, {
      mode: match[1]!,
      oid: match[2]!,
    });
  }
  return entries;
}

function parseIndexFlags(
  source: string,
): ReadonlyMap<string, string> {
  const flags = new Map<string, string>();
  for (const record of nulRecords(source)) {
    if (
      record.length < 3 ||
      record[1] !== ' ' ||
      flags.has(record.slice(2))
    ) {
      throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
    }
    flags.set(record.slice(2), record[0]!);
  }
  return flags;
}

export function inspectSunsetRefreshGitEvidence(
  webv0Root = searchHarnessWebv0Root(),
  dependencies = DEFAULT_GIT_DEPENDENCIES,
): SunsetRefreshGitEvidence {
  if (
    dependencies.runGit(webv0Root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]).length !== 0
  ) {
    throw refreshFailure('SUNSET_REFRESH_WORKTREE_NOT_CLEAN');
  }

  const repoRoot = dependencies.runGit(webv0Root, [
    'rev-parse',
    '--show-toplevel',
  ]).trim();
  const gitHead = dependencies.runGit(
    webv0Root,
    ['rev-parse', 'HEAD'],
  ).trim();
  if (
    repoRoot.length === 0 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(gitHead)
  ) {
    throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
  }
  const indexEntries = parseIndexEntries(
    dependencies.runGit(repoRoot, [
      'ls-files',
      '--stage',
      '-z',
      '--full-name',
    ]),
  );
  const indexFlags = parseIndexFlags(
    dependencies.runGit(repoRoot, [
      'ls-files',
      '-v',
      '-z',
      '--full-name',
    ]),
  );
  const inputPaths = [
    ...new Set([
      ...dependencies.listFingerprintInputFiles(),
      ...SUNSET_FROZEN_DATA_FILES,
    ]),
  ].map((relativePath) => {
    const absolutePath = resolve(
      webv0Root,
      ...relativePath.split('/'),
    );
    const repoRelativePath = normalizedRepoPath(
      relative(repoRoot, absolutePath),
    );
    if (
      repoRelativePath.length === 0 ||
      repoRelativePath === '..' ||
      repoRelativePath.startsWith('../')
    ) {
      throw refreshFailure('SUNSET_REFRESH_INPUT_OUTSIDE_REPOSITORY');
    }
    return repoRelativePath;
  }).sort();
  const untrackedInputs = inputPaths.filter(
    (relativePath) => !indexEntries.has(relativePath),
  );
  if (untrackedInputs.length > 0) {
    throw refreshFailure('SUNSET_REFRESH_UNTRACKED_FINGERPRINT_INPUT');
  }
  if (
    inputPaths.some(
      (relativePath) => {
        const entry = indexEntries.get(relativePath)!;
        return (
          indexFlags.get(relativePath) !== 'H' ||
          (entry.mode !== '100644' && entry.mode !== '100755')
        );
      },
    )
  ) {
    throw refreshFailure('SUNSET_REFRESH_INDEX_FLAG_UNSAFE');
  }

  const rawIndexBindings = inputPaths.map((relativePath) => ({
    relativePath,
    oid: indexEntries.get(relativePath)!.oid,
  }));
  const indexBlobs = dependencies.readIndexBlobs(
    repoRoot,
    rawIndexBindings,
  );
  if (indexBlobs.length !== inputPaths.length) {
    throw refreshFailure('SUNSET_REFRESH_GIT_INSPECTION_FAILED');
  }
  const indexBindings = inputPaths.map((relativePath, index) => {
    const entry = indexEntries.get(relativePath)!;
    const worktreeBytes = dependencies.readWorktreeFile(
      resolve(repoRoot, ...relativePath.split('/')),
    );
    const worktreeSha256 = sha256Hex(
      canonicalizeSunsetFingerprintBytes(worktreeBytes),
    );
    const indexSha256 = sha256Hex(
      canonicalizeSunsetFingerprintBytes(indexBlobs[index]!),
    );
    if (worktreeSha256 !== indexSha256) {
      throw refreshFailure(
        'SUNSET_REFRESH_WORKTREE_INDEX_MISMATCH',
      );
    }
    return {
      relativePath,
      mode: entry.mode,
      oid: entry.oid,
      canonicalContentSha256: indexSha256,
    };
  });

  return {
    gitHead,
    trackedFingerprintInputCount: new Set(inputPaths).size,
    untrackedFingerprintInputCount: 0,
    fingerprintInputSetSha256: canonicalSha256(inputPaths),
    fingerprintInputIndexSha256: canonicalSha256(indexBindings),
  };
}

function assertSameGitEvidence(
  expected: SunsetRefreshGitEvidence,
  actual: SunsetRefreshGitEvidence,
  failureCode = 'SUNSET_REFRESH_INPUT_CHANGED_DURING_PLAN',
): void {
  const evidenceValue = (value: SunsetRefreshGitEvidence) => ({
    gitHead: value.gitHead,
    trackedFingerprintInputCount:
      value.trackedFingerprintInputCount,
    untrackedFingerprintInputCount:
      value.untrackedFingerprintInputCount,
    fingerprintInputSetSha256:
      value.fingerprintInputSetSha256,
    fingerprintInputIndexSha256:
      value.fingerprintInputIndexSha256,
  });
  if (
    canonicalSha256(evidenceValue(expected)) !==
    canonicalSha256(evidenceValue(actual))
  ) {
    throw refreshFailure(failureCode);
  }
}

function coverageDelta(
  surface: SunsetCoverageSurface,
  previous: SunsetCoverageManifest,
  candidate: SunsetCoverageManifest,
): SunsetRefreshCoverageDelta {
  const previousInventory = previous.surfaces[surface];
  const candidateInventory = candidate.surfaces[surface];
  const previousFacts = previousInventory.entries
    .map(({ factKey }) => factKey)
    .sort();
  const candidateFacts = candidateInventory.entries
    .map(({ factKey }) => factKey)
    .sort();
  const previousFactSet = new Set(previousFacts);
  const candidateFactSet = new Set(candidateFacts);
  const previousById = new Map(
    previousInventory.entries.map((entry) => [
      entry.plannedRecordId,
      entry.factKey,
    ]),
  );
  const candidateById = new Map(
    candidateInventory.entries.map((entry) => [
      entry.plannedRecordId,
      entry.factKey,
    ]),
  );
  const plannedRecordIds = [
    ...new Set([
      ...previousById.keys(),
      ...candidateById.keys(),
    ]),
  ].sort();

  return {
    surface,
    previousArtifactVersion: previousInventory.artifactVersion,
    candidateArtifactVersion: candidateInventory.artifactVersion,
    previousFactSetSha256: canonicalSha256(previousFacts),
    candidateFactSetSha256: canonicalSha256(candidateFacts),
    retainedFactCount: previousFacts.filter((fact) =>
      candidateFactSet.has(fact),
    ).length,
    addedFacts: candidateFacts.filter(
      (fact) => !previousFactSet.has(fact),
    ),
    removedFacts: previousFacts.filter(
      (fact) => !candidateFactSet.has(fact),
    ),
    bindingChanges: plannedRecordIds
      .map((plannedRecordId) => ({
        plannedRecordId,
        previousFactKey:
          previousById.get(plannedRecordId) ?? null,
        candidateFactKey:
          candidateById.get(plannedRecordId) ?? null,
      }))
      .filter(
        ({ previousFactKey, candidateFactKey }) =>
          previousFactKey !== candidateFactKey,
      ),
  };
}

function artifactEvidence(
  relativePath: SunsetFrozenDataFile,
  previousSource: string,
  candidateSource: string,
): SunsetRefreshArtifactEvidence {
  const previousSha256 = sha256Hex(previousSource);
  const candidateSha256 = sha256Hex(candidateSource);
  return {
    relativePath,
    previousSha256,
    previousByteCount: Buffer.byteLength(previousSource, 'utf8'),
    candidateSha256,
    candidateByteCount: Buffer.byteLength(candidateSource, 'utf8'),
    changed: previousSha256 !== candidateSha256,
  };
}

function normalizeFailureAbsence<
  T extends SunsetRegistryFailure | SunsetCoverageFailure,
>(failure: T): T {
  const normalized = { ...failure } as Record<string, unknown>;
  if ('expected' in failure && failure.expected === undefined) {
    normalized.expected = { state: 'absent' };
  }
  if ('actual' in failure && failure.actual === undefined) {
    normalized.actual = { state: 'absent' };
  }
  return normalized as T;
}

export function buildSearchSunsetRefreshPlan(
  gitEvidence: SunsetRefreshGitEvidence,
  previousSources: Readonly<
    Record<SunsetFrozenDataFile, string>
  >,
  previousRegistry: SunsetRegistrySnapshot,
  previousCoverage: SunsetCoverageManifest,
  liveRegistry: SunsetRegistrySnapshot,
): SunsetRefreshPlan {
  assertSunsetCoverage(previousRegistry, previousCoverage);
  const candidateRegistry = parseFrozenSunsetRegistry(liveRegistry);
  const candidateCoverage = parseFrozenSunsetCoverageManifest(
    buildSunsetCoverageManifest(candidateRegistry),
  );
  assertSunsetRegistry(candidateRegistry, liveRegistry);
  assertSunsetCoverage(liveRegistry, candidateCoverage);

  const candidateSources = {
    [REGISTRY_FILE]: serializeCanonicalFrozenJson(candidateRegistry),
    [COVERAGE_FILE]: serializeCanonicalFrozenJson(candidateCoverage),
  } satisfies Record<SunsetFrozenDataFile, string>;
  const evidence: SunsetRefreshPlanEvidence = {
    claimCeiling:
      'mechanical-rebaseline-only-source-correctness-unverified',
    nodeVersion: process.version,
    typescriptVersion: ts.version,
    ...gitEvidence,
    artifacts: SUNSET_FROZEN_DATA_FILES.map((relativePath) =>
      artifactEvidence(
        relativePath,
        previousSources[relativePath],
        candidateSources[relativePath],
      ),
    ),
    previousCriticalSourcesSha256: canonicalSha256(
      previousRegistry.criticalSources,
    ),
    candidateCriticalSourcesSha256: canonicalSha256(
      candidateRegistry.criticalSources,
    ),
    previousCriticalSourceFingerprintsSha256: canonicalSha256(
      previousRegistry.criticalSourceFingerprints,
    ),
    candidateCriticalSourceFingerprintsSha256: canonicalSha256(
      candidateRegistry.criticalSourceFingerprints,
    ),
    coverageDeltas: SUNSET_COVERAGE_SURFACES.map((surface) =>
      coverageDelta(
        surface,
        previousCoverage,
        candidateCoverage,
      ),
    ),
    falsifiers: {
      registry: compareSunsetRegistry(
        previousRegistry,
        candidateRegistry,
      ).map(normalizeFailureAbsence),
      coverage: compareSunsetCoverage(
        candidateRegistry,
        previousCoverage,
      ).map(normalizeFailureAbsence),
    },
  };
  return {
    ...evidence,
    planSha256: canonicalSha256(evidence),
    previousSources,
    candidateSources,
  };
}

function readFrozenArtifact(
  webv0Root: string,
  relativePath: SunsetFrozenDataFile,
): string {
  const absolutePath = resolve(
    webv0Root,
    ...relativePath.split('/'),
  );
  if (!lstatSync(absolutePath).isFile()) {
    throw refreshFailure('SUNSET_REFRESH_ARTIFACT_NOT_REGULAR');
  }
  try {
    return new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(readFileSync(absolutePath));
  } catch {
    throw refreshFailure('SUNSET_REFRESH_ARTIFACT_INVALID_UTF8');
  }
}

export function createSearchSunsetRefreshPlanWithDependencies(
  dependencies: SunsetRefreshPlanDependencies,
): SunsetRefreshPlan {
  const gitEvidenceBefore = dependencies.inspectGitEvidence();
  const previousSources = {
    [REGISTRY_FILE]:
      dependencies.readFrozenArtifact(REGISTRY_FILE),
    [COVERAGE_FILE]:
      dependencies.readFrozenArtifact(COVERAGE_FILE),
  } satisfies Record<SunsetFrozenDataFile, string>;
  const previousRegistry = parseFrozenSunsetRegistry(
    parseCanonicalFrozenJson(
      previousSources[REGISTRY_FILE],
      REGISTRY_FILE,
    ),
  );
  const previousCoverage = parseFrozenSunsetCoverageManifest(
    parseCanonicalFrozenJson(
      previousSources[COVERAGE_FILE],
      COVERAGE_FILE,
    ),
  );
  const liveRegistry = dependencies.buildLiveRegistry();
  const gitEvidenceAfter = dependencies.inspectGitEvidence();
  assertSameGitEvidence(gitEvidenceBefore, gitEvidenceAfter);
  return buildSearchSunsetRefreshPlan(
    gitEvidenceAfter,
    previousSources,
    previousRegistry,
    previousCoverage,
    liveRegistry,
  );
}

export function createSearchSunsetRefreshPlan(): SunsetRefreshPlan {
  const webv0Root = searchHarnessWebv0Root();
  return createSearchSunsetRefreshPlanWithDependencies({
    inspectGitEvidence: () =>
      inspectSunsetRefreshGitEvidence(webv0Root),
    readFrozenArtifact: (relativePath) =>
      readFrozenArtifact(webv0Root, relativePath),
    buildLiveRegistry: buildLiveSunsetRegistrySnapshot,
  });
}

function atomicReplaceFrozenArtifact(
  webv0Root: string,
  relativePath: SunsetFrozenDataFile,
  source: string,
): void {
  // This is one-file atomic visibility with mode-bit preservation. The
  // surrounding two-file operation is intentionally fail-closed + rollback,
  // not a claim of crash-durable filesystem transaction or ACL/xattr custody.
  const absolutePath = resolve(
    webv0Root,
    ...relativePath.split('/'),
  );
  const artifact = lstatSync(absolutePath);
  if (!artifact.isFile() || (artifact.mode & 0o111) !== 0) {
    throw refreshFailure('SUNSET_REFRESH_ARTIFACT_MODE_INVALID');
  }
  const artifactMode = artifact.mode & 0o777;
  const temporaryPath = `${absolutePath}.sunset-refresh-${process.pid}-${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, 'wx', artifactMode);
    writeFileSync(descriptor, source, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, artifactMode);
    renameSync(temporaryPath, absolutePath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function defaultRefreshIo(webv0Root: string): SunsetRefreshIo {
  return {
    read: (relativePath) =>
      readFrozenArtifact(webv0Root, relativePath),
    replace: (relativePath, source) =>
      atomicReplaceFrozenArtifact(
        webv0Root,
        relativePath,
        source,
      ),
  };
}

export function applySunsetRefreshSources(
  plan: SunsetRefreshPlan,
  io: SunsetRefreshIo,
  verify: () => void,
): void {
  for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
    if (io.read(relativePath) !== plan.previousSources[relativePath]) {
      throw refreshFailure('SUNSET_REFRESH_PLAN_STALE');
    }
  }

  try {
    for (const relativePath of APPLY_ORDER) {
      io.replace(
        relativePath,
        plan.candidateSources[relativePath],
      );
    }
    for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
      if (
        io.read(relativePath) !==
        plan.candidateSources[relativePath]
      ) {
        throw refreshFailure('SUNSET_REFRESH_WRITE_MISMATCH');
      }
    }
    verify();
  } catch {
    let rollbackFailed = false;
    for (const relativePath of [...APPLY_ORDER].reverse()) {
      try {
        io.replace(
          relativePath,
          plan.previousSources[relativePath],
        );
      } catch {
        rollbackFailed = true;
      }
    }
    for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
      try {
        if (
          io.read(relativePath) !==
          plan.previousSources[relativePath]
        ) {
          rollbackFailed = true;
        }
      } catch {
        rollbackFailed = true;
      }
    }
    throw refreshFailure(
      rollbackFailed
        ? 'SUNSET_REFRESH_ROLLBACK_FAILED'
        : 'SUNSET_REFRESH_WRITE_FAILED',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => actualKeys[index] === key)
  );
}

export function assertFreshSunsetPreflightReceipt(
  source: unknown,
): void {
  if (typeof source !== 'string' || source.length === 0) {
    throw refreshFailure('SUNSET_REFRESH_FRESH_PREFLIGHT_FAILED');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw refreshFailure('SUNSET_REFRESH_FRESH_PREFLIGHT_FAILED');
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ['attestations', 'command', 'status']) ||
    parsed.command !== 'search:harness:sunset-preflight' ||
    parsed.status !== 'PASS' ||
    !isRecord(parsed.attestations) ||
    !hasExactKeys(parsed.attestations, [
      'safetyStage',
      'sunsetCoverageManifest',
      'sunsetCoverageSurfaceCount',
    ]) ||
    parsed.attestations.safetyStage !== 'H0' ||
    parsed.attestations.sunsetCoverageManifest !==
      SUNSET_COVERAGE_MANIFEST_VERSION ||
    parsed.attestations.sunsetCoverageSurfaceCount !==
      SUNSET_COVERAGE_SURFACES.length ||
    source !== `${canonicalJson(parsed)}\n`
  ) {
    throw refreshFailure('SUNSET_REFRESH_FRESH_PREFLIGHT_FAILED');
  }
}

function assertFreshSunsetArtifacts(
  webv0Root: string,
  io: SunsetRefreshIo,
): void {
  const registry = parseFrozenSunsetRegistry(
    parseCanonicalFrozenJson(
      io.read(REGISTRY_FILE),
      REGISTRY_FILE,
    ),
  );
  const coverage = parseFrozenSunsetCoverageManifest(
    parseCanonicalFrozenJson(
      io.read(COVERAGE_FILE),
      COVERAGE_FILE,
    ),
  );
  const live = buildLiveSunsetRegistrySnapshot();
  assertSunsetRegistry(registry, live);
  assertSunsetCoverage(live, coverage);

  const tsx = resolve(
    webv0Root,
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs',
  );
  const preflight = resolve(
    webv0Root,
    'packages',
    'search-harness',
    'src',
    'cli',
    'sunsetPreflight.ts',
  );
  const child = spawnSync(
    process.execPath,
    [tsx, preflight],
    {
      cwd: webv0Root,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  if (child.status !== 0 || child.error !== undefined) {
    throw refreshFailure('SUNSET_REFRESH_FRESH_PREFLIGHT_FAILED');
  }
  assertFreshSunsetPreflightReceipt(child.stdout);
}

export function applySunsetRefreshPlan(
  expectedPlanSha256: string,
  plan: SunsetRefreshPlan,
  currentGitEvidence: SunsetRefreshGitEvidence,
  io: SunsetRefreshIo,
  verify: () => void,
): void {
  if (!SHA256_PATTERN.test(expectedPlanSha256)) {
    throw refreshFailure('SUNSET_REFRESH_PLAN_INVALID');
  }
  if (plan.planSha256 !== expectedPlanSha256) {
    throw refreshFailure('SUNSET_REFRESH_PLAN_STALE');
  }
  assertSameGitEvidence(
    plan,
    currentGitEvidence,
    'SUNSET_REFRESH_PLAN_STALE',
  );
  applySunsetRefreshSources(plan, io, verify);
}

export function applySearchSunsetRefresh(
  expectedPlanSha256: string,
): AppliedSunsetRefresh {
  if (!SHA256_PATTERN.test(expectedPlanSha256)) {
    throw refreshFailure('SUNSET_REFRESH_PLAN_INVALID');
  }
  const plan = createSearchSunsetRefreshPlan();
  if (plan.planSha256 !== expectedPlanSha256) {
    throw refreshFailure('SUNSET_REFRESH_PLAN_STALE');
  }
  const webv0Root = searchHarnessWebv0Root();
  const io = defaultRefreshIo(webv0Root);
  const currentGitEvidence =
    inspectSunsetRefreshGitEvidence(webv0Root);
  applySunsetRefreshPlan(
    expectedPlanSha256,
    plan,
    currentGitEvidence,
    io,
    () => assertFreshSunsetArtifacts(webv0Root, io),
  );

  const postWriteArtifactSha256 = Object.fromEntries(
    SUNSET_FROZEN_DATA_FILES.map((relativePath) => [
      relativePath,
      sha256Hex(io.read(relativePath)),
    ]),
  ) as Record<SunsetFrozenDataFile, string>;
  return {
    plan,
    postWriteArtifactSha256,
    postWriteRegistryFailureCount: 0,
    postWriteCoverageFailureCount: 0,
    freshPreflightPassed: true,
  };
}

export function publicSunsetRefreshPlan(
  plan: SunsetRefreshPlan,
): SunsetRefreshPlanEvidence & { readonly planSha256: string } {
  const {
    previousSources: _previousSources,
    candidateSources: _candidateSources,
    ...publicPlan
  } = plan;
  return publicPlan;
}
