/**
 * journey.test.ts — Sprint 37 J1 evidence: the Journeys domain contracts.
 * The state machine is the heart of this file: every legal transition, every
 * illegal one, terminal absorption, and the closing set. Plus the governed
 * initiate contract with the shared date discipline.
 */
import { describe, it, expect } from 'vitest';
import {
  OPERATION_TYPES,
  AUDIT_ACTIONS,
  JOURNEY_STATUSES,
  JOURNEY_TRANSITIONS,
  canTransitionJourney,
  nextJourneyStatus,
  journeyTransitionsFrom,
  isJourneyTerminal,
  JOURNEY_CLOSING_TRANSITIONS,
  initiateJourneyInputSchema,
  parseApprovalPayload,
  formatJourneyId,
  isJourneyId,
} from '../src/index';

describe('registries (Sprint 37)', () => {
  it('registers InitiateJourney, the JRN id kind, and the five audit actions', () => {
    expect(OPERATION_TYPES).toContain('InitiateJourney');
    expect(formatJourneyId(21)).toBe('JRN-0021');
    expect(isJourneyId('JRN-0021')).toBe(true);
    expect(isJourneyId('JOUR-1')).toBe(false);
    for (const a of ['JourneyInitiated', 'JourneySuspended', 'JourneyResumed', 'JourneyCompleted', 'JourneyCancelled']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
  });
});

describe('the lifecycle state machine (CP parity)', () => {
  it('enumerates exactly the legal transitions from each status', () => {
    expect(journeyTransitionsFrom('Active').sort()).toEqual(['cancel', 'complete', 'suspend']);
    expect(journeyTransitionsFrom('Suspended').sort()).toEqual(['cancel', 'complete', 'resume']);
    expect(journeyTransitionsFrom('Completed')).toEqual([]);
    expect(journeyTransitionsFrom('Cancelled')).toEqual([]);
  });

  it('maps every legal transition to its target status', () => {
    expect(nextJourneyStatus('suspend', 'Active')).toBe('Suspended');
    expect(nextJourneyStatus('resume', 'Suspended')).toBe('Active');
    expect(nextJourneyStatus('complete', 'Active')).toBe('Completed');
    expect(nextJourneyStatus('complete', 'Suspended')).toBe('Completed');
    expect(nextJourneyStatus('cancel', 'Active')).toBe('Cancelled');
    expect(nextJourneyStatus('cancel', 'Suspended')).toBe('Cancelled');
  });

  it('refuses every illegal transition (null, never a throw)', () => {
    expect(nextJourneyStatus('resume', 'Active')).toBeNull(); // not suspended
    expect(nextJourneyStatus('suspend', 'Suspended')).toBeNull(); // already suspended
    for (const terminal of ['Completed', 'Cancelled'] as const) {
      for (const t of JOURNEY_TRANSITIONS) {
        expect(canTransitionJourney(t, terminal)).toBe(false); // terminal absorbs
      }
    }
  });

  it('declares the terminal and closing sets coherently', () => {
    expect(isJourneyTerminal('Completed')).toBe(true);
    expect(isJourneyTerminal('Cancelled')).toBe(true);
    expect(isJourneyTerminal('Active')).toBe(false);
    expect(JOURNEY_CLOSING_TRANSITIONS.every((t) => ['Completed', 'Cancelled'].includes(nextJourneyStatus(t, 'Active')!))).toBe(true);
    expect(JOURNEY_STATUSES).toHaveLength(4);
  });
});

describe('initiateJourneyInputSchema', () => {
  const valid = { personId: 'PER-0001', journeyType: '  Pro Contract Onboarding ', startedOn: '2026-07-01' };

  it('parses and normalises; the shared date discipline applies', () => {
    const p = initiateJourneyInputSchema.parse(valid);
    expect(p.journeyType).toBe('Pro Contract Onboarding');
    expect(p.startedOn).toBe('2026-07-01');
    expect(p.title).toBeNull();
    expect(() => initiateJourneyInputSchema.parse({ ...valid, startedOn: '2026-02-30' })).toThrow(/real calendar/i);
    expect(() => initiateJourneyInputSchema.parse({ ...valid, startedOn: '01/07/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => initiateJourneyInputSchema.parse({ ...valid, personId: 'p1' })).toThrow(/PER id/);
    expect(() => initiateJourneyInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });

  it('the payload union discriminates InitiateJourney; siblings regress clean', () => {
    const p = parseApprovalPayload({ operationType: 'InitiateJourney', input: valid });
    expect(p.operationType).toBe('InitiateJourney');
    expect(() => parseApprovalPayload({ operationType: 'InitiateJourney', input: { fullName: 'nope' } })).toThrow();
    expect(parseApprovalPayload({ operationType: 'AddPerson', input: { fullName: 'Still Works' } }).operationType).toBe('AddPerson');
    expect(
      parseApprovalPayload({
        operationType: 'AddCredential',
        input: { personId: 'PER-0001', credentialType: 'License', issuedOn: '2026-01-02' },
      }).operationType,
    ).toBe('AddCredential');
  });
});
