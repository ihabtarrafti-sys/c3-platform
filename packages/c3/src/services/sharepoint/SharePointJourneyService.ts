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
 * Sprint 19 Phase 2:
 *   - completeJourney, suspendJourney, resumeJourney, cancelJourney: live.
 *     Pattern: GET (current item by Title) -> guard -> PATCH (MERGE).
 *     Actor login is required; fail-close on empty actor.
 *     Audit trail appended to Notes field (structured line: [ts] ACTION by actor[ -- reason]).
 *     InvalidTransitionError thrown when the current SP status does not permit the transition.
 *     Governance: direct role-gated actions, not ADR-013 approval-gated.
 *     See: docs/architecture/ADR-013 Addendum -- Journey Lifecycle Transitions.md
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
import type { IJourneyService, JourneyTransitionRequest } from '../interfaces/IJourneyService';
import { canCancel, canComplete, canResume, canSuspend } from '../interfaces/IJourneyService';
import { InvalidTransitionError } from '../errors';
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

function formatJourneyId(n: number): string {
  return `JRN-${String(n).padStart(4, '0')}`;
}

/**
 * MERGE a freshly-created C3Journeys item to replace its placeholder Title
 * with the canonical JRN-XXXX identifier derived from the SP item ID.
 * Fetches a fresh digest -- the POST digest is consumed by the time we reach here.
 * Throws with orphan-row context if the MERGE fails. (S19-3)
 */
async function mergeJourneyTitle(siteUrl: string, id: number, title: string): Promise<void> {
  const digest = await fetchFormDigest(siteUrl);

  const response = await fetch(buildItemUrl(siteUrl, id), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept':          'application/json;odata=nometadata',
      'Content-Type':    'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'X-HTTP-Method':   'MERGE',
      'IF-MATCH':        '*',
    },
    body: JSON.stringify({ __metadata: { type: LIST_ITEM_TYPE }, Title: title }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${PREFIX} mergeJourneyTitle(${id}): HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Transition helpers
// ---------------------------------------------------------------------------

/**
 * SP item shape returned from transition GET (all SELECT_FIELDS).
 */
interface SpJourneyItemWithId extends SpJourneyItem {
  Id: number;
}

/**
 * Fetch a single C3Journeys SP item by its Title (JourneyID, e.g. "JRN-0001").
 * Returns null if the item is not found.
 */
async function fetchItemByTitle(
  siteUrl: string,
  journeyId: string,
): Promise<SpJourneyItemWithId | null> {
  const url =
    `${buildListUrl(siteUrl)}` +
    `?$select=${SELECT_FIELDS}` +
    `&$filter=Title eq '${escOData(journeyId)}'` +
    `&$top=1`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });

  if (!response.ok) {
    throw new Error(
      `${PREFIX} fetchItemByTitle(${journeyId}): HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as { value?: SpJourneyItemWithId[] };
  if (!Array.isArray(json.value) || json.value.length === 0) return null;

  return json.value[0];
}

/**
 * PATCH a C3Journeys SP list item using X-HTTP-Method: MERGE.
 */
async function patchJourneyItem(
  siteUrl: string,
  id: number,
  digest: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const body = {
    __metadata: { type: LIST_ITEM_TYPE },
    ...fields,
  };

  const response = await fetch(buildItemUrl(siteUrl, id), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept':          'application/json;odata=nometadata',
      'Content-Type':    'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'X-HTTP-Method':   'MERGE',
      'IF-MATCH':        '*',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${PREFIX} patchJourneyItem(${id}): HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
    );
  }
}

/**
 * Builds a structured audit line for the Notes append pattern.
 * Format: "[ISO_TIMESTAMP] ACTION by LOGINNAME[ -- reason]"
 */
function buildAuditLine(
  action: 'COMPLETED' | 'SUSPENDED' | 'RESUMED' | 'CANCELLED',
  actorLoginName: string,
  reason: string | undefined,
): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${action} by ${actorLoginName}`;
  return reason ? `${base} -- ${reason}` : base;
}

/**
 * Appends an audit line to existing Notes, preserving existing content.
 */
function appendAuditLine(
  existingNotes: string | null | undefined,
  line: string,
): string | undefined {
  if (!existingNotes || !existingNotes.trim()) return line;
  return `${existingNotes}\n${line}`;
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
      // S19-3: POST-then-MERGE pattern -- SP auto-ID is the atomic sequence source.
      const placeholder = 'TMP-' + Date.now().toString(36);
      const digest = await fetchFormDigest(siteUrl);
      const now = new Date().toISOString();

      const obligationJson =
        input.obligationAssignments && input.obligationAssignments.length > 0
          ? JSON.stringify(input.obligationAssignments)
          : null;

      const body = {
        __metadata:               { type: LIST_ITEM_TYPE },
        Title:                    placeholder,
        PersonID:                 input.PersonID,
        JourneyType:              input.Type,
        Status:                   'Active',
        InitiatedBy:              input.InitiatedBy,
        InitiatedAt:              now,
        AssignedTo:               input.AssignedTo ?? null,
        InitiationReason:         input.InitiationReason ?? null,
        Notes:                    input.Notes ?? null,
        MissionID:                input.MissionID ?? null,
        ContractID:               null,
        ObligationAssignmentsJSON: obligationJson,
      };

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
      if (typeof created.ID !== 'number') {
        throw new Error(
          `${PREFIX} initiateJourney: SP did not return an item ID after POST. ` +
          `Cannot derive JRN sequence. An orphaned row with Title '${placeholder}' may exist in C3Journeys.`,
        );
      }

      const title = formatJourneyId(created.ID);
      try {
        await mergeJourneyTitle(siteUrl, created.ID, title);
      } catch (mergeErr) {
        throw new Error(
          `${PREFIX} initiateJourney: POST succeeded (SP ID ${created.ID}) but Title MERGE failed. ` +
          `An orphaned row with Title '${placeholder}' exists in C3Journeys. ` +
          `Original error: ${mergeErr instanceof Error ? mergeErr.message : String(mergeErr)}`,
        );
      }

      console.info(`${PREFIX} initiateJourney: created ${title} (SP ID ${created.ID}) for ${input.PersonID}`);

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

    async completeJourney(req: JourneyTransitionRequest): Promise<Journey> {
      const { journeyId, actorLoginName, reason } = req;
      if (!actorLoginName.trim()) {
        throw new Error(`${PREFIX} completeJourney: actorLoginName is empty. Refusing to write without an identifiable actor.`);
      }

      const current = await fetchItemByTitle(siteUrl, journeyId);
      if (!current) {
        throw new Error(`${PREFIX} completeJourney: Journey not found in C3Journeys: ${journeyId}`);
      }
      const currentStatus = current.Status as Journey['Status'];
      if (!canComplete(currentStatus)) {
        throw new InvalidTransitionError(journeyId, currentStatus, 'complete');
      }

      const now = new Date().toISOString();
      const auditLine = buildAuditLine('COMPLETED', actorLoginName, reason);
      const newNotes = appendAuditLine(current.Notes, auditLine);

      const digest = await fetchFormDigest(siteUrl);
      await patchJourneyItem(siteUrl, current.Id, digest, {
        Status:      'Completed',
        CompletedAt: now,
        Notes:       newNotes ?? null,
      });

      console.info(`${PREFIX} completeJourney: ${journeyId} -> Completed by ${actorLoginName}`);

      const warnRef = { count: 0 };
      const base = mapSpItemToJourney(current, warnRef);
      return { ...base, JourneyID: journeyId, Status: 'Completed', CompletedAt: now, Notes: newNotes } as Journey;
    },

    async suspendJourney(req: JourneyTransitionRequest): Promise<Journey> {
      const { journeyId, actorLoginName, reason } = req;
      if (!actorLoginName.trim()) {
        throw new Error(`${PREFIX} suspendJourney: actorLoginName is empty. Refusing to write without an identifiable actor.`);
      }

      const current = await fetchItemByTitle(siteUrl, journeyId);
      if (!current) {
        throw new Error(`${PREFIX} suspendJourney: Journey not found in C3Journeys: ${journeyId}`);
      }
      const currentStatus = current.Status as Journey['Status'];
      if (!canSuspend(currentStatus)) {
        throw new InvalidTransitionError(journeyId, currentStatus, 'suspend');
      }

      const auditLine = buildAuditLine('SUSPENDED', actorLoginName, reason);
      const newNotes = appendAuditLine(current.Notes, auditLine);

      const digest = await fetchFormDigest(siteUrl);
      await patchJourneyItem(siteUrl, current.Id, digest, {
        Status: 'Suspended',
        Notes:  newNotes ?? null,
      });

      console.info(`${PREFIX} suspendJourney: ${journeyId} -> Suspended by ${actorLoginName}`);

      const warnRef = { count: 0 };
      const base = mapSpItemToJourney(current, warnRef);
      return { ...base, JourneyID: journeyId, Status: 'Suspended', Notes: newNotes } as Journey;
    },

    async resumeJourney(req: Omit<JourneyTransitionRequest, 'reason'>): Promise<Journey> {
      const { journeyId, actorLoginName } = req;
      if (!actorLoginName.trim()) {
        throw new Error(`${PREFIX} resumeJourney: actorLoginName is empty. Refusing to write without an identifiable actor.`);
      }

      const current = await fetchItemByTitle(siteUrl, journeyId);
      if (!current) {
        throw new Error(`${PREFIX} resumeJourney: Journey not found in C3Journeys: ${journeyId}`);
      }
      const currentStatus = current.Status as Journey['Status'];
      if (!canResume(currentStatus)) {
        throw new InvalidTransitionError(journeyId, currentStatus, 'resume');
      }

      const auditLine = buildAuditLine('RESUMED', actorLoginName, undefined);
      const newNotes = appendAuditLine(current.Notes, auditLine);

      const digest = await fetchFormDigest(siteUrl);
      await patchJourneyItem(siteUrl, current.Id, digest, {
        Status: 'Active',
        Notes:  newNotes ?? null,
      });

      console.info(`${PREFIX} resumeJourney: ${journeyId} -> Active (resumed) by ${actorLoginName}`);

      const warnRef = { count: 0 };
      const base = mapSpItemToJourney(current, warnRef);
      return { ...base, JourneyID: journeyId, Status: 'Active', Notes: newNotes } as Journey;
    },

    async cancelJourney(req: JourneyTransitionRequest): Promise<Journey> {
      const { journeyId, actorLoginName, reason } = req;
      if (!actorLoginName.trim()) {
        throw new Error(`${PREFIX} cancelJourney: actorLoginName is empty. Refusing to write without an identifiable actor.`);
      }

      const current = await fetchItemByTitle(siteUrl, journeyId);
      if (!current) {
        throw new Error(`${PREFIX} cancelJourney: Journey not found in C3Journeys: ${journeyId}`);
      }
      const currentStatus = current.Status as Journey['Status'];
      if (!canCancel(currentStatus)) {
        throw new InvalidTransitionError(journeyId, currentStatus, 'cancel');
      }

      const auditLine = buildAuditLine('CANCELLED', actorLoginName, reason);
      const newNotes = appendAuditLine(current.Notes, auditLine);

      const digest = await fetchFormDigest(siteUrl);
      await patchJourneyItem(siteUrl, current.Id, digest, {
        Status: 'Cancelled',
        Notes:  newNotes ?? null,
      });

      console.info(`${PREFIX} cancelJourney: ${journeyId} -> Cancelled by ${actorLoginName}`);

      const warnRef = { count: 0 };
      const base = mapSpItemToJourney(current, warnRef);
      return { ...base, JourneyID: journeyId, Status: 'Cancelled', Notes: newNotes } as Journey;
    },
  };
};
