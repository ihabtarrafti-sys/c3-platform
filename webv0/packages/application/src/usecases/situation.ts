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
import { composeSituation, PENDING_STATUSES, SITUATION_CHECKS, type Actor, type Signal } from '@c3web/domain';
import { assertReadAgreements, assertViewApprovals } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface SituationCounts {
  readonly activeMissions: number;
  readonly rosteredPlayers: number;
  readonly credentialsTracked: number;
  readonly liveAgreements: number;
  readonly openApprovals: number;
}

export interface SituationView {
  readonly todayIso: string;
  readonly signals: Signal[];
  /** What was checked — rendered with the all-clear so silence ≠ blindness. */
  readonly checks: readonly string[];
  /** S46 stat ribbon — derived from the SAME one-pass read as the signals. */
  readonly counts: SituationCounts;
}

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getSituation(p: Persistence, actor: Actor): Promise<SituationView> {
  assertViewApprovals(actor); // operational surface: owner/operations
  assertReadAgreements(actor); // both operational roles hold it; fail closed regardless
  const reads = p.reads.forActor(actor);

  const [people, credentials, agreements, missions, participants, approvals, journeys, members, missionLines, invoices, teams, teamMemberships] = await Promise.all([
    reads.listPeople(),
    reads.listCredentials(),
    reads.listAgreements(),
    reads.listMissions(),
    reads.listAllMissionParticipants(),
    reads.listApprovals(),
    reads.listJourneys(),
    reads.listMembers(),
    reads.listAllMissionLines(),
    reads.listInvoices(),
    reads.listTeams(),
    reads.listAllTeamMemberships(),
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
      financeStage: m.financeStage,
    })),
    // S6 settlement signals: slim income-line + live-invoice views. The
    // cockpit is owner/ops-gated, so the printed amounts stay within rights.
    missionLines: missionLines.map((l) => ({
      lineId: l.lineId,
      missionId: l.missionId,
      direction: l.direction,
      category: l.category,
      label: l.label,
      amountMinor: l.amountMinor,
      currency: l.currency,
      paymentStatus: l.paymentStatus,
      isActive: l.isActive,
    })),
    invoices: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, lineId: i.lineId, status: i.status })),
    teams: teams.map((t) => ({ teamId: t.teamId, name: t.name, code: t.code, kind: t.kind, isActive: t.isActive })),
    teamMemberships,
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

  const activeMissionIds = new Set(missions.filter((m) => m.isActive).map((m) => m.missionId));
  const counts: SituationCounts = {
    activeMissions: activeMissionIds.size,
    rosteredPlayers: new Set(
      participants.filter((pt) => pt.isActive && activeMissionIds.has(pt.missionId)).map((pt) => pt.personId),
    ).size,
    credentialsTracked: credentials.filter((c) => c.isActive).length,
    liveAgreements: agreements.filter((a) => a.status === 'Active').length,
    openApprovals: approvals.filter((a) => (PENDING_STATUSES as readonly string[]).includes(a.status)).length,
  };

  return { todayIso, signals, checks: SITUATION_CHECKS, counts };
}
