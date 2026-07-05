/**
 * actor.ts — the authenticated principal a use-case acts on behalf of.
 *
 * Produced at the auth boundary (apps/api) by translating a provider token
 * (dev test IdP or Entra OIDC) into a provider-neutral principal. Every
 * governed use-case takes an Actor; the tenant on the Actor is authoritative
 * for tenant context and MUST match the record tenant.
 */

import type { C3Role } from './roles';

export interface Actor {
  /** Canonical identity (bare email/UPN), already normalized at the boundary. */
  readonly identity: string;
  /** Display name for audit/history rendering. */
  readonly displayName: string;
  readonly role: C3Role;
  readonly tenantId: string;
}
