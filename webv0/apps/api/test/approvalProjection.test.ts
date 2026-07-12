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

describe('projectApprovalPayload — H-03 exhaustive + fail-closed', () => {
  it('FAIL-CLOSED: an unhandled op type never leaks its input — only operationType', () => {
    // A rogue/future op type that reached the boundary without a projection case.
    const rogue = { operationType: 'FutureUnmappedOp', input: { secret: 'leak-me' } } as unknown as Approval['payload'];
    const projected = projectApprovalPayload(rogue, { pii: true, financial: true });
    expect(projected).toEqual({ operationType: 'FutureUnmappedOp' });
    expect(JSON.stringify(projected)).not.toContain('leak-me');
  });

  it('beneficiary bank routing is omitted without financial standing, present with it', () => {
    const ben = {
      operationType: 'AddBeneficiary',
      input: { personId: 'PER-0001', label: 'Main', bankName: 'Emirates NBD', bankCountry: 'AE', currency: 'AED' },
    } as unknown as Approval['payload'];
    const noFin = projectApprovalPayload(ben, { pii: true, financial: false });
    expect(JSON.stringify(noFin)).not.toContain('Emirates NBD');
    expect(JSON.stringify(noFin)).not.toContain('bankCountry');
    expect((noFin as { input: Record<string, unknown> }).input.label).toBe('Main'); // non-routing kept
    const withFin = projectApprovalPayload(ben, { pii: true, financial: true });
    expect((withFin as { input: Record<string, unknown> }).input.bankName).toBe('Emirates NBD');
  });

  it('a non-sensitive op type passes through in full (no over-omission)', () => {
    const dep = { operationType: 'DeactivatePerson', input: { personId: 'PER-0001', reason: 'left the org' } } as unknown as Approval['payload'];
    const projected = projectApprovalPayload(dep, { pii: false, financial: false });
    expect((projected as { input: Record<string, unknown> }).input).toMatchObject({ personId: 'PER-0001', reason: 'left the org' });
  });
});
