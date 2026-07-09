/**
 * mission.ts — the Mission domain entity and participant-membership contracts
 * (Sprint 39, the CP-parity capstone; design: docs/design/S39-missions-domain.md).
 *
 * Two operation classes, deliberately split (the certified CP posture):
 *   - the Mission SHELL (create/update/deactivate) is DIRECT-BUT-AUDITED —
 *     the Sprint-38 equipment pattern: role-gated, version-guarded, audit in
 *     the same transaction;
 *   - PARTICIPANT membership is GOVERNED: AddMissionParticipant and
 *     RemoveMissionParticipant ride the approval pipeline, with the
 *     SP-certified duplicate guards (duplicate-pending refused at submit;
 *     duplicate-active refused at submit AND authoritatively at execute).
 *
 * A (tenant, mission, person) pair owns exactly ONE participant row, ever —
 * reactivation flips the existing row back to active (never a second row),
 * preserving the pair's full audit lineage. The guards themselves live in the
 * application use-cases and persistence; these are the value contracts.
 *
 * Dates follow the Credentials discipline: plain ISO YYYY-MM-DD end-to-end.
 */

import { z } from 'zod';
import { isoDateSchema } from './credential';
import { amountMinorSchema, currencyCodeSchema, type CurrencyCode } from './money';

/** A Mission as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Mission {
  /** Canonical business identity, e.g. "MSN-0001". */
  readonly missionId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly gameTitle: string | null;
  /** ISO calendar date, YYYY-MM-DD. */
  readonly startsOn: string;
  /** Optional planned end; same-day missions are legal (endsOn >= startsOn). */
  readonly endsOn: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
  /** Optimistic-concurrency token (the ETag-parity guard). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A person's membership in a mission. Reads enrich the row with the person's
 * display name (a join, not stored state). Participants carry no version:
 * they are mutated only through governed execution, whose idempotency and
 * conflict guards subsume the optimistic token.
 */
export interface MissionParticipant {
  readonly tenantId: string;
  readonly missionId: string;
  readonly personId: string;
  /** Read-side enrichment: the participant's current display name. */
  readonly personName: string;
  /** Free-text mission role, e.g. "Player", "Coach". */
  readonly role: string;
  readonly isActive: boolean;
  /**
   * Finance S2: per-diem DAILY rate for this person on this mission (money
   * metadata, direct-audited, set separately from the governed roster). Both
   * fields move together — null = no per-diem. FINANCIAL: the read model omits
   * them for roles without canViewPerDiem (absence, not masking).
   */
  readonly perDiemAmountMinor: number | null;
  readonly perDiemCurrency: CurrencyCode | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Inclusive mission-day count for per-diem totals: startsOn..endsOn counts both
 * ends. Null when the mission has no end date (total is then unknowable —
 * callers show the daily rate only). ISO date strings; UTC-noon avoids DST.
 */
export function missionDayCount(startsOn: string, endsOn: string | null): number | null {
  if (!endsOn) return null;
  const a = Date.parse(`${startsOn}T12:00:00Z`);
  const b = Date.parse(`${endsOn}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
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

const missionIdField = z.string().regex(/^MSN-\d{4,}$/, 'missionId must be a canonical MSN id');
const personIdField = z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id');

/** Same-day missions are legal; an end BEFORE the start is not (string compare is safe for ISO dates). */
const datesCoherent = (startsOn: string | undefined, endsOn: string | null | undefined): boolean =>
  startsOn === undefined || endsOn === undefined || endsOn === null || endsOn >= startsOn;

/** Create contract for the mission shell (direct-audited). */
export const missionCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    gameTitle: trimmedOptional(120),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullish().transform((v) => v ?? null),
    notes: trimmedOptional(2000),
  })
  .strict()
  .refine((v) => datesCoherent(v.startsOn, v.endsOn), {
    message: 'End date must be on or after the start date',
  });
export type MissionCreateInput = z.infer<typeof missionCreateInputSchema>;

/**
 * Update contract — a PARTIAL patch plus the mandatory expected version, the
 * Sprint-38 shape. Explicit `endsOn: null` clears the planned end (distinct
 * from omission). When the patch carries only one of the two dates, final
 * coherence against the stored row is enforced by the use-case and the DB
 * CHECK — a boundary schema cannot see stored state.
 */
export const missionUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(160).optional(),
    gameTitle: trimmedOptional(120).optional(),
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.nullable().optional(),
    notes: trimmedOptional(2000).optional(),
  })
  .strict()
  .refine(
    (v) => ['name', 'gameTitle', 'startsOn', 'endsOn', 'notes'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  )
  .refine((v) => datesCoherent(v.startsOn, v.endsOn), {
    message: 'End date must be on or after the start date',
  });
export type MissionUpdateInput = z.infer<typeof missionUpdateInputSchema>;

/**
 * AddMissionParticipant — the governed membership request. Both targets are
 * known at submission (unlike AddCredential's created id): the approval's
 * targetPersonId carries this personId and targetId carries the missionId.
 * Adding a previously-removed pair is a REACTIVATION of the same row.
 */
export const addMissionParticipantInputSchema = z
  .object({
    missionId: missionIdField,
    personId: personIdField,
    role: z.string().trim().min(1, 'Participant role is required').max(120),
  })
  .strict();
export type AddMissionParticipantInput = z.infer<typeof addMissionParticipantInputSchema>;

/** RemoveMissionParticipant — governed removal of an ACTIVE participant. */
export const removeMissionParticipantInputSchema = z
  .object({
    missionId: missionIdField,
    personId: personIdField,
  })
  .strict();
export type RemoveMissionParticipantInput = z.infer<typeof removeMissionParticipantInputSchema>;

/**
 * SetParticipantPerDiem (Finance S2) — the direct-audited money action.
 * Supplying amount+currency sets the daily rate; supplying both as null CLEARS
 * it. They must be provided together (a lone amount or currency is meaningless).
 */
export const setParticipantPerDiemInputSchema = z
  .object({
    missionId: missionIdField,
    personId: personIdField,
    perDiemAmountMinor: amountMinorSchema.nullable(),
    perDiemCurrency: currencyCodeSchema.nullable(),
  })
  .strict()
  .refine((v) => (v.perDiemAmountMinor === null) === (v.perDiemCurrency === null), {
    message: 'Per-diem amount and currency must be set together (or both cleared).',
  });
export type SetParticipantPerDiemInput = z.infer<typeof setParticipantPerDiemInputSchema>;
