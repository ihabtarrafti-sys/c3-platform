/**
 * credential.test.ts — Sprint 36 C1 evidence: the Credentials domain contracts.
 * Date safety is the heart of this file (the CP date-swap lesson): plain ISO
 * calendar dates, impossible dates rejected, expiry strictly after issue, and
 * a pure read-side derived status with no timezone math anywhere.
 */
import { describe, it, expect } from 'vitest';
import {
  OPERATION_TYPES,
  AUDIT_ACTIONS,
  addCredentialInputSchema,
  deactivateCredentialInputSchema,
  parseApprovalPayload,
  formatCredentialId,
  isCredentialId,
  credentialStatusOn,
} from '../src/index';

describe('operation + id registries (Sprint 36)', () => {
  it('registers the credential operations and the CRED id kind', () => {
    expect(OPERATION_TYPES).toContain('AddCredential');
    expect(OPERATION_TYPES).toContain('DeactivateCredential');
    expect(formatCredentialId(7)).toBe('CRED-0007');
    expect(isCredentialId('CRED-0007')).toBe(true);
    expect(isCredentialId('CRD-0007')).toBe(false);
    expect(AUDIT_ACTIONS).toContain('CredentialCreated');
    expect(AUDIT_ACTIONS).toContain('CredentialDeactivated');
  });
});

describe('addCredentialInputSchema — date-safe by construction', () => {
  const valid = {
    personId: 'PER-0001',
    credentialType: '  Coaching License A ',
    issuer: 'National Federation',
    issuedOn: '2026-01-02',
    expiresOn: '2031-12-30',
  };

  it('parses and normalises; dates stay literal ISO strings (no TZ math)', () => {
    const p = addCredentialInputSchema.parse(valid);
    expect(p.credentialType).toBe('Coaching License A');
    expect(p.issuedOn).toBe('2026-01-02'); // byte-for-byte — the CP swap class is unrepresentable
    expect(p.expiresOn).toBe('2031-12-30');
    expect(p.notes).toBeNull();
  });

  it('accepts a non-expiring credential (expiresOn absent → null)', () => {
    const { expiresOn: _e, ...rest } = valid;
    expect(addCredentialInputSchema.parse(rest).expiresOn).toBeNull();
  });

  it('rejects impossible calendar dates and wrong shapes', () => {
    expect(() => addCredentialInputSchema.parse({ ...valid, issuedOn: '2026-02-30' })).toThrow(/real calendar/i);
    expect(() => addCredentialInputSchema.parse({ ...valid, issuedOn: '02/01/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => addCredentialInputSchema.parse({ ...valid, expiresOn: '2026-13-01' })).toThrow();
  });

  it('rejects expiry on or before issue', () => {
    expect(() => addCredentialInputSchema.parse({ ...valid, expiresOn: valid.issuedOn })).toThrow(/after the issue/i);
    expect(() => addCredentialInputSchema.parse({ ...valid, expiresOn: '2025-12-31' })).toThrow(/after the issue/i);
  });

  it('rejects a non-canonical person id and unknown keys', () => {
    expect(() => addCredentialInputSchema.parse({ ...valid, personId: 'person-1' })).toThrow(/PER id/);
    expect(() => addCredentialInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });
});

describe('payload union', () => {
  it('discriminates both credential operations; AddPerson regression intact', () => {
    const add = parseApprovalPayload({
      operationType: 'AddCredential',
      input: { personId: 'PER-0001', credentialType: 'License', issuedOn: '2026-01-02' },
    });
    expect(add.operationType).toBe('AddCredential');
    const deact = parseApprovalPayload({
      operationType: 'DeactivateCredential',
      input: { credentialId: 'CRED-0001', personId: 'PER-0001' },
    });
    expect(deact.operationType).toBe('DeactivateCredential');
    expect(() => parseApprovalPayload({ operationType: 'AddCredential', input: { fullName: 'x' } })).toThrow();
    expect(parseApprovalPayload({ operationType: 'AddPerson', input: { fullName: 'Still Works' } }).operationType).toBe('AddPerson');
    expect(() => deactivateCredentialInputSchema.parse({ credentialId: 'nope', personId: 'PER-0001' })).toThrow();
  });
});

describe('credentialStatusOn — pure read-side derivation', () => {
  const active = { isActive: true, expiresOn: '2026-08-01' };
  it('derives the four statuses from plain date comparison', () => {
    expect(credentialStatusOn({ isActive: false, expiresOn: null }, '2026-07-07')).toBe('Inactive');
    expect(credentialStatusOn({ isActive: true, expiresOn: null }, '2026-07-07')).toBe('Active');
    expect(credentialStatusOn(active, '2026-09-01')).toBe('Expired');
    expect(credentialStatusOn(active, '2026-07-07')).toBe('ExpiresSoon'); // 25 days out
    expect(credentialStatusOn(active, '2026-06-01')).toBe('Active'); // 61 days out
  });
  it('boundary: expiring exactly today is not Expired; exactly at the horizon is soon', () => {
    expect(credentialStatusOn(active, '2026-08-01')).toBe('ExpiresSoon'); // today = expiry
    expect(credentialStatusOn(active, '2026-07-02')).toBe('ExpiresSoon'); // horizon day 30
  });
});
