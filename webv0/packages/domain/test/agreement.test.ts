/**
 * agreement.test.ts — Sprint 41 C1 evidence: the Agreements domain contracts
 * (renamed from Contracts on owner direction — contracts, NDAs, addendums,
 * MOUs share one governed lifecycle; `linkedAgreementId` makes an addendum a
 * first-class relationship). Three governed material operations (the CP's
 * renewal write was a mock), a direct-audited non-material patch,
 * integer-cents money, the derived renewal-window matrix, and the
 * role-differentiated read boundary (agreements hidden from hr/visitor;
 * legal reads without financials).
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS,
  OPERATION_TYPES,
  addAgreementInputSchema,
  agreementRenewalStateOn,
  agreementUpdateInputSchema,
  approvalPayloadSchema,
  capabilitiesFor,
  formatAgreementId,
  isAgreementId,
  renewAgreementInputSchema,
  terminateAgreementInputSchema,
} from '../src/index';

describe('registries (Sprint 41)', () => {
  it('registers the AGR id kind, four audit actions, and the three GOVERNED operations', () => {
    expect(formatAgreementId(12)).toBe('AGR-0012');
    expect(isAgreementId('AGR-0012')).toBe(true);
    expect(isAgreementId('CTR-0012')).toBe(false);
    for (const a of ['AgreementCreated', 'AgreementRenewed', 'AgreementTerminated', 'AgreementUpdated']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
    for (const op of ['AddAgreement', 'RenewAgreement', 'TerminateAgreement']) {
      expect(OPERATION_TYPES).toContain(op);
    }
  });
});

describe('addAgreementInputSchema (governed creation)', () => {
  const valid = { personId: 'PER-0001', agreementType: '  Player Contract ', startsOn: '2026-08-01', endsOn: '2027-07-31' };

  it('parses and normalises; money is integer cents; optionals default null', () => {
    const p = addAgreementInputSchema.parse({ ...valid, valueUsdCents: 250_000_00 });
    expect(p.agreementType).toBe('Player Contract');
    expect(p.valueUsdCents).toBe(25_000_000);
    expect(p.agreementCode).toBeNull();
    expect(p.linkedAgreementId).toBeNull();
    expect(addAgreementInputSchema.parse(valid).valueUsdCents).toBeNull();
  });

  it('an addendum links to its parent agreement by canonical id', () => {
    const p = addAgreementInputSchema.parse({ ...valid, agreementType: 'Addendum', linkedAgreementId: 'AGR-0001' });
    expect(p.linkedAgreementId).toBe('AGR-0001');
    expect(() => addAgreementInputSchema.parse({ ...valid, linkedAgreementId: 'contract-1' })).toThrow(/AGR id/);
  });

  it('refuses fractional or negative cents, end-before-start, junk ids, unknown keys', () => {
    expect(() => addAgreementInputSchema.parse({ ...valid, valueUsdCents: 100.5 })).toThrow();
    expect(() => addAgreementInputSchema.parse({ ...valid, valueUsdCents: -1 })).toThrow();
    expect(() => addAgreementInputSchema.parse({ ...valid, endsOn: '2026-07-31' })).toThrow(/on or after/);
    expect(() => addAgreementInputSchema.parse({ ...valid, personId: 'person-1' })).toThrow(/PER id/);
    expect(() => addAgreementInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });
});

describe('renew / terminate agreements (governed material ops)', () => {
  it('renew carries the target agreement and the new end date', () => {
    const p = renewAgreementInputSchema.parse({ agreementId: 'AGR-0001', newEndsOn: '2028-07-31' });
    expect(p).toEqual({ agreementId: 'AGR-0001', newEndsOn: '2028-07-31' });
    expect(() => renewAgreementInputSchema.parse({ agreementId: 'AGR-0001', newEndsOn: '2028-02-30' })).toThrow();
  });

  it('terminate requires a reason (audited)', () => {
    expect(terminateAgreementInputSchema.parse({ agreementId: 'AGR-0001', reason: ' Breach ' }).reason).toBe('Breach');
    expect(() => terminateAgreementInputSchema.parse({ agreementId: 'AGR-0001', reason: '  ' })).toThrow(/mandatory/);
  });

  it('all three payloads round-trip through the approval union', () => {
    for (const payload of [
      { operationType: 'AddAgreement', input: { personId: 'PER-0001', agreementType: 'NDA', startsOn: '2026-08-01', endsOn: '2027-07-31' } },
      { operationType: 'RenewAgreement', input: { agreementId: 'AGR-0001', newEndsOn: '2028-07-31' } },
      { operationType: 'TerminateAgreement', input: { agreementId: 'AGR-0001', reason: 'Mutual exit' } },
    ]) {
      expect(approvalPayloadSchema.parse(payload).operationType).toBe(payload.operationType);
    }
  });
});

describe('agreementUpdateInputSchema (direct, NON-MATERIAL only)', () => {
  it('accepts code/type/linkage/notes; material terms are not even representable', () => {
    const p = agreementUpdateInputSchema.parse({ expectedVersion: 1, agreementCode: 'GKE-PL-2026-001', linkedAgreementId: 'AGR-0002' });
    expect(p.agreementCode).toBe('GKE-PL-2026-001');
    expect(p.linkedAgreementId).toBe('AGR-0002');
    expect(() => agreementUpdateInputSchema.parse({ expectedVersion: 1 })).toThrow(/at least one field/);
    expect(() => agreementUpdateInputSchema.parse({ expectedVersion: 1, endsOn: '2030-01-01' })).toThrow(); // strict: unknown key
    expect(() => agreementUpdateInputSchema.parse({ expectedVersion: 1, valueUsdCents: 1 })).toThrow();
  });
});

describe('agreementRenewalStateOn (the CP 30/60/90 windows, derived — never stored)', () => {
  const today = '2026-08-01';
  const a = (endsOn: string, status: 'Active' | 'Terminated' = 'Active') => ({ status, endsOn });

  it('walks the full window matrix with exact boundaries', () => {
    expect(agreementRenewalStateOn(a('2026-07-31'), today)).toBe('Expired'); // yesterday
    expect(agreementRenewalStateOn(a('2026-08-01'), today)).toBe('Due30'); // ends today: most urgent, still active
    expect(agreementRenewalStateOn(a('2026-08-31'), today)).toBe('Due30'); // day 30
    expect(agreementRenewalStateOn(a('2026-09-01'), today)).toBe('Due60'); // day 31
    expect(agreementRenewalStateOn(a('2026-09-30'), today)).toBe('Due60'); // day 60
    expect(agreementRenewalStateOn(a('2026-10-01'), today)).toBe('Due90'); // day 61
    expect(agreementRenewalStateOn(a('2026-10-30'), today)).toBe('Due90'); // day 90
    expect(agreementRenewalStateOn(a('2026-10-31'), today)).toBe('Active'); // day 91
  });

  it('Terminated absorbs everything (terminal beats dates)', () => {
    expect(agreementRenewalStateOn(a('2026-07-01', 'Terminated'), today)).toBe('Terminated');
    expect(agreementRenewalStateOn(a('2030-01-01', 'Terminated'), today)).toBe('Terminated');
  });
});

describe('the agreements read boundary (CP Set-E parity)', () => {
  it('hr and visitor are denied entirely; legal reads WITHOUT financials; finance/management read WITH', () => {
    for (const role of ['hr', 'visitor'] as const) {
      expect(capabilitiesFor(role).canReadAgreements).toBe(false);
      expect(capabilitiesFor(role).canViewFinancials).toBe(false);
    }
    expect(capabilitiesFor('legal')).toMatchObject({ canReadAgreements: true, canViewFinancials: false, isReadOnly: true });
    for (const role of ['owner', 'operations', 'finance', 'management'] as const) {
      expect(capabilitiesFor(role).canReadAgreements).toBe(true);
      expect(capabilitiesFor(role).canViewFinancials).toBe(true);
    }
    // The new read capabilities do not grant writes: legal/finance/management stay read-only.
    for (const role of ['legal', 'finance', 'management'] as const) {
      expect(capabilitiesFor(role).isReadOnly).toBe(true);
    }
  });
});
