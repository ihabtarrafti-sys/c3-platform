import { describe, expect, it } from 'vitest';
import { computeDepartureReadiness, formatDepartureId, initiateDepartureInputSchema, completeDepartureInputSchema, type DepartureReadinessInput } from '../src/index';

const base: DepartureReadinessInput = { agreements: [], participants: [], credentials: [], kit: [], apparel: [] };

describe('Track B — departure domain', () => {
  it('formats the id + validates inputs', () => {
    expect(formatDepartureId(4)).toBe('DEP-0004');
    expect(initiateDepartureInputSchema.safeParse({ personId: 'PER-0001', reason: 'End of contract' }).success).toBe(true);
    expect(initiateDepartureInputSchema.safeParse({ personId: 'nope', reason: 'x' }).success).toBe(false);
    expect(initiateDepartureInputSchema.safeParse({ personId: 'PER-0001', reason: '' }).success).toBe(false);
    expect(completeDepartureInputSchema.safeParse({ expectedVersion: 0 }).success).toBe(true);
    expect(completeDepartureInputSchema.parse({ expectedVersion: 0 }).deactivatePerson).toBe(false);
    expect(completeDepartureInputSchema.safeParse({ expectedVersion: 0, deactivatePerson: true }).success).toBe(true);
  });

  it('readiness gathers only THIS person\'s active items across domains', () => {
    const input: DepartureReadinessInput = {
      agreements: [
        { agreementId: 'AGR-1', personId: 'PER-1', agreementType: 'Contract', endsOn: '2027-01-01', status: 'Active' },
        { agreementId: 'AGR-2', personId: 'PER-1', agreementType: 'NDA', endsOn: '2026-01-01', status: 'Terminated' }, // not active
        { agreementId: 'AGR-3', personId: 'PER-2', agreementType: 'Contract', endsOn: '2027-01-01', status: 'Active' }, // other person
      ],
      participants: [
        { missionId: 'MSN-1', personId: 'PER-1', role: 'Player', isActive: true },
        { missionId: 'MSN-2', personId: 'PER-1', role: 'Coach', isActive: false }, // inactive
      ],
      credentials: [{ credentialId: 'CRED-1', personId: 'PER-1', credentialType: 'Passport', isActive: true }],
      kit: [{ kitId: 'KIT-7', name: 'Laptop', assignedPersonId: 'PER-1', isActive: true }],
      apparel: [{ apparelId: 'APP-1', name: 'Jersey', assignedPersonId: 'PER-2', isActive: true }], // other person
    };
    const items = computeDepartureReadiness('PER-1', input);
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['Agreement:AGR-1', 'Roster:MSN-1', 'Credential:CRED-1', 'Kit:KIT-7']);
    expect(items.find((i) => i.kind === 'Agreement')?.route).toBe('/agreements/AGR-1');
    expect(items.find((i) => i.kind === 'Kit')?.route).toBe('/kit');
  });

  it('a fully-offboarded person has an empty checklist', () => {
    expect(computeDepartureReadiness('PER-9', base)).toEqual([]);
  });
});
