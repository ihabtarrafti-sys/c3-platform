/**
 * s28-parity-logistics.mjs
 *
 * Sprint 28 (S28-8) — Apparel profile + kit assignment mapper parity harness.
 *
 * Follows the s27 pattern: COMPILES THE ACTUAL PRODUCTION SOURCE via esbuild
 * (from the existing Vite toolchain — no new packages) and exercises it
 * directly. No inline-translated copy to drift.
 *
 * Compiled entry points:
 *   packages/c3/src/utils/spApparelProfileMapper.ts
 *   packages/c3/src/utils/spKitAssignmentMapper.ts
 *
 * Temporary bundle output goes to the OS temp directory and is removed in a
 * finally block — nothing is left in the repo.
 *
 * Mirror records mirror the Mock DSM seeds (MockApparelProfileService /
 * MockMissionService.MOCK_KIT_ASSIGNMENTS) — mapped output must deep-equal
 * the mock records.
 *
 * Run: node scripts/s28-parity-logistics.mjs
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

const tmp = mkdtempSync(join(tmpdir(), 's28-parity-'));

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

let nextId = 1;

/** Fully-valid raw apparel SP item; overrides simulate defects. */
function apparelItem(overrides = {}) {
  return {
    Id: nextId++,
    Title: 'PER-0001',
    PersonID: 'PER-0001',
    JerseySize: 'L',
    NameOnJersey: 'ABDULAZIZ',
    Notes: 'Prefers athletic fit.',
    IsActive: true,
    ...overrides,
  };
}

/** Fully-valid raw kit SP item; overrides simulate defects. */
function kitItem(overrides = {}) {
  return {
    Id: nextId++,
    Title: 'TR/2026/006|PER-0001|Jersey|HOME-2026',
    MissionID: 'TR/2026/006',
    PersonID: 'PER-0001',
    ItemCategory: 'Jersey',
    AssignmentKey: 'HOME-2026',
    ItemDescription: 'Home jersey 2026',
    KitStatus: 'Delivered',
    JerseyNumber: '7',
    OwnerEmail: 'ops.coordinator@geekay.gg',
    IsActive: true,
    ...overrides,
  };
}

// Mock seed mirrors (must deep-equal mapper output for the mirror sets)
const MOCK_APPAREL_SEEDS = [
  { PersonID: 'PER-0001', JerseySize: 'L', NameOnJersey: 'ABDULAZIZ', Notes: 'Prefers athletic fit.' },
  { PersonID: 'PER-0002', JerseySize: 'M', NameOnJersey: 'ALKHALAILAH', Notes: undefined },
];

const MOCK_KIT_SEEDS = [
  { MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Jersey', AssignmentKey: 'HOME-2026', ItemDescription: 'Home jersey 2026', Status: 'Delivered', JerseyNumber: '7', OwnerEmail: 'ops.coordinator@geekay.gg' },
  { MissionID: 'TR/2026/006', PersonID: 'PER-0001', ItemCategory: 'Equipment', AssignmentKey: 'CONTROLLER-01', ItemDescription: 'Controller', Status: 'Confirmed', JerseyNumber: undefined, OwnerEmail: 'ops.coordinator@geekay.gg' },
  { MissionID: 'TR/2026/006', PersonID: 'PER-0002', ItemCategory: 'Jersey', AssignmentKey: 'HOME-2026', ItemDescription: 'Home jersey 2026', Status: 'Ordered', JerseyNumber: undefined, OwnerEmail: 'ops.coordinator@geekay.gg' },
  { MissionID: 'SATR/2026/003', PersonID: 'PER-0004', ItemCategory: 'Jersey', AssignmentKey: 'HOME-2026', ItemDescription: 'Home jersey 2026', Status: 'NotOrdered', JerseyNumber: undefined, OwnerEmail: undefined },
];

try {
  const apparelMod = compile('utils/spApparelProfileMapper.ts', 'apparel.cjs');
  const kitMod = compile('utils/spKitAssignmentMapper.ts', 'kit.cjs');
  const serviceMod = compile('services/sharepoint/SharePointMissionService.ts', 'service.cjs');
  const { mapSpItemToApparelProfile, mapSpItemsToApparelProfiles } = apparelMod;
  const { mapSpItemToKitAssignment, mapSpItemsToKitAssignments } = kitMod;
  const { encodeODataLiteral } = serviceMod;

  const realWarn = console.warn;
  const realInfo = console.info;
  console.warn = () => {};
  console.info = () => {};

  const w = () => ({ count: 0 });

  // ═══════════════════════════════ APPAREL ═══════════════════════════════

  // A1. Valid profile + mirror parity
  {
    const ref = w();
    const m = mapSpItemToApparelProfile(apparelItem(), ref);
    check('A1. valid profile maps with no warnings', m !== null && ref.count === 0);
    check('A1b. PER-0001 mirror deep-equals mock seed', m && deepEqual(m.profile, MOCK_APPAREL_SEEDS[0]),
      JSON.stringify(m?.profile));
    const m2 = mapSpItemToApparelProfile(
      apparelItem({ Title: 'PER-0002', PersonID: 'PER-0002', JerseySize: 'M', NameOnJersey: 'ALKHALAILAH', Notes: null }),
      w(),
    );
    check('A1c. PER-0002 mirror deep-equals mock seed', m2 && deepEqual(m2.profile, MOCK_APPAREL_SEEDS[1]));
  }

  // A2. Missing PersonID rejection
  check('A2. missing PersonID rejected', mapSpItemToApparelProfile(apparelItem({ PersonID: null }), w()) === null);
  check('A2b. blank PersonID rejected', mapSpItemToApparelProfile(apparelItem({ PersonID: '  ' }), w()) === null);

  // A3. Every valid JerseySize
  {
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
    const all = sizes.map(s => mapSpItemToApparelProfile(apparelItem({ JerseySize: s }), w()));
    check('A3. all seven valid sizes map', all.every((m, i) => m !== null && m.profile.JerseySize === sizes[i]));
  }

  // A4. Unknown JerseySize → warn + degrade (profile survives)
  {
    const ref = w();
    const m = mapSpItemToApparelProfile(apparelItem({ JerseySize: 'XXXL' }), ref);
    check('A4. unknown size warns and degrades to undefined',
      m !== null && m.profile.JerseySize === undefined && ref.count === 1);
  }

  // A5. NameOnJersey trimmed
  {
    const m = mapSpItemToApparelProfile(apparelItem({ NameOnJersey: '  ABDULAZIZ  ' }), w());
    check('A5. NameOnJersey trimmed', m?.profile.NameOnJersey === 'ABDULAZIZ');
  }

  // A6. IsActive semantics
  {
    const missing = mapSpItemToApparelProfile(apparelItem({ IsActive: null }), w());
    check('A6. missing IsActive defaults true', missing?.isActive === true);
    const inactive = mapSpItemToApparelProfile(apparelItem({ IsActive: false }), w());
    check('A6b. explicit false stays false at persistence level (row still valid)',
      inactive !== null && inactive.isActive === false);
    const { records } = mapSpItemsToApparelProfiles([
      apparelItem(),
      apparelItem({ PersonID: 'PER-0009', IsActive: false }),
    ]);
    const active = records.filter(r => r.isActive);
    check('A6c. service-equivalent active filter excludes explicit-false',
      active.length === 1 && active[0].profile.PersonID === 'PER-0001');
  }

  // A7. Title never identity
  {
    const m = mapSpItemToApparelProfile(apparelItem({ Title: 'PER-9999' }), w());
    check('A7. misleading Title ignored — identity from PersonID column',
      m?.profile.PersonID === 'PER-0001');
  }

  // ═══════════════════════════════ KIT ═══════════════════════════════════

  // K1. All ItemCategory values
  {
    const cats = ['Jersey', 'Apparel', 'Equipment'];
    const all = cats.map(c => mapSpItemToKitAssignment(kitItem({ ItemCategory: c }), w()));
    check('K1. all three categories map', all.every((m, i) => m !== null && m.assignment.ItemCategory === cats[i]));
  }

  // K2. All KitStatus values
  {
    const statuses = ['NotOrdered', 'Ordered', 'Shipped', 'Delivered', 'Confirmed', 'Returned', 'Replaced', 'Missing'];
    const all = statuses.map(s => mapSpItemToKitAssignment(kitItem({ KitStatus: s }), w()));
    check('K2. all eight statuses map', all.every((m, i) => m !== null && m.assignment.Status === statuses[i]));
  }

  // K3–K7. Hard rejects
  check('K3. missing MissionID rejected', mapSpItemToKitAssignment(kitItem({ MissionID: null }), w()) === null);
  check('K4. missing PersonID rejected', mapSpItemToKitAssignment(kitItem({ PersonID: '' }), w()) === null);
  check('K5. missing AssignmentKey rejected', mapSpItemToKitAssignment(kitItem({ AssignmentKey: null }), w()) === null);
  check('K5b. blank AssignmentKey rejected', mapSpItemToKitAssignment(kitItem({ AssignmentKey: '   ' }), w()) === null);
  check('K6. unknown category rejected', mapSpItemToKitAssignment(kitItem({ ItemCategory: 'Footwear' }), w()) === null);
  check('K7. unknown status rejected', mapSpItemToKitAssignment(kitItem({ KitStatus: 'Lost' }), w()) === null);

  // K8. Multiples in same category via distinct AssignmentKeys
  {
    const { records, result } = mapSpItemsToKitAssignments([
      kitItem({ AssignmentKey: 'HOME-2026' }),
      kitItem({ AssignmentKey: 'AWAY-2026', ItemDescription: 'Away jersey 2026', KitStatus: 'Ordered' }),
    ]);
    check('K8. two same-category rows with distinct keys both map',
      result.mapped === 2 && records[0].assignment.AssignmentKey === 'HOME-2026' &&
      records[1].assignment.AssignmentKey === 'AWAY-2026');
  }

  // K9. Same key, different description = same conceptual identity
  {
    const a = mapSpItemToKitAssignment(kitItem({ ItemDescription: 'Home jersey 2026' }), w());
    const b = mapSpItemToKitAssignment(kitItem({ ItemDescription: 'HOME JERSEY (2026 season)' }), w());
    const identity = m => `${m.assignment.MissionID}|${m.assignment.PersonID}|${m.assignment.ItemCategory}|${m.assignment.AssignmentKey}`;
    check('K9. description edits do not change conceptual identity',
      a !== null && b !== null && identity(a) === identity(b) &&
      a.assignment.ItemDescription !== b.assignment.ItemDescription);
  }

  // K10. Title never identity
  {
    const m = mapSpItemToKitAssignment(kitItem({ Title: 'WRONG|WRONG|WRONG|WRONG' }), w());
    check('K10. misleading Title ignored — identity from columns',
      m?.assignment.MissionID === 'TR/2026/006' && m?.assignment.AssignmentKey === 'HOME-2026');
    const noTitle = mapSpItemToKitAssignment(kitItem({ Title: null }), w());
    check('K10b. null Title still maps (display-only)', noTitle !== null);
  }

  // K11. AssignmentKey trimmed, casing preserved
  {
    const m = mapSpItemToKitAssignment(kitItem({ AssignmentKey: '  Home-2026  ' }), w());
    check('K11. AssignmentKey trimmed with casing preserved', m?.assignment.AssignmentKey === 'Home-2026');
  }

  // K12. JerseyNumber preserved as trimmed text; blank → undefined
  {
    const m = mapSpItemToKitAssignment(kitItem({ JerseyNumber: ' 7 ' }), w());
    check('K12. JerseyNumber trimmed', m?.assignment.JerseyNumber === '7');
    const blank = mapSpItemToKitAssignment(kitItem({ JerseyNumber: '' }), w());
    check('K12b. blank JerseyNumber → undefined', blank?.assignment.JerseyNumber === undefined);
  }

  // K13. OwnerEmail: blank silent; malformed warns but preserved
  {
    const blank = mapSpItemToKitAssignment(kitItem({ OwnerEmail: null }), w());
    check('K13. blank OwnerEmail → undefined, no reject', blank !== null && blank.assignment.OwnerEmail === undefined);
    const ref = w();
    const malformed = mapSpItemToKitAssignment(kitItem({ OwnerEmail: 'ops-coordinator' }), ref);
    check('K13b. malformed OwnerEmail warns and is preserved',
      malformed !== null && malformed.assignment.OwnerEmail === 'ops-coordinator' && ref.count === 1);
  }

  // K14. IsActive semantics + service-equivalent filtering
  {
    const missing = mapSpItemToKitAssignment(kitItem({ IsActive: null }), w());
    check('K14. missing IsActive defaults true', missing?.isActive === true);
    const { records } = mapSpItemsToKitAssignments([
      kitItem(),
      kitItem({ AssignmentKey: 'OLD-2025', IsActive: false }),
    ]);
    const active = records.filter(r => r.isActive).map(r => r.assignment);
    check('K14b. active filter excludes explicit-false rows only',
      active.length === 1 && active[0].AssignmentKey === 'HOME-2026');
  }

  // K15. Batch with one malformed row + mock-seed mirror parity
  {
    const mirrors = [
      kitItem(),
      kitItem({ Title: 'TR/2026/006|PER-0001|Equipment|CONTROLLER-01', ItemCategory: 'Equipment', AssignmentKey: 'CONTROLLER-01', ItemDescription: 'Controller', KitStatus: 'Confirmed', JerseyNumber: null }),
      kitItem({ Title: 'TR/2026/006|PER-0002|Jersey|HOME-2026', PersonID: 'PER-0002', KitStatus: 'Ordered', JerseyNumber: null }),
      kitItem({ Title: 'SATR/2026/003|PER-0004|Jersey|HOME-2026', MissionID: 'SATR/2026/003', PersonID: 'PER-0004', KitStatus: 'NotOrdered', JerseyNumber: null, OwnerEmail: null }),
    ];
    const { records, result } = mapSpItemsToKitAssignments([
      ...mirrors,
      kitItem({ ItemCategory: 'Vehicle' }), // malformed — unknown category
    ]);
    check('K15. batch: 4 mapped, 1 rejected, 0 warnings',
      result.mapped === 4 && result.rejected === 1 && result.warnings === 0,
      JSON.stringify(result));
    check('K15b. batch mirror set deep-equals mock seeds',
      deepEqual(records.map(r => r.assignment), MOCK_KIT_SEEDS),
      JSON.stringify(records.map(r => r.assignment)));
  }

  // K16. Real OData escaping helper (used by both kit and apparel queries)
  {
    check('K16. TR code slash URL-encoded', encodeODataLiteral('TR/2026/006') === 'TR%2F2026%2F006');
    check("K16b. apostrophe OData-doubled", encodeODataLiteral("O'Brien") === "O''Brien");
  }

  console.warn = realWarn;
  console.info = realInfo;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(`=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
