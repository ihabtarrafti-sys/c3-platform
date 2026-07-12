/**
 * personPhotoOps — the person headshot (Track B). The API layer receives the
 * image bytes, enforces the image-only type + size + magic-byte match, computes
 * the SHA-256, stores the blob under a tenant-scoped server-generated key, and
 * THEN sets the pointer here.
 *
 * AUTHZ mirrors the name: VIEWING a photo rides the baseline people read (a
 * face is the same read surface as the person's name — not the PII tier).
 * SET / CLEAR are owner/operations (assertSubmitApproval), direct-audited on
 * the PERSON trail (PersonPhotoUpdated / PersonPhotoRemoved), consistent with
 * how document attach records facts. The pointer is version-FREE — a photo swap
 * never collides with a governed identity edit. Replacing a photo leaves the
 * prior blob orphaned-but-retained (the no-DELETE data-plane law).
 */
import { type Actor, type Person, NotFoundError } from '@c3web/domain';
import { assertReadPeople, assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

/** What the serve route needs to fetch + integrity-check + label the bytes. */
export interface PersonPhotoRef {
  readonly storageKey: string;
  readonly contentType: string;
  readonly sha256: string;
}

/** Resolve the current photo pointer (baseline people read). Null = no photo. */
export async function getPersonPhoto(p: Persistence, actor: Actor, personId: string): Promise<PersonPhotoRef | null> {
  assertReadPeople(actor);
  const person = await p.reads.forActor(actor).getPersonById(personId);
  if (!person) throw new NotFoundError('Person', personId);
  if (!person.photoStorageKey || !person.photoContentType || !person.photoSha256) return null;
  return { storageKey: person.photoStorageKey, contentType: person.photoContentType, sha256: person.photoSha256 };
}

/** Set/replace the photo pointer AFTER the bytes landed in storage (ops). */
export async function setPersonPhoto(p: Persistence, actor: Actor, personId: string, ref: PersonPhotoRef): Promise<Person> {
  assertSubmitApproval(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.lockPerson(personId);
    if (!current) throw new NotFoundError('Person', personId);
    const updated = await tx.setPersonPhoto(personId, { storageKey: ref.storageKey, contentType: ref.contentType, sha256: ref.sha256 });
    if (!updated) throw new NotFoundError('Person', personId);
    await tx.appendAuditEvent({
      entityType: 'Person',
      entityId: personId,
      action: 'PersonPhotoUpdated',
      actor: actor.identity,
      before: current.photoSha256 ? { sha256: current.photoSha256 } : null,
      after: { contentType: ref.contentType, sha256: ref.sha256 },
    });
    return updated;
  });
}

/** Clear the photo pointer (ops). The prior blob is retained, unreachable. */
export async function clearPersonPhoto(p: Persistence, actor: Actor, personId: string): Promise<Person> {
  assertSubmitApproval(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.lockPerson(personId);
    if (!current) throw new NotFoundError('Person', personId);
    const updated = await tx.setPersonPhoto(personId, null);
    if (!updated) throw new NotFoundError('Person', personId);
    // Idempotent: clearing an already-photo-less person is a no-op, unaudited.
    if (current.photoSha256) {
      await tx.appendAuditEvent({
        entityType: 'Person',
        entityId: personId,
        action: 'PersonPhotoRemoved',
        actor: actor.identity,
        before: { sha256: current.photoSha256 },
        after: null,
      });
    }
    return updated;
  });
}
