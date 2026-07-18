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
import { sweepSignalNotifications } from './notificationOps';
import type { Persistence, ReadStore } from '../ports';

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

/** The 16-register read the signal engine runs over — defined ONCE, shared by
 *  both loading strategies (L-05b: the scoped path may not diverge in WHAT it
 *  reads, only in how the reads are transacted). */
function loadSituationRegisters(reads: ReadStore) {
  return Promise.all([
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
    reads.listDistributionsWithPending(),
    reads.listClaims(),
    reads.listDelegations(),
    reads.listDepartures(),
  ]);
}

type SituationRegisters = Awaited<ReturnType<typeof loadSituationRegisters>>;

/**
 * The scoped read path (L-05b): all 16 registers in ONE coherent tenant
 * transaction — the "one-pass read" the design always described, now literal
 * (one snapshot, one BEGIN/COMMIT instead of sixteen). Gated by the
 * output-equivalence harness against getSituationFullLoad.
 */
export async function getSituation(p: Persistence, actor: Actor): Promise<SituationView> {
  assertViewApprovals(actor); // operational surface: owner/operations
  assertReadAgreements(actor); // both operational roles hold it; fail closed regardless
  const registers = await p.reads.forActor(actor).batch((r) => loadSituationRegisters(r));
  return assembleSituationView(p, actor, registers);
}

/**
 * The full-load reference path — one transaction per register, exactly the
 * pre-L-05b behavior. This is the equivalence harness's truth oracle
 * (packages/persistence/test/l05b.test.ts); it is not called in production.
 */
export async function getSituationFullLoad(p: Persistence, actor: Actor): Promise<SituationView> {
  assertViewApprovals(actor);
  assertReadAgreements(actor);
  const registers = await loadSituationRegisters(p.reads.forActor(actor));
  return assembleSituationView(p, actor, registers);
}

async function assembleSituationView(p: Persistence, actor: Actor, registers: SituationRegisters): Promise<SituationView> {
  const [people, credentials, agreements, missions, participants, approvals, journeys, members, missionLines, invoices, teams, teamMemberships, distributions, claims, delegations, departures] = registers;

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
    distributions,
    claims: claims.map((c) => ({ claimId: c.claimId, submittedBy: c.submittedBy, status: c.status, createdAt: c.createdAt })),
    delegations: delegations.map((d) => ({ delegationId: d.delegationId, granteeIdentity: d.granteeIdentity, startsOn: d.startsOn, endsOn: d.endsOn, revokedAt: d.revokedAt })),
    participants,
    approvals: approvals.map((a) => ({
      approvalId: a.approvalId,
      operationType: a.operationType,
      status: a.status,
      submittedBy: a.submittedBy,
      submittedAt: a.submittedAt,
      targetId: a.targetId,
      targetPersonId: a.targetPersonId,
      // Track B1: the fix-and-resend check's clock + silencer.
      reviewedAt: a.reviewedAt,
      supersededBy: a.supersededBy,
    })),
    journeys: journeys.map((j) => ({
      journeyId: j.journeyId,
      personId: j.personId,
      journeyType: j.journeyType,
      status: j.status,
      updatedAt: j.updatedAt,
    })),
    departures: departures.map((d) => ({ personId: d.personId, status: d.status })),
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

  // S10: the crossing sweep — every operational member gets the attention
  // row ONCE per condition (dedupe by signal key). Best-effort by design.
  const operationalRecipients = members.filter((m) => m.isActive && (m.role === 'owner' || m.role === 'operations')).map((m) => m.email);
  await sweepSignalNotifications(p, actor, signals, operationalRecipients);

  return { todayIso, signals, checks: SITUATION_CHECKS, counts };
}
