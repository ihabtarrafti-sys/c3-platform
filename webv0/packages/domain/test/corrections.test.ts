import { describe, expect, it } from 'vitest';
import {
  CORRECTIONS_EXCLUDED_OPS,
  EDIT_TARGET_KEYS,
  OPERATION_TYPES,
  REVISABLE_STATUSES,
  SIGNAL_KINDS,
  SITUATION_CHECKS,
  SITUATION_CHECK_KINDS,
  changedInputFields,
  composeSituation,
  editApprovalInputSchema,
} from '../src/index';

describe('Track B1 — the corrections registries are COMPLETE (no op falls through)', () => {
  it('every operation type is either edit-targetable or explicitly excluded', () => {
    for (const op of OPERATION_TYPES) {
      const excluded = (CORRECTIONS_EXCLUDED_OPS as readonly string[]).includes(op);
      const mapped = op in EDIT_TARGET_KEYS;
      expect(excluded !== mapped, `${op} must be in exactly one registry`).toBe(true);
    }
  });

  it('the revise window is exactly {Submitted, InReview, Rejected, Withdrawn}', () => {
    expect([...REVISABLE_STATUSES].sort()).toEqual(['InReview', 'Rejected', 'Submitted', 'Withdrawn']);
  });

  it('changedInputFields names exactly the differing keys, sorted, values compared deeply', () => {
    expect(changedInputFields({ a: 1, b: 'x', c: [1, 2] }, { a: 1, b: 'y', c: [1, 2], d: true })).toEqual(['b', 'd']);
    expect(changedInputFields({ p: { q: 1 } }, { p: { q: 2 } })).toEqual(['p']);
    expect(changedInputFields({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('edit input schema demands an APR id and a version', () => {
    expect(editApprovalInputSchema.safeParse({ approvalId: 'APR-0001', expectedVersion: 0, input: {} }).success).toBe(true);
    expect(editApprovalInputSchema.safeParse({ approvalId: 'PER-0001', expectedVersion: 0, input: {} }).success).toBe(false);
  });
});

describe('Track B1 — the RejectedAwaitingRevision signal (signals-ship-with-features law)', () => {
  it('the check ledger stays index-aligned and carries the 14th line', () => {
    expect(SITUATION_CHECKS.length).toBe(SITUATION_CHECK_KINDS.length);
    // RejectedAwaitingRevision rides the ledger, index-aligned (no longer the
    // last line — later features append their own checks after it).
    expect(SITUATION_CHECK_KINDS).toContain('RejectedAwaitingRevision');
    expect(SIGNAL_KINDS).toContain('RejectedAwaitingRevision');
  });

  it('fires for a fresh unsuperseded rejection; silenced by supersession or 14 quiet days', () => {
    const base = {
      todayIso: '2026-07-11',
      ownerIdentities: ['owner@alpha.com'],
      people: [],
      credentials: [],
      agreements: [],
      missions: [],
      missionLines: [],
      invoices: [],
      teams: [],
      teamMemberships: [],
      distributions: [],
      claims: [],
      delegations: [],
      participants: [],
      journeys: [],
    };
    const rejected = (over: Partial<{ reviewedAt: string | null; supersededBy: string | null }>) => ({
      approvalId: 'APR-0001',
      operationType: 'AddPerson' as const,
      status: 'Rejected' as const,
      submittedBy: 'ops@alpha.com',
      submittedAt: '2026-07-01T00:00:00.000Z',
      targetId: null,
      targetPersonId: 'PENDING-ADDPERSON',
      reviewedAt: '2026-07-10T12:00:00.000Z',
      supersededBy: null,
      ...over,
    });

    const firing = composeSituation({ ...base, approvals: [rejected({})] } as never);
    expect(firing.some((s) => s.kind === 'RejectedAwaitingRevision' && s.key.includes('APR-0001'))).toBe(true);

    const superseded = composeSituation({ ...base, approvals: [rejected({ supersededBy: 'APR-0002' })] } as never);
    expect(superseded.some((s) => s.kind === 'RejectedAwaitingRevision')).toBe(false);

    const stale = composeSituation({ ...base, approvals: [rejected({ reviewedAt: '2026-06-01T00:00:00.000Z' })] } as never);
    expect(stale.some((s) => s.kind === 'RejectedAwaitingRevision')).toBe(false);
  });
});
