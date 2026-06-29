/**
 * SharePointCredentialService.ts
 *
 * Sprint 15 (S15-3) — SharePoint Credential Integration.
 *
 * Fetches Credential records from the C3Credentials SharePoint list using
 * the native Fetch API. All type-coercion and validation is delegated to
 * spCredentialMapper.ts — this service stays thin.
 *
 * Design principles:
 *   - No PnP.js. Native fetch with Accept: application/json;odata=nometadata.
 *   - credentials: 'same-origin' — relies on the SPFx authentication cookie.
 *   - Fails safely on any error: console.error + empty array/null, never throws.
 *   - addCredential and deactivateCredential are stubs (out of scope for S15).
 *   - listAllCredentials:      $filter=IsActive eq 1, $top=2000
 *   - listCredentialsForPerson: $filter=IsActive eq 1 and HolderPersonID eq '...', $top=2000
 *   - getCredential:            $filter=Title eq '...', $top=1 (no IsActive guard)
 *
 * OData single-quote escaping: personId / credentialId values are sanitised
 * by doubling any embedded single-quote before interpolation into the filter.
 *
 * See: docs/architecture/C3Credentials SP List Schema.md
 * See: Sprint 15 Proposal §1 (list schema), §6 (HolderPersonID plain text), §8 (logging)
 */

import type { Credential, CreateCredentialInput } from '@c3/types';
import type { ICredentialService } from '../interfaces/ICredentialService';
import {
  mapSpItemsToCredentials,
  mapSpItemToCredential,
} from '@c3/utils/spCredentialMapper';
import type { SpCredentialItem } from '@c3/utils/spCredentialMapper';

// ---------------------------------------------------------------------------
// SP REST query constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3Credentials';

const SELECT_FIELDS = [
  'ID',
  'Title',
  'HolderPersonID',
  'CredentialType',
  'ReferenceNumber',
  'IssuedBy',
  'IssuedDate',
  'ExpiryDate',
  'ValidFromDate',
  'SubType',
  'Notes',
  'IsActive',
  'SupersedesCredentialID',
].join(',');

const PAGE_SIZE = 2000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

/** Escape embedded single-quotes for OData $filter string literals. */
function escOData(val: string): string {
  return val.replace(/'/g, "''");
}

interface SpListResponse {
  value: SpCredentialItem[];
}

/**
 * Fetch SP list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchItems(url: string): Promise<SpCredentialItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/Credential] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    console.error(
      `[C3/Credential] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
      `for list query. Returning empty credential list.`,
    );
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error('[C3/Credential] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/Credential] SharePoint response is missing the "value" array. ' +
      'Response shape is unexpected — check list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointCredentialService = (siteUrl: string): ICredentialService => {
  const baseUrl = buildListUrl(siteUrl);

  return {
    // ── listAllCredentials ──────────────────────────────────────────────────
    async listAllCredentials(): Promise<Credential[]> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=IsActive eq 1` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { credentials } = mapSpItemsToCredentials(items);
      return credentials;
    },

    // ── listCredentialsForPerson ────────────────────────────────────────────
    async listCredentialsForPerson(personId: string): Promise<Credential[]> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=IsActive eq 1 and HolderPersonID eq '${escOData(personId)}'` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { credentials } = mapSpItemsToCredentials(items);
      return credentials;
    },

    // ── getCredential ───────────────────────────────────────────────────────
    // Uses Title (= CredentialID) as the lookup key. No IsActive guard —
    // the caller may need to retrieve a superseded credential for audit.
    async getCredential(credentialId: string): Promise<Credential> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=Title eq '${escOData(credentialId)}'` +
        `&$top=1`;

      const items = await fetchItems(url);

      if (items.length === 0) {
        console.warn(
          `[C3/Credential] getCredential: no SP record found for CredentialID "${credentialId}".`,
        );
        return null as unknown as Credential;
      }

      const warnRef = { count: 0 };
      const mapped = mapSpItemToCredential(items[0], warnRef);

      if (mapped === null) {
        // Hard reject: missing HolderPersonID on a direct-lookup record is unusual.
        console.error(
          `[C3/Credential] getCredential: SP record for "${credentialId}" was rejected ` +
          `by the mapper (missing HolderPersonID). ` +
          `This record is in the list but cannot be attributed to a Person.`,
        );
        return null as unknown as Credential;
      }

      return mapped;
    },

    // ── addCredential (stub) ────────────────────────────────────────────────
    // Write operations are out of scope for Sprint 15.
    async addCredential(_input: CreateCredentialInput): Promise<Credential> {
      console.warn(
        '[C3/Credential] addCredential: write operations are not implemented in S15. ' +
        'The mock service remains the authoritative path for credential creation.',
      );
      return null as unknown as Credential;
    },

    // ── deactivateCredential (stub) ─────────────────────────────────────────
    async deactivateCredential(_credentialId: string): Promise<void> {
      console.warn(
        '[C3/Credential] deactivateCredential: write operations are not implemented in S15.',
      );
    },
  };
};
