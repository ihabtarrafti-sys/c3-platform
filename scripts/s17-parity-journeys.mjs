/**
 * s17-parity-journeys.mjs
 *
 * Sprint 17 (S17-3) — Journey mapper parity harness.
 *
 * Validates that spJourneyMapper.ts produces output identical to
 * MockJourneyService.ts for the 3 canonical seed records, and exercises
 * all mapper error paths via stress records.
 *
 * Mirror records (3): JRN-0001, JRN-0002, JRN-0003
 *   Exact SP representation of the MockJourneyService MOCK_JOURNEYS seeds.
 *
 * Stress records (3):
 *   Item 4: blank Title          → hard reject (missing JourneyID)
 *   Item 5: Type='UnknownType'   → hard reject (unknown JourneyType)
 *   Item 6: malformed JSON       → soft warn, record retained (obligationAssignments=undefined)
 *
 * Expected totals: 4 mapped, 2 rejected, 1 warning
 *
 * DateTime handling: Journey datetime fields (InitiatedAt, CompletedAt,
 * assignedAt) are preserved as full ISO strings — no split('T')[0] needed.
 * The mock and simulated SP items use identical string values.
 *
 * Run: node scripts/s17-parity-journeys.mjs
 */

// ---------------------------------------------------------------------------
// Inline mapper logic (translated from spJourneyMapper.ts)
// Must stay in sync with the TypeScript source.
// ---------------------------------------------------------------------------

const PREFIX = '[C3/Journey]';

const VALID_JOURNEY_TYPES = new Set([
  'Onboarding',
  'VisaRenewal',
  'TeamTransfer',
  'ContractRenewal',
  'Offboarding',
]);

const VALID_JOURNEY_STATUSES = new Set([
  'Active',
  'Completed',
  'Suspended',
  'Cancelled',
]);

function normalizeSpDateTime(val, context, warnRef) {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val !== 'string') {
    console.warn(`${PREFIX} ${context}: unexpected datetime type ${typeof val} — treated as absent`);
    warnRef.count++;
    return undefined;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    console.warn(`${PREFIX} ${context}: invalid datetime "${val}" — treated as absent`);
    warnRef.count++;
    return undefined;
  }
  return val.trim();
}

function parseObligationAssignments(raw, warnRef) {
  if (!raw || raw.trim() === '') return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`${PREFIX} ObligationAssignmentsJSON parse failed — treated as empty`);
    warnRef.count++;
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    console.warn(`${PREFIX} ObligationAssignmentsJSON is not an array — treated as empty`);
    warnRef.count++;
    return undefined;
  }
  return parsed;
}

function mapSpItemToJourney(item, warnRef) {
  const itemLabel = `Item ${item.Id}`;

  if (!item.Title || item.Title.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing JourneyID — record rejected`);
    return null;
  }

  if (!item.PersonID || item.PersonID.trim() === '') {
    console.warn(`${PREFIX} ${itemLabel}: missing PersonID — record rejected`);
    return null;
  }

  if (!item.Type || !VALID_JOURNEY_TYPES.has(item.Type)) {
    console.warn(`${PREFIX} ${itemLabel}: unknown JourneyType "${item.Type ?? ''}" — record rejected`);
    return null;
  }

  if (!item.Status || !VALID_JOURNEY_STATUSES.has(item.Status)) {
    console.warn(`${PREFIX} ${itemLabel}: unknown JourneyStatus "${item.Status ?? ''}" — record rejected`);
    return null;
  }

  const initiatedAt = normalizeSpDateTime(item.InitiatedAt, `${itemLabel}.InitiatedAt`, warnRef);
  const completedAt = normalizeSpDateTime(item.CompletedAt, `${itemLabel}.CompletedAt`, warnRef);
  const obligationAssignments = parseObligationAssignments(item.ObligationAssignmentsJSON, warnRef);

  return {
    JourneyID:        item.Title.trim(),
    PersonID:         item.PersonID.trim(),
    Type:             item.Type,
    Status:           item.Status,
    InitiatedAt:      initiatedAt ?? '',
    InitiatedBy:      item.InitiatedBy?.trim() ?? '',
    AssignedTo:       item.AssignedTo?.trim() || undefined,
    InitiationReason: item.InitiationReason?.trim() || undefined,
    ContractID:       item.ContractID?.trim() || undefined,
    MissionID:        item.MissionID?.trim() || undefined,
    CompletedAt:      completedAt,
    Notes:            item.Notes?.trim() || undefined,
    obligationAssignments,
  };
}

function mapSpItemsToJourneys(items) {
  const warnRef = { count: 0 };
  const journeys = [];
  let rejected = 0;

  for (const item of items) {
    const mapped = mapSpItemToJourney(item, warnRef);
    if (mapped === null) {
      rejected++;
    } else {
      journeys.push(mapped);
    }
  }

  const result = {
    mapped: journeys.length,
    rejected,
    warnings: warnRef.count,
  };

  console.info(
    `${PREFIX} listJourneys: fetched ${items.length} SP records. ` +
    `Mapped: ${result.mapped}. Rejected: ${result.rejected}. Warnings: ${result.warnings}.`,
  );

  return { journeys, result };
}

// ---------------------------------------------------------------------------
// Simulated SP items — mirror records matching MockJourneyService seeds exactly
// ---------------------------------------------------------------------------

const SP_ITEMS = [
  // ── Item 1: JRN-0001 — Active Onboarding with obligation assignment ──────
  {
    Id: 1,
    Title: 'JRN-0001',
    PersonID: 'PER-0001',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-01-10T09:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'New season roster — UAE operations onboarding.',
    ContractID: 'CTR-0001',
    MissionID: null,
    CompletedAt: null,
    Notes: null,
    ObligationAssignmentsJSON: JSON.stringify([
      {
        obligationType: 'Travel',
        requirement: 'Travel Authorization',
        assignedTo: 'pro.coordinator@geekay.gg',
        assignedAt: '2026-01-10T09:30:00Z',
      },
    ]),
  },

  // ── Item 2: JRN-0002 — Active Onboarding, no obligation assignments ──────
  {
    Id: 2,
    Title: 'JRN-0002',
    PersonID: 'PER-0002',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-02-15T11:30:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'Transfer window acquisition — onboarding initiated.',
    ContractID: null,
    MissionID: null,
    CompletedAt: null,
    Notes: null,
    ObligationAssignmentsJSON: null,
  },

  // ── Item 3: JRN-0003 — Completed Onboarding ─────────────────────────────
  {
    Id: 3,
    Title: 'JRN-0003',
    PersonID: 'PER-0003',
    Type: 'Onboarding',
    Status: 'Completed',
    InitiatedAt: '2025-09-01T08:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'Pre-season onboarding.',
    ContractID: 'CTR-0003',
    MissionID: null,
    CompletedAt: '2025-10-14T16:00:00Z',
    Notes: 'All credentials verified and filed. Cleared for full operations.',
    ObligationAssignmentsJSON: null,
  },

  // ── Item 4: Stress — blank Title → hard reject ───────────────────────────
  {
    Id: 4,
    Title: '',
    PersonID: 'PER-0001',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-03-01T10:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: null,
    InitiationReason: null,
    ContractID: null,
    MissionID: null,
    CompletedAt: null,
    Notes: null,
    ObligationAssignmentsJSON: null,
  },

  // ── Item 5: Stress — unknown Type → hard reject ──────────────────────────
  {
    Id: 5,
    Title: 'JRN-0005',
    PersonID: 'PER-0001',
    Type: 'UnknownType',
    Status: 'Active',
    InitiatedAt: '2026-03-02T10:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: null,
    InitiationReason: null,
    ContractID: null,
    MissionID: null,
    CompletedAt: null,
    Notes: null,
    ObligationAssignmentsJSON: null,
  },

  // ── Item 6: Stress — malformed JSON → soft warn, record retained ─────────
  {
    Id: 6,
    Title: 'JRN-0006',
    PersonID: 'PER-0001',
    Type: 'VisaRenewal',
    Status: 'Active',
    InitiatedAt: '2026-03-03T10:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: null,
    InitiationReason: null,
    ContractID: null,
    MissionID: null,
    CompletedAt: null,
    Notes: null,
    ObligationAssignmentsJSON: 'not valid json{',
  },
];

// ---------------------------------------------------------------------------
// Expected mock output — mirrors MockJourneyService MOCK_JOURNEYS exactly
// ---------------------------------------------------------------------------

const MOCK_JOURNEYS = [
  {
    JourneyID: 'JRN-0001',
    PersonID: 'PER-0001',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-01-10T09:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'New season roster — UAE operations onboarding.',
    ContractID: 'CTR-0001',
    MissionID: undefined,
    CompletedAt: undefined,
    Notes: undefined,
    obligationAssignments: [
      {
        obligationType: 'Travel',
        requirement: 'Travel Authorization',
        assignedTo: 'pro.coordinator@geekay.gg',
        assignedAt: '2026-01-10T09:30:00Z',
      },
    ],
  },
  {
    JourneyID: 'JRN-0002',
    PersonID: 'PER-0002',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-02-15T11:30:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'Transfer window acquisition — onboarding initiated.',
    ContractID: undefined,
    MissionID: undefined,
    CompletedAt: undefined,
    Notes: undefined,
    obligationAssignments: undefined,
  },
  {
    JourneyID: 'JRN-0003',
    PersonID: 'PER-0003',
    Type: 'Onboarding',
    Status: 'Completed',
    InitiatedAt: '2025-09-01T08:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'Pre-season onboarding.',
    ContractID: 'CTR-0003',
    MissionID: undefined,
    CompletedAt: '2025-10-14T16:00:00Z',
    Notes: 'All credentials verified and filed. Cleared for full operations.',
    obligationAssignments: undefined,
  },
];

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const actualStr  = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
    console.error(`        expected: ${expectedStr}`);
    console.error(`        actual:   ${actualStr}`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('\n=== S17 Journey Mapper Parity Harness ===\n');

const { journeys, result } = mapSpItemsToJourneys(SP_ITEMS);

// ── Batch counts ────────────────────────────────────────────────────────────
console.log('\n--- Batch count assertions ---');
assert('mapped count',   result.mapped,   4);
assert('rejected count', result.rejected, 2);
assert('warnings count', result.warnings, 1);

// ── Mirror record field assertions ──────────────────────────────────────────
console.log('\n--- Mirror record field assertions ---');

// JRN-0001
const j1 = journeys.find(j => j.JourneyID === 'JRN-0001');
const m1 = MOCK_JOURNEYS[0];
assert('JRN-0001 JourneyID',        j1?.JourneyID,        m1.JourneyID);
assert('JRN-0001 PersonID',         j1?.PersonID,         m1.PersonID);
assert('JRN-0001 Type',             j1?.Type,             m1.Type);
assert('JRN-0001 Status',           j1?.Status,           m1.Status);
assert('JRN-0001 InitiatedAt',      j1?.InitiatedAt,      m1.InitiatedAt);
assert('JRN-0001 InitiatedBy',      j1?.InitiatedBy,      m1.InitiatedBy);
assert('JRN-0001 AssignedTo',       j1?.AssignedTo,       m1.AssignedTo);
assert('JRN-0001 InitiationReason', j1?.InitiationReason, m1.InitiationReason);
assert('JRN-0001 ContractID',       j1?.ContractID,       m1.ContractID);
assert('JRN-0001 MissionID',        j1?.MissionID,        m1.MissionID);
assert('JRN-0001 CompletedAt',      j1?.CompletedAt,      m1.CompletedAt);
assert('JRN-0001 Notes',            j1?.Notes,            m1.Notes);
// obligation assignments
assert('JRN-0001 obligationAssignments length',
  j1?.obligationAssignments?.length, 1);
assert('JRN-0001 obligationType',
  j1?.obligationAssignments?.[0]?.obligationType,
  m1.obligationAssignments[0].obligationType);
assert('JRN-0001 requirement',
  j1?.obligationAssignments?.[0]?.requirement,
  m1.obligationAssignments[0].requirement);
assert('JRN-0001 obligation.assignedTo',
  j1?.obligationAssignments?.[0]?.assignedTo,
  m1.obligationAssignments[0].assignedTo);
assert('JRN-0001 obligation.assignedAt',
  j1?.obligationAssignments?.[0]?.assignedAt,
  m1.obligationAssignments[0].assignedAt);

// JRN-0002
const j2 = journeys.find(j => j.JourneyID === 'JRN-0002');
const m2 = MOCK_JOURNEYS[1];
assert('JRN-0002 JourneyID',          j2?.JourneyID,          m2.JourneyID);
assert('JRN-0002 PersonID',           j2?.PersonID,           m2.PersonID);
assert('JRN-0002 Type',               j2?.Type,               m2.Type);
assert('JRN-0002 Status',             j2?.Status,             m2.Status);
assert('JRN-0002 InitiatedAt',        j2?.InitiatedAt,        m2.InitiatedAt);
assert('JRN-0002 InitiatedBy',        j2?.InitiatedBy,        m2.InitiatedBy);
assert('JRN-0002 AssignedTo',         j2?.AssignedTo,         m2.AssignedTo);
assert('JRN-0002 InitiationReason',   j2?.InitiationReason,   m2.InitiationReason);
assert('JRN-0002 ContractID',         j2?.ContractID,         m2.ContractID);
assert('JRN-0002 MissionID',          j2?.MissionID,          m2.MissionID);
assert('JRN-0002 CompletedAt',        j2?.CompletedAt,        m2.CompletedAt);
assert('JRN-0002 Notes',              j2?.Notes,              m2.Notes);
assert('JRN-0002 obligationAssignments', j2?.obligationAssignments, m2.obligationAssignments);

// JRN-0003
const j3 = journeys.find(j => j.JourneyID === 'JRN-0003');
const m3 = MOCK_JOURNEYS[2];
assert('JRN-0003 JourneyID',          j3?.JourneyID,          m3.JourneyID);
assert('JRN-0003 PersonID',           j3?.PersonID,           m3.PersonID);
assert('JRN-0003 Type',               j3?.Type,               m3.Type);
assert('JRN-0003 Status',             j3?.Status,             m3.Status);
assert('JRN-0003 InitiatedAt',        j3?.InitiatedAt,        m3.InitiatedAt);
assert('JRN-0003 InitiatedBy',        j3?.InitiatedBy,        m3.InitiatedBy);
assert('JRN-0003 AssignedTo',         j3?.AssignedTo,         m3.AssignedTo);
assert('JRN-0003 InitiationReason',   j3?.InitiationReason,   m3.InitiationReason);
assert('JRN-0003 ContractID',         j3?.ContractID,         m3.ContractID);
assert('JRN-0003 MissionID',          j3?.MissionID,          m3.MissionID);
assert('JRN-0003 CompletedAt',        j3?.CompletedAt,        m3.CompletedAt);
assert('JRN-0003 Notes',              j3?.Notes,              m3.Notes);
assert('JRN-0003 obligationAssignments', j3?.obligationAssignments, m3.obligationAssignments);

// ── Stress record assertions ─────────────────────────────────────────────────
console.log('\n--- Stress record assertions ---');

// Item 4: blank Title → hard reject (must not appear in journeys)
assert('Item 4 (blank Title) not in mapped set',
  journeys.find(j => j.JourneyID === ''), undefined);

// Item 5: unknown Type → hard reject (must not appear in mapped set)
assert('Item 5 (UnknownType) not in mapped set',
  journeys.find(j => j.JourneyID === 'JRN-0005'), undefined);

// Item 6: malformed JSON → soft warn, retained with obligationAssignments=undefined
const j6 = journeys.find(j => j.JourneyID === 'JRN-0006');
assert('Item 6 (malformed JSON) is mapped',
  j6 !== undefined, true);
assert('Item 6 obligationAssignments is undefined',
  j6?.obligationAssignments, undefined);
assert('Item 6 Type is VisaRenewal',
  j6?.Type, 'VisaRenewal');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
