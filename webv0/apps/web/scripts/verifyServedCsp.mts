/**
 * verifyServedCsp.mts — check what an environment ACTUALLY SERVES, not what the
 * repo says it should.
 *
 * ⚖️ WHY THIS EXISTS. The CSP P0 (2026-08-02) shipped a policy naming staging's
 * API to production. Deriving `connect-src` from the build fixes the SOURCE —
 * but the fix lives on `master`, and production is built from a SEPARATE CLONE
 * (`C:\Projects\c3-deploy-prod`) which at the time of writing sat three commits
 * behind and still carried the old hardcoded file. **A correct artifact in a
 * repository nobody deploys from is not a fix.** That is instance 52's shape:
 * the API served four-day-old code while two ceremonies recorded it shipped.
 *
 * So this asks the only question that cannot be answered from the tree: **what
 * is the edge returning right now?** It does not care which clone built it,
 * whether the build step ran, or whether the deploy went to the right branch.
 *
 * ⛔ AND IT IS RUNNABLE, WHICH THE ORIGINAL DEFECT WAS NOT. A CSP is *enforced*
 * only by browsers — which is why every `curl` check against the API passed
 * while the app was broken. But the header itself is plainly visible to `curl`.
 * The defect was never invisible; it was merely never read.
 *
 * Usage:
 *   tsx scripts/verifyServedCsp.mts https://app.c3hq.org https://api.c3hq.org
 *   tsx scripts/verifyServedCsp.mts https://staging.c3hq.org https://api.staging.c3hq.org
 */
import { apiOriginFrom } from './csp.mjs';

const [, , appUrlArg, apiUrlArg] = process.argv;

if (!appUrlArg || !apiUrlArg) {
  console.error(
    'usage: verifyServedCsp.mts <app-origin> <expected-api-origin>\n' +
      '  e.g. verifyServedCsp.mts https://app.c3hq.org https://api.c3hq.org',
  );
  process.exit(2);
}

const appOrigin = new URL(appUrlArg).origin;
const expectedApi = apiOriginFrom(apiUrlArg);

interface Finding {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
}

const findings: Finding[] = [];

const res = await fetch(appOrigin, { redirect: 'follow' });
const csp = res.headers.get('content-security-policy') ?? '';

if (!csp) {
  findings.push({ ok: false, label: 'CSP present', detail: 'no Content-Security-Policy header served at all' });
} else {
  const connect = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('connect-src'));

  findings.push({
    ok: Boolean(connect?.includes(expectedApi)),
    label: 'connect-src permits THIS environment’s API',
    detail: connect ?? '(no connect-src directive)',
  });

  // The inverse is the same defect from the other side, and it is the half that
  // stayed invisible: production could reach staging, and nothing complained.
  const foreign = [expectedApi.includes('staging') ? 'https://api.c3hq.org' : 'https://api.staging.c3hq.org'];
  for (const other of foreign) {
    findings.push({
      ok: !connect?.includes(other),
      label: `connect-src does NOT permit ${other}`,
      detail: connect ?? '(no connect-src directive)',
    });
  }
}

// The other served-header defect from the same day: /sw.js edge-cached 4h while
// _headers asked for no-cache. A stale service worker pins the old shell in
// users' browsers, so a correct deploy can still be invisible to them.
const sw = await fetch(`${appOrigin}/sw.js`, { redirect: 'follow' });
const swCache = sw.headers.get('cache-control') ?? '';
const swType = sw.headers.get('content-type') ?? '';
findings.push({
  ok: /no-cache/i.test(swCache),
  label: '/sw.js is not edge-cached',
  detail: `cache-control: ${swCache || '(absent)'}`,
});
findings.push({
  ok: /javascript/i.test(swType),
  label: '/sw.js is JavaScript, not the SPA fallback',
  detail: `content-type: ${swType || '(absent)'}`,
});

console.log(`\nserved by ${appOrigin}:`);
for (const f of findings) console.log(`  ${f.ok ? 'ok  ' : 'FAIL'}  ${f.label}\n        ${f.detail}`);

const failed = findings.filter((f) => !f.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) FAILED against ${appOrigin}.`);
  process.exit(1);
}
console.log('\nall checks passed.');
