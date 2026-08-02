/**
 * buildIdentity.test.ts — instance 32: the deploy witness.
 *
 * ⚖️ `/health` returns a literal and is byte-identical before and after any
 * deploy. It read green against an image four days stale while two ceremonies
 * recorded the deploy as shipped. The requirement is therefore NOT "an endpoint
 * exists" — it is **a value that differs between builds AND can be checked
 * against an expectation.** A value that merely differs is a liveness check
 * wearing a version number.
 */
import { describe, expect, it } from 'vitest';
import { readRuntimeIdentity, tokenForCommit } from '../src/buildIdentity';

const COMMIT_A = '07d2d64ab1c2d3e4f5061728394a5b6c7d8e9f00';
const COMMIT_B = '813e605ab1c2d3e4f5061728394a5b6c7d8e9f00';

describe('the token is VERIFIABLE, not merely varying', () => {
  it('is deterministic — the same commit always yields the same token', () => {
    // This is the whole property: an observer holding the repo computes the
    // expected value offline. A random per-deploy id would differ between
    // builds and prove nothing, because there is nothing to compare it to.
    expect(tokenForCommit(COMMIT_A)).toBe(tokenForCommit(COMMIT_A));
  });

  it('differs between builds', () => {
    expect(tokenForCommit(COMMIT_A)).not.toBe(tokenForCommit(COMMIT_B));
  });

  it('⛔ discloses no revision — the commit is not recoverable from the token', () => {
    // D-001 makes C3 a sellable product; a public endpoint naming the exact
    // source revision is free reconnaissance.
    const token = tokenForCommit(COMMIT_A);
    expect(COMMIT_A).not.toContain(token);
    expect(token).not.toContain(COMMIT_A.slice(0, 8));
    expect(token).toHaveLength(12);
  });

  it('refuses anything that is not a full commit id, rather than hashing it', () => {
    // A short sha, a branch name or a tag would each hash happily and produce a
    // token nobody can reproduce from a commit — verifiable in form only.
    for (const bad of ['07d2d64', 'HEAD', 'main', '', 'not-a-sha', COMMIT_A.toUpperCase()]) {
      expect(() => tokenForCommit(bad), `must refuse ${JSON.stringify(bad)}`).toThrow(/non-commit input/);
    }
  });
});

describe('LAW 17 — truthiness, not presence', () => {
  it('⛔ an EMPTY platform variable is absent, not configured', () => {
    // Measured in the live container: RAILWAY_GIT_REPO_OWNER is SET AND EMPTY.
    // `??` would pass '' straight through as a configured value — the same shape
    // as the VITE_ENV_LABEL fallback that put a STAGING badge on production.
    expect(readRuntimeIdentity({ RAILWAY_PROJECT_ID: '' })).toBeNull();
    expect(readRuntimeIdentity({ RAILWAY_PROJECT_ID: '   ' })).toBeNull();
    expect(readRuntimeIdentity({})).toBeNull();
  });

  it('reads the identity when the platform genuinely provides one', () => {
    const identity = readRuntimeIdentity({
      RAILWAY_PROJECT_ID: 'e6eb2f39-5e5b-413a-a594-72a681c34c86',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_DEPLOYMENT_ID: 'dep-123',
    });
    expect(identity).toEqual({
      projectId: 'e6eb2f39-5e5b-413a-a594-72a681c34c86',
      environmentName: 'production',
      deploymentId: 'dep-123',
    });
  });

  it('an empty environment NAME does not become a false label', () => {
    const identity = readRuntimeIdentity({ RAILWAY_PROJECT_ID: 'p-1', RAILWAY_ENVIRONMENT_NAME: '' });
    // null reads as "unnamed"; '' would render as a blank badge that looks configured.
    expect(identity?.environmentName).toBeNull();
  });

  it('⚖️ the identity is discriminated on the ID, which a dashboard cannot edit', () => {
    // Names are editable in a dashboard; IDs are not. The name is for humans.
    const renamed = readRuntimeIdentity({ RAILWAY_PROJECT_ID: 'p-1', RAILWAY_ENVIRONMENT_NAME: 'staging' });
    expect(renamed?.projectId).toBe('p-1');
  });
});
