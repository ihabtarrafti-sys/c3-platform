/**
 * Slice 03 · FIRST DAY
 *
 * "No missions" is a product claim, so it needs the same witness discipline as
 * every other Atlas truth. React Query keeps prior data while it revalidates;
 * an empty cached array therefore cannot open onboarding or call the world
 * unstarted until the current read succeeds.
 */

export type MissionStartState = 'checking' | 'unavailable' | 'unstarted' | 'started';

export interface MissionListWitness {
  readonly data: { readonly missions: readonly unknown[] } | undefined;
  readonly isFetching: boolean;
  readonly isPaused: boolean;
  readonly isError: boolean;
}

export function missionStartStateOf(witness: MissionListWitness): MissionStartState {
  if (witness.isError) return 'unavailable';
  if (witness.isPaused || witness.isFetching || witness.data === undefined) return 'checking';
  return witness.data.missions.length === 0 ? 'unstarted' : 'started';
}

export const FIRST_MISSION_LAUNCH_PATH = '/missions?start=first-mission';

/** A closed request: one exact key, one exact value, and no widened context. */
export function firstMissionLaunchRequested(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return [...params.keys()].length === 1 && params.getAll('start').length === 1 && params.get('start') === 'first-mission';
}

export type MissionDrawerOrigin = 'register' | 'first-day';

/** Ordinary register creation deliberately stays put; only First Day crosses into Command. */
export function missionCreationDestination(origin: MissionDrawerOrigin | null, missionId: string): string | null {
  return origin === 'first-day' ? `/missions/${encodeURIComponent(missionId)}/comms` : null;
}
