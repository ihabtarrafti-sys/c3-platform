import type { ApparelProfile, UpsertApparelProfileInput } from '@c3/types';
import type { IApparelProfileService } from '../interfaces/IApparelProfileService';
import { validateUpsertApparelProfileInput } from '@c3/utils/kitLifecycle';

/**
 * Mock apparel profile data — Sprint 28 (S28-2).
 *
 * Seeds mirror the C3PersonApparelProfiles SP sample rows exactly
 * (schema doc §9) so hosted validation compares 1:1 against mock behaviour:
 *
 *   PER-0001 — L / ABDULAZIZ
 *   PER-0002 — M / ALKHALAILAH
 *   PER-0004 — deliberately NO profile: exercises the truthful missing state
 *              ("No apparel profile on file.") on PersonProfile.
 */
const MOCK_APPAREL_PROFILES: ApparelProfile[] = [
  {
    PersonID:     'PER-0001',
    JerseySize:   'L',
    NameOnJersey: 'ABDULAZIZ',
    Notes:        'Prefers athletic fit.',
  },
  {
    PersonID:     'PER-0002',
    JerseySize:   'M',
    NameOnJersey: 'ALKHALAILAH',
  },
];

// Mutable store (S29A) — mock upserts mutate this; resets on reload.
let profileStore: ApparelProfile[] = [...MOCK_APPAREL_PROFILES];

export const createMockApparelProfileService = (): IApparelProfileService => ({
  async getApparelProfile(personId: string): Promise<ApparelProfile | null> {
    return profileStore.find(p => p.PersonID === personId) ?? null;
  },

  async listApparelProfiles(): Promise<ApparelProfile[]> {
    return [...profileStore];
  },

  // S29A role-gated upsert — create when absent, update the active profile otherwise.
  async upsertApparelProfile(input: UpsertApparelProfileInput): Promise<ApparelProfile> {
    const errors = validateUpsertApparelProfileInput(input);
    if (errors.length > 0) throw new Error(`[MockApparelProfileService] ${errors.join(' ')}`);

    const next: ApparelProfile = {
      PersonID:     input.PersonID,
      JerseySize:   input.JerseySize,
      NameOnJersey: input.NameOnJersey?.trim() || undefined,
      Notes:        input.Notes?.trim() || undefined,
    };

    const idx = profileStore.findIndex(p => p.PersonID === input.PersonID);
    profileStore = idx === -1
      ? [...profileStore, next]
      : profileStore.map((p, i) => (i === idx ? next : p));
    return next;
  },
});
