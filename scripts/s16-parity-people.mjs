/**
 * s16-parity-people.mjs
 *
 * Sprint 16 (S16-6) -- Local Mapper / Pre-SP People Parity Harness.
 *
 * Validates that spPersonMapper produces output that is field-for-field
 * identical to the mock person service for all 10 mirror records, and
 * produces the expected rejections and warnings for the 3 stress records.
 *
 * No TypeScript compiler, no tsx, no test framework required.
 * Inlines the mapper logic from spPersonMapper.ts (translated to JS)
 * and the mock data from mockData.ts.
 *
 * Date normalization:
 *   Mock data stores dates as full ISO strings ("2026-01-10T00:00:00Z").
 *   SP DateOnly columns return similar strings which normalizeSpDate reduces
 *   to "YYYY-MM-DD". This harness normalizes mock dates to date-only before
 *   field comparison -- this is an expected, documented divergence (see
 *   docs/architecture/C3People SP List Schema.md Mapper Reference).
 *
 * Run:  node scripts/s16-parity-people.mjs
 *
 * Expected exit codes:
 *   0 -- all assertions pass
 *   1 -- one or more assertions failed
 */

// ---------------------------------------------------------------------------
// 1. Mapper logic (inlined from packages/c3/src/utils/spPersonMapper.ts)
//    and the shared normalizeSpDate from dateUtils.ts
//    Translated to JS -- must stay in sync with the TS source.
// ---------------------------------------------------------------------------

function normalizeSpDate(val, context, warnRef, prefix = '[C3/Credential]') {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val !== 'string') {
    console.warn(`${prefix} ${context}: unexpected date type ${typeof val} -- treated as absent`);
    warnRef.count++;
    return undefined;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    console.warn(`${prefix} ${context}: invalid date "${val}" -- treated as absent (non-expiring)`);
    warnRef.count++;
    return undefined;
  }
  return d.toISOString().split('T')[0];
}

function parseIsActive(val, ctx, warnRef) {
  if (typeof val === 'boolean') return val;
  if (val === 1 || val === '1' || val === 'Yes' || val === 'yes') return true;
  if (val === 0 || val === '0' || val === 'No'  || val === 'no')  return false;
  console.warn(
    `[C3/People] ${ctx}.IsActive: unknown value "${val}" -- defaulting to false (inactive). ` +
    `Check SP column type; SP Yes/No should return boolean.`,
  );
  warnRef.count++;
  return false;
}

function parseTotalContracts(val, ctx, warnRef) {
  if (val === null || val === undefined) return undefined;
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) {
    console.warn(`[C3/People] ${ctx}.TotalContracts: non-numeric value "${val}" -- treated as unknown.`);
    warnRef.count++;
    return undefined;
  }
  return Math.max(0, Math.floor(n));
}

function mapSpItemToPerson(item, warnRef = { count: 0 }) {
  const ctx = `Item ${item.Id}`;

  if (!item.Title || item.Title.trim() === '') {
    console.warn(`[C3/People] ${ctx}: missing PersonID (blank Title) -- record rejected`);
    return null;
  }
  const personId = item.Title.trim();

  if (!item.FullName || item.FullName.trim() === '') {
    console.warn(
      `[C3/People] ${ctx} (${personId}): missing FullName -- record rejected. ` +
      `FullName is a required column in C3People; check SP list for data entry errors.`,
    );
    return null;
  }

  const firstContractDate  = normalizeSpDate(item.FirstContractDate,  `${ctx}.FirstContractDate`,  warnRef, '[C3/People]');
  const latestContractDate = normalizeSpDate(item.LatestContractDate, `${ctx}.LatestContractDate`, warnRef, '[C3/People]');

  return {
    Id:                item.Id,
    PersonID:          personId,
    FullName:          item.FullName.trim(),
    IGN:               item.IGN?.trim()               || undefined,
    Nationality:       item.Nationality?.trim()        || undefined,
    PrimaryRole:       item.PrimaryRole?.trim()        || undefined,
    PersonnelCode:     item.PersonnelCode?.trim()      || undefined,
    CurrentTeam:       item.CurrentTeam?.trim()        || undefined,
    CurrentGameTitle:  item.CurrentGameTitle?.trim()   || undefined,
    PrimaryDepartment: item.PrimaryDepartment?.trim()  || undefined,
    IsActive:          parseIsActive(item.IsActive, ctx, warnRef),
    FirstContractDate:  firstContractDate,
    LatestContractDate: latestContractDate,
    TotalContracts:     parseTotalContracts(item.TotalContracts, ctx, warnRef),
    Notes:             item.Notes?.trim()              || undefined,
  };
}

function mapSpItemsToPeople(items) {
  const people = [];
  let rejectedCount = 0;
  const warnRef = { count: 0 };
  for (const item of items) {
    const person = mapSpItemToPerson(item, warnRef);
    if (person === null) {
      rejectedCount++;
    } else {
      people.push(person);
    }
  }
  console.info(
    `[C3/People] listPeople: fetched ${items.length} SP records. ` +
    `Mapped: ${people.length}. Rejected: ${rejectedCount}. Warnings: ${warnRef.count}.`,
  );
  return { people, rejectedCount, warnCount: warnRef.count };
}

// ---------------------------------------------------------------------------
// 2. Mock person data (matches mockData.ts mockPeople exactly)
//    Ordered by SP insertion order (Id 1-10) per schema doc.
// ---------------------------------------------------------------------------

const mockPeople = [
  {
    Id: 1, PersonID: 'PER-0001', FullName: 'Abdulaziz Alabdullatif', IGN: 'Kakarot',
    Nationality: 'Saudi Arabia', PrimaryRole: 'Player', PersonnelCode: 'FN/PL/001',
    CurrentTeam: 'GKE Fortnite', CurrentGameTitle: 'Fortnite', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-01-10T00:00:00Z', LatestContractDate: '2026-06-21T00:00:00Z',
    TotalContracts: 2,
  },
  {
    Id: 2, PersonID: 'PER-0003', FullName: 'Diab Hassan', IGN: 'Diab',
    Nationality: 'Morocco', PrimaryRole: 'Graphic Designer', PersonnelCode: 'CR/GD/002',
    CurrentTeam: 'Creative', CurrentGameTitle: undefined, PrimaryDepartment: 'Creative',
    IsActive: true, FirstContractDate: '2025-09-01T00:00:00Z', LatestContractDate: '2025-09-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 3, PersonID: 'PER-0002', FullName: 'Mohammad Alkhalailah', IGN: 'Klownz',
    Nationality: 'Jordan', PrimaryRole: 'Player Operations Manager', PersonnelCode: 'OP/OP/001',
    CurrentTeam: 'Operations', CurrentGameTitle: undefined, PrimaryDepartment: 'Operations',
    IsActive: true, FirstContractDate: '2026-02-15T00:00:00Z', LatestContractDate: '2026-06-21T00:00:00Z',
    TotalContracts: 2,
  },
  {
    Id: 4, PersonID: 'PER-0004', FullName: 'Elaf Hussein', IGN: 'Elaf',
    Nationality: 'Morocco', PrimaryRole: 'Performance Analyst', PersonnelCode: 'PG/AN/001',
    CurrentTeam: 'GKA PUBG', CurrentGameTitle: 'PUBG Mobile', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-01-15T00:00:00Z', LatestContractDate: '2026-01-15T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 5, PersonID: 'PER-0005', FullName: 'Bechir Mettali', IGN: 'Boch',
    Nationality: 'Tunisia', PrimaryRole: 'Performance Analyst', PersonnelCode: 'LL/AN/002',
    CurrentTeam: 'GKA League of Legends', CurrentGameTitle: 'League of Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-03-01T00:00:00Z', LatestContractDate: '2026-03-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 6, PersonID: 'PER-0006', FullName: 'Sari Al-Khatib', IGN: 'Sari',
    Nationality: 'Jordan', PrimaryRole: 'Graphic Designer', PersonnelCode: 'CR/GD/001',
    CurrentTeam: 'Creative', CurrentGameTitle: undefined, PrimaryDepartment: 'Creative',
    IsActive: true, FirstContractDate: '2026-02-01T00:00:00Z', LatestContractDate: '2026-02-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 7, PersonID: 'PER-0007', FullName: 'Nadia Khoury', IGN: 'Nadia',
    Nationality: 'Lebanon', PrimaryRole: 'Video Editor', PersonnelCode: 'CR/VE/003',
    CurrentTeam: 'Creative', CurrentGameTitle: undefined, PrimaryDepartment: 'Creative',
    IsActive: true, FirstContractDate: '2026-02-01T00:00:00Z', LatestContractDate: '2026-02-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 8, PersonID: 'PER-0008', FullName: 'Keon Williams', IGN: 'Keon',
    Nationality: 'United States', PrimaryRole: 'Player', PersonnelCode: 'AL/PL/001',
    CurrentTeam: 'GKA Apex Legends', CurrentGameTitle: 'Apex Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-04-01T00:00:00Z', LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 9, PersonID: 'PER-0009', FullName: 'Jamison Moore', IGN: 'Jxmo',
    Nationality: 'United States', PrimaryRole: 'Head Coach', PersonnelCode: 'AL/CH/001',
    CurrentTeam: 'GKA Apex Legends', CurrentGameTitle: 'Apex Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-04-01T00:00:00Z', LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 10, PersonID: 'PER-0010', FullName: 'Tyler Johnson', IGN: 'Phantom',
    Nationality: 'United States', PrimaryRole: 'Player', PersonnelCode: 'AL/PL/002',
    CurrentTeam: 'GKA Apex Legends', CurrentGameTitle: 'Apex Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-04-01T00:00:00Z', LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1,
  },
];

// ---------------------------------------------------------------------------
// 3. SP test dataset -- 10 mirror records + 3 stress records
//    (matches docs/architecture/C3People SP List Schema.md Minimum Test Dataset)
//
//    SP DateOnly columns return ISO-like strings with T00:00:00Z suffix.
//    All other fields match list schema internal names exactly.
//    Note: Title = PersonID (not FullName). CurrentTeam/CurrentGameTitle/
//    PrimaryDepartment are plain text, not SP Lookup objects.
// ---------------------------------------------------------------------------

const SP_MIRROR_RECORDS = [
  {
    Id: 1,  Title: 'PER-0001', FullName: 'Abdulaziz Alabdullatif', IGN: 'Kakarot',
    Nationality: 'Saudi Arabia', PrimaryRole: 'Player', PersonnelCode: 'FN/PL/001',
    CurrentTeam: 'GKE Fortnite', CurrentGameTitle: 'Fortnite', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-01-10T00:00:00Z', LatestContractDate: '2026-06-21T00:00:00Z',
    TotalContracts: 2, Notes: null,
  },
  {
    Id: 2,  Title: 'PER-0003', FullName: 'Diab Hassan', IGN: 'Diab',
    Nationality: 'Morocco', PrimaryRole: 'Graphic Designer', PersonnelCode: 'CR/GD/002',
    CurrentTeam: 'Creative', CurrentGameTitle: null, PrimaryDepartment: 'Creative',
    IsActive: true, FirstContractDate: '2025-09-01T00:00:00Z', LatestContractDate: '2025-09-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 3,  Title: 'PER-0002', FullName: 'Mohammad Alkhalailah', IGN: 'Klownz',
    Nationality: 'Jordan', PrimaryRole: 'Player Operations Manager', PersonnelCode: 'OP/OP/001',
    CurrentTeam: 'Operations', CurrentGameTitle: null, PrimaryDepartment: 'Operations',
    IsActive: true, FirstContractDate: '2026-02-15T00:00:00Z', LatestContractDate: '2026-06-21T00:00:00Z',
    TotalContracts: 2, Notes: null,
  },
  {
    Id: 4,  Title: 'PER-0004', FullName: 'Elaf Hussein', IGN: 'Elaf',
    Nationality: 'Morocco', PrimaryRole: 'Performance Analyst', PersonnelCode: 'PG/AN/001',
    CurrentTeam: 'GKA PUBG', CurrentGameTitle: 'PUBG Mobile', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-01-15T00:00:00Z', LatestContractDate: '2026-01-15T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 5,  Title: 'PER-0005', FullName: 'Bechir Mettali', IGN: 'Boch',
    Nationality: 'Tunisia', PrimaryRole: 'Performance Analyst', PersonnelCode: 'LL/AN/002',
    CurrentTeam: 'GKA League of Legends', CurrentGameTitle: 'League of Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-03-01T00:00:00Z', LatestContractDate: '2026-03-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 6,  Title: 'PER-0006', FullName: 'Sari Al-Khatib', IGN: 'Sari',
    Nationality: 'Jordan', PrimaryRole: 'Graphic Designer', PersonnelCode: 'CR/GD/001',
    CurrentTeam: 'Creative', CurrentGameTitle: null, PrimaryDepartment: 'Creative',
    IsActive: true, FirstContractDate: '2026-02-01T00:00:00Z', LatestContractDate: '2026-02-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 7,  Title: 'PER-0007', FullName: 'Nadia Khoury', IGN: 'Nadia',
    Nationality: 'Lebanon', PrimaryRole: 'Video Editor', PersonnelCode: 'CR/VE/003',
    CurrentTeam: 'Creative', CurrentGameTitle: null, PrimaryDepartment: 'Creative',
    IsActive: true, FirstContractDate: '2026-02-01T00:00:00Z', LatestContractDate: '2026-02-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 8,  Title: 'PER-0008', FullName: 'Keon Williams', IGN: 'Keon',
    Nationality: 'United States', PrimaryRole: 'Player', PersonnelCode: 'AL/PL/001',
    CurrentTeam: 'GKA Apex Legends', CurrentGameTitle: 'Apex Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-04-01T00:00:00Z', LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 9,  Title: 'PER-0009', FullName: 'Jamison Moore', IGN: 'Jxmo',
    Nationality: 'United States', PrimaryRole: 'Head Coach', PersonnelCode: 'AL/CH/001',
    CurrentTeam: 'GKA Apex Legends', CurrentGameTitle: 'Apex Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-04-01T00:00:00Z', LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
  {
    Id: 10, Title: 'PER-0010', FullName: 'Tyler Johnson', IGN: 'Phantom',
    Nationality: 'United States', PrimaryRole: 'Player', PersonnelCode: 'AL/PL/002',
    CurrentTeam: 'GKA Apex Legends', CurrentGameTitle: 'Apex Legends', PrimaryDepartment: 'Esports',
    IsActive: true, FirstContractDate: '2026-04-01T00:00:00Z', LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1, Notes: null,
  },
];

const SP_STRESS_RECORDS = [
  // Item 11: blank Title -> hard reject (missing PersonID)
  {
    Id: 11, Title: '',         FullName: 'Missing PersonID', IGN: null,
    Nationality: null, PrimaryRole: null, PersonnelCode: null,
    CurrentTeam: null, CurrentGameTitle: null, PrimaryDepartment: null,
    IsActive: true, FirstContractDate: null, LatestContractDate: null,
    TotalContracts: null, Notes: 'stress: hard reject -- missing PersonID',
  },
  // Item 12: inactive person (IsActive = string 'No') -> mapper does NOT reject.
  // Service layer filters via $filter=IsActive eq 1 at SP query level.
  // normalizeIsActive handles 'No' silently (no warn -- it is a known string alias).
  {
    Id: 12, Title: 'PER-9999', FullName: 'Inactive Test Person', IGN: null,
    Nationality: null, PrimaryRole: null, PersonnelCode: null,
    CurrentTeam: null, CurrentGameTitle: null, PrimaryDepartment: null,
    IsActive: 'No', FirstContractDate: null, LatestContractDate: null,
    TotalContracts: null, Notes: 'stress: inactive -- mapper passes through, service filters',
  },
  // Item 13: blank FullName -> hard reject
  {
    Id: 13, Title: 'PER-INVALID', FullName: '',   IGN: null,
    Nationality: null, PrimaryRole: null, PersonnelCode: null,
    CurrentTeam: null, CurrentGameTitle: null, PrimaryDepartment: null,
    IsActive: true, FirstContractDate: null, LatestContractDate: null,
    TotalContracts: null, Notes: 'stress: hard reject -- missing FullName',
  },
  // Item 14: invalid date string -> soft warn on FirstContractDate; date mapped to undefined.
  // LatestContractDate is null (absent) -> undefined silently.
  {
    Id: 14, Title: 'PER-S14', FullName: 'Bad Date Person', IGN: null,
    Nationality: null, PrimaryRole: null, PersonnelCode: null,
    CurrentTeam: null, CurrentGameTitle: null, PrimaryDepartment: null,
    IsActive: true, FirstContractDate: 'not-a-date', LatestContractDate: null,
    TotalContracts: 1, Notes: 'stress: invalid date -> soft warn + undefined',
  },
  // Item 15: non-numeric TotalContracts -> soft warn; value mapped to undefined.
  {
    Id: 15, Title: 'PER-S15', FullName: 'Bad Count Person', IGN: null,
    Nationality: null, PrimaryRole: null, PersonnelCode: null,
    CurrentTeam: null, CurrentGameTitle: null, PrimaryDepartment: null,
    IsActive: true, FirstContractDate: null, LatestContractDate: null,
    TotalContracts: 'corrupt-NaN', Notes: 'stress: non-numeric TotalContracts -> soft warn + undefined',
  },
  // Item 16: unknown IsActive value -> soft warn; falls back to false (inactive safe default).
  {
    Id: 16, Title: 'PER-S16', FullName: 'Unknown Active Person', IGN: null,
    Nationality: null, PrimaryRole: null, PersonnelCode: null,
    CurrentTeam: null, CurrentGameTitle: null, PrimaryDepartment: null,
    IsActive: 'maybe', FirstContractDate: null, LatestContractDate: null,
    TotalContracts: null, Notes: 'stress: unknown IsActive -> soft warn + IsActive=false',
  },
];

const ALL_SP_RECORDS = [...SP_MIRROR_RECORDS, ...SP_STRESS_RECORDS];

// ---------------------------------------------------------------------------
// 4. Assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ' -- ' + detail : ''}`);
    failed++;
  }
}

/**
 * Normalize a date field for comparison.
 * Mock data stores full ISO strings; SP-mapped output stores date-only strings.
 * Strip the time component before comparing.
 */
function normDate(val) {
  if (!val) return undefined;
  return String(val).split('T')[0]; // "2026-01-10T00:00:00Z" -> "2026-01-10"
}

// Fields requiring date normalization before comparison
const DATE_FIELDS = new Set(['FirstContractDate', 'LatestContractDate']);

// ---------------------------------------------------------------------------
// 5. Phase A -- Mirror record parity
//    SP mirror records -> mapper -> compare field-by-field with mock
// ---------------------------------------------------------------------------

console.log('\n════════════════════════════════════════════════════════════');
console.log(' S16-6 -- Local Mapper / Pre-SP People Parity Harness');
console.log('════════════════════════════════════════════════════════════\n');

console.log('Scope: validates mapper logic, mock-vs-SP-shaped data parity,');
console.log('        count/field comparison, and stress guards.');
console.log('NOT validated here: real SP fetch, REST response shape, SP query filters.');
console.log('The real S16-7 runs after C3People list is provisioned.\n');

console.log('-- A1: Mirror records (10) through mapper (simulated SP REST response) --\n');

const { people: spMirrorPeople, rejectedCount: mirrorRejected, warnCount: mirrorWarns }
  = mapSpItemsToPeople(SP_MIRROR_RECORDS);

console.log('\n-- A2: Record count assertions --\n');
assert(spMirrorPeople.length === 10, 'Mirror: 10 persons mapped from 10 SP items');
assert(mirrorRejected === 0,         'Mirror: 0 records rejected');
assert(mirrorWarns === 0,            'Mirror: 0 warnings');

console.log('\n-- A3: Field-level parity (SP-mapped vs mock) --\n');

const COMPARE_FIELDS = [
  'Id', 'PersonID', 'FullName', 'IGN',
  'Nationality', 'PrimaryRole', 'PersonnelCode',
  'CurrentTeam', 'CurrentGameTitle', 'PrimaryDepartment',
  'IsActive',
  'FirstContractDate', 'LatestContractDate',
  'TotalContracts',
];

for (const mock of mockPeople) {
  const sp = spMirrorPeople.find(p => p.PersonID === mock.PersonID);
  if (!sp) {
    assert(false, `${mock.PersonID}: found in SP-mapped output`);
    continue;
  }
  for (const field of COMPARE_FIELDS) {
    const mv = DATE_FIELDS.has(field)
      ? normDate(mock[field])
      : (mock[field] ?? undefined);
    const sv = sp[field] ?? undefined;
    assert(
      mv === sv,
      `${mock.PersonID}.${field}: mock="${mv}" sp="${sv}"`,
      mv !== sv ? `MISMATCH: mock="${mv}" vs sp="${sv}"` : '',
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Phase C -- Stress records
// ---------------------------------------------------------------------------

console.log('\n-- C1: Full dataset (16 records) through mapper --\n');

const { people: allPeople, rejectedCount: allRejected, warnCount: allWarns }
  = mapSpItemsToPeople(ALL_SP_RECORDS);

console.log('\n-- C2: Stress record assertions (hard rejects + pass-throughs) --\n');

// Expected:
//   10 mirror + 4 stress pass-throughs (Items 12, 14, 15, 16) = 14 mapped
//   2 hard rejects (Items 11 -- blank Title, 13 -- blank FullName)
//   3 soft warns (Item 14 -- invalid date, Item 15 -- bad TotalContracts, Item 16 -- unknown IsActive)
assert(allPeople.length === 14,  'Full dataset: 14 persons mapped (10 mirror + 4 stress pass-throughs)');
assert(allRejected === 2,        'Full dataset: 2 records rejected (Item 11 -- missing PersonID, Item 13 -- missing FullName)');
assert(allWarns === 3,           'Full dataset: 3 warnings (Item 14 invalid date, Item 15 bad TotalContracts, Item 16 unknown IsActive)');

// Item 11: missing PersonID -> not in output
assert(
  !allPeople.find(p => p.Id === 11),
  'Item 11: absent from mapped output (correctly rejected -- blank Title)',
);

// Item 12: inactive (IsActive='No') -> present in output with IsActive=false, no warn
const item12 = allPeople.find(p => p.PersonID === 'PER-9999');
assert(!!item12,                   'Item 12: present in mapped output (inactive records not rejected by mapper)');
assert(item12?.IsActive === false,  'Item 12: IsActive mapped to false (string "No" -> boolean false, no warn)');

// Item 13: blank FullName -> not in output
assert(
  !allPeople.find(p => p.Id === 13),
  'Item 13: absent from mapped output (correctly rejected -- blank FullName)',
);

console.log('\n-- C3: Soft-error stress record assertions --\n');

// Item 14: invalid date -> mapped (not rejected); FirstContractDate = undefined; 1 warn
const item14 = allPeople.find(p => p.PersonID === 'PER-S14');
assert(!!item14,                              'Item 14: present in mapped output (invalid date is soft error -- not a rejection)');
assert(item14?.FirstContractDate === undefined, 'Item 14: FirstContractDate is undefined (invalid date "not-a-date" -> non-expiring)');
assert(item14?.LatestContractDate === undefined, 'Item 14: LatestContractDate is undefined (null input -> absent field)');
assert(item14?.TotalContracts === 1,            'Item 14: TotalContracts=1 mapped correctly (only date was invalid)');

// Item 15: non-numeric TotalContracts -> mapped (not rejected); TotalContracts = undefined; 1 warn
const item15 = allPeople.find(p => p.PersonID === 'PER-S15');
assert(!!item15,                               'Item 15: present in mapped output (bad TotalContracts is soft error -- not a rejection)');
assert(item15?.TotalContracts === undefined,    'Item 15: TotalContracts is undefined (non-numeric corrupt-NaN value treated as unknown)');
assert(item15?.FirstContractDate === undefined, 'Item 15: FirstContractDate is undefined (null input, absent field)');

// Item 16: unknown IsActive -> mapped (not rejected); IsActive = false; 1 warn
const item16 = allPeople.find(p => p.PersonID === 'PER-S16');
assert(!!item16,                   'Item 16: present in mapped output (unknown IsActive is soft error, not a rejection)');
assert(item16?.IsActive === false,  'Item 16: IsActive is false (unknown value "maybe" -> safe fallback false + warn)');

// ---------------------------------------------------------------------------
// 7. Phase D -- Mirror set structural checks
// ---------------------------------------------------------------------------

console.log('\n-- D: Mirror set structural checks --\n');

// All 10 PersonIDs accounted for
const expectedPersonIDs = new Set(mockPeople.map(p => p.PersonID));
const mappedPersonIDs   = new Set(spMirrorPeople.map(p => p.PersonID));
assert(
  expectedPersonIDs.size === mappedPersonIDs.size &&
    [...expectedPersonIDs].every(id => mappedPersonIDs.has(id)),
  'All 10 PersonIDs present in mapped output: ' + [...expectedPersonIDs].sort().join(', '),
);

// SP Id -> Person.Id preserved (SP item Id must flow through as Person.Id)
for (const spItem of SP_MIRROR_RECORDS) {
  const sp = spMirrorPeople.find(p => p.PersonID === spItem.Title);
  assert(
    sp?.Id === spItem.Id,
    spItem.Title + ': SP item Id ' + spItem.Id + ' preserved as Person.Id',
    sp ? 'got Person.Id=' + sp.Id : 'not found',
  );
}

// No SP Lookup objects leaked into plain-text fields
for (const person of spMirrorPeople) {
  for (const field of ['CurrentTeam', 'CurrentGameTitle', 'PrimaryDepartment']) {
    const val = person[field];
    assert(
      val === undefined || typeof val === 'string',
      person.PersonID + '.' + field + ': plain string or undefined (not a SP Lookup object)',
      val !== undefined && typeof val !== 'string' ? 'got ' + typeof val : '',
    );
  }
}

// Date fields are date-only strings (YYYY-MM-DD), not full ISO
for (const person of spMirrorPeople) {
  for (const field of ['FirstContractDate', 'LatestContractDate']) {
    const val = person[field];
    if (val !== undefined) {
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(val),
        person.PersonID + '.' + field + ': date-only format "YYYY-MM-DD" (got "' + val + '")',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Summary
// ---------------------------------------------------------------------------

console.log('\n============================================================');
console.log(' RESULTS:  ' + passed + ' passed   ' + failed + ' failed');
console.log('============================================================\n');

console.log('Metrics:');
console.log('  Mirror set  -- fetched: 10  mapped: ' + spMirrorPeople.length + '  rejected: ' + mirrorRejected + '  warnings: ' + mirrorWarns);
console.log('  Full set    -- fetched: 16  mapped: ' + allPeople.length + '  rejected: ' + allRejected + '  warnings: ' + allWarns);
console.log('');
console.log('Date normalization: mock ISO dates normalized to YYYY-MM-DD before comparison.');
console.log('  This is expected -- SP DateOnly columns produce date-only output via normalizeSpDate.');
console.log('  The real S16-7 SP parity run will use actual SP REST response values.');
console.log('');

if (failed > 0) {
  process.exit(1);
}
