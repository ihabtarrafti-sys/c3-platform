/**
 * buildIdentity.ts — what build is running, and where.
 *
 * ⚖️ INSTANCE 32, RESTATED PROPERLY. `/health` returns `{status:'ok'}` — a
 * literal, byte-identical before and after any deploy. It read green against an
 * image four days stale while two ceremonies recorded the deploy as shipped.
 * **The requirement is not an endpoint that exists; it is a value that DIFFERS
 * between builds AND can be checked against an expectation.** A value that
 * merely differs is a liveness check wearing a version number.
 *
 * ⇒ The token is `sha256(commit)` truncated: `expected = f(sha)` is computable
 * by anyone holding the repo and by nobody without it. It **identifies** the
 * build to those entitled to know, **differs** between builds, and **discloses
 * no revision** to the public — which matters now that `D-001` makes C3 a
 * sellable product rather than an internal tool.
 *
 * ⛔ LAW 18 — WHY A DIRTY TREE CANNOT PRODUCE A TOKEN. `railway up` uploads a
 * WORKING DIRECTORY, not a commit (that is instance 52's mechanism). So a token
 * hashed from `git rev-parse HEAD` over a dirty tree names a commit whose
 * content is NOT what shipped, and a verifier computing `expected = f(sha)`
 * would CONFIRM it. That converts "I do not know what is running" into "I know,
 * and I am wrong" — and being wrong with confidence retires the question, so
 * nobody looks again. **Refusing is the only honest option; a dirty build has no
 * commit to name.**
 */
import { createHash } from 'node:crypto';

/** A 40-hex git commit id. Anything else is refused rather than hashed. */
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * The public build token: a deterministic short digest of the commit.
 *
 * Truncated to 12 hex chars — enough that two builds colliding is not a
 * practical concern for an identity check, short enough to read aloud.
 */
export function tokenForCommit(commitSha: string): string {
  if (!SHA_RE.test(commitSha)) {
    throw new Error(`build token refuses a non-commit input: ${JSON.stringify(commitSha)}`);
  }
  return createHash('sha256').update(commitSha).digest('hex').slice(0, 12);
}

/**
 * What the API knows about its own build, read from the stamp written at deploy
 * time. There is deliberately no `commitSha` field: the clear revision must not
 * be reachable from a public endpoint.
 */
export interface BuildStamp {
  readonly buildToken: string;
  /** ISO instant the stamp was cut. Human context only — never an identity. */
  readonly stampedAt: string;
}

/**
 * ⛔ TRUTHINESS, NOT PRESENCE (LAW 17). Three tools disagreed about "not
 * configured" in one day: PowerShell DELETES a variable set to empty (empty ⇒
 * absent); `??` passes an empty string straight through (empty ⇒ present); and
 * Vite's genuinely-absent `VITE_ENV_LABEL` fired a fallback that put a STAGING
 * badge on production for twelve hours.
 *
 * Railway proves it in our own runtime: `RAILWAY_GIT_REPO_OWNER` is **set and
 * empty**, so `?? 'unknown'` yields `''` rather than `'unknown'`. Every read
 * here therefore tests for a non-empty value, and **refuses rather than
 * defaulting** wherever a wrong value would be indistinguishable from a
 * configured one.
 */
function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface RuntimeIdentity {
  /** Discriminated on the platform-injected project ID — never a hand-set label. */
  readonly projectId: string;
  /** Human-facing only. Names are editable in a dashboard; IDs are not. */
  readonly environmentName: string | null;
  /**
   * Correlates the running service with a row in the platform dashboard.
   * ⛔ USEFUL FOR AN OPERATOR, USELESS AS PROOF — it cannot be computed from a
   * commit, so it must never reach an acceptance path. That is the random-build-id
   * failure arriving by the back door.
   */
  readonly deploymentId: string | null;
}

/**
 * Read the platform-injected identity.
 *
 * ⚖️ NO HAND-SET ENVIRONMENT LABEL, deliberately (Neural's ruling). An
 * `API_ENV_LABEL` would rebuild the exact defect that shipped a STAGING badge to
 * production: a value a human must remember to set on a build command. A
 * platform-injected value cannot be forgotten, which is the entire failure mode.
 */
/** The exact public shape of `GET /version`. */
export interface VersionPayload {
  readonly buildToken: string | null;
  readonly environmentName: string | null;
  readonly projectId: string | null;
  readonly deploymentId: string | null;
}

/**
 * Build the public payload.
 *
 * ⛔ THERE IS NO `commitSha` FIELD, AND A GUARD ENFORCES IT (Neural's ruling).
 * Until that guard existed the constraint was held by care alone: adding
 * `commitSha` here for one debugging session would be a one-word diff, in a
 * route nobody re-reads, shipping a **public revision disclosure on a sellable
 * product** — and a response schema that permits additional properties would
 * not notice. `buildIdentity.test.ts` asserts the serialised payload contains
 * **no 40-character hex string**, which guards the CLASS rather than the field
 * name: a `revision`, `sha`, or `gitRef` added later fails the same assertion.
 *
 * ⚖️ *An unguarded constraint is a preference.*
 */
export function versionPayload(
  stamp: BuildStamp | null,
  identity: RuntimeIdentity | null,
): VersionPayload {
  return {
    buildToken: stamp?.buildToken ?? null,
    environmentName: identity?.environmentName ?? null,
    projectId: identity?.projectId ?? null,
    deploymentId: identity?.deploymentId ?? null,
  };
}

export function readRuntimeIdentity(env: NodeJS.ProcessEnv): RuntimeIdentity | null {
  const projectId = nonEmpty(env.RAILWAY_PROJECT_ID);
  if (!projectId) return null;
  return {
    projectId,
    environmentName: nonEmpty(env.RAILWAY_ENVIRONMENT_NAME),
    deploymentId: nonEmpty(env.RAILWAY_DEPLOYMENT_ID),
  };
}
