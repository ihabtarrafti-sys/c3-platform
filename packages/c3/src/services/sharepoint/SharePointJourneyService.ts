/**
 * SharePointJourneyService.ts
 *
 * Sprint 17 (S17-2) — Journey Integration.
 *
 * Read-only implementation of IJourneyService backed by the C3Journeys
 * SharePoint list. Write methods remain as throwing stubs — Journey writes
 * are governed by ADR-013 and are planned for Sprint 18.
 *
 * Design follows the S15 SharePointCredentialService / S16 SharePointPersonService
 * pattern:
 *   - No PnP.js. Native fetch with Accept: application/json;odata=nometadata.
 *   - credentials: 'same-origin' — relies on SPFx authentication cookie.
 *   - Fails safely on any network/HTTP/parse error: logs + returns []/null, never throws.
 *   - All type-coercion and validation delegated to spJourneyMapper.ts.
 *
 * Read methods implemented:
 *   - listAllActiveJourneys(type?)     — Situation Room batch fetch
 *   - listJourneysForPerson(personId, type?) — Person timeline fetch
 *   - getActiveJourney(personId, type) — single active journey lookup
 *
 * Write methods (throw — not implemented in S17):
 *   - initiateJourney
 *   - completeJourney
 *   - suspendJourney
 *   - cancelJourney
 *
 * OData single-quote escaping: string filter values are sanitised by doubling
 * any embedded single-quote before interpolation into the filter string.
 *
 * See: docs/architecture/C3Journeys SP List Schema.md
 * See: docs/adr/ADR-003-journey-definition.md
 */

import type { InitiateJourneyInput, Journey, JourneyType } from '@c3/types';
import type { IJourneyService } from '../interfaces/IJourneyService';
import { mapSpItemsToJourneys, mapSpItemToJourney } from '@c3/utils/spJourneyMapper';
import type { SpJourneyItem } from '@c3/utils/spJourneyMapper';

// ---------------------------------------------------------------------------
// SP REST query constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3Journeys';

const SELECT_FIELDS = [
  'Id',
  'Title',
  'PersonID',
  'JourneyType',
  'Status',
  'InitiatedAt',
  'InitiatedBy',
  'AssignedTo',
  'InitiationReason',
  'ContractID',
  'MissionID',
  'CompletedAt',
  'Notes',
  'ObligationAssignmentsJSON',
].join(',');

const PAGE_SIZE = 2000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

function escOData(val: string): string {
  return val.replace(/'/g, "''");
}

interface SpListResponse {
  value: SpJourneyItem[];
}

async function fetchItems(url: string): Promise<SpJourneyItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/Journey] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    console.error(
      `[C3/Journey] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
      `for list query. Returning empty journey list.`,
    );
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error('[C3/Journey] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/Journey] SharePoint response is missing the "value" array. ' +
      'Response shape is unexpected — check list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointJourneyService = (siteUrl: string): IJourneyService => {
  const baseUrl = buildListUrl(siteUrl);

  return {
    async listAllActiveJourneys(type?: JourneyType): Promise<Journey[]> {
      const typeFilter = type ? ` and JourneyType eq '${escOData(type)}'` : '';
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=Status eq 'Active'${typeFilter}` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { journeys } = mapSpItemsToJourneys(items);
      return journeys;
    },

    async listJourneysForPerson(personId: string, type?: JourneyType): Promise<Journey[]> {
      const typeFilter = type ? ` and JourneyType eq '${escOData(type)}'` : '';
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=PersonID eq '${escOData(personId)}'${typeFilter}` +
        `&$orderby=InitiatedAt desc` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { journeys } = mapSpItemsToJourneys(items);
      return journeys;
    },

    async getActiveJourney(personId: string, type: JourneyType): Promise<Journey | null> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=PersonID eq '${escOData(personId)}' and JourneyType eq '${escOData(type)}' and Status eq 'Active'` +
        `&$top=1`;

      const items = await fetchItems(url);
      if (items.length === 0) return null;

      const warnRef = { count: 0 };
      return mapSpItemToJourney(items[0], warnRef);
    },

    async initiateJourney(input: InitiateJourneyInput): Promise<Journey> {
      void input;
      console.warn('[C3/Journey] SharePointJourneyService.initiateJourney: not implemented (Sprint 18)');
      throw new Error('SharePointJourneyService.initiateJourney: not implemented — planned for Sprint 18');
    },

    async completeJourney(journeyId: string): Promise<Journey> {
      void journeyId;
      console.warn('[C3/Journey] SharePointJourneyService.completeJourney: not implemented (Sprint 18)');
      throw new Error('SharePointJourneyService.completeJourney: not implemented — planned for Sprint 18');
    },

    async suspendJourney(journeyId: string): Promise<Journey> {
      void journeyId;
      console.warn('[C3/Journey] SharePointJourneyService.suspendJourney: not implemented (Sprint 18)');
      throw new Error('SharePointJourneyService.suspendJourney: not implemented — planned for Sprint 18');
    },

    async cancelJourney(journeyId: string): Promise<Journey> {
      void journeyId;
      console.warn('[C3/Journey] SharePointJourneyService.cancelJourney: not implemented (Sprint 18)');
      throw new Error('SharePointJourneyService.cancelJourney: not implemented — planned for Sprint 18');
    },
  };
};
