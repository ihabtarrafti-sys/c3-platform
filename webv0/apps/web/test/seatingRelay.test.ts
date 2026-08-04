import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type MeResponse } from '../src/api';
import { SeatRelay } from '../src/pages/EntraSignIn';
import { readMembershipOnce, type MembershipRelayState } from '../src/session';

const me = {
  identity: 'new.member@example.com',
  displayName: 'New Member',
  role: 'operations',
  tenantSlug: 'geekay',
  userId: '11111111-1111-4111-8111-111111111111',
  capabilities: {},
} as unknown as MeResponse;

function markup(state: MembershipRelayState) {
  return renderToStaticMarkup(
    createElement(SeatRelay, {
      identity: 'new.member@example.com',
      state,
      onCheck: () => {},
      onEnter: () => {},
      onSignOut: () => {},
    }),
  );
}

describe('D-022 waiting-person membership resolution', () => {
  it('classifies every authoritative answer without collapsing ambiguity or failure into not-seated', async () => {
    await expect(readMembershipOnce(vi.fn(async () => me))).resolves.toEqual({ kind: 'confirmed', me });
    await expect(
      readMembershipOnce(vi.fn(async () => Promise.reject(new ApiError(403, 'ACCESS_NOT_PROVISIONED', 'No membership.')))),
    ).resolves.toEqual({ kind: 'not_seated' });
    await expect(
      readMembershipOnce(vi.fn(async () => Promise.reject(new ApiError(403, 'MEMBERSHIP_AMBIGUOUS', 'Two memberships.')))),
    ).resolves.toEqual({ kind: 'ambiguous' });
    await expect(
      readMembershipOnce(vi.fn(async () => Promise.reject(new ApiError(503, 'UNAVAILABLE', 'Register unavailable.')))),
    ).resolves.toEqual({ kind: 'verification_failed', message: 'Register unavailable.' });
  });

  it('performs exactly one read and keeps a 401 distinct from every membership-register state', async () => {
    const rejected = vi.fn(async () => Promise.reject(new ApiError(401, 'UNAUTHENTICATED', 'Token rejected.')));
    await expect(readMembershipOnce(rejected)).resolves.toEqual({ kind: 'session_rejected', message: 'Token rejected.' });
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ kind: 'checking' } as const, 'seat-state-checking'],
    [{ kind: 'not_seated' } as const, 'seat-state-not-seated'],
    [{ kind: 'verification_failed', message: 'Register unavailable.' } as const, 'seat-state-verification-failed'],
    [{ kind: 'ambiguous' } as const, 'seat-state-ambiguous'],
    [{ kind: 'confirmed', me } as const, 'seat-state-confirmed'],
  ])('renders %s as its own named relay surface', (state, testId) => {
    expect(markup(state)).toContain(`data-testid="${testId}"`);
  });

  it('offers a one-shot recheck only while the gate is closed', () => {
    expect(markup({ kind: 'not_seated' })).toContain('data-testid="seat-check"');
    expect(markup({ kind: 'verification_failed', message: 'Register unavailable.' })).toContain('data-testid="seat-check"');
    expect(markup({ kind: 'ambiguous' })).toContain('data-testid="seat-check"');
    expect(markup({ kind: 'confirmed', me })).not.toContain('data-testid="seat-check"');
  });

  it('requires a deliberate handoff after confirmation and keeps product entry off every other state', () => {
    const confirmed = markup({ kind: 'confirmed', me });
    expect(confirmed).toContain('data-testid="seat-enter"');
    expect(confirmed).toContain('The page you asked for');
    expect(markup({ kind: 'not_seated' })).not.toContain('data-testid="seat-enter"');
    expect(markup({ kind: 'verification_failed', message: 'Register unavailable.' })).not.toContain('data-testid="seat-enter"');
    expect(markup({ kind: 'ambiguous' })).not.toContain('data-testid="seat-enter"');
  });
});
