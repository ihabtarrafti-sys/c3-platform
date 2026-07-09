/**
 * agreement.ts — the Agreement domain entity and its operation contracts
 * (Sprint 41; design: docs/design/S41-agreements-domain.md).
 *
 * OWNER DIRECTION (2026-07-08): the domain is AGREEMENTS, not just contracts —
 * player contracts, NDAs, addendums, MOUs share one governed lifecycle. An
 * addendum is made real by `linkedAgreementId`: an optional reference to the
 * parent agreement it modifies.
 *
 * This domain deliberately goes BEYOND the CP: the reference app's contracts
 * were read-only V1 (its capture-renewal write was a mock). Here the material
 * lifecycle is GOVERNED — AddAgreement / RenewAgreement / TerminateAgreement
 * ride the approval pipeline — while NON-MATERIAL fields (code, type, notes,
 * linkage) are DIRECT-BUT-AUDITED with the version guard. Dates and value are
 * material terms: they never move through the direct path.
 *
 * Money is integer CENTS end-to-end (never floats). Dates are plain ISO
 * strings end-to-end (the Credentials discipline). Renewal urgency is DERIVED
 * read-side (the credentialStatusOn pattern) — Expired is never stored.
 */

import { z } from 'zod';
import { isoDateSchema } from './credential';
import { entityIdOptional } from './entity';

export const AGREEMENT_STATUSES = ['Active', 'Terminated'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/**
 * Sentinel written to Approval.targetPersonId for ENTITY-LEVEL agreement
 * operations (no owning person — the MEMBER_OP_TARGET precedent). Never a
 * valid PER id; person-scoped approval reads never match it.
 */
export const ENTITY_AGREEMENT_TARGET = 'N/A-ENTITY';

/** An Agreement as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Agreement {
  /** Canonical business identity, e.g. "AGR-0001". */
  readonly agreementId: string;
  readonly tenantId: string;
  /**
   * The owning person's canonical id (PER-XXXX), or NULL for an ENTITY-LEVEL
   * agreement (Tier-0 S1, the S48 fast-follow): org-to-org paper — sponsorships,
   * partnership fees — anchored to a tenant entity instead of a person. THE
   * ANCHOR RULE: personId or entityId, at least one (schema + DB CHECK).
   */
  readonly personId: string | null;
  /**
   * S48: the tenant legal entity this agreement sits UNDER (ENT-XXXX), e.g. the
   * UAE company. Optional for now (existing agreements pre-date entities);
   * person-less entity-level agreements are a documented fast-follow.
   */
  readonly entityId: string | null;
  /** Optional human canonical code (the CP convention, e.g. "GKE-PL-2026-001"). */
  readonly agreementCode: string | null;
  /** Free-text kind: "Player Contract", "NDA", "Addendum", "MOU", … */
  readonly agreementType: string;
  /**
   * Optional parent agreement this one modifies or accompanies (AGR-XXXX) —
   * what makes an addendum or side letter a first-class relationship rather
   * than a naming convention.
   */
  readonly linkedAgreementId: string | null;
  /** ISO calendar date, YYYY-MM-DD. */
  readonly startsOn: string;
  /** Required: a term agreement. Renewal extends it (governed). */
  readonly endsOn: string;
  /**
   * Agreement value in integer US cents; null = not recorded (an NDA usually
   * carries none). FINANCIAL FIELD: the read model omits it entirely for
   * roles without canViewFinancials — absence, not masking.
   */
  readonly valueUsdCents: number | null;
  readonly notes: string | null;
  /** Terminated is terminal and stored; Expired is DERIVED, never stored. */
  readonly status: AgreementStatus;
  /** Optimistic-concurrency token (monotonic integer). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── derived renewal state (read-side only; no scheduler) ─────────────────────

export type AgreementRenewalState = 'Terminated' | 'Expired' | 'Due30' | 'Due60' | 'Due90' | 'Active';

function horizonIso(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/**
 * The CP Renewals-center 30/60/90 windows as a pure derivation. Boundary:
 * endsOn == today is Due30 (still active, most urgent window); the day after
 * the end date it becomes Expired.
 */
export function agreementRenewalStateOn(
  a: Pick<Agreement, 'status' | 'endsOn'>,
  todayIso: string,
): AgreementRenewalState {
  if (a.status === 'Terminated') return 'Terminated';
  if (a.endsOn < todayIso) return 'Expired';
  if (a.endsOn <= horizonIso(todayIso, 30)) return 'Due30';
  if (a.endsOn <= horizonIso(todayIso, 60)) return 'Due60';
  if (a.endsOn <= horizonIso(todayIso, 90)) return 'Due90';
  return 'Active';
}

// ── input contracts ──────────────────────────────────────────────────────────

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const personIdField = z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id');
const agreementIdField = z.string().regex(/^AGR-\d{4,}$/, 'agreementId must be a canonical AGR id');
const linkedAgreementOptional = z
  .string()
  .regex(/^AGR-\d{4,}$/, 'linkedAgreementId must be a canonical AGR id')
  .nullish()
  .transform((v) => v ?? null);

/** Integer US cents, non-negative, safely representable. */
const centsField = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * AddAgreement — the governed creation request. personId is OPTIONAL (an
 * entity-level agreement has none), but THE ANCHOR RULE holds: a person or an
 * entity, at least one — an agreement anchored to nothing is meaningless.
 */
export const addAgreementInputSchema = z
  .object({
    personId: personIdField.nullish().transform((v) => v ?? null),
    entityId: entityIdOptional,
    agreementCode: trimmedOptional(60),
    agreementType: z.string().trim().min(1, 'Agreement type is required').max(120),
    linkedAgreementId: linkedAgreementOptional,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    valueUsdCents: centsField.nullish().transform((v) => v ?? null),
    notes: trimmedOptional(2000),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, {
    message: 'End date must be on or after the start date',
    path: ['endsOn'],
  })
  .refine((v) => v.personId !== null || v.entityId !== null, {
    message: 'An agreement needs an anchor: a person, an entity, or both.',
    path: ['personId'],
  });
export type AddAgreementInput = z.infer<typeof addAgreementInputSchema>;

/**
 * RenewAgreement — governed term extension (the write the CP never shipped).
 * newEndsOn must beat the STORED end date; the boundary check here is shape
 * only — the authoritative comparison happens at submit (friendly) and again
 * inside the execution transaction.
 */
export const renewAgreementInputSchema = z
  .object({
    agreementId: agreementIdField,
    newEndsOn: isoDateSchema,
  })
  .strict();
export type RenewAgreementInput = z.infer<typeof renewAgreementInputSchema>;

/** TerminateAgreement — governed, terminal, reason mandatory (audited). */
export const terminateAgreementInputSchema = z
  .object({
    agreementId: agreementIdField,
    reason: z.string().trim().min(1, 'A termination reason is mandatory').max(1000),
  })
  .strict();
export type TerminateAgreementInput = z.infer<typeof terminateAgreementInputSchema>;

/**
 * Direct-but-audited update — NON-MATERIAL fields only, plus the mandatory
 * expected version. Dates and value are material terms and move ONLY through
 * the governed operations above. Self-linkage is refused by the use-case
 * (the boundary cannot see the row's own id).
 */
export const agreementUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    agreementCode: trimmedOptional(60).optional(),
    agreementType: z.string().trim().min(1).max(120).optional(),
    linkedAgreementId: linkedAgreementOptional.optional(),
    notes: trimmedOptional(2000).optional(),
  })
  .strict()
  .refine(
    (v) => ['agreementCode', 'agreementType', 'linkedAgreementId', 'notes'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  );
export type AgreementUpdateInput = z.infer<typeof agreementUpdateInputSchema>;
