import {
  canonicalJson,
  canonicalSha256,
  sha256Hex,
} from './canonical.js';
import { HearthHarnessError } from './errors.js';
import {
  ApprovedDisclosureV1Schema,
  ApprovedSearchProjectionV1Schema,
  SourceIdentityV1Schema,
  VisibilityMatrixV1Schema,
  type ApprovedDisclosureV1,
  type SourceIdentityV1,
  type VisibilityProfileV1,
} from './schemas.js';

export type DisclosureCheckFailureCode =
  | 'DISCLOSURE_CONTEXT_MISMATCH'
  | 'DISCLOSURE_CROSS_TENANT_SOURCE'
  | 'DISCLOSURE_DUPLICATE_SOURCE'
  | 'DISCLOSURE_EXPECTATION_INVALID'
  | 'DISCLOSURE_FIELD_MISMATCH'
  | 'DISCLOSURE_FORBIDDEN_SOURCE'
  | 'DISCLOSURE_SHAPE_INVALID'
  | 'DISCLOSURE_UNKNOWN_SOURCE';

export class DisclosureCheckError extends HearthHarnessError<DisclosureCheckFailureCode> {
  constructor(
    code: DisclosureCheckFailureCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, details);
  }
}

export interface ObservedSearchDisclosure {
  /**
   * H2/H3 resolves this identity from the signed corpus manifest; it is not
   * trusted from the API response.
   */
  readonly source: unknown;
  /** Complete parsed result item, before any field is discarded. */
  readonly projection: unknown;
}

export interface DisclosureContextBinding {
  readonly visibilityMatrixVersion: string;
  readonly visibilityMatrixSha256: string;
  readonly expectedProfileId: string;
  readonly expectedTenantSlot: string;
  readonly actorId: string;
  readonly expectedRole: VisibilityProfileV1['role'];
  readonly expectedEntitlementSnapshot: VisibilityProfileV1['entitlementSnapshot'];
  readonly entitlementSnapshotSha256: string;
}

export interface DisclosureCheckInput {
  readonly context: DisclosureContextBinding;
  /**
   * Complete matrix artifact, never a loose profile. H0 binds its structure
   * and externally supplied hash; signature authenticity remains an H1 trust
   * store responsibility.
   */
  readonly visibilityMatrix: unknown;
  readonly observedDisclosures: readonly ObservedSearchDisclosure[];
}

export interface DisclosureCheckAttestation {
  readonly artifactAuthenticity: 'structural-commitment-only';
  readonly visibilityMatrixVersion: string;
  readonly visibilityMatrixSha256: string;
  readonly profileId: string;
  readonly tenantSlot: string;
  readonly actorId: string;
  readonly entitlementSnapshotSha256: string;
  readonly approvedSourceCount: number;
  readonly observedSourceCount: number;
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;

function sourceKey(source: SourceIdentityV1): string {
  return canonicalJson(source);
}

/**
 * H0 pure, exact leak-checking core used before scoring.
 *
 * It proves every supplied resolved source and projection is a member of the
 * exact independently reviewed profile. It intentionally does not claim to
 * parse a raw API payload or derive provenance. H3 must strict-parse the entire
 * serialized response, resolve source identity from authenticated context, and
 * only then call this core. No authorization helper, search selector, or
 * persistence registry is called here.
 */
export function assertApprovedSearchDisclosure(
  input: DisclosureCheckInput,
): DisclosureCheckAttestation {
  const { context } = input;
  if (
    context.visibilityMatrixVersion.length === 0 ||
    context.visibilityMatrixVersion !== context.visibilityMatrixVersion.trim() ||
    !SHA256_HEX.test(context.visibilityMatrixSha256) ||
    context.expectedProfileId.length === 0 ||
    context.expectedProfileId !== context.expectedProfileId.trim() ||
    context.expectedTenantSlot.length === 0 ||
    context.expectedTenantSlot !== context.expectedTenantSlot.trim() ||
    context.actorId.length === 0 ||
    context.actorId !== context.actorId.trim() ||
    !SHA256_HEX.test(context.entitlementSnapshotSha256)
  ) {
    throw new DisclosureCheckError(
      'DISCLOSURE_EXPECTATION_INVALID',
      'Disclosure context binding is incomplete or malformed',
    );
  }

  const parsedMatrix = VisibilityMatrixV1Schema.safeParse(
    input.visibilityMatrix,
  );
  if (!parsedMatrix.success) {
    throw new DisclosureCheckError(
      'DISCLOSURE_EXPECTATION_INVALID',
      'Approved visibility matrix is structurally invalid',
    );
  }
  if (
    parsedMatrix.data.visibilityMatrixVersion !==
      context.visibilityMatrixVersion ||
    canonicalSha256(parsedMatrix.data) !== context.visibilityMatrixSha256
  ) {
    throw new DisclosureCheckError(
      'DISCLOSURE_CONTEXT_MISMATCH',
      'Approved visibility matrix does not match its independently committed version and hash',
    );
  }
  const profile = parsedMatrix.data.profiles.find(
    (candidate) => candidate.profileId === context.expectedProfileId,
  );
  if (
    profile === undefined ||
    profile.tenantSlot !== context.expectedTenantSlot ||
    profile.actorId !== context.actorId ||
    profile.role !== context.expectedRole ||
    profile.entitlementSnapshot !==
      context.expectedEntitlementSnapshot ||
    profile.entitlementSnapshotSha256 !==
      context.entitlementSnapshotSha256
  ) {
    throw new DisclosureCheckError(
      'DISCLOSURE_CONTEXT_MISMATCH',
      'Approved disclosure profile does not match the measured actor context',
    );
  }

  const approved = new Map<string, ApprovedDisclosureV1>();
  for (const candidate of profile.approvedDisclosures) {
    const parsed = ApprovedDisclosureV1Schema.safeParse(candidate);
    if (
      !parsed.success ||
      parsed.data.source.tenantSlot !== context.expectedTenantSlot
    ) {
      throw new DisclosureCheckError(
        'DISCLOSURE_EXPECTATION_INVALID',
        'Approved disclosure expectation is invalid or belongs to another tenant',
      );
    }
    const key = sourceKey(parsed.data.source);
    if (approved.has(key)) {
      throw new DisclosureCheckError(
        'DISCLOSURE_EXPECTATION_INVALID',
        'Approved disclosure expectation contains a duplicate source',
      );
    }
    approved.set(key, parsed.data);
  }

  const forbidden = new Set<string>();
  for (const candidate of profile.forbiddenSources) {
    const parsed = SourceIdentityV1Schema.safeParse(candidate);
    if (!parsed.success) {
      throw new DisclosureCheckError(
        'DISCLOSURE_EXPECTATION_INVALID',
        'Forbidden-source expectation is invalid',
      );
    }
    const key = sourceKey(parsed.data);
    if (forbidden.has(key) || approved.has(key)) {
      throw new DisclosureCheckError(
        'DISCLOSURE_EXPECTATION_INVALID',
        'Expected approved and forbidden source classifications must be unique and disjoint',
      );
    }
    forbidden.add(key);
  }

  const observed = new Set<string>();
  for (const candidate of input.observedDisclosures) {
    const parsedSource = SourceIdentityV1Schema.safeParse(candidate.source);
    if (!parsedSource.success) {
      throw new DisclosureCheckError(
        'DISCLOSURE_SHAPE_INVALID',
        'Observed source identity has an unknown or invalid field',
      );
    }
    const source = parsedSource.data;
    if (source.tenantSlot !== context.expectedTenantSlot) {
      throw new DisclosureCheckError(
        'DISCLOSURE_CROSS_TENANT_SOURCE',
        'Observed result resolves to a different tenant',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }
    const key = sourceKey(source);
    if (observed.has(key)) {
      throw new DisclosureCheckError(
        'DISCLOSURE_DUPLICATE_SOURCE',
        'Observed result repeats a canonical source identity',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }
    observed.add(key);
    if (forbidden.has(key)) {
      throw new DisclosureCheckError(
        'DISCLOSURE_FORBIDDEN_SOURCE',
        'Observed result is explicitly forbidden for this profile',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }
    const expected = approved.get(key);
    if (!expected) {
      throw new DisclosureCheckError(
        'DISCLOSURE_UNKNOWN_SOURCE',
        'Observed result has no approved-disclosure classification',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }

    const parsedProjection = ApprovedSearchProjectionV1Schema.safeParse(
      candidate.projection,
    );
    if (!parsedProjection.success) {
      throw new DisclosureCheckError(
        'DISCLOSURE_SHAPE_INVALID',
        'Observed result contains an unknown or invalid response field',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }
    const disclosure = ApprovedDisclosureV1Schema.safeParse({
      source,
      projection: parsedProjection.data,
    });
    if (!disclosure.success) {
      throw new DisclosureCheckError(
        'DISCLOSURE_SHAPE_INVALID',
        'Observed result does not agree with its canonical source identity',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }
    if (
      canonicalJson(parsedProjection.data) !==
      canonicalJson(expected.projection)
    ) {
      throw new DisclosureCheckError(
        'DISCLOSURE_FIELD_MISMATCH',
        'Observed result fields differ from the approved disclosure',
        { sourceIdSha256: sha256Hex(source.recordId) },
      );
    }
  }

  return Object.freeze({
    artifactAuthenticity: 'structural-commitment-only',
    visibilityMatrixVersion: context.visibilityMatrixVersion,
    visibilityMatrixSha256: context.visibilityMatrixSha256,
    profileId: context.expectedProfileId,
    tenantSlot: context.expectedTenantSlot,
    actorId: context.actorId,
    entitlementSnapshotSha256: context.entitlementSnapshotSha256,
    approvedSourceCount: approved.size,
    observedSourceCount: observed.size,
  });
}
