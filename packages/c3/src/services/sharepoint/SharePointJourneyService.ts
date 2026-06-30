/**
 * SharePointJourneyService.ts
 *
 * Sprint 17 (S17-2) -- Journey Integration.
 *
 * Read methods implemented:
 *   - listAllActiveJourneys(type?)
 *   - listJourneysForPerson(personId, type?)
 *   - getActiveJourney(personId, type)
 *
 * Sprint 18 Phase 4A:
 *   - initiateJourney: live -- derives JRN-XXXX sequence, POSTs to C3Journeys.
 *     Called by useExecuteApproval after approved-approval guard and duplicate check.
 *     The journey is the operational fact; the approval is the audit record (ADR-013).
 *
 * Write stubs (not implemented):
 *   - completeJourney, suspendJourney, cancelJourney
 *
 * Design:
 *   - No PnP.js. Native fetch with credentials: 'same-origin'.
 *   - Accept: application/json;odata=nometadata for GET.
 *   - Content-Type: application/json;odata=verbose for POST.
 *   - X-RequestDigest fetched fresh per write -- never cached.
 *   - All type-coercion / validation delegated to spJourneyMapper.ts.
 *   - OData single-quote escaping: embedded single-quotes doubled before interpolation.
 *
 * JourneyID sequence note: GET-last-then-increment is not atomic. Concurrent
 * initiations could derive the same JRN title. SP does not enforce uniqueness
 * on Title. Acceptable for Phase 4A (single-user, single-execution flow).
 *
 * __metadata.type: SP.Data.C3JourneysListItem -- verify against
 *   /_api/web/lists/getbytitle('C3Journeys')?$select=ListItemEntityTypeFullName
 * before first live POST.
 *
 * See: docs/architecture/C3Journeys SP List Schema.md
 * See: docs/adr/ADR-003-journey-definition.md
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type { InitiateJourneyInput, Journey, JourneyType } from '@c3/types';
import type { IJourneyService } from '../interfaces/IJourneyService';
import { mapSpItemsToJourneys, mapSpItemToJourney } from '@c3/utils/spJourneyMapper';
import type { SpJourneyItem } from '@c3/utils/spJourneyMapper';

// ---------------------------------------------------------------------------
// SP REST query constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3Journeys';
const LIST_ITEM_TYPE = 'SP.Data.C3JourneysListItem';

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

const PREFIX = '[C3/Journey]';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

function buildContextInfoUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/contextinfo`;
}

function buildItemUrl(siteUrl: string, id: number): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items(${id})`;
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
    console.error(`${PREFIX} Network error reaching SharePoint:`, err);
    return [];
  }

  if (!response.ok) {
    console.error(
      `${PREFIX} SharePoint returned HTTP ${response.status} ${response.statusText}. Returning empty journey list.`,
    );
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error(`${PREFIX} Failed to parse SharePoint JSON response:`, err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(`${PREFIX} SharePoint response is missing the "value" array.`);
    return [];
  }

  return json.value;
}

/**
 * Fetch a fresh Form Digest Value for write operations.
 * Never cache -- digest TTL is 30 minutes.
 */
async function fetchFormDigest(siteUrl: string): Promise<string> {
  const response = await fetch(buildContextInfoUrl(siteUrl), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });

  if (!response.ok) {
    throw new Error(
      `${PREFIX} fetchFormDigest: /_api/contextinfo returned HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as { FormDigestValue?: string };
  if (!json.FormDigestValue) {
    throw new Error(`${PREFIX} fetchFormDigest: FormDigestValue absent in contextinfo response`);
  }

  return json.FormDigestValue;
}

/**
 * Derive the next JRN-XXXX sequence number.
 * GETs the last item by ID descending, parses Title, increments.
 * Returns 1 if no items exist.
 *
 * Not atomic -- see module-level note on sequence number race.
 */
interface TitleOnlyItem { Title: string | null }
interface TitleOnlyResponse { value: TitleOnlyItem[] }

async function deriveNextJourneySequence(siteUrl: string): Promise<number> {
  const url =
    `${buildListUrl(siteUrl)}?$select=Title&$orderby=ID%20desc&$top=1`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });

  if (!response.ok) {
    throw new Error(`${PREFIX} deriveNextJourneySequence: HTTP ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as TitleOnlyResponse;

  if (!Array.isArray(json.value) || json.value.length === 0) return 1;

  const lastTitle = json.value[0].Title;
  if (!lastTitle) return 1;

  const match = lastTitle.match(/^JRN-(\d+)$/i);
  if (!match) return 1;

  return parseInt(match[1], 10) + 1;
}

function formatJourneyId(n: number): string {
  return `JRN-${String(n).padStart(4, '0')}`;
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
      // Step 1: derive next JRN-XXXX sequence
      const seq    = await deriveNextJourneySequence(siteUrl);
      const title  = formatJourneyId(seq);

      // Step 2: fetch fresh form digest
      const digest = await fetchFormDigest(siteUrl);

      // Step 3: build POST body
      const now = new Date().toISOString();

      // ObligationAssignmentsJSON: JSON array string when assignments exist, else null
      const obligationJson =
        input.obligationAssignments && input.obligationAssignments.length > 0
          ? JSON.stringify(input.obligationAssignments)
          : null;

      const body = {
        __metadata:               { type: LIST_ITEM_TYPE },
        Title:                    title,
        PersonID:                 input.PersonID,
        JourneyType:              input.Type,
        Status:                   'Active',
        InitiatedBy:              input.InitiatedBy,
        InitiatedAt:              now,
        AssignedTo:               input.AssignedTo ?? null,
        InitiationReason:         input.InitiationReason ?? null,
        Notes:                    input.Notes ?? null,
        MissionID:                input.MissionID ?? null,
        ContractID:               null,      // not supplied at execution time
        ObligationAssignmentsJSON: obligationJson,
      };

      // Step 4: POST to C3Journeys
      const response = await fetch(buildListUrl(siteUrl), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept':          'application/json;odata=nometadata',
          'Content-Type':    'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '(unreadable)');
        throw new Error(
          `${PREFIX} initiateJourney: HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
        );
      }

      const created = (await response.json()) as { ID?: number };
      const spId = typeof created.ID === 'number' ? created.ID : seq;

      console.info(`${PREFIX} initiateJourney: created ${title} (SP ID ${spId}) for ${input.PersonID}`);

      // Step 5: return the typed Journey domain object
      const journey: Journey = {
        JourneyID:        title,
        PersonID:         input.PersonID,
        Type:             input.Type,
        Status:           'Active',
        InitiatedAt:      now,
        InitiatedBy:      input.InitiatedBy,
        AssignedTo:       input.AssignedTo,
        InitiationReason: input.InitiationReason,
        Notes:            input.Notes,
        MissionID:        input.MissionID,
        obligationAssignments:
          input.obligationAssignments && input.obligationAssignments.length > 0
            ? input.obligationAssignments
            : undefined,
      };

      return journey;
    },

    async completeJourney(journeyId: string): Promise<Journey> {
      void journeyId;
      console.warn(`${PREFIX} completeJourney: not implemented`);
      throw new Error(`${PREFIX} completeJourney: not implemented`);
    },

    async suspendJourney(journeyId: string): Promise<Journey> {
      void journeyId;
      console.warn(`${PREFIX} suspendJourney: not implemented`);
      throw new Error(`${PREFIX} suspendJourney: not implemented`);
    },

    async cancelJourney(journeyId: string): Promise<Journey> {
      void journeyId;
      console.warn(`${PREFIX} cancelJourney: not implemented`);
      throw new Error(`${PREFIX} cancelJourney: not implemented`);
    },

    // completeJourney / suspendJourney / cancelJourney also use MERGE when implemented.
    // The buildItemUrl helper above is available for that purpose.
    // Suppress unused-variable warning until those methods are live.
    ...((() => { void buildItemUrl; return {}; })()),
  };
};
