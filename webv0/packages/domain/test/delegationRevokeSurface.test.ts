/**
 * delegationRevokeSurface.test.ts — the Revoke control's predicate IS the
 * blocking predicate (owner-found staging dead end, 2026-08-06).
 *
 * ⛔ THE DEFECT: three floors, two predicates. The DB partial-unique and the
 * grant guard block on UNREVOKED; the Settings surface offered Revoke on a
 * hand-list (`Active || Scheduled`). An Expired delegation is unrevoked-but-
 * not-listed: it blocked every new grant for its grantee while the only
 * clearing control was unrendered. No path out through the product.
 *
 * ⚖️ THE GENERAL FORM, per the dispatch: not "Expired offers Revoke" (a
 * `|| 'Expired'` patch passes that) but "the control is offered for EVERY state
 * the blocking guard would refuse on" — each state built from a real fixture,
 * the expected answer derived from `revokedAt` (the fact the DB index keys on),
 * never from a second hand-list in the test.
 */
import { describe, expect, it } from 'vitest';
import { delegationState, isDelegationUnrevoked, type DelegationState } from '../src/delegation';

const TODAY = '2026-08-06';

/** One fixture per reachable state, built from the FACTS that derive it. */
const FIXTURES: Array<{ startsOn: string; endsOn: string; revokedAt: string | null }> = [
  { startsOn: '2026-09-01', endsOn: '2026-09-30', revokedAt: null }, // Scheduled
  { startsOn: '2026-08-01', endsOn: '2026-08-31', revokedAt: null }, // Active
  { startsOn: '2026-07-01', endsOn: '2026-07-31', revokedAt: null }, // Expired — the dead-end state
  { startsOn: '2026-08-01', endsOn: '2026-08-31', revokedAt: '2026-08-03T00:00:00Z' }, // Revoked
];

describe('⛔ Revoke is offered exactly where a new grant is blocked', () => {
  it('covers the whole state vocabulary — no state is unreachable by fixture', () => {
    // Guards the enumerator: if a fifth state is added, this fails until a
    // fixture reaches it, so the equivalence below can never quietly narrow.
    const reached = new Set(FIXTURES.map((f) => delegationState(f, TODAY)));
    const vocabulary: DelegationState[] = ['Scheduled', 'Active', 'Expired', 'Revoked'];
    expect([...reached].sort()).toEqual([...vocabulary].sort());
  });

  it('⛔ for EVERY state: control offered ⟺ the blocking guard would refuse on it', () => {
    // The blocking fact is `revokedAt IS NULL` — what the partial-unique and
    // findUnrevokedDelegationId key on. The expected answer comes from THAT
    // fact, so no hand-list of names can satisfy this test by growing.
    for (const f of FIXTURES) {
      const state = delegationState(f, TODAY);
      const blocksNewGrant = f.revokedAt === null;
      expect(
        isDelegationUnrevoked(state),
        `state=${state}: the surface must offer Revoke iff this delegation blocks a new grant`,
      ).toBe(blocksNewGrant);
    }
  });

  it('⛳ the dead-end state by name, as documentation: Expired is unrevoked', () => {
    expect(isDelegationUnrevoked('Expired')).toBe(true);
    expect(isDelegationUnrevoked('Revoked')).toBe(false);
  });
});
