/**
 * s18-parity-approvals.mjs
 * Sprint 18 Phase 2B -- Approvals mapper parity harness.
 * Local mapper parity only -- no live SharePoint dependency.
 * Run: node scripts/s18-parity-approvals.mjs
 */

const PREFIX = '[C3/Approvals]';
const APPROVAL_STATUS_VALUES = new Set([
  'Submitted','InReview','Approved','Rejected','Executed','ExecutionFailed',
]);

function normalizeSpDateTime(val, context, warnRef) {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val !== 'string') {
    console.warn(PREFIX + ' ' + context + ': unexpected datetime type ' + typeof val + ' -- treated as absent');
    warnRef.count++; return undefined;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    console.warn(PREFIX + ' ' + context + ': invalid datetime "' + val + '" -- treated as absent');
    warnRef.count++; return undefined;
  }
  return val.trim();
}

function mapSpItemToApproval(item, warnRef) {
  const lbl = 'Item ' + item.ID;
  if (item.ID == null || isNaN(item.ID)) { console.warn(PREFIX + ' item with null ID -- record rejected'); return null; }
  if (!item.Title || item.Title.trim() === '') { console.warn(PREFIX + ' ' + lbl + ': missing Title -- record rejected'); return null; }
  if (!item.ApprovalStatus || !APPROVAL_STATUS_VALUES.has(item.ApprovalStatus)) {
    console.warn(PREFIX + ' ' + lbl + ': invalid ApprovalStatus "' + (item.ApprovalStatus || '') + '" -- record rejected'); return null;
  }
  if (!item.OperationType || item.OperationType.trim() === '') { console.warn(PREFIX + ' ' + lbl + ': missing OperationType -- record rejected'); return null; }
  if (!item.SubmittedBy) { console.warn(PREFIX + ' ' + lbl + ': missing SubmittedBy'); warnRef.count++; }
  if (!item.SubmittedAt) { console.warn(PREFIX + ' ' + lbl + ': missing SubmittedAt'); warnRef.count++; }
  if (!item.Payload) { console.warn(PREFIX + ' ' + lbl + ': missing Payload -- execution will fail if attempted'); warnRef.count++; }
  if (item.ApprovalStatus === 'Executed' && !item.ExecutedAt) { console.warn(PREFIX + ' ' + lbl + ': Executed but no ExecutedAt -- inconsistency'); warnRef.count++; }
  const submittedAt = normalizeSpDateTime(item.SubmittedAt, lbl + '.SubmittedAt', warnRef);
  const reviewedAt  = normalizeSpDateTime(item.ReviewedAt,  lbl + '.ReviewedAt',  warnRef);
  const executedAt  = normalizeSpDateTime(item.ExecutedAt,  lbl + '.ExecutedAt',  warnRef);
  return {
    id: item.ID, title: item.Title.trim(), operationType: item.OperationType.trim(),
    targetId: item.TargetID && item.TargetID.trim() || undefined,
    targetPersonId: item.TargetPersonID && item.TargetPersonID.trim() || undefined,
    submittedBy: item.SubmittedBy && item.SubmittedBy.trim() || '',
    submittedAt, approvalStatus: item.ApprovalStatus,
    reviewedBy: item.ReviewedBy && item.ReviewedBy.trim() || undefined, reviewedAt,
    executedAt, executionError: item.ExecutionError && item.ExecutionError.trim() || undefined,
    delegatedBy: item.DelegatedBy && item.DelegatedBy.trim() || undefined,
    delegateTo: item.DelegateTo && item.DelegateTo.trim() || undefined,
    reason: item.Reason && item.Reason.trim() || undefined,
    rejectionReason: item.RejectionReason && item.RejectionReason.trim() || undefined,
    payload: item.Payload && item.Payload.trim() || undefined,
  };
}

function mapSpItemsToApprovals(items) {
  const warnRef = { count: 0 };
  const approvals = [];
  let rejected = 0;
  for (const item of items) {
    const mapped = mapSpItemToApproval(item, warnRef);
    if (mapped === null) { rejected++; } else { approvals.push(mapped); }
  }
  const result = { mapped: approvals.length, rejected, warnings: warnRef.count };
  console.info(PREFIX + ' listApprovals: fetched ' + items.length + ' SP records. Mapped: ' + result.mapped + '. Rejected: ' + result.rejected + '. Warnings: ' + result.warnings + '.');
  return { approvals, result };
}

// ---------------------------------------------------------------------------
// Seed records
// ---------------------------------------------------------------------------
const SP_ITEMS = [
  { ID:1, Title:'APR-0001', OperationType:'InitiateJourney', TargetID:null, TargetPersonID:'PER-0001',
    SubmittedBy:'i:0#.f|membership|ihab@geekaygroupmea.com', SubmittedAt:'2026-06-01T09:00:00Z',
    ApprovalStatus:'Submitted', ReviewedBy:null, ReviewedAt:null, ExecutedAt:null, ExecutionError:null,
    DelegatedBy:null, DelegateTo:null, Reason:'Onboarding -- new season roster.', RejectionReason:null,
    Payload:'{"personId":"PER-0001","journeyType":"Onboarding"}' },
  { ID:2, Title:'APR-0002', OperationType:'InitiateJourney', TargetID:null, TargetPersonID:'PER-0002',
    SubmittedBy:'i:0#.f|membership|ihab@geekaygroupmea.com', SubmittedAt:'2026-06-02T10:00:00Z',
    ApprovalStatus:'Approved', ReviewedBy:'i:0#.f|membership|owner@geekaygroupmea.com',
    ReviewedAt:'2026-06-02T11:30:00Z', ExecutedAt:null, ExecutionError:null,
    DelegatedBy:null, DelegateTo:null, Reason:'Transfer window acquisition.', RejectionReason:null,
    Payload:'{"personId":"PER-0002","journeyType":"Onboarding"}' },
  { ID:3, Title:'APR-0003', OperationType:'InitiateJourney', TargetID:null, TargetPersonID:'PER-0003',
    SubmittedBy:'i:0#.f|membership|ihab@geekaygroupmea.com', SubmittedAt:'2026-05-15T08:00:00Z',
    ApprovalStatus:'Executed', ReviewedBy:'i:0#.f|membership|owner@geekaygroupmea.com',
    ReviewedAt:'2026-05-15T09:00:00Z', ExecutedAt:'2026-05-15T09:05:00Z', ExecutionError:null,
    DelegatedBy:null, DelegateTo:null, Reason:'Pre-season onboarding.', RejectionReason:null,
    Payload:'{"personId":"PER-0003","journeyType":"Onboarding"}' },
  { ID:101, Title:null, OperationType:'InitiateJourney', TargetID:null, TargetPersonID:'PER-0001',
    SubmittedBy:'i:0#.f|membership|ihab@geekaygroupmea.com', SubmittedAt:'2026-06-10T09:00:00Z',
    ApprovalStatus:'Submitted', ReviewedBy:null, ReviewedAt:null, ExecutedAt:null, ExecutionError:null,
    DelegatedBy:null, DelegateTo:null, Reason:null, RejectionReason:null, Payload:'{}' },
  { ID:102, Title:'APR-S2', OperationType:'InitiateJourney', TargetID:null, TargetPersonID:'PER-0001',
    SubmittedBy:'i:0#.f|membership|ihab@geekaygroupmea.com', SubmittedAt:'2026-06-10T10:00:00Z',
    ApprovalStatus:'InvalidState', ReviewedBy:null, ReviewedAt:null, ExecutedAt:null, ExecutionError:null,
    DelegatedBy:null, DelegateTo:null, Reason:null, RejectionReason:null, Payload:'{}' },
  { ID:103, Title:'APR-S3', OperationType:'InitiateJourney', TargetID:null, TargetPersonID:'PER-0001',
    SubmittedBy:'i:0#.f|membership|ihab@geekaygroupmea.com', SubmittedAt:'2026-06-10T11:00:00Z',
    ApprovalStatus:'Submitted', ReviewedBy:null, ReviewedAt:null, ExecutedAt:null, ExecutionError:null,
    DelegatedBy:null, DelegateTo:null, Reason:null, RejectionReason:null, Payload:null },
];

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function assert(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error('  FAIL  ' + label); console.error('        expected: ' + e); console.error('        actual:   ' + a); }
}

console.log('\n=== S18 Approvals Mapper Parity Harness ===\n');
const { approvals, result } = mapSpItemsToApprovals(SP_ITEMS);

console.log('\n--- Batch count assertions ---');
assert('mapped count (3 clean + APR-S3 soft warn)', result.mapped, 4);
assert('rejected count', result.rejected, 2);
assert('warnings count', result.warnings, 1);

console.log('\n--- APR-0001 (Submitted, clean) ---');
const a1 = approvals.find(function(a) { return a.title === 'APR-0001'; });
assert('APR-0001 present',                a1 !== undefined,               true);
assert('APR-0001 id',                     a1 && a1.id,                   1);
assert('APR-0001 operationType',          a1 && a1.operationType,        'InitiateJourney');
assert('APR-0001 approvalStatus',         a1 && a1.approvalStatus,       'Submitted');
assert('APR-0001 targetPersonId',         a1 && a1.targetPersonId,       'PER-0001');
assert('APR-0001 targetPersonId type',    a1 && typeof a1.targetPersonId, 'string');
assert('APR-0001 submittedBy',            a1 && a1.submittedBy,          'i:0#.f|membership|ihab@geekaygroupmea.com');
assert('APR-0001 submittedAt (full ISO)', a1 && a1.submittedAt,          '2026-06-01T09:00:00Z');
assert('APR-0001 executedAt',             a1 && a1.executedAt,           undefined);
assert('APR-0001 payload present',        !!(a1 && a1.payload),          true);

console.log('\n--- APR-0002 (Approved, not Executed) ---');
const a2 = approvals.find(function(a) { return a.title === 'APR-0002'; });
assert('APR-0002 present',        a2 !== undefined,             true);
assert('APR-0002 approvalStatus', a2 && a2.approvalStatus,     'Approved');
assert('APR-0002 reviewedBy',     a2 && a2.reviewedBy,         'i:0#.f|membership|owner@geekaygroupmea.com');
assert('APR-0002 reviewedAt',     a2 && a2.reviewedAt,         '2026-06-02T11:30:00Z');
assert('APR-0002 executedAt',     a2 && a2.executedAt,         undefined);

console.log('\n--- APR-0003 (Executed, ExecutedAt full ISO) ---');
const a3 = approvals.find(function(a) { return a.title === 'APR-0003'; });
assert('APR-0003 present',               a3 !== undefined,          true);
assert('APR-0003 approvalStatus',        a3 && a3.approvalStatus,   'Executed');
assert('APR-0003 executedAt (full ISO)', a3 && a3.executedAt,       '2026-05-15T09:05:00Z');
assert('APR-0003 executedAt has T',      a3 && a3.executedAt && a3.executedAt.indexOf('T') !== -1, true);

console.log('\n--- Stress record assertions ---');
assert('APR-S1 (null Title) not mapped',     approvals.find(function(a) { return a.id === 101; }), undefined);
assert('APR-S2 (bad status) not mapped',     approvals.find(function(a) { return a.id === 102; }), undefined);
const aS3 = approvals.find(function(a) { return a.id === 103; });
assert('APR-S3 (null Payload) IS mapped',    aS3 !== undefined,          true);
assert('APR-S3 approvalStatus is Submitted', aS3 && aS3.approvalStatus, 'Submitted');
assert('APR-S3 payload is undefined',        aS3 && aS3.payload,        undefined);

const summary = '\n=== Result: ' + passed + ' passed, ' + failed + ' failed ===\n';
console.log(summary);
if (failed > 0) { process.exit(1); }
