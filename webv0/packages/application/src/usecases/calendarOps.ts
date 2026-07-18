/**
 * calendarOps — Track B: the ops calendar / timeline read model.
 *
 * One parallel read pass over the dated domains, fed to the pure buildCalendar.
 * Gated to the operational surface (owner/ops) exactly like the Situation Room —
 * the viewer can see every underlying record, so the horizon is honest end to
 * end. No writes, no signal, no migration.
 */
import { buildCalendar, type Actor, type CalendarItem } from '@c3web/domain';
import { assertReadAgreements, assertViewApprovals } from '@c3web/authz';
import type { Persistence, ReadStore } from '../ports';

/** The 6-register read buildCalendar runs over — shared by both load paths (L-05b). */
function loadCalendarRegisters(reads: ReadStore) {
  return Promise.all([
    reads.listCredentials(),
    reads.listAgreements(),
    reads.listMissions(),
    reads.listDelegations(),
    reads.listPeople(),
    reads.listSubscriptions(),
  ]);
}

type CalendarRegisters = Awaited<ReturnType<typeof loadCalendarRegisters>>;

/** Scoped path (L-05b): one coherent tenant transaction. Harness-gated against getCalendarFullLoad. */
export async function getCalendar(p: Persistence, actor: Actor, horizonDays: number): Promise<CalendarItem[]> {
  assertViewApprovals(actor); // operational surface: owner/operations
  assertReadAgreements(actor); // both hold it; fail closed regardless
  const registers = await p.reads.forActor(actor).batch((r) => loadCalendarRegisters(r));
  return assembleCalendar(registers, horizonDays);
}

/** The full-load reference path — the equivalence harness's truth oracle; not called in production. */
export async function getCalendarFullLoad(p: Persistence, actor: Actor, horizonDays: number): Promise<CalendarItem[]> {
  assertViewApprovals(actor);
  assertReadAgreements(actor);
  const registers = await loadCalendarRegisters(p.reads.forActor(actor));
  return assembleCalendar(registers, horizonDays);
}

function assembleCalendar(registers: CalendarRegisters, horizonDays: number): CalendarItem[] {
  const [credentials, agreements, missions, delegations, people, subscriptions] = registers;

  const nameById = new Map(people.map((x) => [x.personId, x.fullName]));
  const todayIso = new Date().toISOString().slice(0, 10);

  return buildCalendar(
    {
      credentials: credentials.map((c) => ({
        credentialId: c.credentialId,
        personId: c.personId,
        credentialType: c.credentialType,
        expiresOn: c.expiresOn,
        isActive: c.isActive,
        personName: nameById.get(c.personId) ?? null,
      })),
      agreements: agreements.map((a) => ({ agreementId: a.agreementId, personId: a.personId, agreementType: a.agreementType, endsOn: a.endsOn, status: a.status })),
      missions: missions.map((m) => ({ missionId: m.missionId, name: m.name, startsOn: m.startsOn, endsOn: m.endsOn, isActive: m.isActive })),
      delegations: delegations.map((d) => ({ delegationId: d.delegationId, granteeIdentity: d.granteeIdentity, endsOn: d.endsOn, revokedAt: d.revokedAt })),
      subscriptions: subscriptions.map((sub) => ({ subscriptionId: sub.subscriptionId, name: sub.name, vendorName: sub.vendorName, nextRenewalOn: sub.nextRenewalOn, status: sub.status })),
    },
    todayIso,
    horizonDays,
  );
}
