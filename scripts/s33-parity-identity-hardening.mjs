/**
 * s33-parity-identity-hardening.mjs — Sprint 33 Defect B.
 *
 * Self-approval identity normalization: the REAL canonicalizer
 * (packages/c3/src/utils/identity.ts) is compiled via esbuild and exercised
 * functionally against the mandated matrix:
 *   - identical bare emails                → blocked (self);
 *   - bare email vs membership claim       → blocked (self);
 *   - membership claim vs bare email       → blocked (self);
 *   - case differences                     → blocked (self);
 *   - leading/trailing whitespace          → blocked (self);
 *   - distinct users                       → allowed (remain distinct);
 *   - missing / malformed identities       → blocked (fail closed).
 *
 * Static checks prove BOTH guard sites (usePatchApprovalStatus hook +
 * MockApprovalsService, DSM parity) route through checkSelfReview and that
 * no broad substring matching or cross-domain equivalence exists.
 *
 * Also carries the S33 certified-truthfulness check: the Contract Profile
 * Activity tab must present the deferred activity backend honestly.
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

// ── Compile the REAL identity utility ───────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's33-identity-'));
const outfile = join(tmp, 'identity.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3/src/utils/identity.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error',
});
const { canonicalizeIdentity, checkSelfReview } = require(outfile);

const CLAIM = 'i:0#.f|membership|owner@geekaygames.onmicrosoft.com';
const BARE  = 'owner@geekaygames.onmicrosoft.com';

// ── canonicalizeIdentity ────────────────────────────────────────────────────
check('canon: bare email lower-cased and trimmed',
  canonicalizeIdentity('  Owner@GeekayGames.OnMicrosoft.Com  ') === BARE);
check('canon: membership claim prefix stripped (anchored only)',
  canonicalizeIdentity(CLAIM) === BARE);
check('canon: upper-cased claim prefix stripped',
  canonicalizeIdentity('I:0#.F|MEMBERSHIP|Owner@GeekayGames.OnMicrosoft.Com') === BARE);
check('canon: claim prefix NOT stripped mid-string (no substring matching)',
  canonicalizeIdentity('user@x.com i:0#.f|membership|other@x.com') === null);
check('canon: null/undefined/empty/whitespace → null (indeterminate)',
  canonicalizeIdentity(null) === null && canonicalizeIdentity(undefined) === null &&
  canonicalizeIdentity('') === null && canonicalizeIdentity('   ') === null);
check('canon: bare claim prefix with no identity → null',
  canonicalizeIdentity('i:0#.f|membership|') === null);
check('canon: residual pipe / other claim forms → null (never guessed)',
  canonicalizeIdentity('i:0#.w|domain\\user') === null &&
  canonicalizeIdentity('c:0(.s|true') === null);
check('canon: non-UPN strings → null (no @, multiple @, empty parts)',
  canonicalizeIdentity('justaname') === null &&
  canonicalizeIdentity('a@@b.com') === null &&
  canonicalizeIdentity('@domain.com') === null &&
  canonicalizeIdentity('user@') === null);

// ── checkSelfReview: mandated blocking matrix ───────────────────────────────
check('self: identical bare emails blocked',
  checkSelfReview(BARE, BARE).blocked === true && checkSelfReview(BARE, BARE).reason === 'self');
check('self: bare email vs membership claim blocked',
  checkSelfReview(BARE, CLAIM).blocked === true && checkSelfReview(BARE, CLAIM).reason === 'self');
check('self: membership claim vs bare email blocked',
  checkSelfReview(CLAIM, BARE).blocked === true && checkSelfReview(CLAIM, BARE).reason === 'self');
check('self: case differences blocked',
  checkSelfReview('Owner@GeekayGames.OnMicrosoft.Com', CLAIM).blocked === true);
check('self: leading/trailing whitespace blocked',
  checkSelfReview(`  ${BARE}  `, `${CLAIM} `).blocked === true);

// distinct users remain distinct.
check('distinct: different users allowed',
  checkSelfReview('reviewer@geekaygames.onmicrosoft.com', CLAIM).blocked === false);
check('distinct: different domains NOT equated (no alias equivalence)',
  checkSelfReview('owner@geekaygames.com', 'owner@geekaygames.onmicrosoft.com').blocked === false);
check('distinct: substring identities NOT equated',
  checkSelfReview('owner@geekaygames.onmicrosoft.com', 'xowner@geekaygames.onmicrosoft.com').blocked === false);

// fail closed on missing / malformed identity.
check('closed: missing reviewer identity blocks (indeterminate-reviewer)',
  checkSelfReview('', CLAIM).blocked === true && checkSelfReview('', CLAIM).reason === 'indeterminate-reviewer' &&
  checkSelfReview(null, CLAIM).blocked === true && checkSelfReview(undefined, CLAIM).blocked === true);
check('closed: missing/malformed submitter blocks (indeterminate-submitter)',
  checkSelfReview(CLAIM, '').reason === 'indeterminate-submitter' &&
  checkSelfReview(CLAIM, 'not-an-identity').reason === 'indeterminate-submitter' &&
  checkSelfReview(CLAIM, null).blocked === true);

// ── Guard sites (static source discipline) ──────────────────────────────────
const hook = read('packages/c3/src/hooks/usePatchApprovalStatus.ts');
const mock = read('packages/c3/src/services/mock/MockApprovalsService.ts');
const identitySrc = read('packages/c3/src/utils/identity.ts');

check('site: hook guard routes through checkSelfReview and throws SelfApprovalError',
  hook.includes("import { checkSelfReview } from '@c3/utils/identity'") &&
  /checkSelfReview\(currentUser\.loginName, approval\.submittedBy\)[\s\S]{0,220}throw new SelfApprovalError/.test(hook) &&
  !/currentUser\.loginName === approval\.submittedBy/.test(hook));
check('site: hook fails closed on indeterminate identity (no fail-open loginName && guard)',
  !/currentUser\.loginName &&\s*\n?\s*currentUser\.loginName ===/.test(hook) &&
  hook.includes("selfCheck.reason !== 'self'"));
check('site: mock DSM guard routes through checkSelfReview (parity)',
  mock.includes("import { checkSelfReview } from '@c3/utils/identity'") &&
  /checkSelfReview\(currentUserLoginName, existing\.submittedBy\)/.test(mock) &&
  !/currentUserLoginName === existing\.submittedBy/.test(mock));
check('site: normalizer strips ONLY the anchored membership prefix',
  identitySrc.includes('^i:0#\\.f\\|membership\\|') &&
  !/includes\(|indexOf\('i:0/.test(identitySrc));
check('site: no other raw identity equality remains in approvals paths',
  !/loginName === .*submittedBy|submittedBy === .*loginName/i.test(
    read('packages/c3/src/hooks/usePatchApprovalStatus.ts') +
    read('packages/c3/src/services/mock/MockApprovalsService.ts')));

// no legacy-row mutation: the fix is comparison-only (no writes added).
check('boundary: identity fix adds no SharePoint write surface',
  !/_api\/|X-HTTP-Method|MERGE|POST/.test(identitySrc));

// ── S33 certified truthfulness: Activity tab honest deferred state ──────────
const profile = read('packages/c3/src/screens/ContractProfile.tsx');
check('truthfulness: Activity tab presents deferred backend honestly',
  profile.includes('title="Activity not yet available"') &&
  profile.includes('not yet supported') &&
  !profile.includes('title="No activity yet"'));
check('truthfulness: no activity backend was implemented (scope contained)',
  /listContractActivities[\s\S]{0,200}not implemented in S24/.test(
    read('packages/c3/src/services/sharepoint/SharePointContractService.ts')));

rmSync(tmp, { recursive: true, force: true });

console.log(`\ns33-parity-identity-hardening: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) { console.error('FAILED:', failures); process.exit(1); }
