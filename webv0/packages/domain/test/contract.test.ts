/**
 * contract.test.ts — Sprint 41 C1 evidence: the Contracts domain contracts.
 * The first domain that goes BEYOND the CP: three governed material
 * operations (the CP's renewal write was a mock), a direct-audited
 * non-material patch, integer-cents money, the derived renewal-window
 * matrix, and the role-differentiated read boundary (contracts hidden from
 * hr/visitor; legal reads without financials).
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS,
  OPERATION_TYPES,
  addContractInputSchema,
  approvalPayloadSchema,
  capabilitiesFor,
  contractRenewalStateOn,
  contractUpdateInputSchema,
  formatContractId,
  isContractId,
  renewContractInputSchema,
  terminateContractInputSchema,
} from '../src/index';

describe('registries (Sprint 41)', () => {
  it('registers the CTR id kind, four audit actions, and the three GOVERNED operations', () => {
    expect(formatContractId(12)).toBe('CTR-0012');
    expect(isContractId('CTR-0012')).toBe(true);
    expect(isContractId('CON-0012')).toBe(false);
    for (const a of ['ContractCreated', 'ContractRenewed', 'ContractTerminated', 'ContractUpdated']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
    for (const op of ['AddContract', 'RenewContract', 'TerminateContract']) {
      expect(OPERATION_TYPES).toContain(op);
    }
  });
});

describe('addContractInputSchema (governed creation)', () => {
  const valid = { personId: 'PER-0001', contractType: '  Player ', startsOn: '2026-08-01', endsOn: '2027-07-31' };

  it('parses and normalises; money is integer cents; optionals default null', () => {
    const p = addContractInputSchema.parse({ ...valid, valueUsdCents: 250_000_00 });
    expect(p.contractType).toBe('Player');
    expect(p.valueUsdCents).toBe(25_000_000);
    expect(p.contractCode).toBeNull();
    expect(addContractInputSchema.parse(valid).valueUsdCents).toBeNull();
  });

  it('refuses fractional or negative cents, end-before-start, junk ids, unknown keys', () => {
    expect(() => addContractInputSchema.parse({ ...valid, valueUsdCents: 100.5 })).toThrow();
    expect(() => addContractInputSchema.parse({ ...valid, valueUsdCents: -1 })).toThrow();
    expect(() => addContractInputSchema.parse({ ...valid, endsOn: '2026-07-31' })).toThrow(/on or after/);
    expect(() => addContractInputSchema.parse({ ...valid, personId: 'person-1' })).toThrow(/PER id/);
    expect(() => addContractInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });
});

describe('renew / terminate contracts (governed material ops)', () => {
  it('renew carries the target contract and the new end date', () => {
    const p = renewContractInputSchema.parse({ contractId: 'CTR-0001', newEndsOn: '2028-07-31' });
    expect(p).toEqual({ contractId: 'CTR-0001', newEndsOn: '2028-07-31' });
    expect(() => renewContractInputSchema.parse({ contractId: 'CTR-0001', newEndsOn: '2028-02-30' })).toThrow();
  });

  it('terminate requires a reason (audited)', () => {
    expect(terminateContractInputSchema.parse({ contractId: 'CTR-0001', reason: ' Breach ' }).reason).toBe('Breach');
    expect(() => terminateContractInputSchema.parse({ contractId: 'CTR-0001', reason: '  ' })).toThrow(/mandatory/);
  });

  it('all three payloads round-trip through the approval union', () => {
    for (const payload of [
      { operationType: 'AddContract', input: { personId: 'PER-0001', contractType: 'Player', startsOn: '2026-08-01', endsOn: '2027-07-31' } },
      { operationType: 'RenewContract', input: { contractId: 'CTR-0001', newEndsOn: '2028-07-31' } },
      { operationType: 'TerminateContract', input: { contractId: 'CTR-0001', reason: 'Mutual exit' } },
    ]) {
      expect(approvalPayloadSchema.parse(payload).operationType).toBe(payload.operationType);
    }
  });
});

describe('contractUpdateInputSchema (direct, NON-MATERIAL only)', () => {
  it('accepts code/type/notes; material terms are not even representable', () => {
    const p = contractUpdateInputSchema.parse({ expectedVersion: 1, contractCode: 'GKE-PL-2026-001', notes: 'Countersigned' });
    expect(p.contractCode).toBe('GKE-PL-2026-001');
    expect(() => contractUpdateInputSchema.parse({ expectedVersion: 1 })).toThrow(/at least one field/);
    expect(() => contractUpdateInputSchema.parse({ expectedVersion: 1, endsOn: '2030-01-01' })).toThrow(); // strict: unknown key
    expect(() => contractUpdateInputSchema.parse({ expectedVersion: 1, valueUsdCents: 1 })).toThrow();
  });
});

describe('contractRenewalStateOn (the CP 30/60/90 windows, derived — never stored)', () => {
  const today = '2026-08-01';
  const c = (endsOn: string, status: 'Active' | 'Terminated' = 'Active') => ({ status, endsOn });

  it('walks the full window matrix with exact boundaries', () => {
    expect(contractRenewalStateOn(c('2026-07-31'), today)).toBe('Expired'); // yesterday
    expect(contractRenewalStateOn(c('2026-08-01'), today)).toBe('Due30'); // ends today: most urgent, still active
    expect(contractRenewalStateOn(c('2026-08-31'), today)).toBe('Due30'); // day 30
    expect(contractRenewalStateOn(c('2026-09-01'), today)).toBe('Due60'); // day 31
    expect(contractRenewalStateOn(c('2026-09-30'), today)).toBe('Due60'); // day 60
    expect(contractRenewalStateOn(c('2026-10-01'), today)).toBe('Due90'); // day 61
    expect(contractRenewalStateOn(c('2026-10-30'), today)).toBe('Due90'); // day 90
    expect(contractRenewalStateOn(c('2026-10-31'), today)).toBe('Active'); // day 91
  });

  it('Terminated absorbs everything (terminal beats dates)', () => {
    expect(contractRenewalStateOn(c('2026-07-01', 'Terminated'), today)).toBe('Terminated');
    expect(contractRenewalStateOn(c('2030-01-01', 'Terminated'), today)).toBe('Terminated');
  });
});

describe('the contracts read boundary (CP Set-E parity)', () => {
  it('hr and visitor are denied entirely; legal reads WITHOUT financials; finance/management read WITH', () => {
    for (const role of ['hr', 'visitor'] as const) {
      expect(capabilitiesFor(role).canReadContracts).toBe(false);
      expect(capabilitiesFor(role).canViewFinancials).toBe(false);
    }
    expect(capabilitiesFor('legal')).toMatchObject({ canReadContracts: true, canViewFinancials: false, isReadOnly: true });
    for (const role of ['owner', 'operations', 'finance', 'management'] as const) {
      expect(capabilitiesFor(role).canReadContracts).toBe(true);
      expect(capabilitiesFor(role).canViewFinancials).toBe(true);
    }
    // The new read capabilities do not grant writes: finance/management/legal stay read-only.
    for (const role of ['legal', 'finance', 'management'] as const) {
      expect(capabilitiesFor(role).isReadOnly).toBe(true);
    }
  });
});
