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
 * ⛔ `deploymentId` IS NOT AN IDENTITY, AND IS NEVER USED AS ONE. It cannot be
 * computed from a commit, so admitting it to the *identity* check would smuggle
 * in exactly the random-build-id this design rejects.
 *
 * ⚖️ IT IS, HOWEVER, A FRESHNESS WITNESS — a distinct question the token cannot
 * answer. The token says *which build*; it cannot say *whether a deploy
 * happened*. Those come apart in a real window: setting `C3_BUILD_TOKEN` may
 * redeploy the OLD image carrying the NEW token, and an identity-only check
 * PASSES that. So when a caller supplies the deployment id observed BEFORE the
 * deploy, this requires it to have MOVED. Same shape as the banked deploy
 * witness — `active SUCCESS` **plus a moved imageDigest** — re-derived here
 * because a law does not transfer itself to a new layer.
 *
 * ⛔ THE FRESHNESS HALF IS ONLY SOUND IF THE TOKEN WAS SET WITH `--skip-deploys`.
 * Without it the variable change itself redeploys, so the "before" id moves
 * BEFORE `railway up` runs and this check would pass a FAILED deploy. The
 * ceremony in `stampBuild.mts` mandates the flag for exactly that reason.
 *
 * ⚠️ EXIT CODE, AND WHY IT IS SET RATHER THAN FORCED. `process.exit()` here raced
 * Node's teardown on Windows and aborted with a libuv assertion (`exit=127`)
 * AFTER printing `MATCH` — the verification succeeded and the process died on the
 * way out. **An acceptance instrument whose exit code contradicts its own verdict
 * is worse than one with no exit code**, because `verifyVersion && deploy` then
 * fails on success. So the connection is closed explicitly and `process.exitCode`
 * lets the loop drain instead of tearing it down mid-flight.
 *
 * The before-id is optional (it does not exist for a routine spot-check), and
 * when it is omitted this SAYS the freshness half was not checked rather than
 * reporting a narrower pass as a wider one.
 *
 * Usage:
 *   tsx apps/api/scripts/verifyVersion.mts https://api.c3hq.org <full-40-char-sha> [before-deployment-id]
 */
import { tokenForCommit, versionVerdict } from '../src/buildIdentity.js';

const [, , apiUrlArg, commitArg, beforeDeploymentArg] = process.argv;

async function main(): Promise<number> {
  if (!apiUrlArg || !commitArg) {
    console.error(
      'usage: verifyVersion.mts <api-origin> <commit-sha> [before-deployment-id]\n' +
        '  e.g. verifyVersion.mts https://api.c3hq.org 07d2d64…(40 hex) dep-abc123\n' +
        '  The commit is REQUIRED and not defaulted to HEAD: a mismatch may mean your\n' +
        '  local repo is behind, not that the deploy failed, and the tool must not\n' +
        '  choose between those for you.',
    );
    return 2;
  }

  let expected: string;
  try {
    expected = tokenForCommit(commitArg.trim());
  } catch (err) {
    console.error(`[verify] ${(err as Error).message}`);
    console.error('  Pass the FULL 40-character commit id (git rev-parse <ref>).');
    return 2;
  }

  const origin = new URL(apiUrlArg).origin;
  // `Connection: close` so no keep-alive socket outlives the verdict — see the
  // exit-code note above; a lingering handle is what turned a MATCH into exit 127.
  const res = await fetch(`${origin}/version`, { headers: { connection: 'close' } });
  if (!res.ok) {
    console.error(`[verify] ${origin}/version returned ${res.status} — no version tell to check.`);
    return 1;
  }

  const body = (await res.json()) as {
    buildToken?: string;
    environmentName?: string | null;
    projectId?: string;
    deploymentId?: string | null;
  };

  console.log(`\n${origin}/version`);
  console.log(`  environment   ${body.environmentName ?? '(unnamed)'}  [project ${body.projectId ?? '(none)'}]`);
  console.log(`  deploymentId  ${body.deploymentId ?? '(none)'}   ← freshness only, never identity`);
  console.log(`  served token  ${body.buildToken ?? '(none)'}`);
  console.log(`  expected      ${expected}   (from ${commitArg.trim().slice(0, 12)})`);

  const verdict = versionVerdict({
    expected,
    served: {
      buildToken: body.buildToken ?? null,
      environmentName: body.environmentName ?? null,
      projectId: body.projectId ?? null,
      deploymentId: body.deploymentId ?? null,
    },
    beforeDeploymentId: beforeDeploymentArg,
  });

  switch (verdict.kind) {
    case 'UNSTAMPED':
      console.error('\n[verify] FAIL — the service served no build token. It was deployed without a stamp.');
      return 1;
    case 'MISMATCH':
      console.error(
        `\n[verify] MISMATCH — ${commitArg.trim().slice(0, 12)} is NOT what is running.\n` +
          '  Two causes, and this tool will not choose between them:\n' +
          '    · the deploy did not ship that commit, or\n' +
          '    · the repo you took this commit from is not the one that was deployed.\n' +
          '  Check which clone the deploy was built from before concluding the deploy failed.',
      );
      return 1;
    case 'FRESHNESS_UNCHECKED':
      console.log(
        '\n[verify] MATCH — the running build is that commit.' +
          '\n[verify] ⚠️ FRESHNESS NOT CHECKED — no before-deployment-id was given, so this cannot' +
          '\n         distinguish "the deploy shipped" from "the old image was restarted carrying the' +
          '\n         new token". Pass the deployment id observed BEFORE the deploy to close that.',
      );
      return 0;
    case 'NO_DEPLOYMENT_ID':
      console.error(
        '\n[verify] FAIL — a before-deployment-id was given, but the service reports no deployment id,' +
          '\n  so the freshness half cannot be evaluated at all. Absence is not a pass.',
      );
      return 1;
    case 'STALE':
      console.error(
        `\n[verify] STALE — the token matches, but the deployment id has NOT moved (${verdict.deploymentId}).` +
          '\n  The token is set on the SERVICE, not baked into the image, so this is the signature of' +
          '\n  the old image restarting with the new token while `railway up` did not take.' +
          '\n  ⛔ Identity alone would have passed this. That is why the second half exists.',
      );
      return 1;
    case 'FRESH':
      console.log(
        '\n[verify] MATCH — the running build is that commit,' +
          `\n         and the deployment MOVED ${verdict.from} → ${verdict.to}.`,
      );
      return 0;
  }
}

// ⛔ `process.exitCode`, never `process.exit()`. Forcing exit here raced Node's
// teardown on Windows and aborted with a libuv assertion AFTER printing the
// verdict — so `verifyVersion && deploy` failed on success. Setting the code and
// letting the loop drain keeps the exit status agreeing with what was printed.
process.exitCode = await main();
