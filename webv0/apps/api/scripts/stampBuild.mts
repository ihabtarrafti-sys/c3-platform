/**
 * stampBuild.mts — cut the build stamp for the next `railway up`.
 *
 * ⛔ IT REFUSES ON A DIRTY TREE, AND THAT REFUSAL IS THE POINT (LAW 18).
 * `railway up` uploads a WORKING DIRECTORY, not a commit. A token hashed from
 * `git rev-parse HEAD` over a dirty tree would name a commit whose content is
 * NOT what shipped — and the verifier, computing `expected = f(sha)` from that
 * same clean commit, would CONFIRM it. **That converts "I do not know what is
 * running" into "I know, and I am wrong", which is strictly worse: a confident
 * wrong answer retires the question and nobody looks again.**
 *
 * A dirty build has no commit to name, so it gets no token. There is no
 * "-dirty" suffix option here on purpose: a suffix invites someone to deploy it
 * anyway, and the thing being protected is the claim, not the convenience.
 *
 * ⚖️ THIS SCRIPT DEPLOYS NOTHING AND SETS NOTHING. It computes a value and
 * prints the ceremony. Deploys are the owner's, and no credential passes through
 * the build lane — so shelling out to `railway` here would put this script on the
 * far side of a boundary it has no business crossing. It is also the only way to
 * keep the ORDERING below in the owner's hands, where the two halves of the
 * witness are actually observable.
 *
 * Usage (from webv0/):
 *   tsx apps/api/scripts/stampBuild.mts
 */
import { execFileSync } from 'node:child_process';
import { tokenForCommit } from '../src/buildIdentity.js';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let head: string;
let dirty: string;
try {
  head = git('rev-parse', 'HEAD');
  // --porcelain lists tracked modifications AND untracked files. Untracked
  // counts: `railway up` uploads them, so they are part of what ships.
  dirty = git('status', '--porcelain');
} catch (err) {
  console.error(`[stamp] REFUSING: cannot read git state — ${(err as Error).message}`);
  process.exit(1);
}

if (dirty) {
  console.error(
    '[stamp] REFUSING: the working tree is DIRTY.\n' +
      `${dirty
        .split('\n')
        .slice(0, 10)
        .map((l) => `    ${l}`)
        .join('\n')}\n` +
      '  `railway up` uploads the WORKING DIRECTORY, not a commit, so a token cut from\n' +
      '  HEAD would name a revision whose content is not what ships — and the verifier\n' +
      '  would agree with it. Commit or stash, then re-stamp.',
  );
  process.exit(1);
}

const token = tokenForCommit(head);

/**
 * ⛔ WHY THE VARIABLE IS SET **BEFORE** `railway up`, AND WHY THAT ALONE IS NOT
 * ENOUGH. Railway redeploys a service when its variables change, so setting the
 * token first can restart the CURRENTLY RUNNING (old) image carrying the NEW
 * token. For that window the service answers `/version` with a token naming a
 * commit it is not running — and the verifier, checking identity alone, would
 * PASS it. That is instance 52 rebuilt inside the tool meant to end it.
 *
 * ⇒ Setting it AFTER would swap the failure, not remove it: the new image boots
 * with no token and fail-closes, so the deploy reads as broken until a second
 * step lands.
 *
 * ⚖️ Neither ordering is safe on its own because ONE VALUE CANNOT CARRY BOTH
 * CLAIMS. The token answers *which build*; it cannot answer *did a deploy
 * happen*. So the deploymentId recorded below is the second half — the same
 * shape as the banked deploy witness (`active SUCCESS` **plus a MOVED
 * imageDigest**), re-derived here because a law does not transfer itself to a
 * new layer.
 */
console.log(
  `\n[stamp] token ${token}   (commit ${head.slice(0, 12)}, tree clean)\n` +
    '\nCeremony — run these in order, from webv0/:\n' +
    '\n  1. Record the deployment that is running NOW (the "before" half of the witness):\n' +
    '       railway status --json\n' +
    '     …and keep its deployment id.\n' +
    `\n  2. Set the token on the service (it may trigger a redeploy of the OLD image —\n` +
    '     expected, and step 4 is what catches it):\n' +
    `       railway variables --set C3_BUILD_TOKEN=${token}\n` +
    '\n  3. Ship the working directory — from webv0/, never a subdirectory:\n' +
    '       railway up\n' +
    '\n  4. Verify BOTH halves — identity and freshness:\n' +
    `       tsx apps/api/scripts/verifyVersion.mts https://api.c3hq.org ${head} <before-deployment-id>\n` +
    '\n  A token that matches while the deployment id has NOT moved means step 2 restarted\n' +
    '  the old image and step 3 did not take. That is the only reading of it.\n',
);
