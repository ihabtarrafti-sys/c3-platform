import { describe, expect, it } from 'vitest';

import {
  CorpusManifestV1Schema,
  RecordReadyRunManifestV1Schema,
  RunManifestV1Schema,
  SearchGoldCaseV1Schema,
  SearchQrelSetV1Schema,
  SourceIdentityV1Schema,
  VisibilityMatrixV1Schema,
} from '../src/schemas.js';

const sha = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const shaC = '9'.repeat(64);
const hearthReviewer = {
  authority: 'hearth',
  reviewerId: 'hearth-reviewer',
  signatureKeyId: 'hearth-key-v1',
  detachedSignatureSha256: 'c'.repeat(64),
} as const;
const neuralReviewer = {
  authority: 'neural-security',
  reviewerId: 'neural-reviewer',
  signatureKeyId: 'neural-key-v1',
  detachedSignatureSha256: 'd'.repeat(64),
} as const;
const personSource = {
  schemaVersion: 1,
  tenantSlot: 'tenant-a',
  register: 'person',
  recordId: 'PER-0001',
  recordKind: null,
} as const;
const documentSource = {
  schemaVersion: 1,
  tenantSlot: 'tenant-a',
  register: 'document',
  recordId: 'DOC-0001',
  recordKind: 'RegisteredEvidence',
} as const;

const validQrel = {
  schemaVersion: 1,
  queryCaseId: 'exact-person-1',
  queryClass: 'exact_id',
  query: 'PER-0001',
  applicableProfiles: ['owner-active'],
  authoritativeRelevant: {
    'owner-active': [personSource],
  },
  forbiddenSources: {
    'owner-active': [documentSource],
  },
  forbiddenSentinelIds: ['pii-1'],
  rationale: 'Synthetic exact-ID adjudication.',
  adjudicators: [hearthReviewer, neuralReviewer],
} as const;

const validVisibility = {
  schemaVersion: 1,
  visibilityKind: 'hearth-search-visibility',
  syntheticOnly: true,
  visibilityMatrixVersion: 'visibility-v1',
  applicationPolicyDependencySha256: sha,
  migrationStateSha256: sha,
  authoritativeOracle: {
    artifactSha256: sha,
    reviewers: [hearthReviewer, neuralReviewer],
  },
  approvedSearchDisclosure: {
    artifactSha256: shaB,
    reviewers: [hearthReviewer, neuralReviewer],
  },
  profiles: [
    {
      profileId: 'owner-active',
      tenantSlot: 'tenant-a',
      actorId: 'actor-owner-a',
      role: 'owner',
      entitlementSnapshot: 'active-current',
      entitlementSnapshotSha256: sha,
      approvedDisclosures: [
        {
          source: personSource,
          projection: {
            kind: 'person',
            id: 'PER-0001',
            title: 'Synthetic Person 0001',
            subtitle: null,
            parentId: null,
          },
        },
      ],
      forbiddenSources: [documentSource],
    },
  ],
} as const;

const validRunManifest = {
  schemaVersion: 1,
  manifestKind: 'hearth-search-run',
  syntheticOnly: true,
  runId: 'run-2026-07-24-001',
  executionProfile: 'full_acceptance',
  harnessVersion: 'harness-v1',
  generatorVersion: 'generator-v1',
  datasetVersion: 'dataset-v1',
  datasetSha256: sha,
  querySetVersion: 'queries-v1',
  querySetSha256: sha,
  visibilityMatrixVersion: 'visibility-v1',
  visibilityMatrixSha256: sha,
  authoritativeOracleSha256: sha,
  approvedSearchDisclosureSha256: shaB,
  entitlementSnapshotSha256: sha,
  retrievalProfileVersion: 'legacy-lexical-v1',
  retrievalProfileSha256: sha,
  authorizationDependencySha256: sha,
  performanceProfileVersion: 'performance-v1',
  performanceProfileSha256: sha,
  performanceProfileApprovalSha256: shaC,
  applicationCommitSha: 'a1'.repeat(20),
  harnessCommitSha: 'b2'.repeat(20),
  harnessWorktreeClean: true,
  artifactAttestationSha256: sha,
  migrationHead: '0089_document_comms_owner_types',
  migrationChecksumStateSha256: sha,
  nodeVersion: '22.17.0',
  postgresVersion: '17.5',
  extensionVersions: { pgcrypto: '1.3' },
  databaseSettings: {
    row_security: 'on',
    max_parallel_workers: 8,
  },
  apiPoolSize: 20,
  applicationDatabasePoolSize: 20,
  authenticationDatabasePoolSize: 5,
  attestedApplicationPoolConnectionCount: 20,
  attestedAuthenticationPoolConnectionCount: 5,
  databaseBoundaryAttestationStatus: 'passed',
  databaseBoundaryAttestationSha256: sha,
  hardwareProfile: 'hearth-ci-linux-x64',
  operatingSystem: 'linux-x64',
  clientConcurrency: 20,
  schedulerSeed: 'scheduler-v1',
  warmState: 'warm',
  nodeEnv: 'production',
  rateLimitMax: 100_000,
  observed429Count: 0,
  applicationDatabaseCredentialSha256: 'e'.repeat(64),
  authenticationDatabaseCredentialSha256: 'f'.repeat(64),
  databaseTargetSha256: sha,
  startedAt: '2026-07-24T10:00:00.000Z',
  endedAt: '2026-07-24T10:10:00.000Z',
} as const;

describe('versioned artifact schemas', () => {
  it('accepts ordinary and document source identities', () => {
    expect(SourceIdentityV1Schema.parse(personSource)).toEqual(personSource);
    expect(SourceIdentityV1Schema.parse(documentSource)).toEqual(documentSource);
  });

  it('rejects unknown versions and invalid record-kind discrimination', () => {
    expect(
      SourceIdentityV1Schema.safeParse({
        ...personSource,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      SourceIdentityV1Schema.safeParse({
        ...personSource,
        recordKind: 'Attachment',
      }).success,
    ).toBe(false);
    expect(
      SourceIdentityV1Schema.safeParse({
        ...documentSource,
        recordKind: null,
      }).success,
    ).toBe(false);
  });

  it('accepts a strict, synthetic corpus manifest', () => {
    const manifest = {
      schemaVersion: 1,
      manifestKind: 'hearth-search-corpus',
      syntheticOnly: true,
      harnessVersion: 'harness-v1',
      generatorVersion: 'generator-v1',
      datasetVersion: 'dataset-v1',
      seedRunId: 'seed-run-1',
      tenantSlots: ['tenant-a', 'tenant-b'],
      sourceIdentities: [
        personSource,
        { ...personSource, tenantSlot: 'tenant-b' },
      ],
      canaryCounts: { record_kind: 1 },
    };

    expect(CorpusManifestV1Schema.parse(manifest)).toEqual(manifest);
    expect(
      CorpusManifestV1Schema.safeParse({
        ...manifest,
        sourceIdentities: [personSource, personSource],
      }).success,
    ).toBe(false);
  });

  it('accepts independently adjudicated qrels and rejects contradictions', () => {
    expect(SearchGoldCaseV1Schema.parse(validQrel)).toEqual(validQrel);
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        forbiddenSources: { 'owner-active': [personSource] },
      }).success,
    ).toBe(false);

    const qrelSet = {
      schemaVersion: 1,
      qrelKind: 'hearth-search-qrels',
      syntheticOnly: true,
      querySetVersion: 'queries-v1',
      applicationPolicyDependencySha256: sha,
      migrationStateSha256: sha,
      cases: [validQrel],
    };
    expect(SearchQrelSetV1Schema.parse(qrelSet)).toEqual(qrelSet);
  });

  it('RED: requires every qrel profile to have only explicit oracle maps', () => {
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        authoritativeRelevant: {},
      }).success,
    ).toBe(false);
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        forbiddenSources: {
          ...validQrel.forbiddenSources,
          'undeclared-profile': [],
        },
      }).success,
    ).toBe(false);
  });

  it('RED: rejects duplicate qrel sources and sentinel IDs', () => {
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        authoritativeRelevant: {
          'owner-active': [personSource, personSource],
        },
      }).success,
    ).toBe(false);
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        forbiddenSentinelIds: ['pii-1', 'pii-1'],
      }).success,
    ).toBe(false);
  });

  it('RED: qrels require independent Hearth and Neural/security signatures', () => {
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        adjudicators: [
          hearthReviewer,
          {
            ...neuralReviewer,
            authority: 'hearth',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        adjudicators: [
          hearthReviewer,
          {
            ...neuralReviewer,
            signatureKeyId: hearthReviewer.signatureKeyId,
            detachedSignatureSha256:
              hearthReviewer.detachedSignatureSha256,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('RED: never normalizes an Attachment into authoritative qrel relevance', () => {
    const attachment = {
      ...documentSource,
      recordKind: 'Attachment',
    } as const;
    expect(
      SearchGoldCaseV1Schema.safeParse({
        ...validQrel,
        authoritativeRelevant: {
          'owner-active': [attachment],
        },
        forbiddenSources: {
          'owner-active': [],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts dual-oracle visibility and rejects projection/source drift', () => {
    expect(VisibilityMatrixV1Schema.parse(validVisibility)).toEqual(validVisibility);
    const drifted = {
      ...validVisibility,
      profiles: [
        {
          ...validVisibility.profiles[0],
          approvedDisclosures: [
            {
              ...validVisibility.profiles[0].approvedDisclosures[0],
              projection: {
                ...validVisibility.profiles[0].approvedDisclosures[0].projection,
                id: 'PER-OTHER',
              },
            },
          ],
        },
      ],
    };

    expect(VisibilityMatrixV1Schema.safeParse(drifted).success).toBe(false);
  });

  it('RED: never permits an Attachment to enter approved disclosure', () => {
    const attachment = {
      ...documentSource,
      recordKind: 'Attachment',
    } as const;
    const visibility = {
      ...validVisibility,
      profiles: [
        {
          ...validVisibility.profiles[0],
          approvedDisclosures: [
            {
              source: attachment,
              projection: {
                kind: 'document',
                id: attachment.recordId,
                title: 'Forbidden attachment',
                subtitle: null,
                parentId: null,
              },
            },
          ],
          forbiddenSources: [],
        },
      ],
    };

    expect(VisibilityMatrixV1Schema.safeParse(visibility).success).toBe(false);
  });

  it('RED: rejects duplicate approved and forbidden source identities', () => {
    const approved =
      validVisibility.profiles[0].approvedDisclosures[0];
    expect(
      VisibilityMatrixV1Schema.safeParse({
        ...validVisibility,
        profiles: [
          {
            ...validVisibility.profiles[0],
            approvedDisclosures: [
              approved,
              {
                ...approved,
                projection: {
                  ...approved.projection,
                  title: 'Conflicting title',
                },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      VisibilityMatrixV1Schema.safeParse({
        ...validVisibility,
        profiles: [
          {
            ...validVisibility.profiles[0],
            forbiddenSources: [documentSource, documentSource],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('RED: requires independent oracle artifacts and both reviewer authorities', () => {
    expect(
      VisibilityMatrixV1Schema.safeParse({
        ...validVisibility,
        approvedSearchDisclosure: {
          ...validVisibility.approvedSearchDisclosure,
          artifactSha256: validVisibility.authoritativeOracle.artifactSha256,
        },
      }).success,
    ).toBe(false);
    expect(
      VisibilityMatrixV1Schema.safeParse({
        ...validVisibility,
        authoritativeOracle: {
          ...validVisibility.authoritativeOracle,
          reviewers: [
            hearthReviewer,
            {
              ...neuralReviewer,
              authority: 'hearth',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a complete production run manifest', () => {
    expect(RunManifestV1Schema.parse(validRunManifest)).toEqual(validRunManifest);
    expect(RecordReadyRunManifestV1Schema.parse(validRunManifest)).toEqual(
      validRunManifest,
    );
  });

  it('RED: run manifests preserve independent oracle products', () => {
    const result = RunManifestV1Schema.safeParse({
      ...validRunManifest,
      approvedSearchDisclosureSha256:
        validRunManifest.authoritativeOracleSha256,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['approvedSearchDisclosureSha256'],
          }),
        ]),
      );
    }
  });

  it('RED: performance-profile approval is independent evidence', () => {
    const result = RunManifestV1Schema.safeParse({
      ...validRunManifest,
      performanceProfileApprovalSha256:
        validRunManifest.performanceProfileSha256,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['performanceProfileApprovalSha256'],
          }),
        ]),
      );
    }
  });

  it('rejects non-production, disabled-rate-limit, 429, and wrong concurrency manifests', () => {
    for (const mutation of [
      { nodeEnv: 'test' },
      { rateLimitMax: 0 },
      { rateLimitMax: 99_999 },
      { observed429Count: 1 },
      { clientConcurrency: 19 },
    ]) {
      expect(
        RunManifestV1Schema.safeParse({
          ...validRunManifest,
          ...mutation,
        }).success,
      ).toBe(false);
    }
  });

  it('RED: record readiness requires a clean tree and complete pool attestation', () => {
    expect(
      RecordReadyRunManifestV1Schema.safeParse({
        ...validRunManifest,
        harnessWorktreeClean: false,
      }).success,
    ).toBe(false);
    expect(
      RunManifestV1Schema.safeParse({
        ...validRunManifest,
        attestedApplicationPoolConnectionCount: 19,
      }).success,
    ).toBe(false);
    expect(
      RunManifestV1Schema.safeParse({
        ...validRunManifest,
        authenticationDatabaseCredentialSha256:
          validRunManifest.applicationDatabaseCredentialSha256,
      }).success,
    ).toBe(false);
  });

  it('RED: immutable run evidence requires a full Git object ID', () => {
    for (const applicationCommitSha of [
      'abcdef1',
      'a'.repeat(63),
    ]) {
      expect(
        RunManifestV1Schema.safeParse({
          ...validRunManifest,
          applicationCommitSha,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects unknown fields on every artifact boundary', () => {
    expect(
      SourceIdentityV1Schema.safeParse({
        ...personSource,
        leakedField: 'forbidden',
      }).success,
    ).toBe(false);
    expect(
      RunManifestV1Schema.safeParse({
        ...validRunManifest,
        rawQuery: 'must-not-appear',
      }).success,
    ).toBe(false);
  });
});
