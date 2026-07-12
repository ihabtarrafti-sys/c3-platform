/**
 * approvalProjection.test.ts — HARDEN-3 H-02 (approval-view half). The AddPerson
 * approval payload can carry PII (guest-intake promote); projectApprovalPayload
 * must omit it for a reader without PII standing (absence, not masking) and keep
 * it for one with it. The person-view half is covered in intake.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Approval } from '@c3web/domain';
import { projectApprovalPayload } from '../src/dto';

const addPersonPayload = {
  operationType: 'AddPerson',
  input: {
    fullName: 'Priya Vasquez',
    ign: null,
    nationality: null,
    primaryRole: null,
    personnelCode: null,
    currentTeam: null,
    currentGameTitle: null,
    primaryDepartment: null,
    entityId: null,
    notes: 'Self-submitted via guest intake.',
    dateOfBirth: '1998-05-01',
    email: 'priya@x.com',
    phone: '+971500000000',
    addressLine1: '12 Marina Walk',
    addressLine2: null,
    addressCity: 'Dubai',
    addressCountry: 'AE',
  },
} as unknown as Approval['payload'];

const PII = ['dateOfBirth', 'email', 'phone', 'addressLine1', 'addressLine2', 'addressCity', 'addressCountry'];

describe('projectApprovalPayload — AddPerson PII (H-02)', () => {
  it('omits every PII field for a reader without PII standing; keeps operational fields', () => {
    const projected = projectApprovalPayload(addPersonPayload, { pii: false, financial: true });
    const input = (projected as { input: Record<string, unknown> }).input;
    for (const f of PII) expect(input).not.toHaveProperty(f);
    expect(input.fullName).toBe('Priya Vasquez');
    for (const leak of ['priya@x.com', '1998-05-01', '971500000000', 'Marina Walk']) {
      expect(JSON.stringify(projected)).not.toContain(leak);
    }
  });

  it('keeps PII for a reader WITH PII standing', () => {
    const projected = projectApprovalPayload(addPersonPayload, { pii: true, financial: true });
    const input = (projected as { input: Record<string, unknown> }).input;
    expect(input.email).toBe('priya@x.com');
    expect(input.dateOfBirth).toBe('1998-05-01');
  });
});
