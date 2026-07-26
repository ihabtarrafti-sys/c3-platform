import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  H1ActorMatrixPlanError,
  planH1ActorMatrix,
  type H1ActorMatrixPlan,
} from '../../src/h1/actorMatrixPlan.js';
import { canonicalSha256 } from '../../src/canonical.js';

async function readAuthorityJson(fileName: string): Promise<Record<string, any>> {
  const bytes = await readFile(
    new URL(`../../authority/r6/${fileName}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(bytes) as Record<string, any>;
}

describe('H1 actor-matrix and assignment planning', () => {
  let actorClasses: Record<string, any>;
  let delegation: Record<string, any>;
  let plan: H1ActorMatrixPlan;

  beforeAll(async () => {
    [actorClasses, delegation] = await Promise.all([
      readAuthorityJson('HEARTH-003-ACTOR-CLASSES-v2.json'),
      readAuthorityJson('HEARTH-003-DELEGATION-MEASUREMENT-v2.json'),
    ]);
    plan = planH1ActorMatrix(actorClasses, delegation);
  }, 60_000);

  it('validates the complete sparse 140-profile authority matrix', () => {
    expect(plan.measurementStatus).toBe('NOT_YET_MEASURED');
    expect(plan.actorProfiles).toHaveLength(140);
    expect(
      plan.actorProfiles.filter(
        (profile) =>
          profile.delegationState === 'D0' &&
          profile.participantState === 'P0',
      ),
    ).toHaveLength(70);
    expect(
      plan.actorProfiles.filter(
        (profile) => profile.delegationState !== 'D0',
      ),
    ).toHaveLength(56);
    expect(
      plan.actorProfiles.filter(
        (profile) => profile.participantState === 'P1',
      ),
    ).toHaveLength(14);
  });

  it('proves every declared assignment expands without representative sampling', () => {
    expect(plan.nonDelegationAssignments).toHaveLength(699);
    expect(
      plan.nonDelegationAssignments.reduce(
        (sum, assignment) => sum + assignment.observationIds.length,
        0,
      ),
    ).toBe(37_030);
    expect(plan.delegationAssignments).toHaveLength(29);
    expect(
      plan.delegationAssignments.reduce(
        (sum, assignment) => sum + assignment.bindingIds.length,
        0,
      ),
    ).toBe(370);
    expect(plan.manifestInputs).toMatchObject({
      measurementStatus: 'NOT_YET_MEASURED',
      baselineUse: 'drift-detector-against-dae27a4',
      pairEdgeCount: 280,
      noEffectControlCount: 20,
    });
    expect(canonicalSha256(plan.manifestInputs)).toBe(plan.manifestSha256);
  });

  it('RED: rejects an assignment that silently omits a matching profile', () => {
    const assignments = delegation[
      'nonDelegationLogicalAssignments'
    ] as Array<Record<string, any>>;
    const observationIds = assignments[0]?.['observationIds'] as string[];
    const removed = observationIds.pop();
    assignments[0]!['expectedExpansionCount'] =
      (assignments[0]!['expectedExpansionCount'] as number) - 1;
    try {
      expect(() => planH1ActorMatrix(actorClasses, delegation)).toThrow(
        H1ActorMatrixPlanError,
      );
    } finally {
      observationIds.push(removed!);
      assignments[0]!['expectedExpansionCount'] =
        (assignments[0]!['expectedExpansionCount'] as number) + 1;
    }
  });

  it('RED: rejects an actor profile outside the declared sparse product', () => {
    const profiles = delegation['actorProfileCatalog'] as Array<
      Record<string, any>
    >;
    const priorId = profiles[0]?.['actorProfileId'];
    profiles[0]!['actorProfileId'] = 'T01.owner.E1.D1.base';
    try {
      expect(() => planH1ActorMatrix(actorClasses, delegation)).toThrow(
        /actorProfileCatalog ids/u,
      );
    } finally {
      profiles[0]!['actorProfileId'] = priorId;
    }
  });
});
