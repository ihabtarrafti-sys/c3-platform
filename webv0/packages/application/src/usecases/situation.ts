/**
 * situation — the Situation Room read model (Sprint 43 Q2). Assembles the
 * per-actor snapshot in ONE parallel read pass and runs the pure signal
 * engine over it.
 *
 * The cockpit is an OPERATIONAL surface (the CP posture: visitors never saw
 * Renewals/Inbox/Approvals): it requires approval visibility (owner/ops).
 * That single gate makes the composition honest end-to-end — the viewer can
 * see every record and pending fix the signals reason about, so "no renewal
 * request is pending" is always a claim the viewer could verify themselves.
 */
import { composeSituation, SITUATION_CHECKS, type Actor, type Signal } from '@c3web/domain';
import { assertReadAgreements, assertViewApprovals } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface SituationView {
  readonly todayIso: string;
  readonly signals: Signal[];
  /** What was checked — rendered with the all-clear so silence ≠ blindness. */
  readonly checks: readonly string[];
}

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getSituation(p: Persistence, actor: Actor): Promise<SituationView> {
  assertViewApprovals(actor); // operational surface: owner/operations
  assertReadAgreements(actor); // both operational roles hold it; fail closed regardless
  const reads = p.reads.forActor(actor);

  const [people, credentials, agreements, missions, participants, approvals, journeys, members] = await Promise.all([
    reads.listPeople(),
    reads.listCredentials(),
    reads.listAgreements(),
    reads.listMissions(),
    reads.listAllMissionParticipants(),
    reads.listApprovals(),
    reads.listJourneys(),
    reads.listMembers(),
  ]);

  const todayIso = utcTodayIso();
  const signals = composeSituation({
    todayIso,
    ownerIdentities: members.filter((m) => m.role === 'owner' && m.isActive).map((m) => m.email),
    people: people.map((x) => ({ personId: x.personId, fullName: x.fullName, isActive: x.isActive })),
    credentials: credentials.map((c) => ({
      credentialId: c.credentialId,
      personId: c.personId,
      credentialType: c.credentialType,
      expiresOn: c.expiresOn,
      isActive: c.isActive,
    })),
    agreements: agreements.map((a) => ({
      agreementId: a.agreementId,
      personId: a.personId,
      agreementType: a.agreementType,
      endsOn: a.endsOn,
      status: a.status,
    })),
    missions: missions.map((m) => ({
      missionId: m.missionId,
      name: m.name,
      startsOn: m.startsOn,
      endsOn: m.endsOn,
      isActive: m.isActive,
    })),
    participants,
    approvals: approvals.map((a) => ({
      approvalId: a.approvalId,
      operationType: a.operationType,
      status: a.status,
      submittedBy: a.submittedBy,
      submittedAt: a.submittedAt,
      targetId: a.targetId,
      targetPersonId: a.targetPersonId,
    })),
    journeys: journeys.map((j) => ({
      journeyId: j.journeyId,
      personId: j.personId,
      journeyType: j.journeyType,
      status: j.status,
      updatedAt: j.updatedAt,
    })),
  });

  return { todayIso, signals, checks: SITUATION_CHECKS };
}
