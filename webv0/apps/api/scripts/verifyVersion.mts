/**
 * verifyVersion.mts — is the running API the build I believe I shipped?
 *
 * ⚖️ THE QUESTION IS NEVER "is this a different build?" — it is "is this THE
 * build?" So this computes `expected = f(commit)` locally and compares it with
 * what the service serves. A tell that cannot be checked against an expectation
 * is a liveness check wearing a version number, which is the critique that
 * opened instance 32.
 *
 * ⛔ THE COMMIT MUST BE NAMED. It is deliberately NOT defaulted to `HEAD`,
 * because a mismatch has TWO causes and the natural reading picks the wrong one:
 *   1. the deploy did not ship, or
 *   2. **the local repo is not at the commit you think it is.**
 * We hit (2) this morning — `c3-deploy-prod` sat three commits behind master and
 * a rebuild there would have reshipped a fixed P0. Naming the commit makes the
 * output *"<sha> does not match what is running"* — a FACT — instead of
 * *"production is stale"*, which is an inference the tool is not entitled to.
 *
 * ⛔ `deploymentId` IS NOT EVIDENCE. It is reported because it correlates the
 * service with a dashboard row, and it is never compared: it cannot be computed
 * from a commit, so admitting it to an acceptance path would smuggle in exactly
 * the random-build-id this design rejects.
 *
 * Usage:
 *   tsx apps/api/scripts/verifyVersion.mts https://api.c3hq.org <full-40-char-sha>
 */
import { tokenForCommit } from '../src/buildIdentity.js';

const [, , apiUrlArg, commitArg] = process.argv;

if (!apiUrlArg || !commitArg) {
  console.error(
    'usage: verifyVersion.mts <api-origin> <commit-sha>\n' +
      '  e.g. verifyVersion.mts https://api.c3hq.org 07d2d64…(40 hex)\n' +
      '  The commit is REQUIRED and not defaulted to HEAD: a mismatch may mean your\n' +
      '  local repo is behind, not that the deploy failed, and the tool must not\n' +
      '  choose between those for you.',
  );
  process.exit(2);
}

let expected: string;
try {
  expected = tokenForCommit(commitArg.trim());
} catch (err) {
  console.error(`[verify] ${(err as Error).message}`);
  console.error('  Pass the FULL 40-character commit id (git rev-parse <ref>).');
  process.exit(2);
}

const origin = new URL(apiUrlArg).origin;
const res = await fetch(`${origin}/version`);
if (!res.ok) {
  console.error(`[verify] ${origin}/version returned ${res.status} — no version tell to check.`);
  process.exit(1);
}

const body = (await res.json()) as {
  buildToken?: string;
  environmentName?: string | null;
  projectId?: string;
  deploymentId?: string | null;
};

console.log(`\n${origin}/version`);
console.log(`  environment   ${body.environmentName ?? '(unnamed)'}  [project ${body.projectId ?? '(none)'}]`);
console.log(`  deploymentId  ${body.deploymentId ?? '(none)'}   ← correlation only, never evidence`);
console.log(`  served token  ${body.buildToken ?? '(none)'}`);
console.log(`  expected      ${expected}   (from ${commitArg.trim().slice(0, 12)})`);

if (!body.buildToken) {
  console.error('\n[verify] FAIL — the service served no build token. It was deployed without a stamp.');
  process.exit(1);
}
if (body.buildToken !== expected) {
  console.error(
    `\n[verify] MISMATCH — ${commitArg.trim().slice(0, 12)} is NOT what is running.\n` +
      '  Two causes, and this tool will not choose between them:\n' +
      '    · the deploy did not ship that commit, or\n' +
      '    · the repo you took this commit from is not the one that was deployed.\n' +
      '  Check which clone the deploy was built from before concluding the deploy failed.',
  );
  process.exit(1);
}
console.log('\n[verify] MATCH — the running build is that commit.');
