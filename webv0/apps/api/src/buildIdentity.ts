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
 * What the API knows about its own build. There is deliberately no `commitSha`
 * field: the clear revision must not be reachable from a public endpoint.
 */
export interface BuildStamp {
  readonly buildToken: string;
}

/** The shape `tokenForCommit` produces. A stamp of any other shape is refused. */
const BUILD_TOKEN_RE = /^[0-9a-f]{12}$/;

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

/**
 * Read the build stamp the deploy set on the platform.
 *
 * ⛔ WHY A VARIABLE AND NOT A FILE (Neural's catch, instance 32 follow-up). The
 * first cut wrote `apps/api/buildStamp.json` and read it back from the container.
 * That made the tell depend on the file surviving **three** gates nobody had
 * tested: `railway up`'s upload set, the docker build context, and a Dockerfile
 * COPY. And the first of those falls back to **`.gitignore`** when no
 * `.railwayignore` exists — where the stamp was listed by name, because a
 * generated file must not be versioned.
 *
 * ⚖️ THE TWO FILES ANSWER DIFFERENT QUESTIONS. `.gitignore` answers *what should
 * not be VERSIONED*; the uploader asks *what should SHIP*. Borrowing one
 * mechanism's answer for the other question is the day's recurring defect, and
 * here it would have produced a production API that refuses to boot — discovered
 * during a deploy, which is the worst place to learn it.
 *
 * ⛳ `.railwayignore` was the obvious fix and is REFUSED: it *replaces*
 * `.gitignore`, so adopting it means hand-writing the complete list of what must
 * never upload. An omission there ships `node_modules`, `.pgdata`, or a stray
 * `.env` — trading a boot failure for a secret disclosure. A variable crosses no
 * uploader at all, so the question stops existing rather than being answered.
 */
/**
 * The verdict on a served `/version`, as a value rather than control flow inside
 * a script.
 *
 * ⚖️ IT LIVES HERE SO IT CAN BE TESTED. The branch that matters most —
 * `STALE`: token correct, deployment not moved — is precisely the case a human
 * running the tool would never think to stage, and an untested branch guarding a
 * subtle failure is a preference, not a guard.
 */
export type VersionVerdict =
  /** The service served no token: deployed without a stamp. */
  | { readonly kind: 'UNSTAMPED' }
  /** A token, but not this commit's. Cause is ambiguous — the tool must not choose. */
  | { readonly kind: 'MISMATCH'; readonly served: string }
  /** Identity holds; no before-id was supplied, so freshness is UNKNOWN — not passed. */
  | { readonly kind: 'FRESHNESS_UNCHECKED' }
  /** A before-id was supplied but the service reports none. Absence is not a pass. */
  | { readonly kind: 'NO_DEPLOYMENT_ID' }
  /** ⛔ Token correct, deployment id unmoved: the old image restarted with the new token. */
  | { readonly kind: 'STALE'; readonly deploymentId: string }
  /**
   * ⛔ CR-029. The two observations are of DIFFERENT Railway projects, so the
   * "transition" between them is not a transition at all. Two unrelated ids are
   * different for the same reason two strangers have different names.
   */
  | {
      readonly kind: 'PROJECT_MISMATCH';
      readonly beforeProjectId: string;
      readonly servedProjectId: string;
    }
  /** Both halves: this commit, and a deploy genuinely happened. */
  | { readonly kind: 'FRESH'; readonly from: string; readonly to: string };

/**
 * Parse an untrusted `/version` body into a `VersionPayload`.
 *
 * ⛔ CR-017. `verifyVersion.mts` did `(await res.json()) as {...}` — a compile-time
 * assertion over a value that arrives from the network. **A cast at a trust
 * boundary enforces nothing**, which is how `deploymentId: {}` could reach a
 * FRESH verdict.
 *
 * ⚖️ Every field is narrowed to "a non-empty string, or null". Anything else —
 * an object, a number, a blank — becomes `null`, and `null` is a condition the
 * verdict already knows how to refuse. *A malformed field must not be able to
 * mean anything better than a missing one.*
 */
export function parseVersionPayload(value: unknown): VersionPayload {
  const body = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    buildToken: str(body.buildToken),
    environmentName: str(body.environmentName),
    projectId: str(body.projectId),
    deploymentId: str(body.deploymentId),
  };
}

export function versionVerdict(args: {
  readonly expected: string;
  readonly served: VersionPayload;
  readonly beforeDeploymentId?: string | null;
  /**
   * ⛔ CR-029. The Railway project the before-id was observed IN. Freshness is a
   * transition WITHIN one project; without this, the comparison is two ids from
   * anywhere at all.
   */
  readonly beforeProjectId?: string | null;
}): VersionVerdict {
  const { expected, served } = args;
  if (!served.buildToken) return { kind: 'UNSTAMPED' };
  if (served.buildToken !== expected) return { kind: 'MISMATCH', served: served.buildToken };

  // ⛔ FRESHNESS IS EVALUATED ONLY AFTER IDENTITY HOLDS. "The token matches but
  // nothing deployed" is a different and more misleading finding than a plain
  // mismatch, and collapsing them would hide the one that looks like success.
  const before = args.beforeDeploymentId?.trim();
  if (!before) return { kind: 'FRESHNESS_UNCHECKED' };

  // ⛔ CR-017. This read `if (!served.deploymentId)` — a TRUTHINESS test on a
  // value that arrives as untrusted JSON and is merely CAST to `string`. A body
  // serving `deploymentId: {}` is truthy, is not equal to the before-id, and so
  // reached the FRESH verdict: **malformed deployment evidence classified as a
  // successful deploy.** The type annotation described a hope, not a check.
  //
  // ⚖️ Same family as LAW 17 (truthiness, not presence), one turn further on: a
  // non-empty STRING is the requirement, and a type assertion at a trust boundary
  // enforces nothing at runtime.
  /*
   * ⛔ CR-029 — SCOPE THE TRANSITION BEFORE MEASURING IT.
   *
   * `from !== to` was the entire freshness test, and it never asked whether the two
   * ids named the same thing. A before-id recorded against STAGING and an after-id
   * served by PRODUCTION are different for the most trivial reason imaginable —
   * they are unrelated — and that difference read as a successful deploy.
   *
   * ⚠️ NOT HYPOTHETICAL: `railway up` from `webv0/` resolves to staging via the
   * ambient link (CR-029's sibling, now pinned in the ceremony). The two halves are
   * the same defect from opposite ends — nothing bound the deploy to a project, and
   * nothing bound the EVIDENCE to one either. Pinning the deploy without scoping the
   * check would leave the verifier still willing to bless a cross-project pair.
   *
   * ⇒ Ordered before the id comparison for the same reason CR-031 binds subject
   * before age: when the observations are of different subjects, the measurement
   * between them has no meaning worth computing.
   *
   * ⚖️ An absent `beforeProjectId` leaves the OLD, weaker behaviour rather than
   * failing closed — deliberately, and unlike CR-031. The whole freshness half is
   * already opt-in here (a routine spot-check has no before-id at all), so a missing
   * scope is the caller declining a check they never started, not a caller silently
   * losing one. `verifyVersion.mts` says so out loud when it happens.
   */
  const beforeProject = args.beforeProjectId?.trim();
  if (beforeProject) {
    const servedProject = typeof served.projectId === 'string' ? served.projectId.trim() : '';
    if (servedProject !== beforeProject) {
      return { kind: 'PROJECT_MISMATCH', beforeProjectId: beforeProject, servedProjectId: servedProject };
    }
  }

  const servedId = typeof served.deploymentId === 'string' ? served.deploymentId.trim() : '';
  if (!servedId) return { kind: 'NO_DEPLOYMENT_ID' };
  if (servedId === before) return { kind: 'STALE', deploymentId: servedId };
  return { kind: 'FRESH', from: before, to: servedId };
}

export function readBuildStamp(env: NodeJS.ProcessEnv): BuildStamp | null {
  const token = nonEmpty(env.C3_BUILD_TOKEN);
  if (!token) return null;
  // ⛔ PRESENT-BUT-MALFORMED IS NOT ABSENT. Returning null here would report
  // "unstamped" for a stamp that was set and set wrong — the same conflation
  // `/health` made. It also guards the disclosure: a full sha pasted into this
  // variable would otherwise be served verbatim from a public endpoint.
  if (!BUILD_TOKEN_RE.test(token)) {
    throw new Error(
      `C3_BUILD_TOKEN is set but is not a build token (expected 12 lowercase hex): ${JSON.stringify(token)}. ` +
        'It is produced by apps/api/scripts/stampBuild.mts — never typed by hand.',
    );
  }
  return { buildToken: token };
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
