import { useActiveJourney } from '@c3/hooks/useActiveJourney';

/**
 * Returns the active Onboarding Journey for a Person, or null if none exists.
 *
 * Convenience wrapper over useActiveJourney with type fixed to 'Onboarding'.
 * Preserved for backward compatibility; prefer useActiveJourney for new usage.
 */
export const useOnboardingJourney = (personId: string) =>
  useActiveJourney(personId, 'Onboarding');
