import type { EntityDto, TeamDto, TeamMembershipDto } from '@c3web/api-contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import {
  entitiesRegisterTruthOf,
  joinOrganizationContinuityTruth,
  organizationRegisterActionsAvailable,
  sortEntitiesForContinuity,
  sortTeamRosterForContinuity,
  sortTeamsForContinuity,
  teamRosterTruthOf,
  teamsRegisterTruthOf,
  type OrganizationRegisterTruthFacts,
} from '../src/tablework/OrganizationContinuity';

const witnessedAt = Date.parse('2026-08-06T14:00:00.000Z');
const team = { teamId: 'TEAM-0001', name: 'Atlas', isActive: true } as TeamDto;
const entity = { entityId: 'ENT-0001', name: 'Atlas Legal', isActive: true } as EntityDto;
const member = { teamId: 'TEAM-0001', personId: 'PER-0001', personName: 'Ari', role: 'Coach', isActive: true } as TeamMembershipDto;

function facts<T>(overrides: Partial<OrganizationRegisterTruthFacts<T>> = {}): OrganizationRegisterTruthFacts<T> {
  return {
    included: true,
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: witnessedAt,
    ...overrides,
  };
}

describe('Organization Continuity independent witnesses', () => {
  it('derives all six Teams states without borrowing Entity health', () => {
    expect(teamsRegisterTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(teamsRegisterTruthOf(facts({ data: { teams: [team] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(teamsRegisterTruthOf(facts({ data: { teams: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(teamsRegisterTruthOf(facts({ included: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'TEAMS_NOT_INCLUDED',
    });
    expect(teamsRegisterTruthOf(facts({ error: new Error('teams unavailable') }))).toEqual({
      kind: 'fetch-failed',
      message: 'teams unavailable',
    });
    expect(teamsRegisterTruthOf(facts({ data: { teams: [team] }, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The Teams register is being checked again.',
    });
  });

  it('derives the same six states independently for the included Entity register', () => {
    expect(entitiesRegisterTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(entitiesRegisterTruthOf(facts({ data: { entities: [entity] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(entitiesRegisterTruthOf(facts({ data: { entities: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(entitiesRegisterTruthOf(facts({ included: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'ENTITIES_NOT_INCLUDED',
    });
    expect(entitiesRegisterTruthOf(facts({ error: new Error('entities unavailable') }))).toEqual({
      kind: 'fetch-failed',
      message: 'entities unavailable',
    });
    expect(entitiesRegisterTruthOf(facts({ data: { entities: [entity] }, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The Entity register is being checked again.',
    });
  });

  it('keeps the selected Team membership register independent too', () => {
    expect(teamRosterTruthOf(facts({ data: { members: [member] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(teamRosterTruthOf(facts({ data: { members: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(teamRosterTruthOf(facts({ data: { members: [member] }, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The selected Team membership register is being checked again.',
    });
  });

  it.each([401, 403])('redacts cached Teams and Entities after authoritative HTTP %s', (status) => {
    const error = new ApiError(status, 'STRUCTURE_REFUSED', 'The register was refused.');
    expect(teamsRegisterTruthOf(facts({ data: { teams: [team] }, error, isFetching: true }))).toEqual({
      kind: 'denied',
      reasonClass: 'STRUCTURE_REFUSED',
    });
    expect(entitiesRegisterTruthOf(facts({ data: { entities: [entity] }, error, isFetching: true }))).toEqual({
      kind: 'denied',
      reasonClass: 'STRUCTURE_REFUSED',
    });
  });

  it('withholds a cached roster after an authoritative selected-Team 404', () => {
    expect(
      teamRosterTruthOf(
        facts({
          data: { members: [member] },
          error: new ApiError(404, 'TEAM_NOT_FOUND', 'Missing Team.'),
        }),
      ),
    ).toEqual({
      kind: 'fetch-failed',
      message: 'The selected Team no longer resolves, so its prior membership view has been withheld.',
    });
  });

  it('never upgrades cached emptiness during a background recheck', () => {
    expect(teamsRegisterTruthOf(facts({ data: { teams: [] }, isFetching: true })).kind).toBe('stale');
    expect(entitiesRegisterTruthOf(facts({ data: { entities: [] }, isFetching: true })).kind).toBe('stale');
    expect(teamRosterTruthOf(facts({ data: { members: [] }, isFetching: true })).kind).toBe('stale');
  });
});

describe('Organization Continuity aggregate witness', () => {
  const at = (value: string) => new Date(value);
  const teamsVerified = { kind: 'verified' as const, at: at('2026-08-06T12:00:00.000Z') };
  const entitiesVerified = { kind: 'verified' as const, at: at('2026-08-06T12:10:00.000Z') };

  it('uses symmetric denied > failed > loading > stale > complete precedence', () => {
    expect(
      joinOrganizationContinuityTruth({
        teams: { kind: 'fetch-failed', message: 'teams offline' },
        entities: { kind: 'denied', reasonClass: 'ENTITIES_DENIED' },
        entitiesIncluded: true,
      }),
    ).toEqual({ kind: 'denied', reasonClass: 'entities:ENTITIES_DENIED' });
    expect(
      joinOrganizationContinuityTruth({
        teams: { kind: 'loading' },
        entities: { kind: 'fetch-failed', message: 'entities offline' },
        entitiesIncluded: true,
      }),
    ).toEqual({ kind: 'fetch-failed', message: 'entities: entities offline' });
    expect(
      joinOrganizationContinuityTruth({
        teams: { kind: 'stale', verifiedAt: at('2026-08-06T11:50:00.000Z'), message: 'teams stale' },
        entities: { kind: 'loading' },
        entitiesIncluded: true,
      }),
    ).toEqual({ kind: 'loading' });
    expect(
      joinOrganizationContinuityTruth({
        teams: { kind: 'stale', verifiedAt: at('2026-08-06T11:50:00.000Z'), message: 'teams stale' },
        entities: { kind: 'stale', verifiedAt: at('2026-08-06T11:55:00.000Z'), message: 'entities stale' },
        entitiesIncluded: true,
      }),
    ).toEqual({
      kind: 'stale',
      verifiedAt: at('2026-08-06T11:50:00.000Z'),
      message: 'teams and entities are stale; organization structure may be incomplete.',
    });
  });

  it('includes a selected roster in window truth without merging its facts', () => {
    expect(
      joinOrganizationContinuityTruth({
        teams: teamsVerified,
        entities: entitiesVerified,
        entitiesIncluded: true,
        roster: { kind: 'loading' },
      }),
    ).toEqual({ kind: 'loading' });
    expect(
      joinOrganizationContinuityTruth({
        teams: teamsVerified,
        entities: entitiesVerified,
        entitiesIncluded: true,
        roster: { kind: 'denied', reasonClass: 'ROSTER_DENIED' },
      }),
    ).toEqual({ kind: 'denied', reasonClass: 'team-roster:ROSTER_DENIED' });
  });

  it('omits an unexposed Entity source instead of calling it denied or empty', () => {
    expect(
      joinOrganizationContinuityTruth({
        teams: teamsVerified,
        entities: { kind: 'denied', reasonClass: 'ENTITIES_NOT_INCLUDED' },
        entitiesIncluded: false,
      }),
    ).toEqual(teamsVerified);
  });

  it('uses the oldest complete witness and earns empty only when every included source is empty', () => {
    expect(
      joinOrganizationContinuityTruth({
        teams: teamsVerified,
        entities: entitiesVerified,
        entitiesIncluded: true,
      }),
    ).toEqual({ kind: 'verified', at: at('2026-08-06T12:00:00.000Z') });
    expect(
      joinOrganizationContinuityTruth({
        teams: { kind: 'proven-empty', at: at('2026-08-06T12:00:00.000Z') },
        entities: { kind: 'proven-empty', at: at('2026-08-06T12:10:00.000Z') },
        entitiesIncluded: true,
      }),
    ).toEqual({ kind: 'proven-empty', at: at('2026-08-06T12:00:00.000Z') });
    expect(
      joinOrganizationContinuityTruth({
        teams: teamsVerified,
        entities: { kind: 'proven-empty', at: at('2026-08-06T12:10:00.000Z') },
        entitiesIncluded: true,
      }).kind,
    ).toBe('verified');
  });
});

describe('Organization Continuity deterministic presentation', () => {
  it('sorts active records before inactive records and then by name', () => {
    const teams = [
      { teamId: 'TEAM-0003', name: 'Zulu', isActive: false },
      { teamId: 'TEAM-0002', name: 'Bravo', isActive: true },
      { teamId: 'TEAM-0001', name: 'Alpha', isActive: true },
    ] as TeamDto[];
    const entities = [
      { entityId: 'ENT-0002', name: 'Zulu Legal', isActive: false },
      { entityId: 'ENT-0001', name: 'Alpha Legal', isActive: true },
    ] as EntityDto[];
    const members = [
      { teamId: 'TEAM-0001', personId: 'PER-0002', personName: 'Zulu', isActive: false },
      { teamId: 'TEAM-0001', personId: 'PER-0001', personName: 'Alpha', isActive: true },
    ] as TeamMembershipDto[];

    expect(sortTeamsForContinuity(teams).map((row) => row.teamId)).toEqual(['TEAM-0001', 'TEAM-0002', 'TEAM-0003']);
    expect(sortEntitiesForContinuity(entities).map((row) => row.entityId)).toEqual(['ENT-0001', 'ENT-0002']);
    expect(sortTeamRosterForContinuity(members).map((row) => row.personId)).toEqual(['PER-0001', 'PER-0002']);
  });

  it('allows standalone structural writes only on a current successful witness', () => {
    const verified = { kind: 'verified' as const, at: new Date(witnessedAt) };
    expect(organizationRegisterActionsAvailable(true, verified)).toBe(true);
    expect(organizationRegisterActionsAvailable(true, { kind: 'proven-empty', at: new Date(witnessedAt) })).toBe(true);
    expect(organizationRegisterActionsAvailable(true, { kind: 'stale', verifiedAt: new Date(witnessedAt), message: 'rechecking' })).toBe(false);
    expect(organizationRegisterActionsAvailable(true, { kind: 'denied', reasonClass: 'DENIED' })).toBe(false);
    expect(organizationRegisterActionsAvailable(false, verified)).toBe(false);
  });
});
