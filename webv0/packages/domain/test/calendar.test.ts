import { describe, expect, it } from 'vitest';
import { buildCalendar, daysBetween, type CalendarInput } from '../src/index';

const TODAY = '2026-07-11';
const plus = (days: number): string => {
  const d = new Date(Date.UTC(2026, 6, 11) + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const empty: CalendarInput = { credentials: [], agreements: [], missions: [], delegations: [], subscriptions: [] };

describe('Track B — ops calendar', () => {
  it('daysBetween is a signed whole-day distance (DST-safe)', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0);
    expect(daysBetween(TODAY, plus(5))).toBe(5);
    expect(daysBetween(TODAY, plus(-3))).toBe(-3);
    // spans a spring-forward boundary without drifting
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('aggregates dated obligations across domains, soonest-first, overdue on top', () => {
    const input: CalendarInput = {
      ...empty,
      credentials: [{ credentialId: 'CRED-1', personId: 'PER-1', credentialType: 'Passport', expiresOn: plus(10), isActive: true, personName: 'Sam' }],
      agreements: [{ agreementId: 'AGR-1', personId: 'PER-1', agreementType: 'Contract', endsOn: plus(-2), status: 'Active' }],
      missions: [{ missionId: 'MSN-1', name: 'EWC', startsOn: plus(3), endsOn: plus(20), isActive: true }],
      delegations: [{ delegationId: 'DLG-1', granteeIdentity: 'ops@x.com', endsOn: plus(40), revokedAt: null }],
      subscriptions: [{ subscriptionId: 'SUB-1', name: 'Adobe', vendorName: 'Adobe Inc', nextRenewalOn: plus(15), status: 'Active' }],
    };
    const items = buildCalendar(input, TODAY, 90);
    expect(items.map((i) => i.id + ':' + i.kind)).toEqual([
      'AGR-1:AgreementEnd', // -2 overdue first
      'MSN-1:MissionStart', // +3
      'CRED-1:CredentialExpiry', // +10
      'SUB-1:SubscriptionRenewal', // +15
      'MSN-1:MissionEnd', // +20
      'DLG-1:DelegationEnd', // +40
    ]);
    expect(items[0].daysUntil).toBe(-2);
    expect(items[0].route).toBe('/agreements/AGR-1');
    expect(items.find((i) => i.kind === 'CredentialExpiry')?.subtitle).toBe('Sam');
  });

  it('excludes inactive / non-live / revoked rows', () => {
    const input: CalendarInput = {
      credentials: [{ credentialId: 'CRED-X', personId: 'PER-1', credentialType: 'Visa', expiresOn: plus(5), isActive: false }],
      agreements: [{ agreementId: 'AGR-X', personId: 'PER-1', agreementType: 'NDA', endsOn: plus(5), status: 'Terminated' }],
      missions: [{ missionId: 'MSN-X', name: 'Old', startsOn: plus(5), endsOn: plus(6), isActive: false }],
      delegations: [{ delegationId: 'DLG-X', granteeIdentity: 'x', endsOn: plus(5), revokedAt: plus(-1) }],
      subscriptions: [{ subscriptionId: 'SUB-X', name: 'Cancelled', vendorName: 'v', nextRenewalOn: plus(5), status: 'Cancelled' }],
    };
    expect(buildCalendar(input, TODAY, 90)).toEqual([]);
  });

  it('respects the horizon ceiling and the one-year overdue floor', () => {
    const input: CalendarInput = {
      ...empty,
      credentials: [
        { credentialId: 'FAR', personId: 'P', credentialType: 'Passport', expiresOn: plus(120), isActive: true },
        { credentialId: 'NEAR', personId: 'P', credentialType: 'Passport', expiresOn: plus(45), isActive: true },
        { credentialId: 'ANCIENT', personId: 'P', credentialType: 'Passport', expiresOn: plus(-400), isActive: true },
      ],
    };
    const ids = buildCalendar(input, TODAY, 90).map((i) => i.id);
    expect(ids).toContain('NEAR'); // within 90
    expect(ids).not.toContain('FAR'); // beyond 90
    expect(ids).not.toContain('ANCIENT'); // > 365 overdue
  });
});
