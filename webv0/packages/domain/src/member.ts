/**
 * member.ts — tenant-membership administration domain contracts (Sprint 35,
 * A-8 Phase 2 design: docs/design/A8-P2-access-admin-audit.md).
 *
 * Access administration becomes four GOVERNED operations with the same
 * approval discipline as AddPerson. This module defines the value contracts;
 * guards (bind-once identity, no self-administration, last-owner protection)
 * are enforced by the application use-cases, and the erasure-grade invariants
 * stay in persistence.
 *
 * V1 presents ONE role per member (the persistence schema permits several;
 * the product surface and these contracts deal in a single role).
 */

import { z } from 'zod';
import { C3_ROLES, type C3Role } from './roles';

/**
 * Approval.targetPersonId sentinel for member operations — the column is
 * person-specific and NOT NULL; member operations never resolve to a person.
 */
export const MEMBER_OP_TARGET = 'N/A-MEMBER';

/** A tenant member as the product surfaces reason about them. */
export interface Member {
  /** Persistence user surrogate (uuid) — the stable in-product target reference. */
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: C3Role;
  readonly isActive: boolean;
  readonly createdAt: string;
}

/**
 * The immutable external-identity key (provider, issuerTenantId, subject) —
 * bound ONCE at provision (ADR: identity.ts). Email is never a membership key.
 */
export const externalIdentityRefSchema = z
  .object({
    provider: z.enum(['entra', 'dev']),
    issuerTenantId: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(200),
  })
  .strict();
export type ExternalIdentityRef = z.infer<typeof externalIdentityRefSchema>;

const emailField = z.string().trim().toLowerCase().min(3).max(320).email();
const targetUserIdField = z.string().uuid('targetUserId must be the member user id (uuid)');

/** ProvisionMember — create the user (if new), membership, role, and identity binding on execute. */
export const provisionMemberInputSchema = z
  .object({
    email: emailField,
    displayName: z.string().trim().min(1, 'Display name is required').max(200),
    role: z.enum(C3_ROLES),
    identity: externalIdentityRefSchema,
  })
  .strict();
export type ProvisionMemberInput = z.infer<typeof provisionMemberInputSchema>;

/** ChangeRole — replace the member's role on execute (email is a display snapshot, not the key). */
export const changeRoleInputSchema = z
  .object({
    targetUserId: targetUserIdField,
    email: emailField,
    toRole: z.enum(C3_ROLES),
  })
  .strict();
export type ChangeRoleInput = z.infer<typeof changeRoleInputSchema>;

/** DeactivateMember — the productized Phase-E1 primitive (A-7 revocation semantics on execute). */
export const deactivateMemberInputSchema = z
  .object({
    targetUserId: targetUserIdField,
    email: emailField,
  })
  .strict();
export type DeactivateMemberInput = z.infer<typeof deactivateMemberInputSchema>;

/** ReactivateMember — restores access; never available as an emergency/direct path. */
export const reactivateMemberInputSchema = z
  .object({
    targetUserId: targetUserIdField,
    email: emailField,
  })
  .strict();
export type ReactivateMemberInput = z.infer<typeof reactivateMemberInputSchema>;
