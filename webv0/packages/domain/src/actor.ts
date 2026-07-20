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
  /**
   * Stable participant surrogate (uuid = app_user.id). The permanent identity
   * key: never recycled the way an email/UPN can be. Resolved server-side at the
   * auth boundary; carried into `app.user_id` for participant-aware RLS.
   */
  readonly userId: string;
  /** Canonical identity (bare email/UPN), already normalized at the boundary. */
  readonly identity: string;
  /** Display name for audit/history rendering. */
  readonly displayName: string;
  readonly role: C3Role;
  readonly tenantId: string;
}
