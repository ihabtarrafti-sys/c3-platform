/**
 * recycle.ts — Track B2: the Recycle Bin domain shapes.
 *
 * A cross-domain register of everything soft-removed, with the principle that
 * restoring goes through each domain's OWN governance class — never a
 * backdoor. The data already exists by law (no-DELETE grants); the bin is a
 * door, not a data change.
 */
import { z } from 'zod';

/** The whole-record soft-delete domains covered in v1. */
export const RECYCLE_KINDS = ['person', 'entity', 'team', 'credential', 'kit', 'apparel'] as const;
export type RecycleKind = (typeof RECYCLE_KINDS)[number];

/**
 * How a row may be restored:
 *  - 'governed'   → restoring SUBMITS an approval (person: ReactivatePerson);
 *  - 'direct'     → restoring flips it immediately (entity, team);
 *  - 'recordPage' → no restore from the bin; open the record to manage it.
 */
export type RestoreClass = 'governed' | 'direct' | 'recordPage';

export const RESTORE_CLASS_OF: Readonly<Record<RecycleKind, RestoreClass>> = {
  person: 'governed',
  entity: 'direct',
  team: 'direct',
  // HARDEN-3 (owner ruling #1): finish the high-value doors. Credential
  // deactivation is GOVERNED, so its restore submits a ReactivateCredential
  // approval; kit/apparel are direct-audited, so they flip immediately.
  credential: 'governed',
  kit: 'direct',
  apparel: 'direct',
};

export interface RecycleItem {
  readonly kind: RecycleKind;
  /** The record's canonical business id (PER-XXXX, ENT-XXXX, …). */
  readonly id: string;
  /** Primary display line (the person's name, the team's name, …). */
  readonly label: string;
  /** Secondary context (IGN, code, category, owning person…), or null. */
  readonly sublabel: string | null;
  /** Where "open record" navigates for recordPage kinds (e.g. a credential's person). */
  readonly parentId: string | null;
  /** When it was removed (the record's updated_at). */
  readonly removedAt: string;
  /** Who removed it — the actor of the latest audit event, or null if unknown. */
  readonly removedBy: string | null;
  /** Optimistic-concurrency token for a direct restore. */
  readonly version: number;
  readonly restoreClass: RestoreClass;
}

/** Restore one record — the API dispatches by kind to the real reactivate path. */
export const restoreRecycleInputSchema = z
  .object({
    kind: z.enum(RECYCLE_KINDS),
    id: z.string().min(1).max(40),
    expectedVersion: z.number().int().min(0),
    /** Mandatory for the governed person restore; ignored by direct restores. */
    reason: z.string().trim().max(500).nullish(),
  })
  .strict();
export type RestoreRecycleInput = z.infer<typeof restoreRecycleInputSchema>;

export const isRestorableFromBin = (kind: RecycleKind): boolean => RESTORE_CLASS_OF[kind] !== 'recordPage';
