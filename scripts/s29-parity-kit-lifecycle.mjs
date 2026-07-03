/**
 * s29-parity-kit-lifecycle.mjs
 *
 * Sprint 29A — Kit lifecycle + write-validation parity harness.
 *
 * Compiles the ACTUAL production source via esbuild (s27/s28 pattern — no
 * inline translation drift):
 *   packages/c3/src/utils/kitLifecycle.ts        (transition matrix, audit
 *     lines, title builder, normalization, validators, failure classification)
 *   packages/c3/src/services/mock/MockMissionService.ts +
 *   packages/c3/src/services/mock/MockApparelProfileService.ts
 *     (mock write behaviour parity — same pure guards as SP)
 *
 * Temp bundles go to the OS temp directory and are removed in finally.
 *
 * Run: node scripts/s29-parity-kit-lifecycle.mjs
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

const tmp = mkdtempSync(join(tmpdir(), 's29-parity-'));

function compile(entryRel, outName) {
  const outfile = join(tmp, outName);
  buildSync({
    entryPoints: [join(srcRoot, entryRel)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    logLevel: 'error',
    alias: { '@c3': srcRoot },
  });
  return require(outfile);
}

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

// The approved transition matrix — the harness's independent copy. Every
// (from, to) pair is asserted against the compiled production module, so any
// drift between this table and source fails loudly.
const APPROVED = {
  NotOrdered: ['Ordered', 'Shipped', 'Delivered'],
  Ordered:    ['Shipped', 'Delivered', 'Missing'],
  Shipped:    ['Delivered', 'Missing'],
  Delivered:  ['Confirmed', 'Returned', 'Missing'],
  Confirmed:  ['Returned', 'Missing'],
  Returned:   ['Replaced'],
  Missing:    ['Replaced'],
  Replaced:   ['Ordered'],
};
const ALL_STATUSES = Object.keys(APPROVED);

try {
  const lc = compile('utils/kitLifecycle.ts', 'kitLifecycle.cjs');
  const mockMission = compile('services/mock/MockMissionService.ts', 'mockMission.cjs');
  const mockApparel = compile('services/mock/MockApparelProfileService.ts', 'mockApparel.cjs');

  const realWarn = console.warn; const realInfo = console.info;
  console.warn = () => {}; console.info = () => {};

  // ── 1. Full transition matrix (64 pairs) ─────────────────────────────────
  {
    let ok = true;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        const expected = APPROVED[from].includes(to);
        if (lc.canTransitionKitStatus(from, to) !== expected) {
          ok = false;
          console.error(`    matrix mismatch: ${from} -> ${to} expected ${expected}`);
        }
      }
    }
    check('1. full transition matrix matches approved table', ok);
    check('1b. self-transitions invalid', ALL_STATUSES.every(s => !lc.canTransitionKitStatus(s, s)));
    check('1c. Confirmed only reachable from Delivered',
      ALL_STATUSES.every(s => (s === 'Delivered') === lc.canTransitionKitStatus(s, 'Confirmed')));
    check('1d. no backward transitions (Shipped->Ordered, Delivered->Shipped, Confirmed->Delivered all invalid)',
      !lc.canTransitionKitStatus('Shipped', 'Ordered') &&
      !lc.canTransitionKitStatus('Delivered', 'Shipped') &&
      !lc.canTransitionKitStatus('Confirmed', 'Delivered'));
    check('1e. validKitTransitions drives UI menus',
      JSON.stringify(lc.validKitTransitions('Delivered')) === JSON.stringify(['Confirmed', 'Returned', 'Missing']));
  }

  // ── 2. Reason-required transitions ───────────────────────────────────────
  {
    check('2. Returned/Missing/Replaced require reason',
      lc.kitTransitionRequiresReason('Returned') && lc.kitTransitionRequiresReason('Missing') &&
      lc.kitTransitionRequiresReason('Replaced'));
    check('2b. forward states do not require reason',
      !lc.kitTransitionRequiresReason('Ordered') && !lc.kitTransitionRequiresReason('Confirmed'));
    const errs = lc.validateKitTransitionRequest({ toStatus: 'Returned', reason: '', actorLoginName: 'ops@x' });
    check('2c. validator rejects reason-less Returned', errs.length === 1 && /reason/i.test(errs[0]));
    check('2d. validator accepts reasoned Returned',
      lc.validateKitTransitionRequest({ toStatus: 'Returned', reason: 'damaged', actorLoginName: 'ops@x' }).length === 0);
  }

  // ── 3. Actor fail-close ──────────────────────────────────────────────────
  {
    check('3. empty actor rejected (transition)',
      lc.validateKitTransitionRequest({ toStatus: 'Ordered', actorLoginName: ' ' }).length === 1);
    check('3b. empty actor rejected (create)',
      lc.validateCreateKitAssignmentInput({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Jersey', AssignmentKey: 'X', actorLoginName: '' }).length === 1);
    check('3c. empty actor rejected (apparel)',
      lc.validateUpsertApparelProfileInput({ PersonID: 'PER-0001', actorLoginName: '' }).length === 1);
  }

  // ── 4. Audit line formatting ─────────────────────────────────────────────
  {
    const iso = '2026-07-03T12:00:00.000Z';
    check('4. transition audit format',
      lc.buildKitAuditLine('Delivered', 'Returned', 'ops@geekay.gg', 'damaged zipper', iso) ===
      '[2026-07-03T12:00:00.000Z] KITSTATUS Delivered→Returned by ops@geekay.gg — damaged zipper');
    check('4b. no-reason line omits the dash suffix',
      lc.buildKitAuditLine('NotOrdered', 'Ordered', 'ops@geekay.gg', undefined, iso) ===
      '[2026-07-03T12:00:00.000Z] KITSTATUS NotOrdered→Ordered by ops@geekay.gg');
    check('4c. creation marker line',
      lc.buildKitAuditLine('CREATED', 'NotOrdered', 'ops@geekay.gg', undefined, iso).includes('KITSTATUS CREATED→NotOrdered'));
    check('4d. append preserves prior lines',
      lc.appendKitAuditLine('line1', 'line2') === 'line1\nline2' &&
      lc.appendKitAuditLine('', 'line1') === 'line1' &&
      lc.appendKitAuditLine(null, 'line1') === 'line1');
  }

  // ── 5. AssignmentKey normalization + deterministic Title ─────────────────
  {
    check('5. AssignmentKey trimmed, casing preserved', lc.normalizeAssignmentKey('  Home-2026  ') === 'Home-2026');
    check('5b. deterministic title construction',
      lc.buildKitAssignmentTitle('TR/2026/006', 'PER-0001', 'Jersey', 'HOME-2026') ===
      'TR/2026/006|PER-0001|Jersey|HOME-2026');
    check('5c. no title-parsing export exists (Title never identity)',
      !('parseKitAssignmentTitle' in lc) && !('parseTitle' in lc));
  }

  // ── 6. Create/apparel validators ─────────────────────────────────────────
  {
    check('6. blank AssignmentKey rejected',
      lc.validateCreateKitAssignmentInput({ MissionID: 'M', PersonID: 'P', ItemCategory: 'Jersey', AssignmentKey: '  ', actorLoginName: 'x@y' }).length === 1);
    check('6b. unknown category rejected',
      lc.validateCreateKitAssignmentInput({ MissionID: 'M', PersonID: 'P', ItemCategory: 'Footwear', AssignmentKey: 'K', actorLoginName: 'x@y' }).length === 1);
    check('6c. unknown jersey size rejected',
      lc.validateUpsertApparelProfileInput({ PersonID: 'P', JerseySize: 'XXXL', actorLoginName: 'x@y' }).length === 1);
    check('6d. all seven sizes accepted',
      ['XS','S','M','L','XL','XXL','3XL'].every(s => lc.validateUpsertApparelProfileInput({ PersonID: 'P', JerseySize: s, actorLoginName: 'x@y' }).length === 0));
    check('6e. NameOnJersey length cap enforced',
      lc.validateUpsertApparelProfileInput({ PersonID: 'P', NameOnJersey: 'X'.repeat(31), actorLoginName: 'x@y' }).length === 1 &&
      lc.validateUpsertApparelProfileInput({ PersonID: 'P', NameOnJersey: 'X'.repeat(30), actorLoginName: 'x@y' }).length === 0);
  }

  // ── 7. Write-failure classification (concurrency/duplicate/permission) ───
  {
    check('7. 412 -> concurrency', lc.classifyWriteFailure(412, '') === 'concurrency');
    check('7b. 403 -> permission', lc.classifyWriteFailure(403, '') === 'permission');
    check('7c. SP duplicate message -> duplicate',
      lc.classifyWriteFailure(400, 'The list item could not be added... duplicate values ...') === 'duplicate' &&
      lc.classifyWriteFailure(400, 'SPDuplicateValuesFoundException') === 'duplicate');
    check('7d. other 400/500 -> generic',
      lc.classifyWriteFailure(400, 'bad request') === 'generic' && lc.classifyWriteFailure(500, '') === 'generic');
  }

  // ── 8. Mock write behaviour parity ───────────────────────────────────────
  {
    const svc = mockMission.createMockMissionService();
    const run = async () => {
      // create requires active participant
      let threw = null;
      try { await svc.createKitAssignment({ MissionID: 'TR/2026/006', PersonID: 'PER-9999', ItemCategory: 'Jersey', AssignmentKey: 'X-1', actorLoginName: 'ops@x' }); }
      catch (e) { threw = e; }
      check('8. mock create rejects non-participant', threw?.name === 'ParticipantNotActiveError');

      const created = await svc.createKitAssignment({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Apparel', AssignmentKey: ' TRACKSUIT-01 ', ItemDescription: 'Tracksuit', actorLoginName: 'ops@x' });
      check('8b. mock create defaults NotOrdered + trims key + defaults owner to actor',
        created.Status === 'NotOrdered' && created.AssignmentKey === 'TRACKSUIT-01' && created.OwnerEmail === 'ops@x');

      threw = null;
      try { await svc.createKitAssignment({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Apparel', AssignmentKey: 'TRACKSUIT-01', actorLoginName: 'ops@x' }); }
      catch (e) { threw = e; }
      check('8c. mock duplicate compound key rejected', threw?.name === 'DuplicateKitAssignmentError');

      const t1 = await svc.transitionKitStatus({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Apparel', AssignmentKey: 'TRACKSUIT-01', toStatus: 'Ordered', actorLoginName: 'ops@x' });
      check('8d. mock valid transition applies', t1.Status === 'Ordered');

      threw = null;
      try { await svc.transitionKitStatus({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Apparel', AssignmentKey: 'TRACKSUIT-01', toStatus: 'Confirmed', actorLoginName: 'ops@x' }); }
      catch (e) { threw = e; }
      check('8e. mock invalid transition rejected (Ordered->Confirmed)', threw?.name === 'InvalidKitTransitionError');

      threw = null;
      try { await svc.deactivateKitAssignment({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Apparel', AssignmentKey: 'TRACKSUIT-01', reason: '', actorLoginName: 'ops@x' }); }
      catch (e) { threw = e; }
      check('8f. mock deactivation requires reason', threw !== null);

      await svc.deactivateKitAssignment({ MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Apparel', AssignmentKey: 'TRACKSUIT-01', reason: 'test cleanup', actorLoginName: 'ops@x' });
      const after = await svc.listKitAssignments('TR/2026/006');
      check('8g. deactivated item excluded from active reads',
        !after.some(k => k.AssignmentKey === 'TRACKSUIT-01'));

      // apparel upsert
      const apparel = mockApparel.createMockApparelProfileService();
      const up = await apparel.upsertApparelProfile({ PersonID: 'PER-0004', JerseySize: 'XL', NameOnJersey: ' HUSSEIN ', actorLoginName: 'hr@x' });
      check('8h. mock apparel create-if-absent + trim', up.JerseySize === 'XL' && up.NameOnJersey === 'HUSSEIN');
      const re = await apparel.getApparelProfile('PER-0004');
      check('8i. mock upsert persists', re?.JerseySize === 'XL');
      const up2 = await apparel.upsertApparelProfile({ PersonID: 'PER-0004', JerseySize: 'L', actorLoginName: 'hr@x' });
      check('8j. mock upsert updates existing', up2.JerseySize === 'L' && (await apparel.listApparelProfiles()).filter(p => p.PersonID === 'PER-0004').length === 1);
    };
    await run();
  }

  console.warn = realWarn; console.info = realInfo;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(`=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
