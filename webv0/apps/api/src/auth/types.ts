/**
 * types.ts — the provider-neutral auth boundary contract. Every provider (dev
 * test IdP, Entra OIDC) translates its own token/claims into this shape. The
 * rest of the system only ever sees a translated principal.
 */
import type { C3Role } from '@c3web/domain';

export interface AuthenticatedPrincipal {
  /** Stable participant surrogate (uuid = app_user.id), resolved server-side. */
  readonly userId: string;
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
/**
 * The token is VALID and the identity has MORE THAN ONE tenant membership.
 *
 * ⚖️ WHY THIS REFUSES INSTEAD OF CHOOSING. `resolveMembership` used to end
 * `ORDER BY created_at ASC LIMIT 1`, so a multi-org person was resolved into
 * whichever C3 tenant was created first — silently, and with that tenant's ROLE,
 * so the silent choice also picked an authority level. Under one tenant the
 * clause was unreachable and the bug had no behaviour.
 *
 * Choosing properly needs a tenant selector, an "active tenant" on the session,
 * and an owner decision — a slice of its own. **What must not survive in the
 * meantime is the SILENT choice**, so this refuses by name.
 *
 * ⚠️ REOPENING CONDITION, stated rather than assumed: this refuses a legitimate
 * multi-org user the day one exists. That is the correct trade while zero exist
 * — a refusal is recoverable, a wrong tenant is not — and the day it starts
 * costing someone access is the day tenant selection gets designed.
 *
 * Distinct from AccessNotProvisionedError on purpose: "we do not know you" and
 * "we know you twice" call for different operator actions, so they must never
 * collapse into one error.
 */
export class AmbiguousMembershipError extends AuthError {
  override readonly name = 'AmbiguousMembershipError';
  readonly identityKey?: { provider: 'entra' | 'dev'; issuerTenantId: string; subject: string };
  readonly tenantCount: number;
  constructor(tenantCount: number, identityKey?: { provider: 'entra' | 'dev'; issuerTenantId: string; subject: string }) {
    super(
      'Your identity belongs to more than one organisation in C3, and C3 cannot yet ask which one you mean. ' +
        'Contact the platform owner — this is a refusal, not a denial.',
    );
    this.identityKey = identityKey;
    this.tenantCount = tenantCount;
  }
}

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
