/**
 * departureOps — departure workflow (Track B). A DEPARTURE record marks a
 * person as leaving; the readiness checklist is DERIVED across their active
 * agreements / roster / credentials / kit / apparel — each closed through its
 * OWN pipeline. Direct-audited; the operational surface (owner/operations).
 * Completing optionally hands the person to the governed DeactivatePerson (done
 * at the API edge, which owns that submit). Buyout-income is out of scope.
 */
import {
  type Actor,
  type Departure,
  type DepartureOpenItem,
  type InitiateDepartureInput,
  type CompleteDepartureInput,
  initiateDepartureInputSchema,
  completeDepartureInputSchema,
  computeDepartureReadiness,
  formatDepartureId,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
} from '@c3web/domain';
import { assertSubmitApproval, assertViewApprovals } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface DepartureWithReadiness {
  readonly departure: Departure;
  readonly personName: string;
  /** Open offboarding items (InProgress only; empty for closed departures). */
  readonly openItems: readonly DepartureOpenItem[];
}

export async function listDepartures(p: Persistence, actor: Actor): Promise<DepartureWithReadiness[]> {
  assertViewApprovals(actor); // operational surface (owner/operations)
  const reads = p.reads.forActor(actor);
  const [departures, people, agreements, participants, credentials, kit, apparel] = await Promise.all([
    reads.listDepartures(),
    reads.listPeople(),
    reads.listAgreements(),
    reads.listAllMissionParticipants(),
    reads.listCredentials(),
    reads.listKit(),
    reads.listApparel(),
  ]);
  const nameById = new Map(people.map((x) => [x.personId, x.fullName]));
  const input = {
    agreements: agreements.map((a) => ({ agreementId: a.agreementId, personId: a.personId, agreementType: a.agreementType, endsOn: a.endsOn, status: a.status })),
    participants: participants.map((pt) => ({ missionId: pt.missionId, personId: pt.personId, role: pt.role, isActive: pt.isActive })),
    credentials: credentials.map((c) => ({ credentialId: c.credentialId, personId: c.personId, credentialType: c.credentialType, isActive: c.isActive })),
    kit: kit.map((k) => ({ kitId: k.kitId, name: k.name, assignedPersonId: k.assignedPersonId, isActive: k.isActive })),
    apparel: apparel.map((ap) => ({ apparelId: ap.apparelId, name: ap.name, assignedPersonId: ap.assignedPersonId, isActive: ap.isActive })),
  };
  return departures.map((d) => ({ departure: d, personName: nameById.get(d.personId) ?? d.personId, openItems: d.status === 'InProgress' ? computeDepartureReadiness(d.personId, input) : [] }));
}

export async function initiateDeparture(p: Persistence, actor: Actor, input: InitiateDepartureInput): Promise<Departure> {
  assertSubmitApproval(actor);
  const parsed = initiateDepartureInputSchema.parse(input);
  const person = await p.reads.forActor(actor).getPersonById(parsed.personId);
  if (!person) throw new NotFoundError('Person', parsed.personId);

  return p.writes.transaction(actor, async (tx) => {
    const existing = await tx.getOpenDepartureForPerson(parsed.personId);
    if (existing) throw new ConflictError('This person already has a departure in progress.', { personId: parsed.personId, departureId: existing.departureId });

    const seq = await tx.allocateSequence('departure');
    const departureId = formatDepartureId(seq);
    let departure: Departure;
    try {
      departure = await tx.insertDeparture(departureId, { personId: parsed.personId, reason: parsed.reason, initiatedBy: actor.identity, initiatedOn: new Date().toISOString().slice(0, 10) });
    } catch (err) {
      // The partial unique index is the last line against a concurrent open.
      if ((err as { code?: string }).code === '23505') throw new ConflictError('This person already has a departure in progress.', { personId: parsed.personId });
      throw err;
    }
    await tx.appendAuditEvent({ entityType: 'Departure', entityId: departureId, action: 'DepartureInitiated', actor: actor.identity, before: null, after: { personId: parsed.personId, reason: parsed.reason } });
    return departure;
  });
}

export interface CompleteDepartureResult {
  readonly departure: Departure;
  /** The person the record covered — the API deactivates them when asked. */
  readonly personId: string;
  readonly deactivateRequested: boolean;
}

export async function completeDeparture(p: Persistence, actor: Actor, departureId: string, input: CompleteDepartureInput): Promise<CompleteDepartureResult> {
  assertSubmitApproval(actor);
  const parsed = completeDepartureInputSchema.parse(input);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getDeparture(departureId);
    if (!current) throw new NotFoundError('Departure', departureId);
    if (current.status === 'Cancelled') throw new ConflictError('A cancelled departure cannot be completed.', { departureId, status: current.status });
    // M-03: completion and the downstream deactivation hand-off are two separate
    // commits (the governed submit owns its own tx). If the hand-off failed after
    // this row was already Completed, a retry must be able to re-enter and finish
    // it — so an already-Completed departure returns idempotently (no re-audit)
    // and the caller re-issues the deactivation via findOrSubmitDeactivatePerson.
    if (current.status === 'Completed') {
      return { departure: current, personId: current.personId, deactivateRequested: parsed.deactivatePerson };
    }
    const updated = await tx.setDepartureStatus(departureId, parsed.expectedVersion, 'Completed', new Date().toISOString().slice(0, 10), parsed.note);
    if (!updated) throw new ConcurrencyError('Departure', departureId);
    await tx.appendAuditEvent({ entityType: 'Departure', entityId: departureId, action: 'DepartureCompleted', actor: actor.identity, before: { status: 'InProgress' }, after: { status: 'Completed', deactivateRequested: parsed.deactivatePerson } });
    return { departure: updated, personId: current.personId, deactivateRequested: parsed.deactivatePerson };
  });
}

export async function cancelDeparture(p: Persistence, actor: Actor, departureId: string, expectedVersion: number, note: string | null): Promise<Departure> {
  assertSubmitApproval(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getDeparture(departureId);
    if (!current) throw new NotFoundError('Departure', departureId);
    if (current.status !== 'InProgress') throw new ConflictError('This departure is already closed.', { departureId, status: current.status });
    const updated = await tx.setDepartureStatus(departureId, expectedVersion, 'Cancelled', null, note);
    if (!updated) throw new ConcurrencyError('Departure', departureId);
    await tx.appendAuditEvent({ entityType: 'Departure', entityId: departureId, action: 'DepartureCancelled', actor: actor.identity, before: { status: 'InProgress' }, after: { status: 'Cancelled' } });
    return updated;
  });
}
