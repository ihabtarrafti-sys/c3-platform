/**
 * types.ts — the provider-neutral auth boundary contract. Every provider (dev
 * test IdP, Entra OIDC) translates its own token/claims into this shape. The
 * rest of the system only ever sees a translated principal.
 */
import type { C3Role } from '@c3web/domain';

export interface AuthenticatedPrincipal {
  /** Canonical bare email/UPN (already normalized at the boundary). */
  readonly identity: string;
  readonly displayName: string;
  readonly role: C3Role;
  readonly tenantId: string;
  readonly tenantSlug: string;
}

export interface AuthAdapter {
  readonly name: 'dev' | 'entra';
  /** Verify a bearer token and translate it to a principal. Throws on failure. */
  authenticate(bearerToken: string): Promise<AuthenticatedPrincipal>;
}

export class AuthError extends Error {
  override readonly name: string = 'AuthError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * The token is VALID but the identity has no active C3 membership. Truthful
 * "access not provisioned" — surfaced as 403 (authenticated, not authorized),
 * never as a generic authentication failure. Entra sign-in NEVER auto-creates
 * a membership.
 */
export class AccessNotProvisionedError extends AuthError {
  override readonly name = 'AccessNotProvisionedError';
  /** The immutable identity key of the denied (but token-valid) identity, when
   *  known — consumed by the access-denial audit write (A-8 Phase 1). */
  readonly identityKey?: { provider: 'entra' | 'dev'; issuerTenantId: string; subject: string };
  constructor(identityKey?: { provider: 'entra' | 'dev'; issuerTenantId: string; subject: string }) {
    super('Your identity is authenticated but not provisioned for C3 access. Contact the platform owner.');
    this.identityKey = identityKey;
  }
}
