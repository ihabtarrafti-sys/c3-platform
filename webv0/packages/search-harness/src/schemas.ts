import { z } from 'zod';
import { HEARTH_SEARCH_MINIMUM_RATE_LIMIT_MAX } from './credentials.js';

export const HEARTH_SEARCH_SCHEMA_VERSION = 1 as const;

export const SEARCH_REGISTER_KINDS_V1 = [
  'person',
  'mission',
  'agreement',
  'entity',
  'credential',
  'journey',
  'kit',
  'apparel',
  'approval',
  'team',
  'invoice',
  'claim',
  'distribution',
  'document',
  'term',
  'line',
  'beneficiary',
] as const;

export const QUERY_CLASSES_V1 = [
  'exact_id',
  'exact_name',
  'prefix',
  'substring',
  'multi_token',
  'common_ambiguous',
  'typo_fuzzy',
  'zero_result',
] as const;

export const ACTOR_ROLES_V1 = [
  'owner',
  'operations',
  'legal',
  'finance',
  'hr',
  'management',
  'visitor',
] as const;

export const ENTITLEMENT_SNAPSHOTS_V1 = [
  'no-row',
  'active-current',
  'lapsed',
  'active-future',
  'active-expired',
] as const;

const schemaVersionV1 = z.literal(HEARTH_SEARCH_SCHEMA_VERSION);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, 'expected SHA-256 hex');
const commitShaSchema = z
  .string()
  .regex(
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u,
    'expected a full 40- or 64-hex Git object ID',
  );
const timestampSchema = z.string().datetime({ offset: true });
const nonBlank = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim() === value, {
      message: 'leading or trailing whitespace is forbidden',
    });
const identifierSchema = nonBlank(160);
const versionIdentifierSchema = nonBlank(128);
const sourceKey = (source: {
  readonly tenantSlot: string;
  readonly register: string;
  readonly recordId: string;
  readonly recordKind: string | null;
}) =>
  JSON.stringify([
    source.tenantSlot,
    source.register,
    source.recordKind,
    source.recordId,
  ]);

export const SearchRegisterKindV1Schema = z.enum(SEARCH_REGISTER_KINDS_V1);
export const ActorRoleV1Schema = z.enum(ACTOR_ROLES_V1);
export const EntitlementSnapshotV1Schema = z.enum(
  ENTITLEMENT_SNAPSHOTS_V1,
);
export const SearchRecordKindV1Schema = z
  .enum(['Attachment', 'RegisteredEvidence'])
  .nullable();

export const SourceIdentityV1Schema = z
  .object({
    schemaVersion: schemaVersionV1,
    tenantSlot: identifierSchema,
    register: SearchRegisterKindV1Schema,
    recordId: nonBlank(256),
    recordKind: SearchRecordKindV1Schema,
  })
  .strict()
  .superRefine((source, context) => {
    if (source.register === 'document' && source.recordKind === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordKind'],
        message: 'document source identities require a record-kind discriminator',
      });
    }
    if (source.register !== 'document' && source.recordKind !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordKind'],
        message: 'ordinary register source identities require recordKind: null',
      });
    }
  });

export const ReviewerSignatureV1Schema = z
  .object({
    authority: z.enum(['hearth', 'neural-security']),
    reviewerId: identifierSchema,
    signatureKeyId: identifierSchema,
    detachedSignatureSha256: sha256Schema,
  })
  .strict();

const reviewerSignaturePairSchema = z
  .tuple([ReviewerSignatureV1Schema, ReviewerSignatureV1Schema])
  .superRefine((reviewers, context) => {
    if (reviewers[0].reviewerId === reviewers[1].reviewerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'review requires two distinct reviewers',
      });
    }
    if (
      reviewers[0].signatureKeyId === reviewers[1].signatureKeyId ||
      reviewers[0].detachedSignatureSha256 ===
        reviewers[1].detachedSignatureSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'review requires independent signature keys and commitments',
      });
    }
    const authorities = new Set(reviewers.map(({ authority }) => authority));
    if (
      authorities.size !== 2 ||
      !authorities.has('hearth') ||
      !authorities.has('neural-security')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'review requires one Hearth and one Neural/security signature',
      });
    }
  });

const canaryCountsSchema = z.record(
  identifierSchema,
  z.number().int().nonnegative(),
);

export const CorpusManifestV1Schema = z
  .object({
    schemaVersion: schemaVersionV1,
    manifestKind: z.literal('hearth-search-corpus'),
    syntheticOnly: z.literal(true),
    harnessVersion: versionIdentifierSchema,
    generatorVersion: versionIdentifierSchema,
    datasetVersion: versionIdentifierSchema,
    seedRunId: identifierSchema,
    tenantSlots: z.array(identifierSchema).min(2),
    sourceIdentities: z.array(SourceIdentityV1Schema),
    canaryCounts: canaryCountsSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.tenantSlots).size !== manifest.tenantSlots.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tenantSlots'],
        message: 'tenant slots must be unique',
      });
    }

    const seenSources = new Set<string>();
    manifest.sourceIdentities.forEach((source, index) => {
      if (!manifest.tenantSlots.includes(source.tenantSlot)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceIdentities', index, 'tenantSlot'],
          message: 'source tenant slot is not declared by the manifest',
        });
      }
      const key = sourceKey(source);
      if (seenSources.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceIdentities', index],
          message: 'duplicate canonical source identity',
        });
      }
      seenSources.add(key);
    });
  });

export const SearchGoldCaseV1Schema = z
  .object({
    schemaVersion: schemaVersionV1,
    queryCaseId: identifierSchema,
    queryClass: z.enum(QUERY_CLASSES_V1),
    query: z.string().min(2).max(80),
    applicableProfiles: z.array(identifierSchema).min(1),
    authoritativeRelevant: z.record(z.array(SourceIdentityV1Schema)),
    forbiddenSources: z.record(z.array(SourceIdentityV1Schema)),
    forbiddenSentinelIds: z.array(identifierSchema),
    rationale: nonBlank(2_000),
    adjudicators: reviewerSignaturePairSchema,
  })
  .strict()
  .superRefine((qrel, context) => {
    if (new Set(qrel.applicableProfiles).size !== qrel.applicableProfiles.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicableProfiles'],
        message: 'applicable profiles must be unique',
      });
    }
    if (
      new Set(qrel.forbiddenSentinelIds).size !==
      qrel.forbiddenSentinelIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forbiddenSentinelIds'],
        message: 'forbidden sentinel IDs must be unique',
      });
    }

    for (const profile of qrel.applicableProfiles) {
      if (
        !Object.hasOwn(qrel.authoritativeRelevant, profile) ||
        !Object.hasOwn(qrel.forbiddenSources, profile)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['applicableProfiles'],
          message:
            'every applicable profile requires explicit authoritative and forbidden classifications',
        });
        continue;
      }
      const approved = new Set(
        qrel.authoritativeRelevant[profile]!.map(sourceKey),
      );
      qrel.authoritativeRelevant[profile]!.forEach((source, index) => {
        if (
          source.register === 'document' &&
          source.recordKind === 'Attachment'
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['authoritativeRelevant', profile, index],
            message:
              'Attachment is a hard L0 failure and cannot enter authoritative gold relevance',
          });
        }
      });
      const forbidden = qrel.forbiddenSources[profile]!;
      if (
        approved.size !== qrel.authoritativeRelevant[profile]!.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authoritativeRelevant', profile],
          message: 'authoritative source identities must be unique per profile',
        });
      }
      if (new Set(forbidden.map(sourceKey)).size !== forbidden.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['forbiddenSources', profile],
          message: 'forbidden source identities must be unique per profile',
        });
      }
      forbidden.forEach((source, index) => {
        if (approved.has(sourceKey(source))) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['forbiddenSources', profile, index],
            message:
              'a source cannot be both authoritative-relevant and forbidden',
          });
        }
      });
    }

    for (const [mapName, profiles] of [
      ['authoritativeRelevant', qrel.authoritativeRelevant],
      ['forbiddenSources', qrel.forbiddenSources],
    ] as const) {
      for (const profile of Object.keys(profiles)) {
        if (!qrel.applicableProfiles.includes(profile)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [mapName, profile],
            message: 'oracle maps cannot declare a non-applicable profile',
          });
        }
      }
    }
  });

export const SearchQrelSetV1Schema = z
  .object({
    schemaVersion: schemaVersionV1,
    qrelKind: z.literal('hearth-search-qrels'),
    syntheticOnly: z.literal(true),
    querySetVersion: versionIdentifierSchema,
    applicationPolicyDependencySha256: sha256Schema,
    migrationStateSha256: sha256Schema,
    cases: z.array(SearchGoldCaseV1Schema).min(1),
  })
  .strict()
  .superRefine((qrels, context) => {
    const seen = new Set<string>();
    qrels.cases.forEach((qrel, index) => {
      if (seen.has(qrel.queryCaseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cases', index, 'queryCaseId'],
          message: 'query case IDs must be unique',
        });
      }
      seen.add(qrel.queryCaseId);
    });
  });

export const ApprovedSearchProjectionV1Schema = z
  .object({
    kind: SearchRegisterKindV1Schema,
    id: nonBlank(256),
    title: z.string().max(1_000),
    subtitle: z.string().max(1_000).nullable(),
    parentId: z.string().max(512).nullable(),
  })
  .strict();

export const ApprovedDisclosureV1Schema = z
  .object({
    source: SourceIdentityV1Schema,
    projection: ApprovedSearchProjectionV1Schema,
  })
  .strict()
  .superRefine((disclosure, context) => {
    if (disclosure.source.register !== disclosure.projection.kind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projection', 'kind'],
        message: 'projection kind must agree with its source identity',
      });
    }
    if (disclosure.source.recordId !== disclosure.projection.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projection', 'id'],
        message: 'projection ID must agree with its source identity',
      });
    }
    if (
      disclosure.source.register === 'document' &&
      disclosure.source.recordKind !== 'RegisteredEvidence'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source', 'recordKind'],
        message:
          'Attachment documents are hard failures and cannot enter approved disclosure',
      });
    }
  });

export const VisibilityProfileV1Schema = z
  .object({
    profileId: identifierSchema,
    tenantSlot: identifierSchema,
    actorId: identifierSchema,
    role: ActorRoleV1Schema,
    entitlementSnapshot: EntitlementSnapshotV1Schema,
    entitlementSnapshotSha256: sha256Schema,
    approvedDisclosures: z.array(ApprovedDisclosureV1Schema),
    forbiddenSources: z.array(SourceIdentityV1Schema),
  })
  .strict()
  .superRefine((profile, context) => {
    const approved = new Set(
      profile.approvedDisclosures.map(({ source }) => sourceKey(source)),
    );
    if (approved.size !== profile.approvedDisclosures.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvedDisclosures'],
        message: 'approved source identities must be unique',
      });
    }
    const forbiddenKeys = new Set(profile.forbiddenSources.map(sourceKey));
    if (forbiddenKeys.size !== profile.forbiddenSources.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forbiddenSources'],
        message: 'forbidden source identities must be unique',
      });
    }
    profile.forbiddenSources.forEach((source, index) => {
      if (approved.has(sourceKey(source))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['forbiddenSources', index],
          message: 'approved and forbidden source sets must be disjoint',
        });
      }
      if (source.tenantSlot !== profile.tenantSlot) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['forbiddenSources', index, 'tenantSlot'],
          message: 'forbidden source must belong to the profile tenant',
        });
      }
    });
    profile.approvedDisclosures.forEach((disclosure, index) => {
      if (disclosure.source.tenantSlot !== profile.tenantSlot) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['approvedDisclosures', index, 'source', 'tenantSlot'],
          message: 'approved source must belong to the profile tenant',
        });
      }
    });
  });

const oracleReviewSchema = z
  .object({
    artifactSha256: sha256Schema,
    reviewers: reviewerSignaturePairSchema,
  })
  .strict();

export const VisibilityMatrixV1Schema = z
  .object({
    schemaVersion: schemaVersionV1,
    visibilityKind: z.literal('hearth-search-visibility'),
    syntheticOnly: z.literal(true),
    visibilityMatrixVersion: versionIdentifierSchema,
    applicationPolicyDependencySha256: sha256Schema,
    migrationStateSha256: sha256Schema,
    authoritativeOracle: oracleReviewSchema,
    approvedSearchDisclosure: oracleReviewSchema,
    profiles: z.array(VisibilityProfileV1Schema).min(1),
  })
  .strict()
  .superRefine((matrix, context) => {
    if (
      matrix.authoritativeOracle.artifactSha256 ===
      matrix.approvedSearchDisclosure.artifactSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvedSearchDisclosure', 'artifactSha256'],
        message:
          'authoritative and approved-disclosure products require independent artifacts',
      });
    }
    const profileIds = new Set<string>();
    matrix.profiles.forEach((profile, index) => {
      if (profileIds.has(profile.profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profiles', index, 'profileId'],
          message: 'visibility profile IDs must be unique',
        });
      }
      profileIds.add(profile.profileId);
    });
  });

const databaseSettingValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string(),
]);

export const RunManifestV1Schema = z
  .object({
    schemaVersion: schemaVersionV1,
    manifestKind: z.literal('hearth-search-run'),
    syntheticOnly: z.literal(true),
    runId: identifierSchema,
    executionProfile: z.enum(['merge_conformance', 'full_acceptance']),
    harnessVersion: versionIdentifierSchema,
    generatorVersion: versionIdentifierSchema,
    datasetVersion: versionIdentifierSchema,
    datasetSha256: sha256Schema,
    querySetVersion: versionIdentifierSchema,
    querySetSha256: sha256Schema,
    visibilityMatrixVersion: versionIdentifierSchema,
    visibilityMatrixSha256: sha256Schema,
    authoritativeOracleSha256: sha256Schema,
    approvedSearchDisclosureSha256: sha256Schema,
    entitlementSnapshotSha256: sha256Schema,
    retrievalProfileVersion: versionIdentifierSchema,
    retrievalProfileSha256: sha256Schema,
    authorizationDependencySha256: sha256Schema,
    performanceProfileVersion: versionIdentifierSchema,
    performanceProfileSha256: sha256Schema,
    performanceProfileApprovalSha256: sha256Schema,
    applicationCommitSha: commitShaSchema,
    harnessCommitSha: commitShaSchema,
    harnessWorktreeClean: z.boolean(),
    artifactAttestationSha256: sha256Schema,
    migrationHead: identifierSchema,
    migrationChecksumStateSha256: sha256Schema,
    nodeVersion: versionIdentifierSchema,
    postgresVersion: versionIdentifierSchema,
    extensionVersions: z.record(versionIdentifierSchema),
    databaseSettings: z.record(databaseSettingValueSchema),
    apiPoolSize: z.number().int().positive(),
    applicationDatabasePoolSize: z.number().int().positive(),
    authenticationDatabasePoolSize: z.number().int().positive(),
    attestedApplicationPoolConnectionCount: z.number().int().positive(),
    attestedAuthenticationPoolConnectionCount: z.number().int().positive(),
    databaseBoundaryAttestationStatus: z.literal('passed'),
    databaseBoundaryAttestationSha256: sha256Schema,
    hardwareProfile: identifierSchema,
    operatingSystem: identifierSchema,
    clientConcurrency: z.number().int().positive(),
    schedulerSeed: identifierSchema,
    warmState: z.enum(['cold', 'warm']),
    nodeEnv: z.literal('production'),
    rateLimitMax: z
      .number()
      .int()
      .min(HEARTH_SEARCH_MINIMUM_RATE_LIMIT_MAX),
    observed429Count: z.literal(0),
    applicationDatabaseCredentialSha256: sha256Schema,
    authenticationDatabaseCredentialSha256: sha256Schema,
    databaseTargetSha256: sha256Schema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.authoritativeOracleSha256 ===
      manifest.approvedSearchDisclosureSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvedSearchDisclosureSha256'],
        message:
          'authoritative and approved-disclosure products require independent artifacts',
      });
    }
    if (
      manifest.performanceProfileSha256 ===
      manifest.performanceProfileApprovalSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['performanceProfileApprovalSha256'],
        message:
          'performance profile and its approval require independent artifacts',
      });
    }
    const startedAt = Date.parse(manifest.startedAt);
    const endedAt = Date.parse(manifest.endedAt);
    if (endedAt < startedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAt'],
        message: 'run end timestamp cannot precede its start timestamp',
      });
    }
    if (
      manifest.executionProfile === 'full_acceptance' &&
      manifest.clientConcurrency !== 20
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clientConcurrency'],
        message: 'full acceptance requires exactly 20 closed-loop clients',
      });
    }
    if (
      manifest.attestedApplicationPoolConnectionCount !==
        manifest.applicationDatabasePoolSize ||
      manifest.attestedAuthenticationPoolConnectionCount !==
        manifest.authenticationDatabasePoolSize
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['databaseBoundaryAttestationStatus'],
        message:
          'configured and attested application/authentication pool counts must agree',
      });
    }
    if (
      manifest.applicationDatabaseCredentialSha256 ===
      manifest.authenticationDatabaseCredentialSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authenticationDatabaseCredentialSha256'],
        message:
          'application and authentication pool credentials must be distinct',
      });
    }
  });

export const RecordReadyRunManifestV1Schema =
  RunManifestV1Schema.superRefine((manifest, context) => {
    if (!manifest.harnessWorktreeClean) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['harnessWorktreeClean'],
        message: 'record-ready runs require a clean harness worktree',
      });
    }
  });

export type SearchRegisterKindV1 = z.infer<typeof SearchRegisterKindV1Schema>;
export type SearchRecordKindV1 = z.infer<typeof SearchRecordKindV1Schema>;
export type SourceIdentityV1 = z.infer<typeof SourceIdentityV1Schema>;
export type CorpusManifestV1 = z.infer<typeof CorpusManifestV1Schema>;
export type SearchGoldCaseV1 = z.infer<typeof SearchGoldCaseV1Schema>;
export type SearchQrelSetV1 = z.infer<typeof SearchQrelSetV1Schema>;
export type ApprovedSearchProjectionV1 = z.infer<
  typeof ApprovedSearchProjectionV1Schema
>;
export type ApprovedDisclosureV1 = z.infer<typeof ApprovedDisclosureV1Schema>;
export type VisibilityProfileV1 = z.infer<typeof VisibilityProfileV1Schema>;
export type VisibilityMatrixV1 = z.infer<typeof VisibilityMatrixV1Schema>;
export type ReviewerSignatureV1 = z.infer<typeof ReviewerSignatureV1Schema>;
export type RunManifestV1 = z.infer<typeof RunManifestV1Schema>;
