/**
 * s30-parity-readiness.mjs
 *
 * Sprint 30 — Mission Readiness Cockpit parity harness.
 *
 * Compiles the ACTUAL production source via esbuild (s27/s28/s29/s29b pattern):
 *   packages/c3/src/utils/missionReadiness.ts        (two-axis readiness model)
 *   packages/c3/src/utils/workItemGenerators/index.ts (zero-roster MissionReadinessGap)
 *   packages/c3/src/protocols/index.ts                (real onboarding protocol)
 *
 * Covers the approved Sprint 30 semantics:
 *   - every MissionStatus lifecycle mapping (ADR-002 preserved)
 *   - Unknown (untrusted source) vs successful empty results
 *   - zero participants (Incomplete; compliance never Clear)
 *   - pending participant exclusion from the active denominator
 *   - Critical → Blocked; High/Medium → AtRisk compliance
 *   - kit participant-coverage denominator (uncovered prevents Fulfilled)
 *   - Delivered/Confirmed fulfillment; Missing → Exception (never Ready)
 *   - overall precedence applied ONLY when Evaluated
 *   - zero-roster work-item window, deterministic ID, dedupe, disappearance,
 *     non-applicable statuses, and MDP mutual exclusion
 *
 * Run: node scripts/s30-parity-readiness.mjs
 */

import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'packages', 'c3', 'src');
const tmp = mkdtempSync(join(tmpdir(), 's30-parity-'));

function compile(entryRel, outName) {
  const outfile = join(tmp, outName);
  buildSync({
    entryPoints: [join(srcRoot, entryRel)],
    bundle: true, format: 'cjs', platform: 'node', outfile,
    logLevel: 'error', alias: { '@c3': srcRoot },
  });
  return require(outfile);
}

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ── Date helpers (midnight-UTC, matching utils/urgency + dateUtils) ─────────
const addDays = (n) => {
  const d = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const mkMission = (id, status, startInDays, endInDays, name = `Mission ${id}`) => ({
  MissionID: id, Name: name, Game: 'Rocket League', Organizer: 'Org',
  Entity: 'UAE', Status: status, Jurisdiction: 'Dubai, UAE',
  Span: { StartDate: addDays(startInDays), EndDate: addDays(endInDays), SettlementDate: addDays(endInDays + 60) },
  CreatedAt: new Date().toISOString(), CreatedBy: 'Test',
});

const mkParticipant = (missionId, personId) => ({
  MissionID: missionId, PersonID: personId, ExternalCode: 'RL/PL/001', Role: 'Player',
});

/** Fully satisfying credential set: EmiratesID (Identity+RightToWork), Visa (Travel). */
const satisfiedCreds = (personId, visaExpiry) => ([
  { CredentialID: `CRED-${personId}-EID`, HolderPersonID: personId, Type: 'EmiratesID', IsActive: true },
  { CredentialID: `CRED-${personId}-VIS`, HolderPersonID: personId, Type: 'Visa', IsActive: true, ...(visaExpiry ? { ExpiryDate: visaExpiry } : {}) },
]);

const mkKit = (missionId, personId, key, status) => ({
  MissionID: missionId, PersonID: personId, ItemCategory: 'Jersey',
  AssignmentKey: key, Status: status,
});

const trusted = (data) => ({ data, trusted: true });
const untrusted = (data = []) => ({ data, trusted: false });

const baseInputs = (over = {}) => ({
  participants: trusted([]),
  credentials: trusted([]),
  journeys: trusted([]),
  kit: trusted([]),
  pendingChanges: trusted([]),
  ...over,
});

try {
  const mr = compile('utils/missionReadiness.ts', 'missionReadiness.cjs');
  const gen = compile('utils/workItemGenerators/index.ts', 'workItemGenerators.cjs');
  const protocols = compile('protocols/index.ts', 'protocols.cjs');
  const PROTOCOLS = [protocols.evaluateOnboardingObligations];

  const realWarn = console.warn, realInfo = console.info;
  console.warn = () => {}; console.info = () => {};

  const computeOne = (mission, inputs) =>
    mr.computeMissionReadiness([mission], inputs, PROTOCOLS).get(mission.MissionID);

  // ── 1. Lifecycle mapping — every MissionStatus (ADR-002 preserved) ────────
  {
    const expected = {
      Planning: 'NotEvaluated', FinancePending: 'NotEvaluated',
      Confirmed: 'Evaluated', Active: 'Evaluated', PostMission: 'Evaluated',
      Settled: 'NotApplicable', Canceled: 'NotApplicable',
    };
    for (const [status, want] of Object.entries(expected)) {
      check(`1. ${status} → ${want} (constant)`, mr.EVALUATION_STATE_BY_STATUS[status] === want);
    }
    // Non-evaluated statuses: no facets, no overall — precedence never applied.
    for (const status of ['Planning', 'FinancePending', 'Settled', 'Canceled']) {
      const r = computeOne(mkMission('TR/2026/900', status, 10, 15), baseInputs());
      check(`1b. ${status}: facets null + overall null`,
        r.facets === null && r.overall === null && r.evaluation === expected[status]);
    }
    // Evaluated statuses produce facets.
    for (const status of ['Confirmed', 'Active', 'PostMission']) {
      const r = computeOne(mkMission('TR/2026/901', status, 10, 15), baseInputs());
      check(`1c. ${status}: evaluated with facets`, r.evaluation === 'Evaluated' && r.facets !== null);
    }
  }

  // ── 2. Unknown vs successful empty ─────────────────────────────────────────
  {
    const m = mkMission('TR/2026/001', 'Confirmed', 10, 15);

    // Trusted empty participants = Empty roster (a real, truthful state).
    const emptyOk = computeOne(m, baseInputs());
    check('2. trusted empty participants → Empty (not Unknown)',
      emptyOk.facets.participants.status === 'Empty' && emptyOk.evaluation === 'Evaluated');

    // Failed participants source ≠ empty roster.
    const pFail = computeOne(m, baseInputs({ participants: untrusted() }));
    check('2b. participant failure → participants Unknown', pFail.facets.participants.status === 'Unknown');
    check('2c. participant failure → compliance Unknown (never Clear)', pFail.facets.compliance.status === 'Unknown');
    check('2d. participant failure → kit Unknown (never NotRecorded)', pFail.facets.kit.status === 'Unknown');
    check('2e. participant failure → evaluation Unknown, overall null',
      pFail.evaluation === 'Unknown' && pFail.overall === null);

    // Failed credential source ≠ Clear compliance; other facets stay real.
    const inputs = baseInputs({
      participants: trusted([mkParticipant('TR/2026/001', 'PER-0001')]),
      credentials: untrusted(),
    });
    const cFail = computeOne(m, inputs);
    check('2f. credential failure → compliance Unknown only',
      cFail.facets.compliance.status === 'Unknown' &&
      cFail.facets.participants.status === 'Present' &&
      cFail.facets.kit.status !== 'Unknown');
    check('2g. credential failure → evaluation Unknown', cFail.evaluation === 'Unknown' && cFail.overall === null);

    // Failed kit source ≠ NotRecorded.
    const kFail = computeOne(m, baseInputs({
      participants: trusted([mkParticipant('TR/2026/001', 'PER-0001')]),
      credentials: trusted(satisfiedCreds('PER-0001')),
      kit: untrusted(),
    }));
    check('2h. kit failure → kit Unknown + evaluation Unknown',
      kFail.facets.kit.status === 'Unknown' && kFail.evaluation === 'Unknown');

    // Trusted empty kit = NotRecorded (a real, truthful state).
    const kEmpty = computeOne(m, baseInputs({
      participants: trusted([mkParticipant('TR/2026/001', 'PER-0001')]),
      credentials: trusted(satisfiedCreds('PER-0001')),
    }));
    check('2i. trusted empty kit → NotRecorded (not Unknown)', kEmpty.facets.kit.status === 'NotRecorded');

    // Pending source failure: indicator Unknown, evidence untouched.
    const pendFail = computeOne(m, baseInputs({
      participants: trusted([mkParticipant('TR/2026/001', 'PER-0001')]),
      credentials: trusted(satisfiedCreds('PER-0001')),
      pendingChanges: untrusted(),
    }));
    check('2j. pending failure → null indicators, evaluation still Evaluated',
      pendFail.facets.participants.pendingAdds === null &&
      pendFail.facets.participants.pendingRemovals === null &&
      pendFail.evaluation === 'Evaluated');
  }

  // ── 3. Participants facet ──────────────────────────────────────────────────
  {
    const m = mkMission('TR/2026/002', 'Confirmed', 10, 15);

    const zero = computeOne(m, baseInputs());
    check('3. zero participants → Empty + overall Incomplete',
      zero.facets.participants.status === 'Empty' && zero.overall === 'Incomplete');
    check('3b. zero participants → compliance NoParticipants (never Clear)',
      zero.facets.compliance.status === 'NoParticipants');

    // Pending requests never enter the active denominator.
    const pending = computeOne(m, baseInputs({
      pendingChanges: trusted([
        { operationType: 'AddMissionParticipant', missionId: 'TR/2026/002', personId: 'PER-0009' },
        { operationType: 'AddMissionParticipant', missionId: 'TR/2026/002', personId: 'PER-0010' },
        { operationType: 'RemoveMissionParticipant', missionId: 'TR/2026/002', personId: 'PER-0011' },
        { operationType: 'AddMissionParticipant', missionId: 'OTHER', personId: 'PER-0012' },
      ]),
    }));
    check('3c. pending adds counted separately (mission-scoped)',
      pending.facets.participants.pendingAdds === 2 && pending.facets.participants.pendingRemovals === 1);
    check('3d. pending requests excluded from active count + still Empty/Incomplete',
      pending.facets.participants.activeCount === 0 &&
      pending.facets.participants.status === 'Empty' &&
      pending.overall === 'Incomplete');
  }

  // ── 4. Compliance facet ────────────────────────────────────────────────────
  {
    const m = mkMission('TR/2026/003', 'Confirmed', 10, 20);
    const roster = [mkParticipant('TR/2026/003', 'PER-0001')];

    // No credentials → 3 Unsatisfied → mission-mode Critical → Blocked.
    const blocked = computeOne(m, baseInputs({ participants: trusted(roster) }));
    check('4. no credentials → Critical gaps → compliance Blocked',
      blocked.facets.compliance.status === 'Blocked' && blocked.facets.compliance.criticalCount === 3);
    check('4b. Critical compliance → overall Blocked', blocked.overall === 'Blocked');
    check('4c. no journey → gaps unrouted', blocked.facets.compliance.unroutedCount === 3);

    // Visa expiring exactly at span end (within 30 rolling days) → High → AtRisk.
    const atRiskHigh = computeOne(m, baseInputs({
      participants: trusted(roster),
      credentials: trusted(satisfiedCreds('PER-0001', addDays(20))),
    }));
    check('4d. expiry at span end (≤30d) → High gap → compliance AtRisk',
      atRiskHigh.facets.compliance.status === 'AtRisk' &&
      atRiskHigh.facets.compliance.highCount === 1 &&
      atRiskHigh.facets.compliance.criticalCount === 0);
    check('4e. High/Medium compliance → overall AtRisk', atRiskHigh.overall === 'AtRisk');

    // Medium variant: span end 60 days out, expiry at span end → Medium.
    const m60 = mkMission('TR/2026/004', 'Confirmed', 10, 60);
    const atRiskMed = computeOne(m60, baseInputs({
      participants: trusted([mkParticipant('TR/2026/004', 'PER-0001')]),
      credentials: trusted(satisfiedCreds('PER-0001', addDays(60))),
    }));
    check('4f. expiry at span end (31–90d) → Medium gap → AtRisk',
      atRiskMed.facets.compliance.status === 'AtRisk' && atRiskMed.facets.compliance.mediumCount === 1);

    // Fully satisfied → Clear.
    const clear = computeOne(m, baseInputs({
      participants: trusted(roster),
      credentials: trusted(satisfiedCreds('PER-0001')),
    }));
    check('4g. all capabilities satisfied → compliance Clear', clear.facets.compliance.status === 'Clear');
  }

  // ── 5. Kit facet — participant-aware denominator ──────────────────────────
  {
    const m = mkMission('TR/2026/005', 'Confirmed', 10, 15);
    const roster2 = [mkParticipant('TR/2026/005', 'PER-0001'), mkParticipant('TR/2026/005', 'PER-0002')];
    const cleared = trusted([...satisfiedCreds('PER-0001'), ...satisfiedCreds('PER-0002')]);
    const run = (kit) => computeOne(m, baseInputs({
      participants: trusted(roster2), credentials: cleared, kit: trusted(kit),
    }));

    // Full coverage, all Delivered/Confirmed → Fulfilled → Ready.
    const full = run([
      mkKit('TR/2026/005', 'PER-0001', 'HOME', 'Delivered'),
      mkKit('TR/2026/005', 'PER-0002', 'HOME', 'Confirmed'),
    ]);
    check('5. all covered + Delivered/Confirmed → Fulfilled',
      full.facets.kit.status === 'Fulfilled' && full.facets.kit.uncoveredParticipants === 0);
    check('5b. all evaluated blocking facets satisfied → overall Ready', full.overall === 'Ready');

    // Uncovered participant prevents Fulfilled even when existing rows are fulfilled.
    const uncovered = run([mkKit('TR/2026/005', 'PER-0001', 'HOME', 'Delivered')]);
    check('5c. uncovered participant → InProgress, never Fulfilled',
      uncovered.facets.kit.status === 'InProgress' && uncovered.facets.kit.uncoveredParticipants === 1);
    check('5d. uncovered participant kit → overall Incomplete', uncovered.overall === 'Incomplete');

    // Multiple rows per participant: all must be fulfilled.
    const multi = run([
      mkKit('TR/2026/005', 'PER-0001', 'HOME', 'Delivered'),
      mkKit('TR/2026/005', 'PER-0001', 'AWAY', 'Ordered'),
      mkKit('TR/2026/005', 'PER-0002', 'HOME', 'Confirmed'),
    ]);
    check('5e. multiple rows: unfulfilled row → InProgress',
      multi.facets.kit.status === 'InProgress' &&
      multi.facets.kit.totalAssignments === 3 && multi.facets.kit.fulfilledAssignments === 2);

    // Missing → Exception, prevents Ready (overall AtRisk).
    const missing = run([
      mkKit('TR/2026/005', 'PER-0001', 'HOME', 'Missing'),
      mkKit('TR/2026/005', 'PER-0002', 'HOME', 'Confirmed'),
    ]);
    check('5f. Missing → Exception', missing.facets.kit.status === 'Exception' && missing.facets.kit.missingAssignments === 1);
    check('5g. kit Exception → overall AtRisk (never Ready)', missing.overall === 'AtRisk');

    // Zero rows → NotRecorded → Incomplete.
    const none = run([]);
    check('5h. zero kit rows → NotRecorded → Incomplete',
      none.facets.kit.status === 'NotRecorded' && none.overall === 'Incomplete');
  }

  // ── 6. Overall precedence (only when Evaluated) ───────────────────────────
  {
    const m = mkMission('TR/2026/006', 'Confirmed', 10, 20);
    const roster = [mkParticipant('TR/2026/006', 'PER-0001')];

    // Blocked beats kit Incomplete.
    const r = computeOne(m, baseInputs({
      participants: trusted(roster), // no credentials → Blocked
      kit: trusted([]),              // NotRecorded → Incomplete
    }));
    check('6. Blocked > Incomplete', r.overall === 'Blocked');

    // AtRisk (kit Exception) beats Incomplete (uncovered other facet absent here).
    const r2 = computeOne(m, baseInputs({
      participants: trusted(roster),
      credentials: trusted(satisfiedCreds('PER-0001')),
      kit: trusted([mkKit('TR/2026/006', 'PER-0001', 'HOME', 'Missing')]),
    }));
    check('6b. AtRisk (kit Exception) with Clear compliance', r2.overall === 'AtRisk');
  }

  // ── 7. Zero-roster MissionReadinessGap work item ───────────────────────────
  {
    const emptyMap = new Map();
    const withRoster = new Map([['TR/2026/010', ['PER-0001']]]);

    const items = (missions, map) => gen.generateWorkItems([], missions, [], map);
    const mrgOf = (list) => list.filter(i => i.category === 'MissionReadinessGap');

    // Confirmed inside window (5 days) → item, Immediate, deterministic ID.
    const near = items([mkMission('TR/2026/010', 'Confirmed', 5, 9)], emptyMap);
    check('7. Confirmed ≤7d + zero roster → item, Immediate',
      mrgOf(near).length === 1 && mrgOf(near)[0].priority === 'Immediate');
    check('7b. deterministic ID mrg-{missionId}-participants',
      mrgOf(near)[0].id === 'mrg-TR/2026/010-participants');
    check('7c. contract: owner Operations (ProtocolDefault), dueDate = StartDate, missionId link',
      mrgOf(near)[0].owner === 'Operations' &&
      mrgOf(near)[0].ownerSource === 'ProtocolDefault' &&
      mrgOf(near)[0].dueDate === addDays(5) &&
      mrgOf(near)[0].links.missionId === 'TR/2026/010' &&
      mrgOf(near)[0].trigger.facet === 'Participants');

    // Confirmed 8–30 days → High. Outside window → nothing.
    const mid = items([mkMission('TR/2026/010', 'Confirmed', 20, 24)], emptyMap);
    check('7d. Confirmed 8–30d → High', mrgOf(mid).length === 1 && mrgOf(mid)[0].priority === 'High');
    const far = items([mkMission('TR/2026/010', 'Confirmed', 40, 44)], emptyMap);
    check('7e. Confirmed outside window → no item', mrgOf(far).length === 0);

    // Active always in window (days 0 → Immediate).
    const active = items([mkMission('TR/2026/010', 'Active', -2, 3)], emptyMap);
    check('7f. Active + zero roster → item (Immediate)',
      mrgOf(active).length === 1 && mrgOf(active)[0].priority === 'Immediate');

    // Non-applicable statuses never trigger.
    for (const status of ['PostMission', 'Planning', 'FinancePending', 'Settled', 'Canceled']) {
      const none = items([mkMission('TR/2026/010', status, 5, 9)], emptyMap);
      check(`7g. ${status} → no item`, mrgOf(none).length === 0);
    }

    // Dedupe: recompute with identical inputs → exactly one item, same ID.
    const again = items([mkMission('TR/2026/010', 'Confirmed', 5, 9)], emptyMap);
    check('7h. recompute → single item, same ID',
      mrgOf(again).length === 1 && mrgOf(again)[0].id === mrgOf(near)[0].id);

    // Disappearance: participant added → no item.
    const resolved = items([mkMission('TR/2026/010', 'Confirmed', 5, 9)], withRoster);
    check('7i. roster assigned → item disappears', mrgOf(resolved).length === 0);

    // MDP mutual exclusion: roster + open gaps → MDP present, MRG absent.
    const gap = {
      personId: 'PER-0001', personName: 'PER-0001',
      obligationId: 'travel', requirement: 'Travel Authorization',
      satisfiedByCapability: 'Travel', blockingReason: 'No Travel Authorization on file.',
      urgencyTier: 'Critical', daysToExpiry: null,
      journeyId: undefined, assignedTo: undefined, defaultOwner: 'Operations',
      ownershipState: 'Unrouted', evaluatedAt: new Date().toISOString(),
    };
    const withGaps = gen.generateWorkItems([gap], [mkMission('TR/2026/010', 'Confirmed', 5, 9)], [], withRoster);
    check('7j. roster + gaps → MDP present, MRG absent (mutually exclusive)',
      withGaps.some(i => i.category === 'MissionDeparturePressure') &&
      withGaps.every(i => i.category !== 'MissionReadinessGap'));
  }

  console.warn = realWarn; console.info = realInfo;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
