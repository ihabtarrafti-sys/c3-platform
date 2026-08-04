/**
 * contractRequiredness.test.ts — `required → optional` is BREAKING (`CR-023`).
 *
 * ⚖️ The v1 law says served fields are never removed or retyped. Requiredness is
 * part of the type as the CLIENT experiences it: code written against "this
 * field is always present" breaks the day the server first omits it. The
 * classifier compared key existence and inner shape but never the `optional`
 * flag — so the one incompatible change that LOOKS like a relaxation classified
 * as additive growth.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildContract, diffContracts, type CollectedRoute } from '../src/contractShape';

function contractWith(schema: z.ZodTypeAny) {
  const route: CollectedRoute = {
    method: 'GET',
    url: '/api/v1/probe',
    schema: { response: { 200: schema } },
  };
  return buildContract([route]);
}

describe('⛔ CR-023 — requiredness is part of the served contract', () => {
  it('required → optional is BREAKING, not additive', () => {
    const committed = contractWith(z.object({ value: z.string() }));
    const generated = contractWith(z.object({ value: z.string().optional() }));

    const diff = diffContracts(committed, generated);
    expect(diff.breaking.length, 'a client relying on presence is broken by absence').toBeGreaterThan(0);
    expect(diff.additive, 'and it must not ALSO read as harmless growth').toEqual([]);
  });

  it('optional → required stays legal — presence does not break an absence-tolerant client', () => {
    const committed = contractWith(z.object({ value: z.string().optional() }));
    const generated = contractWith(z.object({ value: z.string() }));

    const diff = diffContracts(committed, generated);
    expect(diff.breaking).toEqual([]);
  });

  it('⚖️ and the flag is compared at DEPTH, not only at the top level', () => {
    // The nested version is the same defect one level down — the recursion
    // carries the check, but only a test makes that a fact rather than a reading.
    const committed = contractWith(z.object({ outer: z.object({ inner: z.string() }) }));
    const generated = contractWith(z.object({ outer: z.object({ inner: z.string().optional() }) }));

    expect(diffContracts(committed, generated).breaking.length).toBeGreaterThan(0);
  });

  it('an unchanged contract still classifies as clean', () => {
    // The guard must not turn every regeneration into a fight.
    const committed = contractWith(z.object({ value: z.string(), extra: z.number().optional() }));
    const diff = diffContracts(committed, contractWith(z.object({ value: z.string(), extra: z.number().optional() })));
    expect(diff.breaking).toEqual([]);
    expect(diff.additive).toEqual([]);
  });
});
