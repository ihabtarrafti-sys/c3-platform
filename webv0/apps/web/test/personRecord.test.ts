import type { PersonDto } from '@c3web/api-contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import {
  personPiiProjectionComplete,
  personRecordModuleTruthOf,
  personRecordTruthOf,
  type PersonRecordTruthFacts,
} from '../src/tablework/PersonRecord';

const witnessedAt = Date.parse('2026-08-06T12:15:00.000Z');
const person = {} as PersonDto;

const facts = (overrides: Partial<PersonRecordTruthFacts> = {}): PersonRecordTruthFacts => ({
  canRead: true,
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  dataUpdatedAt: witnessedAt,
  ...overrides,
});

describe('transient Person Record witness', () => {
  it('derives loading, verified, denied, failed, and stale without inventing singleton emptiness', () => {
    expect(personRecordTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(personRecordTruthOf(facts({ data: { person } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(personRecordTruthOf(facts({ canRead: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'PERSON_NOT_AVAILABLE',
    });
    expect(personRecordTruthOf(facts({ error: new Error('person read failed') }))).toEqual({
      kind: 'fetch-failed',
      message: 'person read failed',
    });
    expect(personRecordTruthOf(facts({ data: { person }, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'This person record is being checked again.',
    });
  });

  it.each([401, 403, 404])('collapses HTTP %s to one privacy-safe unavailable answer and withholds cache', (status) => {
    expect(
      personRecordTruthOf(
        facts({
          data: { person },
          error: new ApiError(status, 'DISTINCT_SERVER_CODE', 'Do not reveal which case.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'PERSON_NOT_AVAILABLE' });
  });

  it('retains an ordinary failed refresh only under an explicit stale stamp', () => {
    expect(
      personRecordTruthOf(
        facts({ data: { person }, error: new Error('temporarily offline') }),
      ),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'temporarily offline',
    });
  });

  it('distinguishes an entitled but omitted PII projection from recorded null facts', () => {
    expect(personPiiProjectionComplete({} as PersonDto)).toBe(false);
    expect(
      personPiiProjectionComplete({
        dateOfBirth: null,
        photoUpdatedAt: null,
        addressLine1: null,
        addressLine2: null,
        addressCity: null,
        addressCountry: null,
        phone: null,
        email: null,
      } as PersonDto),
    ).toBe(true);
  });

  it('withholds the aggregate Verified label when an entitled included section is incomplete', () => {
    const primary = { kind: 'verified' as const, at: new Date(witnessedAt) };
    expect(personRecordModuleTruthOf(primary, true, false)).toEqual({
      kind: 'fetch-failed',
      message: 'The entitled sensitive projection is incomplete.',
    });
    expect(personRecordModuleTruthOf(primary, true, true)).toBe(primary);
    expect(personRecordModuleTruthOf(primary, false, false)).toBe(primary);
    expect(personRecordModuleTruthOf({ kind: 'loading' }, true, false)).toEqual({ kind: 'loading' });
  });
});
