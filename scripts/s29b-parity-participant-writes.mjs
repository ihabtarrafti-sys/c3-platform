/**
 * s29b-parity-participant-writes.mjs
 *
 * Sprint 29B — Governed participant membership parity harness.
 *
 * Compiles the ACTUAL production source via esbuild (s27/s28/s29 pattern):
 *   packages/c3/src/utils/participantWrites.ts   (validators, title, matching)
 *   packages/c3/src/utils/kitLifecycle.ts        (classifyWriteFailure — shared 412/duplicate translation)
 *   packages/c3/src/services/mock/MockMissionService.ts (mock write behaviour parity)
 *
 * Run: node scripts/s29b-parity-participant-writes.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 's29b-parity-'));

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

const validAdd = {
  missionId: 'TR/2026/006', personId: 'PER-0005',
  externalCode: 'RL/PL/030', role: 'Player', perDiemRate: 35,
};

try {
  const pw = compile('utils/participantWrites.ts', 'participantWrites.cjs');
  const lc = compile('utils/kitLifecycle.ts', 'kitLifecycle.cjs');
  const mockMission = compile('services/mock/MockMissionService.ts', 'mockMission.cjs');

  const realWarn = console.warn, realInfo = console.info;
  console.warn = () => {}; console.info = () => {};

  // ── 1. Valid add payload + every role ────────────────────────────────────
  check('1. valid add payload passes', pw.validateAddParticipantPayload(validAdd).length === 0);
  {
    const roles = ['Player', 'Coach', 'Manager', 'Analyst', 'Staff'];
    check('1b. all five roles valid',
      roles.every(r => pw.validateAddParticipantPayload({ ...validAdd, role: r }).length === 0));
    check('1c. PARTICIPANT_ROLES export matches union',
      JSON.stringify(pw.PARTICIPANT_ROLES) === JSON.stringify(roles));
  }

  // ── 2. Field rejections ──────────────────────────────────────────────────
  check('2. missing mission rejected', pw.validateAddParticipantPayload({ ...validAdd, missionId: ' ' }).length === 1);
  check('2b. missing person rejected', pw.validateAddParticipantPayload({ ...validAdd, personId: '' }).length === 1);
  check('2c. missing external code rejected', pw.validateAddParticipantPayload({ ...validAdd, externalCode: '  ' }).length === 1);
  check('2d. invalid role rejected', pw.validateAddParticipantPayload({ ...validAdd, role: 'Mascot' }).length === 1);
  check('2e. negative per diem rejected', pw.validateAddParticipantPayload({ ...validAdd, perDiemRate: -5 }).length === 1);
  check('2f. non-finite per diem rejected', pw.validateAddParticipantPayload({ ...validAdd, perDiemRate: Number.NaN }).length === 1);
  check('2g. absent per diem accepted', pw.validateAddParticipantPayload({ ...validAdd, perDiemRate: undefined }).length === 0);
  check('2h. zero per diem accepted', pw.validateAddParticipantPayload({ ...validAdd, perDiemRate: 0 }).length === 0);

  // ── 3. Removal validation ────────────────────────────────────────────────
  check('3. valid removal passes',
    pw.validateRemoveParticipantPayload({ missionId: 'TR/2026/006', personId: 'PER-0001', reason: 'Roster change' }).length === 0);
  check('3b. missing reason rejected',
    pw.validateRemoveParticipantPayload({ missionId: 'TR/2026/006', personId: 'PER-0001', reason: '  ' }).length === 1);

  // ── 4. Deterministic title + never-parsed ────────────────────────────────
  check('4. canonical title', pw.buildParticipantTitle('TR/2026/006', 'PER-0005') === 'TR/2026/006|PER-0005');
  check('4b. no title-parsing export exists', !('parseParticipantTitle' in pw) && !('parseTitle' in pw));

  // ── 5. Already-applied matching ──────────────────────────────────────────
  {
    const existing = { MissionID: 'TR/2026/006', PersonID: 'PER-0005', ExternalCode: 'RL/PL/030', Role: 'Player', PerDiemRate: 35 };
    check('5. exact match detected', pw.participantMatchesPayload(existing, validAdd) === true);
    check('5b. normalized external code still matches',
      pw.participantMatchesPayload(existing, { ...validAdd, externalCode: '  RL/PL/030  ' }) === true);
    check('5c. role mismatch detected', pw.participantMatchesPayload(existing, { ...validAdd, role: 'Coach' }) === false);
    check('5d. per diem mismatch detected', pw.participantMatchesPayload(existing, { ...validAdd, perDiemRate: 40 }) === false);
    check('5e. undefined-vs-absent per diem equal',
      pw.participantMatchesPayload({ ...existing, PerDiemRate: undefined }, { ...validAdd, perDiemRate: undefined }) === true);
  }

  // ── 6. Pending duplicate key ─────────────────────────────────────────────
  check('6. pending key shape',
    pw.pendingRequestKey('AddMissionParticipant', 'TR/2026/006', 'PER-0005') === 'AddMissionParticipant|TR/2026/006|PER-0005');
  check('6b. pending statuses are Submitted/InReview/Approved',
    JSON.stringify(pw.PENDING_APPROVAL_STATUSES) === JSON.stringify(['Submitted', 'InReview', 'Approved']));

  // ── 7. 412/duplicate/permission classification (shared helper) ───────────
  check('7. 412 -> concurrency', lc.classifyWriteFailure(412, '') === 'concurrency');
  check('7b. duplicate constraint -> duplicate', lc.classifyWriteFailure(400, 'duplicate values') === 'duplicate');
  check('7c. 403 -> permission', lc.classifyWriteFailure(403, '') === 'permission');

  // ── 8. Mock write behaviour parity (governed contract) ───────────────────
  {
    const svc = mockMission.createMockMissionService();
    const actor = 'owner@geekay.gg';

    // created
    const created = await svc.addMissionParticipant({
      MissionID: 'TR/2026/006', PersonID: 'PER-0005', ExternalCode: ' RL/PL/030 ',
      Role: 'Player', PerDiemRate: 35, actorLoginName: actor,
    });
    check('8. add creates with normalized code', created.outcome === 'created' && created.participant.ExternalCode === 'RL/PL/030');

    // already-applied (exact match)
    const again = await svc.addMissionParticipant({
      MissionID: 'TR/2026/006', PersonID: 'PER-0005', ExternalCode: 'RL/PL/030',
      Role: 'Player', PerDiemRate: 35, actorLoginName: actor,
    });
    check('8b. exact re-add = already-applied (no duplicate row)',
      again.outcome === 'already-applied' &&
      (await svc.listMissionParticipants('TR/2026/006')).filter(p => p.PersonID === 'PER-0005').length === 1);

    // conflicting active row
    let threw = null;
    try {
      await svc.addMissionParticipant({
        MissionID: 'TR/2026/006', PersonID: 'PER-0005', ExternalCode: 'RL/PL/030',
        Role: 'Coach', PerDiemRate: 25, actorLoginName: actor,
      });
    } catch (e) { threw = e; }
    check('8c. conflicting active row -> ParticipantConflictError', threw?.name === 'ParticipantConflictError');

    // removal blocked by active kit (PER-0001 has kit seeds)
    threw = null;
    try {
      await svc.removeMissionParticipant({
        MissionID: 'TR/2026/006', PersonID: 'PER-0001', reason: 'test', actorLoginName: actor,
      });
    } catch (e) { threw = e; }
    check('8d. removal blocked by active kit', threw?.name === 'ActiveKitDependencyError');

    // removal path: PER-0005 has no kit
    const removed = await svc.removeMissionParticipant({
      MissionID: 'TR/2026/006', PersonID: 'PER-0005', reason: 'Roster change', actorLoginName: actor,
    });
    check('8e. removal succeeds without kit', removed.outcome === 'removed' &&
      !(await svc.listMissionParticipants('TR/2026/006')).some(p => p.PersonID === 'PER-0005'));

    // already-inactive recovery target
    const removedAgain = await svc.removeMissionParticipant({
      MissionID: 'TR/2026/006', PersonID: 'PER-0005', reason: 'retry', actorLoginName: actor,
    });
    check('8f. re-removal = already-inactive (stamp recovery)', removedAgain.outcome === 'already-inactive');

    // governed reactivation with refreshed fields
    const reactivated = await svc.addMissionParticipant({
      MissionID: 'TR/2026/006', PersonID: 'PER-0005', ExternalCode: 'RL/CH/031',
      Role: 'Coach', PerDiemRate: 25, actorLoginName: actor,
    });
    check('8g. governed reactivation refreshes fields',
      reactivated.outcome === 'reactivated' && reactivated.participant.Role === 'Coach' &&
      (await svc.listMissionParticipants('TR/2026/006')).filter(p => p.PersonID === 'PER-0005').length === 1);

    // missing removal target
    threw = null;
    try {
      await svc.removeMissionParticipant({
        MissionID: 'TR/2026/006', PersonID: 'PER-9999', reason: 'x', actorLoginName: actor,
      });
    } catch (e) { threw = e; }
    check('8h. missing removal target -> RowNotFoundError', threw?.name === 'RowNotFoundError');

    // actor fail-close
    threw = null;
    try {
      await svc.addMissionParticipant({
        MissionID: 'TR/2026/006', PersonID: 'PER-0006', ExternalCode: 'X', Role: 'Staff', actorLoginName: ' ',
      });
    } catch (e) { threw = e; }
    check('8i. empty actor fails closed', threw !== null);
  }

  console.warn = realWarn; console.info = realInfo;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(`=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
