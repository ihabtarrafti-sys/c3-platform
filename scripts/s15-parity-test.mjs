/**
 * s15-parity-test.mjs
 *
 * Sprint 15 (S15-5A) — Local Mapper / Pre-SP Parity Harness.
 *
 * Validates that spCredentialMapper produces output that is field-for-field
 * identical to the mock credential service for the 7 mirror records, and
 * produces the expected rejections and warnings for the 3 stress records.
 *
 * No TypeScript compiler, no tsx, no test framework required.
 * Inlines the mapper logic from spCredentialMapper.ts (translated to JS)
 * and the mock data from MockCredentialService.ts.
 *
 * Run:  node scripts/s15-parity-test.mjs
 *
 * Expected exit codes:
 *   0 — all assertions pass
 *   1 — one or more assertions failed
 */

// ---------------------------------------------------------------------------
// 1. Mapper logic (inlined from packages/c3/src/utils/spCredentialMapper.ts)
// ---------------------------------------------------------------------------

const VALID_CREDENTIAL_TYPES = new Set([
  'Passport', 'NationalID', 'EmiratesID', 'Iqama', 'ResidencePermit', 'DriversLicense',
  'Visa', 'EntryPermit',
  'WorkPermit', 'LabourCard',
  'LeagueRegistration', 'FederationLicense', 'TransferClearance',
  'InsuranceCard', 'MedicalClearance',
  'BankAccount', 'TaxNumber',
  'Other',
]);

function isValidCredentialType(val) {
  return typeof val === 'string' && VALID_CREDENTIAL_TYPES.has(val);
}

function normalizeSpDate(val, context, warnRef) {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val !== 'string') {
    console.warn(`[C3/Credential] ${context}: unexpected date type ${typeof val} — treated as absent`);
    warnRef.count++;
    return undefined;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    console.warn(`[C3/Credential] ${context}: invalid date "${val}" — treated as absent (non-expiring)`);
    warnRef.count++;
    return undefined;
  }
  return d.toISOString().split('T')[0];
}

function parseIsActive(val) {
  if (typeof val === 'boolean') return val;
  if (val === 1 || val === '1' || val === 'Yes' || val === 'yes') return true;
  if (val === 0 || val === '0' || val === 'No'  || val === 'no')  return false;
  return false;
}

function mapSpItemToCredential(item, warnRef = { count: 0 }) {
  const ctx = `Item ${item.ID}`;
  if (!item.HolderPersonID || item.HolderPersonID.trim() === '') {
    console.warn(`[C3/Credential] ${ctx}: missing HolderPersonID — record rejected`);
    return null;
  }
  const credentialId = item.Title?.trim() || `CRED-${item.ID}`;
  if (!item.Title?.trim()) {
    console.warn(`[C3/Credential] ${ctx}: empty Title — CredentialID assigned as ${credentialId}`);
    warnRef.count++;
  }
  let type;
  if (isValidCredentialType(item.CredentialType)) {
    type = item.CredentialType;
  } else {
    console.warn(
      `[C3/Credential] ${ctx}: unknown CredentialType "${item.CredentialType}" — mapped to Other. ` +
      `This credential will satisfy no obligations. Check SP list choice values against CredentialType union.`
    );
    warnRef.count++;
    type = 'Other';
  }
  const issuedDate    = normalizeSpDate(item.IssuedDate,    `${ctx}.IssuedDate`,    warnRef);
  const expiryDate    = normalizeSpDate(item.ExpiryDate,    `${ctx}.ExpiryDate`,    warnRef);
  const validFromDate = normalizeSpDate(item.ValidFromDate, `${ctx}.ValidFromDate`, warnRef);
  return {
    Id:                     item.ID,
    CredentialID:           credentialId,
    HolderPersonID:         item.HolderPersonID.trim(),
    Type:                   type,
    ReferenceNumber:        item.ReferenceNumber?.trim() ?? '',
    IssuedBy:               item.IssuedBy?.trim()               || undefined,
    IssuedDate:             issuedDate,
    ExpiryDate:             expiryDate,
    ValidFromDate:          validFromDate,
    SubType:                item.SubType?.trim()                || undefined,
    Notes:                  item.Notes?.trim()                  || undefined,
    IsActive:               parseIsActive(item.IsActive),
    SupersedesCredentialID: item.SupersedesCredentialID?.trim() || undefined,
  };
}

function mapSpItemsToCredentials(items) {
  const credentials = [];
  let rejectedCount = 0;
  const warnRef = { count: 0 };
  for (const item of items) {
    const cred = mapSpItemToCredential(item, warnRef);
    if (cred === null) {
      rejectedCount++;
    } else {
      credentials.push(cred);
    }
  }
  console.info(
    `[C3/Credential] listAllCredentials: fetched ${items.length} SP records. ` +
    `Mapped: ${credentials.length}. Rejected: ${rejectedCount}. Warnings: ${warnRef.count}.`
  );
  return { credentials, rejectedCount, warnCount: warnRef.count };
}

// ---------------------------------------------------------------------------
// 2. Mock credential data (matches MockCredentialService.ts exactly)
// ---------------------------------------------------------------------------

const mockCredentials = [
  { Id: 1, CredentialID: 'CRED-0001', HolderPersonID: 'PER-0001', Type: 'Passport',
    ReferenceNumber: 'SA-G123456', IssuedBy: 'Kingdom of Saudi Arabia',
    IssuedDate: '2022-03-15', ExpiryDate: '2032-03-14', IsActive: true },
  { Id: 2, CredentialID: 'CRED-0002', HolderPersonID: 'PER-0001', Type: 'Visa',
    ReferenceNumber: 'UAE-VISA-889901', SubType: 'Employment Visa',
    IssuedBy: 'UAE General Directorate of Residency',
    IssuedDate: '2025-07-10', ExpiryDate: '2026-07-09', IsActive: true },
  { Id: 3, CredentialID: 'CRED-0003', HolderPersonID: 'PER-0001', Type: 'EmiratesID',
    ReferenceNumber: '784-1990-1234567-1', IssuedBy: 'UAE Federal Authority for Identity',
    IssuedDate: '2025-07-10', ExpiryDate: '2027-07-09', IsActive: true },
  { Id: 4, CredentialID: 'CRED-0004', HolderPersonID: 'PER-0002', Type: 'Passport',
    ReferenceNumber: 'JO-P456789', IssuedBy: 'Hashemite Kingdom of Jordan',
    IssuedDate: '2021-11-01', ExpiryDate: '2031-10-31', IsActive: true },
  { Id: 5, CredentialID: 'CRED-0005', HolderPersonID: 'PER-0003', Type: 'Passport',
    ReferenceNumber: 'MA-AB789012', IssuedBy: 'Kingdom of Morocco',
    IssuedDate: '2023-05-20', ExpiryDate: '2033-05-19', IsActive: true },
  { Id: 6, CredentialID: 'CRED-0006', HolderPersonID: 'PER-0003', Type: 'Visa',
    ReferenceNumber: 'UAE-VISA-556677', SubType: 'Employment Visa',
    IssuedBy: 'UAE General Directorate of Residency',
    IssuedDate: '2025-09-01', ExpiryDate: '2027-08-31', IsActive: true },
  { Id: 7, CredentialID: 'CRED-0007', HolderPersonID: 'PER-0003', Type: 'EmiratesID',
    ReferenceNumber: '784-1995-7654321-3', IssuedBy: 'UAE Federal Authority for Identity',
    IssuedDate: '2025-09-01', ExpiryDate: '2027-08-31', IsActive: true },
];

// ---------------------------------------------------------------------------
// 3. SP test dataset — 7 mirror records + 3 stress records
//    (matches docs/architecture/C3Credentials SP List Schema.md §Minimum Test Dataset)
//
//    SP DateOnly columns return ISO-like strings with T00:00:00Z suffix.
//    All other fields match the list schema internal names exactly.
// ---------------------------------------------------------------------------

const SP_MIRROR_RECORDS = [
  { ID: 1,  Title: 'CRED-0001', HolderPersonID: 'PER-0001', CredentialType: 'Passport',
    ReferenceNumber: 'SA-G123456',         IssuedBy: 'Kingdom of Saudi Arabia',
    IssuedDate: '2022-03-15T00:00:00Z',   ExpiryDate: '2032-03-14T00:00:00Z',
    ValidFromDate: null, SubType: null, Notes: null, IsActive: true, SupersedesCredentialID: null },
  { ID: 2,  Title: 'CRED-0002', HolderPersonID: 'PER-0001', CredentialType: 'Visa',
    ReferenceNumber: 'UAE-VISA-889901',    IssuedBy: 'UAE General Directorate of Residency',
    IssuedDate: '2025-07-10T00:00:00Z',   ExpiryDate: '2026-07-09T00:00:00Z',
    ValidFromDate: null, SubType: 'Employment Visa', Notes: null, IsActive: true, SupersedesCredentialID: null },
  { ID: 3,  Title: 'CRED-0003', HolderPersonID: 'PER-0001', CredentialType: 'EmiratesID',
    ReferenceNumber: '784-1990-1234567-1', IssuedBy: 'UAE Federal Authority for Identity',
    IssuedDate: '2025-07-10T00:00:00Z',   ExpiryDate: '2027-07-09T00:00:00Z',
    ValidFromDate: null, SubType: null, Notes: null, IsActive: true, SupersedesCredentialID: null },
  { ID: 4,  Title: 'CRED-0004', HolderPersonID: 'PER-0002', CredentialType: 'Passport',
    ReferenceNumber: 'JO-P456789',         IssuedBy: 'Hashemite Kingdom of Jordan',
    IssuedDate: '2021-11-01T00:00:00Z',   ExpiryDate: '2031-10-31T00:00:00Z',
    ValidFromDate: null, SubType: null, Notes: null, IsActive: true, SupersedesCredentialID: null },
  { ID: 5,  Title: 'CRED-0005', HolderPersonID: 'PER-0003', CredentialType: 'Passport',
    ReferenceNumber: 'MA-AB789012',        IssuedBy: 'Kingdom of Morocco',
    IssuedDate: '2023-05-20T00:00:00Z',   ExpiryDate: '2033-05-19T00:00:00Z',
    ValidFromDate: null, SubType: null, Notes: null, IsActive: true, SupersedesCredentialID: null },
  { ID: 6,  Title: 'CRED-0006', HolderPersonID: 'PER-0003', CredentialType: 'Visa',
    ReferenceNumber: 'UAE-VISA-556677',    IssuedBy: 'UAE General Directorate of Residency',
    IssuedDate: '2025-09-01T00:00:00Z',   ExpiryDate: '2027-08-31T00:00:00Z',
    ValidFromDate: null, SubType: 'Employment Visa', Notes: null, IsActive: true, SupersedesCredentialID: null },
  { ID: 7,  Title: 'CRED-0007', HolderPersonID: 'PER-0003', CredentialType: 'EmiratesID',
    ReferenceNumber: '784-1995-7654321-3', IssuedBy: 'UAE Federal Authority for Identity',
    IssuedDate: '2025-09-01T00:00:00Z',   ExpiryDate: '2027-08-31T00:00:00Z',
    ValidFromDate: null, SubType: null, Notes: null, IsActive: true, SupersedesCredentialID: null },
];

const SP_STRESS_RECORDS = [
  // Item 8: missing HolderPersonID → hard reject
  { ID: 8,  Title: 'CRED-0008', HolderPersonID: '',          CredentialType: 'Passport',
    ReferenceNumber: '', IssuedBy: null, IssuedDate: null, ExpiryDate: null,
    ValidFromDate: null, SubType: null, Notes: 'stress: hard reject', IsActive: true, SupersedesCredentialID: null },
  // Item 9: unknown CredentialType (note the space) → soft warn, mapped to 'Other'
  { ID: 9,  Title: 'CRED-0009', HolderPersonID: 'PER-0001',  CredentialType: 'Work Permit',
    ReferenceNumber: '', IssuedBy: null, IssuedDate: null, ExpiryDate: null,
    ValidFromDate: null, SubType: null, Notes: 'stress: unknown type', IsActive: true, SupersedesCredentialID: null },
  // Item 10: invalid ExpiryDate string → invalid-date warning, ExpiryDate === undefined (no sentinel)
  { ID: 10, Title: 'CRED-0010', HolderPersonID: 'PER-0001',  CredentialType: 'LeagueRegistration',
    ReferenceNumber: '', IssuedBy: null, IssuedDate: null, ExpiryDate: 'not-a-date',
    ValidFromDate: null, SubType: null, Notes: 'stress: invalid expiry', IsActive: true, SupersedesCredentialID: null },
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
    console.error(`  ✗ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function groupByPerson(creds) {
  const map = new Map();
  for (const c of creds) {
    if (!map.has(c.HolderPersonID)) map.set(c.HolderPersonID, []);
    map.get(c.HolderPersonID).push(c);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 5. Phase A — Mirror record parity
//    SP mirror records → mapper → compare field-by-field with mock
// ---------------------------------------------------------------------------

console.log('\n════════════════════════════════════════════════════════════');
console.log(' S15-5A — Local Mapper / Pre-SP Parity Harness');
console.log('════════════════════════════════════════════════════════════\n');


console.log('Scope: validates mapper logic, mock-vs-SP-shaped data parity,');
console.log('        count/field comparison, and stress guards.');
console.log('NOT validated here: real SP fetch, REST response shape,');
console.log('        real SP field names, real date values, SP choice behaviour.');
console.log('The real S15-5 runs after C3Credentials list is provisioned.\n');

console.log('── A1: Mirror records (7) through mapper (simulated SP REST response) ──\n');
const { credentials: spMirrorCreds, rejectedCount: mirrorRejected, warnCount: mirrorWarns }
  = mapSpItemsToCredentials(SP_MIRROR_RECORDS);

console.log('\n── A2: Record count assertions ──\n');
assert(spMirrorCreds.length === 7,    'Mirror: 7 credentials mapped from 7 SP items');
assert(mirrorRejected === 0,          'Mirror: 0 records rejected');
assert(mirrorWarns === 0,             'Mirror: 0 warnings');

console.log('\n── A3: Field-level parity (SP-mapped vs mock) ──\n');

const COMPARE_FIELDS = [
  'Id', 'CredentialID', 'HolderPersonID', 'Type', 'ReferenceNumber',
  'IssuedBy', 'IssuedDate', 'ExpiryDate', 'SubType', 'IsActive',
];

for (let i = 0; i < mockCredentials.length; i++) {
  const mock = mockCredentials[i];
  const sp   = spMirrorCreds.find(c => c.CredentialID === mock.CredentialID);
  if (!sp) {
    assert(false, `${mock.CredentialID}: found in SP-mapped output`);
    continue;
  }
  for (const field of COMPARE_FIELDS) {
    const mv = mock[field] ?? undefined;   // normalise null→undefined for comparison
    const sv = sp[field]   ?? undefined;
    assert(
      mv === sv,
      `${mock.CredentialID}.${field}: mock="${mv}" sp="${sv}"`,
      mv !== sv ? `MISMATCH: mock="${mv}" vs sp="${sv}"` : '',
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Phase C — Stress records
// ---------------------------------------------------------------------------

console.log('\n── C1: Full dataset (10 records) through mapper (simulated SP REST response) ──\n');
const { credentials: allCreds, rejectedCount: allRejected, warnCount: allWarns }
  = mapSpItemsToCredentials(ALL_SP_RECORDS);

console.log('\n── C2: Stress record assertions ──\n');
assert(allCreds.length    === 9, 'Full dataset: 9 credentials mapped (7 mirror + 2 stress)');
assert(allRejected        === 1, 'Full dataset: 1 record rejected (Item 8 — missing HolderPersonID)');
assert(allWarns           >= 2,  'Full dataset: at least 2 warnings (Item 9 — unknown CredentialType, Item 10 — invalid date)');

// Item 8: not in output
assert(
  !allCreds.find(c => c.Id === 8),
  'Item 8: absent from mapped output (correctly rejected)',
);
// Item 9: present, type coerced to 'Other'
const item9 = allCreds.find(c => c.Id === 9);
assert(!!item9, 'Item 9: present in mapped output (not rejected)');
assert(item9?.Type === 'Other', `Item 9: Type mapped to 'Other' (was "Work Permit")`);

// Item 10: present, invalid ExpiryDate → warning logged, ExpiryDate === undefined (not null, not sentinel)
const item10 = allCreds.find(c => c.Id === 10);
assert(!!item10, 'Item 10: present in mapped output (not rejected)');
assert(item10?.ExpiryDate === undefined,
  'Item 10: ExpiryDate is undefined — invalid date treated as absent, no sentinel');

// ---------------------------------------------------------------------------
// 7. Per-person comparison
// ---------------------------------------------------------------------------

console.log('\n── D: Per-person comparison (mirror set) ──\n');

const mockByPerson = groupByPerson(mockCredentials);
const spByPerson   = groupByPerson(spMirrorCreds);

const personIds = [...new Set([...mockByPerson.keys(), ...spByPerson.keys()])].sort();
for (const pid of personIds) {
  const mockCount = (mockByPerson.get(pid) ?? []).length;
  const spCount   = (spByPerson.get(pid)   ?? []).length;
  const mockIds   = (mockByPerson.get(pid) ?? []).map(c => c.CredentialID).sort().join(', ');
  const spIds     = (spByPerson.get(pid)   ?? []).map(c => c.CredentialID).sort().join(', ');
  assert(mockCount === spCount,  `${pid}: count mock=${mockCount} sp=${spCount}`);
  assert(mockIds   === spIds,    `${pid}: credential IDs match (${mockIds})`);
}

// ---------------------------------------------------------------------------
// 8. Summary
// ---------------------------------------------------------------------------

console.log('\n════════════════════════════════════════════════════════════');
console.log(` RESULTS:  ${passed} passed   ${failed} failed`);
console.log('════════════════════════════════════════════════════════════\n');

console.log('Metrics:');
console.log(`  Mirror set  — fetched: 7  mapped: ${spMirrorCreds.length}  rejected: ${mirrorRejected}  warnings: ${mirrorWarns}`);
console.log(`  Full set    — fetched: 10 mapped: ${allCreds.length}  rejected: ${allRejected}  warnings: ${allWarns}`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
