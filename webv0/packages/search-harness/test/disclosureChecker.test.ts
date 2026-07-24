import { describe, expect, it } from 'vitest';

import {
  DisclosureCheckError,
  assertApprovedSearchDisclosure,
  type DisclosureCheckFailureCode,
  type DisclosureCheckInput,
} from '../src/disclosureChecker.js';
import { canonicalSha256, sha256Hex } from '../src/canonical.js';

const source = {
  schemaVersion: 1,
  tenantSlot: 'tenant-a',
  register: 'person',
  recordId: 'PER-0001',
  recordKind: null,
} as const;
const projection = {
  kind: 'person',
  id: 'PER-0001',
  title: 'Synthetic Person 0001',
  subtitle: 'IGN-0001',
  parentId: null,
} as const;
const forbiddenSource = {
  schemaVersion: 1,
  tenantSlot: 'tenant-a',
  register: 'document',
  recordId: 'DOC-FORBIDDEN',
  recordKind: 'Attachment',
} as const;

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

function validVisibilityMatrix() {
  return {
    schemaVersion: 1,
    visibilityKind: 'hearth-search-visibility',
    syntheticOnly: true,
    visibilityMatrixVersion: 'visibility-v1',
    applicationPolicyDependencySha256: 'e'.repeat(64),
    migrationStateSha256: 'f'.repeat(64),
    authoritativeOracle: {
      artifactSha256: '1'.repeat(64),
      reviewers: [hearthReviewer, neuralReviewer],
    },
    approvedSearchDisclosure: {
      artifactSha256: '2'.repeat(64),
      reviewers: [hearthReviewer, neuralReviewer],
    },
    profiles: [
      {
        profileId: 'tenant-a-owner-active',
        tenantSlot: 'tenant-a',
        actorId: 'actor-owner-a',
        role: 'owner',
        entitlementSnapshot: 'active-current',
        entitlementSnapshotSha256: 'b'.repeat(64),
        approvedDisclosures: [{ source, projection }],
        forbiddenSources: [forbiddenSource],
      },
    ],
  } as const;
}

const validInput = (): DisclosureCheckInput => {
  const visibilityMatrix = validVisibilityMatrix();
  return {
    context: {
      visibilityMatrixVersion: visibilityMatrix.visibilityMatrixVersion,
      visibilityMatrixSha256: canonicalSha256(visibilityMatrix),
      expectedProfileId: 'tenant-a-owner-active',
      expectedTenantSlot: 'tenant-a',
      actorId: 'actor-owner-a',
      expectedRole: 'owner',
      expectedEntitlementSnapshot: 'active-current',
      entitlementSnapshotSha256: 'b'.repeat(64),
    },
    visibilityMatrix,
    observedDisclosures: [{ source, projection }],
  };
};

function expectDisclosureCode(
  action: () => unknown,
  code: DisclosureCheckFailureCode,
): DisclosureCheckError {
  try {
    action();
    throw new Error('expected disclosure checker to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DisclosureCheckError);
    expect((error as DisclosureCheckError).code).toBe(code);
    return error as DisclosureCheckError;
  }
}

describe('approved-search disclosure leak checker', () => {
  it('attests exact context binding and field equality for the observed top-N subset', () => {
    const input = validInput();
    expect(assertApprovedSearchDisclosure(input)).toEqual({
      artifactAuthenticity: 'structural-commitment-only',
      visibilityMatrixVersion: 'visibility-v1',
      visibilityMatrixSha256: input.context.visibilityMatrixSha256,
      profileId: 'tenant-a-owner-active',
      tenantSlot: 'tenant-a',
      actorId: 'actor-owner-a',
      entitlementSnapshotSha256: 'b'.repeat(64),
      approvedSourceCount: 1,
      observedSourceCount: 1,
    });
  });

  it('RED: catches a planted same-ID cross-tenant result', () => {
    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          observedDisclosures: [
            {
              source: { ...source, tenantSlot: 'tenant-b' },
              projection,
            },
          ],
        }),
      'DISCLOSURE_CROSS_TENANT_SOURCE',
    );
  });

  it('RED: catches a planted explicitly forbidden source', () => {
    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          observedDisclosures: [
            {
              source: forbiddenSource,
              projection: {
                kind: 'document',
                id: forbiddenSource.recordId,
                title: 'Forbidden attachment',
                subtitle: null,
                parentId: null,
              },
            },
          ],
        }),
      'DISCLOSURE_FORBIDDEN_SOURCE',
    );
  });

  it('RED: catches an authorized ID carrying an unapproved field value', () => {
    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          observedDisclosures: [
            {
              source,
              projection: {
                ...projection,
                title: 'Planted private field value',
              },
            },
          ],
        }),
      'DISCLOSURE_FIELD_MISMATCH',
    );
  });

  it('RED: catches an unknown serialized response field before projection', () => {
    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          observedDisclosures: [
            {
              source,
              projection: {
                ...projection,
                privateNote: 'planted leak',
              },
            },
          ],
        }),
      'DISCLOSURE_SHAPE_INVALID',
    );
  });

  it.each([
    [
      'unknown source',
      (input: DisclosureCheckInput): DisclosureCheckInput => ({
        ...input,
        observedDisclosures: [
          {
            source: { ...source, recordId: 'PER-UNKNOWN' },
            projection: { ...projection, id: 'PER-UNKNOWN' },
          },
        ],
      }),
      'DISCLOSURE_UNKNOWN_SOURCE',
    ],
    [
      'duplicate observed source',
      (input: DisclosureCheckInput): DisclosureCheckInput => ({
        ...input,
        observedDisclosures: [
          input.observedDisclosures[0]!,
          input.observedDisclosures[0]!,
        ],
      }),
      'DISCLOSURE_DUPLICATE_SOURCE',
    ],
  ] as const)('RED: catches a planted %s', (_label, mutate, code) => {
    expectDisclosureCode(
      () => assertApprovedSearchDisclosure(mutate(validInput())),
      code,
    );
  });

  it('allows a top-N response to omit other approved sources', () => {
    expect(
      assertApprovedSearchDisclosure({
        ...validInput(),
        observedDisclosures: [],
      }).observedSourceCount,
    ).toBe(0);
  });

  it('RED: refuses a valid disclosure profile bound to the wrong actor profile', () => {
    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          context: {
            ...validInput().context,
            expectedProfileId: 'tenant-a-visitor-active',
          },
        }),
      'DISCLOSURE_CONTEXT_MISMATCH',
    );
  });

  it('RED: refuses a forged entitlement-snapshot context', () => {
    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          context: {
            ...validInput().context,
            entitlementSnapshotSha256: 'not-a-hash',
          },
        }),
      'DISCLOSURE_EXPECTATION_INVALID',
    );
  });

  it('RED: refuses a forged standalone profile not committed by the signed matrix hash', () => {
    const input = validInput();
    const matrix = validVisibilityMatrix();
    const forgedSource = {
      ...source,
      recordId: 'FORGED-SOURCE',
    };
    const forgedProjection = {
      ...projection,
      id: forgedSource.recordId,
    };

    expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...input,
          visibilityMatrix: {
            ...matrix,
            profiles: [
              {
                ...matrix.profiles[0],
                approvedDisclosures: [
                  ...matrix.profiles[0].approvedDisclosures,
                  {
                    source: forgedSource,
                    projection: forgedProjection,
                  },
                ],
              },
            ],
          },
          observedDisclosures: [
            {
              source: forgedSource,
              projection: forgedProjection,
            },
          ],
        }),
      'DISCLOSURE_CONTEXT_MISMATCH',
    );
  });

  it('RED: never reflects a forbidden source identity in error artifacts', () => {
    const forbiddenId = 'HEARTH-FORBIDDEN-ID-9f2c';
    const error = expectDisclosureCode(
      () =>
        assertApprovedSearchDisclosure({
          ...validInput(),
          observedDisclosures: [
            {
              source: {
                ...source,
                recordId: forbiddenId,
              },
              projection: {
                ...projection,
                id: forbiddenId,
              },
            },
          ],
        }),
      'DISCLOSURE_UNKNOWN_SOURCE',
    );

    expect(error.details).toMatchObject({
      sourceIdSha256: sha256Hex(forbiddenId),
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(forbiddenId);
    expect(serialized).not.toContain(encodeURIComponent(forbiddenId));
  });
});
