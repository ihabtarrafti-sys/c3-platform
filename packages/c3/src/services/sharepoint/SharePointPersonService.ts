/**
 * SharePointPersonService.ts
 *
 * Sprint 16 (S16-7 prep) — SharePoint Person Integration.
 *
 * Fetches Person records from the C3People SharePoint list using
 * the native Fetch API. All type-coercion and validation is delegated to
 * spPersonMapper.ts — this service stays thin.
 *
 * Design principles:
 *   - No PnP.js. Native fetch with Accept: application/json;odata=nometadata.
 *   - credentials: 'same-origin' — relies on the SPFx authentication cookie.
 *   - Fails safely on any error: console.error + empty array/null, never throws.
 *   - listPersonContracts and listPersonActivities are stubs (out of scope S16).
 *   - listPeople:   $filter=IsActive eq 1, $top=2000
 *   - getPerson:    $filter=Title eq '...', $top=1 (no IsActive guard — caller
 *                   may need to look up an inactive person for audit purposes)
 *
 * CRITICAL — Title column mapping:
 *   In C3People, the SP built-in Title column stores PersonID (e.g. "PER-0001").
 *   FullName is a SEPARATE column. getPerson() filters on Title, not FullName.
 *   See: docs/architecture/C3People SP List Schema.md
 *
 * OData single-quote escaping: personId values are sanitised by doubling any
 * embedded single-quote before interpolation into the filter string.
 *
 * See: docs/architecture/C3People SP List Schema.md
 * See: docs/architecture/C3 Architecture Baseline — Sprint 16.md
 */

import type { Activity, Contract, Person } from '@c3/types';
import type { IPersonService } from '../interfaces/IPersonService';
import {
  mapSpItemsToPeople,
  mapSpItemToPerson,
} from '@c3/utils/spPersonMapper';
import type { SpPersonItem } from '@c3/utils/spPersonMapper';

// ---------------------------------------------------------------------------
// SP REST query constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3People';

/**
 * Columns to $select from the C3People list.
 * Must match SpPersonItem field names exactly (SP internal column names).
 * Title = PersonID (repurposed built-in). FullName is a separate column.
 * CurrentTeam, CurrentGameTitle, PrimaryDepartment are plain text — NOT Lookups.
 */
const SELECT_FIELDS = [
  'Id',
  'Title',
  'FullName',
  'IGN',
  'Nationality',
  'PrimaryRole',
  'PersonnelCode',
  'CurrentTeam',
  'CurrentGameTitle',
  'PrimaryDepartment',
  'IsActive',
  'FirstContractDate',
  'LatestContractDate',
  'TotalContracts',
  'Notes',
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
  value: SpPersonItem[];
}

/**
 * Fetch SP list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchItems(url: string): Promise<SpPersonItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/People] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    console.error(
      `[C3/People] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
      `for list query. Returning empty person list.`,
    );
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error('[C3/People] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/People] SharePoint response is missing the "value" array. ' +
      'Response shape is unexpected — check list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointPersonService = (siteUrl: string): IPersonService => {
  const baseUrl = buildListUrl(siteUrl);

  return {
    // ── listPeople ──────────────────────────────────────────────────────────
    // Returns only active persons. Inactive persons are filtered at the SP
    // query level ($filter=IsActive eq 1) so the mapper receives a clean set.
    // The mapper itself is IsActive-agnostic; filtering here is intentional.
    async listPeople(): Promise<Person[]> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=IsActive eq 1` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { people } = mapSpItemsToPeople(items);
      return people;
    },

    // ── getPerson ───────────────────────────────────────────────────────────
    // Looks up a single person by PersonID (stored in the SP Title column).
    // No IsActive guard — callers may need to retrieve inactive persons for
    // audit, journey history, or credential attribution purposes.
    async getPerson(personId: string): Promise<Person> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=Title eq '${escOData(personId)}'` +
        `&$top=1`;

      const items = await fetchItems(url);

      if (items.length === 0) {
        console.warn(
          `[C3/People] getPerson: no SP record found for PersonID "${personId}".`,
        );
        return null as unknown as Person;
      }

      const warnRef = { count: 0 };
      const mapped = mapSpItemToPerson(items[0], warnRef);

      if (mapped === null) {
        // Hard reject (missing Title or FullName) on a direct-lookup is unusual.
        // Most likely a data entry error on the SP list.
        console.error(
          `[C3/People] getPerson: SP record for PersonID "${personId}" was rejected ` +
          `by the mapper (missing PersonID or FullName). ` +
          `Check the C3People list for data entry errors on this record.`,
        );
        return null as unknown as Person;
      }

      return mapped;
    },

    // ── listPersonContracts (stub) ──────────────────────────────────────────
    // Contracts are fetched via SharePointContractService, not via the person
    // service. This stub satisfies the IPersonService interface.
    // Sprint 16 scope: stubs only. Real implementation deferred.
    async listPersonContracts(personId: number): Promise<Contract[]> {
      void personId;
      console.warn(
        '[C3/People] listPersonContracts: not implemented in S16. ' +
        'Use SharePointContractService to query contracts by person.',
      );
      return [];
    },

    // ── listPersonActivities (stub) ─────────────────────────────────────────
    // Activity history is not part of the Sprint 16 data layer scope.
    // Deferred until the C3Activities list schema and service are defined.
    async listPersonActivities(personId: string, limit?: number): Promise<Activity[]> {
      void personId;
      void limit;
      console.warn(
        '[C3/People] listPersonActivities: not implemented in S16. ' +
        'C3Activities list schema and service are deferred to a future sprint.',
      );
      return [];
    },
  };
};
