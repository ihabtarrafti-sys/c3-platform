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

import type { ApparelProfile, UpsertApparelProfileInput } from '@c3/types';
import type { IApparelProfileService } from '../interfaces/IApparelProfileService';
import {
  ConcurrencyError,
  DataIntegrityError,
  WritePermissionError,
} from '../errors';
import { classifyWriteFailure, validateUpsertApparelProfileInput } from '@c3/utils/kitLifecycle';
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
// S29A write helpers
// ---------------------------------------------------------------------------

const LIST_ITEM_TYPE = 'SP.Data.C3PersonApparelProfilesListItem';

async function fetchFormDigest(siteUrl: string): Promise<string> {
  const response = await fetch(`${siteUrl.replace(/\/$/, '')}/_api/contextinfo`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });
  if (!response.ok) {
    throw new Error(`[C3/ApparelProfile] Failed to fetch form digest: HTTP ${response.status}`);
  }
  return ((await response.json()) as { FormDigestValue: string }).FormDigestValue;
}

/**
 * Resolve the person's active profile row with its ETag (minimalmetadata so
 * items carry `odata.etag`). 0 rows → null (upsert POSTs); 2+ → DataIntegrityError.
 */
async function resolveProfileRow(
  baseUrl: string,
  personId: string,
): Promise<{ id: number; etag: string } | null> {
  const url =
    `${baseUrl}?$select=Id,PersonID,IsActive` +
    `&$filter=PersonID eq '${encodeODataLiteral(personId)}'&$top=2`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=minimalmetadata' },
  });
  if (!response.ok) {
    throw new Error(`[C3/ApparelProfile] Row resolution failed: HTTP ${response.status} for ${personId}`);
  }
  const json = (await response.json()) as {
    value: Array<{ 'odata.etag': string; Id: number; IsActive: boolean | null }>;
  };
  const active = (json.value ?? []).filter(v => v.IsActive !== false);
  if (active.length === 0) return null;
  if (active.length > 1) throw new DataIntegrityError('C3PersonApparelProfiles', personId, active.length);
  return { id: active[0].Id, etag: active[0]['odata.etag'] };
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

    // ── S29A upsert — role-gated master-data update (ADR-013 Addendum) ──────
    // Create when no active profile exists; update the EXACT active row with
    // its actual ETag otherwise (never IF-MATCH:*). SP version history is the
    // authoritative audit — user Notes is never polluted with audit text.
    async upsertApparelProfile(input: UpsertApparelProfileInput): Promise<ApparelProfile> {
      const errors = validateUpsertApparelProfileInput(input);
      if (errors.length > 0) throw new Error(`[C3/ApparelProfile] ${errors.join(' ')}`);

      const next: ApparelProfile = {
        PersonID:     input.PersonID,
        JerseySize:   input.JerseySize,
        NameOnJersey: input.NameOnJersey?.trim() || undefined,
        Notes:        input.Notes?.trim() || undefined,
      };
      const fields = {
        JerseySize:   next.JerseySize ?? null,
        NameOnJersey: next.NameOnJersey ?? null,
        Notes:        next.Notes ?? null,
      };

      const row = await resolveProfileRow(baseUrl, input.PersonID);
      const digest = await fetchFormDigest(siteUrl);

      let response: Response;
      if (row === null) {
        // Create-if-absent. Title = PersonID (display key + unique-constraint
        // race guard: a concurrent create fails here and is translated below).
        response = await fetch(baseUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Accept':          'application/json;odata=nometadata',
            'Content-Type':    'application/json;odata=verbose',
            'X-RequestDigest': digest,
          },
          body: JSON.stringify({
            __metadata: { type: LIST_ITEM_TYPE },
            Title:    input.PersonID,
            PersonID: input.PersonID,
            IsActive: true,
            ...fields,
          }),
        });
      } else {
        response = await fetch(`${baseUrl.replace(/\/items$/, '')}/items(${row.id})`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Accept':          'application/json;odata=nometadata',
            'Content-Type':    'application/json;odata=verbose',
            'X-RequestDigest': digest,
            'X-HTTP-Method':   'MERGE',
            'IF-MATCH':        row.etag,
          },
          body: JSON.stringify({ __metadata: { type: LIST_ITEM_TYPE }, ...fields }),
        });
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '(unreadable)');
        const kind = classifyWriteFailure(response.status, bodyText);
        if (kind === 'concurrency') throw new ConcurrencyError(`apparel profile ${input.PersonID}`);
        if (kind === 'permission') throw new WritePermissionError('C3PersonApparelProfiles');
        if (kind === 'duplicate') {
          throw new ConcurrencyError(
            `apparel profile ${input.PersonID} (created concurrently by another operator)`,
          );
        }
        throw new Error(
          `[C3/ApparelProfile] ${row === null ? 'POST' : 'MERGE'} failed for ${input.PersonID}: ` +
          `HTTP ${response.status} ${response.statusText}. Body: ${bodyText}`,
        );
      }

      console.info(`[C3/ApparelProfile] upserted profile for ${input.PersonID} by ${input.actorLoginName}`);
      return next;
    },
  };
};
