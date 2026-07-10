/**
 * situation.test.ts — Sprint 43 Q1 evidence: the signal engine. The matrix
 * proves the flagship cross-domain story (credential × mission window ×
 * agreement coverage), explainable scoring with printed exact-number reasons,
 * in-motion demotion, wedge detection, and deterministic ordering — all pure.
 */
import { describe, it, expect } from 'vitest';
import {
  composeSituation,
  daysUntil,
  formatMoney,
  missionReadinessOn,
  SITUATION_CHECKS,
  SITUATION_CHECK_KINDS,
  type SituationSnapshot,
} from '../src/index';

const TODAY = '2026-08-01';

function snapshot(overrides: Partial<SituationSnapshot> = {}): SituationSnapshot {
  return {
    todayIso: TODAY,
    ownerIdentities: ['owner@a.com'],
    people: [{ personId: 'PER-0001', fullName: 'Jordan Reyes', isActive: true }],
    credentials: [],
    agreements: [],
    missions: [],
    missionLines: [],
    invoices: [],
    teams: [],
    teamMemberships: [],
    distributions: [],
    claims: [],
    delegations: [],
    participants: [],
    approvals: [],
    journeys: [],
    ...overrides,
  };
}

describe('daysUntil', () => {
  it('counts whole days, negative for the past', () => {
    expect(daysUntil(TODAY, '2026-08-10')).toBe(9);
    expect(daysUntil(TODAY, '2026-08-01')).toBe(0);
    expect(daysUntil(TODAY, '2026-07-29')).toBe(-3);
  });
});

describe('missionReadinessOn', () => {
  const mission = { missionId: 'MSN-0001', name: 'Spring Invitational', startsOn: '2026-08-13', endsOn: '2026-08-20', isActive: true, financeStage: 'Planning' };

  it('ready when the roster is active and coverage spans the window; absence of records is never a gap', () => {
    const s = snapshot({
      missions: [mission],
      participants: [{ missionId: 'MSN-0001', personId: 'PER-0001', role: 'Player', isActive: true }],
      // No credentials and no agreements AT ALL: nothing lapses → no gap claimed.
    });
    expect(missionReadinessOn(mission, s)).toEqual({ ready: true, gaps: [] });
  });

  it('a mission whose window already closed is out of readiness scope (settlement signals own that phase)', () => {
    const ended = { ...mission, startsOn: '2026-07-01', endsOn: '2026-07-20', financeStage: 'PostMission' };
    // Empty roster would be a gap — but the event is over; readiness is moot.
    expect(composeSituation(snapshot({ missions: [ended] })).filter((s) => s.kind === 'MissionReadiness')).toHaveLength(0);
  });

  it('gaps: empty roster; credential lapsing before mission end (exact-day reason); uncovered agreement window', () => {
    const empty = missionReadinessOn(mission, snapshot({ missions: [mission] }));
    expect(empty.ready).toBe(false);
    expect(empty.gaps[0]!.reason).toMatch(/No active participants/);

    const s = snapshot({
      missions: [mission],
      participants: [{ missionId: 'MSN-0001', personId: 'PER-0001', role: 'Player', isActive: true }],
      credentials: [{ credentialId: 'CRED-0001', personId: 'PER-0001', credentialType: 'Coaching License', expiresOn: '2026-08-10', isActive: true }],
      agreements: [{ agreementId: 'AGR-0001', personId: 'PER-0001', agreementType: 'Player Contract', endsOn: '2026-08-15', status: 'Active' }],
    });
    const r = missionReadinessOn(mission, s);
    expect(r.ready).toBe(false);
    expect(r.gaps.map((g) => g.reason)).toEqual([
      'Jordan Reyes — Coaching License expires in 9 days, before the mission ends',
      'Jordan Reyes — no active agreement covers the mission window',
    ]);
  });
});

describe('the flagship cross-domain story', () => {
  const base = snapshot({
    missions: [{ missionId: 'MSN-0001', name: 'Spring Invitational', startsOn: '2026-08-13', endsOn: '2026-08-20', isActive: true, financeStage: 'Planning' }],
    participants: [{ missionId: 'MSN-0001', personId: 'PER-0001', role: 'Player', isActive: true }],
    credentials: [{ credentialId: 'CRED-0001', personId: 'PER-0001', credentialType: 'Coaching License', expiresOn: '2026-08-10', isActive: true }],
  });

  it('mission-not-ready and blocking-credential signals, both immediate, with the mission named in the reasoning', () => {
    const signals = composeSituation(base);
    const readiness = signals.find((s) => s.kind === 'MissionReadiness')!;
    expect(readiness.headline).toBe('MSN-0001 "Spring Invitational" starts in 12 days and is not ready');
    expect(readiness).toMatchObject({ impact: 3, urgency: 2, score: 6, band: 'immediate', inMotion: false });

    const cred = signals.find((s) => s.kind === 'CredentialExpiry')!;
    expect(cred.headline).toBe("Jordan Reyes's Coaching License expires in 9 days");
    expect(cred.reasons).toContain('Jordan Reyes is on the active roster of MSN-0001 "Spring Invitational"');
    expect(cred.reasons).toContain('No replacement request is pending');
    expect(cred).toMatchObject({ impact: 3, urgency: 2, score: 6, band: 'immediate' }); // 9 days = the ≤30 band
    expect(cred.actions[0]).toEqual({ kind: 'AddCredential', personId: 'PER-0001' });
  });

  it('in-motion demotion: a pending AddCredential for the person demotes BOTH signals and sorts them last', () => {
    const withFix = {
      ...base,
      approvals: [
        {
          approvalId: 'APR-0001',
          operationType: 'AddCredential' as const,
          status: 'Submitted' as const,
          submittedBy: 'ops@a.com',
          submittedAt: '2026-08-01T00:00:00.000Z',
          targetId: null,
          targetPersonId: 'PER-0001',
        },
      ],
    };
    const signals = composeSituation(withFix);
    const cred = signals.find((s) => s.kind === 'CredentialExpiry')!;
    expect(cred.band).toBe('inMotion');
    expect(cred.reasons).toContain('A replacement credential request is already pending');
    const readiness = signals.find((s) => s.kind === 'MissionReadiness')!;
    expect(readiness.band).toBe('inMotion');
    // In-motion signals sort after live ones (here everything is in motion, so both trail nothing).
    expect(signals.every((s) => s.band === 'inMotion')).toBe(true);
  });
});

describe('agreement windows', () => {
  it('scores by window and mission involvement; expired demands action; pending renewal demotes', () => {
    const s = snapshot({
      agreements: [
        { agreementId: 'AGR-0001', personId: 'PER-0001', agreementType: 'NDA', endsOn: '2026-09-15', status: 'Active' }, // Due60
        { agreementId: 'AGR-0002', personId: 'PER-0001', agreementType: 'Player Contract', endsOn: '2026-07-20', status: 'Active' }, // Expired
      ],
    });
    const signals = composeSituation(s);
    const due60 = signals.find((x) => x.key === 'AgreementWindow:AGR-0001')!;
    expect(due60).toMatchObject({ impact: 1, urgency: 1, band: 'watch' });
    const expired = signals.find((x) => x.key === 'AgreementWindow:AGR-0002')!;
    expect(expired.headline).toMatch(/has expired/);
    expect(expired).toMatchObject({ impact: 2, urgency: 3, score: 6, band: 'immediate' });

    const demoted = composeSituation({
      ...s,
      approvals: [
        {
          approvalId: 'APR-0009',
          operationType: 'RenewAgreement',
          status: 'InReview',
          submittedBy: 'ops@a.com',
          submittedAt: '2026-08-01T00:00:00.000Z',
          targetId: 'AGR-0002',
          targetPersonId: 'PER-0001',
        },
      ],
    });
    expect(demoted.find((x) => x.key === 'AgreementWindow:AGR-0002')!.band).toBe('inMotion');
  });
});

describe('pipeline health', () => {
  const openApproval = (submittedBy: string, ageDays: number) => ({
    approvalId: 'APR-0042',
    operationType: 'AddPerson' as const,
    status: 'Submitted' as const,
    submittedBy,
    submittedAt: new Date(Date.parse(TODAY + 'T00:00:00Z') - ageDays * 86_400_000).toISOString(),
    targetId: null,
    targetPersonId: 'PENDING-ADDPERSON',
  });

  it('THE WEDGE: a sole owner self-submitting is immediate and subsumes staleness; two owners = no wedge', () => {
    const wedged = composeSituation(snapshot({ approvals: [openApproval('owner@a.com', 5)] }));
    expect(wedged).toHaveLength(1);
    expect(wedged[0]).toMatchObject({ kind: 'OwnerWedge', band: 'immediate', score: 9 });
    expect(wedged[0]!.reasons[1]).toMatch(/withdrawn by the submitter, or a second owner/);

    const twoOwners = composeSituation(
      snapshot({ ownerIdentities: ['owner@a.com', 'second@a.com'], approvals: [openApproval('owner@a.com', 5)] }),
    );
    expect(twoOwners[0]).toMatchObject({ kind: 'ApprovalStale' });
    expect(twoOwners[0]!.headline).toMatch(/waited 5 days/);
  });

  it('fresh approvals are quiet; ExecutionFailed always surfaces a recovery signal', () => {
    expect(composeSituation(snapshot({ approvals: [openApproval('ops@a.com', 1)] }))).toHaveLength(0);
    const failed = composeSituation(
      snapshot({
        approvals: [{ ...openApproval('ops@a.com', 1), status: 'ExecutionFailed' as const }],
      }),
    );
    expect(failed[0]).toMatchObject({ kind: 'ExecutionFailedRecovery', impact: 2, urgency: 2 });
  });
});

describe('journey drift + ordering + the honest all-clear', () => {
  it('suspended 14+ days surfaces; fresher suspensions are quiet', () => {
    const journey = (idleDays: number) => ({
      journeyId: 'JRN-0001',
      personId: 'PER-0001',
      journeyType: 'Onboarding',
      status: 'Suspended',
      updatedAt: new Date(Date.parse(TODAY + 'T00:00:00Z') - idleDays * 86_400_000).toISOString(),
    });
    expect(composeSituation(snapshot({ journeys: [journey(20)] }))[0]).toMatchObject({ kind: 'JourneyStalled' });
    expect(composeSituation(snapshot({ journeys: [journey(5)] }))).toHaveLength(0);
  });

  it('deterministic ordering: live before in-motion, then score desc, then key', () => {
    const s = snapshot({
      agreements: [
        { agreementId: 'AGR-0001', personId: 'PER-0001', agreementType: 'NDA', endsOn: '2026-09-15', status: 'Active' }, // watch (live)
        { agreementId: 'AGR-0002', personId: 'PER-0001', agreementType: 'Contract', endsOn: '2026-07-20', status: 'Active' }, // immediate but in motion
      ],
      approvals: [
        {
          approvalId: 'APR-0002',
          operationType: 'RenewAgreement',
          status: 'Submitted',
          submittedBy: 'ops@a.com',
          submittedAt: TODAY + 'T00:00:00.000Z',
          targetId: 'AGR-0002',
          targetPersonId: 'PER-0001',
        },
      ],
    });
    const keys = composeSituation(s).map((x) => x.key);
    expect(keys).toEqual(['AgreementWindow:AGR-0001', 'AgreementWindow:AGR-0002']); // live watch first, in-motion last
  });

  it('the all-clear enumerates its checks (silence is provably not blindness)', () => {
    expect(composeSituation(snapshot())).toHaveLength(0);
    expect(SITUATION_CHECKS.length).toBeGreaterThanOrEqual(7);
    expect(SITUATION_CHECKS.join(' ')).toMatch(/wedge/i);
  });

  it('the check ledger stays index-aligned: one description per check kind', () => {
    // The cockpit zips SITUATION_CHECKS with SITUATION_CHECK_KINDS by index —
    // a new kind without its description silently drops off the ledger.
    expect(SITUATION_CHECKS.length).toBe(SITUATION_CHECK_KINDS.length);
  });
});

describe('team hygiene (S7): unstaffed game divisions', () => {
  const team = (kind: string, isActive = true) => ({ teamId: 'TEAM-0001', name: 'Rainbow Six', code: 'R6', kind, isActive });

  it('an active GameDivision with no active members is a watch signal; departments and staffed teams are quiet', () => {
    const unstaffed = composeSituation(snapshot({ teams: [team('GameDivision')] }));
    expect(unstaffed).toHaveLength(1);
    expect(unstaffed[0]).toMatchObject({ kind: 'TeamUnstaffed', impact: 1, urgency: 1, band: 'watch' });
    expect(unstaffed[0]!.headline).toBe('R6 "Rainbow Six" has no active members');

    // Staffed → quiet; inactive member only → still unstaffed.
    expect(
      composeSituation(snapshot({ teams: [team('GameDivision')], teamMemberships: [{ teamId: 'TEAM-0001', personId: 'PER-0001', isActive: true }] })),
    ).toHaveLength(0);
    expect(
      composeSituation(snapshot({ teams: [team('GameDivision')], teamMemberships: [{ teamId: 'TEAM-0001', personId: 'PER-0001', isActive: false }] })),
    ).toHaveLength(1);
    // Departments and deactivated divisions are exempt.
    expect(composeSituation(snapshot({ teams: [team('Department')] }))).toHaveLength(0);
    expect(composeSituation(snapshot({ teams: [team('GameDivision', false)] }))).toHaveLength(0);
  });
});

describe('claims waiting (S9)', () => {
  const claim = (status: string, ageDays: number) => ({
    claimId: 'CLM-0001',
    submittedBy: 'hr@a.com',
    status,
    createdAt: new Date(Date.parse(TODAY + 'T00:00:00Z') - ageDays * 86_400_000).toISOString(),
  });

  it('a Submitted/InReview claim ≥3 days old fires; fresh and decided claims stay quiet', () => {
    expect(composeSituation(snapshot({ claims: [claim('Submitted', 4)] }))[0]).toMatchObject({
      kind: 'ClaimsAwaitingReview',
      impact: 2,
      urgency: 2,
      band: 'attention',
    });
    expect(composeSituation(snapshot({ claims: [claim('InReview', 8)] }))[0]).toMatchObject({ urgency: 3, band: 'immediate' });
    expect(composeSituation(snapshot({ claims: [claim('Submitted', 1)] }))).toHaveLength(0);
    expect(composeSituation(snapshot({ claims: [claim('Approved', 30)] }))).toHaveLength(0);
    expect(composeSituation(snapshot({ claims: [claim('Rejected', 30)] }))).toHaveLength(0);
  });
});

describe('settlement blockers (S6): post-mission money signals', () => {
  const pastMission = (financeStage: string, endedDaysAgo: number) => ({
    missionId: 'MSN-0007',
    name: 'Summer Cup',
    startsOn: '2026-07-01',
    endsOn: new Date(Date.parse(TODAY + 'T00:00:00Z') - endedDaysAgo * 86_400_000).toISOString().slice(0, 10),
    isActive: true,
    financeStage,
  });
  const incomeLine = (paymentStatus: string, over: Partial<{ direction: string; isActive: boolean; lineId: string }> = {}) => ({
    lineId: over.lineId ?? 'PNL-0001',
    missionId: 'MSN-0007',
    direction: over.direction ?? 'Income',
    category: 'PrizeMoney',
    label: 'Prize — 2nd place',
    amountMinor: 800000,
    currency: 'USD',
    paymentStatus,
    isActive: over.isActive ?? true,
  });

  it('IncomeNotInvoiced fires ONLY in PostMission, immediate, with the amount printed', () => {
    // Active stage: the mission is running — no nagging yet.
    expect(composeSituation(snapshot({ missions: [pastMission('Active', 2)], missionLines: [incomeLine('Expected')] }))).toHaveLength(0);

    const signals = composeSituation(snapshot({ missions: [pastMission('PostMission', 3)], missionLines: [incomeLine('Expected')] }));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: 'IncomeNotInvoiced', impact: 2, urgency: 3, score: 6, band: 'immediate', inMotion: false });
    expect(signals[0]!.headline).toBe('MSN-0007 "Summer Cup" ended 3 days ago with 1 income line not yet invoiced');
    expect(signals[0]!.reasons[0]).toBe(`PrizeMoney — Prize — 2nd place: ${formatMoney(800000, 'USD')} still Expected`);
    expect(signals[0]!.actions[0]).toEqual({ kind: 'ViewMission', missionId: 'MSN-0007' });
  });

  it('PaymentOutstanding names the live invoice; the chase escalates at 14 days past mission end', () => {
    const fresh = composeSituation(
      snapshot({
        missions: [pastMission('PostMission', 3)],
        missionLines: [incomeLine('Invoiced')],
        invoices: [{ invoiceNumber: 'GKA-INV-2026-001', lineId: 'PNL-0001', status: 'Issued' }],
      }),
    );
    expect(fresh[0]).toMatchObject({ kind: 'PaymentOutstanding', impact: 2, urgency: 2, band: 'attention' });
    expect(fresh[0]!.reasons[0]).toBe(`PrizeMoney — Prize — 2nd place: ${formatMoney(800000, 'USD')} invoiced (GKA-INV-2026-001), not received`);

    const stale = composeSituation(snapshot({ missions: [pastMission('PostMission', 20)], missionLines: [incomeLine('Invoiced')] }));
    expect(stale[0]).toMatchObject({ kind: 'PaymentOutstanding', urgency: 3, score: 6, band: 'immediate' });
    expect(stale[0]!.reasons[0]).toBe(`PrizeMoney — Prize — 2nd place: ${formatMoney(800000, 'USD')} invoiced, not received`); // no live invoice known — no number claimed
    expect(stale[0]!.reasons[1]).toMatch(/chase the counterparty/);
  });

  it('quiet cases: Received lines, expense lines, removed lines, inactive missions', () => {
    expect(composeSituation(snapshot({ missions: [pastMission('PostMission', 3)], missionLines: [incomeLine('Received')] }))).toHaveLength(0);
    expect(
      composeSituation(snapshot({ missions: [pastMission('PostMission', 3)], missionLines: [incomeLine('Expected', { direction: 'Expense' })] })),
    ).toHaveLength(0);
    expect(
      composeSituation(snapshot({ missions: [pastMission('PostMission', 3)], missionLines: [incomeLine('Expected', { isActive: false })] })),
    ).toHaveLength(0);
    expect(
      composeSituation(
        snapshot({ missions: [{ ...pastMission('PostMission', 3), isActive: false }], missionLines: [incomeLine('Expected')] }),
      ),
    ).toHaveLength(0);
  });
});
