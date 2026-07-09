/**
 * equipment.ts — the Kit and Apparel domain entities (Sprint 38; design:
 * docs/design/S38-kit-apparel-domain.md).
 *
 * Both are pure DIRECT-BUT-AUDITED CRUD (the Sprint-37 mutation pattern):
 * create / update / deactivate execute immediately for authorized roles,
 * version-guarded (the optimistic token plays the CP-era ETag role), with the
 * audit event committed in the same transaction. Nothing here enters the
 * approval pipeline.
 *
 * CP-parity authorization nuance: HR may manage APPAREL (team clothing is
 * HR-adjacent) but not Kit — the first non-read capability for the hr role.
 */

import { z } from 'zod';

/**
 * Fulfillment status (D-7, owner-approved 2026-07-09) — the lifecycle an
 * equipment item moves through from acquisition to delivery. DISTINCT from
 * `isActive` (which retires the record): a Done item is still an active record.
 *
 *   Received → InProgress → ReadyForShipment → InTransit → Delivered → Done ✓
 *                  ↕                 ↕
 *               OnHold  ────────────┘   (resume returns to InProgress)
 *   Received / InProgress / OnHold  →  Rejected ✗
 *
 * Done and Rejected are terminal. New items start Received.
 */
export const EQUIPMENT_STATUSES = [
  'Received',
  'InProgress',
  'OnHold',
  'ReadyForShipment',
  'InTransit',
  'Delivered',
  'Done',
  'Rejected',
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export const DEFAULT_EQUIPMENT_STATUS: EquipmentStatus = 'Received';

export function isEquipmentStatus(v: unknown): v is EquipmentStatus {
  return typeof v === 'string' && (EQUIPMENT_STATUSES as readonly string[]).includes(v);
}

export const EQUIPMENT_TRANSITIONS = ['start', 'hold', 'resume', 'ready', 'ship', 'deliver', 'complete', 'reject'] as const;
export type EquipmentTransition = (typeof EQUIPMENT_TRANSITIONS)[number];

const TRANSITIONS: Readonly<Record<EquipmentTransition, { from: readonly EquipmentStatus[]; to: EquipmentStatus }>> = {
  start: { from: ['Received'], to: 'InProgress' },
  hold: { from: ['InProgress', 'ReadyForShipment'], to: 'OnHold' },
  resume: { from: ['OnHold'], to: 'InProgress' },
  ready: { from: ['InProgress'], to: 'ReadyForShipment' },
  ship: { from: ['ReadyForShipment'], to: 'InTransit' },
  deliver: { from: ['InTransit'], to: 'Delivered' },
  complete: { from: ['Delivered'], to: 'Done' },
  reject: { from: ['Received', 'InProgress', 'OnHold'], to: 'Rejected' },
};

export function canTransitionEquipment(action: EquipmentTransition, from: EquipmentStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}
export function nextEquipmentStatus(action: EquipmentTransition, from: EquipmentStatus): EquipmentStatus | null {
  return canTransitionEquipment(action, from) ? TRANSITIONS[action].to : null;
}
export function equipmentTransitionsFrom(from: EquipmentStatus): EquipmentTransition[] {
  return (Object.keys(TRANSITIONS) as EquipmentTransition[]).filter((a) => canTransitionEquipment(a, from));
}
export const EQUIPMENT_TERMINAL_STATUSES: readonly EquipmentStatus[] = ['Done', 'Rejected'];

/** A direct transition request (validated at the API edge). */
export const equipmentTransitionRequestSchema = z
  .object({
    action: z.enum(EQUIPMENT_TRANSITIONS),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type EquipmentTransitionRequest = z.infer<typeof equipmentTransitionRequestSchema>;

/** Shared row shape — each entity lives in its own table. */
export interface EquipmentItem {
  readonly tenantId: string;
  readonly name: string;
  readonly category: string;
  readonly size: string | null;
  /** Optional owning person (PER-XXXX); an item may be unassigned. */
  readonly assignedPersonId: string | null;
  readonly notes: string | null;
  /** Fulfillment lifecycle status (D-7). */
  readonly status: EquipmentStatus;
  readonly isActive: boolean;
  /** Optimistic-concurrency token (the ETag-parity guard). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Kit extends EquipmentItem {
  /** Canonical business identity, e.g. "KIT-0001". */
  readonly kitId: string;
}

export interface Apparel extends EquipmentItem {
  /** Canonical business identity, e.g. "APL-0001". */
  readonly apparelId: string;
}

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const personIdOptional = z
  .string()
  .regex(/^PER-\d{4,}$/, 'assignedPersonId must be a canonical PER id')
  .nullish()
  .transform((v) => v ?? null);

/** Create contract — shared by Kit and Apparel. */
export const equipmentCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    category: z.string().trim().min(1, 'Category is required').max(120),
    size: trimmedOptional(40),
    assignedPersonId: personIdOptional,
    notes: trimmedOptional(2000),
  })
  .strict();
export type EquipmentCreateInput = z.infer<typeof equipmentCreateInputSchema>;

/**
 * Update contract — a PARTIAL patch of the editable fields plus the mandatory
 * expected version. At least one editable field must be present (an empty
 * patch is a caller bug, refused at the boundary).
 */
export const equipmentUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(160).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    size: trimmedOptional(40).optional(),
    assignedPersonId: personIdOptional.optional(),
    notes: trimmedOptional(2000).optional(),
  })
  .strict()
  .refine(
    (v) => ['name', 'category', 'size', 'assignedPersonId', 'notes'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  );
export type EquipmentUpdateInput = z.infer<typeof equipmentUpdateInputSchema>;
