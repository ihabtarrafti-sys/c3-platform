/**
 * s33-parity-participant-guard.mjs — Sprint 33 Correction Set D.
 *
 * PROVEN DEFECT (hosted APR-0066): with an ACTIVE participant row for the
 * exact MissionID+PersonID pair, Operations could still submit another
 * AddMissionParticipant approval; it entered the queue and only failed at
 * execution (ParticipantConflictError). Submission must now inspect the
 * authoritative membership state (INCLUDING inactive rows) and refuse
 * knowably-impossible requests before any approval exists.
 *
 * Functional coverage compiles the REAL pure guard
 * (utils/participantSubmissionGuard.ts) and the REAL Mock adapter; the
 * SharePoint adapter, hook wiring, execution-time guard, and hosted feedback
 * path are pinned by static source checks.
 */
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'packages/c3/src');
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

// ── Compile the REAL pure guard ─────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's33-partguard-'));
const guardOut = join(tmp, 'guard.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3/src/utils/participantSubmissionGuard.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: guardOut, logLevel: 'error',
  alias: { '@c3': srcRoot },
});
const { decideParticipantSubmission, ParticipantAlreadyActiveError, ParticipantHistoryIntegrityError } = require(guardOut);

// 1 — no row permits submission.
check('1: zero rows → allow-create',
  decideParticipantSubmission([]).kind === 'allow-create');
// 2 — one inactive row permits reactivation submission.
check('2: one inactive row → allow-reactivation (reactivation path NOT blocked)',
  decideParticipantSubmission([{ isActive: false }]).kind === 'allow-reactivation');
// 3/4 — one active row refuses BEFORE approval creation, and the decision is
// field-independent BY CONSTRUCTION (it sees only activity states — identical
// vs differing proposed values cannot change it).
check('3: one active row → refuse-active',
  decideParticipantSubmission([{ isActive: true }]).kind === 'refuse-active');
check('4: decision is field-independent (signature carries only isActive states)',
  decideParticipantSubmission.length === 1 &&
  /rows:\s*ParticipantMembershipState\[\]/.test(read('packages/c3/src/utils/participantSubmissionGuard.ts')));
// 5 — multiple rows fail closed.
check('5: multiple rows → fail-integrity with rowCount',
  decideParticipantSubmission([{ isActive: true }, { isActive: false }]).kind === 'fail-integrity' &&
  decideParticipantSubmission([{ isActive: false }, { isActive: false }]).rowCount === 2);
// Error classes are truthful and update-honest.
check('x: ParticipantAlreadyActiveError explains active membership + deferred updates',
  /already an active participant/.test(new ParticipantAlreadyActiveError('TR/2026/007', 'PER-0025').message) &&
  /UpdateMissionParticipant is deferred/.test(new ParticipantAlreadyActiveError('M', 'P').message) &&
  /no request was submitted/i.test(new ParticipantAlreadyActiveError('M', 'P').message));
check('x: ParticipantHistoryIntegrityError fails closed with row count',
  /integrity/i.test(new ParticipantHistoryIntegrityError('M', 'P', 3).message) &&
  /3 participant rows/.test(new ParticipantHistoryIntegrityError('M', 'P', 3).message));

// ── Mock adapter (REAL module) — pair-exactness and parity ──────────────────
const mockOut = join(tmp, 'mock.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3/src/services/mock/MockMissionService.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: mockOut, logLevel: 'error',
  alias: { '@c3': srcRoot },
});
const mockMod = require(mockOut);
const mockSvc = mockMod.mockMissionService ?? mockMod.createMockMissionService?.() ?? mockMod.default;
const states = async (m, p) => mockSvc.getParticipantMembershipStates(m, p);
// Seeds: PER-0001 active on TR/2026/006.
check('mock: seeded active pair reports one active row → refuse-active',
  decideParticipantSubmission(await states('TR/2026/006', 'PER-0001')).kind === 'refuse-active');
// 7 — distinct MissionID remains independent.
check('7: same person, different mission → zero rows → allow-create',
  decideParticipantSubmission(await states('TR/2026/007', 'PER-0001')).kind === 'allow-create');
// 8 — distinct PersonID remains independent.
check('8: same mission, different person → zero rows → allow-create',
  decideParticipantSubmission(await states('TR/2026/006', 'PER-9999')).kind === 'allow-create');
// 11 — Mock/SP parity: both adapters implement the same contract; mock rows
// are truthfully all-active (no IsActive persistence — removal deletes).
const mockSrc = read('packages/c3/src/services/mock/MockMissionService.ts');
check('11a: Mock adapter implements getParticipantMembershipStates on the shared contract',
  /getParticipantMembershipStates\(\s*missionId: string,\s*personId: string,?\s*\)/.test(mockSrc) &&
  mockSrc.includes('isActive: true'));

// ── SharePoint adapter + hook wiring (static source discipline) ─────────────
const spSrc = read('packages/c3/src/services/sharepoint/SharePointMissionService.ts');
const hook = read('packages/c3/src/hooks/useSubmitParticipantApproval.ts');
const iface = read('packages/c3/src/services/interfaces/IMissionService.ts');

check('11b: SP adapter reads the EXACT pair with NO active filter (inactive rows included)',
  /getParticipantMembershipStates[\s\S]{0,700}\$select=IsActive[\s\S]{0,300}MissionID eq '\$\{encodeODataLiteral\(missionId\)\}'[\s\S]{0,120}PersonID eq '\$\{encodeODataLiteral\(personId\)\}'/.test(spSrc) &&
  !/getParticipantMembershipStates[\s\S]{0,900}IsActive eq/.test(spSrc));
check('x: SP adapter FAILS CLOSED on read failure (throws, never returns empty)',
  /getParticipantMembershipStates[\s\S]{0,1200}submission blocked \(fail-closed\)/.test(spSrc));
check('x: interface documents the extension and its fail-closed contract',
  iface.includes('getParticipantMembershipStates') && /never be used to infer absence/.test(iface));

// 9 — canonical IDs pass unchanged (guard + payload use input.missionId/personId verbatim).
check('9: canonical MissionID/PersonID pass unchanged through guard and payload',
  /assertSubmittableMembershipState\(input\.missionId, input\.personId\)/.test(hook) &&
  /missionId: input\.missionId,\s*\n\s*personId: input\.personId/.test(hook) &&
  !/getParticipantMembershipStates\([^)]*\.Id\b/.test(hook));
// 6 — pending duplicate refusal preserved AND ordered before the state guard.
check('6: duplicate-pending guard preserved and runs before the membership guard',
  /assertNoPendingDuplicate\('AddMissionParticipant', input\.missionId, input\.personId\);\s*\n\s*await assertSubmittableMembershipState\(/.test(hook));
// Guard active in BOTH DSM branches (mock parity of submission semantics).
check('11c: guard runs in the Mock (direct) branch too',
  /dataSourceMode !== 'sharepoint'[\s\S]{0,120}assertSubmittableMembershipState\(input\.missionId, input\.personId\)/.test(hook));
// Reactivation path not blocked in wiring (allow-reactivation falls through).
check("2b: hook lets 'allow-create' and 'allow-reactivation' proceed",
  /'allow-create' and 'allow-reactivation' both proceed/.test(hook));

// 10 — execution-time duplicate/race guard remains present and authoritative.
check('10: execution-time guards intact (already-applied idempotency + ParticipantConflictError + reactivation)',
  /outcome: 'already-applied'/.test(spSrc) &&
  /throw new ParticipantConflictError\(req\.MissionID, req\.PersonID\)/.test(spSrc) &&
  /outcome: 'reactivated'/.test(spSrc));

// 12 — visible error feedback uses the hosted notification path.
const panel = read('packages/c3/src/components/shared/AddParticipantPanel.tsx');
check('12: panel surfaces submission errors via toast.error → hosted NotificationRegion',
  /catch \(err\)[\s\S]{0,220}toast\.error\('Failed to submit participant addition'/.test(panel));

// Architecture boundaries: no schema change, no PnP, no direct mutation added.
{
  // Scope the write-verb check to the new method's body only.
  const start = spSrc.indexOf('async getParticipantMembershipStates');
  const end = spSrc.indexOf('async listKitAssignments', start);
  const body = spSrc.slice(start, end);
  check('x: no PnP.js import and no write verbs in the new read path',
    !/from ['"]@pnp\//.test(spSrc) && start > 0 && end > start &&
    !/(POST|MERGE|X-HTTP-Method|RequestDigest)/.test(body));
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\ns33-parity-participant-guard: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) { console.error('FAILED:', failures); process.exit(1); }
