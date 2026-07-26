import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertH1SeedWorkflowEventSequence,
  runH1SeedWorkflow,
} from '../../src/cli/h1SeedWorkflow.js';
import type { H1DatabaseSideEffectLedger } from '../../src/h1/databaseSeeder.js';
import type { H1ExternalTargetProbeLedger } from '../../src/h1/externalTargetProbe.js';

function exactProbeLedger(): H1ExternalTargetProbeLedger {
  return {
    attemptedEvents: (
      [
        'database-probe-connect',
        'database-probe-identity',
        'database-probe-transaction',
        'database-probe-lock',
        'database-probe-read',
        'database-probe-handoff',
      ] as const
    ).map((capability, index) => ({
      sequence: index + 1,
      capability,
    })),
  };
}

function exactDatabaseLedger(): H1DatabaseSideEffectLedger {
  return {
    attemptedEvents: (
      [
        'database-retained-transaction-consume',
        'database-commit',
      ] as const
    ).map((capability, index) => ({
      sequence: index + 1,
      capability,
    })),
  };
}

describe('H1 seed workflow claim boundary', () => {
  it('exposes no dependency-injection parameter on the production PASS surface', () => {
    expect(runH1SeedWorkflow).toHaveLength(2);
    const source = readFileSync(
      fileURLToPath(
        new URL(
          '../../src/cli/h1SeedWorkflow.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(source).not.toContain(
      'export interface H1SeedWorkflowDependencies',
    );
    expect(source).toContain(
      'prepareSourcePlan: prepareH1SourcePlan',
    );
    expect(source).toContain(
      'connect: connectExternalPostgres',
    );
    expect(source).toContain(
      'probeTarget: probeExternalOwnedDisposableTarget',
    );
    expect(source).toContain('seedDatabase: seedH1Database');
  });

  it('accepts the exact real probe and database capability sequence', () => {
    expect(() =>
      assertH1SeedWorkflowEventSequence(
        exactProbeLedger(),
        exactDatabaseLedger(),
      ),
    ).not.toThrow();
  });

  it('RED: an omitted or reordered capability cannot manufacture a PASS', () => {
    const omitted = exactProbeLedger();
    omitted.attemptedEvents.splice(1, 1);
    expect(() =>
      assertH1SeedWorkflowEventSequence(
        omitted,
        exactDatabaseLedger(),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'H1_SEED_WORKFLOW_ATTESTATION_INVALID',
      }),
    );

    const reordered = exactDatabaseLedger();
    reordered.attemptedEvents.reverse();
    expect(() =>
      assertH1SeedWorkflowEventSequence(
        exactProbeLedger(),
        reordered,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'H1_SEED_WORKFLOW_ATTESTATION_INVALID',
      }),
    );
  });
});
