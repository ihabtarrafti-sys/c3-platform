/**
 * SharePointApparelProfileService.ts
 *
 * Sprint 28 (S28-2) — Apparel Profile read foundation.
 *
 * Read methods implemented:
 *   - getApparelProfile(personId) — active profile or null
 *   - listApparelProfiles()       — all active profiles
 *
 * Design follows the S15–S27 native-fetch service pattern:
 *   - No @pnp/sp. credentials: 'same-origin'. odata=nometadata.
 *   - Read-only in Sprint 28. No request digest required.
 *   - Fails safely: 404 (list not provisioned) and network/parse errors
 *     return null / [] — a missing profile is a normal state, never an error.
 *   - All type-coercion / validation delegated to spApparelProfileMapper.
 *   - Rows with explicit IsActive === false are excluded from reads but
 *     retained in SP for history (no lifecycle UI exists).
 *   - One active profile per person is the schema rule; if duplicates exist
 *     the first active row wins and a warning is logged (data cleanup is an
 *     operator action, not code).
 *
 * See: docs/architecture/C3PersonApparelProfiles SP List Schema.md
 */

import type { ApparelProfile } from '@c3/types';
import type { IApparelProfileService } from '../interfaces/IApparelProfileService';
import { mapSpItemsToApparelProfiles } from '@c3/utils/spApparelProfileMapper';
import type { SpApparelProfileItem } from '@c3/utils/spApparelProfileMapper';
import { encodeODataLiteral } from './SharePointMissionService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3PersonApparelProfiles';
const PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

interface SpListResponse {
  value: SpApparelProfileItem[];
}

/**
 * Fetch SP list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchApparelItems(url: string): Promise<SpApparelProfileItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/ApparelProfile] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(
        '[C3/ApparelProfile] C3PersonApparelProfiles list not found (HTTP 404). ' +
        'The list may not be provisioned yet. ' +
        'See docs/architecture/C3PersonApparelProfiles SP List Schema.md for provisioning steps.',
      );
    } else {
      console.error(
        `[C3/ApparelProfile] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
        'for C3PersonApparelProfiles query. Returning empty result.',
      );
    }
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error('[C3/ApparelProfile] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/ApparelProfile] SharePoint response is missing the "value" array. ' +
      'Check C3PersonApparelProfiles list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

/** Map raw items and project active profiles (explicit-false rows excluded). */
function toActiveProfiles(items: SpApparelProfileItem[]): ApparelProfile[] {
  const { records } = mapSpItemsToApparelProfiles(items);
  return records.filter(r => r.isActive).map(r => r.profile);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointApparelProfileService = (
  siteUrl: string,
): IApparelProfileService => {
  const baseUrl = buildListUrl(siteUrl);

  return {
    async getApparelProfile(personId: string): Promise<ApparelProfile | null> {
      const url =
        `${baseUrl}` +
        `?$select=*` +
        `&$filter=PersonID eq '${encodeODataLiteral(personId)}'` +
        `&$top=5`;

      const items = await fetchApparelItems(url);
      const active = toActiveProfiles(items);

      if (active.length > 1) {
        console.warn(
          `[C3/ApparelProfile] ${active.length} active profiles found for ${personId} — ` +
          'expected one per person. Using the first; clean up duplicates in SharePoint.',
        );
      }

      return active[0] ?? null;
    },

    async listApparelProfiles(): Promise<ApparelProfile[]> {
      const url = `${baseUrl}?$select=*&$top=${PAGE_SIZE}`;
      const items = await fetchApparelItems(url);
      return toActiveProfiles(items);
    },
  };
};
