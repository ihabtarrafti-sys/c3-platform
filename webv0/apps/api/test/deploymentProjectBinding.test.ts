import { describe, expect, it } from 'vitest';
import { tokenForCommit, versionVerdict, type VersionPayload } from '../src/buildIdentity';

const COMMIT = '07d2d64ab1c2d3e4f5061728394a5b6c7d8e9f00';
const EXPECTED = tokenForCommit(COMMIT);
const PRODUCTION_PROJECT = 'project-production';
const STAGING_PROJECT = 'project-staging';

interface DeploymentObservation {
  readonly projectId: string;
  readonly environmentName: string;
  readonly deploymentId: string;
}

function observation(projectId: string, deploymentId: string): DeploymentObservation {
  return {
    projectId,
    // Same editable label deliberately: projectId must do the discrimination.
    environmentName: 'production',
    deploymentId,
  };
}

function served(observed: DeploymentObservation): VersionPayload {
  return { buildToken: EXPECTED, ...observed };
}

function classify(before: DeploymentObservation, after: DeploymentObservation) {
  // Current code structurally accepts and silently ignores beforeProjectId. A
  // correction can consume the field without weakening this red proof.
  const args: Parameters<typeof versionVerdict>[0] & { readonly beforeProjectId: string } = {
    expected: EXPECTED,
    served: served(after),
    beforeDeploymentId: before.deploymentId,
    beforeProjectId: before.projectId,
  };
  return versionVerdict(args);
}

describe('deployment freshness is a transition inside one Railway project', () => {
  it('accepts a moved deployment inside the same project', () => {
    const before = observation(PRODUCTION_PROJECT, 'dep-prod-old');
    const after = observation(PRODUCTION_PROJECT, 'dep-prod-new');
    expect(before.projectId).toBe(after.projectId);
    expect(classify(before, after)).toEqual({ kind: 'FRESH', from: 'dep-prod-old', to: 'dep-prod-new' });
  });

  it('still detects an unmoved deployment inside the same project', () => {
    const before = observation(PRODUCTION_PROJECT, 'dep-prod-current');
    const after = observation(PRODUCTION_PROJECT, 'dep-prod-current');
    expect(before.projectId).toBe(after.projectId);
    expect(classify(before, after)).toEqual({ kind: 'STALE', deploymentId: 'dep-prod-current' });
  });

  it('CR-SWEEP-05: refuses to call IDs from two projects a deployment transition', () => {
    const before = observation(STAGING_PROJECT, 'dep-staging-current');
    const after = observation(PRODUCTION_PROJECT, 'dep-production-current');

    // Independent subject oracle. Both deployment IDs are well-formed and
    // different, so the current comparison's only question is satisfied.
    expect(before.projectId).not.toBe(after.projectId);
    expect(before.deploymentId).not.toBe(after.deploymentId);
    expect(classify(before, after)).toEqual({
      kind: 'PROJECT_MISMATCH',
      beforeProjectId: STAGING_PROJECT,
      servedProjectId: PRODUCTION_PROJECT,
    });
  });
});
