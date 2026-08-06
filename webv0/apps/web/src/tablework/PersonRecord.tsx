/**
 * One runtime person record for Workspace OS.
 *
 * The fixed window may remember geometry. The selected person never enters
 * workspace state, a saved view, or localStorage; its identity lives in the
 * route and this mounted tree only. This milestone is deliberately a
 * read-only rendering of the primary Person witness. Related registers keep
 * their own truth and arrive in later People & Organization milestones.
 */
import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PersonDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { usePerson } from '../queries';
import { useSession } from '../session';
import { PersonAvatar } from './Avatar';
import { FactList, StatusBadge } from './collections';
import { RecheckingTruthPanel } from './RecheckingTruthPanel';
import { truthStateOf, type WitnessState } from './TruthPanel';
import { useForegroundRewitness } from './useForegroundRewitness';

export interface PersonRecordMeta {
  readonly record: string;
  readonly unavailable: boolean;
  readonly piiVisible: boolean;
}

export interface PersonRecordTruthFacts {
  readonly canRead: boolean;
  readonly data: { readonly person: PersonDto } | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

/** A missing or inaccessible person is one privacy-safe answer. A cached
 * record is withheld on standing refusal and explicitly stale during any
 * ordinary re-check or failed refresh. */
export function personRecordTruthOf({
  canRead,
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
}: PersonRecordTruthFacts): WitnessState {
  if (!canRead) return { kind: 'denied', reasonClass: 'PERSON_NOT_AVAILABLE' };
  if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return { kind: 'denied', reasonClass: 'PERSON_NOT_AVAILABLE' };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    () => false,
  );
  if (isFetching && data !== undefined && base.kind === 'verified') {
    return {
      kind: 'stale',
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'This person record is being checked again.',
    };
  }
  return base;
}

export interface PersonRecordProps {
  readonly personId: string;
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly activationKey?: string | number;
  readonly fullRecordHref?: string;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly onMetaChange?: (meta: PersonRecordMeta) => void;
}

const valueOf = (value: string | null | undefined): string => value?.trim() || 'Not recorded';
const PERSON_PII_PROJECTION_KEYS = [
  'dateOfBirth',
  'photoUpdatedAt',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressCountry',
  'phone',
  'email',
] as const;

/** Null is a witnessed absence. An omitted key is a different answer: this
 * actor is entitled to the projection, but the projection did not arrive. */
export function personPiiProjectionComplete(person: PersonDto): boolean {
  return PERSON_PII_PROJECTION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(person, key));
}

/** The window chrome is the aggregate witness. Baseline Person facts may
 * still render, but an included entitled section that failed to arrive means
 * the record as a whole has not earned Verified. */
export function personRecordModuleTruthOf(
  primary: WitnessState,
  piiEntitled: boolean,
  piiComplete: boolean,
): WitnessState {
  if (primary.kind !== 'verified' || !piiEntitled || piiComplete) return primary;
  return {
    kind: 'fetch-failed',
    message: 'The entitled sensitive projection is incomplete.',
  };
}

function PersonRecordWitness({
  state,
  rechecking,
  children,
}: {
  readonly state: WitnessState;
  readonly rechecking: boolean;
  readonly children?: ReactNode;
}) {
  if (state.kind === 'denied' && state.reasonClass === 'PERSON_NOT_AVAILABLE') {
    return (
      <div className="field-error-block" role="note" data-truth="denied" data-testid="person-record-denied">
        This person record is unavailable. C3 does not reveal here whether the record is missing or outside your standing (PERSON_NOT_AVAILABLE).
      </div>
    );
  }

  return (
    <RecheckingTruthPanel
      state={state}
      rechecking={rechecking}
      emptyLabel="No person record was returned."
      testids={{
        loading: 'person-record-loading',
        verified: 'person-record-verified',
        denied: 'person-record-denied',
        failed: 'person-record-failed',
        stale: 'person-record-stale',
      }}
    >
      {children}
    </RecheckingTruthPanel>
  );
}

export function PersonRecord({
  personId,
  enabled = true,
  foreground = true,
  activationKey,
  fullRecordHref = `/people/${personId}`,
  onTruthChange,
  onMetaChange,
}: PersonRecordProps) {
  const { me } = useSession();
  const canRead = me?.capabilities.canReadPeople ?? false;
  const piiVisible = me?.capabilities.canViewPersonPII ?? false;
  const queryEnabled = enabled && canRead;
  const query = usePerson(personId, queryEnabled);
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = query;
  const rewitnessing = useForegroundRewitness({
    foreground,
    enabled: queryEnabled,
    refetch,
    requestKey: activationKey,
  });
  const truth = useMemo(
    () =>
      personRecordTruthOf({
        canRead,
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing,
        dataUpdatedAt,
      }),
    [canRead, data, error, isLoading, isFetching, rewitnessing, dataUpdatedAt],
  );
  const rechecking = data !== undefined && error == null && (isFetching || rewitnessing);
  const person = data?.person;
  const piiProjectionComplete = person ? personPiiProjectionComplete(person) : false;
  const moduleTruth = useMemo(
    () => personRecordModuleTruthOf(truth, piiVisible, piiProjectionComplete),
    [piiProjectionComplete, piiVisible, truth],
  );
  const unavailable = truth.kind === 'denied';
  const meta = useMemo<PersonRecordMeta>(
    () => ({
      record: unavailable ? 'Person Record' : (data?.person.fullName ?? 'Person Record'),
      unavailable,
      piiVisible: !unavailable && piiVisible && piiProjectionComplete,
    }),
    [data?.person.fullName, piiProjectionComplete, piiVisible, unavailable],
  );

  // The window bar participates in privacy. Refusal and A→B transitions reach
  // it before paint, so a previous person's name never survives for one frame.
  useLayoutEffect(() => {
    onTruthChange?.(moduleTruth);
  }, [moduleTruth, onTruthChange]);
  useLayoutEffect(() => {
    onMetaChange?.(meta);
  }, [meta, onMetaChange]);

  const address = person
    ? [person.addressLine1, person.addressLine2, person.addressCity, person.addressCountry]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(', ')
    : '';

  return (
    <section className="person-record" data-tablework="PersonRecord" data-truth={moduleTruth.kind}>
      <PersonRecordWitness
        state={truth}
        rechecking={rechecking}
      >
        {person ? (
          <div className="person-record-body">
            <header className="person-record-hero">
              <PersonAvatar
                personId={person.personId}
                photoUpdatedAt={piiVisible && piiProjectionComplete ? person.photoUpdatedAt : undefined}
                name={person.fullName}
                size={72}
              />
              <div className="person-record-title">
                <small>Person record · served facts</small>
                <h1>{person.fullName}</h1>
                <span>{person.ign ? `“${person.ign}” · ` : ''}{person.personId}</span>
              </div>
              <StatusBadge variant={person.isActive ? 'ready' : 'neutral'}>
                {person.isActive ? 'Active' : 'Inactive'}
              </StatusBadge>
            </header>

            <p className="person-record-boundary">
              This is a personnel record, not a C3 access seat. “Display team” is a served label; it does not claim canonical team membership.
            </p>

            <div className="person-record-sections">
              <section className="person-record-section" aria-labelledby={`person-record-work-${person.personId}`}>
                <header>
                  <small>01 · Work identity</small>
                  <h2 id={`person-record-work-${person.personId}`}>Role & place</h2>
                </header>
                <FactList
                  items={[
                    { label: 'Primary role', value: valueOf(person.primaryRole) },
                    { label: 'Position', value: valueOf(person.position) },
                    { label: 'Department', value: valueOf(person.primaryDepartment) },
                    { label: 'Display team', value: valueOf(person.currentTeam) },
                    { label: 'Game title', value: valueOf(person.currentGameTitle) },
                    { label: 'Entity ID', value: valueOf(person.entityId), mono: Boolean(person.entityId) },
                  ]}
                />
              </section>

              <section className="person-record-section" aria-labelledby={`person-record-identity-${person.personId}`}>
                <header>
                  <small>02 · Personnel identity</small>
                  <h2 id={`person-record-identity-${person.personId}`}>Recorded facts</h2>
                </header>
                <FactList
                  items={[
                    { label: 'First name', value: valueOf(person.firstName) },
                    { label: 'Last name', value: valueOf(person.lastName) },
                    { label: 'Nationality', value: valueOf(person.nationality) },
                    {
                      label: 'Other nationalities',
                      value: person.otherNationalities.length > 0 ? person.otherNationalities.join(' · ') : 'Not recorded',
                    },
                    { label: 'Personnel code', value: valueOf(person.personnelCode), mono: Boolean(person.personnelCode) },
                    { label: 'Joined', value: valueOf(person.dateOfJoining) },
                  ]}
                />
              </section>
            </div>

            {piiVisible && piiProjectionComplete ? (
              <section className="person-record-sensitive" aria-labelledby={`person-record-sensitive-${person.personId}`} data-testid="person-record-sensitive">
                <header>
                  <span>
                    <small>Sensitive facts · visible by standing</small>
                    <h2 id={`person-record-sensitive-${person.personId}`}>Contact & identity</h2>
                  </span>
                  <span className="person-record-sensitive-mark">PII</span>
                </header>
                <p>The API serves this block only because your current standing includes Person PII.</p>
                <FactList
                  items={[
                    { label: 'Date of birth', value: valueOf(person.dateOfBirth) },
                    { label: 'Phone', value: valueOf(person.phone) },
                    { label: 'Email', value: valueOf(person.email) },
                    { label: 'Address', value: address || 'Not recorded' },
                  ]}
                />
              </section>
            ) : piiVisible ? (
              <section
                className="person-record-sensitive person-record-sensitive-failed"
                aria-labelledby={`person-record-sensitive-${person.personId}`}
                data-section-truth="failed"
                data-testid="person-record-sensitive-failed"
              >
                <header>
                  <span>
                    <small>Sensitive facts · projection incomplete</small>
                    <h2 id={`person-record-sensitive-${person.personId}`}>Contact & identity</h2>
                  </span>
                  <span className="person-record-sensitive-mark">Unverified</span>
                </header>
                <p>
                  Sensitive facts could not be verified. No missing field is being described as “not recorded.”
                </p>
              </section>
            ) : (
              <p className="person-record-projection" data-testid="person-record-projection">
                Sensitive fields are absent from this projection. They are not visually hidden; the API did not serve them to this standing.
              </p>
            )}

            {person.notes ? (
              <section className="person-record-notes" aria-label="Personnel notes">
                <small>Recorded note</small>
                <p>{person.notes}</p>
              </section>
            ) : null}

            <footer className="person-record-footer">
              <span>Related registers retain independent witnesses and are not silently summarized here.</span>
              <Link className="secondary-action" to={fullRecordHref}>Open full governed record</Link>
            </footer>
          </div>
        ) : null}
      </PersonRecordWitness>
    </section>
  );
}
