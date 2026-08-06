import type { PersonDto } from '@c3web/api-contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import {
  peopleFieldTruthOf,
  type PeopleFieldTruthFacts,
} from '../src/tablework/PeopleField';

const witnessedAt = Date.parse('2026-08-06T09:45:00.000Z');
const onePerson = {} as PersonDto;

const facts = (overrides: Partial<PeopleFieldTruthFacts> = {}): PeopleFieldTruthFacts => ({
  canRead: true,
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  dataUpdatedAt: witnessedAt,
  ...overrides,
});

describe('Living Field personnel witness', () => {
  it('derives all six truth states from the People read alone', () => {
    expect(peopleFieldTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(peopleFieldTruthOf(facts({ data: { people: [onePerson] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(peopleFieldTruthOf(facts({ data: { people: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(peopleFieldTruthOf(facts({ canRead: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'PEOPLE_UNAVAILABLE',
    });
    expect(peopleFieldTruthOf(facts({ error: new Error('personnel read failed') }))).toEqual({
      kind: 'fetch-failed',
      message: 'personnel read failed',
    });
    expect(
      peopleFieldTruthOf(facts({ data: { people: [onePerson] }, isFetching: true })),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The personnel register is being checked again.',
    });
  });

  it.each([401, 403])('withholds cached personnel after authoritative HTTP %s', (status) => {
    expect(
      peopleFieldTruthOf(
        facts({
          data: { people: [onePerson] },
          error: new ApiError(status, 'PEOPLE_REFUSED', 'The register was refused.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'PEOPLE_REFUSED' });
  });

  it('never presents cached emptiness as current while revalidating', () => {
    expect(peopleFieldTruthOf(facts({ data: { people: [] }, isFetching: true })).kind).toBe('stale');
  });

  it('keeps cached personnel explicitly stale after an ordinary failed refresh', () => {
    expect(
      peopleFieldTruthOf(
        facts({ data: { people: [onePerson] }, error: new Error('temporarily offline') }),
      ),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'temporarily offline',
    });
  });
});
