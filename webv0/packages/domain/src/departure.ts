/**
 * departure.ts — Track B: departure workflow (the offboarding twin of
 * onboarding). A DEPARTURE record marks "this person is leaving"; the readiness
 * checklist is a DERIVED view of what is still open across their agreements,
 * rosters, credentials, and kit/apparel — each closed through its OWN existing
 * pipeline (no new mutation paths). Completing the departure optionally submits
 * the governed DeactivatePerson. Buyout-income is out of scope (the finance
 * session). Direct-audited; owner/operations.
 */
import { z } from 'zod';

export const DEPARTURE_STATUSES = ['InProgress', 'Completed', 'Cancelled'] as const;
export type DepartureStatus = (typeof DEPARTURE_STATUSES)[number];

export interface Departure {
  readonly departureId: string; // DEP-XXXX
  readonly tenantId: string;
  readonly personId: string;
  readonly reason: string;
  readonly status: DepartureStatus;
  readonly initiatedBy: string;
  readonly initiatedOn: string;
  readonly completedOn: string | null;
  readonly notes: string | null;
  /** M-03: durable deactivation-hand-off outbox. `requested` is set atomically at
   *  completion; `approvalId` is linked write-once by the drain (null = pending). */
  readonly deactivationRequested: boolean;
  readonly deactivationApprovalId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function formatDepartureId(seq: number): string {
  return `DEP-${String(seq).padStart(4, '0')}`;
}

const personIdField = z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id');

export const initiateDepartureInputSchema = z
  .object({ personId: personIdField, reason: z.string().trim().min(1, 'A reason is required').max(2000) })
  .strict();
export type InitiateDepartureInput = z.infer<typeof initiateDepartureInputSchema>;

export const completeDepartureInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    note: z.string().trim().max(2000).nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
    /** When true, the capstone also SUBMITS the governed DeactivatePerson. */
    deactivatePerson: z.boolean().optional().default(false),
  })
  .strict();
export type CompleteDepartureInput = z.infer<typeof completeDepartureInputSchema>;

// ── the derived readiness checklist ──────────────────────────────────────────
export const DEPARTURE_ITEM_KINDS = ['Agreement', 'Roster', 'Credential', 'Kit', 'Apparel'] as const;
export type DepartureItemKind = (typeof DEPARTURE_ITEM_KINDS)[number];

export interface DepartureOpenItem {
  readonly kind: DepartureItemKind;
  readonly id: string;
  readonly label: string;
  readonly route: string;
}

export interface DepartureReadinessInput {
  readonly agreements: ReadonlyArray<{ agreementId: string; personId: string | null; agreementType: string; endsOn: string; status: string }>;
  readonly participants: ReadonlyArray<{ missionId: string; personId: string; role: string; isActive: boolean }>;
  readonly credentials: ReadonlyArray<{ credentialId: string; personId: string; credentialType: string; isActive: boolean }>;
  readonly kit: ReadonlyArray<{ kitId: string; name: string; assignedPersonId: string | null; isActive: boolean }>;
  readonly apparel: ReadonlyArray<{ apparelId: string; name: string; assignedPersonId: string | null; isActive: boolean }>;
}

/**
 * Everything still open for a departing person, each linking to the record that
 * closes it. Pure — the situation engine reuses the governed subset
 * (agreements/roster/credentials); the page shows the whole list incl. kit.
 */
export function computeDepartureReadiness(personId: string, input: DepartureReadinessInput): DepartureOpenItem[] {
  const items: DepartureOpenItem[] = [];
  for (const a of input.agreements) {
    if (a.personId === personId && a.status === 'Active') items.push({ kind: 'Agreement', id: a.agreementId, label: `${a.agreementType} — active, ends ${a.endsOn}`, route: `/agreements/${a.agreementId}` });
  }
  for (const p of input.participants) {
    if (p.personId === personId && p.isActive) items.push({ kind: 'Roster', id: p.missionId, label: `On mission ${p.missionId} as ${p.role}`, route: `/missions/${p.missionId}` });
  }
  for (const c of input.credentials) {
    if (c.personId === personId && c.isActive) items.push({ kind: 'Credential', id: c.credentialId, label: `${c.credentialType} — active`, route: `/people/${personId}` });
  }
  for (const k of input.kit) {
    if (k.assignedPersonId === personId && k.isActive) items.push({ kind: 'Kit', id: k.kitId, label: `${k.name} — assigned, not returned`, route: `/kit` });
  }
  for (const ap of input.apparel) {
    if (ap.assignedPersonId === personId && ap.isActive) items.push({ kind: 'Apparel', id: ap.apparelId, label: `${ap.name} — assigned, not returned`, route: `/apparel` });
  }
  return items;
}
