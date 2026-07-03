import type { ApparelProfile } from '@c3/types';
import type { IApparelProfileService } from '../interfaces/IApparelProfileService';

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

export const createMockApparelProfileService = (): IApparelProfileService => ({
  async getApparelProfile(personId: string): Promise<ApparelProfile | null> {
    return MOCK_APPAREL_PROFILES.find(p => p.PersonID === personId) ?? null;
  },

  async listApparelProfiles(): Promise<ApparelProfile[]> {
    return [...MOCK_APPAREL_PROFILES];
  },
});
