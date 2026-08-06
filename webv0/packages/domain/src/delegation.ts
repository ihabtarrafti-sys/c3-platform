/**
 * delegation.ts — Tier 0.5 approver delegation: the owner grants
 * review+execute standing AS ONE UNIT ("act as approver") to a named active
 * member for a bounded window. Direct-but-audited owner act — routing the
 * grant through the pipeline would wedge single-owner tenants (no second
 * approver exists to approve the delegation that creates one).
 *
 * Laws:
 *  - Active = not revoked AND today within [startsOn, endsOn] (inclusive).
 *    Expiry is automatic; nothing to clean up.
 *  - One UNREVOKED delegation per grantee (DB partial-unique; friendly 409).
 *  - Separation of duties is NOT delegable: a delegate never decides or
 *    executes their OWN submission — checkSelfReview runs on every path.
 *  - Revoke is owner-only, reason mandatory, immediate. Rows are history and
 *    are never deleted.
 */
import { z } from 'zod';

export interface Delegation {
  readonly tenantId: string;
  readonly delegationId: string; // DLG-XXXX
  readonly granteeIdentity: string;
  readonly grantedBy: string;
  readonly startsOn: string; // YYYY-MM-DD, inclusive
  readonly endsOn: string; // YYYY-MM-DD, inclusive
  readonly reason: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly revokeReason: string | null;
  readonly version: number;
  readonly createdAt: string;
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const createDelegationSchema = z
  .object({
    granteeIdentity: z.string().trim().toLowerCase().email('Grantee must be a member email.'),
    startsOn: dateOnly,
    endsOn: dateOnly,
    reason: z.string().trim().min(1, 'A reason is mandatory — it is the audit narrative.').max(500),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn must be on or after startsOn.', path: ['endsOn'] });
export type CreateDelegationInput = z.infer<typeof createDelegationSchema>;

export const revokeDelegationSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    reason: z.string().trim().min(1, 'A revocation reason is mandatory.').max(500),
  })
  .strict();
export type RevokeDelegationInput = z.infer<typeof revokeDelegationSchema>;

export type DelegationState = 'Scheduled' | 'Active' | 'Expired' | 'Revoked';

/** Pure state derivation — same doctrine as credential status: derived at read time, never stored. */
export function delegationState(d: Pick<Delegation, 'startsOn' | 'endsOn' | 'revokedAt'>, todayIso: string): DelegationState {
  if (d.revokedAt !== null) return 'Revoked';
  if (todayIso < d.startsOn) return 'Scheduled';
  if (todayIso > d.endsOn) return 'Expired';
  return 'Active';
}

export const isDelegationActive = (d: Pick<Delegation, 'startsOn' | 'endsOn' | 'revokedAt'>, todayIso: string): boolean =>
  delegationState(d, todayIso) === 'Active';

/**
 * ⛔ THE PREDICATE THAT BLOCKS A NEW GRANT — one question, three consumers.
 *
 * The DB partial-unique (`delegation_one_unrevoked_per_grantee`) and the grant
 * guard (`findUnrevokedDelegationId`) both key on UNREVOKED. The Settings
 * surface used to key its Revoke control on a hand-list (`Active || Scheduled`)
 * — a DIFFERENT predicate — so an `Expired` delegation blocked every new grant
 * while the only control that could clear it was not rendered: a dead end with
 * no path out through the product, found by the owner's own hands on staging.
 *
 * ⚖️ `delegationState` puts `Revoked` first, so `state !== 'Revoked'` IS
 * "revokedAt is null" — the exact question the index and the guard ask. Any
 * surface deciding whether to offer Revoke derives from THIS, never from a list
 * of state names: a list recreates the bug the day a fifth state is added.
 * (Product-layer twin of CR-036/CR-037: a decision made by one predicate,
 * consumed by another.)
 */
export const isDelegationUnrevoked = (state: DelegationState): boolean => state !== 'Revoked';
