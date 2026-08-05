import { useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PersonDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { usePeople } from '../queries';
import { useSession } from '../session';
import { PersonAvatar } from './Avatar';
import { TruthPanel, truthStateOf, type WitnessState } from './TruthPanel';
import { useForegroundRewitness } from './useForegroundRewitness';

type PeopleFieldStatus = 'active' | 'all' | 'inactive';

export interface PeopleFieldTruthFacts {
  readonly canRead: boolean;
  readonly data: { readonly people: readonly PersonDto[] } | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

/**
 * People owns its own witness. A cached roster is withheld after an
 * authoritative refusal, while an ordinary background re-check remains
 * readable only under an explicit stale stamp.
 */
export function peopleFieldTruthOf({
  canRead,
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
}: PeopleFieldTruthFacts): WitnessState {
  if (!canRead) return { kind: 'denied', reasonClass: 'PEOPLE_UNAVAILABLE' };
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: 'denied', reasonClass: error.code || `HTTP_${error.status}` };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    (view) => view.people.length === 0,
  );
  if (
    isFetching &&
    data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'The personnel register is being checked again.',
    };
  }
  return base;
}

export interface PeopleFieldProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly hrefForPerson?: (personId: string) => string;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

function personSearchText(person: PersonDto): string {
  return [
    person.fullName,
    person.ign,
    person.personId,
    person.primaryRole,
    person.position,
    person.currentTeam,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase();
}

/**
 * The Living Field is a personnel register, not an org chart and not an
 * access directory. It renders only facts the People wire already serves and
 * never infers presence, performance, a canonical team edge, or a C3 seat.
 */
export function PeopleField({
  enabled = true,
  foreground = true,
  requestKey,
  hrefForPerson = (personId) => `/people/${personId}`,
  onTruthChange,
}: PeopleFieldProps = {}) {
  const { me } = useSession();
  const canRead = me?.capabilities.canReadPeople ?? false;
  const queryEnabled = enabled && canRead;
  const query = usePeople(queryEnabled);
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = query;
  const rewitnessing = useForegroundRewitness({
    foreground,
    enabled: queryEnabled,
    refetch,
    requestKey,
  });
  const truth = useMemo(
    () =>
      peopleFieldTruthOf({
        canRead,
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing,
        dataUpdatedAt,
      }),
    [canRead, data, error, isLoading, isFetching, rewitnessing, dataUpdatedAt],
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PeopleFieldStatus>('active');

  // The window bar is part of the privacy posture. Report an authoritative
  // denial before paint so cached success cannot leave one verified frame.
  useLayoutEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  const people = data?.people ?? [];
  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return people
      .filter((person) => {
        if (status === 'active' && !person.isActive) return false;
        if (status === 'inactive' && person.isActive) return false;
        return needle.length === 0 || personSearchText(person).includes(needle);
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [people, search, status]);

  const activeCount = people.filter((person) => person.isActive).length;
  const inactiveCount = people.length - activeCount;
  const displayTeams = new Set(
    people
      .map((person) => person.currentTeam?.trim())
      .filter((team): team is string => Boolean(team)),
  ).size;

  return (
    <section className="people-field" data-testid="people-field" aria-label="Living Field">
      <header className="people-field-intro">
        <span className="people-field-orbit" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          <small>Personnel truth · query witnessed</small>
          <strong>Living Field</strong>
          <p>People records in this organization, held without presence, ranking, or inferred relationships.</p>
        </span>
      </header>

      <TruthPanel
        state={truth}
        emptyLabel="No personnel records yet. A C3 access seat is not a person record."
        testids={{
          loading: 'people-field-loading',
          verified: 'people-field-verified',
          empty: 'people-field-empty',
          denied: 'people-field-denied',
          failed: 'people-field-failed',
          stale: 'people-field-stale',
        }}
      >
        <div className="people-field-body">
          <div className="people-field-counts" aria-label="Personnel counts">
            <span><strong>{activeCount}</strong><small>Active people</small></span>
            <span><strong>{inactiveCount}</strong><small>Inactive people</small></span>
            <span><strong>{displayTeams}</strong><small>Display-team labels</small></span>
          </div>

          <p className="people-field-boundary">
            Personnel and access are separate registers. This field does not claim that a person has a C3 seat, and a display-team label is not a canonical team membership.
          </p>

          <div className="people-field-tools" role="search" aria-label="Filter the Living Field">
            <label>
              <span>Find a person</span>
              <input
                type="search"
                value={search}
                placeholder="Name, IGN, role, team, or ID"
                data-testid="people-field-search"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              <span>Standing</span>
              <select
                value={status}
                data-testid="people-field-status"
                onChange={(event) => setStatus(event.target.value as PeopleFieldStatus)}
              >
                <option value="active">Active</option>
                <option value="all">All</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="people-field-no-match" data-testid="people-field-no-match">
              No personnel records match this view. The register itself is not empty.
            </p>
          ) : (
            <div className="people-field-grid" data-testid="people-field-grid">
              {shown.map((person) => (
                <Link
                  className="people-field-person"
                  data-testid={`people-field-person-${person.personId}`}
                  key={person.personId}
                  to={hrefForPerson(person.personId)}
                >
                  <PersonAvatar
                    personId={person.personId}
                    photoUpdatedAt={person.photoUpdatedAt}
                    name={person.fullName}
                    size={38}
                  />
                  <span className="people-field-person-copy">
                    <span>
                      <strong>{person.fullName}</strong>
                      <small>{person.ign ? `“${person.ign}” · ` : ''}{person.personId}</small>
                    </span>
                    <span className="people-field-person-facts">
                      <small>{person.primaryRole ?? person.position ?? 'Role not recorded'}</small>
                      <small>{person.currentTeam ? `Display team · ${person.currentTeam}` : 'Display team not recorded'}</small>
                    </span>
                  </span>
                  <span className={person.isActive ? 'people-field-standing is-active' : 'people-field-standing'}>
                    {person.isActive ? 'Active' : 'Inactive'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </TruthPanel>
    </section>
  );
}
