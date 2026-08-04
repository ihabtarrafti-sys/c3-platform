/**
 * ceremony.mts — the PRODUCTION deploy ceremony, as a pure function.
 *
 * ⛔ WHY THIS IS A MODULE AND NOT A `console.log` INSIDE `stampBuild.mts`.
 * The ceremony text has now shipped TWO operator-facing defects, and a human
 * running it caught BOTH — the gate caught neither, because a string inside a
 * top-level script that refuses to run on a dirty tree is a string no test can
 * reach:
 *
 *   1. It printed bare `railway …`, assuming a global install. The owner hit
 *      `The term 'railway' is not recognized` mid-deploy.
 *   2. It printed an UNPINNED `railway up` from a directory linked to STAGING,
 *      in a ceremony whose step 4 verifies `api.c3hq.org`. (CR-029.)
 *
 * ⚖️ Both are the same failure: **asserting something about the environment
 * instead of checking it.** And the reason both survived review is structural —
 * `tsc` type-checks a template literal it cannot render, so the only thing that
 * can catch a wrong *value* is something that renders it and reads the result.
 * A backtick inside one of these literals once produced a runtime error that
 * type-checked cleanly; the test that caught it rendered `csp.mts`'s output.
 * This module exists so the same test shape can be applied here.
 *
 * ⇒ It lives in `scripts/` deliberately: `apps/api/src#tree` is a SEALED surface
 * in the sunset registry, so a file added there costs a registry refresh for no
 * benefit — nothing in the running image needs the ceremony.
 */

/**
 * ⛔ THE CEREMONY PRINTS THE RUNNABLE FORM, NOT THE IDIOMATIC ONE.
 *
 * A ceremony is followed under pressure, so a command that does not run is worse
 * than no command — it costs the reader the trust that the rest of the steps are
 * right, at exactly the moment they most need to follow them without thinking.
 */
export const RAILWAY = 'npx --yes @railway/cli@latest';

/**
 * ⛔ CR-029 — THE TARGET IS PINNED, BECAUSE THE AMBIENT LINK POINTS SOMEWHERE ELSE.
 *
 * `webv0/` is Railway-linked to STAGING. Every unpinned `railway` command run from
 * this directory therefore resolves to the STAGING project — and this is a PRODUCTION
 * ceremony, as step 4 has always said by naming `api.c3hq.org`.
 *
 * ⚖️ THAT INCOHERENCE WAS THE DEFECT: the ceremony named production in the step that
 * VERIFIES and let the environment choose the target in the step that SHIPS. Measured
 * 2026-08-04 — `railway up` from `webv0` resolved to staging, and the only thing that
 * refused it was the drill service happening not to exist there. **A deploy aimed at
 * the wrong project by an ambient default fails SILENTLY into a real service; there is
 * no error to read, because everything the operator typed was valid.**
 *
 * ⇒ Pinning can also be wrong — a stale id here would break every command. That is the
 * trade being made deliberately: a wrong pin fails LOUDLY on the first command ("project
 * not found") and is fixed in one line, while a wrong ambient link ships production code
 * into staging and reports success. **Explicit-and-loud beats ambient-and-silent.**
 *
 * ⚠️ This ceremony is PRODUCTION-ONLY and is now honest about it in every step. It must
 * not be reused to stamp a staging deploy: with the pin, that would push staging code
 * into production — the exact failure it prevents, with the polarity reversed.
 */
export const PROJECT = 'e6eb2f39-5e5b-413a-a594-72a681c34c86'; // C3 Atlas Production
export const SERVICE = 'c3-api';
export const PIN = `-p ${PROJECT} -s ${SERVICE}`;

/** The production API origin the ceremony's own verification step checks. */
export const API_ORIGIN = 'https://api.c3hq.org';

/**
 * Render the ceremony for a given build token and commit.
 *
 * @param token the build stamp, `sha256(commit)[0:12]`
 * @param head  the full commit sha the token names
 */
export function renderCeremony(token: string, head: string): string {
  return (
    `\n[stamp] token ${token}   (commit ${head.slice(0, 12)}, tree clean)\n` +
    `\nCeremony — run these in order, from webv0/. TARGET: C3 Atlas Production (${SERVICE}).\n` +
    '⛔ Every command below pins the project EXPLICITLY. webv0/ is linked to STAGING, so an\n' +
    '   unpinned command ships to the wrong project and reports success. Do not drop the pin.\n' +
    '\n  1. Record the deployment that is running NOW (the "before" half of the witness):\n' +
    `       ${RAILWAY} status --json -p ${PROJECT}\n` +
    '     …and keep its deployment id. ⛳ CHECK THE PROJECT NAME IN THAT OUTPUT READS\n' +
    '     "C3 Atlas Production" before going further — the pin is an id, and an id is not\n' +
    '     something a human can proofread. That one glance is what makes it checkable.\n' +
    '     (If it asks you to authenticate, `login` first — a fresh clone carries no session.\n' +
    '      You do NOT need `link`: the pin makes the ambient link irrelevant, which is the point.)\n' +
    '\n  2. Set the token on the service — ⛔ WITH `--skip-deploys`, WHICH IS NOT OPTIONAL:\n' +
    `       ${RAILWAY} variable set C3_BUILD_TOKEN=${token} --skip-deploys ${PIN}\n` +
    '     (`variable set` is current; `--set` still works but the CLI labels it legacy.)\n' +
    '\n     ⚖️ `--skip-deploys` IS LOAD-BEARING FOR THE WITNESS, NOT CONVENIENCE. A variable\n' +
    '     change redeploys the service. Without the flag that restart moves the deploymentId\n' +
    '     BEFORE step 3 ships anything — so the "before" value recorded in step 1 is already\n' +
    '     spent, and step 4 would see a moved id even if `railway up` FAILED. With it there is\n' +
    '     exactly ONE deploy, and the id moving means exactly one thing.\n' +
    '\n  3. Ship the working directory — from webv0/, never a subdirectory:\n' +
    `       ${RAILWAY} up ${PIN}\n` +
    '\n  4. Verify BOTH halves — identity and freshness:\n' +
    `       tsx apps/api/scripts/verifyVersion.mts ${API_ORIGIN} ${head} <before-deployment-id>\n` +
    '\n  A token that matches while the deployment id has NOT moved means step 2 restarted\n' +
    '  the old image and step 3 did not take. That is the only reading of it.\n'
  );
}
