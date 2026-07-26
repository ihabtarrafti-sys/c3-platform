#!/usr/bin/env node

/**
 * Reconstruct and compare the dae27a4 Wave-1 search baseline.
 *
 * This is deliberately a drift proof, not a disclosure-authorization proof.
 * B0 is reconstructed from the implementation. Equality therefore proves only
 * that this frozen baseline still represents the pinned implementation bytes.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  evaluatePredicate,
  sourceIsInPinnedBaseline,
} from './HEARTH-003-disclosure-drift-checker.mjs';
import { parseProjectionAuthoritySource } from './HEARTH-003-projection-authority-parser.ts';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const PRODUCT_COMMIT = 'dae27a400868c0c686788ab8e5520690dbf77334';
const HISTORICAL_TRANSCRIPT_AUTHORITY_COMMIT =
  '1dd953e91907482f3c70b4beba17a7e81cd80662';
const SEARCH_SQL_PATH = 'webv0/packages/persistence/src/searchSql.ts';
const SEARCH_USECASE_PATH = 'webv0/packages/application/src/usecases/search.ts';
const BASELINE_FILENAME =
  'HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json';
const HISTORICAL_TRANSCRIPT_FILENAME =
  'HEARTH-003-APPROVED-DISCLOSURE-PREDICATES-v2.json';
const AUTHORITATIVE_FILENAME =
  'HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json';
const ACTOR_FILENAME = 'HEARTH-003-ACTOR-CLASSES-v2.json';
const FIELD_SCOPE_FILENAME =
  'HEARTH-003-AUTHORITATIVE-FIELD-SCOPE-v1.json';
const FIXTURE_FILENAME = 'HEARTH-003-FIXTURE-CONTRACT-v5.json';
const MEASUREMENT_FILENAME =
  'HEARTH-003-DELEGATION-MEASUREMENT-v2.json';
const DRIFT_RECEIPT_FILENAME =
  'HEARTH-003-DISCLOSURE-DRIFT-RED-SELF-TEST-v1.json';
const PHYSICAL_REPORT_FILENAME =
  'HEARTH-003-PHYSICAL-DOMAIN-VALIDATION-v3.json';
const OUTPUT_FILENAME =
  'HEARTH-003-IMPLEMENTATION-DRIFT-DIFF-v1.json';
const strictUtf8 = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((candidate) =>
    candidate.startsWith(prefix),
  );
  return value ? value.slice(prefix.length) : null;
}

function canonicalTextBytes(bytes: Buffer, label: string): Buffer {
  strictUtf8.decode(bytes);
  if (bytes.includes(0)) throw new Error(`${label} contains NUL`);
  const output: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] === 0x0a) index += 1;
      output.push(0x0a);
    } else {
      output.push(bytes[index]!);
    }
  }
  return Buffer.from(output);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalTextSha256(bytes: Buffer, label: string): string {
  return sha256(canonicalTextBytes(bytes, label));
}

function parseJson(filename: string): {
  readonly bytes: Buffer;
  readonly value: any;
} {
  const bytes = readFileSync(join(artifactDir, filename));
  return {
    bytes,
    value: JSON.parse(
      canonicalTextBytes(bytes, filename).toString('utf8'),
    ),
  };
}

function gitBytes(
  repository: string,
  commit: string,
  path: string,
): Buffer {
  return execFileSync('git', ['show', `${commit}:${path}`], {
    cwd: repository,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

function historicalTranscriptAllows({
  fixture,
  actor,
  transcript,
  authoritative,
  actorClasses,
}: {
  readonly fixture: any;
  readonly actor: any;
  readonly transcript: any;
  readonly authoritative: any;
  readonly actorClasses: any;
}): boolean {
  const policy = transcript.registers[fixture.source.register];
  if (!policy) {
    throw new Error(
      `historical transcript lacks ${fixture.source.register}`,
    );
  }
  return evaluatePredicate(
    policy.disclosableWhen,
    {
      actor,
      row: {
        ...(fixture.rowFacts ?? {}),
        tenantSlot: fixture.source.tenantSlot,
        recordKind: fixture.source.recordKind,
      },
      dependencies: fixture.dependencies ?? [],
    },
    transcript.namedPredicates,
    authoritative.registers,
    actorClasses,
  );
}

function main(): void {
  const productRepo = resolve(
    argument('repo') ?? join(artifactDir, '..', 'c3-fable'),
  );
  const moduleRoot = resolve(argument('module-root') ?? process.cwd());

  const baselineArtifact = parseJson(BASELINE_FILENAME);
  const authoritativeArtifact = parseJson(AUTHORITATIVE_FILENAME);
  const actorArtifact = parseJson(ACTOR_FILENAME);
  const fieldScopeArtifact = parseJson(FIELD_SCOPE_FILENAME);
  const fixtureArtifact = parseJson(FIXTURE_FILENAME);
  const measurementArtifact = parseJson(MEASUREMENT_FILENAME);
  const driftReceiptArtifact = parseJson(DRIFT_RECEIPT_FILENAME);
  const physicalReportArtifact = parseJson(PHYSICAL_REPORT_FILENAME);

  if (
    baselineArtifact.value.baselineLineage.productCommit !==
      PRODUCT_COMMIT ||
    baselineArtifact.value.baselineLineage.specificationStatus !==
      'The implementation is the only extant specification of this source, field, and projection set.'
  ) {
    throw new Error('B0 does not carry the ruled implementation lineage');
  }

  const historicalTranscriptBytes = gitBytes(
    artifactDir,
    HISTORICAL_TRANSCRIPT_AUTHORITY_COMMIT,
    HISTORICAL_TRANSCRIPT_FILENAME,
  );
  const historicalTranscript = JSON.parse(
    canonicalTextBytes(
      historicalTranscriptBytes,
      HISTORICAL_TRANSCRIPT_FILENAME,
    ).toString('utf8'),
  );
  const searchSqlBytes = gitBytes(
    productRepo,
    PRODUCT_COMMIT,
    SEARCH_SQL_PATH,
  );
  const searchUsecaseBytes = gitBytes(
    productRepo,
    PRODUCT_COMMIT,
    SEARCH_USECASE_PATH,
  );
  const searchSqlText = canonicalTextBytes(
    searchSqlBytes,
    SEARCH_SQL_PATH,
  ).toString('utf8');
  const requireFromProduct = createRequire(
    join(moduleRoot, 'package.json'),
  );
  const typescript = requireFromProduct('typescript');
  const parsedSearch = parseProjectionAuthoritySource(
    searchSqlText,
    typescript,
  );

  const parsedSpecByKind = new Map(
    parsedSearch.specs.map((spec) => [spec.kind, spec]),
  );
  const fieldDiffs: Array<Record<string, unknown>> = [];
  let baselineLogicalMatchFieldCount = 0;
  let sourceDerivedPhysicalMatchFieldCount = 0;
  for (const [register, policy] of Object.entries(
    baselineArtifact.value.registers,
  ) as Array<[string, any]>) {
    const parsedSpec = parsedSpecByKind.get(register);
    if (!parsedSpec) throw new Error(`search source lacks ${register}`);
    const binding =
      fieldScopeArtifact.value.qrelPhysicalFieldBindings[register];
    if (!binding) throw new Error(`field bridge lacks ${register}`);
    const baselineFields = policy.mayMatch.map(
      ({ field, class: fieldClass }: any) => `${field}:${fieldClass}`,
    );
    const implementationFields = parsedSpec.match.map(
      (physicalField: string) => {
        const mapped = binding[physicalField];
        return mapped
          ? `${mapped[0]}:${mapped[1]}`
          : `UNMAPPED:${physicalField}`;
      },
    );
    baselineLogicalMatchFieldCount += baselineFields.length;
    sourceDerivedPhysicalMatchFieldCount += implementationFields.length;
    const implementationOutsideBaseline = implementationFields.filter(
      (field: string) => !baselineFields.includes(field),
    );
    const baselineOutsideImplementation = baselineFields.filter(
      (field: string) => !implementationFields.includes(field),
    );
    fieldDiffs.push({
      register,
      baselineFields,
      implementationFields,
      implementationOutsideBaseline,
      baselineOutsideImplementation,
      outcome:
        implementationOutsideBaseline.length === 0 &&
        baselineOutsideImplementation.length === 0
          ? 'PINNED_BASELINE_EQUAL'
          : 'BASELINE_DRIFT',
    });
  }
  const fieldMismatches = fieldDiffs.filter(
    ({ outcome }) => outcome !== 'PINNED_BASELINE_EQUAL',
  );
  if (fieldMismatches.length > 0) {
    throw new Error(
      `match-field baseline drift in ${fieldMismatches.length} registers`,
    );
  }

  let sourceObservationCount = 0;
  let baselineIncludedCount = 0;
  const sourceMismatches: Array<Record<string, unknown>> = [];
  for (const actorProfile of measurementArtifact.value.actorProfileCatalog) {
    const actor = {
      ...actorProfile,
      tenantSlot: actorProfile.tenantSlot,
      role: actorProfile.role,
    };
    for (const fixture of fixtureArtifact.value.fixtures) {
      const baselineIncluded = sourceIsInPinnedBaseline({
        fixture,
        actor,
        policy: baselineArtifact.value,
        authoritative: authoritativeArtifact.value,
        actorClasses: actorArtifact.value,
      });
      const transcriptIncluded = historicalTranscriptAllows({
        fixture,
        actor,
        transcript: historicalTranscript,
        authoritative: authoritativeArtifact.value,
        actorClasses: actorArtifact.value,
      });
      sourceObservationCount += 1;
      if (baselineIncluded) baselineIncludedCount += 1;
      if (baselineIncluded !== transcriptIncluded) {
        sourceMismatches.push({
          actorProfileId: actorProfile.actorProfileId,
          fixtureId: fixture.fixtureId,
          baselineIncluded,
          historicalTranscriptIncluded: transcriptIncluded,
        });
      }
    }
  }
  if (sourceMismatches.length > 0) {
    throw new Error(
      `source baseline reconstruction differs in ${sourceMismatches.length} observations`,
    );
  }

  const projectionCheck = physicalReportArtifact.value.checks.find(
    ({ check }: any) =>
      check ===
      'source-derived-natural-guarded-projection-through-c3-app',
  );
  const staticGuardCheck = physicalReportArtifact.value.checks.find(
    ({ check }: any) =>
      check === 'projection-static-guard-negative-controls',
  );
  if (
    projectionCheck?.status !== 'PASS' ||
    projectionCheck?.count !== 356 ||
    staticGuardCheck?.status !== 'PASS' ||
    staticGuardCheck?.count !== 3 ||
    driftReceiptArtifact.value
      .logicalProjectionRecipeValidatedFixtureCount !== 356
  ) {
    throw new Error('projection reconstruction inputs do not reconcile');
  }

  const sourceBytes = readFileSync(fileURLToPath(import.meta.url));
  const output = {
    schemaVersion: 1,
    artifactKind: 'hearth-search-implementation-drift-diff',
    diffVersion: 'HEARTH-003-IMPLEMENTATION-DRIFT-DIFF-v1',
    syntheticOnly: true,
    authority: 'Apex Lumen',
    overallOutcome: 'PASS_PINNED_BASELINE_RECONSTRUCTION_EQUAL',
    claimBoundary:
      'This receipt proves that B0 reconstructs the dae27a4 implementation baseline over the stated bounded universe. It proves drift sensitivity and equality only. It does not prove authorization, correctness, completeness, leak safety, or a separate disclosure specification.',
    baselineIdentity: {
      artifact: BASELINE_FILENAME,
      canonicalTextSha256: canonicalTextSha256(
        baselineArtifact.bytes,
        BASELINE_FILENAME,
      ),
      productCommit: PRODUCT_COMMIT,
      historicalTranscriptAuthorityCommit:
        HISTORICAL_TRANSCRIPT_AUTHORITY_COMMIT,
      historicalTranscriptFilename: HISTORICAL_TRANSCRIPT_FILENAME,
      historicalTranscriptCanonicalTextSha256:
        canonicalTextSha256(
          historicalTranscriptBytes,
          HISTORICAL_TRANSCRIPT_FILENAME,
        ),
    },
    productInputs: {
      searchSqlPath: SEARCH_SQL_PATH,
      searchSqlCanonicalTextSha256: canonicalTextSha256(
        searchSqlBytes,
        SEARCH_SQL_PATH,
      ),
      searchUsecasePath: SEARCH_USECASE_PATH,
      searchUsecaseCanonicalTextSha256: canonicalTextSha256(
        searchUsecaseBytes,
        SEARCH_USECASE_PATH,
      ),
      parserVersion: parsedSearch.parserVersion,
      typescriptVersion: parsedSearch.typescriptVersion,
      parserCombinedSemanticSha256: parsedSearch.semanticHash,
    },
    authorityInputHashes: {
      authoritativePredicatesCanonicalTextSha256:
        canonicalTextSha256(
          authoritativeArtifact.bytes,
          AUTHORITATIVE_FILENAME,
        ),
      actorClassesCanonicalTextSha256: canonicalTextSha256(
        actorArtifact.bytes,
        ACTOR_FILENAME,
      ),
      fieldScopeCanonicalTextSha256: canonicalTextSha256(
        fieldScopeArtifact.bytes,
        FIELD_SCOPE_FILENAME,
      ),
      fixtureCanonicalTextSha256: canonicalTextSha256(
        fixtureArtifact.bytes,
        FIXTURE_FILENAME,
      ),
      delegationMeasurementCanonicalTextSha256:
        canonicalTextSha256(
          measurementArtifact.bytes,
          MEASUREMENT_FILENAME,
        ),
      driftReceiptCanonicalTextSha256: canonicalTextSha256(
        driftReceiptArtifact.bytes,
        DRIFT_RECEIPT_FILENAME,
      ),
      physicalValidationCanonicalTextSha256:
        canonicalTextSha256(
          physicalReportArtifact.bytes,
          PHYSICAL_REPORT_FILENAME,
        ),
      diffSourceCanonicalTextSha256: canonicalTextSha256(
        sourceBytes,
        fileURLToPath(import.meta.url),
      ),
    },
    sourceBaselineReconstruction: {
      comparisonUniverse:
        `${measurementArtifact.value.actorProfileCatalog.length} exact actor profiles x ${fixtureArtifact.value.fixtures.length} exact fixtures`,
      observationCount: sourceObservationCount,
      baselineIncludedObservationCount: baselineIncludedCount,
      mismatchCount: sourceMismatches.length,
      outcome: 'PINNED_BASELINE_EQUAL',
      interpretation:
        'The 49,840 observations compare B0 with the immutable historical implementation transcript. They prove reconstruction equality, not disclosure authority.',
    },
    matchFieldBaselineReconstruction: {
      sourceDerivedRegisterCount: parsedSearch.specs.length,
      sourceDerivedPhysicalMatchFieldCount,
      baselineLogicalMatchFieldCount,
      mismatchRegisterCount: fieldMismatches.length,
      outcome: 'PINNED_BASELINE_EQUAL',
      perRegister: fieldDiffs,
    },
    projectionBaselineReconstruction: {
      logicalRecipeToFixtureBaselineProjectionCount: 356,
      livePostgresSourceDerivedNaturalIncludedCount: 353,
      livePostgresStaticGuardExcludedCount: 3,
      separateStaticGuardNegativeControlCount: 3,
      oppositeTenantRlsDenialCount: 356,
      outcome: 'PINNED_BASELINE_EQUAL',
      scope:
        'The JavaScript checker and the r4 PostgreSQL report are dual execution implementations over shared baseline recipes. Physical Validation v3 remains an r4-era report and does not prove B0 authorization or re-earn r6 policy semantics.',
    },
    noDecisionStatement:
      'No output of this diff authorizes disclosure, changes a product gate, starts H4, or upgrades NOT_YET_MEASURED.',
  };

  if (process.argv.includes('--write')) {
    writeFileSync(
      join(artifactDir, OUTPUT_FILENAME),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`wrote ${OUTPUT_FILENAME}\n`);
  }
  process.stdout.write(
    `implementation drift PASS (${sourceObservationCount} source observations; ${baselineLogicalMatchFieldCount} match fields; 353+3 projection split)\n`,
  );
}

main();
