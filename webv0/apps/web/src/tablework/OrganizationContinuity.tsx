import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EntityDto, TeamDto, TeamMembershipDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { useEntities, useTeamMembers, useTeams } from '../queries';
import { useSession } from '../session';
import { RecheckingTruthPanel } from './RecheckingTruthPanel';
import { StatusBadge } from './collections';
import { truthStateOf, type WitnessState } from './TruthPanel';
import { useForegroundRewitness } from './useForegroundRewitness';

interface TeamsView {
  readonly teams: readonly TeamDto[];
}

interface EntitiesView {
  readonly entities: readonly EntityDto[];
}

interface TeamRosterView {
  readonly members: readonly TeamMembershipDto[];
}

export interface OrganizationRegisterTruthFacts<T> {
  readonly included: boolean;
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

function registerTruthOf<T>(
  facts: OrganizationRegisterTruthFacts<T>,
  isEmpty: (data: T) => boolean,
  omittedReason: string,
  recheckMessage: string,
  missingMessage?: string,
): WitnessState {
  if (!facts.included) return { kind: 'denied', reasonClass: omittedReason };
  if (facts.error instanceof ApiError && (facts.error.status === 401 || facts.error.status === 403)) {
    return { kind: 'denied', reasonClass: facts.error.code || `HTTP_${facts.error.status}` };
  }
  // A missing selected team is authoritative. A prior roster must not survive
  // the 404 as merely stale content belonging to a record that no longer
  // resolves in this tenant.
  if (missingMessage && facts.error instanceof ApiError && facts.error.status === 404) {
    return { kind: 'fetch-failed', message: missingMessage };
  }

  const base = truthStateOf(
    {
      data: facts.data,
      error: facts.error,
      isLoading: facts.isLoading,
      dataUpdatedAt: facts.dataUpdatedAt,
    },
    isEmpty,
  );
  if (
    facts.isFetching &&
    facts.data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(facts.dataUpdatedAt > 0 ? facts.dataUpdatedAt : 0),
      message: recheckMessage,
    };
  }
  return base;
}

export function teamsRegisterTruthOf(facts: OrganizationRegisterTruthFacts<TeamsView>): WitnessState {
  return registerTruthOf(
    facts,
    (view) => view.teams.length === 0,
    'TEAMS_NOT_INCLUDED',
    'The Teams register is being checked again.',
  );
}

export function entitiesRegisterTruthOf(facts: OrganizationRegisterTruthFacts<EntitiesView>): WitnessState {
  return registerTruthOf(
    facts,
    (view) => view.entities.length === 0,
    'ENTITIES_NOT_INCLUDED',
    'The Entity register is being checked again.',
  );
}

export function teamRosterTruthOf(facts: OrganizationRegisterTruthFacts<TeamRosterView>): WitnessState {
  return registerTruthOf(
    facts,
    (view) => view.members.length === 0,
    'TEAM_ROSTER_NOT_INCLUDED',
    'The selected Team membership register is being checked again.',
    'The selected Team no longer resolves, so its prior membership view has been withheld.',
  );
}

interface OrganizationContinuityTruthSources {
  readonly teams: WitnessState;
  readonly entities: WitnessState;
  readonly entitiesIncluded: boolean;
  readonly roster?: WitnessState;
}

const isComplete = (state: WitnessState): state is Extract<WitnessState, { kind: 'verified' | 'proven-empty' }> =>
  state.kind === 'verified' || state.kind === 'proven-empty';

/** Window chrome summarizes only mounted witnesses. Every register keeps its
 * own artifact below, and an omitted Entity lane is neither denied nor empty. */
export function joinOrganizationContinuityTruth({
  teams,
  entities,
  entitiesIncluded,
  roster,
}: OrganizationContinuityTruthSources): WitnessState {
  const sources: ReadonlyArray<{ readonly label: string; readonly state: WitnessState }> = [
    { label: 'teams', state: teams },
    ...(entitiesIncluded ? [{ label: 'entities', state: entities }] : []),
    ...(roster ? [{ label: 'team-roster', state: roster }] : []),
  ];
  const denied = sources.filter((source) => source.state.kind === 'denied');
  if (denied.length > 0) {
    return {
      kind: 'denied',
      reasonClass: denied
        .map((source) => `${source.label}:${source.state.kind === 'denied' ? source.state.reasonClass : 'denied'}`)
        .join(','),
    };
  }
  const failed = sources.filter((source) => source.state.kind === 'fetch-failed');
  if (failed.length > 0) {
    return {
      kind: 'fetch-failed',
      message: failed
        .map((source) => `${source.label}: ${source.state.kind === 'fetch-failed' ? source.state.message : 'The request failed.'}`)
        .join(' '),
    };
  }
  if (sources.some((source) => source.state.kind === 'loading')) return { kind: 'loading' };
  const stale = sources.filter((source) => source.state.kind === 'stale');
  if (stale.length > 0) {
    const verifiedAt = stale
      .map((source) => (source.state.kind === 'stale' ? source.state.verifiedAt : new Date(0)))
      .reduce((left, right) => (left.getTime() <= right.getTime() ? left : right));
    return {
      kind: 'stale',
      verifiedAt,
      message: `${stale.map((source) => source.label).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} stale; organization structure may be incomplete.`,
    };
  }
  const complete = sources.filter((source): source is { readonly label: string; readonly state: Extract<WitnessState, { kind: 'verified' | 'proven-empty' }> } => isComplete(source.state));
  if (complete.length !== sources.length) {
    return { kind: 'fetch-failed', message: 'An Organization Continuity source has no current witness.' };
  }
  const at = new Date(Math.min(...complete.map((source) => source.state.at.getTime())));
  if (complete.every((source) => source.state.kind === 'proven-empty')) return { kind: 'proven-empty', at };
  return { kind: 'verified', at };
}

export function sortTeamsForContinuity(teams: readonly TeamDto[]): readonly TeamDto[] {
  return [...teams].sort((left, right) => {
    if (left.isActive !== right.isActive) return Number(right.isActive) - Number(left.isActive);
    return left.name.localeCompare(right.name) || left.teamId.localeCompare(right.teamId);
  });
}

export function sortEntitiesForContinuity(entities: readonly EntityDto[]): readonly EntityDto[] {
  return [...entities].sort((left, right) => {
    if (left.isActive !== right.isActive) return Number(right.isActive) - Number(left.isActive);
    return left.name.localeCompare(right.name) || left.entityId.localeCompare(right.entityId);
  });
}

export function sortTeamRosterForContinuity(members: readonly TeamMembershipDto[]): readonly TeamMembershipDto[] {
  return [...members].sort((left, right) => {
    if (left.isActive !== right.isActive) return Number(right.isActive) - Number(left.isActive);
    return left.personName.localeCompare(right.personName) || left.personId.localeCompare(right.personId);
  });
}

/** An ordinary successful empty Team or Entity register is a legitimate
 * bootstrap surface. A stale, failed, loading, or denied witness cannot carry
 * direct structural writes on the standalone register pages. */
export function organizationRegisterActionsAvailable(canManage: boolean, truth: WitnessState): boolean {
  return canManage && (truth.kind === 'verified' || truth.kind === 'proven-empty');
}

export interface OrganizationContinuityProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly teamsHref?: string;
  readonly entitiesHref?: string;
  readonly hrefForTeam?: (teamId: string) => string;
  readonly hrefForPerson?: (personId: string) => string;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

const teamKindLabel = (kind: TeamDto['kind']): string =>
  kind === 'GameDivision' ? 'Game division' : 'Department';

const recordedOn = (updatedAt: string): string => updatedAt.slice(0, 10);

export function OrganizationContinuity({
  enabled = true,
  foreground = true,
  requestKey,
  teamsHref = '/teams',
  entitiesHref = '/entities',
  hrefForTeam = (teamId) => `/teams/${teamId}`,
  hrefForPerson = (personId) => `/people/${personId}`,
  onTruthChange,
}: OrganizationContinuityProps = {}) {
  const { me } = useSession();
  const teamsIncluded = me?.capabilities.canReadPeople ?? false;
  // GET /entities has no dedicated read capability, while the shipped product
  // exposes its navigation only to structural managers. This module preserves
  // that existing audience deliberately; omission is labelled as view policy,
  // never misreported as an API denial.
  const entitiesIncluded = me?.capabilities.canManageEntities ?? false;
  const teamsEnabled = enabled && teamsIncluded;
  const entitiesEnabled = enabled && entitiesIncluded;
  const teamsQuery = useTeams(teamsEnabled);
  const entitiesQuery = useEntities(entitiesEnabled);
  const teamsRewitnessing = useForegroundRewitness({
    foreground,
    enabled: teamsEnabled,
    refetch: teamsQuery.refetch,
    requestKey,
  });
  const entitiesRewitnessing = useForegroundRewitness({
    foreground,
    enabled: entitiesEnabled,
    refetch: entitiesQuery.refetch,
    requestKey,
  });
  const teamsTruth = useMemo(
    () =>
      teamsRegisterTruthOf({
        included: teamsIncluded,
        data: teamsQuery.data,
        error: teamsQuery.error,
        isLoading: teamsQuery.isLoading,
        isFetching: teamsQuery.isFetching || teamsRewitnessing,
        dataUpdatedAt: teamsQuery.dataUpdatedAt,
      }),
    [
      teamsIncluded,
      teamsQuery.data,
      teamsQuery.dataUpdatedAt,
      teamsQuery.error,
      teamsQuery.isFetching,
      teamsQuery.isLoading,
      teamsRewitnessing,
    ],
  );
  const entitiesTruth = useMemo(
    () =>
      entitiesRegisterTruthOf({
        included: entitiesIncluded,
        data: entitiesIncluded ? entitiesQuery.data : undefined,
        error: entitiesQuery.error,
        isLoading: entitiesQuery.isLoading,
        isFetching: entitiesQuery.isFetching || entitiesRewitnessing,
        dataUpdatedAt: entitiesQuery.dataUpdatedAt,
      }),
    [
      entitiesIncluded,
      entitiesQuery.data,
      entitiesQuery.dataUpdatedAt,
      entitiesQuery.error,
      entitiesQuery.isFetching,
      entitiesQuery.isLoading,
      entitiesRewitnessing,
    ],
  );

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const selectedTeamTriggerRef = useRef<HTMLButtonElement | null>(null);
  const teams = useMemo(() => sortTeamsForContinuity(teamsQuery.data?.teams ?? []), [teamsQuery.data]);
  const entities = useMemo(() => sortEntitiesForContinuity(entitiesQuery.data?.entities ?? []), [entitiesQuery.data]);
  const teamsVisible = teamsTruth.kind === 'verified' || teamsTruth.kind === 'stale';
  const selectedTeam = teamsVisible ? teams.find((team) => team.teamId === selectedTeamId) : undefined;
  const rosterIncluded = selectedTeam !== undefined;
  const rosterEnabled = enabled && teamsIncluded && rosterIncluded;
  const rosterQuery = useTeamMembers(selectedTeamId ?? 'TEAM-0000', rosterEnabled);
  const rosterRewitnessing = useForegroundRewitness({
    foreground,
    enabled: rosterEnabled,
    refetch: rosterQuery.refetch,
    requestKey: `${String(requestKey ?? 'direct')}:${selectedTeamId ?? 'none'}`,
  });
  const rosterTruth = useMemo(
    () =>
      teamRosterTruthOf({
        included: rosterIncluded,
        data: rosterIncluded ? rosterQuery.data : undefined,
        error: rosterQuery.error,
        isLoading: rosterQuery.isLoading,
        isFetching: rosterQuery.isFetching || rosterRewitnessing,
        dataUpdatedAt: rosterQuery.dataUpdatedAt,
      }),
    [
      rosterIncluded,
      rosterQuery.data,
      rosterQuery.dataUpdatedAt,
      rosterQuery.error,
      rosterQuery.isFetching,
      rosterQuery.isLoading,
      rosterRewitnessing,
    ],
  );
  const truth = useMemo(
    () =>
      joinOrganizationContinuityTruth({
        teams: teamsTruth,
        entities: entitiesTruth,
        entitiesIncluded,
        ...(rosterIncluded ? { roster: rosterTruth } : {}),
      }),
    [entitiesIncluded, entitiesTruth, rosterIncluded, rosterTruth, teamsTruth],
  );
  const teamsRechecking =
    teamsQuery.data !== undefined && teamsQuery.error == null && (teamsQuery.isFetching || teamsRewitnessing);
  const entitiesRechecking =
    entitiesQuery.data !== undefined && entitiesQuery.error == null && (entitiesQuery.isFetching || entitiesRewitnessing);
  const rosterRechecking =
    rosterQuery.data !== undefined && rosterQuery.error == null && (rosterQuery.isFetching || rosterRewitnessing);
  const roster = useMemo(
    () => sortTeamRosterForContinuity(rosterQuery.data?.members ?? []),
    [rosterQuery.data],
  );

  useLayoutEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  const activeTeams = teams.filter((team) => team.isActive).length;
  const divisions = teams.filter((team) => team.kind === 'GameDivision').length;
  const departments = teams.length - divisions;
  const activeEntities = entities.filter((entity) => entity.isActive).length;
  const jurisdictions = new Set(entities.map((entity) => entity.jurisdiction.trim()).filter(Boolean)).size;
  const currencies = new Set(entities.map((entity) => entity.localCurrency)).size;

  return (
    <section className="organization-continuity" data-tablework="OrganizationContinuity" data-truth={truth.kind}>
      <header className="organization-continuity-intro">
        <span className="organization-continuity-rails" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>
          <small>Parallel registers · independently witnessed</small>
          <strong>Organization Continuity</strong>
          <p>Operational Teams and legal Entities held side by side, with inactive records retained in view.</p>
        </span>
      </header>

      <p className="organization-continuity-boundary">
        These registers do not name a Team-to-Entity hierarchy. This surface invents no parent, owner, reporting line, authority, or relationship between their rows.
      </p>

      <div className={`organization-continuity-grid${entitiesIncluded ? '' : ' is-team-only'}`}>
        <section className="organization-continuity-lane is-teams" aria-labelledby="organization-teams-title">
          <header>
            <span>
              <small>01 · Working structure</small>
              <h2 id="organization-teams-title">Teams register</h2>
            </span>
            <Link className="secondary-action" to={teamsHref}>Open Teams</Link>
          </header>

          <RecheckingTruthPanel
            state={teamsTruth}
            rechecking={teamsRechecking}
            emptyLabel="No Team records were returned. Legal Entities, personnel labels, and access seats do not create a Team."
            testids={{
              loading: 'organization-teams-loading',
              verified: 'organization-teams-verified',
              empty: 'organization-teams-empty',
              denied: 'organization-teams-denied',
              failed: 'organization-teams-failed',
              stale: 'organization-teams-stale',
            }}
          >
            <div className="organization-continuity-lane-body">
              <div className="organization-continuity-counts" aria-label="Team record counts">
                <span><strong>{teams.length}</strong><small>Team records</small></span>
                <span><strong>{activeTeams}</strong><small>Active</small></span>
                <span><strong>{divisions}</strong><small>Game divisions</small></span>
                <span><strong>{departments}</strong><small>Departments</small></span>
              </div>
              <ul className="organization-continuity-records" aria-label="Teams">
                {teams.map((team) => (
                  <li key={team.teamId} data-testid={`organization-team-${team.teamId}`} className={selectedTeamId === team.teamId ? 'is-selected' : undefined}>
                    <span className="organization-continuity-node" aria-hidden="true"><i /></span>
                    <span className="organization-continuity-record-copy">
                      <small>{team.code} · {team.teamId}</small>
                      <strong>{team.name}</strong>
                      <span>{teamKindLabel(team.kind)}{team.gameTitle ? ` · ${team.gameTitle}` : ''}</span>
                      <em>Recorded update · {recordedOn(team.updatedAt)}</em>
                    </span>
                    <span className="organization-continuity-record-standing">
                      <StatusBadge variant={team.isActive ? 'ready' : 'neutral'}>{team.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                      <button
                        type="button"
                        className="organization-continuity-inspect"
                        aria-pressed={selectedTeamId === team.teamId}
                        onClick={(event) => {
                          selectedTeamTriggerRef.current = event.currentTarget;
                          setSelectedTeamId((current) => current === team.teamId ? null : team.teamId);
                        }}
                      >
                        {selectedTeamId === team.teamId ? 'Hide roster' : 'Inspect roster'}
                      </button>
                      <Link to={hrefForTeam(team.teamId)} aria-label={`Open full Team record ${team.teamId}`}>↗</Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </RecheckingTruthPanel>
        </section>

        {entitiesIncluded ? (
          <section className="organization-continuity-lane is-entities" aria-labelledby="organization-entities-title">
            <header>
              <span>
                <small>02 · Legal structure</small>
                <h2 id="organization-entities-title">Entity register</h2>
              </span>
              <Link className="secondary-action" to={entitiesHref}>Open Entities</Link>
            </header>

            <RecheckingTruthPanel
              state={entitiesTruth}
              rechecking={entitiesRechecking}
              emptyLabel="No legal-Entity records were returned. Teams do not imply a legal Entity."
              testids={{
                loading: 'organization-entities-loading',
                verified: 'organization-entities-verified',
                empty: 'organization-entities-empty',
                denied: 'organization-entities-denied',
                failed: 'organization-entities-failed',
                stale: 'organization-entities-stale',
              }}
            >
              <div className="organization-continuity-lane-body">
                <div className="organization-continuity-counts" aria-label="Entity record counts">
                  <span><strong>{entities.length}</strong><small>Entity records</small></span>
                  <span><strong>{activeEntities}</strong><small>Active</small></span>
                  <span><strong>{jurisdictions}</strong><small>Jurisdictions</small></span>
                  <span><strong>{currencies}</strong><small>Currencies</small></span>
                </div>
                <ul className="organization-continuity-records" aria-label="Legal Entities">
                  {entities.map((entity) => (
                    <li key={entity.entityId} data-testid={`organization-entity-${entity.entityId}`}>
                      <span className="organization-continuity-node" aria-hidden="true"><i /></span>
                      <span className="organization-continuity-record-copy">
                        <small>{entity.code ?? 'No code'} · {entity.entityId}</small>
                        <strong>{entity.name}</strong>
                        <span>{entity.jurisdiction} · {entity.localCurrency}</span>
                        <em>Recorded update · {recordedOn(entity.updatedAt)}</em>
                      </span>
                      <span className="organization-continuity-record-standing">
                        <StatusBadge variant={entity.isActive ? 'ready' : 'neutral'}>{entity.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </RecheckingTruthPanel>
          </section>
        ) : (
          <aside className="organization-continuity-omitted" data-testid="organization-entities-omitted">
            <small>02 · Legal structure</small>
            <strong>Entities are not included in this workspace view.</strong>
            <p>The existing Organization navigation exposes this register only to structural managers. No Entity data is requested or summarized here.</p>
          </aside>
        )}
      </div>

      {selectedTeam ? (
        <section className="organization-continuity-roster" data-testid={`organization-roster-${selectedTeam.teamId}`} aria-labelledby="organization-roster-title">
          <header>
            <span>
              <small>03 · Explicit relationship</small>
              <h2 id="organization-roster-title">{selectedTeam.name} · Team membership</h2>
              <p>Only canonical TeamMembership rows are shown. Their role labels are not C3 authority or reporting lines.</p>
            </span>
            <button
              type="button"
              className="quiet-action"
              onClick={() => {
                const trigger = selectedTeamTriggerRef.current;
                setSelectedTeamId(null);
                window.requestAnimationFrame(() => trigger?.focus());
              }}
            >
              Close roster
            </button>
          </header>
          <RecheckingTruthPanel
            state={rosterTruth}
            rechecking={rosterRechecking}
            emptyLabel={`No TeamMembership rows were returned for ${selectedTeam.code}. A Person display-team label does not create membership.`}
            testids={{
              loading: 'organization-roster-loading',
              verified: 'organization-roster-verified',
              empty: 'organization-roster-empty',
              denied: 'organization-roster-denied',
              failed: 'organization-roster-failed',
              stale: 'organization-roster-stale',
            }}
          >
            <ul className="organization-continuity-members" aria-label={`${selectedTeam.name} membership register`}>
              {roster.map((member) => (
                <li key={`${member.teamId}:${member.personId}`} data-testid={`organization-member-${member.personId}`}>
                  <span className="organization-continuity-membership-mark" aria-hidden="true"><i /></span>
                  <span>
                    <strong>{member.personName}</strong>
                    <small>{member.personId}</small>
                  </span>
                  <span>
                    <small>Role on this Team</small>
                    <strong>{member.role}</strong>
                  </span>
                  <StatusBadge variant={member.isActive ? 'ready' : 'neutral'}>{member.isActive ? 'Active' : 'Former'}</StatusBadge>
                  <Link to={hrefForPerson(member.personId)} aria-label={`Open Person record ${member.personId}`}>↗</Link>
                </li>
              ))}
            </ul>
          </RecheckingTruthPanel>
        </section>
      ) : null}

      <footer className="organization-continuity-footer">
        Inactive records remain visible for continuity. People display labels, access seats, legal Entities, Team membership, and effective authority remain separate truths.
      </footer>
    </section>
  );
}
