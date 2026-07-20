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
import type { AdminDirectory } from './directory';

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

export function createDevAuthAdapter(secret: string, directory: AdminDirectory): AuthAdapter {
  return {
    name: 'dev',
    async authenticate(token: string): Promise<AuthenticatedPrincipal> {
      let payload: Record<string, unknown>;
      try {
        // Explicit algorithm allow-list: no alg-confusion downgrade.
        ({ payload } = await jwtVerify(token, enc.encode(secret), { issuer: ISSUER, algorithms: ['HS256'] }));
      } catch (err) {
        throw new AuthError(`Invalid dev token: ${(err as Error).message}`);
      }
      const rawSubject = typeof payload.sub === 'string' ? payload.sub : null;
      const identity = canonicalizeIdentity(rawSubject);
      if (!identity || !rawSubject) throw new AuthError('Dev token subject is not a valid identity.');
      const role = payload.role;
      if (typeof role !== 'string' || !isC3Role(role)) throw new AuthError('Dev token role is invalid.');
      const tenantId = payload.tenant_id;
      const tenantSlug = payload.tenant_slug;
      if (typeof tenantId !== 'string' || typeof tenantSlug !== 'string') {
        throw new AuthError('Dev token is missing tenant context.');
      }
      // The userId is NEVER taken from the (self-asserted) token — it is resolved
      // SERVER-side from the immutable dev identity binding written by /dev/login.
      // `rawSubject` is the exact string /dev/login stored as the binding subject,
      // so this matches by construction. FAIL CLOSED: an unprovisioned identity
      // throws — never fabricate or default a userId.
      const userId = await directory.resolveUserId({ provider: 'dev', issuerTenantId: 'dev', subject: rawSubject });
      if (!userId) throw new AuthError('Dev identity is authenticated but not provisioned (no app_user).');
      return {
        userId,
        identity,
        displayName: typeof payload.name === 'string' ? payload.name : identity,
        role,
        tenantId,
        tenantSlug,
      };
    },
  };
}
