/**
 * savedViewOps — saved views (Track B): a user's own named filter/sort/search
 * presets on a register. PERSONAL, so there is no capability gate beyond being
 * an authenticated actor — anyone (including a read-only role) keeps their own
 * views. Every read and write is OWNER-SCOPED by the actor identity, so a user
 * never sees or touches another's views (RLS enforces the tenant boundary as
 * everywhere else). Not audited (UI preferences are not governed facts).
 *
 * `state` is opaque JSON — validated only for shape (a plain object) and a size
 * ceiling; the backend never interprets it, so a new register needs no change.
 */
import {
  type Actor,
  type SavedView,
  type SavedViewCreateInput,
  type SavedViewUpdateInput,
  savedViewCreateInputSchema,
  savedViewUpdateInputSchema,
  SAVED_VIEW_REGISTERS,
  type SavedViewRegister,
  ConflictError,
  NotFoundError,
} from '@c3web/domain';
import type { Persistence } from '../ports';

/** A Postgres unique-violation (23505) — drizzle wraps the driver error, so the
 *  code can be top-level OR on `.cause`. saved_view has a single unique index
 *  (the active name), so any 23505 on it is the name conflict. */
function isUniqueViolation(err: unknown): boolean {
  const top = (err as { code?: string }).code;
  const cause = (err as { cause?: { code?: string } }).cause?.code;
  return top === '23505' || cause === '23505';
}

/** Is `v` one of the known registers? (Guards the query-string.) */
export function isSavedViewRegister(v: string): v is SavedViewRegister {
  return (SAVED_VIEW_REGISTERS as readonly string[]).includes(v);
}

/** This user's active views for a register (no capability gate — personal). */
export async function listSavedViews(p: Persistence, actor: Actor, register: SavedViewRegister): Promise<SavedView[]> {
  return p.reads.forActor(actor).listSavedViews(actor.identity, register);
}

export async function createSavedView(p: Persistence, actor: Actor, input: SavedViewCreateInput): Promise<SavedView> {
  const parsed = savedViewCreateInputSchema.parse(input);
  return p.writes.transaction(actor, async (tx) => {
    try {
      return await tx.insertSavedView({ userIdentity: actor.identity, register: parsed.register, name: parsed.name, state: parsed.state });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(`You already have a view named "${parsed.name}".`);
      throw err;
    }
  });
}

export async function updateSavedView(p: Persistence, actor: Actor, id: string, input: SavedViewUpdateInput): Promise<SavedView> {
  const parsed = savedViewUpdateInputSchema.parse(input);
  return p.writes.transaction(actor, async (tx) => {
    try {
      const updated = await tx.updateSavedView(id, actor.identity, { name: parsed.name, state: parsed.state });
      if (!updated) throw new NotFoundError('SavedView', id);
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(`You already have a view named "${parsed.name}".`);
      throw err;
    }
  });
}

export async function removeSavedView(p: Persistence, actor: Actor, id: string): Promise<SavedView> {
  return p.writes.transaction(actor, async (tx) => {
    const removed = await tx.deactivateSavedView(id, actor.identity);
    if (!removed) throw new NotFoundError('SavedView', id);
    return removed;
  });
}
