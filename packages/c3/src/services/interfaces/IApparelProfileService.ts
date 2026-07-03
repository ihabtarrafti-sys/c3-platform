import type { ApparelProfile } from '@c3/types';

/**
 * IApparelProfileService — Apparel profile domain service interface.
 *
 * Sprint 28 (S28-2) — read-only foundation.
 *
 * Follows the parallel factory pattern (ADR-001): components and hooks call
 * useApparelProfileService(), which returns the mode-appropriate
 * implementation. Apparel attributes are STABLE person data living in the
 * C3PersonApparelProfiles list — deliberately NOT columns on C3People
 * (keeps the frozen Person type and governed AddPerson flow untouched).
 *
 * One active profile per person. A missing profile is a normal state,
 * never an error.
 *
 * Read methods return null / empty rather than throwing on not-found or on
 * a missing list (404-safe). No write methods exist in Sprint 28 — profile
 * edits are a Sprint 29 candidate (governance classification pending).
 */
export interface IApparelProfileService {
  /**
   * Returns the active apparel profile for a person, or null when none
   * exists (or the list is not provisioned).
   */
  getApparelProfile(personId: string): Promise<ApparelProfile | null>;

  /**
   * Returns all active apparel profiles.
   * Returns an empty array on missing list / failure (fail-safe).
   */
  listApparelProfiles(): Promise<ApparelProfile[]>;
}
