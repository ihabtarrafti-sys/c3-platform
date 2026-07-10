/**
 * situation.ts — the Situation Room signal engine (Sprint 43; design:
 * docs/design/S43-situation-room.md).
 *
 * A DECISION ENGINE, not a data display: cross-domain STORY signals, each
 * carrying its reasoning (printed, human-readable, with exact numbers) and
 * its suggested next actions. Everything here is PURE derivation over a
 * snapshot — no scheduler, no stored flags, nothing to go stale or lie (the
 * credentialStatusOn doctrine, generalized).
 *
 * Priority is EXPLAINABLE and deterministic: score = impact × urgency, both
 * 0–3, components surfaced on the signal. No black box. A signal whose fix is
 * already pending (a matching open approval) demotes to "in motion" — the
 * queue never nags about what's already being handled.
 *
 * Role composition happens in the APPLICATION read model (agreement signals
 * only for canReadAgreements; pipeline signals for approval-viewing roles);
 * the engine composes the full truthful picture.
 */

import { agreementRenewalStateOn } from './agreement';
import { credentialStatusOn } from './credential';
import { PENDING_STATUSES, type ApprovalStatus } from './lifecycle';
import { formatMoney, type CurrencyCode } from './money';
import type { OperationType } from './approval';

// ── snapshot input (slim picks; the read model assembles these) ─────────────

export interface SituationSnapshot {
  readonly todayIso: string;
  /** Identities of the org's ACTIVE owners (for wedge detection). */
  readonly ownerIdentities: readonly string[];
  readonly people: ReadonlyArray<{ personId: string; fullName: string; isActive: boolean }>;
  readonly credentials: ReadonlyArray<{
    credentialId: string;
    personId: string;
    credentialType: string;
    expiresOn: string | null;
    isActive: boolean;
  }>;
  /** Financial-free by design: signals never need the value. */
  readonly agreements: ReadonlyArray<{
    agreementId: string;
    /** Null = entity-level agreement (no owning person). */
    personId: string | null;
    agreementType: string;
    endsOn: string;
    status: 'Active' | 'Terminated';
  }>;
  readonly missions: ReadonlyArray<{
    missionId: string;
    name: string;
    startsOn: string;
    endsOn: string | null;
    isActive: boolean;
    /** S2 finance stage — the money signals fire in PostMission only. */
    financeStage: string;
  }>;
  /**
   * S6 settlement signals. Amounts ARE printed in these reasons — the money
   * is the signal's subject, and the cockpit is owner/operations-gated (both
   * hold financial visibility). Lines ride slim: income lines only matter.
   */
  readonly missionLines: ReadonlyArray<{
    lineId: string;
    missionId: string;
    direction: string;
    category: string;
    label: string;
    amountMinor: number;
    currency: string;
    paymentStatus: string | null;
    isActive: boolean;
  }>;
  /** Live invoices, for naming the paper in payment-chase reasons. */
  readonly invoices: ReadonlyArray<{ invoiceNumber: string; lineId: string; status: string }>;
  /** S7 teams: game divisions must field a roster; departments are exempt. */
  readonly teams: ReadonlyArray<{ teamId: string; name: string; code: string; kind: string; isActive: boolean }>;
  readonly teamMemberships: ReadonlyArray<{ teamId: string; personId: string; isActive: boolean }>;
  readonly participants: ReadonlyArray<{ missionId: string; personId: string; role: string; isActive: boolean }>;
  readonly approvals: ReadonlyArray<{
    approvalId: string;
    operationType: OperationType;
    status: ApprovalStatus;
    submittedBy: string;
    submittedAt: string;
    targetId: string | null;
    targetPersonId: string;
  }>;
  readonly journeys: ReadonlyArray<{ journeyId: string; personId: string; journeyType: string; status: string; updatedAt: string }>;
}

// ── signal shape ─────────────────────────────────────────────────────────────

export const SIGNAL_KINDS = [
  'MissionReadiness',
  'CredentialExpiry',
  'AgreementWindow',
  'ApprovalStale',
  'ExecutionFailedRecovery',
  'OwnerWedge',
  'JourneyStalled',
  'IncomeNotInvoiced',
  'PaymentOutstanding',
  'TeamUnstaffed',
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type SignalBand = 'immediate' | 'attention' | 'watch' | 'inMotion';

export interface SuggestedAction {
  readonly kind:
    | 'AddCredential'
    | 'RenewAgreement'
    | 'ReviewApproval'
    | 'ResubmitOrExecute'
    | 'WithdrawOwnRequest'
    | 'ViewMission'
    | 'ViewPerson'
    | 'ViewAgreement'
    | 'ViewApproval'
    | 'ViewJourney';
  readonly personId?: string;
  readonly missionId?: string;
  readonly agreementId?: string;
  readonly approvalId?: string;
  readonly journeyId?: string;
}

export interface Signal {
  /** Stable identity for a signal instance (kind + subject), for tests/UI keys. */
  readonly key: string;
  readonly kind: SignalKind;
  readonly headline: string;
  /** The printed reasoning — exact numbers, human sentences. */
  readonly reasons: readonly string[];
  /** 0–3; what breaks if ignored (mission-blocking/governance = 3, money = 2, hygiene = 1). */
  readonly impact: number;
  /** 0–3; how soon it bites (≤7d = 3, ≤30d = 2, ≤90d = 1, else 0). */
  readonly urgency: number;
  /** impact × urgency — deterministic, explainable. */
  readonly score: number;
  readonly band: SignalBand;
  /** True when a matching open approval is already addressing it. */
  readonly inMotion: boolean;
  readonly actions: readonly SuggestedAction[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Whole days from today to date (negative = past). ISO-safe via UTC. */
export function daysUntil(todayIso: string, dateIso: string): number {
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const [y, m, d] = dateIso.split('-').map(Number);
  return Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(ty!, tm! - 1, td!)) / 86_400_000);
}

function urgencyFromDays(days: number): number {
  if (days <= 7) return 3;
  if (days <= 30) return 2;
  if (days <= 90) return 1;
  return 0;
}

function band(score: number, inMotion: boolean): SignalBand {
  if (inMotion) return 'inMotion';
  if (score >= 6) return 'immediate';
  if (score >= 3) return 'attention';
  return 'watch';
}

function make(
  partial: Omit<Signal, 'score' | 'band'>,
): Signal {
  const score = partial.impact * partial.urgency;
  return { ...partial, score, band: band(score, partial.inMotion) };
}

const OPEN: readonly ApprovalStatus[] = PENDING_STATUSES;

// ── mission readiness (the flagship cross-domain derivation) ─────────────────

export interface ReadinessGap {
  readonly reason: string;
  readonly personId?: string;
}

/**
 * A mission is READY when it has an active roster and no active participant's
 * existing credential or agreement coverage lapses before the mission window
 * closes. Absence of records is never claimed as a gap (we only reason about
 * what exists); the gaps carry printed reasons with exact numbers.
 */
export function missionReadinessOn(
  mission: SituationSnapshot['missions'][number],
  snapshot: SituationSnapshot,
): { ready: boolean; gaps: ReadinessGap[] } {
  const gaps: ReadinessGap[] = [];
  const roster = snapshot.participants.filter((p) => p.missionId === mission.missionId && p.isActive);
  if (roster.length === 0) {
    gaps.push({ reason: 'No active participants on the roster' });
  }
  const missionEnd = mission.endsOn ?? mission.startsOn;
  for (const member of roster) {
    const name = snapshot.people.find((p) => p.personId === member.personId)?.fullName ?? member.personId;
    for (const c of snapshot.credentials.filter((c) => c.personId === member.personId && c.isActive && c.expiresOn !== null)) {
      if (c.expiresOn! < missionEnd) {
        const days = daysUntil(snapshot.todayIso, c.expiresOn!);
        gaps.push({
          personId: member.personId,
          reason:
            days < 0
              ? `${name} — ${c.credentialType} expired ${-days} day${-days === 1 ? '' : 's'} ago`
              : `${name} — ${c.credentialType} expires in ${days} day${days === 1 ? '' : 's'}, before the mission ends`,
        });
      }
    }
    const personAgreements = snapshot.agreements.filter((a) => a.personId === member.personId);
    if (personAgreements.length > 0) {
      const covered = personAgreements.some((a) => a.status === 'Active' && a.endsOn >= missionEnd);
      if (!covered) {
        gaps.push({ personId: member.personId, reason: `${name} — no active agreement covers the mission window` });
      }
    }
  }
  return { ready: gaps.length === 0, gaps };
}

// ── the engine ───────────────────────────────────────────────────────────────

export function composeSituation(snapshot: SituationSnapshot): Signal[] {
  const signals: Signal[] = [];
  const today = snapshot.todayIso;
  const open = snapshot.approvals.filter((a) => OPEN.includes(a.status));

  const activeMissionsOf = (personId: string): SituationSnapshot['missions'] =>
    snapshot.missions.filter(
      (m) => m.isActive && snapshot.participants.some((p) => p.missionId === m.missionId && p.personId === personId && p.isActive),
    );

  // 1 — Mission readiness (active, upcoming-or-running missions only).
  //     A mission whose window already CLOSED is out of readiness scope —
  //     rosters and coverage are moot once the event is over (S6: ended
  //     missions live on in PostMission for settlement; the money signals
  //     below own that phase).
  for (const mission of snapshot.missions.filter((m) => m.isActive)) {
    if (mission.endsOn !== null && mission.endsOn < today) continue;
    const { ready, gaps } = missionReadinessOn(mission, snapshot);
    if (ready) continue;
    const startsIn = daysUntil(today, mission.startsOn);
    if (startsIn > 90) continue; // beyond the watch horizon
    const inMotion =
      gaps.length > 0 &&
      gaps.every(
        (g) =>
          g.personId !== undefined &&
          open.some(
            (a) =>
              (a.operationType === 'AddCredential' || a.operationType === 'RenewAgreement') && a.targetPersonId === g.personId,
          ),
      );
    signals.push(
      make({
        key: `MissionReadiness:${mission.missionId}`,
        kind: 'MissionReadiness',
        headline:
          startsIn >= 0
            ? `${mission.missionId} "${mission.name}" starts in ${startsIn} day${startsIn === 1 ? '' : 's'} and is not ready`
            : `${mission.missionId} "${mission.name}" is running and not ready`,
        reasons: gaps.map((g) => g.reason),
        impact: 3,
        urgency: startsIn >= 0 ? urgencyFromDays(startsIn) : 3,
        inMotion,
        actions: [
          { kind: 'ViewMission', missionId: mission.missionId },
          ...gaps.filter((g) => g.personId).map((g) => ({ kind: 'ViewPerson', personId: g.personId } as SuggestedAction)),
        ],
      }),
    );
  }

  // 2 — Credential expiry (active credentials with an expiry inside 90 days
  //     or already past; impact rises when it blocks an active mission).
  for (const c of snapshot.credentials.filter((c) => c.isActive && c.expiresOn !== null)) {
    const status = credentialStatusOn({ isActive: c.isActive, expiresOn: c.expiresOn }, today, 90);
    if (status !== 'Expired' && status !== 'ExpiresSoon') continue;
    const days = daysUntil(today, c.expiresOn!);
    const name = snapshot.people.find((p) => p.personId === c.personId)?.fullName ?? c.personId;
    const missions = activeMissionsOf(c.personId);
    const blocking = missions.length > 0;
    const inMotion = open.some((a) => a.operationType === 'AddCredential' && a.targetPersonId === c.personId);
    signals.push(
      make({
        key: `CredentialExpiry:${c.credentialId}`,
        kind: 'CredentialExpiry',
        headline:
          status === 'Expired'
            ? `${name}'s ${c.credentialType} has expired`
            : `${name}'s ${c.credentialType} expires in ${days} day${days === 1 ? '' : 's'}`,
        reasons: [
          status === 'Expired' ? `Expired ${-days} day${-days === 1 ? '' : 's'} ago` : `Expires in ${days} day${days === 1 ? '' : 's'}`,
          ...(blocking ? missions.map((m) => `${name} is on the active roster of ${m.missionId} "${m.name}"`) : []),
          ...(inMotion ? ['A replacement credential request is already pending'] : ['No replacement request is pending']),
        ],
        impact: blocking ? 3 : 1,
        urgency: status === 'Expired' ? 3 : urgencyFromDays(days),
        inMotion,
        actions: [
          { kind: 'AddCredential', personId: c.personId },
          { kind: 'ViewPerson', personId: c.personId },
        ],
      }),
    );
  }

  // 3 — Agreement windows (the CP Renewals center, reasoned and actionable).
  // Entity-level agreements (no person) get an org-voice headline and no
  // roster reasoning — there is no person to be rostered.
  for (const a of snapshot.agreements) {
    const state = agreementRenewalStateOn({ status: a.status, endsOn: a.endsOn }, today);
    if (state === 'Active' || state === 'Terminated') continue;
    const days = daysUntil(today, a.endsOn);
    const name = a.personId === null ? null : (snapshot.people.find((p) => p.personId === a.personId)?.fullName ?? a.personId);
    const subject = name === null ? `The ${a.agreementType} (${a.agreementId})` : `${name}'s ${a.agreementType} (${a.agreementId})`;
    const missions = a.personId === null ? [] : activeMissionsOf(a.personId);
    const inMotion = open.some(
      (o) => (o.operationType === 'RenewAgreement' || o.operationType === 'TerminateAgreement') && o.targetId === a.agreementId,
    );
    signals.push(
      make({
        key: `AgreementWindow:${a.agreementId}`,
        kind: 'AgreementWindow',
        headline:
          state === 'Expired'
            ? `${subject} has expired`
            : `${subject} ends in ${days} day${days === 1 ? '' : 's'}`,
        reasons: [
          state === 'Expired' ? `Ended ${-days} day${-days === 1 ? '' : 's'} ago` : `Renewal window: ${state.replace('Due', 'due within ')} days`,
          ...missions.map((m) => `${name} is on the active roster of ${m.missionId} "${m.name}"`),
          ...(inMotion ? ['A renewal or termination request is already pending'] : ['No renewal request is pending']),
        ],
        impact: missions.length > 0 ? 3 : state === 'Expired' || state === 'Due30' ? 2 : 1,
        urgency: state === 'Expired' ? 3 : urgencyFromDays(days),
        inMotion,
        actions: [
          { kind: 'RenewAgreement', agreementId: a.agreementId, ...(a.personId !== null ? { personId: a.personId } : {}) },
          { kind: 'ViewAgreement', agreementId: a.agreementId },
        ],
      }),
    );
  }

  // 4 — Pipeline health: stale open approvals, recoverable failures, THE WEDGE.
  for (const a of open) {
    const ageDays = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(a.submittedAt)) / 86_400_000);
    const soleOwnerWedge =
      snapshot.ownerIdentities.length === 1 &&
      snapshot.ownerIdentities[0] !== undefined &&
      a.submittedBy.trim().toLowerCase() === snapshot.ownerIdentities[0].trim().toLowerCase() &&
      (a.status === 'Submitted' || a.status === 'InReview');
    if (soleOwnerWedge) {
      signals.push(
        make({
          key: `OwnerWedge:${a.approvalId}`,
          kind: 'OwnerWedge',
          headline: `${a.approvalId} cannot be decided: its submitter is the organization's only owner`,
          reasons: [
            'The submitter may not review or execute their own request, and no other owner exists',
            'It can be withdrawn by the submitter, or a second owner can be provisioned',
          ],
          impact: 3,
          urgency: 3,
          inMotion: false,
          actions: [
            { kind: 'WithdrawOwnRequest', approvalId: a.approvalId },
            { kind: 'ViewApproval', approvalId: a.approvalId },
          ],
        }),
      );
      continue; // the wedge subsumes staleness
    }
    if (ageDays >= 3) {
      signals.push(
        make({
          key: `ApprovalStale:${a.approvalId}`,
          kind: 'ApprovalStale',
          headline: `${a.approvalId} (${a.operationType}) has waited ${ageDays} days for a decision`,
          reasons: [`Submitted ${ageDays} days ago by ${a.submittedBy}`, `Status: ${a.status}`],
          impact: 2,
          urgency: ageDays >= 7 ? 3 : 2,
          inMotion: false,
          actions: [{ kind: 'ReviewApproval', approvalId: a.approvalId }],
        }),
      );
    }
  }
  for (const a of snapshot.approvals.filter((x) => x.status === 'ExecutionFailed')) {
    signals.push(
      make({
        key: `ExecutionFailedRecovery:${a.approvalId}`,
        kind: 'ExecutionFailedRecovery',
        headline: `${a.approvalId} (${a.operationType}) failed execution and awaits recovery`,
        reasons: ['Execution failed truthfully with no partial change', 'Retry the execution or resubmit the request'],
        impact: 2,
        urgency: 2,
        inMotion: false,
        actions: [{ kind: 'ResubmitOrExecute', approvalId: a.approvalId }],
      }),
    );
  }

  // 5 — Settlement blockers (S6, per the signals-ship-with-features law).
  //     Both fire ONLY in PostMission: the event ended, the money is
  //     unfinished, and →Settled demands every income line Received. These
  //     are the two blocker kinds, enumerated: not yet invoiced, and
  //     invoiced-but-unpaid. Invoicing is direct (no approval), so neither
  //     ever demotes to in-motion.
  for (const mission of snapshot.missions.filter((m) => m.isActive && m.financeStage === 'PostMission')) {
    const income = snapshot.missionLines.filter((l) => l.missionId === mission.missionId && l.isActive && l.direction === 'Income');
    const endedDays = mission.endsOn ? -daysUntil(today, mission.endsOn) : null;
    const endedText = endedDays !== null && endedDays > 0 ? `ended ${endedDays} day${endedDays === 1 ? '' : 's'} ago` : 'is post-mission';

    const notInvoiced = income.filter((l) => l.paymentStatus === 'Expected');
    if (notInvoiced.length > 0) {
      signals.push(
        make({
          key: `IncomeNotInvoiced:${mission.missionId}`,
          kind: 'IncomeNotInvoiced',
          headline: `${mission.missionId} "${mission.name}" ${endedText} with ${notInvoiced.length} income line${notInvoiced.length === 1 ? '' : 's'} not yet invoiced`,
          reasons: [
            ...notInvoiced.map((l) => `${l.category} — ${l.label}: ${formatMoney(l.amountMinor, l.currency as CurrencyCode)} still Expected`),
            'The mission cannot settle until every income line is Received — invoice first, then chase.',
          ],
          impact: 2,
          urgency: 3,
          inMotion: false,
          actions: [{ kind: 'ViewMission', missionId: mission.missionId }],
        }),
      );
    }

    const outstanding = income.filter((l) => l.paymentStatus === 'Invoiced');
    if (outstanding.length > 0) {
      const liveInvoiceOf = (lineId: string): string | null =>
        snapshot.invoices.find((i) => i.lineId === lineId && i.status === 'Issued')?.invoiceNumber ?? null;
      const chaseUrgency = endedDays !== null && endedDays >= 14 ? 3 : 2;
      signals.push(
        make({
          key: `PaymentOutstanding:${mission.missionId}`,
          kind: 'PaymentOutstanding',
          headline: `${mission.missionId} "${mission.name}" has ${outstanding.length} invoiced payment${outstanding.length === 1 ? '' : 's'} outstanding`,
          reasons: [
            ...outstanding.map((l) => {
              const inv = liveInvoiceOf(l.lineId);
              return `${l.category} — ${l.label}: ${formatMoney(l.amountMinor, l.currency as CurrencyCode)} invoiced${inv ? ` (${inv})` : ''}, not received`;
            }),
            endedDays !== null && endedDays >= 14
              ? `The mission ${endedText} — chase the counterparty.`
              : 'Record the receipt on the line when the money lands.',
          ],
          impact: 2,
          urgency: chaseUrgency,
          inMotion: false,
          actions: [{ kind: 'ViewMission', missionId: mission.missionId }],
        }),
      );
    }
  }

  // 6 — Team hygiene (S7): an ACTIVE game division with no active members is
  //     a structure that fields nothing — watch-band, never noisy. Departments
  //     are exempt (staff structure isn't "fielded").
  for (const team of snapshot.teams.filter((t) => t.isActive && t.kind === 'GameDivision')) {
    const roster = snapshot.teamMemberships.filter((m) => m.teamId === team.teamId && m.isActive);
    if (roster.length > 0) continue;
    signals.push(
      make({
        key: `TeamUnstaffed:${team.teamId}`,
        kind: 'TeamUnstaffed',
        headline: `${team.code} "${team.name}" has no active members`,
        reasons: ['An active game division with an empty roster', 'Add members, or deactivate the division if it is not being fielded'],
        impact: 1,
        urgency: 1,
        inMotion: false,
        actions: [],
      }),
    );
  }

  // 7 — Journey drift: suspended and untouched for 14+ days.
  for (const j of snapshot.journeys.filter((j) => j.status === 'Suspended')) {
    const idleDays = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(j.updatedAt)) / 86_400_000);
    if (idleDays < 14) continue;
    const name = snapshot.people.find((p) => p.personId === j.personId)?.fullName ?? j.personId;
    signals.push(
      make({
        key: `JourneyStalled:${j.journeyId}`,
        kind: 'JourneyStalled',
        headline: `${name}'s ${j.journeyType} journey has been suspended for ${idleDays} days`,
        reasons: [`Suspended and untouched since ${j.updatedAt.slice(0, 10)}`, 'Resume, complete, or cancel it'],
        impact: 1,
        urgency: idleDays >= 30 ? 2 : 1,
        inMotion: false,
        actions: [
          { kind: 'ViewJourney', journeyId: j.journeyId },
          { kind: 'ViewPerson', personId: j.personId },
        ],
      }),
    );
  }

  // Deterministic order: live urgency first, in-motion last, then score, then key.
  return signals.sort((x, y) => {
    if (x.inMotion !== y.inMotion) return x.inMotion ? 1 : -1;
    if (y.score !== x.score) return y.score - x.score;
    return x.key.localeCompare(y.key);
  });
}

/** The honest all-clear: what WAS checked, enumerated (silence ≠ blindness). */
export const SITUATION_CHECKS: readonly string[] = [
  'Mission readiness (rosters, credential and agreement coverage across mission windows)',
  'Credential expiry within 90 days, joined against active mission rosters',
  'Agreement renewal windows (30/60/90) and expiry, joined against active mission rosters',
  'Approvals awaiting a decision for 3+ days',
  'Failed executions awaiting recovery',
  'Sole-owner governance wedges',
  'Journeys suspended for 14+ days',
  'Post-mission income not yet invoiced (settlement blocker)',
  'Invoiced payments still outstanding post-mission (settlement blocker)',
  'Active game divisions with no active roster',
];

/**
 * Which signal kind each SITUATION_CHECKS line reports on (index-aligned).
 * The cockpit's always-on check ledger derives each line's state from the
 * live signals — firing (immediate/attention), watching (watch), in motion
 * (matching pending request), or clear. Same engine, no second source.
 */
export const SITUATION_CHECK_KINDS: readonly SignalKind[] = [
  'MissionReadiness',
  'CredentialExpiry',
  'AgreementWindow',
  'ApprovalStale',
  'ExecutionFailedRecovery',
  'OwnerWedge',
  'JourneyStalled',
  'IncomeNotInvoiced',
  'PaymentOutstanding',
  'TeamUnstaffed',
];
