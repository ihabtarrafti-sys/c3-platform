/**
 * SharePointPersonService.ts
 *
 * Sprint 16 (S16-7 prep) -- SharePoint Person Integration.
 *
 * Fetches Person records from the C3People SharePoint list using
 * the native Fetch API. All type-coercion and validation is delegated to
 * spPersonMapper.ts -- this service stays thin.
 *
 * Design principles:
 *   - No PnP.js. Native fetch with Accept: application/json;odata=nometadata.
 *   - credentials: 'same-origin' -- relies on the SPFx authentication cookie.
 *   - Fails safely on any error: console.error + empty array/null, never throws.
 *   - listPersonContracts and listPersonActivities are stubs (out of scope S16).
 *   - listPeople:   $filter=IsActive eq 1, $top=2000
 *   - getPerson:    $filter=Title eq '...', $top=1 (no IsActive guard -- caller
 *                   may need to look up an inactive person for audit purposes)
 *
 * CRITICAL -- Title column mapping:
 *   In C3People, the SP built-in Title column stores PersonID (e.g. "PER-0001").
 *   FullName is a SEPARATE column. getPerson() filters on Title, not FullName.
 *   See: docs/architecture/C3People SP List Schema.md
 *
 * OData single-quote escaping: personId values are sanitised by doubling any
 * embedded single-quote before interpolation into the filter string.
 *
 * See: docs/architecture/C3People SP List Schema.md
 * See: docs/architecture/C3 Architecture Baseline -- Sprint 16.md
 */

import type { Activity, Contract, CreatePersonInput, Person } from '@c3/types';
import type { IPersonService } from '../interfaces/IPersonService';
import {
  mapSpItemsToPeople,
  mapSpItemToPerson,
} from '@c3/utils/spPersonMapper';
import { ContractsListUnprovisionedError, ContractReadFailedError } from '../errors';
import type { SpPersonItem } from '@c3/utils/spPersonMapper';
import { mapContract, type SPContractItem } from '@c3/mappers';

// ---------------------------------------------------------------------------
// SP REST query constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3People';

/**
 * Columns to $select from the C3People list.
 * Must match SpPersonItem field names exactly (SP internal column names).
 * Title = PersonID (repurposed built-in). FullName is a separate column.
 * CurrentTeam, CurrentGameTitle, PrimaryDepartment are plain text -- NOT Lookups.
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
      'Response shape is unexpected -- check list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

// ---------------------------------------------------------------------------
// fetchFormDigest
//
// Fetches a fresh SP Form Digest Value for write operations.
// Never cached -- digest TTL is 30 minutes and staleness causes silent 403s.
// Same implementation as in SharePointApprovalsService.
// ---------------------------------------------------------------------------

function buildContextInfoUrl(url: string): string {
  return `${url.replace(/\/$/, '')}/_api/contextinfo`;
}

async function fetchFormDigest(siteUrl: string): Promise<string> {
  const response = await fetch(buildContextInfoUrl(siteUrl), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });

  if (!response.ok) {
    throw new Error(
      `[C3/People] fetchFormDigest: /_api/contextinfo returned HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as { FormDigestValue?: string };
  if (!json.FormDigestValue) {
    throw new Error('[C3/People] fetchFormDigest: FormDigestValue absent in contextinfo response');
  }

  return json.FormDigestValue;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointPersonService = (siteUrl: string): IPersonService => {
  const baseUrl = buildListUrl(siteUrl);

  return {
    // -- listPeople ----------------------------------------------------------
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

    // -- getPerson -----------------------------------------------------------
    // Looks up a single person by PersonID (stored in the SP Title column).
    // No IsActive guard -- callers may need to retrieve inactive persons for
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

    // -- listPersonContracts -------------------------------------------------
    // Sprint 24 Phase 1: Real implementation. Queries C3Contracts by PersonID.
    // PersonID is the canonical PER-XXXX FK -- not the SP numeric Id.
    // Returns [] gracefully if C3Contracts is not yet provisioned (404).
    async listPersonContracts(personId: string): Promise<Contract[]> {
      if (!personId || personId.trim().length === 0) {
        return [];
      }

      const contractsUrl =
        `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('C3Contracts')/items` +
        `?$select=*` +
        `&$filter=PersonID eq '${escOData(personId)}'` +
        `&$top=500`;

      let response: Response;
      try {
        response = await fetch(contractsUrl, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json;odata=nometadata' },
        });
      } catch (err) {
        // S33 Set E: network failure FAILS CLOSED — never a silent empty domain.
        console.error('[C3/People] listPersonContracts: network error:', err);
        throw new Error(
          '[C3/People] listPersonContracts: network error reading C3Contracts — failing closed.',
        );
      }

      // S33 Set E: a 404 (security-trimmed OR unprovisioned) and any other
      // non-OK status must FAIL CLOSED. The prior "return [] for PersonProfile
      // stability" converted a denied/unavailable read into a false empty
      // contract summary. Role-denial is handled upstream (the query is not
      // issued for a role without contract access), so a 404 reaching here is a
      // genuine provisioning failure for an authorized role.
      if (!response.ok) {
        if (response.status === 404) throw new ContractsListUnprovisionedError();
        throw new ContractReadFailedError(response.status, 'listPersonContracts');
      }

      let json: { value: SPContractItem[] };
      try {
        json = (await response.json()) as { value: SPContractItem[] };
      } catch (err) {
        console.error('[C3/People] listPersonContracts: failed to parse JSON:', err);
        throw new Error('[C3/People] listPersonContracts: malformed C3Contracts response — failing closed.');
      }

      if (!Array.isArray(json.value)) {
        throw new Error('[C3/People] listPersonContracts: unexpected C3Contracts response shape — failing closed.');
      }

      // Authorized empty (200 with no rows) legitimately returns [].
      return json.value.map(mapContract);
    },

    // -- listPersonActivities (stub) -----------------------------------------
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

    // -- createPerson --------------------------------------------------------
    // Sprint 25 -- AddPerson SP DSM execution.
    //
    // POST-then-MERGE pattern (same as SharePointApprovalsService.createApproval):
    //   1. POST to C3People with all input fields.
    //      Title is set to a temporary value ('PENDING-{approvalTitle}' when
    //      supplied, otherwise 'TMP-{timestamp}') so it is traceable to its
    //      originating approval if the MERGE step fails.
    //   2. Read the SP-assigned item ID from the response.
    //   3. MERGE Title (= PersonID) to PER-XXXX using the item ID as the
    //      atomic sequence source -- same pattern as APR-XXXX.
    //   4. Return a mapped Person with the canonical PersonID.
    //
    // Failure modes:
    //   POST fails              -> throw immediately. No row created. Caller stamps ExecutionFailed.
    //   POST ok, MERGE fails    -> throw with SP item ID in message. Orphaned row exists in
    //                             C3People with TMP/PENDING title. Caller stamps ExecutionFailed.
    //                             Operator must fix Title manually or via recovery (TD-24).
    //   GET-back-mapped fails   -> throw. Row and PER-XXXX are valid; stamp failure handled by caller.
    //
    // Duplicate protection: FullName-based check is applied at the useExecuteApproval
    // layer before calling createPerson. This method trusts the caller has checked.
    //
    // Does NOT call createPerson from any UI path directly. Entry is useExecuteApproval only.
    async createPerson(input: CreatePersonInput): Promise<Person> {
      if (!input.FullName || !input.FullName.trim()) {
        throw new Error('[C3/People] createPerson: FullName is required and must not be blank.');
      }

      const digest = await fetchFormDigest(siteUrl);

      // -- Step 1: POST with temporary Title ----------------------------------
      const tmpTitle = 'TMP-' + Date.now().toString(36);

      const postBody = {
        __metadata:        { type: 'SP.Data.C3PeopleListItem' },
        Title:             tmpTitle,
        FullName:          input.FullName.trim(),
        IGN:               input.IGN?.trim()               ?? null,
        Nationality:       input.Nationality?.trim()        ?? null,
        PrimaryRole:       input.PrimaryRole?.trim()        ?? null,
        PersonnelCode:     input.PersonnelCode?.trim()      ?? null,
        CurrentTeam:       input.CurrentTeam?.trim()        ?? null,
        CurrentGameTitle:  input.CurrentGameTitle?.trim()   ?? null,
        PrimaryDepartment: input.PrimaryDepartment?.trim()  ?? null,
        IsActive:          true,
        Notes:             input.Notes?.trim()              ?? null,
      };

      const postResponse = await fetch(baseUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept':          'application/json;odata=nometadata',
          'Content-Type':    'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        body: JSON.stringify(postBody),
      });

      if (!postResponse.ok) {
        const errText = await postResponse.text().catch(() => '(unreadable)');
        throw new Error(
          `[C3/People] createPerson: POST failed (HTTP ${postResponse.status} ${postResponse.statusText}). ` +
          `Body: ${errText}`,
        );
      }

      const created = (await postResponse.json()) as { ID?: number };
      if (typeof created.ID !== 'number') {
        throw new Error(
          `[C3/People] createPerson: POST succeeded but SP did not return an item ID. ` +
          `An orphaned row with Title '${tmpTitle}' may exist in C3People.`,
        );
      }

      const spItemId = created.ID;
      const personId = `PER-${String(spItemId).padStart(4, '0')}`;

      // -- Step 2: MERGE canonical PersonID (Title) ---------------------------
      const mergeDigest = await fetchFormDigest(siteUrl);
      const itemUrl = `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items(${spItemId})`;

      const mergeResponse = await fetch(itemUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept':          'application/json;odata=nometadata',
          'Content-Type':    'application/json;odata=verbose',
          'X-RequestDigest': mergeDigest,
          'X-HTTP-Method':   'MERGE',
          'IF-MATCH':        '*',
        },
        body: JSON.stringify({ __metadata: { type: 'SP.Data.C3PeopleListItem' }, Title: personId }),
      });

      if (!mergeResponse.ok) {
        const errText = await mergeResponse.text().catch(() => '(unreadable)');
        throw new Error(
          `[C3/People] createPerson: POST succeeded (SP ID ${spItemId}) but MERGE Title = ${personId} failed ` +
          `(HTTP ${mergeResponse.status} ${mergeResponse.statusText}). ` +
          `An orphaned row with Title '${tmpTitle}' exists in C3People (SP ID ${spItemId}). ` +
          `Operator must manually set Title = ${personId} on that item, or use the AddPerson recovery path (TD-24). ` +
          `Body: ${errText}`,
        );
      }

      // -- Step 3: Build and return the created Person ------------------------
      // Construct from the input and the assigned PersonID rather than fetching
      // back from SP (avoids an extra round-trip; the row is known-good).
      const warnRef = { count: 0 };
      const spItem: SpPersonItem = {
        Id:                spItemId,
        Title:             personId,
        FullName:          input.FullName.trim(),
        IGN:               input.IGN?.trim()               ?? null,
        Nationality:       input.Nationality?.trim()        ?? null,
        PrimaryRole:       input.PrimaryRole?.trim()        ?? null,
        PersonnelCode:     input.PersonnelCode?.trim()      ?? null,
        CurrentTeam:       input.CurrentTeam?.trim()        ?? null,
        CurrentGameTitle:  input.CurrentGameTitle?.trim()   ?? null,
        PrimaryDepartment: input.PrimaryDepartment?.trim()  ?? null,
        IsActive:          true,
        FirstContractDate: null,
        LatestContractDate: null,
        TotalContracts:    null,
        Notes:             input.Notes?.trim()              ?? null,
      };

      const person = mapSpItemToPerson(spItem, warnRef);
      if (person === null) {
        // Should never happen -- we just created the item with valid fields.
        throw new Error(
          `[C3/People] createPerson: SP item ${spItemId} was created (${personId}) ` +
          `but mapper rejected it. This is an unexpected state -- check C3People list.`,
        );
      }

      console.info(`[C3/People] createPerson: created ${personId} ("${person.FullName}") at SP ID ${spItemId}`);
      return person;
    },
  };
};
