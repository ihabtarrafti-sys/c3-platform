/**
 * rolePolicy.ts — Sprint 33 Correction Set E.
 *
 * Shared, single-source role predicates for boundary truthfulness. These are
 * deliberately explicit role sets (not derived from canViewFinancials), because
 * the policies diverge:
 *   - Contract access mirrors the C3Contracts ACL (Phase 3D five principals).
 *   - Per-diem visibility is its own locked policy (Operations needs per-diem
 *     for mission ops but has canViewFinancials=false).
 *   - Work-item actions are governed writes (owner/operations only).
 */
import type { C3Role } from '@c3/types';

/**
 * Roles whose SharePoint principal is granted read on C3Contracts
 * (Phase 3D: Platform Owners FC; Operations/Legal/Finance/Management Read).
 * hr and visitor are security-trimmed (404) — the UI must render an explicit
 * unavailable-for-role state, never a silent empty register.
 */
const CONTRACT_ACCESS_ROLES: ReadonlySet<C3Role> = new Set<C3Role>([
  'owner',
  'operations',
  'legal',
  'finance',
  'management',
]);

/**
 * Per-diem visibility policy (locked, S33 Set E):
 *   allowed → owner, operations, finance, management
 *   denied  → visitor, legal, hr
 */
const PER_DIEM_ROLES: ReadonlySet<C3Role> = new Set<C3Role>([
  'owner',
  'operations',
  'finance',
  'management',
]);

/** Roles that can perform governed write actions from Command Center work
 *  items (journey initiation, credential, participant, etc.). Read-only roles
 *  must not see an active-looking write CTA. */
const WORK_ITEM_ACTION_ROLES: ReadonlySet<C3Role> = new Set<C3Role>([
  'owner',
  'operations',
]);

export const canAccessContracts = (role: C3Role): boolean => CONTRACT_ACCESS_ROLES.has(role);

export const canViewPerDiem = (role: C3Role): boolean => PER_DIEM_ROLES.has(role);

export const canActionWorkItems = (role: C3Role): boolean => WORK_ITEM_ACTION_ROLES.has(role);
