/**
 * devIdp.ts — a signed, development-only test identity provider (HS256).
 *
 * It is enabled ONLY when AUTH_PROVIDER=dev, which env.ts forbids in
 * production. Tokens are real signed JWTs (not a bypass): the API verifies
 * them exactly like a production token, so the auth path under test is the
 * same code path used in production.
 */
import { SignJWT, jwtVerify } from 'jose';
import { canonicalizeIdentity, isC3Role, type C3Role } from '@c3web/domain';
import { type AuthAdapter, type AuthenticatedPrincipal, AuthError } from './types';

const ISSUER = 'c3web-dev-idp';
const enc = new TextEncoder();

export interface DevTokenClaims {
  identity: string;
  displayName: string;
  role: C3Role;
  tenantId: string;
  tenantSlug: string;
}

export async function signDevToken(secret: string, claims: DevTokenClaims, ttl = '1h'): Promise<string> {
  return new SignJWT({
    name: claims.displayName,
    role: claims.role,
    tenant_id: claims.tenantId,
    tenant_slug: claims.tenantSlug,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.identity)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(enc.encode(secret));
}

export function createDevAuthAdapter(secret: string): AuthAdapter {
  return {
    name: 'dev',
    async authenticate(token: string): Promise<AuthenticatedPrincipal> {
      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, enc.encode(secret), { issuer: ISSUER }));
      } catch (err) {
        throw new AuthError(`Invalid dev token: ${(err as Error).message}`);
      }
      const identity = canonicalizeIdentity(typeof payload.sub === 'string' ? payload.sub : null);
      if (!identity) throw new AuthError('Dev token subject is not a valid identity.');
      const role = payload.role;
      if (typeof role !== 'string' || !isC3Role(role)) throw new AuthError('Dev token role is invalid.');
      const tenantId = payload.tenant_id;
      const tenantSlug = payload.tenant_slug;
      if (typeof tenantId !== 'string' || typeof tenantSlug !== 'string') {
        throw new AuthError('Dev token is missing tenant context.');
      }
      return {
        identity,
        displayName: typeof payload.name === 'string' ? payload.name : identity,
        role,
        tenantId,
        tenantSlug,
      };
    },
  };
}
