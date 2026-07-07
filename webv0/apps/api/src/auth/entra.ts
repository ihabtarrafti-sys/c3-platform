/**
 * entra.ts — the Entra ID (OIDC) adapter boundary (Phase 2B hardened).
 *
 * Token validation contract (ALL enforced):
 *   - RS256 signature against the tenant JWKS (explicit algorithm allow-list);
 *   - expected tenant-specific v2 issuer (never common/organizations/consumers);
 *   - expected audience;
 *   - expiry / not-before (jose enforces exp+nbf);
 *   - `tid` present AND equal to the configured tenant;
 *   - `oid` present (the immutable subject);
 *   - `scp` present and containing the configured C3 scope (delegated token —
 *     application-only tokens, which carry no scp / idtyp=app, are REJECTED).
 *
 * Identity model: the membership key is the immutable (tid, oid) pair resolved
 * against the C3 directory. Token role/group/wids claims are NEVER read —
 * a forged or added claim cannot grant C3 authority. The principal's identity
 * string comes from the DIRECTORY's stored profile email (admin-controlled),
 * so a mutated preferred_username/email claim changes nothing.
 *
 * Unknown or inactive identity => AccessNotProvisionedError (truthful 403).
 * Membership is NEVER auto-created from a valid token.
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { isC3Role } from '@c3web/domain';
import { type AuthAdapter, type AuthenticatedPrincipal, AuthError, AccessNotProvisionedError } from './types';
import type { AdminDirectory } from './directory';

export interface EntraConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  /** The Entra tenant GUID; tokens with any other tid are rejected. */
  readonly tenantId: string;
  /** Required delegated scope name (default C3.Access). */
  readonly scope: string;
}

/** Extract and validate the Entra-specific claims after signature verification. */
export function validateEntraClaims(
  payload: Record<string, unknown>,
  config: Pick<EntraConfig, 'tenantId' | 'scope'>,
): { tid: string; oid: string } {
  const tid = payload.tid;
  if (typeof tid !== 'string' || !tid) throw new AuthError('Token rejected: missing tid claim.');
  if (tid !== config.tenantId) throw new AuthError('Token rejected: issued for a different tenant.');

  const oid = payload.oid;
  if (typeof oid !== 'string' || !oid) throw new AuthError('Token rejected: missing oid claim.');

  // Application-only tokens carry idtyp=app and/or no scp. Delegated user
  // tokens are required for this phase.
  if (payload.idtyp === 'app') throw new AuthError('Token rejected: application-only tokens are not accepted.');
  const scp = payload.scp;
  if (typeof scp !== 'string' || !scp.split(' ').includes(config.scope)) {
    throw new AuthError(`Token rejected: required scope '${config.scope}' is not present.`);
  }

  return { tid, oid };
}

/**
 * Build the Entra adapter. `keyResolver` is injectable for tests (a local JWKS);
 * in production it defaults to the remote JWKS at the configured URI.
 */
export function createEntraAuthAdapter(
  config: EntraConfig,
  directory: AdminDirectory,
  keyResolver?: JWTVerifyGetKey | KeyLike | Uint8Array,
): AuthAdapter {
  const keys = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUri));
  return {
    name: 'entra',
    async authenticate(token: string): Promise<AuthenticatedPrincipal> {
      let payload: Record<string, unknown>;
      try {
        // Explicit algorithm allow-list (RS256 only): no alg-confusion downgrade.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ payload } = await jwtVerify(token, keys as any, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['RS256'],
        }));
      } catch (err) {
        throw new AuthError(`Invalid Entra token: ${(err as Error).message}`);
      }

      const { tid, oid } = validateEntraClaims(payload, config);

      // Membership by the IMMUTABLE key only. Token roles/groups/wids/email
      // claims are never consulted; nothing is auto-provisioned.
      const membership = await directory.resolveMembership({ provider: 'entra', issuerTenantId: tid, subject: oid });
      const identityKey = { provider: 'entra' as const, issuerTenantId: tid, subject: oid };
      if (!membership) throw new AccessNotProvisionedError(identityKey);
      if (!isC3Role(membership.role)) throw new AccessNotProvisionedError(identityKey);

      return {
        // Stable, admin-controlled profile email from the DIRECTORY (not the token).
        identity: membership.email,
        displayName: membership.displayName,
        role: membership.role,
        tenantId: membership.tenantId,
        tenantSlug: membership.tenantSlug,
      };
    },
  };
}
