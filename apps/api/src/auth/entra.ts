/**
 * entra.ts — the Entra ID (OIDC) adapter boundary.
 *
 * Token validation contract: verify the RS256 signature against the tenant
 * JWKS, and enforce issuer + audience. Provider-specific claims are then
 * TRANSLATED to the neutral principal: identity from preferred_username / upn /
 * email; tenant + role resolved from the directory membership (Entra tokens
 * carry AAD identity, not C3 tenant/role). No real Entra credentials are needed
 * to unit-test translateEntraIdentity / the JWKS validation (a local keypair +
 * JWKS is injected in tests).
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { canonicalizeIdentity } from '@c3web/domain';
import { type AuthAdapter, type AuthenticatedPrincipal, AuthError } from './types';
import type { AdminDirectory } from './directory';

export interface EntraConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
}

/** Translate verified Entra claims to a canonical identity + display name. */
export function translateEntraIdentity(payload: Record<string, unknown>): { identity: string; displayName: string } {
  const candidate =
    (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
    (typeof payload.upn === 'string' && payload.upn) ||
    (typeof payload.email === 'string' && payload.email) ||
    null;
  const identity = canonicalizeIdentity(candidate);
  if (!identity) throw new AuthError('Entra token has no usable identity claim (preferred_username/upn/email).');
  const displayName = typeof payload.name === 'string' ? payload.name : identity;
  return { identity, displayName };
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
      const { identity, displayName } = translateEntraIdentity(payload);
      const membership = await directory.resolveMembership(identity);
      if (!membership) throw new AuthError(`No C3 tenant membership for ${identity}.`);
      return {
        identity,
        displayName,
        role: membership.role as AuthenticatedPrincipal['role'],
        tenantId: membership.tenantId,
        tenantSlug: membership.tenantSlug,
      };
    },
  };
}
