/**
 * Iris Slice 03 — FIRST DAY.
 *
 * An empty organization is not an all-clear. These tests pin the fail-closed
 * witness, the one-shot launch request, and the narrow create-to-Command path
 * before the surface is implemented.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  firstMissionLaunchRequested,
  missionCreationDestination,
  missionStartStateOf,
} from '../src/firstDay';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (relative: string): string => readFileSync(join(srcDir, relative), 'utf8');

describe('Iris First Day witness', () => {
  it('earns unstarted only from a current successful empty mission witness', () => {
    expect(missionStartStateOf({ data: undefined, isFetching: true, isPaused: false, isError: false })).toBe('checking');
    expect(missionStartStateOf({ data: { missions: [] }, isFetching: true, isPaused: false, isError: false })).toBe('checking');
    expect(missionStartStateOf({ data: { missions: [] }, isFetching: false, isPaused: true, isError: false })).toBe('checking');
    expect(missionStartStateOf({ data: { missions: [] }, isFetching: false, isPaused: false, isError: true })).toBe('unavailable');
    expect(missionStartStateOf({ data: undefined, isFetching: false, isPaused: false, isError: false })).toBe('checking');
    expect(missionStartStateOf({ data: { missions: [] }, isFetching: false, isPaused: false, isError: false })).toBe('unstarted');
    expect(
      missionStartStateOf({
        data: { missions: [{ missionId: 'MSN-0001' }] },
        isFetching: false,
        isPaused: false,
        isError: false,
      }),
    ).toBe('started');
  });

  it('accepts one exact launch request and rejects malformed or widened variants', () => {
    expect(firstMissionLaunchRequested('?start=first-mission')).toBe(true);
    expect(firstMissionLaunchRequested('start=first-mission')).toBe(true);
    expect(firstMissionLaunchRequested('?start=first-mission&start=first-mission')).toBe(false);
    expect(firstMissionLaunchRequested('?start=first-mission&from=home')).toBe(false);
    expect(firstMissionLaunchRequested('?start=first')).toBe(false);
    expect(firstMissionLaunchRequested('?START=first-mission')).toBe(false);
    expect(firstMissionLaunchRequested('')).toBe(false);
  });

  it('opens Command only for the launch-scoped creation result', () => {
    expect(missionCreationDestination('first-day', 'MSN-0042')).toBe('/missions/MSN-0042/comms');
    expect(missionCreationDestination('register', 'MSN-0042')).toBeNull();
  });
});

describe('Iris First Day surface contract', () => {
  it('distinguishes unstarted from all-clear and preserves the check ledger', () => {
    const home = read('pages/HomePage.tsx');
    expect(home).toContain('data-testid="first-day-launch"');
    expect(home).toContain('Nothing is marked clear');
    expect(home).toContain('data-testid="situation-checks"');
    expect(home).toContain("missionState === 'started'");
    expect(home).toContain('data-testid="situation-mission-witness-pending"');
    expect(home).toContain('no all-clear has been issued');
    expect(home).toContain('!isSituationPaused');
  });

  it('opens the existing drawer only for a current empty witness and authorized actor', () => {
    const missions = read('pages/MissionsPage.tsx');
    expect(missions).toContain("missionState === 'unstarted'");
    expect(missions).toContain('canManage');
    expect(missions).toContain("setDrawerOrigin('first-day')");
    expect(missions).toContain("navigate('/missions', { replace: true })");
  });

  it('uses the returned mission id for the launch path while ordinary creation stays in the register', () => {
    const missions = read('pages/MissionsPage.tsx');
    expect(missions).toContain("missionCreationDestination(drawerOrigin, res.mission.missionId)");
    expect(missions).toContain('void qc.invalidateQueries');
  });
});
