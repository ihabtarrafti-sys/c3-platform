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
import type { Persistence } from '../ports';

export async function getCalendar(p: Persistence, actor: Actor, horizonDays: number): Promise<CalendarItem[]> {
  assertViewApprovals(actor); // operational surface: owner/operations
  assertReadAgreements(actor); // both hold it; fail closed regardless
  const reads = p.reads.forActor(actor);

  const [credentials, agreements, missions, delegations, people] = await Promise.all([
    reads.listCredentials(),
    reads.listAgreements(),
    reads.listMissions(),
    reads.listDelegations(),
    reads.listPeople(),
  ]);

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
    },
    todayIso,
    horizonDays,
  );
}
