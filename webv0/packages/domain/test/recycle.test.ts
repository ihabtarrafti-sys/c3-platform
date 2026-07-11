import { describe, expect, it } from 'vitest';
import { RECYCLE_KINDS, RESTORE_CLASS_OF, isRestorableFromBin, restoreRecycleInputSchema } from '../src/index';

describe('Track B2 — recycle bin domain shapes', () => {
  it('every recycle kind has a restore class, and only person/entity/team restore from the bin', () => {
    for (const k of RECYCLE_KINDS) expect(RESTORE_CLASS_OF[k], `${k} needs a restore class`).toBeTruthy();
    expect(RECYCLE_KINDS.filter(isRestorableFromBin).sort()).toEqual(['entity', 'person', 'team']);
    expect(RESTORE_CLASS_OF.person).toBe('governed');
    expect(RESTORE_CLASS_OF.entity).toBe('direct');
    expect(RESTORE_CLASS_OF.team).toBe('direct');
    expect(RESTORE_CLASS_OF.credential).toBe('recordPage');
  });

  it('the restore input demands a known kind + id + version', () => {
    expect(restoreRecycleInputSchema.safeParse({ kind: 'entity', id: 'ENT-0001', expectedVersion: 1 }).success).toBe(true);
    expect(restoreRecycleInputSchema.safeParse({ kind: 'person', id: 'PER-0001', expectedVersion: 0, reason: 'rehired' }).success).toBe(true);
    expect(restoreRecycleInputSchema.safeParse({ kind: 'nope', id: 'X', expectedVersion: 0 }).success).toBe(false);
    expect(restoreRecycleInputSchema.safeParse({ kind: 'team', id: 'TEAM-0001' }).success).toBe(false); // no version
  });
});
