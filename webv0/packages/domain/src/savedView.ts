/**
 * savedView.ts — saved views (Track B): a named, PERSONAL filter/sort/search
 * preset on a register ("LoL roster — active"). The domain owns the envelope
 * (which register, a name, a version) and treats `state` as OPAQUE JSON — a
 * plain object the web serialises and the backend stores/returns verbatim, so a
 * new register needs no backend change. Bounded: a name length and a serialised
 * `state` ceiling (a saved view is a small preset, never a document).
 *
 * Personal, not governed: any authenticated user may keep their own views, and
 * the ops layer scopes every read/write to the owner. No audit trail (UI
 * preferences are not business facts).
 */
import { z } from 'zod';

/** The registers a view may target. Extra values are harmless (unwired until a
 *  register's UI captures state); adding one never needs a migration. */
export const SAVED_VIEW_REGISTERS = ['people', 'agreements', 'missions', 'credentials', 'claims', 'approvals', 'kit', 'apparel'] as const;
export type SavedViewRegister = (typeof SAVED_VIEW_REGISTERS)[number];

export const SAVED_VIEW_NAME_MAX = 60;
/** Serialised `state` ceiling — a preset, not a payload. */
export const SAVED_VIEW_STATE_MAX_BYTES = 4096;

/** A saved view as the domain reasons about it. `id` is the surrogate uuid —
 *  saved views are personal UI state, the one place a uuid is the wire id. */
export interface SavedView {
  readonly id: string;
  readonly tenantId: string;
  readonly userIdentity: string;
  readonly register: SavedViewRegister;
  readonly name: string;
  /** Opaque web-owned filter/sort/search blob. */
  readonly state: unknown;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A plain JSON object, bounded by its serialised size. */
const stateSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= SAVED_VIEW_STATE_MAX_BYTES, `The saved view is too large (max ${SAVED_VIEW_STATE_MAX_BYTES} bytes).`);

const nameSchema = z.string().trim().min(1, 'A name is required.').max(SAVED_VIEW_NAME_MAX);

export const savedViewCreateInputSchema = z
  .object({
    register: z.enum(SAVED_VIEW_REGISTERS),
    name: nameSchema,
    state: stateSchema,
  })
  .strict();
export type SavedViewCreateInput = z.infer<typeof savedViewCreateInputSchema>;

/** Update is a partial patch (rename and/or re-save state), version-free. */
export const savedViewUpdateInputSchema = z
  .object({
    name: nameSchema.optional(),
    state: stateSchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.state !== undefined, 'Nothing to update.');
export type SavedViewUpdateInput = z.infer<typeof savedViewUpdateInputSchema>;
