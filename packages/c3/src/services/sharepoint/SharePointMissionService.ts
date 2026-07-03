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

import type {
  CreateKitAssignmentInput,
  DeactivateKitAssignmentRequest,
  KitAssignment,
  KitStatusTransitionRequest,
  Mission,
  MissionFilter,
  MissionParticipant,
  MissionStatus,
} from '@c3/types';
import type {
  AddMissionParticipantRequest,
  AddMissionParticipantResult,
  IMissionService,
  RemoveMissionParticipantRequest,
  RemoveMissionParticipantResult,
} from '../interfaces/IMissionService';
import {
  ActiveKitDependencyError,
  ConcurrencyError,
  DataIntegrityError,
  DuplicateKitAssignmentError,
  InvalidKitTransitionError,
  ParticipantConflictError,
  ParticipantNotActiveError,
  RowNotFoundError,
  WritePermissionError,
} from '../errors';
import {
  buildParticipantTitle,
  normalizeExternalCode,
  participantMatchesPayload,
  validateAddParticipantPayload,
  validateRemoveParticipantPayload,
} from '@c3/utils/participantWrites';
import {
  appendKitAuditLine,
  buildKitAssignmentTitle,
  buildKitAuditLine,
  canTransitionKitStatus,
  classifyWriteFailure,
  normalizeAssignmentKey,
  validateCreateKitAssignmentInput,
  validateKitTransitionRequest,
} from '@c3/utils/kitLifecycle';
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

// ---------------------------------------------------------------------------
// S29A write helpers — digest, ETag row resolution, failure translation
// ---------------------------------------------------------------------------

const KIT_LIST_ITEM_TYPE = 'SP.Data.C3MissionKitAssignmentsListItem';
const PARTICIPANT_LIST_ITEM_TYPE = 'SP.Data.C3MissionParticipantsListItem';

async function fetchFormDigest(siteUrl: string): Promise<string> {
  const response = await fetch(`${siteUrl.replace(/\/$/, '')}/_api/contextinfo`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });
  if (!response.ok) {
    throw new Error(`[C3/KitAssignment] Failed to fetch form digest: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { FormDigestValue: string };
  return json.FormDigestValue;
}

interface ResolvedKitRow {
  id: number;
  etag: string;
  kitStatus: string;
  statusNotes: string | null;
}

/**
 * Resolve exactly one active kit row by the canonical compound identity
 * columns. Uses odata=minimalmetadata so each item carries `odata.etag`
 * (nometadata strips annotations). Contract:
 *   0 rows  → RowNotFoundError (no write)
 *   2+ rows → DataIntegrityError (no write — duplicates need operator cleanup)
 *   1 row   → { id, etag, current state }
 * SP numeric Id and the ETag are internal persistence metadata consumed
 * immediately by the following MERGE — never cached, never exposed.
 */
async function resolveKitRow(
  kitBaseUrl: string,
  req: { MissionID: string; PersonID: string; ItemCategory: string; AssignmentKey: string },
): Promise<ResolvedKitRow> {
  const identity = `${req.MissionID} | ${req.PersonID} | ${req.ItemCategory} | ${req.AssignmentKey}`;
  const url =
    `${kitBaseUrl}` +
    `?$select=Id,MissionID,PersonID,ItemCategory,AssignmentKey,KitStatus,StatusNotes,IsActive` +
    `&$filter=MissionID eq '${encodeODataLiteral(req.MissionID)}'` +
    ` and PersonID eq '${encodeODataLiteral(req.PersonID)}'` +
    ` and ItemCategory eq '${encodeODataLiteral(req.ItemCategory)}'` +
    ` and AssignmentKey eq '${encodeODataLiteral(req.AssignmentKey)}'` +
    `&$top=2`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=minimalmetadata' },
  });
  if (!response.ok) {
    throw new Error(`[C3/KitAssignment] Row resolution failed: HTTP ${response.status} for ${identity}`);
  }
  const json = (await response.json()) as {
    value: Array<{ 'odata.etag': string; Id: number; KitStatus: string; StatusNotes: string | null; IsActive: boolean | null }>;
  };
  const active = (json.value ?? []).filter(v => v.IsActive !== false);

  if (active.length === 0) throw new RowNotFoundError('C3MissionKitAssignments', identity);
  if (active.length > 1) throw new DataIntegrityError('C3MissionKitAssignments', identity, active.length);

  const row = active[0];
  return { id: row.Id, etag: row['odata.etag'], kitStatus: row.KitStatus, statusNotes: row.StatusNotes };
}

/**
 * MERGE a kit row with optimistic concurrency: IF-MATCH uses the row's ACTUAL
 * ETag (never '*'). 412 → ConcurrencyError; 403 → WritePermissionError.
 */
async function mergeKitRow(
  siteUrl: string,
  kitBaseUrl: string,
  row: ResolvedKitRow,
  fields: Record<string, unknown>,
  identity: string,
): Promise<void> {
  const digest = await fetchFormDigest(siteUrl);
  const response = await fetch(`${kitBaseUrl.replace(/\/items$/, '')}/items(${row.id})`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept':          'application/json;odata=nometadata',
      'Content-Type':    'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'X-HTTP-Method':   'MERGE',
      'IF-MATCH':        row.etag,
    },
    body: JSON.stringify({ __metadata: { type: KIT_LIST_ITEM_TYPE }, ...fields }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(unreadable)');
    const kind = classifyWriteFailure(response.status, bodyText);
    if (kind === 'concurrency') throw new ConcurrencyError(identity);
    if (kind === 'permission') throw new WritePermissionError('C3MissionKitAssignments');
    throw new Error(
      `[C3/KitAssignment] MERGE failed for ${identity}: HTTP ${response.status} ${response.statusText}. Body: ${bodyText}`,
    );
  }
}

// ---------------------------------------------------------------------------
// S29B participant write helpers — resolution INCLUDES inactive rows (the
// governed-reactivation and already-applied/already-inactive contracts need
// full-history visibility). Same ETag discipline as the S29A kit writes.
// ---------------------------------------------------------------------------

interface ResolvedParticipantRow {
  id: number;
  etag: string;
  isActive: boolean;
  fields: { ExternalCode: string | null; ParticipantRole: string | null; PerDiemRate: number | string | null };
}

/**
 * Resolve ALL rows (active + inactive) for MissionID+PersonID. With the
 * Title unique constraint at most one row should exist; >1 → DataIntegrityError.
 * odata=minimalmetadata so items carry `odata.etag`.
 */
async function resolveParticipantRows(
  participantsBaseUrl: string,
  missionId: string,
  personId: string,
): Promise<ResolvedParticipantRow[]> {
  const url =
    `${participantsBaseUrl}` +
    `?$select=Id,MissionID,PersonID,ExternalCode,ParticipantRole,PerDiemRate,IsActive` +
    `&$filter=MissionID eq '${encodeODataLiteral(missionId)}'` +
    ` and PersonID eq '${encodeODataLiteral(personId)}'` +
    `&$top=3`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=minimalmetadata' },
  });
  if (!response.ok) {
    throw new Error(`[C3/ParticipantWrite] Row resolution failed: HTTP ${response.status} for ${missionId} | ${personId}`);
  }
  const json = (await response.json()) as {
    value: Array<{
      'odata.etag': string; Id: number; IsActive: boolean | null;
      ExternalCode: string | null; ParticipantRole: string | null; PerDiemRate: number | string | null;
    }>;
  };
  return (json.value ?? []).map(v => ({
    id: v.Id,
    etag: v['odata.etag'],
    isActive: v.IsActive !== false,
    fields: { ExternalCode: v.ExternalCode, ParticipantRole: v.ParticipantRole, PerDiemRate: v.PerDiemRate },
  }));
}

/** MERGE a participant row with actual-ETag concurrency (never IF-MATCH:*). */
async function mergeParticipantRow(
  siteUrl: string,
  participantsBaseUrl: string,
  row: ResolvedParticipantRow,
  fields: Record<string, unknown>,
  identity: string,
): Promise<void> {
  const digest = await fetchFormDigest(siteUrl);
  const response = await fetch(`${participantsBaseUrl.replace(/\/items$/, '')}/items(${row.id})`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept':          'application/json;odata=nometadata',
      'Content-Type':    'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'X-HTTP-Method':   'MERGE',
      'IF-MATCH':        row.etag,
    },
    body: JSON.stringify({ __metadata: { type: PARTICIPANT_LIST_ITEM_TYPE }, ...fields }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(unreadable)');
    const kind = classifyWriteFailure(response.status, bodyText);
    if (kind === 'concurrency') throw new ConcurrencyError(identity);
    if (kind === 'permission') throw new WritePermissionError('C3MissionParticipants');
    throw new Error(
      `[C3/ParticipantWrite] MERGE failed for ${identity}: HTTP ${response.status} ${response.statusText}. Body: ${bodyText}`,
    );
  }
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

    // ── S29B participant writes — full ADR-013; invoked from useExecuteApproval ──

    async addMissionParticipant(req: AddMissionParticipantRequest): Promise<AddMissionParticipantResult> {
      if (!req.actorLoginName?.trim()) throw new Error('[C3/ParticipantWrite] Actor identity is empty — refusing to write.');
      const errors = validateAddParticipantPayload({
        missionId: req.MissionID, personId: req.PersonID,
        externalCode: req.ExternalCode, role: req.Role, perDiemRate: req.PerDiemRate,
      });
      if (errors.length > 0) throw new Error(`[C3/ParticipantWrite] ${errors.join(' ')}`);

      const identity = `${req.MissionID} | ${req.PersonID}`;
      const externalCode = normalizeExternalCode(req.ExternalCode);
      const rows = await resolveParticipantRows(participantsBaseUrl, req.MissionID, req.PersonID);

      if (rows.length > 1) throw new DataIntegrityError('C3MissionParticipants', identity, rows.length);

      const participant: MissionParticipant = {
        MissionID:    req.MissionID,
        PersonID:     req.PersonID,
        ExternalCode: externalCode,
        Role:         req.Role,
        PerDiemRate:  req.PerDiemRate,
      };

      if (rows.length === 1) {
        const row = rows[0];
        if (row.isActive) {
          // Already-applied (idempotent recovery) vs conflicting active row.
          const existing: MissionParticipant = {
            MissionID:    req.MissionID,
            PersonID:     req.PersonID,
            ExternalCode: row.fields.ExternalCode?.trim() ?? '',
            Role:         (row.fields.ParticipantRole ?? '') as MissionParticipant['Role'],
            PerDiemRate:  typeof row.fields.PerDiemRate === 'number' ? row.fields.PerDiemRate
                          : row.fields.PerDiemRate ? Number(row.fields.PerDiemRate) : undefined,
          };
          const matches = participantMatchesPayload(existing, {
            missionId: req.MissionID, personId: req.PersonID,
            externalCode: req.ExternalCode, role: req.Role, perDiemRate: req.PerDiemRate,
          });
          if (matches) return { participant, outcome: 'already-applied' };
          throw new ParticipantConflictError(req.MissionID, req.PersonID);
        }

        // Governed reactivation — refresh fields from the approved payload,
        // exact row, actual ETag.
        await mergeParticipantRow(siteUrl, participantsBaseUrl, row, {
          IsActive:        true,
          ExternalCode:    externalCode,
          ParticipantRole: req.Role,
          PerDiemRate:     req.PerDiemRate ?? null,
        }, identity);
        console.info(`[C3/ParticipantWrite] reactivated ${identity} by ${req.actorLoginName}`);
        return { participant, outcome: 'reactivated' };
      }

      // Zero rows → POST. Unique deterministic Title is the concurrent-create
      // race guard; SP duplicate failures are translated below.
      const digest = await fetchFormDigest(siteUrl);
      const response = await fetch(participantsBaseUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept':          'application/json;odata=nometadata',
          'Content-Type':    'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        body: JSON.stringify({
          __metadata: { type: PARTICIPANT_LIST_ITEM_TYPE },
          Title:           buildParticipantTitle(req.MissionID, req.PersonID),
          MissionID:       req.MissionID,
          PersonID:        req.PersonID,
          ExternalCode:    externalCode,
          ParticipantRole: req.Role,
          PerDiemRate:     req.PerDiemRate ?? null,
          IsActive:        true,
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '(unreadable)');
        const kind = classifyWriteFailure(response.status, bodyText);
        if (kind === 'duplicate') throw new ParticipantConflictError(req.MissionID, req.PersonID);
        if (kind === 'permission') throw new WritePermissionError('C3MissionParticipants');
        throw new Error(
          `[C3/ParticipantWrite] POST failed for ${identity}: HTTP ${response.status} ${response.statusText}. Body: ${bodyText}`,
        );
      }

      console.info(`[C3/ParticipantWrite] created ${identity} by ${req.actorLoginName}`);
      return { participant, outcome: 'created' };
    },

    async removeMissionParticipant(req: RemoveMissionParticipantRequest): Promise<RemoveMissionParticipantResult> {
      if (!req.actorLoginName?.trim()) throw new Error('[C3/ParticipantWrite] Actor identity is empty — refusing to write.');
      const errors = validateRemoveParticipantPayload({
        missionId: req.MissionID, personId: req.PersonID, reason: req.reason,
      });
      if (errors.length > 0) throw new Error(`[C3/ParticipantWrite] ${errors.join(' ')}`);

      const identity = `${req.MissionID} | ${req.PersonID}`;
      const rows = await resolveParticipantRows(participantsBaseUrl, req.MissionID, req.PersonID);

      if (rows.length === 0) throw new RowNotFoundError('C3MissionParticipants', identity);
      if (rows.length > 1) throw new DataIntegrityError('C3MissionParticipants', identity, rows.length);

      const row = rows[0];
      if (!row.isActive) {
        // Already-inactive recovery target (write-succeeded/stamp-failed retry).
        return { outcome: 'already-inactive' };
      }

      // Authoritative active-kit dependency re-check — state may have changed
      // since submission.
      const kit = await this.listKitAssignments(req.MissionID);
      const activeKit = kit.filter(k => k.PersonID === req.PersonID);
      if (activeKit.length > 0) {
        throw new ActiveKitDependencyError(req.MissionID, req.PersonID, activeKit.length);
      }

      await mergeParticipantRow(siteUrl, participantsBaseUrl, row, { IsActive: false }, identity);
      console.info(`[C3/ParticipantWrite] removed ${identity} by ${req.actorLoginName} — ${req.reason}`);
      return { outcome: 'removed' };
    },

    // ── S29A kit writes — ADR-013 Addendum: Mission Kit Logistics Exemption ──

    async createKitAssignment(input: CreateKitAssignmentInput): Promise<KitAssignment> {
      const errors = validateCreateKitAssignmentInput(input);
      if (errors.length > 0) throw new Error(`[C3/KitAssignment] ${errors.join(' ')}`);

      const key = normalizeAssignmentKey(input.AssignmentKey);
      const identity = `${input.MissionID} | ${input.PersonID} | ${input.ItemCategory} | ${key}`;

      // Guard 1: person must be an ACTIVE participant of the mission.
      const participants = await this.listMissionParticipants(input.MissionID);
      if (!participants.some(p => p.PersonID === input.PersonID)) {
        throw new ParticipantNotActiveError(input.MissionID, input.PersonID);
      }

      // Guard 2: compound duplicate pre-check (friendly error). The Title
      // unique constraint is the authoritative race protection — a concurrent
      // create that slips past this check fails at POST and is translated below.
      const existing = await fetchKitItems(
        `${kitBaseUrl}?$select=Id,IsActive` +
        `&$filter=MissionID eq '${encodeODataLiteral(input.MissionID)}'` +
        ` and PersonID eq '${encodeODataLiteral(input.PersonID)}'` +
        ` and ItemCategory eq '${encodeODataLiteral(input.ItemCategory)}'` +
        ` and AssignmentKey eq '${encodeODataLiteral(key)}'&$top=2`,
      );
      if (existing.some(e => e.IsActive !== false)) {
        throw new DuplicateKitAssignmentError(identity);
      }

      const digest = await fetchFormDigest(siteUrl);
      const created: KitAssignment = {
        MissionID:       input.MissionID,
        PersonID:        input.PersonID,
        ItemCategory:    input.ItemCategory,
        AssignmentKey:   key,
        ItemDescription: input.ItemDescription?.trim() || undefined,
        Status:          'NotOrdered',
        JerseyNumber:    input.JerseyNumber?.trim() || undefined,
        OwnerEmail:      input.OwnerEmail?.trim() || input.actorLoginName,
      };

      const response = await fetch(kitBaseUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept':          'application/json;odata=nometadata',
          'Content-Type':    'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        body: JSON.stringify({
          __metadata: { type: KIT_LIST_ITEM_TYPE },
          Title:           buildKitAssignmentTitle(input.MissionID, input.PersonID, input.ItemCategory, key),
          MissionID:       created.MissionID,
          PersonID:        created.PersonID,
          ItemCategory:    created.ItemCategory,
          AssignmentKey:   created.AssignmentKey,
          ItemDescription: created.ItemDescription ?? null,
          KitStatus:       'NotOrdered',
          JerseyNumber:    created.JerseyNumber ?? null,
          OwnerEmail:      created.OwnerEmail ?? null,
          IsActive:        true,
          StatusNotes:     buildKitAuditLine('CREATED', 'NotOrdered', input.actorLoginName),
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '(unreadable)');
        const kind = classifyWriteFailure(response.status, bodyText);
        if (kind === 'duplicate') throw new DuplicateKitAssignmentError(identity);
        if (kind === 'permission') throw new WritePermissionError('C3MissionKitAssignments');
        throw new Error(
          `[C3/KitAssignment] POST failed for ${identity}: HTTP ${response.status} ${response.statusText}. Body: ${bodyText}`,
        );
      }

      console.info(`[C3/KitAssignment] created ${identity} by ${input.actorLoginName}`);
      return created;
    },

    async transitionKitStatus(req: KitStatusTransitionRequest): Promise<KitAssignment> {
      const errors = validateKitTransitionRequest(req);
      if (errors.length > 0) throw new Error(`[C3/KitAssignment] ${errors.join(' ')}`);

      const key = normalizeAssignmentKey(req.AssignmentKey);
      const identity = `${req.MissionID} | ${req.PersonID} | ${req.ItemCategory} | ${key}`;

      // Resolve the exact row — the CURRENT SP status is authoritative for the
      // transition guard (never the client's cached view).
      const row = await resolveKitRow(kitBaseUrl, { ...req, AssignmentKey: key });
      const from = row.kitStatus as KitAssignment['Status'];
      if (!canTransitionKitStatus(from, req.toStatus)) {
        throw new InvalidKitTransitionError(identity, from, req.toStatus);
      }

      const auditLine = buildKitAuditLine(from, req.toStatus, req.actorLoginName, req.reason);
      await mergeKitRow(siteUrl, kitBaseUrl, row, {
        KitStatus:   req.toStatus,
        StatusNotes: appendKitAuditLine(row.statusNotes, auditLine),
      }, identity);

      console.info(`[C3/KitAssignment] ${identity}: ${from} -> ${req.toStatus} by ${req.actorLoginName}`);

      // Return the updated assignment by re-reading through the normal path.
      const items = await this.listKitAssignments(req.MissionID);
      const updated = items.find(
        k => k.PersonID === req.PersonID && k.ItemCategory === req.ItemCategory && k.AssignmentKey === key,
      );
      if (!updated) throw new RowNotFoundError('C3MissionKitAssignments', identity);
      return updated;
    },

    async deactivateKitAssignment(req: DeactivateKitAssignmentRequest): Promise<void> {
      if (!req.actorLoginName?.trim()) throw new Error('[C3/KitAssignment] Actor identity is empty — refusing to write.');
      if (!req.reason?.trim()) throw new Error('[C3/KitAssignment] A deactivation reason is required.');

      const key = normalizeAssignmentKey(req.AssignmentKey);
      const identity = `${req.MissionID} | ${req.PersonID} | ${req.ItemCategory} | ${key}`;

      const row = await resolveKitRow(kitBaseUrl, { ...req, AssignmentKey: key });
      const auditLine = buildKitAuditLine(row.kitStatus as KitAssignment['Status'], 'DEACTIVATED', req.actorLoginName, req.reason);

      // IsActive=false; the row is retained for history — never deleted.
      await mergeKitRow(siteUrl, kitBaseUrl, row, {
        IsActive:    false,
        StatusNotes: appendKitAuditLine(row.statusNotes, auditLine),
      }, identity);

      console.info(`[C3/KitAssignment] deactivated ${identity} by ${req.actorLoginName}`);
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
