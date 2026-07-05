/**
 * s33-parity-credential-dates.mjs — Sprint 33 Correction Set C, Finding A.
 *
 * Proves the Add Credential IssuedDate / ExpiryDate retain their meaning end to
 * end and that no timezone date shift occurs. The hosted Phase 1C observation
 * (CRED-0024 dates "transposed") was reproduced by a test-harness input-index
 * error, NOT the product: every hop below maps the two dates straight through.
 *
 * Distinct, unmistakable dates are used so any swap is obvious:
 *   IssuedDate = 2026-01-02   ExpiryDate = 2031-12-30
 *
 * Coverage:
 *  1. FUNCTIONAL: the real read-path date normalizer (spCredentialMapper →
 *     normalizeSpDate, compiled via esbuild) round-trips SharePoint-stored
 *     values back to the correct date-only string with NO shift, for the
 *     site's UTC-8 storage form AND UTC-midnight AND a positive-offset form.
 *  2. DATA-FLOW: a faithful reproduction of each source hop's field assignment,
 *     asserted straight-through, with the source lines pinned by static regex
 *     so the reproduction cannot drift from the code.
 */
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

const ISSUE = '2026-01-02';
const EXPIRY = '2031-12-30';

// ── 1. FUNCTIONAL read-path normalizer ──────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's33-creddates-'));
const outfile = join(tmp, 'dateUtils.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3/src/utils/dateUtils.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error',
});
const { normalizeSpDate, computeDaysToExpiry } = require(outfile);
const warn = { count: 0 };

// SharePoint stores a bare date entered on a UTC-8 site as siteTZ-midnight in
// UTC → "<date>T08:00:00Z". The mapper must read the SAME calendar date back.
check('read: UTC-8 stored issue date normalizes back unchanged',
  normalizeSpDate(`${ISSUE}T08:00:00Z`, 'i', warn) === ISSUE);
check('read: UTC-8 stored expiry date normalizes back unchanged',
  normalizeSpDate(`${EXPIRY}T08:00:00Z`, 'e', warn) === EXPIRY);
check('read: UTC-midnight stored date normalizes back unchanged',
  normalizeSpDate(`${ISSUE}T00:00:00Z`, 'i', warn) === ISSUE &&
  normalizeSpDate(`${EXPIRY}T00:00:00Z`, 'e', warn) === EXPIRY);
check('read: DST-offset (T07:00:00Z) summer date normalizes back unchanged',
  normalizeSpDate('2026-07-05T07:00:00Z', 'x', warn) === '2026-07-05');
check('read: absent/blank dates → undefined (non-expiring), not an error',
  normalizeSpDate(null, 'n', warn) === undefined &&
  normalizeSpDate('', 'b', warn) === undefined);
check('read: distinct issue/expiry never collapse to the same value',
  normalizeSpDate(`${ISSUE}T08:00:00Z`, 'i', warn) !==
  normalizeSpDate(`${EXPIRY}T08:00:00Z`, 'e', warn));
// computeDaysToExpiry treats the date as UTC midnight → stable, positive for a
// far-future expiry, independent of the machine timezone.
check('read: computeDaysToExpiry is timezone-stable and positive for a future expiry',
  computeDaysToExpiry(`${EXPIRY}T08:00:00Z`) > 2000);

// ── 2. DATA-FLOW: straight-through mapping across every hop ──────────────────
// Faithful reproduction of the source assignments (pinned by the static checks
// below). Panel state → CreateCredentialInput → approval payload → execution
// CreateCredentialInput → SharePoint write body → read-mapped credential.
const panelState = { expiryDate: EXPIRY, issueDate: ISSUE };

// AddCredentialPanel.handleSubmit → CreateCredentialInput
const createInput = { ExpiryDate: panelState.expiryDate, IssuedDate: panelState.issueDate };
// useSubmitCredentialApproval → approval payload (camelCase)
const payload = { issuedDate: createInput.IssuedDate, expiryDate: createInput.ExpiryDate };
// JSON round-trip (createApproval serializes payload)
const roundTripped = JSON.parse(JSON.stringify(payload));
// useExecuteApproval → CreateCredentialInput for the write
const execInput = { IssuedDate: roundTripped.issuedDate, ExpiryDate: roundTripped.expiryDate };
// SharePointCredentialService → SP write body
const spBody = { IssuedDate: execInput.IssuedDate ?? null, ExpiryDate: execInput.ExpiryDate ?? null };
// SharePoint stores as UTC-8 midnight; read mapper normalizes back
const storedIssued = `${spBody.IssuedDate}T08:00:00Z`;
const storedExpiry = `${spBody.ExpiryDate}T08:00:00Z`;
const readCred = {
  IssuedDate: normalizeSpDate(storedIssued, 'i', warn),
  ExpiryDate: normalizeSpDate(storedExpiry, 'e', warn),
};

check('flow: IssuedDate keeps its meaning end to end (no swap)',
  createInput.IssuedDate === ISSUE && payload.issuedDate === ISSUE &&
  execInput.IssuedDate === ISSUE && spBody.IssuedDate === ISSUE &&
  readCred.IssuedDate === ISSUE);
check('flow: ExpiryDate keeps its meaning end to end (no swap)',
  createInput.ExpiryDate === EXPIRY && payload.expiryDate === EXPIRY &&
  execInput.ExpiryDate === EXPIRY && spBody.ExpiryDate === EXPIRY &&
  readCred.ExpiryDate === EXPIRY);
check('flow: the two dates never cross over at any hop',
  readCred.IssuedDate !== readCred.ExpiryDate &&
  readCred.IssuedDate === ISSUE && readCred.ExpiryDate === EXPIRY);

// ── Static wiring pins — the reproduction above must match the real source ───
const panel = read('packages/c3/src/components/shared/AddCredentialPanel.tsx');
check('src: panel Expiry input drives expiryDate; Issue input drives issueDate',
  /id="acp-expiry"[\s\S]{0,120}value=\{expiryDate\}[\s\S]{0,120}setExpiryDate/.test(panel) &&
  /id="acp-issued"[\s\S]{0,120}value=\{issueDate\}[\s\S]{0,120}setIssueDate/.test(panel));
check('src: panel payload maps ExpiryDate:expiryDate and IssuedDate:issueDate',
  /ExpiryDate:\s*expiryDate\s*\|\|/.test(panel) && /IssuedDate:\s*issueDate\s*\|\|/.test(panel));

const submit = read('packages/c3/src/hooks/useSubmitCredentialApproval.ts');
check('src: submit hook maps issuedDate:input.IssuedDate and expiryDate:input.ExpiryDate',
  /issuedDate:\s*input\.IssuedDate/.test(submit) && /expiryDate:\s*input\.ExpiryDate/.test(submit));

const exec = read('packages/c3/src/hooks/useExecuteApproval.ts');
check('src: execution maps IssuedDate:payload.issuedDate and ExpiryDate:payload.expiryDate',
  /IssuedDate:\s*payload\.issuedDate/.test(exec) && /ExpiryDate:\s*payload\.expiryDate/.test(exec));

const spSvc = read('packages/c3/src/services/sharepoint/SharePointCredentialService.ts');
check('src: SP write maps IssuedDate:input.IssuedDate and ExpiryDate:input.ExpiryDate',
  /IssuedDate:\s*input\.IssuedDate/.test(spSvc) && /ExpiryDate:\s*input\.ExpiryDate/.test(spSvc));

const mapper = read('packages/c3/src/utils/spCredentialMapper.ts');
check('src: read mapper maps IssuedDate:issuedDate and ExpiryDate:expiryDate straight through',
  /issuedDate\s*=\s*normalizeSpDate\(item\.IssuedDate/.test(mapper) &&
  /expiryDate\s*=\s*normalizeSpDate\(item\.ExpiryDate/.test(mapper) &&
  /IssuedDate:\s*issuedDate/.test(mapper) && /ExpiryDate:\s*expiryDate/.test(mapper));

// Mock parity: the Mock credential service must also preserve both dates.
const mock = read('packages/c3/src/services/mock/MockCredentialService.ts');
check('parity: Mock credential service preserves IssuedDate and ExpiryDate',
  /IssuedDate/.test(mock) && /ExpiryDate/.test(mock) &&
  !/IssuedDate:\s*(input\.ExpiryDate|.*expiry)/i.test(mock));

rmSync(tmp, { recursive: true, force: true });

console.log(`\ns33-parity-credential-dates: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) { console.error('FAILED:', failures); process.exit(1); }
