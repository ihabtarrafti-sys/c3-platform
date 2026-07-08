/**
 * mission.test.ts — Sprint 39 M1 evidence: the Missions domain contracts.
 * The capstone composes both mutation patterns: a direct-audited shell (MSN
 * ids, create/update schemas, canManageMissions) and governed participant
 * membership (two new operation types, the ParticipantConflictError
 * vocabulary the submit- and execute-time guards will speak in M2).
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS,
  OPERATION_TYPES,
  ParticipantConflictError,
  addMissionParticipantInputSchema,
  approvalPayloadSchema,
  capabilitiesFor,
  C3_ROLES,
  formatMissionId,
  isMissionId,
  missionCreateInputSchema,
  missionUpdateInputSchema,
  removeMissionParticipantInputSchema,
} from '../src/index';

describe('registries (Sprint 39)', () => {
  it('registers the MSN id kind, five audit actions, and the two GOVERNED participant operations', () => {
    expect(formatMissionId(3)).toBe('MSN-0003');
    expect(isMissionId('MSN-0003')).toBe(true);
    expect(isMissionId('MIS-0003')).toBe(false);
    for (const a of ['MissionCreated', 'MissionUpdated', 'MissionDeactivated', 'MissionParticipantAdded', 'MissionParticipantRemoved']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
    // The split: participant membership is governed; the shell never enters
    // the pipeline (no CreateMission/UpdateMission operation types).
    expect(OPERATION_TYPES).toContain('AddMissionParticipant');
    expect(OPERATION_TYPES).toContain('RemoveMissionParticipant');
    expect(OPERATION_TYPES.some((op) => /^(Create|Update|Deactivate)Mission$/.test(op))).toBe(false);
  });
});

describe('missionCreateInputSchema', () => {
  const valid = { name: '  Spring Invitational ', startsOn: '2026-08-01' };

  it('parses and normalises; optional fields default null', () => {
    const p = missionCreateInputSchema.parse(valid);
    expect(p.name).toBe('Spring Invitational');
    expect(p.gameTitle).toBeNull();
    expect(p.endsOn).toBeNull();
    expect(p.notes).toBeNull();
  });

  it('enforces date coherence: same-day legal, end-before-start refused', () => {
    expect(missionCreateInputSchema.parse({ ...valid, endsOn: '2026-08-01' }).endsOn).toBe('2026-08-01');
    expect(missionCreateInputSchema.parse({ ...valid, endsOn: '2026-08-15' }).endsOn).toBe('2026-08-15');
    expect(() => missionCreateInputSchema.parse({ ...valid, endsOn: '2026-07-31' })).toThrow(/on or after/);
  });

  it('refuses junk: empty name, impossible dates, unknown keys', () => {
    expect(() => missionCreateInputSchema.parse({ name: '', startsOn: '2026-08-01' })).toThrow(/Name is required/);
    expect(() => missionCreateInputSchema.parse({ ...valid, startsOn: '2026-02-30' })).toThrow();
    expect(() => missionCreateInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });
});

describe('missionUpdateInputSchema (the ETag-parity patch)', () => {
  it('requires the expected version and at least one editable field', () => {
    const p = missionUpdateInputSchema.parse({ expectedVersion: 1, name: 'Renamed' });
    expect(p.name).toBe('Renamed');
    expect(() => missionUpdateInputSchema.parse({ expectedVersion: 1 })).toThrow(/at least one field/);
    expect(() => missionUpdateInputSchema.parse({ name: 'No version' })).toThrow();
  });

  it('supports clearing the planned end (explicit null) distinct from omission', () => {
    const p = missionUpdateInputSchema.parse({ expectedVersion: 2, endsOn: null });
    expect(p.endsOn).toBeNull();
    expect('endsOn' in p).toBe(true);
    const q = missionUpdateInputSchema.parse({ expectedVersion: 2, name: 'X' });
    expect('endsOn' in q).toBe(false);
  });

  it('validates date coherence when the patch carries both dates', () => {
    expect(() => missionUpdateInputSchema.parse({ expectedVersion: 1, startsOn: '2026-08-10', endsOn: '2026-08-01' })).toThrow(
      /on or after/,
    );
    // One-sided patches pass the boundary; final coherence is the use-case's
    // and the DB CHECK's job (the boundary cannot see stored state).
    expect(missionUpdateInputSchema.parse({ expectedVersion: 1, endsOn: '2026-08-01' }).endsOn).toBe('2026-08-01');
  });
});

describe('governed participant contracts', () => {
  it('accepts canonical ids and a role; refuses junk and unknown keys', () => {
    const p = addMissionParticipantInputSchema.parse({ missionId: 'MSN-0001', personId: 'PER-0002', role: '  Player ' });
    expect(p.role).toBe('Player');
    expect(() => addMissionParticipantInputSchema.parse({ missionId: 'mission-1', personId: 'PER-0002', role: 'Player' })).toThrow(/MSN id/);
    expect(() => addMissionParticipantInputSchema.parse({ missionId: 'MSN-0001', personId: 'PER-0002', role: '' })).toThrow(/role is required/);
    expect(removeMissionParticipantInputSchema.parse({ missionId: 'MSN-0001', personId: 'PER-0002' })).toEqual({
      missionId: 'MSN-0001',
      personId: 'PER-0002',
    });
    expect(() => removeMissionParticipantInputSchema.parse({ missionId: 'MSN-0001', personId: 'PER-0002', role: 'Player' })).toThrow();
  });

  it('round-trips both payloads through the approval payload union', () => {
    const add = approvalPayloadSchema.parse({
      operationType: 'AddMissionParticipant',
      input: { missionId: 'MSN-0001', personId: 'PER-0002', role: 'Coach' },
    });
    expect(add.operationType).toBe('AddMissionParticipant');
    const remove = approvalPayloadSchema.parse({
      operationType: 'RemoveMissionParticipant',
      input: { missionId: 'MSN-0001', personId: 'PER-0002' },
    });
    expect(remove.operationType).toBe('RemoveMissionParticipant');
  });
});

describe('ParticipantConflictError (the guard vocabulary)', () => {
  it('speaks both refusal kinds with a stable code and structured details', () => {
    const pending = new ParticipantConflictError('MSN-0001', 'PER-0002', 'pending-approval');
    expect(pending.code).toBe('PARTICIPANT_CONFLICT');
    expect(pending.message).toMatch(/open approval already exists/);
    const active = new ParticipantConflictError('MSN-0001', 'PER-0002', 'active-participant');
    expect(active.message).toMatch(/already an active participant/);
    expect(active.details).toEqual({ missionId: 'MSN-0001', personId: 'PER-0002', conflict: 'active-participant' });
  });
});

describe('canManageMissions (the deliberate CP Set-C grant)', () => {
  it('owner and operations manage the mission shell; every other role does not', () => {
    for (const role of ['owner', 'operations'] as const) {
      expect(capabilitiesFor(role).canManageMissions).toBe(true);
    }
    for (const role of ['legal', 'finance', 'hr', 'management', 'visitor'] as const) {
      expect(capabilitiesFor(role).canManageMissions).toBe(false);
    }
    for (const role of C3_ROLES) {
      expect(typeof capabilitiesFor(role).canManageMissions).toBe('boolean');
    }
  });
});
