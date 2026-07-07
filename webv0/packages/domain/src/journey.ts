/**
 * journey.ts — the Journey domain entity and its lifecycle state machine
 * (Sprint 37; design: docs/design/S37-journeys-domain.md; CP-parity: the
 * certified SP reference's InitiateJourney → Suspend/Resume/Complete/Cancel).
 *
 * Two operation classes, deliberately split:
 *   - InitiateJourney is GOVERNED (approval-gated, like AddPerson);
 *   - the four transitions are DIRECT-BUT-AUDITED (role-gated, state-machine
 *     validated, version-guarded, audit in the same transaction) — the CP
 *     posture: routine lifecycle transitions never drown the approval inbox.
 *
 * Dates follow the Credentials discipline: plain ISO YYYY-MM-DD end-to-end.
 */

import { z } from 'zod';
import { isoDateSchema } from './credential';

export const JOURNEY_STATUSES = ['Active', 'Suspended', 'Completed', 'Cancelled'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export function isJourneyStatus(value: unknown): value is JourneyStatus {
  return typeof value === 'string' && (JOURNEY_STATUSES as readonly string[]).includes(value);
}

/** A Journey as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Journey {
  /** Canonical business identity, e.g. "JRN-0001". */
  readonly journeyId: string;
  readonly tenantId: string;
  /** The person whose journey this is (PER-XXXX). */
  readonly personId: string;
  readonly journeyType: string;
  readonly title: string | null;
  /** ISO calendar date, YYYY-MM-DD. */
  readonly startedOn: string;
  /** Set by Complete/Cancel; null while the journey is open. */
  readonly endedOn: string | null;
  readonly status: JourneyStatus;
  readonly notes: string | null;
  /** Optimistic-concurrency token (monotonic integer). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── the lifecycle state machine ──────────────────────────────────────────────

export type JourneyTransition = 'suspend' | 'resume' | 'complete' | 'cancel';
export const JOURNEY_TRANSITIONS = ['suspend', 'resume', 'complete', 'cancel'] as const;

const TRANSITIONS: Readonly<Record<JourneyTransition, { from: readonly JourneyStatus[]; to: JourneyStatus }>> = {
  suspend: { from: ['Active'], to: 'Suspended' },
  resume: { from: ['Suspended'], to: 'Active' },
  complete: { from: ['Active', 'Suspended'], to: 'Completed' },
  cancel: { from: ['Active', 'Suspended'], to: 'Cancelled' },
};

export function canTransitionJourney(action: JourneyTransition, from: JourneyStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/** Resulting status for a legal transition, or null when illegal. */
export function nextJourneyStatus(action: JourneyTransition, from: JourneyStatus): JourneyStatus | null {
  return canTransitionJourney(action, from) ? TRANSITIONS[action].to : null;
}

export function journeyTransitionsFrom(from: JourneyStatus): JourneyTransition[] {
  return (Object.keys(TRANSITIONS) as JourneyTransition[]).filter((a) => canTransitionJourney(a, from));
}

export const JOURNEY_TERMINAL_STATUSES: readonly JourneyStatus[] = ['Completed', 'Cancelled'];
export const isJourneyTerminal = (s: JourneyStatus): boolean => JOURNEY_TERMINAL_STATUSES.includes(s);

/** Transitions that close the journey (stamp endedOn). */
export const JOURNEY_CLOSING_TRANSITIONS: readonly JourneyTransition[] = ['complete', 'cancel'];

// ── input contracts ──────────────────────────────────────────────────────────

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

/** InitiateJourney — the governed creation request. */
export const initiateJourneyInputSchema = z
  .object({
    personId: z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id'),
    journeyType: z.string().trim().min(1, 'Journey type is required').max(120),
    title: trimmedOptional(200),
    startedOn: isoDateSchema,
    notes: trimmedOptional(2000),
  })
  .strict();
export type InitiateJourneyInput = z.infer<typeof initiateJourneyInputSchema>;

/**
 * A direct transition request (validated at the API edge). Cancel REQUIRES a
 * reason (audited); the other transitions accept an optional note.
 */
export const journeyTransitionRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type JourneyTransitionRequest = z.infer<typeof journeyTransitionRequestSchema>;
