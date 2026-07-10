/**
 * dataQuality.test.ts — S5 riders: duplicate detection is exact-after-
 * normalization (facts, not guesses), missing-basics checks nag only about
 * ACTIVE records, and "past" is strictly before today.
 */
import { describe, expect, it } from 'vitest';
import { buildDataQualityReport, type DqAgreementRow, type DqCredentialRow, type DqPersonRow } from '../src/index';

const TODAY = '2026-07-10';

const person = (over: Partial<DqPersonRow> & { personId: string; fullName: string }): DqPersonRow => ({
  ign: null,
  nationality: 'PH',
  primaryRole: 'Player',
  personnelCode: null,
  isActive: true,
  ...over,
});

const credential = (over: Partial<DqCredentialRow> & { credentialId: string }): DqCredentialRow => ({
  personId: 'PER-0001',
  credentialType: 'Visa',
  expiresOn: '2030-01-01',
  isActive: true,
  ...over,
});

const agreement = (over: Partial<DqAgreementRow> & { agreementId: string }): DqAgreementRow => ({
  agreementType: 'Player Contract',
  agreementCode: 'GKE-1',
  personId: 'PER-0001',
  entityId: null,
  endsOn: '2030-01-01',
  status: 'Active',
  ...over,
});

describe('buildDataQualityReport', () => {
  it('clean data yields the honest all-clear: every list empty', () => {
    const report = buildDataQualityReport(
      {
        people: [person({ personId: 'PER-0001', fullName: 'Jordan Reyes', personnelCode: 'R6/PL/007' })],
        credentials: [credential({ credentialId: 'CRED-0001' })],
        agreements: [agreement({ agreementId: 'AGR-0001' })],
      },
      TODAY,
    );
    expect(Object.values(report).every((list) => list.length === 0)).toBe(true);
  });

  it('duplicates: exact after trim/case/whitespace on name, ign, personnelCode; inactive people ride in, flagged', () => {
    const report = buildDataQualityReport(
      {
        people: [
          person({ personId: 'PER-0001', fullName: 'Jordan Reyes', ign: 'ACE' }),
          person({ personId: 'PER-0002', fullName: '  jordan   REYES ', isActive: false }), // the classic re-import
          person({ personId: 'PER-0003', fullName: 'Dana Cole', ign: 'ace' }), // ign collides, name does not
          person({ personId: 'PER-0004', fullName: 'Riko Mars', personnelCode: 'R6/PL/007' }),
          person({ personId: 'PER-0005', fullName: 'Lea Wolf', personnelCode: 'R6/PL/007' }),
          person({ personId: 'PER-0006', fullName: 'Unique Person' }), // null ign/code never group
        ],
        credentials: [],
        agreements: [],
      },
      TODAY,
    );
    expect(report.duplicatePeople).toHaveLength(3);
    const byReason = Object.fromEntries(report.duplicatePeople.map((g) => [g.reason, g]));
    expect(byReason['fullName']!.people.map((p) => p.personId)).toEqual(['PER-0001', 'PER-0002']);
    expect(byReason['fullName']!.people[1]!.isActive).toBe(false); // marked, not hidden
    expect(byReason['ign']!.people.map((p) => p.personId)).toEqual(['PER-0001', 'PER-0003']);
    expect(byReason['personnelCode']!.people.map((p) => p.personId)).toEqual(['PER-0004', 'PER-0005']);
  });

  it('missing basics nag about ACTIVE people only', () => {
    const report = buildDataQualityReport(
      {
        people: [
          person({ personId: 'PER-0001', fullName: 'No Nation', nationality: null }),
          person({ personId: 'PER-0002', fullName: 'No Role', primaryRole: '  ' }),
          person({ personId: 'PER-0003', fullName: 'History Person', nationality: null, primaryRole: null, isActive: false }),
        ],
        credentials: [],
        agreements: [],
      },
      TODAY,
    );
    expect(report.peopleMissingNationality.map((p) => p.personId)).toEqual(['PER-0001']);
    expect(report.peopleMissingRole.map((p) => p.personId)).toEqual(['PER-0002']);
    // personnelCode missing on both active people, never on the inactive one
    expect(report.peopleMissingPersonnelCode.map((p) => p.personId)).toEqual(['PER-0001', 'PER-0002']);
  });

  it('credential dates: strictly past is stale, today is not; missing expiry listed separately; inactive excluded', () => {
    const report = buildDataQualityReport(
      {
        people: [],
        credentials: [
          credential({ credentialId: 'CRED-0001', expiresOn: '2026-07-09' }), // past
          credential({ credentialId: 'CRED-0002', expiresOn: TODAY }), // today — not yet
          credential({ credentialId: 'CRED-0003', expiresOn: null }), // no expiry
          credential({ credentialId: 'CRED-0004', expiresOn: '2020-01-01', isActive: false }), // history
        ],
        agreements: [],
      },
      TODAY,
    );
    expect(report.activeCredentialsPastExpiry.map((c) => c.credentialId)).toEqual(['CRED-0001']);
    expect(report.credentialsWithoutExpiry.map((c) => c.credentialId)).toEqual(['CRED-0003']);
  });

  it('agreement checks look at Active status only; the anchor names person or entity', () => {
    const report = buildDataQualityReport(
      {
        people: [],
        credentials: [],
        agreements: [
          agreement({ agreementId: 'AGR-0001', endsOn: '2026-01-01' }), // active, past end
          agreement({ agreementId: 'AGR-0002', endsOn: '2020-01-01', status: 'Terminated' }), // history, fine
          agreement({ agreementId: 'AGR-0003', agreementCode: null, personId: null, entityId: 'ENT-0001' }), // no code, entity-anchored
        ],
      },
      TODAY,
    );
    expect(report.activeAgreementsPastEnd.map((a) => a.agreementId)).toEqual(['AGR-0001']);
    expect(report.activeAgreementsWithoutCode.map((a) => a.agreementId)).toEqual(['AGR-0003']);
    expect(report.activeAgreementsWithoutCode[0]!.anchor).toBe('ENT-0001');
  });
});
