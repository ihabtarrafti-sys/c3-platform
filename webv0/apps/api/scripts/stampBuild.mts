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
import { CANONICAL_REPO, isCanonicalSharedRemote, renderCeremony } from './ceremony.mjs';

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

/*
 * ⛔ LAW 31 — THE COMMIT MUST BE ON THE SHARED REMOTE BEFORE IT IS STAMPED.
 *
 * Measured 2026-08-04: the deploy chain shipped a security boundary
 * (`platformEntra.ts`) straight from this machine into production while GitHub
 * sat two commits behind. Two consequences, and the second is the sharp one:
 * the deployed code had NO off-machine copy, and **the build token stopped
 * verifying against the shared repository** — a clean clone computed a
 * different expected token than production served, so the verifier would refuse
 * a CORRECT deploy, misleadingly. *An identity proof is only as shared as the
 * repository it is computed from.*
 *
 * ⚖️ Instance 52 with the polarity reversed: there, the deploy did not happen
 * and the record said it did; here, the deploy happened correctly and the
 * shared record could not see it. In both, the artifact and the evidence lived
 * in different places.
 *
 * ⇒ The push is enforced HERE rather than written as a ceremony step, for the
 * same reason the dirty-tree check is: a step in prose is a step that gets
 * skipped under pressure, and this tool exists to make the token trustworthy.
 */
/*
 * ⛔ CR-028 — WHICH REMOTE, CHECKED BEFORE THE FETCH RATHER THAN AFTER.
 *
 * The ancestry guard below proves HEAD is on `origin/master`. It does not prove
 * `origin` is the shared repository — `origin` is a local nickname, and a bare repo
 * in a temp directory answers to it just as well. Clean tree, successful fetch,
 * valid ancestry, and the commit has still never left this machine.
 *
 * ⇒ Ordered FIRST on purpose: fetching an unknown remote is itself the thing worth
 * not doing, and a refusal that happens after the network call has already told a
 * stranger what we are looking for.
 */
let originUrl: string;
try {
  originUrl = git('config', '--get', 'remote.origin.url');
} catch {
  console.error(
    '[stamp] REFUSING: this repository has no `origin` remote.\n' +
      '  There is nothing to prove the commit is shared against.',
  );
  process.exit(1);
}
if (!isCanonicalSharedRemote(originUrl)) {
  console.error(
    `[stamp] REFUSING: \`origin\` is ${originUrl}, which is not ${CANONICAL_REPO}.\n` +
      '  `origin` is a NICKNAME, not an identity. Ancestry against an arbitrary remote proves\n' +
      '  the shape of sharedness while assuming its subject: a bare repository on this same\n' +
      '  disk satisfies the clean-tree check, the fetch, and the ancestry check, and the commit\n' +
      '  still has no off-machine copy. Point `origin` at the canonical repository and re-stamp.',
  );
  process.exit(1);
}

try {
  execFileSync('git', ['fetch', 'origin'], { encoding: 'utf8', stdio: 'pipe' });
} catch (err) {
  console.error(
    `[stamp] REFUSING: cannot reach the shared remote (git fetch failed: ${(err as Error).message}).\n` +
      '  Without the remote there is no way to prove this commit is SHARED, and a token\n' +
      '  computed from an unshared commit verifies against a repository nobody else has.',
  );
  process.exit(1);
}
const onRemote = (() => {
  try {
    // Exit 0 iff HEAD is an ancestor of (or equal to) origin/master.
    execFileSync('git', ['merge-base', '--is-ancestor', head, 'origin/master'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();
if (!onRemote) {
  console.error(
    `[stamp] REFUSING: HEAD (${head.slice(0, 12)}) is NOT on origin/master.\n` +
      '  Push first — `git push origin master` — then re-stamp. A token cut from an\n' +
      '  unpushed commit verifies only against THIS machine: production would serve a\n' +
      '  token no clean clone can reproduce, and the deployed code would have no\n' +
      '  off-machine copy. Both happened on 2026-08-04.',
  );
  process.exit(1);
}

const token = tokenForCommit(head);

/**
 * ⛔ WHY THE VARIABLE IS SET **BEFORE** `railway up`, AND WHY IT MUST CARRY
 * `--skip-deploys`. Railway redeploys a service when its variables change, so
 * setting the token first would otherwise restart the CURRENTLY RUNNING (old)
 * image carrying the NEW token. For that window the service answers `/version`
 * with a token naming a commit it is not running — and a verifier checking
 * identity alone would PASS it. That is instance 52 rebuilt inside the tool meant
 * to end it.
 *
 * ⇒ Setting it AFTER would swap the failure, not remove it: the new image boots
 * with no token and fail-closes, so the deploy reads as broken until a second
 * step lands.
 *
 * ⚖️ Neither ordering is safe on its own because ONE VALUE CANNOT CARRY BOTH
 * CLAIMS. The token answers *which build*; it cannot answer *did a deploy
 * happen*. So the deploymentId is the second half — the same shape as the banked
 * deploy witness (`active SUCCESS` **plus a MOVED imageDigest**), re-derived here
 * because a law does not transfer itself to a new layer.
 *
 * ⚠️ AND THE FRESHNESS HALF IS ONLY SOUND WITH `--skip-deploys` (Neural, measured
 * during the first real production deploy). An earlier version of this ceremony
 * asserted Railway "documents no flag to suppress" the redeploy. **That was false,
 * and the way it was false is the lesson: the flag is listed by
 * `railway variables set --help`.** This lane hedged the CLI *syntax* — telling
 * the reader to check `--help` — while asserting the *non-existence of a flag*
 * from a docs page that had just proven inadequate for the syntax question.
 * **Absence in the documentation is not absence in the tool; the tool's own
 * `--help` was the authority for both claims.**
 */

console.log(renderCeremony(token, head));
