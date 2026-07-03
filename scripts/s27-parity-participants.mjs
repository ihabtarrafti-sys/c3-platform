/**
 * s27-parity-participants.mjs
 *
 * Sprint 27 (S27-6) — Mission participant mapper parity harness.
 *
 * Unlike s15–s18 (which inline-translate mapper logic and must be kept in
 * sync manually), this harness COMPILES THE ACTUAL PRODUCTION SOURCE via
 * esbuild (already present through the Vite toolchain) and exercises it
 * directly — there is no translated copy to drift.
 *
 * Compiled entry points:
 *   packages/c3/src/utils/spMissionParticipantMapper.ts  (mapper under test)
 *   packages/c3/src/services/sharepoint/SharePointMissionService.ts
 *     (for the exported encodeODataLiteral helper — type-only imports are
 *      erased at bundle time, so no React/runtime dependencies are pulled in)
 *
 * Temporary bundle output is written to the OS temp directory and removed
 * in a finally block — nothing is left in the repo.
 *
 * Mirror records (3): exact SP representation of the MockMissionService
 * MOCK_PARTICIPANTS seeds — mapped output must deep-equal the mock records.
 *
 * Run: node scripts/s27-parity-participants.mjs
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

// ---------------------------------------------------------------------------
// Compile production source to a temp CJS bundle
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 's27-parity-'));

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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Build a fully-valid raw SP item; overrides simulate defects. */
let nextId = 1;
function spItem(overrides = {}) {
  return {
    Id: nextId++,
    Title: 'TR/2026/006|PER-0001',
    MissionID: 'TR/2026/006',
    PersonID: 'PER-0001',
    ExternalCode: 'RL/PL/026',
    ParticipantRole: 'Player',
    PerDiemRate: 35,
    IsActive: true,
    ...overrides,
  };
}

// Mock DSM seed records (MockMissionService.MOCK_PARTICIPANTS) — parity targets.
const MOCK_SEEDS = [
  { MissionID: 'TR/2026/006',   PersonID: 'PER-0001', ExternalCode: 'RL/PL/026', Role: 'Player', PerDiemRate: 35 },
  { MissionID: 'TR/2026/006',   PersonID: 'PER-0002', ExternalCode: 'RL/CH/004', Role: 'Coach',  PerDiemRate: 25 },
  { MissionID: 'SATR/2026/003', PersonID: 'PER-0004', ExternalCode: 'FC/PL/001', Role: 'Player', PerDiemRate: 35 },
];

const MIRROR_ITEMS = [
  spItem({ Title: 'TR/2026/006|PER-0001' }),
  spItem({ Title: 'TR/2026/006|PER-0002', PersonID: 'PER-0002', ExternalCode: 'RL/CH/004', ParticipantRole: 'Coach', PerDiemRate: 25 }),
  spItem({ Title: 'SATR/2026/003|PER-0004', MissionID: 'SATR/2026/003', PersonID: 'PER-0004', ExternalCode: 'FC/PL/001', PerDiemRate: 35 }),
];

try {
  const mapperMod = compile('utils/spMissionParticipantMapper.ts', 'mapper.cjs');
  const serviceMod = compile('services/sharepoint/SharePointMissionService.ts', 'service.cjs');
  const { mapSpItemToMissionParticipant, mapSpItemsToMissionParticipants } = mapperMod;
  const { encodeODataLiteral } = serviceMod;

  // Silence per-item mapper console noise; count nothing — warnRef is authoritative.
  const realWarn = console.warn;
  const realInfo = console.info;
  console.warn = () => {};
  console.info = () => {};

  const w = () => ({ count: 0 });

  // ── 1–2. Valid Player / Coach mirror rows ────────────────────────────────
  {
    const ref = w();
    const player = mapSpItemToMissionParticipant(MIRROR_ITEMS[0], ref);
    check('1. valid Player row maps', player !== null && ref.count === 0);
    check('1b. Player mirror deep-equals mock seed', player && deepEqual(player.participant, MOCK_SEEDS[0]),
      JSON.stringify(player?.participant));
    const coach = mapSpItemToMissionParticipant(MIRROR_ITEMS[1], w());
    check('2. valid Coach row maps', coach !== null);
    check('2b. Coach mirror deep-equals mock seed', coach && deepEqual(coach.participant, MOCK_SEEDS[1]));
  }

  // ── 3. All five roles map ────────────────────────────────────────────────
  {
    const roles = ['Player', 'Coach', 'Manager', 'Analyst', 'Staff'];
    const all = roles.map(r => mapSpItemToMissionParticipant(spItem({ ParticipantRole: r }), w()));
    check('3. all five valid roles map', all.every(m => m !== null));
    check('3b. roles preserved exactly', all.every((m, i) => m.participant.Role === roles[i]));
  }

  // ── 4–5. TR and SATR mission codes preserved ────────────────────────────
  {
    const tr = mapSpItemToMissionParticipant(spItem(), w());
    check('4. TR mission code preserved', tr?.participant.MissionID === 'TR/2026/006');
    const satr = mapSpItemToMissionParticipant(spItem({ MissionID: 'SATR/2026/003' }), w());
    check('5. SATR mission code preserved', satr?.participant.MissionID === 'SATR/2026/003');
  }

  // ── 6–8. Hard rejects ────────────────────────────────────────────────────
  check('6. missing MissionID rejected', mapSpItemToMissionParticipant(spItem({ MissionID: null }), w()) === null);
  check('6b. blank MissionID rejected', mapSpItemToMissionParticipant(spItem({ MissionID: '  ' }), w()) === null);
  check('7. missing PersonID rejected', mapSpItemToMissionParticipant(spItem({ PersonID: null }), w()) === null);
  check('8. unknown role rejected', mapSpItemToMissionParticipant(spItem({ ParticipantRole: 'Mascot' }), w()) === null);
  check('8b. null role rejected', mapSpItemToMissionParticipant(spItem({ ParticipantRole: null }), w()) === null);

  // ── 9. Blank ExternalCode → warn + empty string ──────────────────────────
  {
    const ref = w();
    const m = mapSpItemToMissionParticipant(spItem({ ExternalCode: '' }), ref);
    check('9. blank ExternalCode maps to empty string with warning',
      m !== null && m.participant.ExternalCode === '' && ref.count === 1);
  }

  // ── 10–12. PerDiemRate parsing ───────────────────────────────────────────
  {
    const num = mapSpItemToMissionParticipant(spItem({ PerDiemRate: 42.5 }), w());
    check('10. numeric PerDiemRate preserved', num?.participant.PerDiemRate === 42.5);

    const str = mapSpItemToMissionParticipant(spItem({ PerDiemRate: '35' }), w());
    check('11. string numeric PerDiemRate parsed', str?.participant.PerDiemRate === 35);

    const ref = w();
    const bad = mapSpItemToMissionParticipant(spItem({ PerDiemRate: 'thirty-five' }), ref);
    check('12. invalid PerDiemRate → warn + undefined',
      bad !== null && bad.participant.PerDiemRate === undefined && ref.count === 1);

    const absent = mapSpItemToMissionParticipant(spItem({ PerDiemRate: null }), w());
    check('12b. absent PerDiemRate → undefined, no warn', absent?.participant.PerDiemRate === undefined);
  }

  // ── 13–15. IsActive semantics ────────────────────────────────────────────
  {
    const missing = mapSpItemToMissionParticipant(spItem({ IsActive: null }), w());
    check('13. missing IsActive defaults true', missing?.isActive === true);

    const inactive = mapSpItemToMissionParticipant(spItem({ IsActive: false }), w());
    check('14. explicit false stays false at mapper level (row still valid)',
      inactive !== null && inactive.isActive === false);

    // Service-level active filtering (pure equivalent of toActiveParticipants)
    const { records } = mapSpItemsToMissionParticipants([
      spItem(),
      spItem({ PersonID: 'PER-0002', IsActive: false }),
      spItem({ PersonID: 'PER-0003', IsActive: null }),
    ]);
    const active = records.filter(r => r.isActive).map(r => r.participant);
    check('15. active filtering excludes explicit-false rows only',
      active.length === 2 && !active.some(p => p.PersonID === 'PER-0002'));
  }

  // ── 16. Title never drives identity ──────────────────────────────────────
  {
    const m = mapSpItemToMissionParticipant(
      spItem({ Title: 'WRONG/9999/999|PER-9999' }),
      w(),
    );
    check('16. misleading Title ignored — identity from columns',
      m?.participant.MissionID === 'TR/2026/006' && m?.participant.PersonID === 'PER-0001');
    const noTitle = mapSpItemToMissionParticipant(spItem({ Title: null }), w());
    check('16b. null Title still maps (Title is display-only)', noTitle !== null);
  }

  // ── 17. Real OData escaping helper ───────────────────────────────────────
  {
    check('17. TR code slash is URL-encoded',
      encodeODataLiteral('TR/2026/006') === 'TR%2F2026%2F006',
      encodeODataLiteral('TR/2026/006'));
    check("17b. apostrophe is OData-doubled", encodeODataLiteral("O'Brien") === "O''Brien",
      encodeODataLiteral("O'Brien"));
    check('17c. combined slash + apostrophe',
      encodeODataLiteral("TR/20'26") === "TR%2F20''26",
      encodeODataLiteral("TR/20'26"));
  }

  // ── 18. Batch with one malformed row ─────────────────────────────────────
  {
    const { records, result } = mapSpItemsToMissionParticipants([
      ...MIRROR_ITEMS,
      spItem({ ParticipantRole: 'Substitute' }), // malformed — unknown role
    ]);
    check('18. batch: 3 mapped, 1 rejected, 0 warnings',
      result.mapped === 3 && result.rejected === 1 && result.warnings === 0,
      JSON.stringify(result));
    check('18b. batch mirror set deep-equals mock seeds',
      deepEqual(records.map(r => r.participant), MOCK_SEEDS));
  }

  console.warn = realWarn;
  console.info = realInfo;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(`=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
