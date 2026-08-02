/**
 * stampBuild.mts — cut the build stamp immediately before `railway up`.
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
 * Usage (from webv0/, immediately before `railway up`):
 *   tsx apps/api/scripts/stampBuild.mts
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokenForCommit } from '../src/buildIdentity.js';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * ⛔ NOT inside `src/`. `apps/api/src` is a FROZEN policy root — its tree hash
 * is a sunset fingerprint — so a generated file living there would move a seal
 * on EVERY DEPLOY and demand a re-baseline each time. That is the rubber-stamp
 * failure the registry design exists to avoid, and it would have been
 * self-inflicted. The sunset refresh caught it
 * (`SUNSET_REFRESH_UNTRACKED_FINGERPRINT_INPUT`) before it could ship.
 */
const stampPath = join(apiRoot, 'buildStamp.json');

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let head: string;
let dirty: string;
try {
  head = git('rev-parse', 'HEAD');
  // --porcelain lists tracked modifications AND untracked files. Untracked
  // counts: `railway up` uploads them, so they are part of what ships.
  //
  // ⚠️ EXCEPT THE STAMP ITSELF. Writing the stamp dirties the tree, so without
  // this a second stamp would refuse — the tool would work exactly once. It is
  // gitignored (so this is belt-and-braces for a checkout where it is not), and
  // excluding it is safe for a reason worth stating: a STALE stamp produces a
  // MISMATCH at the verifier, which is loud. The failure LAW 18 guards against
  // is the opposite — a token that CONFIRMS a lie — and a stamp file cannot
  // cause that, because it carries no behaviour.
  dirty = git('status', '--porcelain')
    .split('\n')
    .filter((line) => line.trim() && !line.includes('apps/api/buildStamp.json'))
    .join('\n');
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

const stamp = { buildToken: tokenForCommit(head), stampedAt: new Date().toISOString() };
writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
console.log(`[stamp] ${stampPath} — token ${stamp.buildToken} for ${head.slice(0, 12)}`);
