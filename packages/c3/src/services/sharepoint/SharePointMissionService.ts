/**
 * SharePointMissionService.ts
 *
 * Sprint 26 (S26-2) — Mission/Event Read Foundation.
 *
 * Read methods implemented:
 *   - listMissions(filter?)  — all C3Missions rows, StartDate ascending
 *   - getMission(missionId)  — single mission by TR/SATR code, null if not found
 *
 * Design follows the S15–S24 native-fetch service pattern:
 *   - No @pnp/sp. No spfi. No SPFI.
 *   - credentials: 'same-origin' — relies on SPFx auth cookie.
 *   - Accept: application/json;odata=nometadata — flat JSON, no OData envelope.
 *   - Read-only in Sprint 26. No request digest required.
 *   - Fails safely: 404 (list not provisioned) and network/parse errors
 *     return [] / null — the UI degrades to an empty state, never a crash.
 *   - All type-coercion / validation delegated to spMissionMapper.ts.
 *
 * Mission identity note (locked ADR): MissionID is the business TR/SATR code
 * stored in Title (e.g. "TR/2026/006"). It is never derived from the SP
 * integer Id, and the POST-then-MERGE pattern does NOT apply to this list.
 * TR codes contain "/" characters — legal inside a quoted OData string
 * literal; the filter value is URL-encoded when building the query string.
 *
 * Filtering note: MissionFilter (status[], entity) is applied client-side
 * after fetch, mirroring MockMissionService semantics exactly. Mission volume
 * is tens of rows per year — a server-side OData filter would add choice-value
 * edge cases without a measurable benefit at this scale.
 *
 * IsActive note: the schema provisions an IsActive flag for future soft-delete
 * semantics; the S26 read path does not filter on it (same as the S24 contract
 * read path). A future write/deactivation sprint decides the filter semantics.
 *
 * Participant reads (Sprint 27, S27-3):
 *   - listMissionParticipants(missionId) / listAllMissionParticipants() are
 *     live native-fetch reads against C3MissionParticipants, mapped through
 *     spMissionParticipantMapper. Rows with an explicit IsActive === false
 *     are excluded from both reads (inactive rows are retained in SP for
 *     history; there is no lifecycle UI). 404 / missing list returns [].
 *   - $top=500 per query — acceptable at current participant volume
 *     (participants × missions per year); documented as a scale limitation
 *     in the schema doc §10.
 *
 * Still stubbed (out of scope):
 *   - confirmMission / updateMissionStatus — writes throw; they cannot safely
 *     no-op because callers expect a returned Mission and store side effects.
 *     SP mission confirmation is hidden in the UI (TD-26); a future SP write
 *     must be an explicitly designed governed path.
 *   - No participant writes of any kind (S27 scope boundary).
 *
 * See: docs/architecture/C3Missions SP List Schema.md
 * See: docs/architecture/C3MissionParticipants SP List Schema.md
 */

import type { KitAssignment, Mission, MissionFilter, MissionParticipant, MissionStatus } from '@c3/types';
import type { IMissionService } from '../interfaces/IMissionService';
import { mapSpItemsToMissions } from '@c3/utils/spMissionMapper';
import type { SpMissionItem } from '@c3/utils/spMissionMapper';
import { mapSpItemsToMissionParticipants } from '@c3/utils/spMissionParticipantMapper';
import type { SpMissionParticipantItem } from '@c3/utils/spMissionParticipantMapper';
import { mapSpItemsToKitAssignments } from '@c3/utils/spKitAssignmentMapper';
import type { SpKitAssignmentItem } from '@c3/utils/spKitAssignmentMapper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIST_NAME = 'C3Missions';
const PARTICIPANTS_LIST_NAME = 'C3MissionParticipants';
const KIT_LIST_NAME = 'C3MissionKitAssignments';
const PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

function buildParticipantsListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${PARTICIPANTS_LIST_NAME}')/items`;
}

function buildKitListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${KIT_LIST_NAME}')/items`;
}

/**
 * Escape and URL-encode a value for use inside an OData $filter string
 * literal. Single quotes are doubled (OData escaping); the result is
 * URI-encoded so TR/SATR codes containing "/" survive the query string.
 *
 * Exported for the s27 parity harness, which exercises this exact function
 * (compiled from source) rather than a re-implementation.
 */
export function encodeODataLiteral(val: string): string {
  return encodeURIComponent(val.replace(/'/g, "''"));
}

interface SpListResponse {
  value: SpMissionItem[];
}

/**
 * Fetch SP list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchMissionItems(url: string): Promise<SpMissionItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/Mission] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(
        '[C3/Mission] C3Missions list not found (HTTP 404). ' +
        'The list may not be provisioned yet. ' +
        'See docs/architecture/C3Missions SP List Schema.md for provisioning steps.',
      );
    } else {
      console.error(
        `[C3/Mission] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
        'for C3Missions query. Returning empty mission list.',
      );
    }
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error('[C3/Mission] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/Mission] SharePoint response is missing the "value" array. ' +
      'Check C3Missions list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

interface SpParticipantListResponse {
  value: SpMissionParticipantItem[];
}

/**
 * Fetch C3MissionParticipants list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchParticipantItems(url: string): Promise<SpMissionParticipantItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/MissionParticipant] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(
        '[C3/MissionParticipant] C3MissionParticipants list not found (HTTP 404). ' +
        'The list may not be provisioned yet. ' +
        'See docs/architecture/C3MissionParticipants SP List Schema.md for provisioning steps.',
      );
    } else {
      console.error(
        `[C3/MissionParticipant] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
        'for C3MissionParticipants query. Returning empty participant list.',
      );
    }
    return [];
  }

  let json: SpParticipantListResponse;
  try {
    json = (await response.json()) as SpParticipantListResponse;
  } catch (err) {
    console.error('[C3/MissionParticipant] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/MissionParticipant] SharePoint response is missing the "value" array. ' +
      'Check C3MissionParticipants list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

/**
 * Map raw participant items and project active MissionParticipant records.
 * Rows with an explicit IsActive === false are persistence history — excluded
 * from all reads (documented in the schema doc; no lifecycle UI exists).
 */
function toActiveParticipants(items: SpMissionParticipantItem[]): MissionParticipant[] {
  const { records } = mapSpItemsToMissionParticipants(items);
  return records.filter(r => r.isActive).map(r => r.participant);
}

interface SpKitListResponse {
  value: SpKitAssignmentItem[];
}

/**
 * Fetch C3MissionKitAssignments list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchKitItems(url: string): Promise<SpKitAssignmentItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/KitAssignment] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(
        '[C3/KitAssignment] C3MissionKitAssignments list not found (HTTP 404). ' +
        'The list may not be provisioned yet. ' +
        'See docs/architecture/C3MissionKitAssignments SP List Schema.md for provisioning steps.',
      );
    } else {
      console.error(
        `[C3/KitAssignment] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
        'for C3MissionKitAssignments query. Returning empty kit list.',
      );
    }
    return [];
  }

  let json: SpKitListResponse;
  try {
    json = (await response.json()) as SpKitListResponse;
  } catch (err) {
    console.error('[C3/KitAssignment] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/KitAssignment] SharePoint response is missing the "value" array. ' +
      'Check C3MissionKitAssignments list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

/** Map raw kit items and project active assignments (explicit-false excluded). */
function toActiveKitAssignments(items: SpKitAssignmentItem[]): KitAssignment[] {
  const { records } = mapSpItemsToKitAssignments(items);
  return records.filter(r => r.isActive).map(r => r.assignment);
}

/** Apply MissionFilter client-side — mirrors MockMissionService semantics. */
function applyFilter(missions: Mission[], filter?: MissionFilter): Mission[] {
  let results = missions;
  if (filter?.status?.length) {
    results = results.filter(m => filter.status!.includes(m.Status));
  }
  if (filter?.entity) {
    results = results.filter(m => m.Entity === filter.entity);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointMissionService = (siteUrl: string): IMissionService => {
  const baseUrl = buildListUrl(siteUrl);
  const participantsBaseUrl = buildParticipantsListUrl(siteUrl);
  const kitBaseUrl = buildKitListUrl(siteUrl);

  return {
    async listMissions(filter?: MissionFilter): Promise<Mission[]> {
      const url =
        `${baseUrl}` +
        `?$select=*` +
        `&$top=${PAGE_SIZE}` +
        `&$orderby=StartDate asc`;

      const items = await fetchMissionItems(url);
      const { missions } = mapSpItemsToMissions(items);
      return applyFilter(missions, filter);
    },

    async getMission(missionId: string): Promise<Mission | null> {
      const url =
        `${baseUrl}` +
        `?$select=*` +
        `&$filter=Title eq '${encodeODataLiteral(missionId)}'` +
        `&$top=1`;

      const items = await fetchMissionItems(url);
      if (items.length === 0) {
        return null;
      }

      const { missions } = mapSpItemsToMissions(items);
      return missions[0] ?? null;
    },

    async listMissionParticipants(missionId: string): Promise<MissionParticipant[]> {
      const url =
        `${participantsBaseUrl}` +
        `?$select=*` +
        `&$filter=MissionID eq '${encodeODataLiteral(missionId)}'` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchParticipantItems(url);
      return toActiveParticipants(items);
    },

    async listAllMissionParticipants(): Promise<MissionParticipant[]> {
      const url =
        `${participantsBaseUrl}` +
        `?$select=*` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchParticipantItems(url);
      return toActiveParticipants(items);
    },

    async listKitAssignments(missionId: string): Promise<KitAssignment[]> {
      const url =
        `${kitBaseUrl}` +
        `?$select=*` +
        `&$filter=MissionID eq '${encodeODataLiteral(missionId)}'` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchKitItems(url);
      return toActiveKitAssignments(items);
    },

    async listAllKitAssignments(): Promise<KitAssignment[]> {
      const url =
        `${kitBaseUrl}` +
        `?$select=*` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchKitItems(url);
      return toActiveKitAssignments(items);
    },

    async confirmMission(missionId: string, confirmedBy: string): Promise<Mission> {
      void missionId;
      void confirmedBy;
      console.warn('[C3/Mission] confirmMission: not implemented (mission writes are out of S26 scope)');
      throw new Error('SharePointMissionService.confirmMission: not implemented');
    },

    async updateMissionStatus(missionId: string, status: MissionStatus): Promise<Mission> {
      void missionId;
      void status;
      console.warn('[C3/Mission] updateMissionStatus: not implemented (mission writes are out of S26 scope)');
      throw new Error('SharePointMissionService.updateMissionStatus: not implemented');
    },
  };
};
